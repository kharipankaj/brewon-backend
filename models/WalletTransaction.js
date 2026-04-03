const mongoose = require('mongoose');

const transactionStatus = [
  'pending',
  'approved',
  'rejected',
  'paid',
  'completed',
  'failed',
];

const transactionType = [
  'deposit',
  'withdraw',
  'game_entry',
  'game_win',
  'welcome_bonus',
];

const bucketType = ['deposit_balance', 'winning_balance', 'bonus_balance', 'mixed'];

const walletTransactionSchema = new mongoose.Schema(
  {
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: transactionType,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: transactionStatus,
      default: 'completed',
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    requestedAmount: {
      type: Number,
      default: null,
    },
    bucket: {
      type: String,
      enum: bucketType,
      required: true,
    },
    referenceId: {
      type: String,
      trim: true,
      default: null,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    upiId: {
      type: String,
      trim: true,
      default: null,
    },
    utrNo: {
      type: String,
      trim: true,
      default: null,
    },
    screenshotUrl: {
      type: String,
      trim: true,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    balanceSnapshot: {
      before: {
        depositBalance: { type: Number, default: 0 },
        winningBalance: { type: Number, default: 0 },
        bonusBalance: { type: Number, default: 0 },
        totalBalance: { type: Number, default: 0 },
      },
      after: {
        depositBalance: { type: Number, default: 0 },
        winningBalance: { type: Number, default: 0 },
        bonusBalance: { type: Number, default: 0 },
        totalBalance: { type: Number, default: 0 },
      },
    },
  },
  {
    timestamps: true,
  }
);

walletTransactionSchema.index(
  { referenceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      referenceId: { $type: 'string' },
    },
  }
);
walletTransactionSchema.index({ type: 1, status: 1, createdAt: -1 });
walletTransactionSchema.index({ userId: 1, type: 1, createdAt: -1 });
walletTransactionSchema.index({ 'metadata.gameKey': 1, createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
