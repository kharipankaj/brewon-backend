const User = require('../models/User');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');

function roundAmount(amount) {
  return Math.round(Number(amount || 0) * 100) / 100;
}

function snapshotWallet(wallet) {
  const depositBalance = roundAmount(wallet.depositBalance);
  const winningBalance = roundAmount(wallet.winningBalance);
  const bonusBalance = roundAmount(wallet.bonusBalance);

  return {
    depositBalance,
    winningBalance,
    bonusBalance,
    totalBalance: roundAmount(depositBalance + winningBalance + bonusBalance),
  };
}

async function syncUserLegacyBalance(userId, wallet, session) {
  const totalBalance = snapshotWallet(wallet).totalBalance;
  await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        balance: totalBalance,
        walletBalance: totalBalance,
      },
    },
    { session, strict: false }
  );
}

async function ensureWallet(userId, session = null) {
  let wallet = await Wallet.findOne({ userId }).session(session);

  if (wallet) {
    return wallet;
  }

  const legacyUser = await User.findById(userId).select('balance').session(session);
  if (!legacyUser) {
    throw new Error('USER_NOT_FOUND');
  }

  wallet = await Wallet.create(
    [
      {
        userId,
        depositBalance: roundAmount(legacyUser.balance || 0),
        winningBalance: 0,
        bonusBalance: 0,
      },
    ],
    { session }
  ).then((docs) => docs[0]);

  return wallet;
}

async function createWalletTransaction(payload, session) {
  const [transaction] = await WalletTransaction.create([payload], { session });
  return transaction;
}

async function applyBalanceDelta({
  userId,
  amount,
  bucket,
  preferredBuckets = ['bonus_balance', 'deposit_balance', 'winning_balance'],
  referenceId = null,
  session = null,
}) {
  const normalizedAmount = roundAmount(amount);
  const wallet = await ensureWallet(userId, session);
  const before = snapshotWallet(wallet);

  if (normalizedAmount > 0) {
    if (bucket === 'deposit_balance') {
      wallet.depositBalance = roundAmount(wallet.depositBalance + normalizedAmount);
    } else if (bucket === 'winning_balance') {
      wallet.winningBalance = roundAmount(wallet.winningBalance + normalizedAmount);
    } else if (bucket === 'bonus_balance') {
      wallet.bonusBalance = roundAmount(wallet.bonusBalance + normalizedAmount);
    } else {
      throw new Error('INVALID_BUCKET');
    }

    wallet.lastReferenceId = referenceId || wallet.lastReferenceId;
    await wallet.save({ session });
    await syncUserLegacyBalance(userId, wallet, session);

    return {
      wallet,
      before,
      after: snapshotWallet(wallet),
      deductions: null,
      bucket,
    };
  }

  let remaining = Math.abs(normalizedAmount);
  const deductions = {
    bonus_balance: 0,
    deposit_balance: 0,
    winning_balance: 0,
  };

  const bucketMap = {
    bonus_balance: 'bonusBalance',
    deposit_balance: 'depositBalance',
    winning_balance: 'winningBalance',
  };

  for (const preferredBucket of preferredBuckets) {
    const walletKey = bucketMap[preferredBucket];
    const available = roundAmount(wallet[walletKey]);
    if (!available || remaining <= 0) {
      continue;
    }

    const take = Math.min(available, remaining);
    wallet[walletKey] = roundAmount(wallet[walletKey] - take);
    deductions[preferredBucket] = roundAmount(deductions[preferredBucket] + take);
    remaining = roundAmount(remaining - take);
  }

  if (remaining > 0) {
    throw new Error('INSUFFICIENT_BALANCE');
  }

  wallet.lastReferenceId = referenceId || wallet.lastReferenceId;
  await wallet.save({ session });
  await syncUserLegacyBalance(userId, wallet, session);

  const usedBuckets = Object.entries(deductions)
    .filter(([, used]) => used > 0)
    .map(([usedBucket]) => usedBucket);

  return {
    wallet,
    before,
    after: snapshotWallet(wallet),
    deductions,
    bucket: usedBuckets.length === 1 ? usedBuckets[0] : 'mixed',
  };
}

