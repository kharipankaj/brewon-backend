/**
 * AVIATOR GAME ENGINE - EXACT SPEC w/ FIXES
 * - Null cashoutAt = LOSE
 * - Safety step 0.01 precision
 * - Skip null in expectedPayout
 * - NaN profit handled
 */

const TEST_BETS_1 = [
  {user: "A", amount: 5000, cashoutAt: 1.5},
  {user: "B", amount: 3000, cashoutAt: 2.0},
  {user: "C", amount: 2000, cashoutAt: 3.0}
];

const TEST_BETS_2 = [
  {user: "A", amount: 100, cashoutAt: 1.3},
  {user: "B", amount: 100, cashoutAt: 1.8},
  {user: "C", amount: 100, cashoutAt: 2.5}
];

const FIXED_BETS_SIM = [
  {user: "A", amount: 2000, cashoutAt: 1.5},
  {user: "B", amount: 1000, cashoutAt: 2.5},
  {user: "C", amount: 1500, cashoutAt: 1.8},
  {user: "D", amount: 500, cashoutAt: 4.0}
];

function getCrashPoint(bets = []) {
  const totalBets = bets.reduce((sum, b) => sum + b.amount, 0);

  const rand = Math.random() * 100;
  let rangeMin, rangeMax, frequency;
  if (rand < 60) {
    rangeMin = 1.00; rangeMax = 2.00; frequency = "60% common";
  } else if (rand < 80) {
    rangeMin = 2.00; rangeMax = 3.00; frequency = "20%";
  } else if (rand < 92) {
    rangeMin = 3.00; rangeMax = 5.00; frequency = "12%";
  } else {
    rangeMin = 5.00; rangeMax = 10.00; frequency = "8% rare";
  }

  const LOW_BETS = 100, HIGH_BETS = 10000;
  let position = totalBets <= LOW_BETS ? 0 : totalBets >= HIGH_BETS ? 1 : (totalBets - LOW_BETS) / (HIGH_BETS - LOW_BETS);
  position = Math.max(0, Math.min(1, position));

  let crashPoint = parseFloat((rangeMax - (position * (rangeMax - rangeMin))).toFixed(2));
  crashPoint = Math.max(1.00, Math.min(10.00, crashPoint));

  const initialCrash = crashPoint;
  crashPoint = safetyCheck(crashPoint, bets, totalBets);

  const safetyTriggered = Math.abs(initialCrash - crashPoint) > 0.01;

  return {
    raw: crashPoint,
    distribution: { randomValue: Math.floor(rand), selectedRange: `${rangeMin}x-${rangeMax}x`, frequency },
    totalBets,
    safetyTriggered
  };
}

function safetyCheck(crashPoint, bets, totalBets) {
  const maxAllowedPayout = totalBets * 0.90;
  let safePoint = parseFloat(crashPoint.toFixed(2));

  while (safePoint > 1.00) {
    const expected = calculateExpectedPayout(safePoint, bets);
    if (expected <= maxAllowedPayout) break;
    safePoint -= 0.01;
  }
  return Math.max(1.00, parseFloat(safePoint.toFixed(2)));
}

function calculateExpectedPayout(crashPoint, bets) {
  return bets.reduce((total, bet) => {
    if (bet.cashoutAt != null && bet.cashoutAt <= crashPoint) {
      return total + parseFloat((bet.amount * bet.cashoutAt).toFixed(2));
    }
    return total;
  }, 0);
}

