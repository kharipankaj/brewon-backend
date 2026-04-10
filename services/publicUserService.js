const { getWalletSummary } = require('./walletService');

function resolvePublicBalance(user, walletSummary = null) {
  return Number(
    walletSummary?.total_balance ??
      walletSummary?.totalBalance ??
      user?.walletBalance ??
      user?.balance ??
      0
  );
}

async function getPublicUserPayload(userLike, overrides = {}) {
  if (!userLike?._id && !userLike?.id && !overrides?._id && !overrides?.id) {
    return null;
  }

  const userId = userLike?._id || userLike?.id || overrides?._id || overrides?.id;
  const walletSummary =
    overrides.walletSummary !== undefined
      ? overrides.walletSummary
      : await getWalletSummary(userId).catch(() => null);

  const balance = resolvePublicBalance(userLike, walletSummary);

  return {
    _id: String(userId),
    username: overrides.username ?? userLike?.username ?? '',
    balance,
    walletBalance: balance,
    role: overrides.role ?? userLike?.role ?? 'user',
    wallet: walletSummary
      ? {
          depositBalance: Number(walletSummary.deposit_balance ?? 0),
          winningBalance: Number(walletSummary.winning_balance ?? 0),
          bonusBalance: Number(walletSummary.bonus_balance ?? 0),
          totalBalance: Number(walletSummary.total_balance ?? balance),
        }
      : undefined,
  };
}

module.exports = {
  resolvePublicBalance,
  getPublicUserPayload,
};
