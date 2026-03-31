const express = require('express');
const { getTransactions, getDashboardStats } = require('../utils/revenueTracker');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ─── PROTECTED REVENUE ENDPOINTS ─────────────────────────────
router.use(authMiddleware); // JWT auth required

/**
 * GET /revenue/transactions
 * Transaction history with filters
 */
router.get('/transactions', async (req, res) => {
  try {
    const filters = req.query;
    
    // Admin check? Allow all users for now
    const result = await getTransactions(filters);
    
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('Revenue transactions error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
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

