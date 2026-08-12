import { Lightning } from '@inco/lightning-js/lite';
import { bytesToHex, formatEther } from 'viem';
import { AMONG_US_ROLES_ABI } from './abi';
import { INCO_CONFIG, isIncoConfigured } from './config';
import { wakeMetaMask, withMetaMaskOverlay } from './mmOverlay';
import {
  connectWallet,
  formatWalletError,
  fundLocalWallet,
  getCurrentChainId,
  getPublicClient,
  getWalletClient,
  walletDiagnostics,
} from './wallet';

const ZERO = '0x0000000000000000000000000000000000000000';

const networkMeta = () => {
  if (INCO_CONFIG.network === 'local') {
    return {
      chainIdHex: '0x7a69', // 31337
      rpcUrl: 'http://127.0.0.1:8545',
      localZap: true,
      network: 'local',
    };
  }
  return {
    chainIdHex: '0x14a34', // Base Sepolia 84532
    rpcUrl: 'https://sepolia.base.org',
    localZap: false,
    network: 'baseSepolia',
  };
};

function isTransientDecryptError(err) {
  const msg = String((err && (err.shortMessage || err.message)) || err || '');
  // Don't burn 30s retrying programming / wallet rejection errors
  if (/is not a function|not configured|user rejected|denied|cancelled|canceled/i.test(msg)) {
    return false;
  }
  return true;
}

async function withRetry(fn, tries = 12, delayMs = 2500) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransientDecryptError(err) || i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

// Lightning.baseSepoliaTestnet() / localNode() return Promises — must await
let zapCache = null;
let zapCacheKey = null;

export async function getZap() {
  const meta = networkMeta();
  const key = meta.localZap ? 'local' : 'baseSepolia';
  if (zapCache && zapCacheKey === key) return zapCache;
  zapCacheKey = key;
  zapCache = meta.localZap
    ? await Lightning.localNode('mainnet')
    : await Lightning.baseSepoliaTestnet({
        hostChainRpcUrls: [meta.rpcUrl],
      });
  return zapCache;
}

/** Covalidator signatures as hex, for on-chain e.verifyDecryption. */
export function attestationSignatures(attestation) {
  const sigs = (attestation && attestation.covalidatorSignatures) || [];
  return sigs.map((s) => (typeof s === 'string' ? s : bytesToHex(s)));
}

/** Plaintext out of an attestation, tolerating both response shapes. */
export function attestationValue(attestation) {
  if (!attestation) return null;
  if (attestation.plaintext != null) return attestation.plaintext.value;
  if (attestation.value != null) return attestation.value;
  return attestation;
}

function contractArgs() {
  return {
    address: INCO_CONFIG.contractAddress,
    abi: AMONG_US_ROLES_ABI,
  };
}

/**
 * Map deck value to game role. Impostor iff value <= impostorCount.
 */
export function roleFromValue(value, impostorCount = INCO_CONFIG.impostorCount) {
  const v = typeof value === 'bigint' ? Number(value) : Number(value);
  return v > 0 && v <= impostorCount ? 'impostor' : 'crewmate';
}

function networkLabel(meta) {
  return meta.network === 'local' ? 'Anvil Local (31337)' : 'Base Sepolia (84532)';
}

/**
 * Connect + force MetaMask onto the configured Inco network (shows overlay).
 */
export async function switchToIncoNetwork(onStatus) {
  if (!isIncoConfigured()) {
    throw new Error('Inco contract not configured. Set INCO_ROLES_ADDRESS after deploy.');
  }
  const meta = networkMeta();
  // connectWallet already switches by default
  if (onStatus) onStatus(`Wallet → ${networkLabel(meta)} (auto-switch)`);
  await withMetaMaskOverlay(`Switching to ${networkLabel(meta)}…`, async () => {
    await connectWallet({ chainIdHex: meta.chainIdHex, switchNetwork: true });
  });
  const current = await getCurrentChainId();
  if (current !== meta.chainIdHex.toLowerCase()) {
    const diag = await walletDiagnostics();
    throw new Error(
      `${diag.walletName} is on chain ${current}, need ${meta.chainIdHex} (${networkLabel(meta)}).`,
    );
  }
  return meta;
}

