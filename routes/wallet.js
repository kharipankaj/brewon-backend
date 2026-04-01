const express = require("express");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const DepositRequest = require("../models/DepositRequest");
const auth = require("../middleware/auth");
const cloudinaryUpload = require("../middleware/cloudinaryUpload.js");

const roundAmount = (amt) => Math.round(Number(amt));

const router = express.Router();

/**
 * 💰 POST /wallet/deposit - Simulate deposit
 */
router.post("/deposit", auth, cloudinaryUpload("file"), async (req, res) => {
  try {
    if (!req.uploadedData) {
      return res.status(400).json({ success: false, message: "Screenshot upload failed. Please upload payment proof." });
    }
    const { url } = req.uploadedData;

    const amount = roundAmount(req.body.amount);
    const utrNo = String(req.body.utrNo || req.body.utr || "").trim().toUpperCase();
    const upiId = String(req.body.upiId || "").trim();
    const screenshotUrl = url;

    // Validation
    if (!amount || amount < 50) {
      return res.status(400).json({ success: false, error: "Minimum deposit ₹50" });
    }
    if (!utrNo) {
      return res.status(400).json({ success: false, error: "UTR/Transaction ID required" });
    }
    if (!upiId) {
      return res.status(400).json({ success: false, error: "UPI ID required" });
    }

    // Check duplicate UTR per user
    const existing = await DepositRequest.findOne({ utrNo, userId: req.user.id });
    if (existing) {
      return res.status(400).json({ success: false, error: "UTR already submitted" });
    }

    const request = await DepositRequest.create({
      userId: req.user.id,
      amount,
      upiId,
      utrNo,
      screenshotUrl,
      status: "pending",
    });

    res.status(201).json({ 
      success: true,
      message: "Deposit request submitted successfully! Awaiting approval.",
      requestId: request._id 
    });
  } catch (error) {
    console.error("Deposit error:", error);
    res.status(500).json({ success: false, error: "Server error during deposit request" });
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
