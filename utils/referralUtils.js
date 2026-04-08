const User = require('../models/User');
const mongoose = require('mongoose');

/**
 * Generate unique 8-char referral code: 6 uppercase letters + 2 digits (e.g., ABCDEF12)
 * Retries up to 20 times to avoid collisions
 */
async function generateUniqueReferralCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  let attempts = 0;
  const maxAttempts = 20;

  while (attempts < maxAttempts) {
    // Generate 6 random letters + 2 random digits
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }
    for (let i = 0; i < 2; i++) {
      code += digits[Math.floor(Math.random() * digits.length)];
    }

    // Check uniqueness
    const existing = await User.findOne({ referralCode: code });
    if (!existing) {
      return code;
    }

    attempts++;
  }

  throw new Error(`Failed to generate unique referral code after ${maxAttempts} attempts`);
}

module.exports = { generateUniqueReferralCode };
