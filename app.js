// ==========================================
// DEPENDENCIES
// ==========================================
require('dotenv').config();

const express = require("express");
const multer = require("multer");
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");
const session = require("express-session");
const MongoStore = require('connect-mongo');
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");
const QRCode = require('qrcode');
const mongoose = require("mongoose");
const steadfast = require("./steadfast");

const Category = require("./models/Category");


const app = express();
const PORT = process.env.PORT || 8000; 

const server = http.createServer(app);
const wss = new WebSocketServer({ 
    server,
    clientTracking: true
});

const wsClients = new Map();


// ==========================================
// DEBUG LOGGING
// ==========================================
console.log('🚀 Starting BAGNEST application...');
console.log('📡 NODE_ENV:', process.env.NODE_ENV);
console.log('📡 PORT:', process.env.PORT || 8000);
console.log('📡 MONGODB_URI exists:', !!process.env.MONGODB_URI);

// ==========================================
// MONGODB CONNECTION
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/bagnest_db";

console.log('🔗 Connecting to MongoDB...');

mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
})
.then(() => {
    console.log("✅ MongoDB connected successfully");
    ensureSuperAdmin();
})
.catch(err => {
    console.error("❌ MongoDB connection error:", err);
    console.log("⚠️ Please check your MONGODB_URI in .env file");
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB error:', err);
});


// ==========================================
// SCHEMAS
// ==========================================

// User Schema
const userSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' },
    profile: {
        name: { type: String, default: '' },
        email: { type: String, default: '' },
        phone: { type: String, default: '' },
        address: { type: String, default: '' },
        avatar: { type: String, default: '' },
        isSuperAdmin: { type: Boolean, default: false },
        passwordChanged: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now }
    },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

// Product Schema (UPDATED with multiple images, sizes, colors)
const productSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    originalPrice: { type: Number, default: null },
    imagePath: { type: String, default: '/uploads/default.jpg' },
    images: [{ type: String, default: [] }],
    category: { type: String, default: 'General' },
    stock: { 
        type: Number, 
        default: 0,
        min: 0
    },
    stockStatus: {
        type: String,
        enum: ['in_stock', 'low_stock', 'out_of_stock'],
        default: 'out_of_stock'
    },
    colors: [{ type: String, default: [] }],
    sizes: [{ type: String, default: [] }],
    // NEW: per size+color stock. If a product has no variants, the flat
    // `stock` field above is used as before (fully backward compatible).
    variants: [{
        color: { type: String, default: '' },
        size: { type: String, default: '' },
        stock: { type: Number, default: 0, min: 0 },
        // Optional per-variant price override. 0/blank = use the product's base price.
        price: { type: Number, default: 0, min: 0 },
        originalPrice: { type: Number, default: 0, min: 0 }
    }],
    reviews: { type: Number, default: 0 },
    rating: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Product = mongoose.model("Product", productSchema);

// Sale Schema
const saleSchema = new mongoose.Schema({
    saleId: { type: String, required: true, unique: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, default: 'N/A' },
    customerPhone: { type: String, default: 'N/A' },
    customerAddress: { type: String, required: true },
    productName: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    imagePath: { type: String, default: '/uploads/default.jpg' },
    saleDate: { type: Date, default: Date.now },
    status: { 
        type: String, 
        enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Completed', 'Cancelled'],
        default: 'Pending' 
    },
    isActiveCart: { type: Boolean, default: false },
    statusHistory: [{
        status: { type: String },
        updatedBy: { type: String },
        updatedByRole: { type: String },
        timestamp: { type: Date, default: Date.now },
        fromStatus: { type: String },
        via: { type: String, default: 'System' }
    }],
    products: [{
        productId: { type: String },
        name: { type: String },
        price: { type: Number },
        quantity: { type: Number },
        total: { type: Number },
        size: { type: String, default: '' },
        color: { type: String, default: '' }
    }],
    lastUpdatedBy: { type: String },
    lastUpdatedByRole: { type: String },
    lastUpdatedAt: { type: Date, default: Date.now },
    // Steadfast Courier tracking (filled in once the order is sent to courier)
    courier: {
        provider: { type: String, default: '' },       // e.g. 'steadfast'
        consignmentId: { type: String, default: '' },
        trackingCode: { type: String, default: '' },
        status: { type: String, default: '' },          // Steadfast's own delivery status
        sentAt: { type: Date }
    }
});
const Sale = mongoose.model("Sale", saleSchema);

// Cart Schema (UPDATED with size and color)
const cartSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    items: [{
        id: { type: String, required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true, min: 1 },
        imagePath: { type: String, default: '' },
        size: { type: String, default: '' },
        color: { type: String, default: '' }
    }],
    updatedAt: { type: Date, default: Date.now }
});
const Cart = mongoose.model("Cart", cartSchema);

// Guest Cart Schema (UPDATED with size and color)
const guestCartSchema = new mongoose.Schema({
    guestSessionId: { type: String, required: true, unique: true },
    items: [{
        id: { type: String, required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true, min: 1 },
        imagePath: { type: String, default: '' },
        size: { type: String, default: '' },
        color: { type: String, default: '' }
    }],
    updatedAt: { type: Date, default: Date.now }
});
const GuestCart = mongoose.model("GuestCart", guestCartSchema);



// ==========================================
// CLOUDINARY CONFIGURATION
// ==========================================
console.log('☁️ Configuring Cloudinary...');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Cloudinary Storage for Products (Multiple Images)
const productStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'bagnest_products',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }]
  },
});

// Cloudinary Storage for Profile Avatars
const avatarStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'bagnest_avatars',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 200, height: 200, crop: 'thumb', gravity: 'face' }]
  },
});

// Multer Upload (Multiple Products Images)
const uploadMultiple = multer({ 
  storage: productStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
}).array('productImages', 5); // Max 5 images

// Multer Upload (Single Product Image - for backward compatibility)
const uploadSingle = multer({ 
  storage: productStorage,
  limits: { fileSize: 5 * 1024 * 1024 }
}).single('newProductImage');

// Multer Upload (Avatar)
const avatarUpload = multer({ 
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});

// Category Storage for Cloudinary
const categoryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'bagnest_categories',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
    transformation: [{ width: 300, height: 300, crop: 'fill' }] // গোল ছবির জন্য স্কয়ার
  },
});
const uploadCategoryImage = multer({ storage: categoryStorage }).single('categoryImage');
// MIDDLEWARE

app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use("/testimg", express.static(path.join(__dirname, "testimg")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ==========================================
// EXPRESS SESSION CONFIGURATION
// ==========================================
const isProduction = process.env.NODE_ENV === 'production';
console.log('🔒 Session config - Production mode:', isProduction);


app.set('trust proxy', 1);
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGODB_URI,
        ttl: 14 * 24 * 60 * 60,
        autoRemove: 'native'
    }),
    cookie: { 
        secure: isProduction ? true : false,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        httpOnly: true
    },
    name: 'bagnest.sid'
}));

// Cache control headers
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(async (req, res, next) => {
  if (!req.session.user) {
    if (!req.cookies.guest_session_id) {
      const guestId = uuidv4();
      res.cookie('guest_session_id', guestId, {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true
      });
      req.guestSessionId = guestId;
    } else {
      req.guestSessionId = req.cookies.guest_session_id;
    }
  } else {
    req.guestSessionId = null;
  }
  next();
});

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.isGuest = !req.session.user;
  next();
});


// HELPER FUNCTIONS

//--------route--------------------------------
// ============================================
// app.js
        
app.get("/copy", (req, res) => {
    res.render("copy-page", {
        user: req.session.user || null,
        isGuest: !req.session.user
    });
});

// ============================================

// User functions
async function getUserByUsername(username) {
    return await User.findOne({ username: { $regex: new RegExp(`^${username.trim()}$`, "i") } });
}

async function createUser(userData) {
    const user = new User(userData);
    return await user.save();
}

// Product functions
// ---- Variant (size+color) stock helpers ----
function computeStockStatus(stock) {
    if (stock <= 0) return 'out_of_stock';
    if (stock <= 5) return 'low_stock';
    return 'in_stock';
}

// Sum of all variant stocks. If a product has no variants, returns null
// so callers know to fall back to the flat `stock` field instead.
function totalStockFromVariants(variants) {
    if (!variants || variants.length === 0) return null;
    return variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0);
}

// Finds the variant matching a given size/color pair. Empty string matches
// products that only vary by size (color: '') or only by color (size: '').
function findVariant(product, size, color) {
    if (!product.variants || product.variants.length === 0) return null;
    return product.variants.find(v =>
        (v.size || '') === (size || '') && (v.color || '') === (color || '')
    ) || null;
}

// Returns how many units are available for a specific size/color pick.
// Falls back to the flat product.stock when the product has no variants.
function getAvailableStock(product, size, color) {
    const variant = findVariant(product, size, color);
    if (variant) return variant.stock;
    if (product.variants && product.variants.length > 0) return 0; // has variants but this combo doesn't exist
    return product.stock || 0;
}

// Returns the effective selling price for a specific size/color pick.
// A variant only overrides the base price when its own price is > 0.
function getVariantPrice(product, size, color) {
    const variant = findVariant(product, size, color);
    if (variant && variant.price > 0) return variant.price;
    return product.price;
}

function getVariantOriginalPrice(product, size, color) {
    const variant = findVariant(product, size, color);
    if (variant && variant.originalPrice > 0) return variant.originalPrice;
    return product.originalPrice || null;
}

async function getAllProducts() {
    return await Product.find({ isActive: true });
}

async function getProductById(id) {
    return await Product.findOne({ id: id });
}

async function createProduct(productData) {
    const product = new Product(productData);
    return await product.save();
}

async function updateProduct(id, data) {
    return await Product.findOneAndUpdate({ id: id }, data, { new: true });
}

async function deleteProduct(id) {
    return await Product.deleteOne({ id: id });
}

// Sale functions
async function getAllSales() {
    return await Sale.find({}).sort({ saleDate: -1 });
}

async function getSaleById(saleId) {
    return await Sale.findOne({ saleId: saleId });
}

async function createSale(saleData) {
    const sale = new Sale(saleData);
    return await sale.save();
}

async function createMultipleSales(salesData) {
    return await Sale.insertMany(salesData);
}

async function updateSaleStatus(saleId, status, updatedBy, updatedByRole) {
    const sale = await Sale.findOne({ saleId: saleId });
    if (!sale) return null;
    
    const oldStatus = sale.status || 'Pending';
    sale.status = status;
    sale.statusHistory.push({
        status: status,
        updatedBy: updatedBy,
        updatedByRole: updatedByRole,
        timestamp: new Date(),
        fromStatus: oldStatus
    });
    sale.lastUpdatedBy = updatedBy;
    sale.lastUpdatedByRole = updatedByRole;
    sale.lastUpdatedAt = new Date();
    return await sale.save();
}

