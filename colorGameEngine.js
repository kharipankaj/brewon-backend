/**
 * Brewon Color Trading Game Engine - EXACT SPEC IMPLEMENTATION
 * Standalone determineRoundResult(bets, previousWinner) + tests for exclusions/no-repeat
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

// VALID NUMBERS: Exclude 0,5 per task requirement
const VALID_NUMBERS = [1,2,3,4,6,7,8,9];

// ─── Main Function ────────────────────────────────────────────
function determineRoundResult(bets, previousWinner = null) {
  if (!Array.isArray(bets)) {
    return {
      winningNumber: VALID_NUMBERS[0],
      winningColor: NUMBER_TO_COLOR[VALID_NUMBERS[0]],
      winningSide: NUMBER_TO_SIDE[VALID_NUMBERS[0]],
      poolSummary: { numberPool: {total:0,platformCut:0}, colorPool: {total:0,platformCut:0}, sidePool: {total:0,platformCut:0} },
      platformProfit: {total: 0},
      payouts: []
    };
  }
  if (bets.length === 0) {
    // Pick random valid if no bets
    const randIdx = Math.floor(Math.random() * VALID_NUMBERS.length);
    const winningNumber = VALID_NUMBERS[randIdx];
    return {
      winningNumber,
      winningColor: NUMBER_TO_COLOR[winningNumber],
      winningSide: NUMBER_TO_SIDE[winningNumber],
      poolSummary: { numberPool: {total:0,platformCut:0}, colorPool: {total:0,platformCut:0}, sidePool: {total:0,platformCut:0} },
      platformProfit: {total: 0},
      payouts: []
    };
  }

  // Step 1: Aggregate total bets per number (0-9), but only VALID_NUMBERS matter
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

    // Number pool (track all, but only valid contribute to candidates)
    if (numPool > 0 && number !== null && number >= 0 && number <= 9) {
      numberTotals[number].amount += numPool;
      numberTotals[number].bettors.add(user);
    }

    // Color pool - safe push
    if (colPool > 0 && color !== null && colorBets[color]) {
      colorBets[color].push({ user, amount: colPool });
    }

    // Side pool - safe push
    if (sidPool > 0 && side !== null && sideBets[side]) {
      sideBets[side].push({ user, amount: sidPool });
    }
  });

  // Step 2: Update bettors count
  for (let i = 0; i < 10; i++) {
    numberTotals[i].bettors = numberTotals[i].bettors.size;
  }

  // Step 3: Select winningNumber - ONLY from VALID_NUMBERS
  // Priority: 0-amount nums first, then normal - EXCLUDE previousWinner in ties
  let candidates = [];
  
  // Zero-amount first (highest priority) - only valid numbers
  for (const num of VALID_NUMBERS) {
    if (numberTotals[num].amount === 0) {
      candidates.push({ num, amount: 0, bettors: numberTotals[num].bettors, idx: num });
    }
  }
  
  // If no zeros in valid, lowest amount in valid
  if (candidates.length === 0) {
    for (const num of VALID_NUMBERS) {
      if (numberTotals[num].amount > 0) {
        candidates.push({ num, amount: numberTotals[num].amount, bettors: numberTotals[num].bettors, idx: num });
      }
    }
  }
  
  if (candidates.length === 0) {
    // Fallback: random valid
    const randIdx = Math.floor(Math.random() * VALID_NUMBERS.length);
    candidates = [{ num: VALID_NUMBERS[randIdx], amount: Infinity, bettors: 0, idx: VALID_NUMBERS[randIdx] }];
  }
  
// ALWAYS penalize previousWinner to avoid repeat (even unique lowest)
// Create penalized sort keys
  const penalizedCandidates = candidates.map(c => {
    if (previousWinner !== null && c.num === previousWinner) {
      return { ...c, sortAmount: c.amount + 0.001, sortBettors: c.bettors + 0.001 };
    }
    return { ...c, sortAmount: c.amount, sortBettors: c.bettors };
  });

  // Sort penalized
  penalizedCandidates.sort((a, b) => {
    if (a.sortAmount !== b.sortAmount) return a.sortAmount - b.sortAmount;
    if (a.sortBettors !== b.sortBettors) return a.sortBettors - b.sortBettors;
    return a.idx - b.idx;
  });

  let winningNumber = penalizedCandidates[0].num;
  
  const winningColor = NUMBER_TO_COLOR[winningNumber];
  const winningSide = NUMBER_TO_SIDE[winningNumber];

  // Step 4: Calculate pools (using winningNumber, which is valid)
  let numberPoolTotal = numberTotals[winningNumber]?.amount || 0;
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

  const numberWinners = Array.from(numberTotals[winningNumber]?.bettors || []);
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

// ─── Test Cases (Updated for exclusions/no-repeat) ─────────────
function runTests() {
  console.log('🧪 Color Trading Tests - No 0/5 + No Repeat...\n');

  // Test 1: Exclude 0 even if least (picks 5? NO, picks next valid like 1)
  const test1Bets = [
    { user: 'A', number: 2, color: null, side: null, totalAmount: 100 }
  ];
  console.log('Test 1: Only 2 bet - should pick 1,3,4,6,7,8,9 zero (not 0/5)');
  console.log('Result:', JSON.stringify(determineRoundResult(test1Bets), null, 2));
  console.log('');

  // Test 2: Least amount 1, prev=1 → pick next tie (e.g. other zeros)
  console.log('Test 2: prevWinner=1, least=1 → avoid repeat (unique lowest)');
  console.log('Result:', JSON.stringify(determineRoundResult(test1Bets, 1), null, 2));
  console.log('');

  // Test 3: prev=2 unique lowest (only bet on 7), should pick 1/3/4/6/etc NOT 2
  console.log('Test 3: prev=2 unique lowest (bet only 7), → pick other zero');
  console.log('Result:', JSON.stringify(determineRoundResult([{user:'Z', number:7, totalAmount:100}], 2), null, 2));
  console.log('');

  // Test 4: Tie 1&3 least, prev=1 → pick 3
  const test4Bets = [
    { user: 'X', number: 1, totalAmount: 50 },
    { user: 'Y', number: 3, totalAmount: 50 },
    { user: 'Z', number: 7, totalAmount: 100 }
  ];
  console.log('Test 4: Tie 1&3 least, prev=1 → pick 3');
  console.log('Result:', JSON.stringify(determineRoundResult(test4Bets, 1), null, 2));
}

// ─── Legacy ───────────────────────────────────────────────────
const GAME_MODES = {
  wingo: { id: 'wingo', duration: 30, bettingWindow: 25 },
  fastparity: { id: 'fastparity', duration: 10, bettingWindow: 7 }
};

// Exports
module.exports = {
  GAME_MODES,
  NUMBER_TO_COLOR,
  NUMBER_TO_SIDE,
  VALID_NUMBERS,
  determineRoundResult,
  generateResult(serverSeed, roundId) {
    // Legacy: pick from valid only
    const hash = crypto.createHash('sha256').update(serverSeed + roundId.toString()).digest('hex');
    let num = parseInt(hash.slice(0, 2), 16) % 10;
    if (!VALID_NUMBERS.includes(num)) {
      num = VALID_NUMBERS[Math.floor(Math.random() * VALID_NUMBERS.length)];
    }
    return {
      number: num,
      colors: [NUMBER_TO_COLOR[num]],
      size: NUMBER_TO_SIDE[num],
      hash: hash.slice(0, 16)
    };
  },
  resolveBet(bet, result) {
    const matchers = {
      number: bet.type === 'number' && parseInt(bet.value) === result.number,
      color: bet.type === 'color' && bet.value === result.colors[0],
      size: bet.type === 'size' && bet.value === result.size
    };
    const won = matchers[bet.type];
    const multiplier = 9.0;
    const payout = won ? Math.round(bet.amount * multiplier * 100) / 100 : 0;
    return { won, payout, profit: payout - bet.amount };
  }
};

if (require.main === module) {
  runTests();
}

