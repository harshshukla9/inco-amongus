/**
 * Minimal injected-wallet helper (MetaMask / browser wallets).
 * Avoids RainbowKit so Webpack 4 + Phaser stay light.
 */

import { createPublicClient, createWalletClient, custom, http, defineChain } from 'viem';
import { baseSepolia } from 'viem/chains';
import { INCO_CONFIG } from './config';
import {
  activeProviderName,
  getProvider,
  hasProvider,
  isNonMetaMask,
  onAccountsChanged,
  onChainChanged,
  refreshProviders,
  request,
} from './provider';

let cachedAddress = null;

export const getCachedAddress = () => cachedAddress;

export const isWalletAvailable = () => hasProvider();

/** Anvil / Hardhat local (Inco docker) */
export const anvilLocal = defineChain({
  id: 31337,
  name: 'Anvil Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
});

const CHAIN_PARAMS = {
  '0x14a34': {
    chainId: '0x14a34',
    chainName: 'Base Sepolia',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorerUrls: ['https://sepolia.basescan.org'],
  },
  '0x7a69': {
    chainId: '0x7a69',
    chainName: 'Anvil Local',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['http://127.0.0.1:8545'],
  },
};

/** Chain MetaMask should use for the current Inco deploy. */
export function targetChainIdHex() {
  return INCO_CONFIG.network === 'local' ? '0x7a69' : '0x14a34';
}

export function targetNetworkLabel() {
  return INCO_CONFIG.network === 'local'
    ? 'Anvil Local (31337)'
    : 'Base Sepolia (84532)';
}

export function chainForNetwork(network) {
  return network === 'local' ? anvilLocal : baseSepolia;
}

export async function getCurrentChainId() {
  if (!hasProvider()) return null;
  return String(await request({ method: 'eth_chainId' })).toLowerCase();
}

/** Snapshot for UI + debugging: which wallet, which chain, is it correct. */
export async function walletDiagnostics() {
  refreshProviders();
  const target = targetChainIdHex();
  const provider = getProvider();
  if (!provider) {
    return {
      hasWallet: false,
      walletName: 'none',
      chainId: null,
      target,
      onTarget: false,
      isMetaMask: false,
    };
  }
  let chainId = null;
  try {
    chainId = await getCurrentChainId();
  } catch (_) {
    chainId = null;
  }
  return {
    hasWallet: true,
    walletName: activeProviderName(),
    chainId,
    target,
    onTarget: chainId === target,
    isMetaMask: Boolean(provider.isMetaMask),
  };
}

async function addAndSwitch(normalized) {
  const params = CHAIN_PARAMS[normalized];
  if (!params) throw new Error(`Unknown chain ${normalized}`);
  await request({ method: 'wallet_addEthereumChain', params: [params] });
  await request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: normalized }],
  });
}

/**
 * Switch the active provider to `chainIdHex`, adding the network if needed.
 * Verifies the result — wallets can resolve the request without switching.
 */
export async function ensureChain(chainIdHex) {
  if (!hasProvider()) {
    throw new Error('No EVM wallet found. Install MetaMask.');
  }
  const normalized = String(chainIdHex).toLowerCase();
  const label = normalized === '0x7a69' ? 'Anvil Local (31337)' : 'Base Sepolia (84532)';

  if ((await getCurrentChainId()) === normalized) return;

  try {
    await request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: normalized }],
    });
  } catch (err) {
    const code = err && (err.code || (err.data && err.data.originalError && err.data.originalError.code));
    const msg = String((err && err.message) || '');

    if (code === 4001 || code === '4001' || /reject|denied/i.test(msg)) {
      throw new Error(`You rejected the switch to ${label}. Approve it in MetaMask, then retry.`);
    }

    // 4902 means the chain is unknown, but wallets report it inconsistently.
    // wallet_addEthereumChain is idempotent, so retry through it for known chains.
    if (!CHAIN_PARAMS[normalized]) throw err;
    await addAndSwitch(normalized);
  }

  // MetaMask resolves the promise before the switch lands; poll briefly.
  for (let i = 0; i < 10; i += 1) {
    if ((await getCurrentChainId()) === normalized) return;
    await new Promise((r) => setTimeout(r, 300));
  }

  const actual = await getCurrentChainId();
  const walletName = activeProviderName();
  throw new Error(
    isNonMetaMask()
      ? `${walletName} stayed on chain ${actual} instead of ${label}. Disable other wallet extensions or set MetaMask as default, then retry.`
      : `MetaMask stayed on chain ${actual}, expected ${normalized} (${label}). Switch it manually, then retry.`,
  );
}

