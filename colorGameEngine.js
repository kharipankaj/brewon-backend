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
  const roundAmount = (value) => Math.round(value * 100) / 100;

  if (!Array.isArray(bets)) {
    return {
      winningNumber: VALID_NUMBERS[0],
      winningColor: NUMBER_TO_COLOR[VALID_NUMBERS[0]],
      winningSide: NUMBER_TO_SIDE[VALID_NUMBERS[0]],
      poolSummary: { numberPool: { total: 0, platformCut: 0, distributable: 0, winners: [], noWinnerBonus: 0 }, colorPool: { total: 0, platformCut: 0, distributable: 0, winners: [], noWinnerBonus: 0 }, sidePool: { total: 0, platformCut: 0, distributable: 0, winners: [], noWinnerBonus: 0 } },
      platformProfit: { total: 0 },
      payouts: [],
      betResults: []
    };
  }

  if (bets.length === 0) {
    const randIdx = Math.floor(Math.random() * VALID_NUMBERS.length);
    const winningNumber = VALID_NUMBERS[randIdx];
    return {
      winningNumber,
      winningColor: NUMBER_TO_COLOR[winningNumber],
      winningSide: NUMBER_TO_SIDE[winningNumber],
      poolSummary: { numberPool: { total: 0, platformCut: 0, distributable: 0, winners: [], noWinnerBonus: 0 }, colorPool: { total: 0, platformCut: 0, distributable: 0, winners: [], noWinnerBonus: 0 }, sidePool: { total: 0, platformCut: 0, distributable: 0, winners: [], noWinnerBonus: 0 } },
      platformProfit: { total: 0 },
      payouts: [],
      betResults: []
    };
  }

  const numberTotals = Array(10).fill(0).map(() => ({ amount: 0, bettors: new Set() }));
  const colorBets = { Red: [], Green: [], Violet: [] };
  const sideBets = { Big: [], Small: [] };

  bets.forEach((bet) => {
    const { user, number, color, side, amount } = bet;
    if (typeof amount !== 'number' || amount <= 0) return;

    if (number !== null && number >= 0 && number <= 9) {
      numberTotals[number].amount += amount;
      numberTotals[number].bettors.add(user);
    }
    if (color !== null && colorBets[color]) {
      colorBets[color].push({ user, amount });
    }
    if (side !== null && sideBets[side]) {
      sideBets[side].push({ user, amount });
    }
  });

  for (let i = 0; i < 10; i += 1) {
    numberTotals[i].bettors = numberTotals[i].bettors.size;
  }

  const candidates = [];
  for (const num of VALID_NUMBERS) {
    if (numberTotals[num].amount === 0) {
      candidates.push({ num, amount: 0, bettors: numberTotals[num].bettors, idx: num });
    }
  }

  if (candidates.length === 0) {
    for (const num of VALID_NUMBERS) {
      if (numberTotals[num].amount > 0) {
        candidates.push({ num, amount: numberTotals[num].amount, bettors: numberTotals[num].bettors, idx: num });
      }
    }
  }

  if (candidates.length === 0) {
    const randIdx = Math.floor(Math.random() * VALID_NUMBERS.length);
    candidates.push({ num: VALID_NUMBERS[randIdx], amount: Infinity, bettors: 0, idx: VALID_NUMBERS[randIdx] });
  }

  const penalizedCandidates = candidates.map((c) => {
    if (previousWinner !== null && c.num === previousWinner) {
      return { ...c, sortAmount: c.amount + 0.001, sortBettors: c.bettors + 0.001 };
    }
    return { ...c, sortAmount: c.amount, sortBettors: c.bettors };
  });

  penalizedCandidates.sort((a, b) => {
    if (a.sortAmount !== b.sortAmount) return a.sortAmount - b.sortAmount;
    if (a.sortBettors !== b.sortBettors) return a.sortBettors - b.sortBettors;
    return a.idx - b.idx;
  });

  const winningNumber = penalizedCandidates[0].num;
  const winningColor = NUMBER_TO_COLOR[winningNumber];
  const winningSide = NUMBER_TO_SIDE[winningNumber];

  const betResults = bets.map((bet) => {
    const won =
      (bet.type === 'number' && parseInt(bet.value, 10) === winningNumber) ||
      (bet.type === 'color' && bet.value === winningColor) ||
      (bet.type === 'size' && bet.value === winningSide);
    const payout = won ? roundAmount(bet.amount * 2) : 0;
    return {
      betId: bet.betId || null,
      user: bet.user,
      username: bet.username,
      type: bet.type,
      value: bet.value,
      amount: bet.amount,
      won,
      payout,
      profitLoss: roundAmount(payout - bet.amount),
    };
  });

  const userClaims = bets.reduce((map, bet) => {
    if (!map.has(bet.user)) {
      map.set(bet.user, { invested: 0, totalPayout: 0, profitLoss: 0 });
    }
    const totals = map.get(bet.user);
    totals.invested += bet.amount;
    return map;
  }, new Map());

  betResults.forEach((br) => {
    const totals = userClaims.get(br.user);
    totals.totalPayout += br.payout;
    totals.profitLoss += br.profitLoss;
  });

  const payouts = Array.from(userClaims.entries()).map(([user, totals]) => ({
    user,
    invested: roundAmount(totals.invested),
    numberPayout: 0,
    colorPayout: 0,
    sidePayout: 0,
    totalPayout: roundAmount(totals.totalPayout),
    profitLoss: roundAmount(totals.profitLoss),
  }));

  return {
    winningNumber,
    winningColor,
    winningSide,
    poolSummary: { numberPool: { total: 0, platformCut: 0, distributable: 0, winners: [], noWinnerBonus: 0 }, colorPool: { total: 0, platformCut: 0, distributable: 0, winners: [], noWinnerBonus: 0 }, sidePool: { total: 0, platformCut: 0, distributable: 0, winners: [], noWinnerBonus: 0 } },
    platformProfit: { total: 0 },
    payouts,
    betResults,
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

