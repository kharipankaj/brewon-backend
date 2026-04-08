const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const protect = require('../middleware/auth');

/**
 * Referral Routes
 */

// GET /api/refer - Get my referrals/stats (protected)
router.get('/', protect, referralController.getMyReferrals);

// POST /api/refer/validate - Validate referral code (public)
router.post('/validate', referralController.validateReferralCode);

module.exports = router;

