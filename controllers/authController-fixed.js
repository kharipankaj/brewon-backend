const bcrypt = require('bcryptjs');
const Joi = require('joi');
const User = require('../models/User');
const { hashToken } = require('../utils/crypto');
const jwt = require('jsonwebtoken');

const isProd = process.env.NODE_ENV === 'production';

// ENV validation
if (!process.env.JWT_SECRET || !process.env.REFRESH_TOKEN_SECRET) {
  console.error('❌ JWT secrets missing - check .env');
}

// Token generators
const generateAccessToken = (user) => {
  return jwt.sign(
    { 
      userId: user._id, 
      username: user.username, 
      role: user.role 
    },
    process.env.JWT_SECRET || 'fallback_secret_dev_only',
    { expiresIn: '7d' }
  );
};

const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.REFRESH_TOKEN_SECRET || 'fallback_refresh_dev_only',
    { expiresIn: '90d' }
  );
};

// Mobile normalization (India)
const normalizeMobile = (input) => {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return null;
};

// Validate signup input
const signupSchema = Joi.object({
  username: Joi.string().min(3).max(20).regex(/^[a-zA-Z0-9_@.]+$/).required().messages({
    'string.pattern.base': 'Username can only contain letters, numbers, _, @, .'
  }),
  email: Joi.string().email().allow(''),
  mobile: Joi.string().allow(''),
  password: Joi.string().min(6).required(),
  firstName: Joi.string().max(50).required(),
  lastName: Joi.string().max(50).allow('')
}).custom((value, helpers) => {
  if (!value.email && !value.mobile) {
    return helpers.error('any.required', { message: 'Email or mobile required' });
  }
  return value;
});

// 🔥 Generate Referral Code (from User.js model)
function generateReferralCode(username) {
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return (username.slice(0, 4) + random).toUpperCase();
}

// @desc    Register user  
// @route   POST /signup
exports.signup = async (req, res) => {
  try {
    const { error } = signupSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { username, email, mobile: rawMobile, password, firstName, lastName, referralCode } = req.body;
    const normalizedMobile = normalizeMobile(rawMobile);
    
    // Handle referral code from signup
    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ 
        $or: [
          { referralCode: referralCode.toUpperCase().trim() },
          { username: referralCode.toLowerCase().trim() }
        ]
      }).select('_id');
      if (referrer) {
        referredBy = referrer._id;
      }
    }

    // Check existing
    const existingQuery = { username: username.toLowerCase().trim() };
    if (email) existingQuery.$or = existingQuery.$or || []; existingQuery.$or.push({ email: email.toLowerCase().trim() });
    if (normalizedMobile) existingQuery.$or = existingQuery.$or || []; existingQuery.$or.push({ mobile: normalizedMobile });

    const existingUser = await User.findOne(existingQuery);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Username, email, or mobile already exists'
      });
    }

    // Let pre-save handle password hashing and referral code
    const finalUsername = username.toLowerCase().trim();
    
    const userData = {
      username: finalUsername,
      ...(email && { email: email.toLowerCase().trim() }),
      ...(normalizedMobile && { mobile: normalizedMobile }),
      password,  // raw - middleware hashes
      firstName: firstName.trim(),
      lastName: lastName ? lastName.trim() : '',
      referredBy
    };

    const user = await User.create(userData);

    // Referral bonus AFTER creation
    if (referredBy) {
      try {
        const { creditWalletBalance } = require('../services/walletService');
        await creditWalletBalance({
          userId: referredBy,
          amount: 100,
          type: 'referral',
          bucket: 'bonus_balance',
          referenceId: `referral_signup_${finalUsername}`,
          description: `Referral bonus for ${finalUsername}`,
          metadata: { 
            referredUserId: user._id.toString(), 
            type: 'referral_bonus' 
          }
        });
      } catch (bonusErr) {
        console.warn('Referral bonus failed:', bonusErr.message);
      }
    }

    const userObj = user.toObject();
    delete userObj.password;

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: userObj
    });

  } catch (error) {
    console.error('Signup error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error during signup'
    });
  }
};

