/**
 * Brewon Color Trading Game Engine - EXACT SPEC IMPLEMENTATION
 * Standalone determineRoundResult(bets) + 3 test cases
 */

const crypto = require('crypto'); // for random tiebreaker

// ─── EXACT Task Mappings ──────────────────────────────────────
const NUMBER_TO_COLOR = {
  0: 'Violet', 1: 'Green', 2: 'Red', 3: 'Green', 4: 'Red',
  5: 'Violet', 6: 'Red',   7: 'Green', 8: 'Red',   9: 'Green'
};

const NUMBER_TO_SIDE = {
  0: 'Small', 1: 'Small', 2: 'Small', 3: 'Small', 4: 'Small',
  5: 'Big',   6: 'Big',   7: 'Big',   8: 'Big',   9: 'Big'
};

// ─── Main Function ────────────────────────────────────────────
function determineRoundResult(bets) {
  if (!Array.isArray(bets)) {
    return {
      winningNumber: 0,
      winningColor: NUMBER_TO_COLOR[0],
      winningSide: NUMBER_TO_SIDE[0],
      poolSummary: { numberPool: {total:0,platformCut:0}, colorPool: {total:0,platformCut:0}, sidePool: {total:0,platformCut:0} },
      platformProfit: {total: 0},
      payouts: []
    };
  }
  if (bets.length === 0) {
    return {
      winningNumber: 0,
      winningColor: NUMBER_TO_COLOR[0],
      winningSide: NUMBER_TO_SIDE[0],
      poolSummary: { numberPool: {total:0,platformCut:0}, colorPool: {total:0,platformCut:0}, sidePool: {total:0,platformCut:0} },
      platformProfit: {total: 0},
      payouts: []
    };
  }


  // Step 1: Aggregate total bets per number (0-9), count unique bettors
  const numberTotals = Array(10).fill(0).map(() => ({ amount: 0, bettors: new Set() }));
  
  // Track bets by color and side for winners
  const colorBets = { Red: [], Green: [], Violet: [] };
  const sideBets = { Big: [], Small: [] };
  
  // Per-user tracking
  const userContributions = new Map(); // user → {totalAmount, number?, color?, side?}

  bets.forEach(bet => {
    const { user, number, color, side, totalAmount } = bet;
    if (typeof totalAmount !== 'number' || totalAmount <= 0) return;

    // Track user bet types for winners check
    if (!userContributions.has(user)) {
      userContributions.set(user, { totalAmount, number: null, color: null, side: null });
    } else {
      const u = userContributions.get(user);
      u.totalAmount += totalAmount;
    }
    if (number !== null) userContributions.get(user).number = number;
    if (color !== null) userContributions.get(user).color = color;
    if (side !== null) userContributions.get(user).side = side;

    // Pool split logic
    let numPool = 0, colPool = 0, sidPool = 0;
    const types = [];
    if (number !== null) types.push('number');
    if (color !== null) types.push('color');
    if (side !== null) types.push('side');

    if (types.length === 1) {
      if (types[0] === 'number') numPool = totalAmount;
      else if (types[0] === 'color') colPool = totalAmount;
      else sidPool = totalAmount;
    } else {
      // Multiple: 33.33% each
      const split = totalAmount / 3;
      numPool = number !== null ? split : 0;
      colPool = color !== null ? split : 0;
      sidPool = side !== null ? split : 0;
    }

    // Number pool (always contributes if bet)
    if (numPool > 0 && number !== null) {
      numberTotals[number].amount += numPool;
      numberTotals[number].bettors.add(user);
    }

    // Color pool
    if (colPool > 0 && color !== null) {
      colorBets[color].push({ user, amount: colPool });
    }

    // Side pool
    if (sidPool > 0 && side !== null) {
      sideBets[side].push({ user, amount: sidPool });
    }
  });

  // Step 2: Update bettors count
  for (let i = 0; i < 10; i++) {
    numberTotals[i].bettors = numberTotals[i].bettors.size;
  }

  // Step 3: Select winningNumber
  // Priority: 0-amount nums first, then normal
  let candidates = [];
  
  // Zero-amount first (highest priority)
  for (let i = 0; i < 10; i++) {
    if (numberTotals[i].amount === 0) {
      candidates.push({ num: i, amount: 0, bettors: numberTotals[i].bettors, idx: i });
    }
  }
  
  // If no zeros, all others
  if (candidates.length === 0) {
    for (let i = 0; i < 10; i++) {
      if (numberTotals[i].amount > 0) {
        candidates.push({ num: i, amount: numberTotals[i].amount, bettors: numberTotals[i].bettors, idx: i });
      }
    }
  }
  
  // Sort: amount ASC, bettors ASC, idx as tiebreaker (random-like via original order)
  candidates.sort((a, b) => {
    if (a.amount !== b.amount) return a.amount - b.amount;
    if (a.bettors !== b.bettors) return a.bettors - b.bettors;
    return a.idx - b.idx;
  });
  
  const winningNumber = candidates[0]?.num;
  if (winningNumber === undefined) {
    throw new Error('No valid numbers found');
  }
  
  const winningColor = NUMBER_TO_COLOR[winningNumber];
  const winningSide = NUMBER_TO_SIDE[winningNumber];

  // Step 4: Calculate pools
  let numberPoolTotal = 0, colorPoolTotal = 0, sidePoolTotal = 0;
  for (let i = 0; i < 10; i++) {
    if (i === winningNumber) numberPoolTotal = numberTotals[i].amount;
  }
  // Sum from tracked bets
  colorPoolTotal = Object.values(colorBets).reduce((sum, bets) => sum + bets.reduce((s, b) => s + b.amount, 0), 0);
  sidePoolTotal = Object.values(sideBets).reduce((sum, bets) => sum + bets.reduce((s, b) => s + b.amount, 0), 0);

  // Pools summary
  const processPool = (total, winners) => {
    const platformCut = Math.round(total * 0.1 * 100) / 100;
    const distributable = Math.round((total - platformCut) * 100) / 100;
    const noWinnerBonus = winners.length === 0 ? distributable : 0;
    return {
      total: Math.round(total * 100) / 100,
      platformCut,
      distributable,
      winners,
      noWinnerBonus
    };
  };

  const numberWinners = Array.from(numberTotals[winningNumber].bettors || []);
  const colorPool = processPool(colorPoolTotal, colorBets[winningColor] ? colorBets[winningColor].map(b => b.user) : []);
  const sidePool = processPool(sidePoolTotal, sideBets[winningSide] ? sideBets[winningSide].map(b => b.user) : []);
  const numberPool = processPool(numberPoolTotal, numberWinners);

  // Step 5: Per-pool payouts per winner
  const numberPayoutPerWinner = numberPool.distributable / numberWinners.length || 0;
  const colorPayoutPerWinner = colorPool.distributable / colorPool.winners.length || 0;
  const sidePayoutPerWinner = sidePool.distributable / sidePool.winners.length || 0;

  // Step 6: User payouts
  const payouts = [];
  userContributions.forEach((uData, user) => {
    const numPayout = uData.number === winningNumber ? numberPayoutPerWinner : 0;
    const colPayout = uData.color === winningColor ? colorPayoutPerWinner : 0;
    const sidPayout = uData.side === winningSide ? sidePayoutPerWinner : 0;
    const totalPayout = Math.round((numPayout + colPayout + sidPayout) * 100) / 100;
    payouts.push({
      user,
      invested: Math.round(uData.totalAmount * 100) / 100,
      numberPayout: Math.round(numPayout * 100) / 100,
      colorPayout: Math.round(colPayout * 100) / 100,
      sidePayout: Math.round(sidPayout * 100) / 100,
      totalPayout,
      profitLoss: Math.round((totalPayout - uData.totalAmount) * 100) / 100
    });
  });

  // Platform profit
  const platformProfit = {
    fromNumberPool: numberPool.platformCut,
    fromColorPool: colorPool.platformCut,
    fromSidePool: sidePool.platformCut,
    noWinnerBonus: numberPool.noWinnerBonus + colorPool.noWinnerBonus + sidePool.noWinnerBonus,
    total: Math.round((numberPool.platformCut + colorPool.platformCut + sidePool.platformCut + 
                      numberPool.noWinnerBonus + colorPool.noWinnerBonus + sidePool.noWinnerBonus) * 100) / 100
  };

  return {
    winningNumber,
    winningColor,
    winningSide,
    poolSummary: { numberPool, colorPool, sidePool },
    platformProfit,
    payouts
  };
}