// Cart functions
async function getUserCart(userId) {
    return await Cart.findOne({ userId: userId });
}

async function saveUserCart(userId, items) {
    const existing = await Cart.findOne({ userId: userId });
    if (existing) {
        existing.items = items;
        existing.updatedAt = new Date();
        return await existing.save();
    } else {
        const cart = new Cart({ userId, items });
        return await cart.save();
    }
}

async function deleteUserCart(userId) {
    return await Cart.deleteOne({ userId: userId });
}

// Guest Cart functions
async function getGuestCart(guestSessionId) {
    if (!guestSessionId) {
        console.log("⚠️ No guestSessionId provided for get");
        return null;
    }
    const cart = await GuestCart.findOne({ guestSessionId: guestSessionId });
    console.log(`🔍 Guest cart for ${guestSessionId}:`, cart ? cart.items.length : 0, "items");
    return cart;
}

async function saveGuestCart(guestSessionId, items) {
    if (!guestSessionId) {
        console.log("⚠️ No guestSessionId provided for save");
        return null;
    }
    console.log(`💾 Saving guest cart for ${guestSessionId}:`, items.length, "items");
    
    const existing = await GuestCart.findOne({ guestSessionId: guestSessionId });
    if (existing) {
        existing.items = items;
        existing.updatedAt = new Date();
        return await existing.save();
    } else {
        const cart = new GuestCart({ guestSessionId, items });
        return await cart.save();
    }
}

async function deleteGuestCart(guestSessionId) {
    if (!guestSessionId) {
        console.log("⚠️ No guestSessionId provided for delete");
        return null;
    }
    console.log(`🗑️ Deleting guest cart for ${guestSessionId}`);
    return await GuestCart.deleteOne({ guestSessionId: guestSessionId });
}

// Active Order functions
async function createOrUpdateActiveOrder(user, cartItems) {
    const userEmail = user.profile?.email || user.username;
    
    await Sale.deleteMany({ 
        isActiveCart: true, 
        customerEmail: userEmail 
    });
    
    if (cartItems.length > 0) {
        const totalAmount = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const productNames = cartItems.map(item => `${item.name} (${item.quantity}x)`).join(', ');
        
        const activeOrder = {
            saleId: "ACTIVE-" + Date.now(),
            customerName: user.profile?.name || user.username,
            customerEmail: userEmail,
            customerPhone: user.profile?.phone || '',
            customerAddress: 'Cart',
            productName: productNames,
            price: totalAmount / cartItems.reduce((sum, item) => sum + item.quantity, 0),
            quantity: cartItems.reduce((sum, item) => sum + item.quantity, 0),
            totalAmount: totalAmount,
            imagePath: '/uploads/default.jpg',
            saleDate: new Date(),
            status: 'Pending',
            isActiveCart: true,
            statusHistory: [{ 
                status: 'Pending', 
                updatedBy: user.username, 
                updatedByRole: user.role || 'user',
                timestamp: new Date()
            }],
            products: cartItems
        };
        
        const sale = new Sale(activeOrder);
        await sale.save();
    }
}

// Cart load helper function
async function loadUserCart(req, user) {
    try {
        const userCart = await getUserCart(user.id);
        if (userCart && userCart.items.length > 0) {
            req.session.cart = userCart.items;
            console.log("📦 User cart loaded:", userCart.items.length, "items");
        } else {
            req.session.cart = [];
        }

        const guestSessionId = req.cookies.guest_session_id;
        if (guestSessionId) {
            const guestCart = await getGuestCart(guestSessionId);
            if (guestCart && guestCart.items.length > 0) {
                console.log("🔄 Merging guest cart:", guestCart.items.length, "items");
                
                guestCart.items.forEach(guestItem => {
                    const existingItem = req.session.cart.find(
                        item => item.id === guestItem.id
                    );
                    if (existingItem) {
                        existingItem.quantity += guestItem.quantity;
                    } else {
                        req.session.cart.push({
                            id: guestItem.id,
                            name: guestItem.name,
                            price: guestItem.price || 0,
                            quantity: guestItem.quantity || 1,
                            imagePath: guestItem.imagePath || '/uploads/default.jpg',
                            size: guestItem.size || '',
                            color: guestItem.color || ''
                        });
                    }
                });
                
                await deleteGuestCart(guestSessionId);
                res.clearCookie('guest_session_id');
                
                if (req.session.cart.length > 0) {
                    await saveUserCart(user.id, req.session.cart);
                    console.log("✅ Merged cart saved:", req.session.cart.length, "items");
                }
            }
        }
    } catch (err) {
        console.error('❌ Error loading cart:', err);
    }
}

// ENSURE SUPER ADMIN
async function ensureSuperAdmin() {
    try {
        console.log('🔐 Checking for Super Admin...');
        const superAdmin = await User.findOne({ username: 'superadmin' });
        
        if (!superAdmin) {
            console.log('🔐 No Super Admin found. Creating...');
            
            const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;
            
            if (!superAdminPassword) {
                console.error('❌ SUPER_ADMIN_PASSWORD not found in environment!');
                console.error('⚠️ Please set SUPER_ADMIN_PASSWORD in Render Environment Variables');
                return;
            }
            
            console.log('✅ SUPER_ADMIN_PASSWORD found in environment');
            
            const newSuperAdmin = new User({
                id: "USR-SUPER-ADMIN-" + Date.now(),
                username: "superadmin",
                password: superAdminPassword,
                role: "admin",
                profile: {
                    name: "Super Admin",
                    email: "superadmin@bagnest.com",
                    phone: "+880 1234 567890",
                    address: "System Admin",
                    isSuperAdmin: true,
                    passwordChanged: false,
                    createdAt: new Date()
                }
            });
            
            await newSuperAdmin.save();
            console.log('✅ Super Admin created successfully!');
            console.log('📧 Username: superadmin');
            console.log('🔑 Password: From environment variables');
        } else {
            console.log('✅ Super Admin already exists');
            console.log('📧 Username: superadmin');
        }
    } catch (error) {
        console.error('❌ Error creating Super Admin:', error.message);
    }
}


// AUTH MIDDLEWARE

const requireSuperAdmin = (req, res, next) => {
    if (req.session && req.session.user) {
        const isSuperAdmin = req.session.user.username === 'superadmin' || 
                            req.session.user.profile?.isSuperAdmin === true;
        if (isSuperAdmin) {
            return next();
        }
    }
    res.status(403).send("Access Denied: Super Admin only.");
};

const requireAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect("/login");
};

const requireAdmin = (req, res, next) => {
  if (req.session && req.session.user) {
    const role = req.session.user.role;
    const username = req.session.user.username.toLowerCase();
    if (role === "admin" || username === "admin" || req.session.user.profile?.isSuperAdmin === true) {
      return next();
    }
  }
  res
    .status(403)
    .send(
      "Access Denied: Administrative permissions are required to view this dashboard ledger.",
    );
};

const requireCashierOrAdmin = (req, res, next) => {
  if (req.session && req.session.user) {
    const role = req.session.user.role;
    const username = req.session.user.username.toLowerCase();
    if (role === "admin" || role === "authorized_cashier" || username === "admin" || req.session.user.profile?.isSuperAdmin === true) {
      return next();
    }
  }
  res.status(403).send("Access Denied: Cashier or Admin permissions required.");
};



// BROADCAST FUNCTION

let lastBroadcastTime = 0;
const BROADCAST_THROTTLE = 300;

const broadcastRefresh = (data = {}) => {
    const now = Date.now();
    if (now - lastBroadcastTime < BROADCAST_THROTTLE) {
        console.log('⏳ Broadcast throttled');
        return;
    }
    lastBroadcastTime = now;
    
    const message = JSON.stringify({
        type: "REFRESH_DATA",
        timestamp: new Date().toISOString(),
        ...data
    });
    
    let activeClients = 0;
    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(message);
            activeClients++;
        }
    });
    
    if (activeClients > 0) {
        console.log(`📡 Broadcast sent to ${activeClients} active clients`);
    }
};


// ==========================================
// ROUTES
// ==========================================

// ---------- TEST ROUTES ----------
app.get("/test-db", async (req, res) => {
    try {
        const userCount = await User.countDocuments();
        const users = await User.find({}, { password: 0 });
        
        res.json({
            success: true,
            database: 'Connected',
            userCount: userCount,
            users: users,
            environment: process.env.NODE_ENV,
            mongodb_uri_exists: !!process.env.MONGODB_URI
        });
    } catch (err) {
        res.json({
            success: false,
            error: err.message,
            stack: err.stack
        });
    }
});

app.get("/test-session", (req, res) => {
    res.json({
        sessionID: req.session?.id || 'No session',
        user: req.session?.user || null,
        isLoggedIn: !!req.session?.user
    });
});

// ---------- REGISTER ----------
app.get("/register", (req, res) => {
  res.render("register", { error: null, success: null });
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render("register", {
      error: "All profile input parameters are required.",
      success: null,
    });
  }

  try {
    const userExists = await getUserByUsername(username);
    if (userExists) {
      return res.render("register", {
        error: "Username is already registered.",
        success: null,
      });
    }

    const reservedUsernames = ['admin', 'superadmin'];
    if (reservedUsernames.includes(username.trim().toLowerCase())) {
      return res.render("register", {
        error: "This username is reserved for system administrators. Please choose a different username.",
        success: null,
      });
    }

    const assignedRole = "user";

    const newUser = {
      id: "USR-" + Date.now(),
      username: username.trim(),
      password: password,
      role: assignedRole,
      profile: {
        name: username.trim(),
        email: "",
        phone: "",
        address: "",
        createdAt: new Date()
      }
    };

    await createUser(newUser);

    return res.render("register", {
      error: null,
      success: "Account registered successfully! You can now log in.",
    });
  } catch (err) {
    console.error("Registration error:", err);
    return res.render("register", {
      error: "Database error. Please try again.",
      success: null,
    });
  }
});

// ==========================================
// LOGIN
// ==========================================
app.get("/login", (req, res) => {
    console.log('🔐 GET /login called');
    const redirect = req.query.redirect || null;
    res.render("login", { 
        error: null, 
        message: req.query.message || null,
        redirect: redirect 
    });
});

