const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const DepositRequest = require('../models/DepositRequest');
const WithdrawRequest = require('../models/WithdrawRequest');
const WalletTransaction = require('../models/WalletTransaction');
const { logAdminActivity } = require('../services/adminActivityService');
const { emitAdminEvent } = require('../services/adminSocketService');
const { buildFraudSignals } = require('../services/fraudDetectionService');
const { creditWalletBalance, setWalletTotalBalance } = require('../services/walletService');
const {
  getAdminSummaryPayload,
  getRevenueSeries,
  getGameDistribution,
  getDashboardStats,
} = require('../services/adminAnalyticsService');

const USER_PAGE_LIMIT = 10;

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toSafeUser(userDoc) {
  if (!userDoc) {
    return null;
  }

  const user = userDoc.toObject ? userDoc.toObject() : userDoc;
  delete user.password;
  delete user.refreshTokens;
  return user;
}

function formatAdminProfile(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email || '',
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    role: user.role,
    status: user.status,
  };
}

function defaultTransactionSummary() {
  return {
    totalCount: 0,
    totalAmount: 0,
    pendingCount: 0,
    depositCount: 0,
    withdrawalCount: 0,
    betCount: 0,
    pendingWithdrawalAmount: 0,
    highValuePendingWithdrawals: 0,
    pendingDepositCount: 0,
    pendingDepositAmount: 0,
  };
}

async function emitAdminRefreshPayload() {
  const stats = await getDashboardStats();
  emitAdminEvent('updateStats', stats);
}

async function buildUserQuery(rawQuery = {}) {
  const page = Math.max(parseInt(rawQuery.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(rawQuery.limit, 10) || USER_PAGE_LIMIT, 1), 100);
  const search = String(rawQuery.search || '').trim();
  const status = rawQuery.status || 'all';
  const role = rawQuery.role || 'all';

  const query = {};

  if (status !== 'all') {
    query.status = status;
  }

  if (role !== 'all') {
    query.role = role;
  }

  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    query.$or = [
      { username: regex },
      { email: regex },
      { firstName: regex },
      { lastName: regex },
    ];
  }

  return { page, limit, query };
}

async function buildTransactionQuery(rawQuery = {}) {
  const page = Math.max(parseInt(rawQuery.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(rawQuery.limit, 10) || 10, 1), 100);
  const type = rawQuery.type || 'all';
  const status = rawQuery.status || 'all';
  const search = String(rawQuery.search || '').trim();
  const minAmount = Number(rawQuery.minAmount);
  const range = rawQuery.range || 'all';
  const query = {};

  if (type !== 'all') {
    query.type = type;
  }

  if (status !== 'all') {
    query.status = status;
  }

  if (!Number.isNaN(minAmount) && minAmount > 0) {
    query.amount = { ...(query.amount || {}), $gte: minAmount };
  }

  if (range !== 'all') {
    const now = new Date();
    const createdAt = new Date(now);

    if (range === '24h') createdAt.setHours(now.getHours() - 24);
    if (range === '7d') createdAt.setDate(now.getDate() - 7);
    if (range === '30d') createdAt.setDate(now.getDate() - 30);

    if (['24h', '7d', '30d'].includes(range)) {
      query.createdAt = { $gte: createdAt };
    }
  }

  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    const matchingUsers = await User.find({
      $or: [
        { username: regex },
        { email: regex },
        { firstName: regex },
        { lastName: regex },
      ],
    })
      .select('_id')
      .limit(50)
      .lean();

    const searchClauses = [{ description: regex }];
    const userIds = matchingUsers.map((user) => user._id);

    if (userIds.length > 0) {
      searchClauses.push({ userId: { $in: userIds } });
    }

    if (mongoose.Types.ObjectId.isValid(search)) {
      searchClauses.push({ _id: new mongoose.Types.ObjectId(search) });
    }

    query.$or = searchClauses;
  }

  return { page, limit, query };
}

