require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const PlatformRevenue = require('../models/PlatformRevenue');
const PlatformRevenueSummary = require('../models/PlatformRevenueSummary');

/**
 * REVENUE TRACKER - Complete implementation for Aviator + Color Trading
 * Integrates with existing game engines - FIXED connection timeout
 */

function generateRoundId(gameType, baseId = Date.now()) {
  const dateStr = new Date().toISOString().split('T')[0];
  const shortId = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${gameType.toUpperCase()}-${dateStr.replace(/-/g, '')}-${shortId}`;
}

async function saveAviatorRevenue({ 
  totalBets, 
  totalPayout, 
  crashPoint, 
  results = [],
  roundId = null 
}) {
  let profit = parseFloat((totalBets - totalPayout).toFixed(2));
  if (!Number.isFinite(profit) || Math.abs(profit) > 1e9) {
    console.warn(`⚠️ Clamping aviator profit ${profit} to 0`);
    profit = 0;
  }
  const percent = totalBets > 0 ? parseFloat(((profit / totalBets) * 100).toFixed(2)) : 0;
  
  const totalPlayers = results.length;
  const winners = results.filter(r => r.status === 'WIN').length;
  const losers = totalPlayers - winners;

  const docData = {
    game_type: 'aviator',
    round_id: roundId || generateRoundId('AVIATOR'),
    total_bets: totalBets,
    total_payout: totalPayout,
    platform_profit: profit,
    platform_percent: percent,
    game_details: {
      crashPoint: parseFloat(crashPoint.toFixed(2)),
      totalPlayers,
      winners,
      losers
    },
    date: new Date()
  };

  const revenue = new PlatformRevenue(docData);
  await revenue.save();
  
  await updateRevenueSummary(profit, 'aviator');
  
  console.log(`✈️ AVIATOR Revenue saved: ${docData.round_id} | ₹${profit} (${percent}%)`);
  return revenue;
}

async function saveColorRevenue({ 
  winningNumber, 
  winningColor, 
  winningSide, 
  platformProfit, 
  poolSummary,
  payouts = [],
  bets = [],
  roundId = null
}) {
  const totalBets = bets.reduce((sum, b) => sum + b.amount, 0);
  const totalPayout = payouts.reduce((sum, p) => sum + p.totalPayout, 0);
  let profit = parseFloat((totalBets - totalPayout).toFixed(2));
  if (!Number.isFinite(profit) || Math.abs(profit) > 1e9) {
    console.warn(`⚠️ Clamping color profit ${profit} to 0`);
    profit = 0;
  }
  const percent = totalBets > 0 ? parseFloat(((profit / totalBets) * 100).toFixed(2)) : 0;
  
  const totalPlayers = bets.length;

  const docData = {
    game_type: 'color_trading',
    round_id: roundId || generateRoundId('COLOR'),
    total_bets: totalBets,
    total_payout: totalPayout,
    platform_profit: profit,
    platform_percent: percent,
    game_details: {
      winningNumber,
      winningColor,
      winningSide,
      totalPlayers,
      numberPoolProfit: poolSummary?.numberPool?.platformCut || 0,
      colorPoolProfit: poolSummary?.colorPool?.platformCut || 0,
      sidePoolProfit: poolSummary?.sidePool?.platformCut || 0
    },
    date: new Date()
  };

  const revenue = new PlatformRevenue(docData);
  await revenue.save();
  
  await updateRevenueSummary(profit, 'color_trading');
  
  console.log(`🎨 COLOR Revenue saved: ${docData.round_id} | ₹${profit} (${percent}%)`);
  return revenue;
}

async function updateRevenueSummary(profit, gameType) {
  if (!Number.isFinite(profit) || Math.abs(profit) > 1e9) {
    console.warn(`⚠️ Clamping invalid profit ${profit} for ${gameType}`);
    profit = 0;
  }

  const gameKey = gameType === 'aviator' ? 'aviator' : 'color_trading';
  const roundsKey = `total_rounds_${gameType}`;

  await PlatformRevenueSummary.findOneAndUpdate(
    { _id: 'global-summary' },
    {
      $inc: {
        [`total_revenue_${gameKey}`]: profit,
        total_revenue_all_time: profit,
        [roundsKey]: 1
      },
      $max: {
        best_round_profit: profit
      },
      $setOnInsert: {
        last_updated: new Date()
      }
    },
    { upsert: true, returnDocument: 'after' }
  );
  
  console.log(`💰 Summary updated (${gameType}): +₹${profit.toFixed(2)}`);
}

async function getTransactions(filters = {}) {
  const query = { status: 'completed' };
  
  if (filters.game_type && filters.game_type !== 'all') {
    query.game_type = filters.game_type;
  }
  if (filters.date_from) {
    query.date = { $gte: new Date(filters.date_from) };
  }
  if (filters.date_to) {
    query.date.$lte = new Date(filters.date_to + 'T23:59:59Z');
  }
  if (filters.min_profit) {
    query.platform_profit = { $gte: parseFloat(filters.min_profit) };
  }
  if (filters.max_profit) {
    query.platform_profit.$lte = parseFloat(filters.max_profit);
  }

  const transactions = await PlatformRevenue.find(query)
    .sort({ created_at: -1 })
    .limit(100);

  const totalProfit = transactions.reduce((sum, t) => sum + parseFloat(t.platform_profit), 0);
  const avgProfit = transactions.length ? totalProfit / transactions.length : 0;

  return {
    transactions,
    summary: {
      total_transactions: transactions.length,
      total_profit: parseFloat(totalProfit.toFixed(2)),
      average_profit: parseFloat(avgProfit.toFixed(2))
    }
  };
}

async function getDashboardStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const matchers = {
    today: { date: { $gte: today } },
    this_week: { date: { $gte: weekStart } },
    this_month: { date: { $gte: monthStart } }
  };

  const summary = await PlatformRevenueSummary.getOrCreateSummary();
  
  const periods = ['today', 'this_week', 'this_month'];
  const stats = { all_time: {} };

  for (const period of periods) {
    const agg = await PlatformRevenue.aggregate([
      { $match: matchers[period] },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$platform_profit' },
          rounds: { $sum: 1 },
          aviator_revenue: {
            $sum: { $cond: [{ $eq: ['$game_type', 'aviator'] }, '$platform_profit', 0] }
          },
          color_revenue: {
            $sum: { $cond: [{ $eq: ['$game_type', 'color_trading'] }, '$platform_profit', 0] }
          }
        }
      }
    ]);
    
    stats[period] = agg[0] || { revenue: 0, rounds: 0, aviator_revenue: 0, color_revenue: 0 };
  }

  const allTimeAgg = await PlatformRevenue.aggregate([
    {
      $group: {
        _id: null,
        total_revenue: { $sum: '$platform_profit' },
        aviator_revenue: {
          $sum: { $cond: [{ $eq: ['$game_type', 'aviator'] }, '$platform_profit', 0] }
        },
        color_revenue: {
          $sum: { $cond: [{ $eq: ['$game_type', 'color_trading'] }, '$platform_profit', 0] }
        },
        total_rounds: { $sum: 1 }
      }
    }
  ]);
  
  const allTime = allTimeAgg[0] || {
    total_revenue: 0,
    aviator_revenue: 0,
    color_revenue: 0,
    total_rounds: 0
  };

  const bestSummary = await PlatformRevenueSummary.getOrCreateSummary();
  
  stats.all_time = {
    total_revenue: allTime.total_revenue,
    aviator_revenue: allTime.aviator_revenue,
    color_revenue: allTime.color_revenue,
    total_rounds: allTime.total_rounds,
    best_round: {
      profit: bestSummary.best_round_profit,
      round_id: bestSummary.best_round_id,
      game_type: allTime.total_revenue === 0 ? null : 
        allTime.aviator_revenue > allTime.color_revenue ? 'aviator' : 'color_trading'
    }
  };

  return stats;
}

module.exports = {
  saveAviatorRevenue,
  saveColorRevenue,
  updateRevenueSummary,
  getTransactions,
  getDashboardStats,
  generateRoundId
};

async function runTests() {
  console.log('🧪 REVENUE TRACKER TESTS');
  
  let connected = false;
  try {
    const MONGO_URI = process.env.MONGO_URL || 'mongodb://localhost:27017/brewon';
    console.log('📡 Connecting to MongoDB...', MONGO_URI.replace(/\/\/[^@]*@/, '//****:****@'));
    
    await mongoose.connect(MONGO_URI);
    
    while (mongoose.connection.readyState !== 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    connected = true;
    console.log('✅ MongoDB Connected!');
    
    const aviatorResult = {
      totalBets: 5000,
      totalPayout: 2000,
      crashPoint: 1.5,
      results: [
        { user: 'A', status: 'WIN', payout: 750 },
        { user: 'B', status: 'LOSE', payout: 0 },
        { user: 'C', status: 'WIN', payout: 1250 }
      ]
    };
    await saveAviatorRevenue(aviatorResult);
    console.log('✅ Test 1: Aviator revenue saved');
    
    const colorResult = {
      winningNumber: 6,
      winningColor: 'Red',
      winningSide: 'Big',
      platformProfit: { total: 90 },
      poolSummary: {
        numberPool: { platformCut: 30 },
        colorPool: { platformCut: 40 },
        sidePool: { platformCut: 20 }
      },
      payouts: [{ totalPayout: 810 }, { totalPayout: 0 }],
      bets: [{ amount: 100 }, { amount: 200 }, { amount: 600 }]
    };
    await saveColorRevenue(colorResult);
    console.log('✅ Test 2: Color revenue saved');
    
    const trans = await getTransactions();
    console.log(`✅ Test 3: ${trans.summary.total_transactions} transactions, ₹${trans.summary.total_profit.toFixed(2)}`);
    
    const stats = await getDashboardStats();
    console.log('✅ Test 4: Dashboard loaded');
    console.log('All-time:', stats.all_time.total_revenue);
    
    const summary = await PlatformRevenueSummary.getOrCreateSummary();
    console.log('✅ Test 5: Summary exists, best:', summary.best_round_profit);
    
    console.log('🎉 ALL TESTS PASSED!');
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  } finally {
    if (connected && mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('🔌 DB connection closed.');
    }
  }
}

if (require.main === module) {
  runTests().catch(console.error);
}
