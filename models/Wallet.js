const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    depositBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    winningBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    bonusBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastReferenceId: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
    toObject: {
      virtuals: true,
    },
  }
);

walletSchema.virtual('totalBalance').get(function totalBalance() {
  return Number(this.depositBalance || 0) + Number(this.winningBalance || 0) + Number(this.bonusBalance || 0);
});

module.exports = mongoose.model('Wallet', walletSchema);
