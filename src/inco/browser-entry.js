/**
 * Esbuild IIFE entry — `globalName: AmongUsInco` on window.
 * Webpack 4 cannot parse modern viem / @inco ESM, so this is built separately.
 */
export {
  INCO_CONFIG,
  isIncoConfigured,
  roleFromValue,
  prepareIncoWallet,
  switchToIncoNetwork,
  readDeckFee,
  openIncoMatch,
  joinIncoMatch,
  waitForOnChainSeats,
  assignIncoRoles,
  peekMyIncoRole,
  revealIncoRole,
  readMatchSnapshot,
  formatWalletError,
} from './client';
export {
  connectWallet,
  isWalletAvailable,
  getCachedAddress,
  fundLocalWallet,
  switchToDefaultIncoChain,
  targetChainIdHex,
  targetNetworkLabel,
  getCurrentChainId,
  walletDiagnostics,
  activeProviderName,
  onChainChanged,
  onAccountsChanged,
  refreshProviders,
} from './wallet';
export { listProviders, selectProvider, isNonMetaMask } from './provider';
export {
  isMarketConfigured,
  findMarket,
  openMarket,
  readMarket,
  readCandidates,
  readMinBet,
  placeBet,
  lockBetting,
  settleMarket,
  findImpostorAmongCandidates,
  proveWin,
  finalizeMarket,
  claimWinnings,
} from './market';
