const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema({
    percent: { 
        type: Number, 
        default: 10,
        min: 0,
        max: 100
    },
    updatedBy: { 
        type: String, 
        default: 'Admin' 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('Commission', commissionSchema);
