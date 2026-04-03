const User = require('../models/User');
const Transaction = require('../models/Transaction');
const AdminActivityLog = require('../models/AdminActivityLog');
const { buildFraudSignals } = require('./fraudDetectionService');

function getDateRange(days = 7) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

function formatDayLabel(date) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
  }).format(date);
}

async function getDashboardStats() {
  const [userCount, totals] = await Promise.all([
    User.countDocuments(),
    Transaction.aggregate([
      {
        $group: {
          _id: null,
          totalDeposits: {
            $sum: {
              $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0],
            },
          },
          totalWithdrawals: {
            $sum: {
              $cond: [{ $eq: ['$type', 'withdraw'] }, '$amount', 0],
            },
          },
        },
      },
    ]),
  ]);

  const summary = totals[0] || { totalDeposits: 0, totalWithdrawals: 0 };

  return {
    totalUsers: userCount,
    totalDeposits: summary.totalDeposits || 0,
    totalWithdrawals: summary.totalWithdrawals || 0,
    netProfit: (summary.totalDeposits || 0) - (summary.totalWithdrawals || 0),
  };
}

async function getRecentActivity(limit = 8) {
  const recentTransactions = await Transaction.find()
    .populate('userId', 'username firstName lastName email')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return recentTransactions.map((transaction) => {
    const user = transaction.userId || {};
    const label =
      user.username ||
      `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
      user.email ||
      'Unknown user';

    return {
      id: transaction._id,
      user: label,
      action: transaction.type,
      amount: transaction.amount || 0,
      status: transaction.status || 'completed',
      time: transaction.createdAt,
    };
  });
}

async function getRevenueSeries(days = 7) {
  const start = getDateRange(days);
  const rows = await Transaction.aggregate([
    {
      $match: {
        createdAt: { $gte: start },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' },
        },
        revenue: {
          $sum: {
            $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0],
          },
        },
        loss: {
          $sum: {
            $cond: [{ $eq: ['$type', 'withdraw'] }, '$amount', 0],
          },
        },
      },
    },
    {
      $sort: {
        '_id.year': 1,
        '_id.month': 1,
        '_id.day': 1,
      },
    },
  ]);

  const grouped = new Map();
  rows.forEach((row) => {
    const key = `${row._id.year}-${row._id.month}-${row._id.day}`;
    grouped.set(key, row);
  });

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const row = grouped.get(key);

    return {
      day: formatDayLabel(date),
      revenue: Number(row?.revenue || 0),
      loss: Number(row?.loss || 0),
      profit: Number(row?.revenue || 0) - Number(row?.loss || 0),
    };
  });
}

async function getGameDistribution() {
  const rows = await Transaction.aggregate([
    {
      $match: {
        type: { $in: ['win', 'loss'] },
      },
    },
    {
      $project: {
        amount: 1,
        game: {
          $switch: {
            branches: [
              {
                case: {
                  $regexMatch: {
                    input: { $ifNull: ['$description', ''] },
                    regex: 'aviator',
                    options: 'i',
                  },
                },
                then: 'Aviator',
              },
              {
                case: {
                  $regexMatch: {
                    input: { $ifNull: ['$description', ''] },
                    regex: 'color',
                    options: 'i',
                  },
                },
                then: 'Color Trading',
              },
            ],
            default: 'Other Games',
          },
        },
      },
    },
    {
      $group: {
        _id: '$game',
        value: { $sum: '$amount' },
      },
    },
    {
      $sort: { value: -1 },
    },
  ]);

  return rows.map((row) => ({
    name: row._id,
    value: Number(row.value || 0),
  }));
}

async function getFraudOverview(limit = 10) {
  const pendingWithdrawals = await Transaction.find({
    type: 'withdraw',
    status: 'pending',
  })
    .populate('userId', 'username status')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const reviewed = await Promise.all(
    pendingWithdrawals.map(async (transaction) => {
      const fraud = await buildFraudSignals(transaction);

      return {
        transactionId: transaction._id,
        user: transaction.userId?.username || 'Unknown user',
        amount: transaction.amount || 0,
        createdAt: transaction.createdAt,
        ...fraud,
      };
    })
  );

  return reviewed.filter((entry) => entry.flagged);
}

async function getAdminSummaryPayload() {
  const [stats, recent, revenueData, gameDistribution, fraudAlerts, activityLogs] =
    await Promise.all([
      getDashboardStats(),
      getRecentActivity(),
      getRevenueSeries(7),
      getGameDistribution(),
      getFraudOverview(10),
      AdminActivityLog.find()
        .populate('adminId', 'username')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

  return {
    stats,
    recent,
    revenueData,
    gameDistribution,
    fraudAlerts,
    activityLogs: activityLogs.map((log) => ({
      id: log._id,
      action: log.action,
      module: log.module,
      description: log.description,
      createdAt: log.createdAt,
      admin: log.adminId?.username || 'Unknown admin',
    })),
  };
}

module.exports = {
  getDashboardStats,
  getRecentActivity,
  getRevenueSeries,
  getGameDistribution,
  getFraudOverview,
  getAdminSummaryPayload,
};
