const mongoose = require('mongoose');

const SummarySchema = new mongoose.Schema({
  _id: { type: String, default: 'global-summary' },
  
  total_revenue_all_time: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: 0 
  },
  total_revenue_aviator: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: 0 
  },
  total_revenue_color_trading: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: 0 
  },
  
  total_rounds_all: { type: Number, default: 0 },
  total_rounds_aviator: { type: Number, default: 0 },
  total_rounds_color_trading: { type: Number, default: 0 },
  
  best_round_profit: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: 0 
  },
  best_round_id: { 
    type: String, 
    default: null 
  },
  
  last_updated: { 
    type: Date, 
    default: Date.now 
  }
});

SummarySchema.index({ total_rounds_aviator: 1 });
SummarySchema.index({ total_rounds_color_trading: 1 });
SummarySchema.index({ total_rounds_all: 1 });
SummarySchema.index({ last_updated: -1 });

const PlatformRevenueSummary = mongoose.model('PlatformRevenueSummary', SummarySchema);

// Ensure single summary doc exists
PlatformRevenueSummary.getOrCreateSummary = async function() {
  let summary = await this.findOne({ _id: 'global-summary' });
  if (!summary) {
    summary = new this({ _id: 'global-summary' });
    await summary.save();
  }
  return summary;
};

module.exports = PlatformRevenueSummary;