app.post("/login", async (req, res) => {
    console.log('========================================');
    console.log('🔐 POST /login called');
    console.log('========================================');
    
    const { username, password, redirect } = req.body;
    
    console.log('📝 Username received:', username);
    console.log('📝 Password received:', password ? '***' : 'empty');
    
    if (!username || !password) {
        console.log('❌ Missing username or password');
        return res.render("login", {
            error: "Username and password are required.",
            message: null,
            redirect: redirect || null
        });
    }

    try {
        console.log('🔍 Searching for user in database...');
        const matchingUser = await User.findOne({
            username: { $regex: new RegExp(`^${username.trim()}$`, "i") }
        });

        if (!matchingUser) {
            console.log('❌ No user found with username:', username);
            return res.render("login", {
                error: "Invalid Username or Password.",
                message: null,
                redirect: redirect || null
            });
        }

        console.log('✅ User found:', matchingUser.username);
        console.log('🔑 Match result:', matchingUser.password === password);

        if (matchingUser.password !== password) {
            console.log('❌ Password mismatch for:', matchingUser.username);
            return res.render("login", {
                error: "Invalid Username or Password.",
                message: null,
                redirect: redirect || null
            });
        }

        console.log('✅ Password matched!');

        const isSuperAdmin = matchingUser.username === 'superadmin' || 
                           (matchingUser.profile && matchingUser.profile.isSuperAdmin === true);

        req.session.user = {
            id: matchingUser.id,
            username: matchingUser.username,
            role: matchingUser.role || "user",
            loginTime: new Date(),
            profile: matchingUser.profile || {},
            isSuperAdmin: isSuperAdmin
        };

        console.log('👤 Session user set:', req.session.user.username);
        console.log('🔑 Session ID:', req.session.id);

        req.session.save((err) => {
            if (err) {
                console.error('❌ Session save error:', err);
                return res.render("login", {
                    error: "Session error. Please try again.",
                    message: null,
                    redirect: redirect || null
                });
            }

            console.log('✅ Session saved successfully');

            let redirectUrl = redirect || "/";
            if (isSuperAdmin) {
                redirectUrl = "/superadmin/dashboard";
            }

            console.log('➡️ Redirecting to:', redirectUrl);
            return res.redirect(redirectUrl);
        });

    } catch (err) {
        console.error('❌ Login error:', err);
        console.error('❌ Error stack:', err.stack);
        return res.render("login", {
            error: "Database error. Please try again.",
            message: null,
            redirect: redirect || null
        });
    }
});

// ---------- LOGOUT ----------
app.get("/logout", async (req, res) => {
  if (req.session.user && req.session.cart) {
    await saveUserCart(req.session.user.id, req.session.cart);
  }
  
  req.session.destroy((err) => {
    if (err) console.error("Error destroying terminal session map:", err);
    res.redirect("/login");
  });
});

// ---------- HOME ----------
app.get("/", async (req, res) => {
  try {
    // 🔥 ক্যাটাগরি ফিল্টার লজিক
    const { category } = req.query;

    let products;
    if (category && category !== 'all') {
        products = await Product.find({ isActive: true, category: category });
    } else {
        products = await getAllProducts();
    }

    // 🔥 হেডার ড্রপডাউনে সাব-ক্যাটাগরি সহ (Tree) ক্যাটাগরি লোড
    const allCats = await Category.find().sort({ order: 1 });
    const parentCategories = allCats.filter(c => !c.parentId);
    const childCategories = allCats.filter(c => c.parentId);

    const categoryTree = parentCategories.map(parent => ({
        ...parent.toObject(),
        children: childCategories.filter(child => child.parentId.toString() === parent._id.toString())
    }));

    let cartCount = 0;
    if (req.session.user) {
      const userCart = req.session.cart || [];
      cartCount = userCart.reduce((sum, item) => sum + item.quantity, 0);
    } else {
      const guestCart = await getGuestCart(req.guestSessionId);
      if (guestCart) {
        cartCount = guestCart.items.reduce((sum, item) => sum + item.quantity, 0);
      }
    }

    // ✅ এই অংশটি অবশ্যই try { } এর ভেতরে থাকতে হবে।
    const specialOffers = [
      {
        title: "Summer Bundle",
        description: "Get 15% off when buying a two bag together.",
        badge: "Hot Deal",
      },
      {
        title: "Laptop Bag Upgrade Promo",
        description: "Free shipping and a premium .",
        badge: "Limited Time",
      },
    ];

    res.render("home", {
      products: products,
      offers: specialOffers, // ✅ এখানে ঠিকঠাক পাস হচ্ছে
      cartCount: cartCount,
      user: req.session.user || null,
      isGuest: !req.session.user,
      categories: categoryTree,
      currentCategory: category || null
    });
  } catch (err) {
    console.error("Home error:", err);
    res.status(500).send("Internal server error");
  }
});

// ---------- CART PAGE ----------
app.get("/cart", async (req, res) => {
  try {
    const products = await getAllProducts();
    const categories = await Category.find().sort({ order: 1 }); // 🔥 যোগ করা হয়েছে

    let userCart = [];
    let cartTotal = 0;

    if (req.session.user) {
      userCart = req.session.cart || [];
      if (userCart.length === 0) {
        const dbCart = await getUserCart(req.session.user.id);
        if (dbCart && dbCart.items.length > 0) {
          userCart = dbCart.items;
          req.session.cart = userCart;
        }
      }
      cartTotal = userCart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
    } else {
      const guestCart = await getGuestCart(req.guestSessionId);
      if (guestCart) {
        userCart = guestCart.items;
        cartTotal = userCart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
      }
    }

    console.log("📦 Cart items:", userCart.length);
    console.log("💰 Cart total:", cartTotal);

    res.render("cart", {
      products: products,
      cart: userCart,
      cartTotal: cartTotal.toFixed(2),
      user: req.session.user,
      isGuest: !req.session.user,
      categories: categories, // 🔥 যোগ করা হয়েছে
      currentCategory: null
    });
  } catch (err) {
    console.error("Cart error:", err);
    res.status(500).send("Internal server error");
  }
});

// ---------- MY ORDERS ----------
app.get("/my-orders", requireAuth, async (req, res) => {
  try {
    const userEmail = req.session.user.profile?.email || req.session.user.username;
    const categories = await Category.find().sort({ order: 1 }); // 🔥 যোগ করা হয়েছে
    
    const userOrders = await Sale.find({
      $or: [
        { customerEmail: userEmail },
        { customerName: { $regex: new RegExp(`^${req.session.user.username}$`, "i") } }
      ],
      saleId: { $regex: /^SALE-/ },
      isActiveCart: { $ne: true }
    }).sort({ saleDate: -1 });
    
    const totalOrders = userOrders.length;
    const totalAmount = userOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const averageAmount = totalOrders > 0 ? (totalAmount / totalOrders).toFixed(2) : '0.00';
    const pendingCount = userOrders.filter(o => (o.status || 'Pending').toLowerCase() === 'pending').length;
    
    res.render("my-orders", {
      user: req.session.user,
      orders: userOrders,
      orderCount: totalOrders,
      totalAmount: totalAmount.toFixed(2),
      averageAmount: averageAmount,
      pendingCount: pendingCount,
      categories: categories, // 🔥 যোগ করা হয়েছে
      currentCategory: null
    });
  } catch (err) {
    console.error("My orders error:", err);
    res.status(500).send("Internal server error");
  }
});

// ---------- TERMINAL ----------
app.get("/terminal", requireCashierOrAdmin, async (req, res) => {
  try {
    const products = await getAllProducts();
    const categories = await Category.find().sort({ order: 1 }); // 🔥 যোগ করা হয়েছে

    let userCart = req.session.cart || [];
    
    if (userCart.length === 0 && req.session.user) {
      const dbCart = await getUserCart(req.session.user.id);
      if (dbCart && dbCart.items.length > 0) {
        userCart = dbCart.items;
        req.session.cart = userCart;
      }
    }

    const cartTotal = userCart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    res.render("dashboard", {
      products: products,
      cart: userCart,
      cartTotal: cartTotal.toFixed(2),
      user: req.session.user,
      categories: categories, // 🔥 যোগ করা হয়েছে
      currentCategory: null
    });
  } catch (err) {
    console.error("Terminal error:", err);
    res.status(500).send("Internal server error");
  }
});

// ==========================================
// CUSTOM ORDER SCHEMA
// ==========================================
const customOrderSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    customerId: { type: String, required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, default: '' },
    title: { type: String, required: true },
    description: { type: String, required: true },
    images: [{ type: String, default: [] }],
    budget: { type: Number, default: 0 },
    quantity: { type: Number, default: 1 },
    deadline: { type: Date, default: null },
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected', 'assigned', 'completed'],
        default: 'pending' 
    },
    adminNotes: { type: String, default: '' },
    bids: [{
        sellerId: { type: String, required: true },
        sellerName: { type: String, required: true },
        amount: { type: Number, required: true },
        deliveryTime: { type: String, default: '' },
        note: { type: String, default: '' },
        status: { 
            type: String, 
            enum: ['pending', 'accepted', 'rejected'],
            default: 'pending' 
        },
        createdAt: { type: Date, default: Date.now }
    }],
    selectedBidId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const CustomOrder = mongoose.model("CustomOrder", customOrderSchema);


// ==========================================
// CUSTOM ORDER - CREATE PAGE (Customer)
// ==========================================
app.get("/my-custom-orders", requireAuth, (req, res) => {
    res.render("custom-order", {
        user: req.session.user,
        isGuest: false
    });
});
// ==========================================
// CUSTOM ORDER ROUTES
// ==========================================

// ---------- Middleware: Seller or Admin ----------
const requireSellerOrAdmin = (req, res, next) => {
    if (req.session && req.session.user) {
        const role = req.session.user.role;
        if (role === 'seller' || role === 'admin' || role === 'superadmin' || req.session.user.isSuperAdmin) {
            return next();
        }
    }
    res.status(403).send("Access Denied: Seller or Admin permissions required.");
};

// ==========================================
// CUSTOM ORDER - CREATE (with Image Upload)
// ==========================================
const uploadOrderImages = multer({
    storage: productStorage, // Cloudinary storage (আপনার আগের productStorage ব্যবহার করুন)
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB per file
}).array('orderImages', 5); // Max 5 images

