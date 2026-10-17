const mongoose = require('mongoose');

const paymentTransactionSchema = new mongoose.Schema({
    transactionId: { 
        type: String, 
        required: true, 
        unique: true 
    },
    orderId: { 
        type: String, 
        required: true 
    },
    orderType: { 
        type: String, 
        enum: ['custom_order', 'product_sale'], 
        default: 'custom_order' 
    },
    payerId: { 
        type: String, 
        required: true 
    },
    payerName: { 
        type: String, 
        default: '' 
    },
    payeeId: { 
        type: String, 
        required: true 
    },
    payeeName: { 
        type: String, 
        default: '' 
    },
    amount: { 
        type: Number, 
        required: true 
    },
    commissionPercent: { 
        type: Number, 
        default: 0 
    },
    commissionAmount: { 
        type: Number, 
        default: 0 
    },
    netAmount: { 
        type: Number, 
        required: true 
    },
    type: { 
        type: String, 
        enum: ['customer_escrow_deposit', 'seller_payout', 'refund'], 
        required: true 
    },
    paymentMethod: { 
        type: String, 
        enum: ['bkash', 'nagad', 'rocket', 'card', 'bank_transfer', 'system'], 
        default: 'bkash' 
    },
    status: { 
        type: String, 
        enum: ['pending', 'completed', 'failed', 'refunded'], 
        default: 'completed' 
    },
    gatewayDetails: {
        gatewayName: { type: String, default: 'MockGateway_PackBang' },
        accountNumber: { type: String, default: '' },
        bankName: { type: String, default: '' },
        reference: { type: String, default: '' }
    },
    notes: { 
        type: String, 
        default: '' 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('PaymentTransaction', paymentTransactionSchema);
