const {
  ensureWallet,
  creditWalletBalance,
  debitWalletBalance,
  snapshotWallet,
} = require('./walletService');

async function deductGameEntry({
  userId,
  amount,
  gameKey,
  matchId,
  contestId = null,
  session = null,
}) {
  const referenceId = `game:${gameKey}:${matchId}`;
  const result = await debitWalletBalance({
    userId,
    amount,
    type: 'game_entry',
    referenceId,
    description: `Game entry for ${gameKey}`,
    metadata: {
      gameKey,
      matchId,
      contestId,
    },
    preferredBuckets: ['bonus_balance', 'deposit_balance', 'winning_balance'],
    session,
  });

  return {
    ...result,
    referenceId,
  };
}

async function payoutGameWinner({
  userId,
  amount,
  gameKey,
  matchId,
  platformFee = 0,
  contestId = null,
  session = null,
}) {
  const referenceId = `game:${gameKey}:${matchId}:payout`;
  const result = await creditWalletBalance({
    userId,
    amount,
    type: 'game_win',
    bucket: 'winning_balance',
    referenceId,
    description: `Game payout for ${gameKey}`,
    metadata: {
      gameKey,
      matchId,
      contestId,
      platformFee,
    },
    session,
  });

  return {
    ...result,
    referenceId,
  };
}

async function getWalletForUser(userId) {
  const wallet = await ensureWallet(userId);
  return snapshotWallet(wallet);
}

module.exports = {
  deductGameEntry,
  payoutGameWinner,
  getWalletForUser,
};
