const { v4: uuidv4 } = require('uuid');
const { saveAviatorRevenue, updateRevenueSummary } = require('./utils/revenueTracker');

function generateCrashPoint() {
  const houseEdge = 0.04;
  const r = Math.random();
  if (r < houseEdge) return 1.0;
  const crashPoint = Math.floor((1 / (1 - r)) * 100) / 100;
  return Math.max(1.0, Math.min(crashPoint, 200));
}

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
    this.tickInterval = null;
    this.crashPoint = null;
    this.activeBets = new Map(); // socketId -> betObj
    this.recentCrashes = [];

    this.WAITING_DURATION = 7000;
    this.TICK_RATE = 100;
  }

  start() {
    this.scheduleNextRound();
  }

  scheduleNextRound() {
    this.state = 'waiting';
    this.currentMultiplier = 1.0;
    this.activeBets.clear();
    this.currentRound = null;
    this.crashPoint = null;

    this.io.emit('game:waiting', { countdownSeconds: this.WAITING_DURATION / 1000 });
    setTimeout(() => this.startRound(), this.WAITING_DURATION);
  }

  async startRound() {
    this.crashPoint = generateCrashPoint();
    const roundId = uuidv4();
    this.startTime = Date.now();
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

  async crash() {
    clearInterval(this.tickInterval);
    this.state = 'crashed';

    const cp = this.crashPoint;
    this.recentCrashes.unshift(cp);
    if (this.recentCrashes.length > 12) this.recentCrashes.pop();

    // ✅ Save ALL bets to AviatorBet model (wins + losses)
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
    } catch (e) { /* non-fatal */ }

    // REVENUE TRACKING: Calculate + save after bets saved
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
          profit: bet.cashedOutAt ? parseFloat((bet.betAmount * (bet.cashedOutAt - 1)).toFixed(2)) : -bet.betAmount
        });
      }
      
      const profit = parseFloat((totalBets - totalPayout).toFixed(2));
      const round_id = `AVIATOR-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${this.currentRound?.roundId?.slice(-4) || '000'}`;
      
      await saveAviatorRevenue({
        totalBets,
        totalPayout,
        crashPoint: cp,
        results,
        roundId: round_id
      });
      
      // Update summary
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

    // Single instance: rely on this.activeBets Map only
    if (this.activeBets.has(socket.id)) {
      return { success: false, message: 'You already placed a bet this round.' };
    }
    if (!betAmount || betAmount <= 0) {
      return { success: false, message: 'Invalid bet amount.' };
    }

    try {
      // ── Try walletBalance first (your User model), fallback to balance ──────
      let player = await this.Player.findOneAndUpdate(
        { _id: playerId, walletBalance: { $gte: betAmount } },
        { $inc: { walletBalance: -betAmount } },
        { new: true }
      );

      // Fallback: some schemas use 'balance'
      if (!player) {
        player = await this.Player.findOneAndUpdate(
          { _id: playerId, balance: { $gte: betAmount } },
          { $inc: { balance: -betAmount } },
          { new: true }
        );
      }

      if (!player) {
        return { success: false, message: 'Insufficient balance.' };
      }

      this.activeBets.set(socket.id, {
        playerId,
        username,
        betAmount,
        cashedOut: false,
        autoCashout: autoCashout || null, // store for server-side auto cashout
      });

      // Broadcast to all clients so LiveBets updates
      this.io.emit('bet:placed', { username, betAmount });

      // Return the correct balance field
      const newBalance = player.walletBalance ?? player.balance ?? 0;
      return { success: true, balance: newBalance };

    } catch (err) {
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
    const winAmount  = Math.floor(bet.betAmount * multiplier * 100) / 100;
    const profit     = Math.floor((winAmount - bet.betAmount) * 100) / 100;

    bet.cashedOut   = true;
    bet.cashedOutAt = multiplier;

    try {
      // ── Try walletBalance first, fallback to balance ─────────────────────
      let player = await this.Player.findByIdAndUpdate(
        playerId,
        { $inc: { walletBalance: winAmount } },
        { new: true }
      );

      if (player?.walletBalance === undefined) {
        player = await this.Player.findByIdAndUpdate(
          playerId,
          { $inc: { balance: winAmount } },
          { new: true }
        );
      }

      await this.Bet.create({
        playerId,
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

      const newBalance = player?.walletBalance ?? player?.balance ?? 0;
      return { success: true, multiplier, winAmount, profit, balance: newBalance };

    } catch (err) {
      return { success: false, message: 'Server error on cashout.' };
    }
  }

  // ── Server-side auto cashout check (called on every tick) ─────────────────
  checkAutoCashouts() {
    for (const [socketId, bet] of this.activeBets.entries()) {
      if (
        !bet.cashedOut &&
        bet.autoCashout &&
        this.currentMultiplier >= bet.autoCashout
      ) {
        const fakeSocket = { id: socketId };
        this.cashOut(fakeSocket, { playerId: bet.playerId });
      }
    }
  }

  getState() {
    return {
      state: this.state,
      multiplier: this.currentMultiplier,
      roundId: this.currentRound?.roundId,
      recentCrashes: this.recentCrashes,
    };
  }
}

module.exports = GameEngine;