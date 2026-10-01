const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
    name: { type: String, required: true }, 
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    order: { type: Number, default: 0 },
     image: { type: String, default: '' }
});

module.exports = mongoose.model("Category", CategorySchema); 