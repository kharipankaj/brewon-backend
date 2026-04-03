const Transaction = require('../models/Transaction');

const DEFAULT_HIGH_AMOUNT_THRESHOLD = Number(process.env.FRAUD_HIGH_AMOUNT_THRESHOLD || 10000);
const DEFAULT_RAPID_WINDOW_MINUTES = Number(process.env.FRAUD_RAPID_WINDOW_MINUTES || 15);
const DEFAULT_RAPID_WITHDRAW_COUNT = Number(process.env.FRAUD_RAPID_WITHDRAW_COUNT || 3);

async function buildFraudSignals(transaction) {
  const flags = [];
  const normalizedUserId =
    transaction?.userId && typeof transaction.userId === 'object' && transaction.userId._id
      ? transaction.userId._id
      : transaction?.userId;

  if (!transaction) {
    return {
      flagged: false,
      flags,
      score: 0,
    };
  }

  if (Number(transaction.amount || 0) >= DEFAULT_HIGH_AMOUNT_THRESHOLD) {
    flags.push({
      code: 'HIGH_AMOUNT',
      message: `Amount exceeds ${DEFAULT_HIGH_AMOUNT_THRESHOLD}`,
    });
  }

  if (transaction.type === 'withdraw' && normalizedUserId) {
    const since = new Date(Date.now() - DEFAULT_RAPID_WINDOW_MINUTES * 60 * 1000);
    const rapidWithdrawals = await Transaction.countDocuments({
      userId: normalizedUserId,
      type: 'withdraw',
      createdAt: { $gte: since },
    });

    if (rapidWithdrawals >= DEFAULT_RAPID_WITHDRAW_COUNT) {
      flags.push({
        code: 'RAPID_WITHDRAWALS',
        message: `${rapidWithdrawals} withdrawals in ${DEFAULT_RAPID_WINDOW_MINUTES} minutes`,
      });
    }
  }

  if (transaction.type === 'withdraw' && transaction.status === 'pending') {
    const sameDayFailed = await Transaction.countDocuments({
      userId: normalizedUserId,
      type: 'withdraw',
      status: 'failed',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    if (sameDayFailed >= 2) {
      flags.push({
        code: 'UNUSUAL_ACTIVITY',
        message: 'Multiple failed withdrawals in the last 24 hours',
      });
    }
  }

  return {
    flagged: flags.length > 0,
    flags,
    score: flags.length,
  };
}

module.exports = {
  buildFraudSignals,
  DEFAULT_HIGH_AMOUNT_THRESHOLD,
};
