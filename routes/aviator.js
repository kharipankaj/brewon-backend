const express = require("express");
const User = require("../models/User");
const { Bet: AviatorBet } = require("../models/Aviator-bet");
const auth = require("../middleware/auth");


const router = express.Router();


router.get("/", auth, async (req, res) => {
    try {
        const { userId, username, role } = req.user;
        const user = await User.findById(userId).select('walletBalance username role').lean();

        return res.json({
            success: true,
            data: {
                _id: userId,
                username: username || user?.username,
                walletBalance: user?.walletBalance || 0,
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
    const { bets, round, numRounds } = req.body;
    
    if (numRounds) {
      const sim = aviatorEngine.simulateRounds(bets || [], numRounds);
      aviatorEngine.verifyPlatformSafety(sim.rounds);
      return res.json({ success: true, simulation: sim });
    }
    
    const result = aviatorEngine.processRound(bets || [], round || 1);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