// ─── Test Cases (Run this file to test) ───────────────────────
function runTests() {
  console.log('🧪 Running Color Trading Test Cases...\n');

  // Test 1: 0-amount number wins (high priority)
  const test1Bets = [
    { user: 'A', number: 2, color: 'Red', side: 'Small', totalAmount: 100 },
    { user: 'B', number: 6, color: 'Red', side: 'Big', totalAmount: 100 },
    { user: 'C', number: 7, color: 'Green', side: 'Big', totalAmount: 100 },
    { user: 'D', number: 9, color: 'Green', side: 'Big', totalAmount: 100 },
    { user: 'E', number: 2, color: 'Red', side: 'Small', totalAmount: 100 },
    { user: 'F', number: null, color: 'Red', side: null, totalAmount: 100 },
    { user: 'G', number: null, color: null, side: 'Big', totalAmount: 100 },
    { user: 'H', number: 4, color: 'Red', side: 'Small', totalAmount: 100 },
    { user: 'I', number: 8, color: 'Red', side: 'Big', totalAmount: 100 }
  ];
  console.log('Test 1: 0-amount winner (e.g. 0)');
  console.log(JSON.stringify(determineRoundResult(test1Bets), null, 2));
  console.log('');

  // Test 2: No 0-amount, least amount wins
  const test2Bets = [
    { user: 'X', number: 1, color: null, side: null, totalAmount: 50 }, // least
    { user: 'Y', number: 2, color: null, side: null, totalAmount: 100 }
  ];
  console.log('Test 2: Least amount (1 wins)');
  console.log(JSON.stringify(determineRoundResult(test2Bets), null, 2));
  console.log('');

  // Test 3: Single user full loss (0-amount wins)
  const test3Bets = [
    { user: 'Solo', number: 6, color: 'Red', side: 'Big', totalAmount: 100 }
  ];
  console.log('Test 3: Single bet, 0-amount wins (platform max profit)');
  console.log(JSON.stringify(determineRoundResult(test3Bets), null, 2));
}

