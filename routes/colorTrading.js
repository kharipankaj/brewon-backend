/**
 * Backend/routes/colorTrading.js
 * Mount in server.js: app.use("/color", require("./routes/colorTrading"));
 */

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth"); // your existing JWT middleware
const ColorBet = require("../models/ColorBet");
const ColorRound = require("../models/ColorRound");

// GET /color/mybets?mode=wingo&page=1
router.get("/mybets", authMiddleware, async (req, res) => {
  try {
    const { mode, page = 1 } = req.query;
    const limit = 20;
    const skip = (parseInt(page) - 1) * limit;

    const query = { userId: req.user.id };
    if (mode) query.gameMode = mode;

    const bets = await ColorBet.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await ColorBet.countDocuments(query);

    res.json({
      bets,
      pagination: { page: parseInt(page), total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET /color/history?mode=wingo&limit=20
router.get("/history", async (req, res) => {
  try {
    const { mode, limit = 20 } = req.query;
    const query = {};
    if (mode) query.gameMode = mode;

    const rounds = await ColorRound.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select("roundId gameMode result createdAt totalBets")
      .lean();

    res.json({ rounds });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET /color/stats  — personal stats
router.get("/stats", authMiddleware, async (req, res) => {
  try {
    const [stats] = await ColorBet.aggregate([
      { $match: { userId: req.user._id } },
      {
        $group: {
          _id: null,
          totalBets: { $sum: 1 },
          totalWagered: { $sum: "$amount" },
          totalProfit: { $sum: "$profit" },
          wins: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] } },
        },
      },
    ]);

    res.json(stats || { totalBets: 0, totalWagered: 0, totalProfit: 0, wins: 0, losses: 0 });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;