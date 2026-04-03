const express = require('express');
const mongoose = require('mongoose');

const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const cloudinaryUpload = require('../middleware/cloudinaryUpload');
const Transaction = require('../models/Transaction');
const WalletTransaction = require('../models/WalletTransaction');
const {
  ensureWallet,
  snapshotWallet,
  settleExistingTransaction,
} = require('../services/walletService');

const router = express.Router();

const MIN_DEPOSIT = 50;
const MIN_WITHDRAW = 500;
const MAX_WITHDRAW = 5000;
const DAILY_WITHDRAW_LIMIT = 10000;

function roundAmount(amount) {
  return Math.round(Number(amount || 0) * 100) / 100;
}

function getAuthUserId(req) {
  return req.user.userId || req.user.id;
}

function buildWalletResponse(wallet) {
  const snapshot = snapshotWallet(wallet);
  return {
    depositBalance: snapshot.depositBalance,
    winningBalance: snapshot.winningBalance,
    bonusBalance: snapshot.bonusBalance,
    totalBalance: snapshot.totalBalance,
  };
}

function buildTransactionFilter(baseQuery = {}, { status, type }) {
  const query = { ...baseQuery };

  if (status && status !== 'all') {
    query.status = status;
  }

  if (type === 'game') {
    query.type = { $in: ['game_entry', 'game_win'] };
  } else if (type && type !== 'all') {
    query.type = type;
  }

  return query;
}

router.get('/', auth, async (req, res) => {
  try {
    const wallet = await ensureWallet(getAuthUserId(req));

    return res.json({
      success: true,
      wallet: buildWalletResponse(wallet),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/transactions', auth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const transactions = await WalletTransaction.find({ userId: getAuthUserId(req) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      transactions,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/deposit-requests', auth, cloudinaryUpload('file'), async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const amount = roundAmount(req.body.amount);
    const utrNo = String(req.body.utrNo || req.body.utr || '').trim().toUpperCase();
    const upiId = String(req.body.upiId || '').trim();
    const screenshotUrl = req.uploadedData?.url || null;

    if (!amount || amount < MIN_DEPOSIT) {
      return res.status(400).json({
        success: false,
        message: `Minimum deposit is Rs ${MIN_DEPOSIT}`,
      });
    }

    if (!utrNo) {
      return res.status(400).json({ success: false, message: 'UTR/Transaction ID is required' });
    }

    if (!upiId) {
      return res.status(400).json({ success: false, message: 'UPI ID is required' });
    }

    if (!screenshotUrl) {
      return res.status(400).json({ success: false, message: 'Payment screenshot is required' });
    }

    const duplicate = await Transaction.findOne({
      type: 'deposit',
      utrNo,
    }).lean();

    if (duplicate) {
      return res.status(409).json({ success: false, message: 'This UTR has already been submitted' });
    }

    const wallet = await ensureWallet(userId);
    const [transaction] = await Transaction.create([
      {
        walletId: wallet._id,
        userId,
        type: 'deposit',
        status: 'pending',
        amount: 0,
        requestedAmount: amount,
        bucket: 'deposit_balance',
        referenceId: `deposit:req:${utrNo}`,
        description: `Deposit request pending | UTR: ${utrNo}`,
        upiId,
        utrNo,
        screenshotUrl,
        metadata: {
          requestSource: 'wallet_api',
        },
        balanceSnapshot: {
          before: snapshotWallet(wallet),
          after: snapshotWallet(wallet),
        },
      },
    ]);

    return res.status(201).json({
      success: true,
      message: 'Deposit request submitted successfully',
      request: transaction,
    });
  } catch (error) {
    console.error('Deposit request error:', error);
    
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Duplicate reference detected' });
    }

    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Deposit request failed',
      error: process.env.NODE_ENV === 'development' ? error.toString() : undefined
    });
  }
});

