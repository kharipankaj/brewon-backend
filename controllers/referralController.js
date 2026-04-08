const User = require('../models/User');
const { creditWalletBalance } = require('../services/walletService');
const mongoose = require('mongoose');

/**
 * Get my referral stats and list
 * GET /api/refer
 */
exports.getMyReferrals = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const user = await User.findById(userId)
      .populate('referrals.userId', 'firstName username referralCode createdAt')
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Filter active referrals (joined or bonus_paid)
    const activeReferrals = user.referrals.filter(r => 
      ['joined', 'bonus_paid'].includes(r.status)
    );

    const stats = {
      code: user.referralCode,
      totalReferrals: user.referrals.length,
      activeReferrals: activeReferrals.length,
      pendingReferrals: user.referrals.filter(r => r.status === 'pending').length,
      earnings: user.referralEarnings || 0,
      referrals: activeReferrals.slice(0, 50).map(ref => ({
        name: `${ref.userId?.firstName || ''} ${ref.userId?.username || 'User'}`.trim() || 'Unknown',
        status: ref.status,
        amount: `+₹${ref.bonusAmount}`,
        joinedAt: new Date(ref.joinedAt).toLocaleDateString()
      }))
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Referral get error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Validate referral code
 * POST /api/refer/validate
 * { code: 'ABC123' }
 */
exports.validateReferralCode = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, message: 'Valid code required' });
    }

    const referrer = await User.findOne({ 
      $or: [
        { referralCode: code.toUpperCase().trim() },
        { username: code.toLowerCase().trim() }
      ]
    }).select('_id firstName username referralCode');

    if (!referrer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid referral code' 
      });
    }

    res.json({
      success: true,
      data: {
        referrerId: referrer._id,
        referrerName: `${referrer.firstName} (@${referrer.username})`,
        code: referrer.referralCode
      }
    });

  } catch (error) {
    console.error('Referral validate error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

