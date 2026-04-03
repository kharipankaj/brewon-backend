const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    validate: {
      validator: function(value) {
        // Allow 0 for pending transactions (will be set on approval)
        if (this.status === 'pending' && value === 0) {
          return true;
        }
        // Otherwise, minimum is 50 for actual transactions
        return value >= 50 || value === 0;
      },
      message: 'Transaction amount must be at least 50 or 0 for pending requests'
    }
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
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['deposit', 'withdraw', 'win', 'loss', 'referral'],
    index: true
  },
  description: String
  ,
  fraudFlags: [{
    code: {
      type: String,
      trim: true
    },
    message: {
      type: String,
      trim: true
    }
  }],
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ utrNo: 1 }); // For search
transactionSchema.index({ userId: 1, status: 1, type: 1 }); // Common filter combo
transactionSchema.index({ createdAt: -1 }); // For sorting

module.exports = mongoose.model('Transaction', transactionSchema);