router.post('/withdraw-requests', auth, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const amount = roundAmount(req.body.amount);
    const upiId = String(req.body.upiId || '').trim();
    const note = String(req.body.note || '').trim();

    if (!amount || amount < MIN_WITHDRAW || amount > MAX_WITHDRAW) {
      return res.status(400).json({
        success: false,
        message: `Withdrawal must be between Rs ${MIN_WITHDRAW} and Rs ${MAX_WITHDRAW}`,
      });
    }

    if (!upiId) {
      return res.status(400).json({ success: false, message: 'UPI ID is required' });
    }

    const wallet = await ensureWallet(userId);
    if (roundAmount(wallet.winningBalance) < amount) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawals are allowed from winning balance only',
      });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [dailyTotals] = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          type: 'withdraw',
          status: { $in: ['pending', 'approved', 'paid'] },
          createdAt: { $gte: startOfDay },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$requestedAmount' },
        },
      },
    ]);

    const todaysAmount = roundAmount(dailyTotals?.total || 0);
    if (todaysAmount + amount > DAILY_WITHDRAW_LIMIT) {
      return res.status(400).json({
        success: false,
        message: `Daily withdrawal limit is Rs ${DAILY_WITHDRAW_LIMIT}`,
      });
    }

    const [transaction] = await WalletTransaction.create([
      {
        walletId: wallet._id,
        userId,
        type: 'withdraw',
        status: 'pending',
        amount: 0,
        requestedAmount: amount,
        bucket: 'winning_balance',
        referenceId: `withdraw:req:${userId}:${Date.now()}`,
        description: note || 'Withdrawal request pending',
        upiId,
        metadata: {
          requestSource: 'wallet_api',
        },
        balanceSnapshot: {
          before: snapshotWallet(wallet),
          after: snapshotWallet(wallet),
        },
      },
    ]);

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      request: transaction,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/deposit-requests', adminAuth(), async (req, res) => {
  try {
    const status = String(req.query.status || 'pending');
    const requests = await WalletTransaction.find(
      buildTransactionFilter({ type: 'deposit' }, { status })
    )
      .populate('userId', 'username firstName lastName email mobile balance')
      .populate('reviewedBy', 'username')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({
      success: true,
      requests,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/admin/deposit-requests/:id', adminAuth(['super_admin', 'admin']), async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const action = String(req.body.action || '').trim().toLowerCase();
    const approvedAmount = roundAmount(req.body.amount);

    let updatedTransaction;

    await session.withTransaction(async () => {
      const transaction = await WalletTransaction.findOne({
        _id: req.params.id,
        type: 'deposit',
      }).session(session);

      if (!transaction) {
        throw new Error('REQUEST_NOT_FOUND');
      }

      if (transaction.status !== 'pending') {
        throw new Error('REQUEST_ALREADY_REVIEWED');
      }

      if (action === 'approve') {
        if (!approvedAmount || approvedAmount <= 0) {
          throw new Error('INVALID_AMOUNT');
        }

        const settled = await settleExistingTransaction({
          transaction,
          amount: approvedAmount,
          status: 'approved',
          bucket: 'deposit_balance',
          description: `Deposit approved | UTR: ${transaction.utrNo || 'N/A'}`,
          adminUserId: getAuthUserId(req),
          processedAt: new Date(),
          session,
        });
        updatedTransaction = settled.transaction;
      } else if (action === 'reject') {
        transaction.status = 'rejected';
        transaction.reviewedBy = getAuthUserId(req);
        transaction.reviewedAt = new Date();
        transaction.description = `Deposit rejected | UTR: ${transaction.utrNo || 'N/A'}`;
        await transaction.save({ session });
        updatedTransaction = transaction;
      } else {
        throw new Error('INVALID_ACTION');
      }
    });

    return res.json({
      success: true,
      message: `Deposit request ${action}d successfully`,
      request: updatedTransaction,
    });
  } catch (error) {
    if (error.message === 'REQUEST_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Deposit request not found' });
    }
    if (error.message === 'REQUEST_ALREADY_REVIEWED') {
      return res.status(400).json({ success: false, message: 'Deposit request already reviewed' });
    }
    if (error.message === 'INVALID_AMOUNT') {
      return res.status(400).json({ success: false, message: 'Valid approval amount is required' });
    }
    if (error.message === 'INVALID_ACTION') {
      return res.status(400).json({ success: false, message: 'Action must be approve or reject' });
    }

    return res.status(500).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
});