// ─── Legacy (Deprecated for new pool logic) ───────────────────
const GAME_MODES = {
  wingo: { id: 'wingo', duration: 30, bettingWindow: 25 },
  fastparity: { id: 'fastparity', duration: 10, bettingWindow: 7 }
};

// ─── Exports ────────────────────────────────────────────────────
module.exports = {
  GAME_MODES,
  NUMBER_TO_COLOR,
  NUMBER_TO_SIDE,
  determineRoundResult, // NEW PRIMARY (uses bets for deterministic result)
  
  // Legacy compatibility wrappers (for colorServer.js)
  generateResult(serverSeed, roundId) {
    // Deterministic hash → number 0-9 from seed (for compatibility)
    const hash = crypto.createHash('sha256')
      .update(serverSeed + roundId.toString())
      .digest('hex');
    const num = parseInt(hash.slice(0, 2), 16) % 10;
    return {
      number: num,
      colors: [NUMBER_TO_COLOR[num]],
      size: NUMBER_TO_SIDE[num],
      hash: hash.slice(0, 16)
    };
  },
  
  resolveBet(bet, result) {
    // Legacy single bet resolver (multiplied by 9.0x for color/number/size)
    const matchers = {
      number: bet.type === 'number' && parseInt(bet.value) === result.number,
      color: bet.type === 'color' && bet.value === result.colors[0],
      size: bet.type === 'size' && bet.value === result.size
    };
    
    const won = matchers[bet.type];
    const multiplier = 9.0;
    const payout = won ? Math.round(bet.amount * multiplier * 100) / 100 : 0;
    
    return {
      won,
      payout,
      profit: payout - bet.amount
    };
  }
};


// ─── Run tests if direct ──────────────────────────────────────
if (require.main === module) {
  runTests();
}
