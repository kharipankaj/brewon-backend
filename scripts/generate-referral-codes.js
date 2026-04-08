const mongoose = require('mongoose');
const User = require('../models/User');
const connectDB = require('../db');
const { generateUniqueReferralCode } = require('../utils/referralUtils');

async function generateReferralCodes() {
  try {
    await connectDB();
    console.log('🗄️  Connected to MongoDB');

    // Find all users without referralCode
    const usersWithoutCode = await User.find({ referralCode: { $exists: false } });
    console.log(`👥 Found ${usersWithoutCode.length} users without referral codes`);

    let updated = 0;
    for (const user of usersWithoutCode) {
      // Check if code already exists (race condition safe)
      user.referralCode = await generateUniqueReferralCode();
      await user.save();
      updated++;
      console.log(`✅ Generated new ${user.referralCode} for ${user.username}`);
    }

    console.log(`🎉 Phase 1 Completed! Updated ${updated}/${usersWithoutCode.length} users without codes`);
    // Phase 2: Migrate users with username-based codes
    console.log('\\n🔄 Phase 2: Migrating username-based codes...');
    const usersWithUsernameCode = await User.find({
      referralCode: { $exists: true, $ne: null },
      $expr: {
        $eq: [{ $toUpper: "$username" }, "$referralCode"]
      }
    });
    console.log(`👥 Found ${usersWithUsernameCode.length} users with username-based codes`);
    let migrated = 0;
    for (const user of usersWithUsernameCode) {
      const oldCode = user.referralCode;
      user.referralCode = await generateUniqueReferralCode();
      await user.save();
      migrated++;
      console.log(`🔄 Migrated ${user.username}: ${oldCode} → ${user.referralCode}`);
    }
    console.log(`🎉 Phase 2 Completed! Migrated ${migrated}/${usersWithUsernameCode.length} users`);
    // Verify all users now have codes
    const usersWithCode = await User.countDocuments({ referralCode: { $exists: true } });
    const totalUsers = await User.countDocuments();
    console.log(`📊 Final stats: ${usersWithCode}/${totalUsers} users have referral codes (all unique)`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

generateReferralCodes();
