const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('../db');
const User = require('../models/User');

async function createAdmin() {
  await connectDB();
  
  const username = 'admin';
  const email = 'admin@brewon.com';
  const password = 'admin123'; // Change this in production
  
  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    console.log('Admin already exists:', existing.username);
    process.exit(0);
  }
  
  const hashedPassword = await bcrypt.hash(password, 12);
  
  const admin = new User({
    firstName: 'Admin',
    lastName: 'User',
    username,
    email,
    password: hashedPassword,
    role: 'super_admin',
    status: 'active',
    balance: 1000000,
    isVerified: true
  });
  
  await admin.save();
  console.log(`✅ Admin created: ${username} / ${password}`);
  console.log('Login at /login');
  mongoose.connection.close();
}

createAdmin().catch(console.error);