export async function prepareIncoWallet() {
  if (!isIncoConfigured()) {
    throw new Error('Inco contract not configured. Set INCO_ROLES_ADDRESS after deploy.');
  }
  const meta = await switchToIncoNetwork();
  const { client, account } = await getWalletClient(meta.network);

  if (meta.network === 'local') {
    try {
      await fundLocalWallet(account, meta.rpcUrl);
    } catch (err) {
      console.warn('Local faucet skipped', err);
    }
  }

  return { client, account, meta };
}

async function maybeRecoverMatch(client, account, meta) {
  const publicClient = await getPublicClient(meta.rpcUrl, meta.network);
  const state = Number(
    await publicClient.readContract({
      ...contractArgs(),
      functionName: 'state',
    }),
  );
  const host = String(
    await publicClient.readContract({
      ...contractArgs(),
      functionName: 'host',
    }),
  ).toLowerCase();
  const me = String(account).toLowerCase();
  // 0 Idle, 1 Joining, 2 Assigned
  if (state === 0) return;

  if (state === 2) {
    await withMetaMaskOverlay('Approve MetaMask: reset previous match', async () => {
      await wakeMetaMask();
      const hash = await client.writeContract({
        ...contractArgs(),
        functionName: 'reset',
        account,
        chain: client.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    });
    return;
  }

  if (state === 1) {
    // New contracts: forceCancel (anyone). Fallback: cancelMatch (host) / reopen.
    const tryCancel = async (fnName) => {
      await withMetaMaskOverlay(`Approve MetaMask: ${fnName}`, async () => {
        await wakeMetaMask();
        const hash = await client.writeContract({
          ...contractArgs(),
          functionName: fnName,
          account,
          chain: client.chain,
          gas: 400000n,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      });
    };
    try {
      await tryCancel('forceCancel');
      return;
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (host === me || !host || host === ZERO.toLowerCase()) {
        try {
          await tryCancel('cancelMatch');
          return;
        } catch (err2) {
          console.warn('cancel unavailable; host reopen via openMatch', err2);
          return;
        }
      }
      if (/forceCancel|cancelMatch|function selector|does not exist/i.test(msg)) {
        throw new Error(
          `On-chain match stuck in Joining under host ${host.slice(0, 6)}…${host.slice(-4)}. ` +
            'Redeploy AmongUsRoles or have that host cancel.',
        );
      }
      throw err;
    }
  }
}

export async function readDeckFee(playerCount) {
  const meta = networkMeta();
  const publicClient = await getPublicClient(meta.rpcUrl, meta.network);
  return publicClient.readContract({
    ...contractArgs(),
    functionName: 'deckFee',
    args: [playerCount],
  });
}

export async function readOnChainPlayerCount() {
  const meta = networkMeta();
  const publicClient = await getPublicClient(meta.rpcUrl, meta.network);
  return publicClient.readContract({
    ...contractArgs(),
    functionName: 'playerCount',
  });
}

async function readMatchState(publicClient) {
  return Number(
    await publicClient.readContract({ ...contractArgs(), functionName: 'state' }),
  );
}

/** Poll until contract state is Joining (1). */
async function waitUntilJoining(publicClient, onStatus, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readMatchState(publicClient);
    // 0 Idle, 1 Joining, 2 Assigned
    if (state === 1) return state;
    if (state === 2) {
      throw new Error('Match already assigned roles — ask host to start a new lobby.');
    }
    if (onStatus) onStatus('Waiting for host openMatch on-chain…');
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error(
    'Timed out waiting for host to open the match. Host: click START and Approve openMatch in MetaMask.',
  );
}

/**
 * Host opens on-chain match (cheap). Shuffle fee is paid later in assignRoles.
 */
export async function openIncoMatch(expectedPlayers, onStatus) {
  try {
    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);
    await maybeRecoverMatch(client, account, meta);

    // Already open under this host — skip a second openMatch
    const before = await readMatchState(publicClient);
    if (before === 1) {
      const host = String(
        await publicClient.readContract({ ...contractArgs(), functionName: 'host' }),
      ).toLowerCase();
      if (host === String(account).toLowerCase()) {
        if (onStatus) onStatus('Match already open on-chain ✓');
        return { hash: null, account, alreadyOpen: true };
      }
    }

    const msg = `Confirm openMatch (${expectedPlayers} seats)`;
    if (onStatus) onStatus(`MetaMask → ${msg}`);
    const hash = await withMetaMaskOverlay(msg, async () => {
      await wakeMetaMask();
      return client.writeContract({
        ...contractArgs(),
        functionName: 'openMatch',
        args: [expectedPlayers],
        account,
        chain: client.chain,
        gas: 800000n,
      });
    });
    if (onStatus) onStatus(`openMatch submitted… ${hash.slice(0, 10)}…`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      throw new Error('openMatch transaction reverted on-chain.');
    }

    // Public RPC can lag — don't join until state is actually Joining
    await waitUntilJoining(publicClient, onStatus, 45000);
    if (onStatus) onStatus('Match open on-chain ✓');
    return { hash, account };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

/**
 * Current wallet joins the open match.
 * Waits for host openMatch if needed. Idempotent if already seated.
 */
export async function joinIncoMatch(onStatus, opts = {}) {
  try {
    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);
    const waitForOpenMs = opts.waitForOpenMs != null ? opts.waitForOpenMs : 90000;

    let state = await readMatchState(publicClient);
    if (state === 0) {
      if (onStatus) onStatus('No match yet — waiting for host START / openMatch…');
      state = await waitUntilJoining(publicClient, onStatus, waitForOpenMs);
    }
    if (state === 2) {
      throw new Error('Match already assigned roles — ask host to start a new lobby.');
    }

    const already = await publicClient.readContract({
      ...contractArgs(),
      functionName: 'seated',
      args: [account],
    });
    if (already) {
      if (onStatus) onStatus('Already seated on-chain ✓ (skipped join tx)');
      return { hash: null, account, alreadySeated: true };
    }

    // Simulate first — reverting joins cause MetaMask "exceeds max gas limit"
    try {
      await publicClient.simulateContract({
        ...contractArgs(),
        functionName: 'join',
        account,
      });
    } catch (simErr) {
      const reason =
        (simErr && (simErr.shortMessage || simErr.cause?.reason || simErr.message)) || '';
      if (/already/i.test(reason)) {
        return { hash: null, account, alreadySeated: true };
      }
      if (/closed/i.test(reason)) {
        // Host may still be confirming openMatch — wait and retry once
        if (onStatus) onStatus('Match closed/not open — waiting for host…');
        await waitUntilJoining(publicClient, onStatus, waitForOpenMs);
      } else {
        throw new Error(
          `join would revert: ${String(reason).slice(0, 120)}. ` +
            'Each lobby player needs a different MetaMask account.',
        );
      }
    }

    if (onStatus) onStatus('MetaMask → Confirm join()');
    const hash = await withMetaMaskOverlay('Confirm join() — claim your encrypted seat', async () => {
      await wakeMetaMask();
      return client.writeContract({
        ...contractArgs(),
        functionName: 'join',
        account,
        chain: client.chain,
        gas: 300000n,
      });
    });
    if (onStatus) onStatus(`join submitted… ${hash.slice(0, 10)}…`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      throw new Error('join transaction reverted on-chain.');
    }
    return { hash, account };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

/**
 * Wait until on-chain seats >= minPlayers (other wallets must join).
 */
export async function waitForOnChainSeats(minPlayers, opts = {}) {
  const { timeoutMs = 90000, pollMs = 1500, onStatus } = opts;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = Number(await readOnChainPlayerCount());
    if (onStatus) onStatus(`On-chain seats ${count}/${minPlayers}…`);
    if (count >= minPlayers) return count;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `Timed out waiting for ${minPlayers} on-chain seats (only saw fewer). ` +
      'Each human needs a different MetaMask account on Base Sepolia — same wallet cannot join twice.',
  );
}

/**
 * Shuffle + deal private roles to all seated wallets.
 */
export async function assignIncoRoles(onStatus) {
  try {
    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);
    const n = Number(
      await publicClient.readContract({ ...contractArgs(), functionName: 'playerCount' }),
    );
    if (n < 2) {
      throw new Error('Need at least 2 on-chain seats before assignRoles.');
    }
    const fee = await readDeckFee(n);
    if (onStatus) {
      onStatus(
        `MetaMask → assignRoles (FHE shuffle, fee ${formatEther(fee)} ETH)`,
      );
    }
    // Bluff `deal{value:fee}` pattern: pay Lightning fee in the same tx as shuffle
    const hash = await withMetaMaskOverlay(
      `Confirm assignRoles — fee ${formatEther(fee)} ETH`,
      async () => {
        await wakeMetaMask();
        return client.writeContract({
          ...contractArgs(),
          functionName: 'assignRoles',
          account,
          chain: client.chain,
          value: fee,
          // shuffledRange + deals for small N; cap avoids broken estimateGas
          gas: 3_500_000n,
        });
      },
    );
    if (onStatus) onStatus(`assignRoles submitted… ${hash.slice(0, 10)}…`);
    await publicClient.waitForTransactionReceipt({ hash });
    return { hash };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

/** Current on-chain match id + seated players — used to open the prediction market. */
export async function readMatchSnapshot() {
  const publicClient = await getPublicClient(undefined, INCO_CONFIG.network);
  const [matchId, count] = await Promise.all([
    publicClient.readContract({ ...contractArgs(), functionName: 'matchId' }),
    publicClient.readContract({ ...contractArgs(), functionName: 'playerCount' }),
  ]);
  const players = [];
  for (let i = 0; i < Number(count); i += 1) {
    players.push(
      await publicClient.readContract({
        ...contractArgs(),
        functionName: 'playerAt',
        args: [BigInt(i)],
      }),
    );
  }
  return { matchId, players };
}

/**
 * Peek own role via attested decrypt. Returns { role, value, handle }.
 */
export async function peekMyIncoRole() {
  try {
    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);
    const handle = await publicClient.readContract({
      ...contractArgs(),
      functionName: 'myRoleHandle',
      account,
    });
    const zeroHandle = `0x${'0'.repeat(64)}`;
    if (!handle || handle === ZERO || handle === zeroHandle) {
      throw new Error('No role handle yet — join and wait for assignRoles.');
    }

    const zap = await getZap();
    if (typeof zap.attestedDecrypt !== 'function') {
      throw new Error('Inco Lightning client missing attestedDecrypt — rebuild with npm run build:inco');
    }
    const results = await withMetaMaskOverlay(
      'Sign Inco decrypt (attested peek of your role)',
      async () => {
        await wakeMetaMask();
        return withRetry(() => zap.attestedDecrypt(client, [handle]));
      },
    );
    const first = results && results[0];
    if (!first) {
      throw new Error('Decrypt returned no attestation — try again after assignRoles confirms.');
    }
    const raw =
      first.plaintext != null
        ? first.plaintext.value
        : first.value != null
          ? first.value
          : first;
    const value = BigInt(raw);
    const impostorCount = Number(
      await publicClient.readContract({
        ...contractArgs(),
        functionName: 'impostorCount',
      }),
    );
    return {
      handle,
      value,
      role: roleFromValue(value, impostorCount),
      account,
      sigs: (first.covalidatorSignatures || []).map((s) =>
        typeof s === 'string' ? s : bytesToHex(s),
      ),
    };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

/**
 * Reveal a player's role on-chain (eject), then read attested reveal.
 */
export async function revealIncoRole(playerAddress) {
  try {
    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);

    const handle = await publicClient.readContract({
      ...contractArgs(),
      functionName: 'roleHandleOf',
      args: [playerAddress],
    });

    const already = await publicClient.readContract({
      ...contractArgs(),
      functionName: 'isRevealed',
      args: [playerAddress],
    });
    if (!already) {
      const hash = await client.writeContract({
        ...contractArgs(),
        functionName: 'revealRole',
        args: [playerAddress],
        account,
        chain: client.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }

    const zap = await getZap();
    const results = await withRetry(() => zap.attestedReveal([handle]));
    const first = results && results[0];
    const raw =
      first && first.plaintext != null
        ? first.plaintext.value
        : first && first.value != null
          ? first.value
          : first;
    const value = BigInt(raw);
    const impostorCount = Number(
      await publicClient.readContract({
        ...contractArgs(),
        functionName: 'impostorCount',
      }),
    );
    return {
      handle,
      value,
      role: roleFromValue(value, impostorCount),
      wasImpostor: roleFromValue(value, impostorCount) === 'impostor',
      // The prediction market settles by verifying these on-chain
      signatures: attestationSignatures(first),
    };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

export { isIncoConfigured, INCO_CONFIG, formatWalletError };
