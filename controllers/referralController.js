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
      hasClaimedReferral: !!user.referredBy,
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

/**
 * Claim referral bonus
 * POST /api/refer/claim
 * { code: 'ABC123' }
 * Auth required, one-time per user
 */
exports.claimReferralBonus = async (req, res) => {
try {
    const userId = req.user.userId;
    const { code } = req.body;
    
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, message: 'Referral code required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Check if already claimed
    if (user.referredBy) {
      return res.status(400).json({ 
        success: false, 
        message: 'Referral bonus already claimed' 
      });
    }

    // Find referrer
    const referrer = await User.findOne({ 
      $or: [
        { referralCode: code.toUpperCase().trim() },
        { username: code.toLowerCase().trim() }
      ]
    });

    if (!referrer || referrer._id.toString() === userId) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid or self referral code' 
      });
    }

    // Check if already claimed for this referrer (extra safety)
    const alreadyReferred = referrer.referrals.some(r => r.userId.toString() === userId);
    if (alreadyReferred) {
      return res.status(400).json({ 
        success: false, 
        message: 'Already claimed from this referrer' 
      });
    }

const BONUS_CLAIMER = 50;
  const BONUS_REFERRER = 20;
    const referenceId = `referral_claim_${userId}_${referrer._id}`;

    // Credit bonus to claimer
    // Credit claimer bonus
    await creditWalletBalance({
      userId: userId,
      amount: BONUS_CLAIMER,
      type: 'referral',
      bucket: 'bonus_balance',
      referenceId,
      description: `Referral bonus claimed (₹${BONUS_CLAIMER}) via ${referrer.referralCode}`,
      metadata: {
        referrerId: referrer._id.toString(),
        type: 'referral_claim_bonus'
      },
    });

    // Credit referrer earnings (playable)
    const referrerRefId = `referral_referrer_${userId}_${referrer._id}`;
    await creditWalletBalance({
      userId: referrer._id,
      amount: BONUS_REFERRER,
      type: 'referral',
      bucket: 'winning_balance',
      referenceId: referrerRefId,
      description: `Referral earnings from ${user.username || userId} (₹${BONUS_REFERRER})`,
      metadata: {
        claimerId: userId,
        type: 'referral_referrer_bonus'
      }
    });

    // Update user referredBy
    user.referredBy = referrer._id;
    await user.save();

    // Update referrer's referrals list & earnings
    referrer.referrals.push({
      userId: user._id,
      status: 'bonus_paid',
      bonusAmount: BONUS_REFERRER,
      joinedAt: new Date()
    });
    referrer.referralEarnings += BONUS_REFERRER;
    await referrer.save();

    res.json({
      success: true,
      message: `Claimer got ₹${BONUS_CLAIMER}, referrer got ₹${BONUS_REFERRER}!`,
      data: { 
        youGot: BONUS_CLAIMER, 
        referrerGot: BONUS_REFERRER,
        bonusAmount: BONUS_CLAIMER 
      }
    });

  } catch (error) {
    console.error('Referral claim error:', error);
    res.status(500).json({ success: false, message: 'Claim failed. Try again.' });
  }
};

/**
 * Get referral leaderboard
 * GET /api/refer/leaderboard
 */
exports.getLeaderboard = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || 10), 50);
    
    const leaderboard = await User.aggregate([
      { $match: { role: 'user' } },
      {
        $addFields: {
          totalReferrals: { $size: { $ifNull: ['$referrals', []] } },
          activeReferrals: {
            $size: {
              $filter: {
                input: { $ifNull: ['$referrals', []] },
                cond: { $in: ['$$this.status', ['joined', 'bonus_paid']] }
              }
            }
          }
        }
      },
      {
        $addFields: {
          earnings: { $ifNull: ['$referralEarnings', 0] }
        }
      },
      { $sort: { earnings: -1, totalReferrals: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'referredBy',
          as: 'referredUsers'
        }
      },
      {
        $project: {
          username: 1,
          firstName: 1,
          referralCode: 1,
          earnings: 1,
          totalReferrals: 1,
          activeReferrals: 1,
          referredUsersCount: { $size: '$referredUsers' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        limit,
        count: leaderboard.length,
        leaderboard: leaderboard.map((user, index) => ({
          rank: index + 1,
          name: user.firstName || user.username,
          code: user.referralCode,
          earnings: `₹${user.earnings.toLocaleString()}`,
          totalReferrals: user.totalReferrals,
          activeReferrals: user.activeReferrals
        }))
      }
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


