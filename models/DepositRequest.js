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
    min: 50
  },
  upiId: {
    type: String,
    required: true
  },
  utrNo: {
    type: String,
    required: true
  },
  screenshotUrl: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  approvedAmount: {
    type: Number,
    default: null,
    min: 0
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  description: String
}, {
  timestamps: true
});

depositRequestSchema.index({ userId: 1, createdAt: -1 });
depositRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('DepositRequest', depositRequestSchema);
