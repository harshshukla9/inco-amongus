/**
 * Webpack-safe facade over the esbuild IIFE (`static/inco.bundle.js`).
 * Do not import ./client or ./wallet here — those pull viem/@inco which Webpack 4 cannot parse.
 */

function api() {
  const g = typeof window !== 'undefined' ? window.AmongUsInco : null;
  if (!g || typeof g.isIncoConfigured !== 'function') {
    throw new Error(
      'Inco client not loaded. Ensure static/inco.bundle.js is built (npm run build:inco) and included before the game bundle.',
    );
  }
  return g;
}

export const INCO_CONFIG = new Proxy(
  {},
  {
    get(_t, prop) {
      return api().INCO_CONFIG[prop];
    },
  },
);

export const isIncoConfigured = (...a) => api().isIncoConfigured(...a);
export const roleFromValue = (...a) => api().roleFromValue(...a);
export const prepareIncoWallet = (...a) => api().prepareIncoWallet(...a);
export const switchToIncoNetwork = (...a) => api().switchToIncoNetwork(...a);
export const readDeckFee = (...a) => api().readDeckFee(...a);
export const openIncoMatch = (...a) => api().openIncoMatch(...a);
export const joinIncoMatch = (...a) => api().joinIncoMatch(...a);
export const waitForOnChainSeats = (...a) => api().waitForOnChainSeats(...a);
export const assignIncoRoles = (...a) => api().assignIncoRoles(...a);
export const formatWalletError = (...a) => {
  try {
    return api().formatWalletError(...a);
  } catch (_) {
    return (a[0] && (a[0].shortMessage || a[0].message)) || 'Inco error';
  }
};
export const peekMyIncoRole = (...a) => api().peekMyIncoRole(...a);
export const revealIncoRole = (...a) => api().revealIncoRole(...a);
export const connectWallet = (...a) => api().connectWallet(...a);
export const switchToDefaultIncoChain = (...a) => api().switchToDefaultIncoChain(...a);
export const walletDiagnostics = (...a) => api().walletDiagnostics(...a);
export const onChainChanged = (...a) => {
  try {
    return api().onChainChanged(...a);
  } catch (_) {
    return () => {};
  }
};
export const targetNetworkLabel = (...a) => {
  try {
    return api().targetNetworkLabel(...a);
  } catch (_) {
    return 'Base Sepolia';
  }
};
export const isWalletAvailable = (...a) => {
  try {
    return api().isWalletAvailable(...a);
  } catch (_) {
    return typeof window !== 'undefined' && Boolean(window.ethereum);
  }
};
export const getCachedAddress = (...a) => {
  try {
    return api().getCachedAddress(...a);
  } catch (_) {
    return null;
  }
};

export const isMarketConfigured = (...a) => {
  try {
    return api().isMarketConfigured(...a);
  } catch (_) {
    return false;
  }
};
export const readMatchSnapshot = (...a) => api().readMatchSnapshot(...a);
export const findMarket = (...a) => api().findMarket(...a);
export const openMarket = (...a) => api().openMarket(...a);
export const readMarket = (...a) => api().readMarket(...a);
export const readCandidates = (...a) => api().readCandidates(...a);
export const readMinBet = (...a) => api().readMinBet(...a);
export const placeBet = (...a) => api().placeBet(...a);
export const lockBetting = (...a) => api().lockBetting(...a);
export const settleMarket = (...a) => api().settleMarket(...a);
export const findImpostorAmongCandidates = (...a) => api().findImpostorAmongCandidates(...a);
export const proveWin = (...a) => api().proveWin(...a);
export const finalizeMarket = (...a) => api().finalizeMarket(...a);
export const claimWinnings = (...a) => api().claimWinnings(...a);
