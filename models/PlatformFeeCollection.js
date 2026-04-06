const mongoose = require('mongoose');

const PlatformFeeCollectionSchema = new mongoose.Schema({
  gameKey: {
    type: String,
    required: true,
    index: true
  },
  gameLabel: {
    type: String,
    required: true
  },
  platformFee: {
    type: Number,
    required: true,
    min: 0
  },
  roundId: {
    type: String,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

PlatformFeeCollectionSchema.index({ gameKey: 1, createdAt: -1 });

module.exports = mongoose.model('PlatformFeeCollection', PlatformFeeCollectionSchema);
