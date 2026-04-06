require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function promoteAdmin() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/brewon';
    console.log('Connecting to:', mongoUri);
    
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000
    });
    
    console.log('✅ Connected to MongoDB');
    
    // Find and update the most recent user to admin
    const user = await User.findOne().sort({ createdAt: -1 });
    
    if (!user) {
      console.log('❌ No users found in database');
      process.exit(1);
    }
    
    console.log('Found user:', user.username);
    
    // Update to super_admin
    user.role = 'super_admin';
    await user.save();
    
    console.log(`✅ User "${user.username}" promoted to super_admin`);
    console.log('Login credentials:');
    console.log('  Username:', user.username);
    console.log('  Password: (use your login password)');
    
    mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

promoteAdmin();
