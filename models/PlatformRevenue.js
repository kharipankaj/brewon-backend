const mongoose = require('mongoose');

const PlatformRevenueSchema = new mongoose.Schema({
  game_type: { 
    type: String, 
    enum: ['aviator', 'color_trading'], 
    required: true 
  },
  round_id: { 
    type: String, 
    required: true, 
    unique: true 
  },
  total_bets: { 
    type: mongoose.Schema.Types.Decimal128, 
    required: true 
  },
  total_payout: { 
    type: mongoose.Schema.Types.Decimal128, 
    required: true 
  },
  platform_profit: { 
    type: mongoose.Schema.Types.Decimal128, 
    required: true 
  },
  platform_percent: { 
    type: mongoose.Schema.Types.Decimal128, 
    required: true 
  },
  game_details: { 
    type: mongoose.Schema.Types.Mixed, 
    required: true 
  },
  created_at: { 
    type: Date, 
    default: Date.now 
  },
  date: { 
    type: Date, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['completed', 'cancelled'], 
    default: 'completed' 
  }
});

PlatformRevenueSchema.index({ game_type: 1, date: -1 });
PlatformRevenueSchema.index({ date: -1 });
PlatformRevenueSchema.index({ platform_profit: -1 });

module.exports = mongoose.model('PlatformRevenue', PlatformRevenueSchema);

