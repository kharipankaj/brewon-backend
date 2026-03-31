const mongoose = require('mongoose');

const mongoose = require('mongoose');

const depositRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 100
  },
  upiId: {
    type: String,
    required: true
  },
  utrNo: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  description: String
}, {
  timestamps: true
});

depositRequestSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('DepositRequest', depositRequestSchema);
