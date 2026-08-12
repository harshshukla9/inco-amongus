/**
 * EIP-6963 provider discovery.
 *
 * `window.ethereum` is whichever extension injected last, so with Phantom /
 * Coinbase / Brave installed it can point at a wallet that ignores
 * `wallet_switchEthereumChain` for Base Sepolia. Resolve the real MetaMask
 * provider instead of trusting the global.
 */

const discovered = new Map();
let selectedUuid = null;
let legacyOverride = null;

const isBrowser = () => typeof window !== 'undefined';

function recordAnnouncement(event) {
  const detail = event && event.detail;
  if (!detail || !detail.info || !detail.provider) return;
  discovered.set(detail.info.uuid, detail);
}

if (isBrowser()) {
  window.addEventListener('eip6963:announceProvider', recordAnnouncement);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** Ask wallets to re-announce (extensions can load after first paint). */
export function refreshProviders() {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

function legacyCandidates() {
  if (!isBrowser() || !window.ethereum) return [];
  const eth = window.ethereum;
  return Array.isArray(eth.providers) && eth.providers.length ? eth.providers : [eth];
}

export function listProviders() {
  const out = [];
  discovered.forEach(({ info, provider }) => {
    out.push({
      uuid: info.uuid,
      name: info.name,
      rdns: info.rdns,
      provider,
    });
  });
  if (!out.length) {
    legacyCandidates().forEach((provider, i) => {
      out.push({
        uuid: `legacy-${i}`,
        name: provider.isMetaMask
          ? 'MetaMask'
          : provider.isCoinbaseWallet
            ? 'Coinbase Wallet'
            : provider.isPhantom
              ? 'Phantom'
              : 'Injected Wallet',
        rdns: provider.isMetaMask ? 'io.metamask' : 'unknown',
        provider,
      });
    });
  }
  return out;
}

function pickMetaMask(all) {
  return (
    all.find((p) => p.rdns === 'io.metamask') ||
    all.find(
      (p) =>
        p.provider &&
        p.provider.isMetaMask &&
        !p.provider.isBraveWallet &&
        !p.provider.isPhantom,
    ) ||
    null
  );
}

/**
 * Provider used for every Inco call. Prefers an explicit selection, then
 * MetaMask, then any injected EVM wallet.
 */
export function getProvider() {
  if (legacyOverride) return legacyOverride;

  const all = listProviders();
  if (selectedUuid) {
    const chosen = all.find((p) => p.uuid === selectedUuid);
    if (chosen) return chosen.provider;
  }

  const mm = pickMetaMask(all);
  if (mm) return mm.provider;
  if (all.length) return all[0].provider;
  return isBrowser() ? window.ethereum || null : null;
}

export function selectProvider(uuid) {
  selectedUuid = uuid;
  legacyOverride = null;
  return getProvider();
}

export function setProviderInstance(provider) {
  legacyOverride = provider || null;
  return getProvider();
}

/** Human label for the active provider, for UI/debugging. */
export function activeProviderName() {
  const provider = getProvider();
  if (!provider) return 'none';
  const match = listProviders().find((p) => p.provider === provider);
  if (match) return match.name;
  if (provider.isMetaMask) return 'MetaMask';
  return 'Injected Wallet';
}

export function hasProvider() {
  return Boolean(getProvider());
}

/** True when the resolved provider is not MetaMask (common misconfig). */
export function isNonMetaMask() {
  const provider = getProvider();
  return Boolean(provider) && !provider.isMetaMask;
}

export async function request(args) {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No EVM wallet found. Install MetaMask.');
  }
  return provider.request(args);
}

export function onChainChanged(handler) {
  const provider = getProvider();
  if (!provider || !provider.on) return () => {};
  provider.on('chainChanged', handler);
  return () => {
    if (provider.removeListener) provider.removeListener('chainChanged', handler);
  };
}

export function onAccountsChanged(handler) {
  const provider = getProvider();
  if (!provider || !provider.on) return () => {};
  provider.on('accountsChanged', handler);
  return () => {
    if (provider.removeListener) provider.removeListener('accountsChanged', handler);
  };
}
