const express = require("express");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const auth = require("../middleware/auth");

const router = express.Router();

/**
 * 💰 POST /wallet/deposit - Simulate deposit
 */
router.post("/deposit", auth, async (req, res) => {
  try {
    const { userId } = req.user;
    const { amount, upiId, utrNo } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ success: false, message: "Minimum deposit ₹100" });
    }
    if (!upiId || !utrNo) {
      return res.status(400).json({ success: false, message: "UPI ID and UTR number required" });
    }

    // Create pending deposit request
    const DepositRequest = require('../models/DepositRequest');
    await DepositRequest.create({
      userId,
      amount,
      upiId,
      utrNo,
      description: `UPI deposit request`
    });

    // Log pending transaction
    const Transaction = require('../models/Transaction');
    await Transaction.create({
      userId,
      type: "deposit",
      amount,
      status: "pending",
      description: `Processing UPI deposit ₹${amount} | UPI: ${upiId} | UTR: ${utrNo}`
    });

    res.json({
      success: true,
      message: "Deposit request submitted! It will be processed soon.",
      transactionId: "dep-" + Date.now()
    });

  } catch (err) {
    console.error("Deposit error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * 💸 POST /wallet/withdraw - Simulate withdrawal
 */
router.post("/withdraw", auth, async (req, res) => {
  try {
    const { userId } = req.user;
    const { amount } = req.body;

    if (!amount || amount < 500) {
      return res.status(400).json({ success: false, message: "Minimum withdraw ₹500" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.balance < amount) {
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    // Simulate approval (instant for demo)
    user.balance -= amount;
    await user.save();

    // Log transaction
    await Transaction.create({
      userId,
      type: "withdraw",
      amount,
      status: "completed",
      description: `Withdrawal ₹${amount} to simulated UPI`
    });

    res.json({
      success: true,
      message: "Withdrawal processed",
      newBalance: user.balance,
      transactionId: "sim-" + Date.now()
    });

  } catch (err) {
    console.error("Withdraw error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
