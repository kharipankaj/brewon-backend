const express = require('express');

const auth = require('../middleware/auth');
const WalletTransaction = require('../models/WalletTransaction');
const { creditWalletBalance } = require('../services/walletService');

const router = express.Router();

const WELCOME_BONUS_AMOUNT = 50;

router.post('/welcome-claim', auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const deviceId = String(req.body.deviceId || req.headers['x-device-id'] || '').trim();
    const ipAddress = String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim();

    const duplicateFilters = [{ type: 'welcome_bonus', userId }];

    if (deviceId) {
      duplicateFilters.push({ type: 'welcome_bonus', 'metadata.deviceId': deviceId });
    }
    if (ipAddress) {
      duplicateFilters.push({ type: 'welcome_bonus', 'metadata.ipAddress': ipAddress });
    }

    const existingClaim = await WalletTransaction.findOne({
      $or: duplicateFilters,
    }).lean();

    if (existingClaim) {
      return res.status(409).json({
        success: false,
        message: 'Welcome bonus already claimed',
      });
    }

    const result = await creditWalletBalance({
      userId,
      amount: WELCOME_BONUS_AMOUNT,
      type: 'welcome_bonus',
      bucket: 'deposit_balance',
      referenceId: `welcome_bonus:${userId}`,
      status: 'completed',
      description: 'Welcome bonus claimed',
      metadata: {
        deviceId: deviceId || null,
        ipAddress: ipAddress || null,
      },
    });

    return res.json({
      success: true,
      message: 'Welcome bonus claimed successfully',
      wallet: {
        depositBalance: result.wallet.depositBalance,
        winningBalance: result.wallet.winningBalance,
        bonusBalance: result.wallet.bonusBalance,
        totalBalance: result.wallet.totalBalance,
      },
      transaction: result.transaction,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Welcome bonus already claimed' });
    }

    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
