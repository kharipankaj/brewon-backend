/**
 * ============================================================
 *  Brewon — Color Trading Socket Server
 *  Add this to your Backend/server.js
 *
 *  USAGE:
 *    const { initColorTrading } = require("./colorServer");
 *    initColorTrading(io, mongoose);
 * ============================================================
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { GAME_MODES, determineRoundResult, NUMBER_TO_COLOR, NUMBER_TO_SIDE } = require("./colorGameEngine");

// ─── In-memory state per game mode ───────────────────────────
const gameState = {};

function createRoundState(mode) {
  return {
    roundId: null,
    serverSeed: crypto.randomBytes(32).toString("hex"),
    bets: [],           // { userId, username, type, value, amount, socketId }
    result: null,
    status: "betting",  // 'betting' | 'closed' | 'result'
    startTime: null,
    endTime: null,
    recentResults: [],  // last 20 results
  };
}

// ─── Main init function ───────────────────────────────────────
function initColorTrading(io, mongoose) {
  // Load models
  const ColorBet = require("./models/ColorBet");
  const ColorRound = require("./models/ColorRound");
  const User = mongoose.model("User");

  // Create namespaces for each game mode
  Object.values(GAME_MODES).forEach((mode) => {
    gameState[mode.id] = createRoundState(mode);

    const ns = io.of(`/color-${mode.id}`);

    // Add auth middleware to namespace (same as main io)
    ns.use((socket, next) => {
      console.log(`[ColorTrading/${mode.name}] 🔌 Socket auth attempt: ${socket.id.slice(0,8)}`);

      try {
        let token = socket.handshake.auth?.token;
        console.log(`[ColorTrading/${mode.name}] Token source:`, token ? 'auth.token' : 'checking cookies');

        if (!token && socket.handshake.headers.cookie) {
          const cookies = socket.handshake.headers.cookie.split(';');
          const match = cookies.find(c => c.trim().startsWith('accessToken='));
          if (match) {
            token = decodeURIComponent(match.split('=')[1]);
            console.log(`[ColorTrading/${mode.name}] Token from cookie`);
          }
        }

        const isHMR = !token || token.startsWith('__next');
        if (isHMR) {
          socket.user = null;
          return next();
        }

        if (!token) {
          return next(new Error('No token'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = {
          userId: decoded.id || decoded.userId,
          username: decoded.username,
          role: decoded.role || 'user',
        };

        console.log(`[ColorTrading/${mode.name}] ✅ Auth:`, socket.user.username);
        next();
      } catch (err) {
        console.error(`[ColorTrading/${mode.name}] ❌ Auth failed:`, err.message);
        socket.user = null;
        next(new Error('Auth failed'));
      }
    });

    ns.on("connection", (socket) => {
      console.log(`[ColorTrading/${mode.name}] Client connected: ${socket.id}`);

      // ── Send current game state on connect ──────────────────
      const state = gameState[mode.id];
      socket.emit("game:state", {
        roundId: state.roundId,
        status: state.status,
        timeLeft: getTimeLeft(state, mode),
        recentResults: state.recentResults.slice(-20),
        liveBets: sanitizeBets(state.bets),
      });

      // ── Place a bet ─────────────────────────────────────────
      socket.on("bet:place", async (data, ack) => {
        try {
          const { type, value, amount } = data; // token not needed, socket.user used

          // Get userId from socket.user (set by main io middleware)
          if (!socket.user || !socket.user.userId) {
            return ack?.({ error: "Unauthorized" });
          }
          const userId = socket.user.userId;
          const username = socket.user.username;

          const state = gameState[mode.id];

          // Check betting window
          if (state.status !== "betting") {
            return ack?.({ error: "Betting is closed for this round" });
          }

          // Validate bet
          if (!["number", "color", "size"].includes(type)) {
            return ack?.({ error: "Invalid bet type" });
          }
          if (typeof amount !== "number" || amount < 10 || amount > 50000) {
            return ack?.({ error: "Amount must be between ₹10 and ₹50,000" });
          }

          // Check balance
          const user = await User.findById(userId);
          if (!user || user.balance < amount) {
            return ack?.({ error: "Insufficient balance" });
          }

          // Deduct balance
          user.balance -= amount;
          await user.save();

          // Save bet
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

          // Update user account stats
          await User.findByIdAndUpdate(userId, {
            $inc: { totalBets: 1, gamesPlayed: 1 }
          });

          state.bets.push({
            _id: bet._id,
            userId: String(userId),
            username: user.username,
            type,
            value: String(value),
            amount,
            socketId: socket.id,
          });

          // Broadcast new bet to all in namespace
          ns.emit("bet:new", {
            username: user.username,
            type,
            value: String(value),
            amount,
          });

          ack?.({
            success: true,
            betId: bet._id,
            newBalance: user.balance,
          });
        } catch (err) {
          console.error("[ColorTrading] bet:place error:", err);
          ack?.({ error: "Server error" });
        }
      });

      socket.on("disconnect", () => {
        console.log(`[ColorTrading/${mode.name}] Client disconnected: ${socket.id}`);  
      });
    });

    // ── Start game loop ───────────────────────────────────────
    startGameLoop(ns, mode, ColorBet, ColorRound, User);
  });

  console.log("[ColorTrading] Initialized WinGo + Fast Parity");
}

// ─── Game loop ────────────────────────────────────────────────
function startGameLoop(ns, mode, ColorBet, ColorRound, User) {
  async function runRound() {
    const state = gameState[mode.id];

    // Generate new round ID (timestamp-based)
    state.roundId = Date.now();
    state.serverSeed = crypto.randomBytes(32).toString("hex");
    state.bets = [];
    state.result = null;
    state.status = "betting";
    state.startTime = Date.now();
    state.endTime = Date.now() + mode.duration * 1000;

    // Announce new round
    ns.emit("round:new", {
      roundId: state.roundId,
      mode: mode.id,
      duration: mode.duration,
      bettingCloses: mode.bettingWindow,
    });

    // Close betting bettingWindow seconds before end
    const bettingTimeout = mode.bettingWindow * 1000;

    await sleep(bettingTimeout);
    state.status = "closed";
    ns.emit("round:closed", { roundId: state.roundId });

    // Wait remaining time
    const remaining = (mode.duration - mode.bettingWindow) * 1000;
    await sleep(remaining);

    // NEW: Deterministic pool-based result
    const result = determineRoundResult(state.bets.map(b => ({
      user: b.userId,
      username: b.username,
      type: b.type,
      value: b.value,
      amount: b.amount,
      number: b.type === 'number' ? parseInt(b.value) : null,
      color: b.type === 'color' ? b.value : null,
      side: b.type === 'size' ? b.value : null,  // 'size' bet type maps to side
      totalAmount: b.amount
    })));
    
    state.result = result;
    state.status = "result";

    // Process payouts from result.payouts
    const resolvedBets = [];
    let totalPayout = 0;

    for (const payout of result.payouts) {
      const matchingBet = state.bets.find(b => b.userId === payout.user);
      if (!matchingBet) continue;

      const resolution = {
        ...matchingBet,
        won: payout.totalPayout > 0,
        payout: payout.totalPayout,
        profit: payout.profitLoss
      };
      resolvedBets.push(resolution);

      if (payout.totalPayout > 0) {
        totalPayout += payout.totalPayout;
        try {
          await User.findByIdAndUpdate(payout.user, {
            $inc: { balance: payout.totalPayout, totalWins: 1 },
          });
        } catch (e) {
          console.error("[ColorTrading] payout error:", e);
        }
      }

      // Update bet record
      try {
        await ColorBet.findByIdAndUpdate(matchingBet._id, {
          status: payout.totalPayout > 0 ? "won" : "lost",
          payout: payout.totalPayout,
          profit: payout.profitLoss,
          result: {
            number: result.winningNumber,
            colors: [result.winningColor],
            size: result.winningSide,
          },
        });
      } catch (e) {
        console.error("[ColorTrading] ColorBet update error:", e);
      }
    }

    // Save round to DB (new pool-based format)
    try {
      await ColorRound.create({
        roundId: state.roundId,
        gameMode: mode.id,
        result: {
          number: result.winningNumber,
          colors: [result.winningColor],
          size: result.winningSide,
          hash: 'pool-based',  // Deterministic from bets
        },
        serverSeed: state.serverSeed,  // Keep for provably fair appearance
        totalBets: state.bets.length,
        totalPayout,
        bets: state.bets.map((b) => b._id),
        poolSummary: result.poolSummary  // NEW: Save pool data
      });
    } catch (e) {
      console.error("[ColorTrading] ColorRound save error:", e);
    }

    // Add to recent results
    state.recentResults.unshift({
      roundId: state.roundId,
      number: result.winningNumber,
      colors: [result.winningColor],
      size: result.winningSide,
    });

    if (state.recentResults.length > 30) state.recentResults.pop();

    // Broadcast result (enhanced with pools)
    ns.emit("round:result", {
      roundId: state.roundId,
      result: {
        number: result.winningNumber,
        colors: [result.winningColor],
        size: result.winningSide,
        hash: 'pool-based',
        pools: result.poolSummary,
        platformProfit: result.platformProfit
      },
      resolvedBets: resolvedBets.map((b) => ({
        username: b.username,
        type: b.type,
        value: b.value,
        amount: b.amount,
        won: b.won,
        payout: b.payout,
      })),
      recentResults: state.recentResults.slice(0, 20),
    });

    // Small pause before next round
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

