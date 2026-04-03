const express = require('express');
const { getTransactions, getDashboardStats } = require('../utils/revenueTracker');
const authMiddleware = require('../middleware/auth');
const Transaction = require('../models/Transaction');

const router = express.Router();

// ─── PROTECTED REVENUE ENDPOINTS ─────────────────────────────
router.use(authMiddleware); // JWT auth required

/**
 * GET /revenue/transactions
 * Transaction history with filters and aggregated summary
 * Query params: page, limit, type, status, search, minAmount, startDate, endDate
 */
router.get('/transactions', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      type,
      status,
      search,
      minAmount,
      startDate,
      endDate
    } = req.query;

    // Validate and sanitize inputs
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10)); // Cap at 100
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline
    const pipeline = [];

    // Stage 1: Match - Filter documents
    const matchStage = {};
    
    if (type && type !== 'all') matchStage.type = type;
    if (status && status !== 'all') matchStage.status = status;
    if (minAmount) matchStage.amount = { $gte: Number(minAmount) || 0 };
    
    if (search) {
      matchStage.$or = [
        { utrNo: { $regex: search, $options: 'i' } },
        { upiId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Date range filtering
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Stage 2: Facet - Get both paginated results and summary in one query
    pipeline.push({
      $facet: {
        transactions: [
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: limitNum },
          {
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: '_id',
              as: 'user'
            }
          },
          {
            $project: {
              _id: 1,
              amount: 1,
              approvedAmount: 1,
              type: 1,
              status: 1,
              utrNo: 1,
              upiId: 1,
              screenshotUrl: 1,
              createdAt: 1,
              reviewedAt: 1,
              'user.username': 1,
              'user.email': 1
            }
          }
        ],
        summary: [
          {
            $group: {
              _id: null,
              totalAmount: { $sum: '$amount' },
              totalCount: { $sum: 1 },
              pendingAmount: {
                $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] }
              },
              pendingCount: {
                $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
              },
              approvedAmount: {
                $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$approvedAmount', 0] }
              },
              approvedCount: {
                $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
              },
              rejectedCount: {
                $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
              }
            }
          },
          {
            $project: {
              _id: 0,
              totalAmount: 1,
              totalCount: 1,
              pendingAmount: 1,
              pendingCount: 1,
              approvedAmount: 1,
              approvedCount: 1,
              rejectedCount: 1
            }
          }
        ]
      }
    });

    // Execute aggregation
    const result = await Transaction.aggregate(pipeline);
    
    if (!result || !result[0]) {
      return res.status(500).json({ 
        success: false, 
        message: 'Aggregation failed' 
      });
    }

    const { transactions, summary } = result[0];
    const totalDocuments = await Transaction.countDocuments(matchStage);

    res.json({
      success: true,
      data: {
        transactions: transactions.map(t => ({
          ...t,
          user: t.user?.[0] || null
        })),
        summary: summary[0] || {
          totalAmount: 0,
          totalCount: 0,
          pendingAmount: 0,
          pendingCount: 0,
          approvedAmount: 0,
          approvedCount: 0,
          rejectedCount: 0
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(totalDocuments / limitNum),
          total: totalDocuments
        }
      }
    });

  } catch (err) {
    console.error('Revenue transactions error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch transactions',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * GET /revenue/stats
 * Dashboard statistics (today/week/month/all-time)
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getDashboardStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    console.error('Revenue stats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /revenue/test
 * Run revenue tracker tests (dev only)
 */
router.get('/test', async (req, res) => {
  try {
    const { runTests } = require('../utils/revenueTracker');
    await runTests();
    res.json({ success: true, message: 'Tests completed. Check console & DB.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