router.get('/admin/withdraw-requests', adminAuth(), async (req, res) => {
  try {
    const status = String(req.query.status || 'pending');
    const requests = await WalletTransaction.find(
      buildTransactionFilter({ type: 'withdraw' }, { status })
    )
      .populate('userId', 'username firstName lastName email mobile balance')
      .populate('reviewedBy', 'username')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({
      success: true,
      requests,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/admin/withdraw-requests/:id', adminAuth(['super_admin', 'admin']), async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const action = String(req.body.action || '').trim().toLowerCase();
    let updatedTransaction;

    await session.withTransaction(async () => {
      const transaction = await WalletTransaction.findOne({
        _id: req.params.id,
        type: 'withdraw',
      }).session(session);

      if (!transaction) {
        throw new Error('REQUEST_NOT_FOUND');
      }

      if (action === 'approve') {
        if (transaction.status !== 'pending') {
          throw new Error('INVALID_WITHDRAW_STATE');
        }

        transaction.status = 'approved';
        transaction.reviewedBy = getAuthUserId(req);
        transaction.reviewedAt = new Date();
        transaction.description = 'Withdrawal approved and queued for payment';
        await transaction.save({ session });
        updatedTransaction = transaction;
        return;
      }

      if (action === 'reject') {
        if (!['pending', 'approved'].includes(transaction.status)) {
          throw new Error('INVALID_WITHDRAW_STATE');
        }

        transaction.status = 'rejected';
        transaction.reviewedBy = getAuthUserId(req);
        transaction.reviewedAt = new Date();
        transaction.description = 'Withdrawal rejected';
        await transaction.save({ session });
        updatedTransaction = transaction;
        return;
      }

      if (action === 'paid') {
        if (!['pending', 'approved'].includes(transaction.status)) {
          throw new Error('INVALID_WITHDRAW_STATE');
        }

        const settled = await settleExistingTransaction({
          transaction,
          status: 'paid',
          description: 'Withdrawal paid',
          adminUserId: getAuthUserId(req),
          processedAt: new Date(),
          preferredBuckets: ['winning_balance'],
          session,
        });
        updatedTransaction = settled.transaction;
        return;
      }

      throw new Error('INVALID_ACTION');
    });

    return res.json({
      success: true,
      message: `Withdrawal request ${action} processed successfully`,
      request: updatedTransaction,
    });
  } catch (error) {
    if (error.message === 'REQUEST_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    }
    if (error.message === 'INVALID_WITHDRAW_STATE') {
      return res.status(400).json({ success: false, message: 'This action is not allowed in the current request state' });
    }
    if (error.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ success: false, message: 'Winning balance is insufficient for payout' });
    }
    if (error.message === 'INVALID_ACTION') {
      return res.status(400).json({ success: false, message: 'Action must be approve, reject, or paid' });
    }

    return res.status(500).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
});

router.get('/admin/transactions', adminAuth(), async (req, res) => {
  try {
    const type = String(req.query.type || 'all');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const transactions = await WalletTransaction.find(buildTransactionFilter({}, { type }))
      .populate('userId', 'username firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      transactions,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/platform-fees', adminAuth(), async (req, res) => {
  try {
    const gameKey = String(req.query.gameKey || '').trim();
    const matchFilter = gameKey ? { 'metadata.gameKey': gameKey } : {};

    const aggregates = await WalletTransaction.aggregate([
      {
        $match: {
          type: { $in: ['game_entry', 'game_win'] },
          status: { $in: ['completed', 'approved', 'paid'] },
          ...matchFilter,
        },
      },
      {
        $group: {
          _id: {
            gameKey: '$metadata.gameKey',
            matchId: '$metadata.matchId',
          },
          totalEntries: {
            $sum: {
              $cond: [{ $eq: ['$type', 'game_entry'] }, { $abs: '$amount' }, 0],
            },
          },
          totalPayouts: {
            $sum: {
              $cond: [{ $eq: ['$type', 'game_win'] }, '$amount', 0],
            },
          },
          explicitPlatformFee: {
            $sum: {
              $ifNull: ['$metadata.platformFee', 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          gameKey: '$_id.gameKey',
          matchId: '$_id.matchId',
          totalEntries: 1,
          totalPayouts: 1,
          platformFee: {
            $cond: [
              { $gt: ['$explicitPlatformFee', 0] },
              '$explicitPlatformFee',
              { $subtract: ['$totalEntries', '$totalPayouts'] },
            ],
          },
        },
      },
      {
        $sort: {
          platformFee: -1,
        },
      },
    ]);

    const totalPlatformFee = aggregates.reduce((sum, row) => sum + roundAmount(row.platformFee), 0);

    return res.json({
      success: true,
      gameKey: gameKey || 'all',
      totalPlatformFee: roundAmount(totalPlatformFee),
      records: aggregates,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
