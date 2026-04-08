const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');


// 🔥 Generate Referral Code
function generateReferralCode(username) {
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return (username.slice(0, 4) + random).toUpperCase();
}

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  // 🔥 Referral


  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    lowercase: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [20, 'Username cannot exceed 20 characters']
  },
  email: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true,
    sparse: true
  },
  mobile: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },

  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  role: {
    type: String,
    enum: ['user', 'staff', 'admin', 'super_admin', 'moderator'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['active', 'banned'],
    default: 'active'
  },
  isVerified: {
    type: Boolean,
    default: false
  },

  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  totalBets: {
    type: Number,
    default: 0
  },
  totalWins: {
    type: Number,
    default: 0
  },
  gamesPlayed: {
    type: Number,
    default: 0
  },

  // Referral System Fields
  referralCode: {
    type: String,
    unique: true,
    uppercase: true,
    trim: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  referralEarnings: {
    type: Number,
    default: 0,
    min: 0
  },
  referrals: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'joined', 'bonus_paid'],
      default: 'pending'
    },
    bonusAmount: {
      type: Number,
      default: 100
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],

  createdAt: {
    type: Date,
    default: Date.now
  },
  refreshTokens: [{
    tokenHash: {
      type: String,
      required: true
    },
    device: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  tokenLastRefreshedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// 🔥 Password hashing & referral code generation (pre-save)
userSchema.pre('save', async function(next) {
  try {
    // Hash password if modified
    if (this.isModified('password')) {
      this.password = await bcrypt.hash(this.password, 12);
    }

    // Generate referral code only for new users
    if (this.isNew && !this.referralCode) {
      let exists = true;
      let code;
      while (exists) {
        code = generateReferralCode(this.username);
        const user = await mongoose.models.User.findOne({ referralCode: code });
        if (!user) exists = false;
      }
      this.referralCode = code;
    }
    if (typeof next === 'function') next();
  } catch (err) {
    if (typeof next === 'function') next(err);
  }
});

// Indexes
userSchema.index({ balance: 1 });
userSchema.index({ 'refreshTokens.tokenHash': 1 }, { sparse: true });
userSchema.index({ 'referrals.userId': 1 });

module.exports = mongoose.model('User', userSchema);