async function buildWalletTransactionQuery(rawQuery = {}) {
  const page = Math.max(parseInt(rawQuery.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(rawQuery.limit, 10) || 10, 1), 100);
  const type = String(rawQuery.type || 'all').trim();
  const status = String(rawQuery.status || 'all').trim();
  const search = String(rawQuery.search || '').trim();
  const minAmount = Number(rawQuery.minAmount);
  const range = rawQuery.range || 'all';
  const query = {};

  if (type === 'game') {
    query.type = { $in: ['game_entry', 'game_win'] };
  } else if (type === 'loss') {
    query.type = 'game_entry';
  } else if (type === 'win') {
    query.type = 'game_win';
  } else if (type !== 'all') {
    query.type = type;
  }

  if (status !== 'all') {
    query.status = status;
  }

  if (!Number.isNaN(minAmount) && minAmount > 0) {
    query.$expr = {
      $gte: [{ $abs: { $ifNull: ['$requestedAmount', '$amount'] } }, minAmount],
    };
  }

  if (range !== 'all') {
    const now = new Date();
    const createdAt = new Date(now);

    if (range === '24h') createdAt.setHours(now.getHours() - 24);
    if (range === '7d') createdAt.setDate(now.getDate() - 7);
    if (range === '30d') createdAt.setDate(now.getDate() - 30);

    if (['24h', '7d', '30d'].includes(range)) {
      query.createdAt = { $gte: createdAt };
    }
  }

  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    const matchingUsers = await User.find({
      $or: [
        { username: regex },
        { email: regex },
        { firstName: regex },
        { lastName: regex },
      ],
    })
      .select('_id')
      .limit(50)
      .lean();

    const searchClauses = [
      { description: regex },
      { referenceId: regex },
      { utrNo: regex },
      { upiId: regex },
    ];
    const userIds = matchingUsers.map((user) => user._id);

    if (userIds.length > 0) {
      searchClauses.push({ userId: { $in: userIds } });
    }

    if (mongoose.Types.ObjectId.isValid(search)) {
      searchClauses.push({ _id: new mongoose.Types.ObjectId(search) });
    }

    query.$or = searchClauses;
  }

  return { page, limit, query };
}

