/**
 * Inco / AmongUsRoles client config.
 * Set via webpack DefinePlugin or window.__INCO_CONFIG__ before game boot.
 */
const fromWindow =
  typeof window !== 'undefined' && window.__INCO_CONFIG__ ? window.__INCO_CONFIG__ : {};

const envAddress = process.env.INCO_ROLES_ADDRESS || '';
const envNetwork = process.env.INCO_NETWORK || 'baseSepolia';
const envEnabled = process.env.INCO_ENABLED === 'true';
const envMarketFactory = process.env.INCO_MARKET_FACTORY || '';

export const INCO_CONFIG = {
  // Deployed AmongUsRoles address (Base Sepolia or local anvil)
  contractAddress:
    fromWindow.contractAddress || envAddress || '0x0000000000000000000000000000000000000000',
  // ImpostorMarketFactory — prediction market is optional, game runs without it
  marketFactoryAddress:
    fromWindow.marketFactoryAddress ||
    envMarketFactory ||
    '0x0000000000000000000000000000000000000000',
  // 'baseSepolia' | 'local'
  network: fromWindow.network || envNetwork || 'baseSepolia',
  impostorCount: Number(
    fromWindow.impostorCount || process.env.INCO_IMPOSTOR_COUNT || 1,
  ),
  enabled: Boolean(
    fromWindow.enabled != null
      ? fromWindow.enabled
      : envEnabled ||
          Boolean(envAddress && envAddress !== '0x0000000000000000000000000000000000000000'),
  ),
};

const isRealAddress = (addr) =>
  Boolean(addr) &&
  addr !== '0x0000000000000000000000000000000000000000' &&
  /^0x[a-fA-F0-9]{40}$/.test(addr);

export const isIncoConfigured = () => isRealAddress(INCO_CONFIG.contractAddress);

export const isMarketConfigured = () =>
  isIncoConfigured() && isRealAddress(INCO_CONFIG.marketFactoryAddress);