/**
 * Connect wallet and switch to the Inco network by default (Base Sepolia or Anvil).
 */
export async function connectWallet(options = {}) {
  if (!hasProvider()) {
    throw new Error('No wallet found. Install MetaMask (or another injected wallet).');
  }
  const accounts = await request({ method: 'eth_requestAccounts' });
  cachedAddress = (accounts && accounts[0]) || null;

  const shouldSwitch = options.switchNetwork !== false; // default ON
  if (shouldSwitch && cachedAddress) {
    await ensureChain(options.chainIdHex || targetChainIdHex());
  }
  return cachedAddress;
}

/**
 * Switch to the configured Inco network without re-requesting accounts
 * (works if the site was already connected).
 */
export async function switchToDefaultIncoChain() {
  if (!hasProvider()) return false;
  await ensureChain(targetChainIdHex());
  return true;
}

/**
 * Local Anvil only: top-up the connected wallet so MetaMask can pay deck fees.
 */
export async function fundLocalWallet(address, rpcUrl = 'http://127.0.0.1:8545') {
  if (!address) return;
  const weiHex = '0x8AC7230489E80000'; // 10 ETH
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'anvil_setBalance',
      params: [address, weiHex],
    }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || 'anvil_setBalance failed');
  }
}

export async function getWalletClient(network = 'local') {
  const provider = getProvider();
  if (!provider) throw new Error('No wallet');
  const chain = chainForNetwork(network);
  const addresses = await request({ method: 'eth_requestAccounts' });
  const account = addresses && addresses[0];
  if (!account) throw new Error('No account');
  cachedAddress = account;
  const client = createWalletClient({
    account,
    chain,
    transport: custom(provider),
  });
  return { client, account, chain };
}

export async function getPublicClient(rpcUrl, network = 'local') {
  return createPublicClient({
    chain: chainForNetwork(network),
    transport: http(rpcUrl),
  });
}

export { onChainChanged, onAccountsChanged, activeProviderName, refreshProviders };

/**
 * Short human message from viem / wallet errors.
 * Only rewrites errors we can positively identify — a blanket "wrong network"
 * fallback hides the real failure.
 */
export function formatWalletError(err, networkHint) {
  if (!err) return 'Unknown wallet error';
  const text = String(
    err.shortMessage ||
      err.details ||
      (typeof err.message === 'string' ? err.message : null) ||
      err,
  );
  const network = networkHint || INCO_CONFIG.network;
  const code = err && err.code;

  if (code === 4001 || code === '4001' || /user rejected|user denied|ACTION_REJECTED/i.test(text)) {
    return 'Rejected in wallet — approve the prompt and retry';
  }
  if (/exceeds max transaction gas|intrinsic gas too high|max fee/i.test(text)) {
    return (
      'Tx gas estimate failed (usually a revert). ' +
      'Common cause: same wallet already joined — each player needs a different MetaMask account.'
    );
  }
  if (/\balready\b/i.test(text)) {
    return 'This wallet is already seated on-chain. Use a different MetaMask account for the other player.';
  }
  if (/\bclosed\b/i.test(text)) {
    return 'Match not open — host must START (openMatch) before others join.';
  }
  if (/insufficient funds|exceeds balance/i.test(text)) {
    return network === 'local'
      ? 'Insufficient ETH — local Anvil auto-funds; retry'
      : 'Insufficient Base Sepolia ETH — fund this wallet, then retry';
  }
  // Chain mismatch messages are already specific; pass them through.
  if (/stayed on chain|expected 0x|rejected the switch/i.test(text)) {
    return text;
  }
  if (/chain .*(mismatch|does not match)|does not match the target chain/i.test(text)) {
    return `Wallet is on the wrong network — switch to ${targetNetworkLabel()}`;
  }
  if (text.length > 160 || /data:\s*0x/i.test(text)) {
    return `Wallet/tx error: ${text.slice(0, 140)}…`;
  }
  return text;
}