app.post("/api/custom-order/create", requireAuth, uploadOrderImages, async (req, res) => {
    const { title, description, budget, quantity, deadline } = req.body;
    
    try {
        // ছবির URL সংগ্রহ করুন
        let imageUrls = [];
        if (req.files && req.files.length > 0) {
            imageUrls = req.files.map(file => file.path); // Cloudinary URL
        }
        
        const order = new CustomOrder({
            id: "CO-" + Date.now(),
            customerId: req.session.user.id,
            customerName: req.session.user.profile?.name || req.session.user.username,
            customerEmail: req.session.user.profile?.email || req.session.user.username,
            customerPhone: req.session.user.profile?.phone || '',
            title: title.trim(),
            description: description.trim(),
            budget: parseFloat(budget) || 0,
            quantity: parseInt(quantity) || 1,
            deadline: deadline ? new Date(deadline) : null,
            images: imageUrls, // ✅ ছবি সেভ
            status: 'pending'
        });
        
        await order.save();
        res.json({ success: true, message: "Custom order created successfully!", order });
    } catch (err) {
        console.error("Custom order creation error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------- GET ALL CUSTOM ORDERS (Admin/Seller) ----------
app.get("/api/my-custom-orders", requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        let filter = {};
        
        // যদি সেলার হয়, শুধু approved অর্ডার দেখাবে
        if (user.role === 'seller' || user.role === 'authorized_cashier') {
            filter.status = 'approved';
        }
        // অ্যাডমিন সব দেখতে পাবে
        // কাস্টমার শুধু নিজের অর্ডার দেখতে পাবে (আমরা আলাদা রাউট দেব)
        
        const orders = await CustomOrder.find(filter).sort({ createdAt: -1 });
        res.json({ success: true, orders });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------- GET CUSTOMER'S OWN ORDERS ----------
app.get("/api/my-custom-orders", requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const orders = await CustomOrder.find({ customerId: userId }).sort({ createdAt: -1 });
        res.json({ success: true, orders });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------- GET SINGLE CUSTOM ORDER ----------
app.get("/api/custom-order/:id", requireAuth, async (req, res) => {
    try {
        const order = await CustomOrder.findOne({ id: req.params.id });
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });
        
        // Check permission: customer can view own, admin/seller can view approved
        const user = req.session.user;
        if (order.customerId !== user.id && user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'seller') {
            return res.status(403).json({ success: false, message: "Access denied" });
        }
        res.json({ success: true, order });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------- ADMIN: APPROVE/REJECT CUSTOM ORDER ----------
app.put("/api/admin/custom-order/:id", requireAdmin, async (req, res) => {
    const { status, adminNotes } = req.body;
    
    try {
        const order = await CustomOrder.findOne({ id: req.params.id });
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });
        
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }
        
        order.status = status;
        if (adminNotes) order.adminNotes = adminNotes;
        order.updatedAt = new Date();
        await order.save();
        
        res.json({ success: true, message: `Order ${status} successfully`, order });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------- SELLER: PLACE BID ----------
app.post("/api/custom-order/:id/bid", requireSellerOrAdmin, async (req, res) => {
    const { amount, deliveryTime, note } = req.body;
    const user = req.session.user;
    
    try {
        const order = await CustomOrder.findOne({ id: req.params.id });
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });
        
        if (order.status !== 'approved') {
            return res.status(400).json({ success: false, message: "Order is not open for bidding" });
        }
        
        // Check if seller already bid
        const existingBid = order.bids.find(b => b.sellerId === user.id);
        if (existingBid) {
            return res.status(400).json({ success: false, message: "You have already placed a bid on this order" });
        }
        
        const bid = {
            sellerId: user.id,
            sellerName: user.profile?.name || user.username,
            amount: parseFloat(amount),
            deliveryTime: deliveryTime || '',
            note: note || '',
            status: 'pending'
        };
        
        order.bids.push(bid);
        order.updatedAt = new Date();
        await order.save();
        
        res.json({ success: true, message: "Bid placed successfully", bid });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------- ADMIN: ACCEPT/REJECT BID ----------
app.put("/api/admin/custom-order/:orderId/bid/:bidId", requireAdmin, async (req, res) => {
    const { action } = req.body; // 'accept' or 'reject'
    
    try {
        const order = await CustomOrder.findOne({ id: req.params.orderId });
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });
        
        const bidIndex = order.bids.findIndex(b => b._id.toString() === req.params.bidId);
        if (bidIndex === -1) return res.status(404).json({ success: false, message: "Bid not found" });
        
        if (action === 'accept') {
            // Reject all other bids
            order.bids.forEach((b, idx) => {
                if (idx !== bidIndex) b.status = 'rejected';
            });
            order.bids[bidIndex].status = 'accepted';
            order.status = 'assigned';
            order.selectedBidId = order.bids[bidIndex]._id;
        } else if (action === 'reject') {
            order.bids[bidIndex].status = 'rejected';
        } else {
            return res.status(400).json({ success: false, message: "Invalid action" });
        }
        
        order.updatedAt = new Date();
        await order.save();
        
        res.json({ success: true, message: `Bid ${action}ed successfully`, order });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------- VIEW CUSTOM ORDER PAGE ----------
// ==========================================
// CUSTOM ORDER - SINGLE VIEW (Customer/Admin/Seller)
// ==========================================
app.get("/custom-order/:id", requireAuth, async (req, res) => {
    try {
        const order = await CustomOrder.findOne({ id: req.params.id });
        if (!order) {
            return res.status(404).send("Order not found");
        }

        // Permission check
        const user = req.session.user;
        const isOwner = order.customerId === user.id;
        const isAdmin = user.role === 'admin' || user.role === 'superadmin' || user.isSuperAdmin;
        const isSeller = user.role === 'seller' || user.role === 'authorized_cashier';

        if (!isOwner && !isAdmin && !isSeller) {
            return res.status(403).send("Access denied");
        }

        res.render("custom-order-detail", {
            order,
            user,
            isOwner,
            isAdmin,
            isSeller,
            isGuest: false
        });
    } catch (err) {
        console.error("Custom order detail error:", err);
        res.status(500).send("Internal Server Error");
    }
});

// ---------- CUSTOM ORDER LIST (for customers) ----------
app.get("/my-custom-orders", requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const orders = await CustomOrder.find({ customerId: userId }).sort({ createdAt: -1 });
        res.render("my-custom-orders", {
            user: req.session.user,
            orders: orders,
            isGuest: false
        });
    } catch (err) {
        console.error("❌ Error fetching custom orders:", err);
        res.status(500).send("Internal Server Error: " + err.message);
    }
});

// ---------- ADMIN CUSTOM ORDER MANAGEMENT ----------
app.get("/admin/my-custom-orders", requireAdmin, (req, res) => {
    res.render("admin-custom-orders", {
        user: req.session.user,
        isGuest: false
    });
});

// ---------- SELLER DASHBOARD (Bid on orders) ----------
app.get("/seller/my-custom-orders", requireSellerOrAdmin, (req, res) => {
    res.render("seller-custom-orders", {
        user: req.session.user,
        isGuest: false
    });
});
// ---------- CATEGORY APIs ----------
app.get('/api/categories', async (req, res) => {
    const categories = await Category.find().sort({ order: 1 });
    
    // মূল ক্যাটাগরি (Parent) এবং সাব-ক্যাটাগরি (Child) আলাদা করা
    const parentCategories = categories.filter(c => !c.parentId);
    const childCategories = categories.filter(c => c.parentId);
    
    // প্রতিটি Parent-এর ভেতরে তার Children গুলো যুক্ত করা (Tree Structure)
    const tree = parentCategories.map(parent => ({
        ...parent.toObject(),
        children: childCategories.filter(child => child.parentId.toString() === parent._id.toString())
    }));

    res.json(tree);
});

// Category Add (with Image Upload)
app.post('/api/admin/categories', requireAdmin, uploadCategoryImage, async (req, res) => {
    try {
        const { name, parentId } = req.body;
        const image = req.file ? req.file.path : ''; // ফাইল থাকলে পাথ, না থাকলে খালি

        const lastCat = await Category.findOne().sort({ order: -1 });
        const newCat = new Category({
            name,
            parentId: parentId || null,
            order: lastCat ? lastCat.order + 1 : 1,
            image: image
        });
        await newCat.save();
        res.status(201).json({ success: true, category: newCat });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// Category Update (Edit with Image Upload) -> ID অপরিবর্তিত থাকবে
app.put('/api/admin/categories/:id', requireAdmin, uploadCategoryImage, async (req, res) => {
    try {
        const { name, parentId } = req.body;
        const updateData = { name, parentId: parentId || null };

        // নতুন ছবি আপলোড হলে আপডেট হবে, না দিলে পুরনো ছবি থাকবে
        if (req.file) {
            updateData.image = req.file.path;
        }

        const updatedCat = await Category.findByIdAndUpdate(req.params.id, updateData, { new: true });
        if (!updatedCat) return res.status(404).json({ success: false, message: "Category not found" });

        res.json({ success: true, category: updatedCat });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/categories/reorder', requireAdmin, async (req, res) => {
    try {
        const { orderedIds } = req.body;
        for (let i = 0; i < orderedIds.length; i++) {
            await Category.findByIdAndUpdate(orderedIds[i], { order: i + 1 });
        }
        res.json({ success: true, message: "Categories reordered successfully!" });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (req, res) => {
    try {
        // সাব-ক্যাটাগরি থাকলে সেগুলোও ডিলিট করা হবে
        await Category.deleteMany({ parentId: req.params.id });
        await Category.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});





// ---------- CART APIs ----------
app.post("/api/cart/add", async (req, res) => {
  const { productId, quantity = 1, size = '', color = '' } = req.body;
  
  try {
    const targetProduct = await getProductById(productId);

    if (!targetProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // Validate against the specific size+color combo's stock (or flat stock
    // if this product has no variants), accounting for what's already in cart.
    const requestedQty = parseInt(quantity) || 1;
    const availableStock = getAvailableStock(targetProduct, size, color);

    let alreadyInCart = 0;
    if (req.session.user && req.session.cart) {
      const existing = req.session.cart.find(item => item.id === productId && item.size === size && item.color === color);
      if (existing) alreadyInCart = existing.quantity;
    } else if (!req.session.user) {
      const guestCart = await getGuestCart(req.guestSessionId);
      if (guestCart) {
        const existing = guestCart.items.find(item => item.id === productId && item.size === size && item.color === color);
        if (existing) alreadyInCart = existing.quantity;
      }
    }

    if (availableStock <= 0 || (alreadyInCart + requestedQty) > availableStock) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock for ${targetProduct.name}${size || color ? ' (' + [color, size].filter(Boolean).join(' / ') + ')' : ''}. Available: ${availableStock}`
      });
    }

    let cartCount = 0;
    let isGuest = false;

    if (req.session.user) {
      if (!req.session.cart) {
        req.session.cart = [];
      }

      const existingItem = req.session.cart.find(item => item.id === productId && item.size === size && item.color === color);
      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        req.session.cart.push({
          id: targetProduct.id,
          name: targetProduct.name,
          price: getVariantPrice(targetProduct, size, color),
          quantity: quantity,
          imagePath: targetProduct.imagePath || '',
          size: size || '',
          color: color || ''
        });
      }

      await saveUserCart(req.session.user.id, req.session.cart);
      await createOrUpdateActiveOrder(req.session.user, req.session.cart);
      
      cartCount = req.session.cart.reduce((sum, item) => sum + item.quantity, 0);
      isGuest = false;
      console.log("✅ Added to user cart:", req.session.cart.length, "items");
      
    } else {
      const guestSessionId = req.guestSessionId;
      console.log("🔍 Adding to guest cart:", guestSessionId);
      
      if (!guestSessionId) {
        return res.status(400).json({ success: false, message: "Guest session not found" });
      }
      
      let guestCart = await getGuestCart(guestSessionId);
      let items = guestCart ? guestCart.items : [];

      const existingItem = items.find(item => item.id === productId && item.size === size && item.color === color);
      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        items.push({
          id: targetProduct.id,
          name: targetProduct.name,
          price: getVariantPrice(targetProduct, size, color),
          quantity: quantity,
          imagePath: targetProduct.imagePath || '',
          size: size || '',
          color: color || ''
        });
      }

      await saveGuestCart(guestSessionId, items);
      cartCount = items.reduce((sum, item) => sum + item.quantity, 0);
      isGuest = true;
      console.log("✅ Added to guest cart:", items.length, "items");
    }

    broadcastRefresh({ 
      action: "cart_added", 
      productId: productId,
      cartCount: cartCount 
    });

    return res.json({
      success: true,
      message: isGuest ? "Added to guest cart" : "Added to cart",
      cartCount: cartCount,
      isGuest: isGuest
    });
  } catch (err) {
    console.error("Cart add error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/cart/remove", async (req, res) => {
  const { productId } = req.body;
  let cartCount = 0;

  try {
    if (req.session.user) {
      if (!req.session.cart) {
        req.session.cart = [];
      }

      const itemIndex = req.session.cart.findIndex(item => item.id === productId);
      if (itemIndex !== -1) {
        if (req.session.cart[itemIndex].quantity > 1) {
          req.session.cart[itemIndex].quantity -= 1;
        } else {
          req.session.cart.splice(itemIndex, 1);
        }
      }

      await saveUserCart(req.session.user.id, req.session.cart);
      await createOrUpdateActiveOrder(req.session.user, req.session.cart);
      cartCount = req.session.cart.reduce((sum, item) => sum + item.quantity, 0);
    } else {
      const guestSessionId = req.guestSessionId;
      const guestCart = await getGuestCart(guestSessionId);
      if (!guestCart) {
        return res.json({ success: false, message: "Cart is empty" });
      }

      const itemIndex = guestCart.items.findIndex(item => item.id === productId);
      if (itemIndex !== -1) {
        if (guestCart.items[itemIndex].quantity > 1) {
          guestCart.items[itemIndex].quantity -= 1;
        } else {
          guestCart.items.splice(itemIndex, 1);
        }
        await saveGuestCart(guestSessionId, guestCart.items);
        cartCount = guestCart.items.reduce((sum, item) => sum + item.quantity, 0);
      } else {
        return res.json({ success: false, message: "Product not found" });
      }
    }

    broadcastRefresh({ 
      action: "cart_removed", 
      productId: productId,
      cartCount: cartCount 
    });

    return res.json({
      success: true,
      message: "Cart updated",
      cartCount: cartCount
    });
  } catch (err) {
    console.error("Cart remove error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/cart/view", async (req, res) => {
  let items = [];
  let total = 0;

  try {
    if (req.session.user) {
      const userCart = req.session.cart || [];
      items = userCart;
      total = userCart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
    } else {
      const guestCart = await getGuestCart(req.guestSessionId);
      if (guestCart) {
        items = guestCart.items;
        total = guestCart.items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
      }
    }

    res.json({
      success: true,
      items: items,
      total: total,
      count: items.reduce((sum, item) => sum + item.quantity, 0)
    });
  } catch (err) {
    console.error("Cart view error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- CHECKOUT ----------
app.post("/api/cart/checkout", async (req, res) => {
  console.log("🛒 API Checkout called");

  if (!req.session.user) {
    console.log("❌ User not logged in");
    return res.status(401).json({
      success: false,
      redirect: "/login?redirect=/cart",
      message: "Please login to checkout"
    });
  }

  const userCart = req.session.cart || [];
  console.log("📦 Cart items:", userCart.length);

  if (userCart.length === 0) {
    console.log("❌ Cart is empty");
    return res.status(400).json({
      success: false,
      message: "Your cart is empty"
    });
  }

  try {
    const customerName = req.body.customerName || req.session.user.profile?.name || "Valued Customer";
    const customerAddress = req.body.customerAddress || req.session.user.profile?.address || "Walk-in Counter Sale";
    const customerEmail = req.body.customerEmail || req.session.user.profile?.email || req.session.user.username;
    const customerPhone = req.body.customerPhone || req.session.user.profile?.phone || "";

    const totalAmount = userCart.reduce(
      (sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0
    );

    // Stock check and deduct (per size+color variant when the product has them)
    for (let item of userCart) {
      const product = await Product.findOne({ id: item.id });
      if (product) {
        if (product.variants && product.variants.length > 0) {
          const variant = product.variants.find(v =>
            (v.size || '') === (item.size || '') && (v.color || '') === (item.color || '')
          );

          if (!variant) {
            return res.status(400).json({
              success: false,
              message: `${product.name}: selected size/color (${item.size || '-'} / ${item.color || '-'}) is not available.`
            });
          }

          const newVariantStock = variant.stock - item.quantity;
          if (newVariantStock < 0) {
            return res.status(400).json({
              success: false,
              message: `Insufficient stock for ${product.name} (${item.color || '-'} / ${item.size || '-'}). Available: ${variant.stock}`
            });
          }

          variant.stock = newVariantStock;
          product.stock = totalStockFromVariants(product.variants);
          product.stockStatus = computeStockStatus(product.stock);
        } else {
          const newStock = product.stock - item.quantity;
          if (newStock < 0) {
            return res.status(400).json({
              success: false,
              message: `Insufficient stock for ${product.name}. Available: ${product.stock}`
            });
          }

          product.stock = newStock;
          product.stockStatus = computeStockStatus(newStock);
        }

        await product.save();
        console.log(`📦 Stock updated: ${product.name} → ${product.stock}`);
      }
    }

    // Save session data
    req.session.lastCustomerName = customerName;
    req.session.lastCustomerEmail = customerEmail;
    req.session.lastCustomerPhone = customerPhone;
    req.session.lastCustomerAddress = customerAddress;
    req.session.lastTotalAmount = totalAmount.toFixed(2);

    const now = new Date();
    let lastSaleId = null;
    const salesDocs = [];

    userCart.forEach((item) => {
      const newSaleId = "SALE-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
      lastSaleId = newSaleId;
      
      salesDocs.push({
        saleId: newSaleId,
        customerName: customerName,
        customerEmail: customerEmail,
        customerPhone: customerPhone,
        customerAddress: customerAddress,
        productName: item.name || 'Product',
        price: parseFloat(item.price || 0),
        quantity: parseInt(item.quantity || 1),
        totalAmount: parseFloat(((item.price || 0) * (item.quantity || 1)).toFixed(2)),
        imagePath: item.imagePath || '/uploads/default.jpg',
        saleDate: now,
        status: 'Pending',
        statusHistory: [{ 
          status: 'Pending', 
          updatedBy: customerName, 
          updatedByRole: 'customer',
          timestamp: now
        }],
        lastUpdatedBy: customerName,
        lastUpdatedByRole: 'customer',
        lastUpdatedAt: now,
        products: userCart.map(p => ({
          productId: p.id || 'N/A',
          name: p.name || 'Product',
          price: p.price || 0,
          quantity: p.quantity || 1,
          total: (p.price || 0) * (p.quantity || 1),
          size: p.size || '',
          color: p.color || ''
        }))
      });
    });

    await Sale.insertMany(salesDocs);
    console.log("✅ Sales saved:", salesDocs.length);

    req.session.lastSaleId = lastSaleId;
    req.session.cart = [];
    
    if (req.session.user) {
      await saveUserCart(req.session.user.id, []);
    }

    await Sale.deleteMany({ 
      isActiveCart: true, 
      customerEmail: customerEmail 
    });

    req.session.save((err) => {
      if (err) {
        console.error("❌ Session save error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to save session. Please try again."
        });
      }

      console.log("✅ Checkout successful!");
      console.log("📦 Sale ID:", lastSaleId);
      console.log("👤 Customer:", customerName);
      console.log("💰 Total:", totalAmount.toFixed(2));

      return res.json({
        success: true,
        message: "Order completed successfully!",
        redirect: "/checkout-success",
        saleId: lastSaleId
      });
    });

  } catch (error) {
    console.error("❌ Checkout Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error occurred during checkout: " + error.message
    });
  }
});

// ---------- PROFILE APIs ----------
app.post("/api/profile/update", requireAuth, async (req, res) => {
  const { name, email, phone, address } = req.body;
  
  try {
    const user = await User.findOne({ id: req.session.user.id });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    if (!user.profile) {
      user.profile = {};
    }
    
    if (name) user.profile.name = name;
    if (email) user.profile.email = email;
    if (phone) user.profile.phone = phone;
    if (address) user.profile.address = address;
    
    await user.save();
    req.session.user.profile = user.profile;
    
    res.json({ 
      success: true, 
      message: "Profile updated successfully",
      profile: user.profile
    });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/profile", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.session.user.id });
    res.render("profile", { 
      user: req.session.user,
      profile: user?.profile || {}
    });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).send("Internal server error");
  }
});

app.post("/api/profile/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  try {
    const user = await User.findOne({ id: req.session.user.id });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    if (user.password !== currentPassword) {
      return res.status(400).json({ success: false, message: "Current password is incorrect" });
    }
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }
    
    if (req.session.user.username === 'superadmin' || req.session.user.profile?.isSuperAdmin === true) {
      user.profile.passwordChanged = true;
    }
    
    user.password = newPassword;
    await user.save();
    
    res.json({ 
      success: true, 
      message: "Password updated successfully" 
    });
  } catch (err) {
    console.error("Password update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- PROFILE AVATAR (CLOUDINARY) ----------
app.post("/api/profile/avatar", requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No image uploaded" });
  }
  
  try {
    const user = await User.findOne({ id: req.session.user.id });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    if (!user.profile) {
      user.profile = {};
    }
    
    user.profile.avatar = req.file.path;
    await user.save();
    req.session.user.profile.avatar = user.profile.avatar;
    
    res.json({ 
      success: true, 
      message: "Profile picture updated",
      avatar: user.profile.avatar
    });
  } catch (err) {
    console.error("Avatar update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- SUPER ADMIN ROUTES ----------
app.get("/superadmin/dashboard", requireSuperAdmin, async (req, res) => {
  try {
    const users = await User.find({});
    const products = await Product.find({});
    const sales = await Sale.find({});
    
    const stats = {
      totalUsers: users.length,
      totalProducts: products.length,
      totalOrders: sales.length,
      totalRevenue: sales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0),
      adminCount: users.filter(u => u.role === 'admin' && u.username !== 'superadmin').length,
      cashierCount: users.filter(u => u.role === 'authorized_cashier').length,
      userCount: users.filter(u => u.role === 'user').length,
      pendingOrders: sales.filter(s => (s.status || 'Pending') === 'Pending').length
    };
    
    res.render("superadmin-dashboard", {
      user: req.session.user,
      stats: stats,
      requirePasswordChange: !req.session.user.profile?.passwordChanged
    });
  } catch (err) {
    console.error("Superadmin dashboard error:", err);
    res.status(500).send("Internal server error");
  }
});

app.get("/superadmin/admins", requireSuperAdmin, async (req, res) => {
  try {
    const users = await User.find({});
    const admins = users.filter(u => u.role === 'admin' && u.username !== 'superadmin');
    res.render("superadmin-admins", {
      user: req.session.user,
      admins: admins,
      requirePasswordChange: false
    });
  } catch (err) {
    console.error("Superadmin admins error:", err);
    res.status(500).send("Internal server error");
  }
});

app.post("/superadmin/admin/create", requireSuperAdmin, async (req, res) => {
  const { username, password, email, name } = req.body;
  
  try {
    const existing = await User.findOne({ 
      username: { $regex: new RegExp(`^${username.trim()}$`, "i") } 
    });
    
    if (existing) {
      return res.status(400).json({ success: false, message: "Username already exists" });
    }
    
    const reservedUsernames = ['admin', 'superadmin'];
    if (reservedUsernames.includes(username.trim().toLowerCase())) {
      return res.status(400).json({ success: false, message: "This username is reserved." });
    }
    
    const newAdmin = new User({
      id: "USR-ADMIN-" + Date.now(),
      username: username.trim(),
      password: password,
      role: "admin",
      profile: {
        name: name || username.trim(),
        email: email || `${username}@bagnest.com`,
        isSuperAdmin: false,
        createdBy: req.session.user.username,
        createdAt: new Date()
      }
    });
    
    await newAdmin.save();
    
    res.json({ 
      success: true, 
      message: "Admin created successfully",
      user: newAdmin
    });
  } catch (err) {
    console.error("Admin create error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/superadmin/admin/delete", requireSuperAdmin, async (req, res) => {
  const { userId } = req.body;
  
  try {
    if (userId === req.session.user.id) {
      return res.status(400).json({ success: false, message: "Cannot delete yourself" });
    }
    
    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    if (user.username === 'superadmin') {
      return res.status(400).json({ success: false, message: "Cannot delete Super Admin" });
    }
    
    await User.deleteOne({ id: userId });
    
    res.json({ success: true, message: "Admin deleted successfully" });
  } catch (err) {
    console.error("Admin delete error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- ADMIN ROUTES ----------
app.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await User.find({});
    const safeUsers = users.map(u => {
      const { password, ...safeUser } = u.toObject();
      return safeUser;
    });
    res.render("admin-users", {
      user: req.session.user,
      users: safeUsers
    });
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).send("Internal server error");
  }
});

// ---------- UPDATE USER ROLE (Admin Only) ----------
app.post("/api/user/role", requireAdmin, async (req, res) => {
  const { userId, role } = req.body;
  
  try {
    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    if (user.username === 'superadmin' || user.profile?.isSuperAdmin === true) {
      return res.status(403).json({ success: false, message: "❌ Cannot change Super Admin role!" });
    }
    
    const isSuperAdmin = req.session.user.username === 'superadmin' || 
                         req.session.user.profile?.isSuperAdmin === true;
    
    if (role === 'admin' && !isSuperAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: "❌ Only Super Admin can create new Admins!" 
      });
    }
    
    // ✅ এখানে 'seller' যোগ করুন
    const validRoles = ['user', 'authorized_cashier', 'seller', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }
    
    user.role = role;
    await user.save();
    
    res.json({ 
      success: true, 
      message: `✅ User role updated to ${role}`
    });
  } catch (err) {
    console.error("Role update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/user/delete", requireAdmin, async (req, res) => {
  const { userId } = req.body;
  
  try {
    if (userId === req.session.user.id) {
      return res.status(400).json({ success: false, message: "Cannot delete yourself" });
    }
    
    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    if (user.username === 'superadmin' || user.profile?.isSuperAdmin === true) {
      return res.status(403).json({ success: false, message: "❌ Cannot delete Super Admin!" });
    }
    
    await User.deleteOne({ id: userId });
    
    res.json({ 
      success: true, 
      message: "✅ User deleted successfully" 
    });
  } catch (err) {
    console.error("User delete error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- ADMIN INVENTORY ----------
app.get("/admin/inventory", requireAdmin, async (req, res) => {
  try {
    const products = await Product.find({});
    const sales = await Sale.find({});
    
    const categories = await Category.find().sort({ order: 1 });

    res.render("admin-inventory", {
      products: products,
      sales: sales,
      categories: categories, 
    });
  } catch (err) {
    console.error("Inventory error:", err);
    res.status(500).send("Internal server error");
  }
});
// ----------- ADMIN CATEGORIES ----------
app.get("/admin/categories", requireAdmin, (req, res) => {
    res.render("admin-categories", { user: req.session.user, isGuest: false });
});

// ---------- PRODUCT CREATE (MULTIPLE IMAGES + VARIANTS) ----------
app.post("/product/create", requireAdmin, uploadMultiple, async (req, res) => {
  const { 
    newProductName, 
    newProductPrice, 
    newProductStock,
    colors,
    sizes,
    originalPrice,
    variantsData,
    category // 🔥 নতুন অংশ: ড্রপডাউন থেকে category ID নেওয়া
  } = req.body;

  try {
    let mainImage = '/uploads/default.jpg';
    let allImages = [];
    
    if (req.files && req.files.length > 0) {
      mainImage = req.files[0].path;
      allImages = req.files.map(file => file.path);
    }
    
    const colorArray = colors ? colors.split(',').map(c => c.trim()).filter(c => c) : [];
    const sizeArray = sizes ? sizes.split(',').map(s => s.trim()).filter(s => s) : [];

    // Per size+color stock grid sent from the admin form (JSON string).
    // Falls back to the single "Stock Quantity" field when no grid was built
    // (e.g. product has no colors/sizes at all).
    let variantArray = [];
    if (variantsData) {
      try {
        const parsed = JSON.parse(variantsData);
        if (Array.isArray(parsed)) {
          variantArray = parsed.map(v => ({
            color: String(v.color || '').trim(),
            size: String(v.size || '').trim(),
            stock: Math.max(0, parseInt(v.stock) || 0),
            price: Math.max(0, parseFloat(v.price) || 0),
            originalPrice: Math.max(0, parseFloat(v.originalPrice) || 0)
          }));
        }
      } catch (e) {
        console.error("variantsData parse error:", e);
      }
    }

    const computedTotal = totalStockFromVariants(variantArray);
    const stock = computedTotal !== null ? computedTotal : (parseInt(newProductStock) || 0);

    const newProduct = new Product({
      id: "PROD-" + Date.now(),
      name: newProductName,
      price: parseFloat(newProductPrice),
      originalPrice: originalPrice ? parseFloat(originalPrice) : null,
      stock: stock,
      stockStatus: computeStockStatus(stock),
      imagePath: mainImage,
      images: allImages,
      colors: colorArray,
      sizes: sizeArray,
      variants: variantArray,
      category: category || 'General' // 🔥 নতুন অংশ: category যুক্ত করা হয়েছে
    });

    await newProduct.save();
    broadcastRefresh({ action: "product_created", product: newProduct });
    res.redirect("/admin/inventory");
  } catch (err) {
    console.error("Product create error:", err);
    res.status(500).send("Inventory execution engine write database fault.");
  }
});

// ---------- PRODUCT UPDATE (MULTIPLE IMAGES + VARIANTS) ----------
app.post("/product/update", requireAdmin, uploadMultiple, async (req, res) => {
  const { 
    productId, 
    updateProductName, 
    updateProductPrice, 
    updateProductStock,
    updateColors,
    updateSizes,
    updateOriginalPrice,
    variantsData,
    updateCategory // 🔥 নতুন অংশ: এডিট ফর্ম থেকে category আপডেট নেওয়া
  } = req.body;

  try {
    let variantArray = [];
    if (variantsData) {
      try {
        const parsed = JSON.parse(variantsData);
        if (Array.isArray(parsed)) {
          variantArray = parsed.map(v => ({
            color: String(v.color || '').trim(),
            size: String(v.size || '').trim(),
            stock: Math.max(0, parseInt(v.stock) || 0),
            price: Math.max(0, parseFloat(v.price) || 0),
            originalPrice: Math.max(0, parseFloat(v.originalPrice) || 0)
          }));
        }
      } catch (e) {
        console.error("variantsData parse error:", e);
      }
    }

    const computedTotal = totalStockFromVariants(variantArray);
    const stock = computedTotal !== null ? computedTotal : (parseInt(updateProductStock) || 0);

    const updateFields = {
      name: updateProductName,
      price: parseFloat(updateProductPrice),
      originalPrice: updateOriginalPrice ? parseFloat(updateOriginalPrice) : null,
      stock: stock,
      stockStatus: computeStockStatus(stock),
      colors: updateColors ? updateColors.split(',').map(c => c.trim()).filter(c => c) : [],
      sizes: updateSizes ? updateSizes.split(',').map(s => s.trim()).filter(s => s) : [],
      variants: variantArray,
      category: updateCategory || 'General' // 🔥 নতুন অংশ: category আপডেট যুক্ত করা হয়েছে
    };

    if (req.files && req.files.length > 0) {
      updateFields.imagePath = req.files[0].path;
      updateFields.images = req.files.map(file => file.path);
    }

    const updatedProduct = await Product.findOneAndUpdate(
      { id: productId },
      updateFields,
      { new: true }
    );

    if (updatedProduct && req.session && req.session.cart) {
      req.session.cart = req.session.cart.map((item) => {
        if (item.id === productId) {
          return {
            ...item,
            name: updateProductName,
            price: parseFloat(updateProductPrice),
            imagePath: req.files && req.files.length > 0 ? req.files[0].path : item.imagePath,
          };
        }
        return item;
      });
      if (req.session.user) {
        await saveUserCart(req.session.user.id, req.session.cart);
      }
    }

    broadcastRefresh({ action: "product_updated", productId: productId });
    res.redirect("/admin/inventory");
  } catch (err) {
    console.error("Product update error:", err);
    res.status(500).send("Product update operations encountered errors.");
  }
});

// ---------- GET PRODUCT BY ID (for update modal) ----------
app.get("/api/product/:productId", requireAdmin, async (req, res) => {
    try {
        const product = await Product.findOne({ id: req.params.productId });
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }
        res.json({
            success: true,
            id: product.id,
            name: product.name,
            price: product.price,
            stock: product.stock,
            originalPrice: product.originalPrice,
            imagePath: product.imagePath,
            images: product.images || [],
            colors: product.colors || [],
            sizes: product.sizes || [],
            category: product.category || '' // 🔥 নতুন অংশ: ক্যাটাগরি ID রিসপন্সে পাঠানো হচ্ছে
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------- PRODUCT DELETE (অপরিবর্তিত) ----------
app.post("/product/delete", requireAdmin, async (req, res) => {
  const { productId } = req.body;

  try {
    const targetProduct = await Product.findOne({ id: productId });

    if (!targetProduct) {
      return res.send(`
        <script>
          alert("Error: Product record could not be located.");
          window.location.href = "/admin/inventory";
        </script>
      `);
    }

    const hasBeenSold = await Sale.exists({ 
      productName: { $regex: new RegExp(`^${targetProduct.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, "i") } 
    });

    if (hasBeenSold) {
      const safeProductName = targetProduct.name.replace(/'/g, "\\'");
      return res.send(`
        <script>
          alert("Access Denied:\\n\\nThe item '${safeProductName}' cannot be deleted because it is linked to active sales transaction logs.");
          window.location.href = "/admin/inventory";
        </script>
      `);
    }

    await Product.deleteOne({ id: productId });

    if (req.session && req.session.cart) {
      req.session.cart = req.session.cart.filter((item) => item.id !== productId);
      if (req.session.user) {
        await saveUserCart(req.session.user.id, req.session.cart);
      }
    }

    broadcastRefresh({ action: "product_deleted", productId: productId });
    res.redirect("/admin/inventory");
  } catch (err) {
    console.error("Product delete error:", err);
    res.redirect("/admin/inventory");
  }
});

// ---------- SALES LOG ----------
app.get("/sales", requireAdmin, async (req, res) => {
  try {
    const sales = await Sale.find({ 
      saleId: { $regex: /^SALE-/ }
    }).sort({ saleDate: -1 });
    
    const totalRevenue = sales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
    
    res.render("sales-log", { 
      sales: sales,
      totalRevenue: totalRevenue.toFixed(2)
    });
  } catch (err) {
    console.error("Sales log error:", err);
    res.status(500).send("Could not retrieve sales receipts logs ledger.");
  }
});



// ---------- ADMIN ORDERS ----------
app.get("/admin/orders", requireAdmin, async (req, res) => {
  try {
    const realOrders = await Sale.find({ 
      saleId: { $regex: /^SALE-/ },
      isActiveCart: { $ne: true }
    }).sort({ saleDate: -1 });
    
    const activeCarts = await Sale.find({ 
      saleId: { $regex: /^ACTIVE-/ },
      isActiveCart: true 
    }).sort({ saleDate: -1 });
    
    const pendingCount = realOrders.filter(o => (o.status || 'Pending') === 'Pending').length;
    const processingCount = realOrders.filter(o => o.status === 'Processing').length;
    const shippedCount = realOrders.filter(o => o.status === 'Shipped').length;
    const deliveredCount = realOrders.filter(o => o.status === 'Delivered').length;
    const cancelledCount = realOrders.filter(o => o.status === 'Cancelled').length;
    
    res.render("admin-orders", {
      user: req.session.user,
      orders: realOrders,
      activeCarts: activeCarts,
      pendingCount: pendingCount,
      processingCount: processingCount,
      shippedCount: shippedCount,
      deliveredCount: deliveredCount,
      cancelledCount: cancelledCount,
      totalOrders: realOrders.length
    });
  } catch (err) {
    console.error("Admin orders error:", err);
    res.status(500).send("Internal server error");
  }
});

app.post("/api/order/status", requireAdmin, async (req, res) => {
    const { saleId, status } = req.body;
    
    try {
        const updatedBy = req.session.user.username;
        const updatedByRole = req.session.user.role || 'user';
        
        const sale = await Sale.findOne({ saleId: saleId });
        if (!sale) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        
       
        const formattedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
        
        const oldStatus = sale.status || 'Pending';
        sale.status = formattedStatus;
        
        if (!sale.statusHistory) {
            sale.statusHistory = [];
        }
        sale.statusHistory.push({
            status: formattedStatus,
            updatedBy: updatedBy,
            updatedByRole: updatedByRole,
            timestamp: new Date(),
            fromStatus: oldStatus
        });
        
        sale.lastUpdatedBy = updatedBy;
        sale.lastUpdatedByRole = updatedByRole;
        sale.lastUpdatedAt = new Date();
        
        await sale.save(); 
        
        broadcastRefresh({ action: "order_updated", saleId: saleId, status: formattedStatus });
        
        res.json({ 
            success: true, 
            message: `Order status updated to ${formattedStatus}`,
            status: formattedStatus,
            updatedBy: updatedBy,
            updatedByRole: updatedByRole,
            timestamp: new Date()
        });
    } catch (err) {
        console.error("Order status update error:", err);
        
        res.status(500).json({ success: false, message: err.message || "Server error" });
    }
});

app.post("/api/order/send-courier", requireAdmin, async (req, res) => {
  // ১. এখানে 'phone' এবং 'address' যুক্ত করা হয়েছে, যা পপ-আপ ফর্ম থেকে আসবে
  const { saleId, codAmount, phone, address } = req.body;

  try {
    const sale = await Sale.findOne({ saleId: saleId });
    if (!sale) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (sale.courier && sale.courier.consignmentId) {
      return res.status(400).json({
        success: false,
        message: `This order was already sent to courier (Consignment ID: ${sale.courier.consignmentId})`
      });
    }

    const itemsDescription = (sale.products && sale.products.length > 0)
      ? sale.products.map(p => `${p.name}${p.size ? ' (Size: ' + p.size + ')' : ''}${p.color ? ' (Color: ' + p.color + ')' : ''} x${p.quantity}`).join(', ')
      : sale.productName;

    const cod = (codAmount !== undefined && codAmount !== null && codAmount !== '')
      ? parseFloat(codAmount) || 0
      : sale.totalAmount;

    const response = await steadfast.createOrder({
      invoice: sale.saleId,
      recipient_name: sale.customerName,
      // ২. এখানে পপ-আপ থেকে আসা এডিট করা phone এবং address বসানো হয়েছে
      recipient_phone: phone || sale.customerPhone || '01000000000',
      recipient_address: address || sale.customerAddress || 'Address not provided',
      cod_amount: cod,
      item_description: itemsDescription
    });

    const consignment = response.consignment || {};

    sale.courier = {
      provider: 'steadfast',
      consignmentId: consignment.consignment_id || '',
      trackingCode: consignment.tracking_code || '',
      status: consignment.status || 'in_review',
      sentAt: new Date()
    };
    await sale.save();

    broadcastRefresh({ action: "order_sent_to_courier", saleId: saleId });

    res.json({
      success: true,
      message: "Order sent to Steadfast successfully",
      consignmentId: sale.courier.consignmentId,
      trackingCode: sale.courier.trackingCode,
      trackingUrl: sale.courier.trackingCode ? steadfast.getTrackingUrl(sale.courier.trackingCode) : null
    });
  } catch (err) {
    console.error("Steadfast send error:", err.message);
    res.status(500).json({
      success: false,
      message: err.response?.message || err.message || "Failed to send order to Steadfast"
    });
  }
});

// Check (or refresh) delivery status for an order already sent to Steadfast
app.get("/api/order/courier-status/:saleId", requireAdmin, async (req, res) => {
  try {
    const sale = await Sale.findOne({ saleId: req.params.saleId });
    if (!sale || !sale.courier || !sale.courier.consignmentId) {
      return res.status(404).json({ success: false, message: "This order hasn't been sent to courier yet" });
    }

    const response = await steadfast.statusByConsignmentId(sale.courier.consignmentId);
    const newStatus = response.delivery_status || response.status || sale.courier.status;

    sale.courier.status = newStatus;
    await sale.save();

    res.json({ success: true, status: newStatus });
  } catch (err) {
    console.error("❌ Steadfast full error object:", err.response || err);
    res.status(500).json({
      success: false,
      message: err.response?.data?.message || err.message || "Failed to send order to Steadfast"
    });
  }
});




app.get("/admin/stock-report", requireAdmin, async (req, res) => {
  try {
    const products = await Product.find({ isActive: true }).sort({ name: 1 });
    
    const totalProducts = products.length;
    const totalStock = products.reduce((sum, p) => sum + (p.stock || 0), 0);
    const lowStockItems = products.filter(p => p.stock > 0 && p.stock <= 5);
    const outOfStockItems = products.filter(p => p.stock <= 0);
    const inStockItems = products.filter(p => p.stock > 5);
    
    res.render("admin-stock-report", {
      user: req.session.user,
      products: products,
      stats: {
        totalProducts: totalProducts,
        totalStock: totalStock,
        lowStockItems: lowStockItems.length,
        outOfStockItems: outOfStockItems.length,
        inStockItems: inStockItems.length
      },
      lowStockItems: lowStockItems,
      outOfStockItems: outOfStockItems
    });
  } catch (err) {
    console.error("Stock report error:", err);
    res.status(500).send("Internal server error");
  }
});

// ---------- CHECKOUT SUCCESS ----------
app.get("/checkout-success", requireAuth, (req, res) => {
  const saleId = req.session.lastSaleId || null;
  
  res.render("checkout-success", {
    customerName: req.session.lastCustomerName || 'Valued Customer',
    customerEmail: req.session.lastCustomerEmail || 'Not provided',
    customerPhone: req.session.lastCustomerPhone || 'Not provided',
    customerAddress: req.session.lastCustomerAddress || 'Walk-in Counter Sale',
    totalAmount: req.session.lastTotalAmount || '0.00',
    saleId: saleId,
    user: req.session.user
  });
});

// ---------- PACKING SLIP ----------
app.get("/packing-slip/:saleId", requireAuth, async (req, res) => {
  try {
    const { saleId } = req.params;
    const order = await Sale.findOne({ saleId: saleId });
    
    if (!order) {
      return res.status(404).send("Order not found");
    }
    
    const isAdmin = req.session.user.role === 'admin' || 
                    req.session.user.username.toLowerCase() === 'admin' ||
                    req.session.user.isSuperAdmin === true;
    const isCashier = req.session.user.role === 'authorized_cashier';
    const isOwner = order.customerEmail === req.session.user.profile?.email;
    
    if (!isAdmin && !isCashier && !isOwner) {
      return res.status(403).send("Access Denied");
    }
    
    let qrImage = null;
    try {
      const qrData = JSON.stringify({
        saleId: order.saleId,
        customerName: order.customerName,
        totalAmount: order.totalAmount,
        status: order.status || 'Pending',
        url: `http://localhost:${PORT}/scan-order/${order.saleId}`
      });
      
      qrImage = await QRCode.toDataURL(qrData, {
        width: 200,
        margin: 1,
        color: {
          dark: '#1a202c',
          light: '#ffffff'
        }
      });
    } catch (qrError) {
      console.error("QR Generation Error:", qrError);
    }
    
    const slipData = {
      saleId: order.saleId,
      customerName: order.customerName || 'Valued Customer',
      customerEmail: order.customerEmail || 'N/A',
      customerPhone: order.customerPhone || 'N/A',
      customerAddress: order.customerAddress || 'Walk-in Counter Sale',
      productName: order.productName || 'Product',
      price: order.price || 0,
      quantity: order.quantity || 1,
      totalAmount: order.totalAmount || 0,
      status: order.status || 'Pending',
      saleDate: order.saleDate || new Date(),
      orderDate: order.saleDate ? new Date(order.saleDate).toLocaleDateString('en-BD', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      }) : new Date().toLocaleDateString('en-BD'),
      orderTime: order.saleDate ? new Date(order.saleDate).toLocaleTimeString('en-BD', {
        hour: '2-digit',
        minute: '2-digit'
      }) : new Date().toLocaleTimeString('en-BD', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      products: order.products || []
    };
    
    res.render("packing-slip", {
      user: req.session.user,
      order: slipData,
      qrImage: qrImage,
      isAdmin: isAdmin || isCashier
    });
    
  } catch (error) {
    console.error("Packing Slip Error:", error);
    res.status(500).send("Error generating packing slip");
  }
});

// ---------- TRACK ORDER ----------
app.get("/track-order/:saleId", requireAuth, async (req, res) => {
  try {
    const { saleId } = req.params;
    const order = await Sale.findOne({ saleId: saleId });
    
    if (!order) {
      return res.status(404).send("Order not found");
    }
    
    const isSuperAdmin = req.session.user.username === 'superadmin' || 
                         req.session.user.profile?.isSuperAdmin === true;
    const isAdmin = req.session.user.role === 'admin' || 
                    req.session.user.username.toLowerCase() === 'admin';
    const isOwner = order.customerEmail === req.session.user.profile?.email || 
                    order.customerName?.toLowerCase() === req.session.user.username?.toLowerCase();
    
    if (!isSuperAdmin && !isAdmin && !isOwner) {
      return res.status(403).send("Access Denied: You can only track your own orders.");
    }
    
    const statusSteps = {
      'pending': { step: 1, label: 'Order Placed', icon: 'fa-clock', color: '#f39c12' },
      'processing': { step: 2, label: 'Processing', icon: 'fa-spinner', color: '#3182ce' },
      'shipped': { step: 3, label: 'Shipped', icon: 'fa-truck', color: '#27ae60' },
      'delivered': { step: 4, label: 'Delivered', icon: 'fa-check-circle', color: '#27ae60' },
      'cancelled': { step: 0, label: 'Cancelled', icon: 'fa-times-circle', color: '#e53e3e' }
    };
    
    const currentStatus = order.status || 'pending';
    const stepInfo = statusSteps[currentStatus.toLowerCase()] || statusSteps['pending'];
    
    res.render("track-order", {
      user: req.session.user,
      order: order,
      currentStatus: currentStatus,
      stepInfo: stepInfo,
      statusSteps: statusSteps,
      isAdmin: isAdmin || isSuperAdmin
    });
  } catch (err) {
    console.error("Track order error:", err);
    res.status(500).send("Internal server error");
  }
});

// ---------- ORDER QR ----------
app.get("/order/qr/:saleId", requireAuth, async (req, res) => {
  try {
    const { saleId } = req.params;
    const order = await Sale.findOne({ saleId: saleId });
    
    if (!order) {
      return res.status(404).send("Order not found");
    }
    
    const isSuperAdmin = req.session.user.username === 'superadmin' || 
                         req.session.user.profile?.isSuperAdmin === true;
    const isAdmin = req.session.user.role === 'admin' || 
                    req.session.user.username.toLowerCase() === 'admin';
    const isOwner = order.customerEmail === req.session.user.profile?.email || 
                    order.customerName?.toLowerCase() === req.session.user.username?.toLowerCase();
    
    if (!isSuperAdmin && !isAdmin && !isOwner) {
      return res.status(403).send("Access Denied");
    }
    
    const qrData = JSON.stringify({
      saleId: order.saleId,
      customerName: order.customerName,
      totalAmount: order.totalAmount,
      status: order.status || 'Pending',
      url: `http://localhost:${PORT}/scan-order/${order.saleId}`
    });
    
    const qrImage = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: {
        dark: '#1a202c',
        light: '#ffffff'
      }
    });
    
    res.render("order-qr", {
      user: req.session.user,
      order: order,
      qrImage: qrImage
    });
    
  } catch (error) {
    console.error("QR Code Error:", error);
    res.status(500).send("Error generating QR code");
  }
});

// ---------- SCAN ORDER ----------
app.get("/scan-order/:saleId", requireAuth, async (req, res) => {
  try {
    const { saleId } = req.params;
    const order = await Sale.findOne({ saleId: saleId });
    
    if (!order) {
      return res.status(404).send("Order not found");
    }
    
    const isSuperAdmin = req.session.user.username === 'superadmin' || 
                         req.session.user.profile?.isSuperAdmin === true;
    const isAdmin = req.session.user.role === 'admin' || 
                    req.session.user.username.toLowerCase() === 'admin';
    const isCashier = req.session.user.role === 'authorized_cashier';
    const isOwner = order.customerEmail === req.session.user.profile?.email || 
                    order.customerName?.toLowerCase() === req.session.user.username?.toLowerCase();
    
    if (!isSuperAdmin && !isAdmin && !isCashier && !isOwner) {
      return res.status(403).send("Access Denied");
    }
    
    const currentStatus = order.status || 'Pending';
    let possibleActions = [];
    
    if (isSuperAdmin || isAdmin) {
      if (currentStatus === 'Pending') possibleActions.push('processing');
      if (currentStatus === 'Processing') possibleActions.push('shipped');
      if (currentStatus === 'Shipped') possibleActions.push('delivered');
      if (currentStatus !== 'Delivered' && currentStatus !== 'Cancelled') {
        possibleActions.push('cancelled');
      }
    } else if (isCashier) {
      if (currentStatus === 'Pending') possibleActions.push('processing');
    }
    
    res.render("scan-order", {
      user: req.session.user,
      order: order,
      currentStatus: currentStatus,
      possibleActions: possibleActions,
      isAdmin: isSuperAdmin || isAdmin,
      isCashier: isCashier
    });
  } catch (err) {
    console.error("Scan order error:", err);
    res.status(500).send("Internal server error");
  }
});

app.post("/api/order/scan-update", requireAuth, async (req, res) => {
  const { saleId, status } = req.body;
  
  try {
    const user = req.session.user;
    const isSuperAdmin = user.username === 'superadmin' || user.profile?.isSuperAdmin === true;
    const isAdmin = user.role === 'admin' || user.username.toLowerCase() === 'admin';
    const isCashier = user.role === 'authorized_cashier';
    
    const sale = await Sale.findOne({ saleId: saleId });
    if (!sale) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    
    const currentStatus = sale.status || 'Pending';
    
    if (isCashier && status !== 'processing') {
      return res.status(403).json({ 
        success: false, 
        message: "Cashier can only update to 'Processing'" 
      });
    }
    
    if (!isSuperAdmin && !isAdmin && !isCashier) {
      return res.status(403).json({ 
        success: false, 
        message: "You don't have permission to update this order" 
      });
    }
    
    sale.status = status;
    
    if (!sale.statusHistory) {
      sale.statusHistory = [];
    }
    sale.statusHistory.push({
      status: status,
      updatedBy: user.username,
      updatedByRole: user.role || 'user',
      timestamp: new Date(),
      fromStatus: currentStatus,
      via: 'QR Scan'
    });
    
    sale.lastUpdatedBy = user.username;
    sale.lastUpdatedByRole = user.role || 'user';
    sale.lastUpdatedAt = new Date();
    
    await sale.save();
    
    broadcastRefresh({ 
      action: "order_updated", 
      saleId: saleId, 
      status: status,
      via: 'QR Scan'
    });
    
    res.json({ 
      success: true, 
      message: `Order updated to ${status} via QR Scan`,
      status: status
    });
  } catch (err) {
    console.error("Scan update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// WEBSOCKET

wss.on("connection", (socket, req) => {
  console.log("✅ New WebSocket client connected");
  
  const clientId = uuidv4();
  wsClients.set(clientId, socket);
  
  socket.send(JSON.stringify({ 
    type: "CONNECTED", 
    clientId: clientId,
    message: "Connected to BAGNEST WebSocket Server",
    timestamp: new Date().toISOString()
  }));
  
  const pingInterval = setInterval(() => {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({ type: "PING" }));
    }
  }, 30000);

  socket.on("message", (rawData) => {
    try {
      const data = JSON.parse(rawData);
      
      if (data.type === "PONG") {
        return;
      }
      
      if (data.type === "CHAT_MSG") {
        wss.clients.forEach((client) => {
          if (client.readyState === 1 && client !== socket) {
            client.send(
              JSON.stringify({
                type: "CHAT_MSG",
                sender: data.sender || "Anonymous",
                message: data.message,
                timestamp: new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              }),
            );
          }
        });
      }
    } catch (err) {
      console.error("WebSocket message error:", err.message);
    }
  });

  socket.on("close", () => {
    console.log("❌ WebSocket client disconnected:", clientId);
    clearInterval(pingInterval);
    wsClients.delete(clientId);
  });

  socket.on("error", (error) => {
    console.error("WebSocket error:", error.message);
    clearInterval(pingInterval);
    wsClients.delete(clientId);
  });
});



// SERVER START

server.listen(PORT, () =>
  console.log("BAGNEST online at http://localhost:" + PORT)
  );