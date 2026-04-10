const express = require("express");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { Bet: AviatorBet } = require("../models/Aviator-bet");
const auth = require("../middleware/auth");
const { getWalletSummary } = require("../services/walletService");
const { getPublicUserPayload } = require("../services/publicUserService");

const router = express.Router();

/**
 * 👤 GET PROFILE
 */
router.get("/", auth, async (req, res) => {
  try {
    const { userId } = req.user;

    const [user, walletSummary] = await Promise.all([
      User.findById(userId).select("-password -refreshTokens"),
      getWalletSummary(userId).catch(() => null),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const publicUser = await getPublicUserPayload(user, { walletSummary });

    console.log("✅ Profile:", user.username, "balance:", publicUser.balance);

    return res.json({
      success: true,
      data: {
        ...publicUser,
      }
    });

  } catch (err) {
    console.error("Profile Error:", err);
    return res.status(500).json({
      message: "Server error",
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
 * 💰 GET /profile/transactions - Wallet transaction history
 */
router.get("/transactions", auth, async (req, res) => {
  try {
    const { userId } = req.user;
    const limit = parseInt(req.query.limit) || 20;

    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("type amount status description createdAt")
      .lean();

    console.log(`✅ Transactions: Found ${transactions.length} for user ${userId.slice(-4)}`);

    res.json({
      success: true,
      transactions,
      count: transactions.length
    });

  } catch (err) {
    console.error("Transactions error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions"
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

module.exports = router;
