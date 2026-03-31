const mongoose = require('mongoose');
const PlatformRevenue = require('../models/PlatformRevenue');
const PlatformRevenueSummary = require('../models/PlatformRevenueSummary');

/**
 * MIGRATION: Fix corrupted PlatformRevenueSummary from JS float precision loss
 * Recomputes all totals from accurate PlatformRevenue.platform_profit (Decimal128)
 */

async function runMigration() {
  try {
    // Connect if needed (assume running from server context)
    console.log('🔄 Starting Revenue Summary Migration...');

    // 1. Get current summary (backup values)
    const summary = await PlatformRevenueSummary.getOrCreateSummary();
    const oldAllTime = summary.total_revenue_all_time.toString();
    const oldAviator = summary.total_revenue_aviator.toString();
    const oldColor = summary.total_revenue_color_trading.toString();
    const oldBest = summary.best_round_profit.toString();
    
    console.log('📊 OLD VALUES:');
    console.log(`   All-time: ${oldAllTime}`);
    console.log(`   Aviator:  ${oldAviator}`);
    console.log(`   Color:    ${oldColor}`);
    console.log(`   Best:     ${oldBest}`);

    // 2. Compute accurate totals via aggregation (preserves Decimal128 precision)
    const [allAgg, aviatorAgg, colorAgg, bestAgg] = await Promise.all([
      // Total all revenue
      PlatformRevenue.aggregate([
        { $group: { _id: null, totalProfit: { $sum: '$platform_profit' } } }
      ]),
      // Aviator only
      PlatformRevenue.aggregate([
        { $match: { game_type: 'aviator' } },
        { $group: { _id: null, totalProfit: { $sum: '$platform_profit' }, count: { $sum: 1 } } }
      ]),
      // Color only
      PlatformRevenue.aggregate([
        { $match: { game_type: 'color_trading' } },
        { $group: { _id: null, totalProfit: { $sum: '$platform_profit' }, count: { $sum: 1 } } }
      ]),
      // Best round (max profit)
      PlatformRevenue.aggregate([
        { $group: { _id: null, bestProfit: { $max: '$platform_profit' } } },
        { $lookup: {
            from: 'platformrevenues',
            let: { bestProfit: '$bestProfit' },
            pipeline: [{ $match: { $expr: { $eq: ['$platform_profit', '$$bestProfit'] } } }],
            as: 'bestRound'
          }
        },
        { $project: { bestRoundId: { $arrayElemAt: ['$bestRound.round_id', 0] } } }
      ])
    ]);

    const newAllTime = allAgg[0]?.totalProfit || 0;
    const newAviator = aviatorAgg[0]?.totalProfit || 0;
    const newColor = colorAgg[0]?.totalProfit || 0;
    const newRoundsAviator = aviatorAgg[0]?.count || 0;
    const newRoundsColor = colorAgg[0]?.count || 0;
    const newBest = bestAgg[0]?.bestProfit || 0;
    const newBestId = bestAgg[0]?.bestRoundId || null;

    // 3. Atomic update
    const updateResult = await PlatformRevenueSummary.findOneAndUpdate(
      { _id: 'global-summary' },
      {
        $set: {
          total_revenue_all_time: newAllTime,
          total_revenue_aviator: newAviator,
          total_revenue_color_trading: newColor,
          total_rounds_aviator: newRoundsAviator,
          total_rounds_color_trading: newRoundsColor,
          total_rounds_all: newRoundsAviator + newRoundsColor,
          best_round_profit: newBest,
          best_round_id: newBestId,
          last_updated: new Date()
        }
      },
      { new: true, upsert: true }
    );

    console.log('\n✅ NEW VALUES:');
    console.log(`   All-time: ${updateResult.total_revenue_all_time}`);
    console.log(`   Aviator:  ${updateResult.total_revenue_aviator}`);
    console.log(`   Color:    ${updateResult.total_revenue_color_trading}`);
    console.log(`   Best:     ${updateResult.best_round_profit}`);
    console.log(`\n✨ Migration COMPLETE. Summary corrected via aggregation.`);
    
  } catch (error) {
    console.error('❌ Migration FAILED:', error);
  }
}

if (require.main === module) {
  // Auto-connect for standalone run (update connection string if needed)
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/brewon')
    .then(() => {
      console.log('📡 Connected to MongoDB');
      return runMigration();
    })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Connection failed:', err);
      process.exit(1);
    });
}

module.exports = { runMigration };