async function creditWalletBalance({
  userId,
  amount,
  type,
  bucket = 'deposit_balance',
  referenceId = null,
  status = 'completed',
  description = '',
  metadata = {},
  adminUserId = null,
  processedAt = null,
  upiId = null,
  utrNo = null,
  screenshotUrl = null,
  requestedAmount = null,
  session = null,
}) {
  const normalizedAmount = roundAmount(amount);
  if (normalizedAmount <= 0) {
    throw new Error('INVALID_AMOUNT');
  }

  const wallet = await ensureWallet(userId, session);

  if (referenceId) {
    const existing = await WalletTransaction.findOne({ referenceId }).session(session);
    if (existing) {
      return { wallet, transaction: existing, duplicated: true };
    }
  }

  const { before, after } = await applyBalanceDelta({
    userId,
    amount: normalizedAmount,
    bucket,
    referenceId,
    session,
  });
  const transaction = await createWalletTransaction(
    {
      walletId: wallet._id,
      userId,
      type,
      status,
      amount: normalizedAmount,
      requestedAmount,
      bucket,
      referenceId,
      description,
      metadata,
      reviewedBy: adminUserId,
      reviewedAt: adminUserId ? new Date() : null,
      processedAt,
      upiId,
      utrNo,
      screenshotUrl,
      balanceSnapshot: { before, after },
    },
    session
  );

  return { wallet, transaction, duplicated: false };
}

async function debitWalletBalance({
  userId,
  amount,
  type,
  referenceId = null,
  status = 'completed',
  description = '',
  metadata = {},
  adminUserId = null,
  processedAt = null,
  upiId = null,
  requestedAmount = null,
  session = null,
  preferredBuckets = ['bonus_balance', 'deposit_balance', 'winning_balance'],
}) {
  const normalizedAmount = roundAmount(amount);
  if (normalizedAmount <= 0) {
    throw new Error('INVALID_AMOUNT');
  }

  const wallet = await ensureWallet(userId, session);

  if (referenceId) {
    const existing = await WalletTransaction.findOne({ referenceId }).session(session);
    if (existing) {
      return { wallet, transaction: existing, duplicated: true };
    }
  }

  const { before, after, deductions, bucket } = await applyBalanceDelta({
    userId,
    amount: -normalizedAmount,
    referenceId,
    preferredBuckets,
    session,
  });

  const transaction = await createWalletTransaction(
    {
      walletId: wallet._id,
      userId,
      type,
      status,
      amount: -normalizedAmount,
      requestedAmount,
      bucket,
      referenceId,
      description,
      metadata: {
        ...metadata,
        deductions,
      },
      reviewedBy: adminUserId,
      reviewedAt: adminUserId ? new Date() : null,
      processedAt,
      upiId,
      balanceSnapshot: { before, after },
    },
    session
  );

  return { wallet, transaction, duplicated: false, deductions };
}

async function settleExistingTransaction({
  transaction,
  amount = null,
  status,
  bucket = null,
  metadata = {},
  description = null,
  adminUserId = null,
  processedAt = null,
  session = null,
  preferredBuckets = ['bonus_balance', 'deposit_balance', 'winning_balance'],
}) {
  const tx = transaction;
  const effectiveAmount = roundAmount(amount == null ? Math.abs(tx.requestedAmount ?? tx.amount) : amount);

  if (effectiveAmount <= 0) {
    throw new Error('INVALID_AMOUNT');
  }

  let deltaResult;
  if (tx.type === 'deposit' || tx.type === 'welcome_bonus' || tx.type === 'game_win') {
    deltaResult = await applyBalanceDelta({
      userId: tx.userId,
      amount: effectiveAmount,
      bucket: bucket || tx.bucket,
      referenceId: tx.referenceId,
      session,
    });
    tx.amount = effectiveAmount;
    tx.bucket = bucket || tx.bucket;
  } else {
    deltaResult = await applyBalanceDelta({
      userId: tx.userId,
      amount: -effectiveAmount,
      referenceId: tx.referenceId,
      preferredBuckets,
      session,
    });
    tx.amount = -effectiveAmount;
    tx.bucket = deltaResult.bucket;
    tx.metadata = {
      ...(tx.metadata || {}),
      deductions: deltaResult.deductions,
    };
  }

  tx.status = status;
  tx.requestedAmount = tx.requestedAmount ?? effectiveAmount;
  tx.balanceSnapshot = {
    before: deltaResult.before,
    after: deltaResult.after,
  };
  tx.metadata = {
    ...(tx.metadata || {}),
    ...metadata,
  };
  if (description !== null) {
    tx.description = description;
  }
  if (adminUserId) {
    tx.reviewedBy = adminUserId;
    tx.reviewedAt = new Date();
  }
  if (processedAt) {
    tx.processedAt = processedAt;
  }

  await tx.save({ session });
  return { wallet: deltaResult.wallet, transaction: tx };
}

module.exports = {
  ensureWallet,
  snapshotWallet,
  creditWalletBalance,
  debitWalletBalance,
  settleExistingTransaction,
};