function processRound(bets, round = 1) {
  const crashData = getCrashPoint(bets);
  const crashPoint = crashData.raw;
  const totalBetsAmount = crashData.totalBets;

  const results = bets.map(bet => {
    const isWin = bet.cashoutAt != null && bet.cashoutAt <= crashPoint;
    const status = isWin ? 'WIN' : 'LOSE';
    const payout = isWin ? parseFloat((bet.amount * bet.cashoutAt).toFixed(2)) : 0;
    const profit = parseFloat((payout - bet.amount).toFixed(2));

    return {
      user: bet.user,
      invested: parseFloat(bet.amount.toFixed(2)),
      cashoutAt: bet.cashoutAt,
      status,
      payout,
      profit
    };
  });

  const totalPayout = results.reduce((sum, r) => sum + r.payout, 0);
  const platformProfit = totalBetsAmount - totalPayout;
  const platformPercent = totalBetsAmount === 0 ? '0%' : parseFloat(((platformProfit / totalBetsAmount) * 100).toFixed(2)) + '%';

  return {
    round,
    totalBets: parseFloat(totalBetsAmount.toFixed(2)),
    crashPoint,
    safetyCheckTriggered: crashData.safetyTriggered,
    distribution: crashData.distribution,
    results,
    summary: {
      totalBets: parseFloat(totalBetsAmount.toFixed(2)),
      totalPayout: parseFloat(totalPayout.toFixed(2)),
      platformProfit: parseFloat(platformProfit.toFixed(2)),
      platformPercent,
      safetyTriggered: crashData.safetyTriggered
    }
  };
}

function simulateRounds(bets, numRounds = 10) {
  const rounds = [];
  let totalPlatformProfit = 0;

  for (let i = 1; i <= numRounds; i++) {
    const roundResult = processRound([...bets], i);  // copy to avoid mut
    rounds.push(roundResult);
    totalPlatformProfit += roundResult.summary.platformProfit;

    console.log(`\\nRound ${i}:`);
    console.log(JSON.stringify(roundResult, null, 2));
  }

  const lowCrashes = rounds.filter(r => r.crashPoint <= 2.00).length;
  console.log(`\\n📊 Sim Summary (${numRounds} rounds): - 1x-2x: ${lowCrashes}/${numRounds} (${((lowCrashes/numRounds)*100).toFixed(0)}%) - Total profit: ₹${parseFloat(totalPlatformProfit.toFixed(2))}`);

  return { rounds, stats: { lowCrashesPercentage: (lowCrashes/numRounds)*100, totalPlatformProfit } };
}

function verifyPlatformSafety(roundResults) {
  let allSafe = true;
  const issues = [];

  roundResults.forEach(r => {
    const profitPct = r.summary.platformProfit / r.summary.totalBets;
    if (isNaN(profitPct)) return;
    if (profitPct < 0.10) {
      issues.push(`Round ${r.round}: ${profitPct.toFixed(4)} < 0.10`);
      allSafe = false;
    }
  });

  console.log(allSafe ? '✅ VERIFIED: Platform always profits >=10%!' : `❌ Issues: ${issues.length}`);
  issues.forEach(i => console.log(' ' + i));

  return { safe: allSafe, issues };
}

function runTests() {
  console.log('🛩️ AVIATOR TESTS FIXED\\n');

  const r1 = processRound(TEST_BETS_1, 1);
  console.log('Test 1 High ₹10k:'); console.log(JSON.stringify(r1, null, 2));

  const r2 = processRound(TEST_BETS_2, 2);
  console.log('\\nTest 2 Low ₹300:'); console.log(JSON.stringify(r2, null, 2));

  const r3 = processRound(FIXED_BETS_SIM, 3);
  console.log('\\nTest 3 Medium ₹5k:'); console.log(JSON.stringify(r3, null, 2));

  const r4 = processRound([{user:"A", amount:200, cashoutAt:3.0},{user:"B", amount:300, cashoutAt:6.0},{user:"C", amount:500, cashoutAt:2.0}], 4);
  console.log('\\nTest 4 Rare:'); console.log(JSON.stringify(r4, null, 2));

  console.log('\\nTest 5 10-round sim:');
  const sim = simulateRounds(FIXED_BETS_SIM, 10);

  console.log('\\nSafety:');
  verifyPlatformSafety([r1,r2,r3,r4,...sim.rounds]);

  // Edge
  console.log('\\nEdge: No bets'); console.log(processRound([]));
  console.log('All early'); console.log(processRound([{user:'X', amount:100, cashoutAt:1.01}]));
  console.log('No cashout'); console.log(processRound([{user:'X', amount:100, cashoutAt:null}]));
}

if (require.main === module) runTests();

module.exports = { getCrashPoint, processRound, simulateRounds, verifyPlatformSafety, runTests };

