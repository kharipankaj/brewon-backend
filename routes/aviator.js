const express = require("express");
const User = require("../models/User");
const { Bet: AviatorBet } = require("../models/Aviator-bet");
const auth = require("../middleware/auth");
const { getWalletSummary } = require("../services/walletService");
const aviatorEngine = require("../utils/aviatorEngine");


const router = express.Router();


router.get("/", auth, async (req, res) => {
    try {
        const { userId, username, role } = req.user;
        const [user, walletSummary] = await Promise.all([
            User.findById(userId).select('balance username role').lean(),
            getWalletSummary(userId).catch(() => null),
        ]);

        const resolvedBalance = walletSummary?.total_balance ?? user?.balance ?? 0;

        return res.json({
            success: true,
            data: {
                _id: userId,
                username: username || user?.username,
                walletBalance: resolvedBalance,
                balance: resolvedBalance,
                role: role || user?.role || "user"
            }
        });

    } catch (err) {
        console.error('[AVIATOR /] Error:', err.message, { userId: req.user?.userId });
        return res.status(500).json({
            message: "Server error",
            code: 'AVIATOR_ROUTE_ERROR'
        });
    }
});

/**
 * 🎰 GET MY BETS - Last 50 bets for authenticated user
 */
router.get("/mybets", auth, async (req, res) => {
    try {
        const { userId } = req.user;
        console.log("🧾 mybets request for userId:", userId);

        const bets = await AviatorBet.find({ playerId: userId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

console.log(`✅ mybets: Found ${bets.length} bets for ${userId.slice(-4)}`);

        return res.json({
            success: true,
            bets,
            count: bets.length
        });

    } catch (err) {
        console.error("❌ mybets error:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch bets"
        });
    }
});

/**
 * 🎮 SIMULATE AVIATOR ROUND - Test engine (no auth for demo)
 */
router.post('/simulate', async (req, res) => {
  try {
    const { bets, round, numRounds, mode, serverSeed, clientSeed, nonce } = req.body;
    const simulationOptions = {
      mode: mode === 'demo' ? 'demo' : 'fair',
      serverSeed,
      clientSeed,
      nonce,
    };
    
    if (numRounds) {
      const sim = aviatorEngine.simulateRounds(bets || [], numRounds, simulationOptions);
      return res.json({ success: true, simulation: sim });
    }
    
    const result = aviatorEngine.processRound(bets || [], round || 1, simulationOptions);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
