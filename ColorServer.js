/**
 * Brewon — Color Trading Socket Server (Updated for previousWinner)
 * Add to Backend/server.js: const { initColorTrading } = require("./colorServer");
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { GAME_MODES, determineRoundResult, NUMBER_TO_COLOR, NUMBER_TO_SIDE } = require("./colorGameEngine");
const { saveColorRevenue, updateRevenueSummary } = require('./utils/revenueTracker');

// ─── In-memory state per game mode ───────────────────────────
const gameState = {};
const MODE_SUFFIX = {
  wingo: 1,
  fastparity: 2,
};

function getUniqueRoundId(modeId) {
  return Date.now() * 10 + (MODE_SUFFIX[modeId] || 0);
}

function createRoundState(mode) {
  return {
    roundId: null,
    serverSeed: crypto.randomBytes(32).toString("hex"),
    bets: [],           
    result: null,
    status: "betting",  
    startTime: null,
    endTime: null,
    recentResults: [],  
  };
}

// ─── Main init ───────────────────────────────────────────────
function initColorTrading(io, mongoose) {
  const ColorBet = require("./models/ColorBet");
  const ColorRound = require("./models/ColorRound");
  const User = mongoose.model("User");

  Object.values(GAME_MODES).forEach((mode) => {
    gameState[mode.id] = createRoundState(mode);

    const ns = io.of(`/color-${mode.id}`);

    ns.use(async (socket, next) => {
      console.log(`[ColorTrading/${mode.id}] 🔌 Socket auth: ${socket.id.slice(0,8)}`);

      try {
        let token = socket.handshake.auth?.token;
        if (!token && socket.handshake.headers.cookie) {
          const cookies = socket.handshake.headers.cookie.split(';');
          const match = cookies.find(c => c.trim().startsWith('accessToken='));
          if (match) token = decodeURIComponent(match.split('=')[1]);
        }

        if (!token) {
          console.log(`[ColorTrading/${mode.id}] ❌ No token provided - blocking socket`);
          return next(new Error('No token provided'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = {
          userId: decoded.id || decoded.userId,
          username: decoded.username,
          role: decoded.role || 'user',
        };

        console.log(`[ColorTrading/${mode.id}] ✅ JWT Auth:`, socket.user.username);

        // 🔒 DB VALIDATION - Check user exists and active
        const User = require('./models/User');
        const dbUser = await User.findById(socket.user.userId).select('status').lean();
        if (!dbUser || dbUser.status !== 'active') {
          console.log(`[ColorTrading/${mode.id}] ❌ Socket DB FAIL: ${socket.user.userId.slice(-4)}`);
          return next(new Error('User not found or inactive'));
        }
        console.log(`[ColorTrading/${mode.id}] ✅ DB validated:`, socket.user.username);

        next();
      } catch (err) {
        console.error(`[ColorTrading/${mode.id}] ❌ Auth failed:`, err.message);
        next(new Error('Auth failed'));
      }
    });

    ns.on("connection", (socket) => {
      console.log(`[ColorTrading/${mode.id}] Connected: ${socket.id}`);

      const state = gameState[mode.id];
      socket.emit("game:state", {
        roundId: state.roundId,
        status: state.status,
        timeLeft: getTimeLeft(state, mode),
        recentResults: state.recentResults.slice(-20),
        liveBets: sanitizeBets(state.bets),
      });

      socket.on("bet:place", async (data, ack) => {
        try {
          const { type, value, amount } = data;
          if (!socket.user?.userId) return ack?.({ error: "Unauthorized" });
          const userId = socket.user.userId;
          const username = socket.user.username;

          const state = gameState[mode.id];
          if (state.status !== "betting") return ack?.({ error: "Betting closed" });

          if (!["number", "color", "size"].includes(type)) return ack?.({ error: "Invalid type" });
          if (typeof amount !== "number" || amount < 10 || amount > 50000) return ack?.({ error: "Invalid amount" });

          const user = await User.findById(userId);
          if (!user || user.balance < amount) return ack?.({ error: "Insufficient balance" });

          user.balance -= amount;
          await user.save();

          const bet = await ColorBet.create({
            userId,
            username: user.username,
            roundId: state.roundId,
            gameMode: mode.id,
            type,
            value: String(value),
            amount,
            status: "pending",
          });

          await User.findByIdAndUpdate(userId, { $inc: { totalBets: 1, gamesPlayed: 1 } });

          state.bets.push({
            _id: bet._id,
            userId: String(userId),
            username: user.username,
            type,
            value: String(value),
            amount,
            socketId: socket.id,
          });

          ns.emit("bet:new", { username: user.username, type, value: String(value), amount });
          ack?.({ success: true, betId: bet._id, newBalance: user.balance });
        } catch (err) {
          console.error("[ColorTrading] bet error:", err);
          ack?.({ error: "Server error" });
        }
      });

      socket.on("disconnect", () => {
        console.log(`[ColorTrading/${mode.id}] Disconnected: ${socket.id}`);  
      });
    });

    startGameLoop(ns, mode, ColorBet, ColorRound, User);
  });

  console.log("[ColorTrading] Initialized wingo + fastparity with anti-repeat logic");
}

// ─── Game Loop (UPDATED: pass previousWinner) ─────────────────
function startGameLoop(ns, mode, ColorBet, ColorRound, User) {
  async function runRound() {
    const state = gameState[mode.id];

    state.roundId = getUniqueRoundId(mode.id);
    state.serverSeed = crypto.randomBytes(32).toString("hex");
    state.bets = [];
    state.result = null;
    state.status = "betting";
    state.startTime = Date.now();
    state.endTime = Date.now() + mode.duration * 1000;

    ns.emit("round:new", {
      roundId: state.roundId,
      mode: mode.id,
      duration: mode.duration,
      bettingCloses: mode.bettingWindow,
    });

    await sleep(mode.bettingWindow * 1000);
    state.status = "closed";
    ns.emit("round:closed", { roundId: state.roundId });

    await sleep((mode.duration - mode.bettingWindow) * 1000);

    // NEW: Pass previousWinner from recentResults
    const previousWinner = state.recentResults[0]?.number ?? null;
    console.log(`[Round ${mode.id}:${state.roundId}] previousWinner: ${previousWinner}, bets: ${state.bets.length}`);

    const result = determineRoundResult(state.bets.map((b) => ({
      betId: String(b._id),
      user: b.userId,
      username: b.username,
      type: b.type,
      value: b.value,
      amount: b.amount,
    })), previousWinner);
    
    state.result = result;
    state.status = "result";

    const resolvedBets = [];
    let totalPayout = 0;

    for (const betResult of result.betResults) {
      const matchingBet = state.bets.find((b) => String(b._id) === String(betResult.betId));
      if (!matchingBet) continue;

      const resolution = {
        ...matchingBet,
        userId: betResult.user,
        won: betResult.won,
        payout: betResult.payout,
        profit: betResult.profitLoss,
      };
      resolvedBets.push(resolution);

      if (betResult.payout > 0) {
        totalPayout += betResult.payout;
      }

      await ColorBet.findByIdAndUpdate(matchingBet._id, {
        status: betResult.won ? "won" : "lost",
        payout: betResult.payout,
        profit: betResult.profitLoss,
        result: {
          number: result.winningNumber,
          colors: [result.winningColor],
          size: result.winningSide,
        },
      });
    }

    for (const payout of result.payouts) {
      if (payout.totalPayout > 0) {
        try {
          await User.findByIdAndUpdate(payout.user, {
            $inc: { balance: payout.totalPayout, totalWins: 1 },
          });
        } catch (e) {
          console.error("[ColorTrading] payout error:", e);
        }
      }
    }

    // Save round
    await ColorRound.create({
      roundId: state.roundId,
      gameMode: mode.id,
      result: {
        number: result.winningNumber,
        colors: [result.winningColor],
        size: result.winningSide,
        hash: `pool-based-prev:${previousWinner}`,
      },
      serverSeed: state.serverSeed,
      totalBets: state.bets.length,
      totalPayout,
      bets: state.bets.map((b) => b._id),
      poolSummary: result.poolSummary
    });

    // REVENUE TRACKING: Save after ColorRound
    try {
      const totalBetsAmount = state.bets.reduce((sum, b) => sum + b.amount, 0);
      const revenueResult = {
        winningNumber: result.winningNumber,
        winningColor: result.winningColor,
        winningSide: result.winningSide,
        platformProfit: result.platformProfit,
        poolSummary: result.poolSummary,
        payouts: result.payouts,
        bets: state.bets.map(b => ({ amount: b.amount })),
        roundId: `COLOR-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${state.roundId.toString().slice(-4)}`
      };
      
      await saveColorRevenue(revenueResult);
      
    } catch (revenueErr) {
      console.error('Color revenue tracking failed:', revenueErr);
    }

    // Update recent
    state.recentResults.unshift({
      roundId: state.roundId,
      number: result.winningNumber,
      colors: [result.winningColor],
      size: result.winningSide,
    });
    if (state.recentResults.length > 30) state.recentResults.pop();

    // Broadcast
    ns.emit("round:result", {
      roundId: state.roundId,
      result: {
        number: result.winningNumber,
        colors: [result.winningColor],
        size: result.winningSide,
        hash: `pool-prev:${previousWinner}`,
        pools: result.poolSummary,
        platformProfit: result.platformProfit
      },
      resolvedBets: resolvedBets.map((b) => ({
        userId: b.userId,
        username: b.username,
        type: b.type,
        value: b.value,
        amount: b.amount,
        won: b.won,
        payout: b.payout,
      })),
      recentResults: state.recentResults.slice(0, 20),
    });

    await sleep(3000);
    runRound();
  }

  runRound();
}

// ─── Helpers ─────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTimeLeft(state, mode) {
  if (!state.endTime) return mode.duration;
  return Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
}

function sanitizeBets(bets) {
  return bets.map((b) => ({
    username: b.username,
    type: b.type,
    value: b.value,
    amount: b.amount,
  }));
}

module.exports = { initColorTrading };

