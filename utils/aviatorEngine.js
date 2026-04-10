const crypto = require('crypto');

const DEFAULT_INSTANT_CRASH_PROBABILITY = 0.03;
const DEFAULT_HOUSE_EDGE = 0.04;
const DEFAULT_MAX_MULTIPLIER = 200;

const DEMO_DISTRIBUTION = [
  { label: 'common-low', min: 1.2, max: 1.7, weight: 0.7 },
  { label: 'mid', min: 1.7, max: 3.5, weight: 0.2 },
  { label: 'high', min: 3.5, max: 7.0, weight: 0.0667 },
  { label: 'rare-peak', min: 7.0, max: 10.0, weight: 0.0333 },
];

function roundToTwo(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeBets(bets = []) {
  return bets
    .filter((bet) => bet && Number(bet.amount) > 0)
    .map((bet) => ({
      ...bet,
      amount: roundToTwo(bet.amount),
      cashoutAt: bet.cashoutAt == null ? null : Number(bet.cashoutAt),
    }));
}

function randomFloat(min, max) {
  const value = crypto.randomInt(0, 1_000_000) / 1_000_000;
  return min + (max - min) * value;
}

function pickWeightedBand(distribution) {
  const totalWeight = distribution.reduce((sum, band) => sum + band.weight, 0);
  const roll = randomFloat(0, totalWeight);
  let cursor = 0;

  for (const band of distribution) {
    cursor += band.weight;
    if (roll <= cursor) {
      return band;
    }
  }

  return distribution[distribution.length - 1];
}

function generateHash(serverSeed, clientSeed, nonce) {
  return crypto
    .createHmac('sha256', String(serverSeed))
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
}

function generateProvablyFairCrashPoint({
  serverSeed,
  clientSeed = 'public',
  nonce = 0,
  houseEdge = DEFAULT_HOUSE_EDGE,
  instantCrashProbability = DEFAULT_INSTANT_CRASH_PROBABILITY,
  maxMultiplier = DEFAULT_MAX_MULTIPLIER,
} = {}) {
  const resolvedServerSeed =
    serverSeed || crypto.randomBytes(32).toString('hex');
  const hash = generateHash(resolvedServerSeed, clientSeed, nonce);
  const int = parseInt(hash.slice(0, 13), 16);
  const normalized = int / 0x1fffffffffffff;

  let crashPoint;
  if (normalized < instantCrashProbability) {
    crashPoint = 1.0;
  } else {
    const adjusted = (1 - houseEdge) / (1 - normalized);
    crashPoint = Math.max(1.0, Math.min(maxMultiplier, adjusted));
  }

  return {
    crashPoint: roundToTwo(crashPoint),
    fairness: {
      mode: 'provably-fair',
      serverSeed: resolvedServerSeed,
      clientSeed,
      nonce,
      hash,
      houseEdge,
      instantCrashProbability,
    },
  };
}

function generateDemoCrashPoint({
  distribution = DEMO_DISTRIBUTION,
  maxMultiplier = 10,
} = {}) {
  const selectedBand = pickWeightedBand(distribution);
  const crashPoint = roundToTwo(
    Math.min(maxMultiplier, randomFloat(selectedBand.min, selectedBand.max))
  );

  return {
    crashPoint,
    fairness: {
      mode: 'demo-weighted',
      selectedBand: selectedBand.label,
      selectedRange: `${selectedBand.min}x-${selectedBand.max}x`,
      note: 'For disclosed simulation/demo use only.',
      configuredDistribution: distribution.map((band) => ({
        label: band.label,
        range: `${band.min}x-${band.max}x`,
        weight: band.weight,
      })),
    },
  };
}

function calculateExpectedPayout(crashPoint, bets) {
  return normalizeBets(bets).reduce((total, bet) => {
    if (bet.cashoutAt != null && bet.cashoutAt <= crashPoint) {
      return total + roundToTwo(bet.amount * bet.cashoutAt);
    }
    return total;
  }, 0);
}

function processRound(
  bets = [],
  round = 1,
  options = {}
) {
  const normalizedBets = normalizeBets(bets);
  const totalBetsAmount = normalizedBets.reduce((sum, bet) => sum + bet.amount, 0);
  const mode = options.mode === 'demo' ? 'demo' : 'fair';

  const crashData =
    mode === 'demo'
      ? generateDemoCrashPoint(options.demoConfig)
      : generateProvablyFairCrashPoint({
          serverSeed: options.serverSeed,
          clientSeed: options.clientSeed,
          nonce: options.nonce ?? round,
          houseEdge: options.houseEdge,
          instantCrashProbability: options.instantCrashProbability,
          maxMultiplier: options.maxMultiplier,
        });

  const crashPoint = crashData.crashPoint;

  const results = normalizedBets.map((bet) => {
    const isWin = bet.cashoutAt != null && bet.cashoutAt <= crashPoint;
    const payout = isWin ? roundToTwo(bet.amount * bet.cashoutAt) : 0;
    const profit = isWin ? roundToTwo(payout - bet.amount) : roundToTwo(-bet.amount);

    return {
      user: bet.user,
      invested: bet.amount,
      cashoutAt: bet.cashoutAt,
      status: isWin ? 'WIN' : 'LOSE',
      payout,
      profit,
    };
  });

  const totalPayout = roundToTwo(results.reduce((sum, result) => sum + result.payout, 0));
  const platformProfit = roundToTwo(totalBetsAmount - totalPayout);
  const platformPercent =
    totalBetsAmount === 0
      ? '0%'
      : `${roundToTwo((platformProfit / totalBetsAmount) * 100)}%`;

  return {
    round,
    mode,
    totalBets: roundToTwo(totalBetsAmount),
    crashPoint,
    fairness: crashData.fairness,
    results,
    summary: {
      totalBets: roundToTwo(totalBetsAmount),
      totalPayout,
      platformProfit,
      platformPercent,
    },
  };
}

function simulateRounds(bets = [], numRounds = 10, options = {}) {
  const rounds = [];
  let totalPlatformProfit = 0;
  let rarePeakCount = 0;

  for (let i = 1; i <= numRounds; i += 1) {
    const roundResult = processRound(bets, i, {
      ...options,
      nonce: options.nonce == null ? i : options.nonce + i - 1,
    });

    rounds.push(roundResult);
    totalPlatformProfit += roundResult.summary.platformProfit;

    if (roundResult.crashPoint >= 7 && roundResult.crashPoint <= 10) {
      rarePeakCount += 1;
    }
  }

  return {
    rounds,
    stats: {
      totalRounds: numRounds,
      totalPlatformProfit: roundToTwo(totalPlatformProfit),
      lowBandPercentage:
        numRounds === 0
          ? 0
          : roundToTwo(
              (rounds.filter((round) => round.crashPoint >= 1.2 && round.crashPoint <= 1.7).length /
                numRounds) *
                100
            ),
      rarePeakCount,
      rarePeakFrequency:
        rarePeakCount === 0 ? null : `1 in ${roundToTwo(numRounds / rarePeakCount)}`,
    },
  };
}

module.exports = {
  DEMO_DISTRIBUTION,
  generateProvablyFairCrashPoint,
  generateDemoCrashPoint,
  calculateExpectedPayout,
  processRound,
  simulateRounds,
};