async function buildTransactionSummary(query) {
  const summary = await Transaction.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        totalCount: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        pendingCount: {
          $sum: {
            $cond: [
              {
                $and: [{ $eq: ['$type', 'withdraw'] }, { $eq: ['$status', 'pending'] }],
              },
              1,
              0,
            ],
          },
        },
        depositCount: {
          $sum: {
            $cond: [{ $eq: ['$type', 'deposit'] }, 1, 0],
          },
        },
        withdrawalCount: {
          $sum: {
            $cond: [{ $eq: ['$type', 'withdraw'] }, 1, 0],
          },
        },
        betCount: {
          $sum: {
            $cond: [{ $in: ['$type', ['win', 'loss']] }, 1, 0],
          },
        },
        pendingWithdrawalAmount: {
          $sum: {
            $cond: [
              {
                $and: [{ $eq: ['$type', 'withdraw'] }, { $eq: ['$status', 'pending'] }],
              },
              '$amount',
              0,
            ],
          },
        },
        highValuePendingWithdrawals: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$type', 'withdraw'] },
                  { $eq: ['$status', 'pending'] },
                  { $gte: ['$amount', Number(process.env.FRAUD_HIGH_AMOUNT_THRESHOLD || 10000)] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return (
    summary[0] || defaultTransactionSummary()
  );
}

async function decorateTransaction(transaction) {
  const fraud = await buildFraudSignals(transaction);

  return {
    ...transaction,
    fraud,
  };
}

const adminController = {
  async getMe(req, res) {
    try {
      const user = await User.findById(req.user.userId).select('-password -refreshTokens').lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Admin user not found',
        });
      }

      return res.json({
        success: true,
        admin: formatAdminProfile(user),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async getUsers(req, res) {
    try {
      const { page, limit, query } = await buildUserQuery(req.query);
      const skip = (page - 1) * limit;

      const [users, total, activeUsers, bannedUsers] = await Promise.all([
        User.find(query)
          .select('-password -refreshTokens')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(query),
        User.countDocuments({ status: 'active' }),
        User.countDocuments({ status: 'banned' }),
      ]);

      return res.json({
        success: true,
        users,
        overview: {
          totalUsers: await User.countDocuments(),
          activeUsers,
          bannedUsers,
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async createUser(req, res) {
    try {
      const {
        username,
        password = 'ChangeMe123!',
        email,
        firstName = 'Player',
        lastName = '',
        balance = 0,
        status = 'active',
        role = 'user',
      } = req.body;

      if (!username || String(username).trim().length < 3) {
        return res.status(400).json({ success: false, message: 'Valid username is required' });
      }

      const normalizedUsername = String(username).trim().toLowerCase();
      const normalizedEmail = email ? String(email).trim().toLowerCase() : undefined;
      const existing = await User.findOne({
        $or: [{ username: normalizedUsername }, ...(normalizedEmail ? [{ email: normalizedEmail }] : [])],
      });

      if (existing) {
        return res.status(409).json({ success: false, message: 'User already exists' });
      }

      const hashedPassword = await bcrypt.hash(String(password), 12);
      const userData = {
        username: normalizedUsername,
        password: hashedPassword,
        ...(normalizedEmail && { email: normalizedEmail }),
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        balance: Number(balance || 0),
        status,
        role,
      };
      const user = await User.create(userData);

      await logAdminActivity({
        adminId: req.user.userId,
        targetUserId: user._id,
        action: 'CREATE_USER',
        module: 'users',
        description: `Created user ${user.username}`,
        metadata: { username: user.username },
      });

      emitAdminEvent('userUpdate', {
        action: 'created',
        user: toSafeUser(user),
      });
      await emitAdminRefreshPayload();

      return res.status(201).json({
        success: true,
        message: 'User created successfully',
        user: toSafeUser(user),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const updates = {};
      const allowedFields = ['username', 'email', 'firstName', 'lastName', 'balance', 'status', 'role'];

      allowedFields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
          updates[field] = req.body[field];
        }
      });

      if (Object.prototype.hasOwnProperty.call(req.body, 'password') && req.body.password) {
        updates.password = await bcrypt.hash(String(req.body.password), 12);
      }

      if (updates.username) {
        updates.username = String(updates.username).trim().toLowerCase();
      }

      if (updates.email) {
        updates.email = String(updates.email).trim().toLowerCase();
      }

      if (Object.prototype.hasOwnProperty.call(updates, 'balance')) {
        updates.balance = Number(updates.balance || 0);
      }

      let requestedBalance = null;
      if (Object.prototype.hasOwnProperty.call(updates, 'balance')) {
        requestedBalance = updates.balance;
        delete updates.balance;
      }

      const user = await User.findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true,
      }).select('-password -refreshTokens');

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if (requestedBalance !== null) {
        await setWalletTotalBalance(user._id, requestedBalance);
        user.balance = requestedBalance;
      }

      await logAdminActivity({
        adminId: req.user.userId,
        targetUserId: user._id,
        action: 'UPDATE_USER',
        module: 'users',
        description: `Updated user ${user.username}`,
        metadata: { updatedFields: Object.keys(updates) },
      });

      emitAdminEvent('userUpdate', {
        action: 'updated',
        user,
      });
      await emitAdminRefreshPayload();

      return res.json({
        success: true,
        message: 'User updated successfully',
        user,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async toggleBan(req, res) {
    try {
      const user = await User.findById(req.params.id);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      user.status = user.status === 'active' ? 'banned' : 'active';
      await user.save();

      await logAdminActivity({
        adminId: req.user.userId,
        targetUserId: user._id,
        action: user.status === 'banned' ? 'BAN_USER' : 'UNBAN_USER',
        module: 'users',
        description: `${user.status === 'banned' ? 'Banned' : 'Unbanned'} ${user.username}`,
      });

      emitAdminEvent('userUpdate', {
        action: user.status === 'banned' ? 'banned' : 'unbanned',
        user: toSafeUser(user),
      });
      await emitAdminRefreshPayload();

      return res.json({
        success: true,
        message: `User ${user.status === 'active' ? 'unbanned' : 'banned'} successfully`,
        user: toSafeUser(user),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async deleteUser(req, res) {
    try {
      const user = await User.findById(req.params.id).select('-password -refreshTokens');

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      await User.findByIdAndDelete(req.params.id);

      await logAdminActivity({
        adminId: req.user.userId,
        targetUserId: user._id,
        action: 'DELETE_USER',
        module: 'users',
        description: `Deleted user ${user.username}`,
      });

      emitAdminEvent('userUpdate', {
        action: 'deleted',
        user: toSafeUser(user),
      });
      await emitAdminRefreshPayload();

      return res.json({
        success: true,
        message: 'User deleted successfully',
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async getTransactions(req, res) {
    try {
      const { page, limit, query } = await buildWalletTransactionQuery(req.query);
      const skip = (page - 1) * limit;
      const [transactions, total, summaryRows] = await Promise.all([
        WalletTransaction.find(query)
          .populate('userId', 'username firstName lastName email balance status')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        WalletTransaction.countDocuments(query),
        WalletTransaction.aggregate([
          { $match: query },
          {
            $group: {
              _id: null,
              totalCount: { $sum: 1 },
              totalAmount: {
                $sum: {
                  $abs: {
                    $ifNull: ['$requestedAmount', '$amount'],
                  },
                },
              },
              pendingCount: {
                $sum: {
                  $cond: [
                    {
                      $and: [{ $eq: ['$type', 'withdraw'] }, { $eq: ['$status', 'pending'] }],
                    },
                    1,
                    0,
                  ],
                },
              },
              depositCount: {
                $sum: {
                  $cond: [{ $eq: ['$type', 'deposit'] }, 1, 0],
                },
              },
              withdrawalCount: {
                $sum: {
                  $cond: [{ $eq: ['$type', 'withdraw'] }, 1, 0],
                },
              },
              betCount: {
                $sum: {
                  $cond: [{ $in: ['$type', ['game_entry', 'game_win']] }, 1, 0],
                },
              },
              pendingWithdrawalAmount: {
                $sum: {
                  $cond: [
                    {
                      $and: [{ $eq: ['$type', 'withdraw'] }, { $eq: ['$status', 'pending'] }],
                    },
                    { $abs: { $ifNull: ['$requestedAmount', '$amount'] } },
                    0,
                  ],
                },
              },
              highValuePendingWithdrawals: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$type', 'withdraw'] },
                        { $eq: ['$status', 'pending'] },
                        {
                          $gte: [
                            { $abs: { $ifNull: ['$requestedAmount', '$amount'] } },
                            Number(process.env.FRAUD_HIGH_AMOUNT_THRESHOLD || 10000),
                          ],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              pendingDepositCount: {
                $sum: {
                  $cond: [
                    {
                      $and: [{ $eq: ['$type', 'deposit'] }, { $eq: ['$status', 'pending'] }],
                    },
                    1,
                    0,
                  ],
                },
              },
              pendingDepositAmount: {
                $sum: {
                  $cond: [
                    {
                      $and: [{ $eq: ['$type', 'deposit'] }, { $eq: ['$status', 'pending'] }],
                    },
                    { $abs: { $ifNull: ['$requestedAmount', '$amount'] } },
                    0,
                  ],
                },
              },
            },
          },
        ]),
      ]);

      const hydratedTransactions = await Promise.all(
        transactions.map(async (record) => {
          const normalizedAmount = Math.abs(
            Number(record.requestedAmount ?? record.amount ?? 0)
          );
          const mappedType =
            record.type === 'game_entry' ? 'loss' : record.type === 'game_win' ? 'win' : record.type;

          return {
            ...record,
            amount: normalizedAmount,
            displayType: mappedType,
            displayStatus: record.status,
            depositRequestId:
              record.type === 'deposit' && record.status === 'pending' ? record._id : undefined,
            fraud: await buildFraudSignals({
              ...record,
              amount: normalizedAmount,
              type: mappedType,
            }),
          };
        })
      );

      const updatedSummary = {
        ...defaultTransactionSummary(),
        ...(summaryRows[0] || {}),
      };

      return res.json({
        success: true,
        transactions: hydratedTransactions,
        summary: updatedSummary,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async getDepositRequests(req, res) {
    try {
      const requests = await DepositRequest.find({ status: 'pending' })
        .populate('userId', 'username firstName lastName email mobile balance')
        .populate('reviewedBy', 'username')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      return res.json({
        success: true,
        requests,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async approveDepositRequest(req, res) {
    try {
      const rawAmount = Number(req.body.amount);
      const approvedAmount = Math.round(rawAmount);

      if (Number.isNaN(approvedAmount) || approvedAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Valid approval amount is required' });
      }

      // Find the deposit request
      const depositRequest = await DepositRequest.findById(req.params.id);

      if (!depositRequest) {
        return res.status(404).json({ success: false, message: 'Deposit request not found' });
      }

      if (depositRequest.status !== 'pending') {
        return res.status(400).json({ success: false, message: 'Deposit request is already reviewed' });
      }

      // Find the user
      const user = await User.findById(depositRequest.userId);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      await creditWalletBalance({
        userId: user._id,
        amount: approvedAmount,
        type: 'deposit',
        bucket: 'deposit_balance',
        referenceId: `admin:deposit:${depositRequest._id}`,
        description: `Deposit approved | UTR: ${depositRequest.utrNo} | Requested: ${depositRequest.amount}`,
        adminUserId: req.user.userId,
        requestedAmount: depositRequest.amount,
        upiId: depositRequest.upiId || null,
        utrNo: depositRequest.utrNo,
        screenshotUrl: depositRequest.screenshotUrl,
      });

      const refreshedUser = await User.findById(depositRequest.userId);

      // Update the deposit request status to approved
      depositRequest.status = 'approved';
      depositRequest.approvedAmount = approvedAmount;
      depositRequest.reviewedBy = req.user.userId;
      depositRequest.reviewedAt = new Date();
      await depositRequest.save();

      // Store request info for logging
      const requestInfo = {
        _id: depositRequest._id,
        amount: depositRequest.amount,
        approvedAmount: approvedAmount,
        utrNo: depositRequest.utrNo,
        userId: depositRequest.userId,
      };

      // Update the pending transaction to approved
      await Transaction.findOneAndUpdate(
        {
          userId: user._id,
          type: 'deposit',
          status: 'pending',
          description: { $regex: `UTR: ${depositRequest.utrNo}`, $options: 'i' }
        },
        {
          status: 'approved',
          amount: approvedAmount,
          approvedAmount: approvedAmount,
          reviewedBy: req.user.userId,
          reviewedAt: new Date(),
          description: `Deposit approved | UTR: ${depositRequest.utrNo} | Requested: ${depositRequest.amount}`
        }
      );

      // If no pending transaction found (edge case), create a new one
      const existingTxn = await Transaction.findOne({
        userId: user._id,
        type: 'deposit',
        amount: approvedAmount,
        createdAt: { $gte: new Date(new Date().getTime() - 600000) } // within 10 minutes
      });

      if (!existingTxn) {
        await Transaction.create({
          userId: user._id,
          type: 'deposit',
          amount: approvedAmount,
          status: 'approved',
          upiId: depositRequest.upiId || 'N/A',
          utrNo: depositRequest.utrNo,
          screenshotUrl: depositRequest.screenshotUrl,
          approvedAmount: approvedAmount,
          reviewedBy: req.user.userId,
          reviewedAt: new Date(),
          description: `Deposit approved | UTR: ${depositRequest.utrNo} | Requested: ${depositRequest.amount}`,
        });
      }

      // Prepare response data
      const approvedRequest = {
        _id: requestInfo._id,
        amount: requestInfo.amount,
        approvedAmount: requestInfo.approvedAmount,
        utrNo: requestInfo.utrNo,
        status: 'approved',
        userId: {
          _id: user._id,
          username: refreshedUser.username,
          firstName: refreshedUser.firstName,
          lastName: refreshedUser.lastName,
          email: refreshedUser.email,
          mobile: refreshedUser.mobile,
          balance: refreshedUser.balance,
        },
        reviewedBy: req.user.userId,
        reviewedAt: new Date(),
      };

      // Log admin activity
      await logAdminActivity({
        adminId: req.user.userId,
        targetUserId: user._id,
        action: 'APPROVE_DEPOSIT',
        module: 'transactions',
        description: `Approved deposit request ${depositRequest._id}`,
        metadata: {
          requestedAmount: depositRequest.amount,
          approvedAmount,
          utrNo: depositRequest.utrNo,
        },
      });

      // Emit socket events
      emitAdminEvent('depositRequestUpdate', {
        action: 'approved',
        requestId: req.params.id,
      });
      emitAdminEvent('newTransaction', {
        action: 'deposit-approved',
        requestId: req.params.id,
      });
      emitAdminEvent('userUpdate', {
        action: 'balance-updated',
        userId: refreshedUser._id,
      });
      await emitAdminRefreshPayload();

      return res.json({
        success: true,
        message: 'Deposit approved and balance updated successfully',
        request: approvedRequest,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async rejectDepositRequest(req, res) {
    try {
      const depositRequest = await DepositRequest.findById(req.params.id).populate('userId', 'username firstName lastName email');

      if (!depositRequest) {
        return res.status(404).json({ success: false, message: 'Deposit request not found' });
      }

      if (depositRequest.status !== 'pending') {
        return res.status(400).json({ success: false, message: 'Only pending deposit requests can be rejected' });
      }

      depositRequest.status = 'rejected';
      depositRequest.reviewedBy = req.user.userId;
      depositRequest.reviewedAt = new Date();
      depositRequest.description = depositRequest.description ? `${depositRequest.description} | Rejected by admin` : 'Rejected by admin';

      await depositRequest.save();

      // Update the associated pending transaction to rejected
      await Transaction.findOneAndUpdate(
        {
          userId: depositRequest.userId._id,
          type: 'deposit',
          status: 'pending',
          description: { $regex: `UTR: ${depositRequest.utrNo}` }
        },
        {
          status: 'rejected',
          reviewedBy: req.user.userId,
          reviewedAt: new Date(),
          description: `Deposit rejected | UTR: ${depositRequest.utrNo}`
        }
      );

      await logAdminActivity({
        adminId: req.user.userId,
        targetUserId: depositRequest.userId._id,
        action: 'REJECT_DEPOSIT',
        module: 'transactions',
        description: `Rejected deposit request ${depositRequest._id}`,
        metadata: {
          requestedAmount: depositRequest.amount,
          utrNo: depositRequest.utrNo,
        },
      });

      emitAdminEvent('depositRequestUpdate', {
        action: 'rejected',
        requestId: req.params.id,
      });
      await emitAdminRefreshPayload();

      return res.json({
        success: true,
        message: 'Deposit request rejected successfully',
        request: depositRequest,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async approveWithdraw(req, res) {
    try {
      const transaction = await Transaction.findById(req.params.id).populate('userId', 'username balance');

      if (!transaction) {
        return res.status(404).json({ success: false, message: 'Transaction not found' });
      }

      if (transaction.type !== 'withdraw' || transaction.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'Only pending withdrawal transactions can be approved',
        });
      }

      transaction.status = 'approved';
      transaction.reviewedBy = req.user.userId;
      transaction.reviewedAt = new Date();

      const fraud = await buildFraudSignals(transaction);
      transaction.fraudFlags = fraud.flags;
      transaction.description = transaction.description
        ? `${transaction.description} | Approved by admin`
        : 'Approved by admin';

      await transaction.save();

      await logAdminActivity({
        adminId: req.user.userId,
        targetUserId: transaction.userId?._id,
        action: 'APPROVE_WITHDRAWAL',
        module: 'transactions',
        description: `Approved withdrawal ${transaction._id}`,
        metadata: { amount: transaction.amount },
      });

      emitAdminEvent('newTransaction', {
        action: 'approved',
        transactionId: transaction._id,
      });
      await emitAdminRefreshPayload();

      return res.json({
        success: true,
        message: 'Withdrawal approved successfully',
        transaction,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async rejectWithdraw(req, res) {
    try {
      const transaction = await Transaction.findById(req.params.id).populate('userId', 'username balance');

      if (!transaction) {
        return res.status(404).json({ success: false, message: 'Transaction not found' });
      }

      if (transaction.type !== 'withdraw' || transaction.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'Only pending withdrawal transactions can be rejected',
        });
      }

      transaction.status = 'rejected';
      transaction.reviewedBy = req.user.userId;
      transaction.reviewedAt = new Date();

      const fraud = await buildFraudSignals(transaction);
      transaction.fraudFlags = fraud.flags;
      transaction.description = transaction.description
        ? `${transaction.description} | Rejected by admin`
        : 'Rejected by admin';

      await transaction.save();

      await logAdminActivity({
        adminId: req.user.userId,
        targetUserId: transaction.userId?._id,
        action: 'REJECT_WITHDRAWAL',
        module: 'transactions',
        description: `Rejected withdrawal ${transaction._id}`,
        metadata: { amount: transaction.amount },
      });

      emitAdminEvent('newTransaction', {
        action: 'rejected',
        transactionId: transaction._id,
      });
      await emitAdminRefreshPayload();

      return res.json({
        success: true,
        message: 'Withdrawal rejected successfully',
        transaction,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async getDashboard(req, res) {
    try {
      const payload = await getAdminSummaryPayload();
      return res.json({ success: true, ...payload });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async getAnalytics(req, res) {
    try {
      const [dashboard, revenueData, gameDistribution] = await Promise.all([
        getAdminSummaryPayload(),
        getRevenueSeries(7),
        getGameDistribution(),
      ]);

      return res.json({
        success: true,
        stats: dashboard.stats,
        recent: dashboard.recent,
        fraudAlerts: dashboard.fraudAlerts,
        activityLogs: dashboard.activityLogs,
        revenueData,
        gameDistribution,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async getWithdrawRequests(req, res) {
    try {
      const status = req.query.status || 'pending';
      const filter = status === 'all' ? {} : { status };
      const requests = await WithdrawRequest.find(filter)
        .populate('userId', 'username email upiId balance')
        .sort({ createdAt: -1 })
        .lean();

      return res.json({ requests });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};

module.exports = adminController;
