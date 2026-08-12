/**
 * Client for the confidential impostor prediction market.
 * Picks are encrypted before they leave the browser, so the on-chain board stays
 * unreadable until the round settles.
 */
import { formatEther, parseEther } from 'viem';
import { INCO_CONFIG, isMarketConfigured } from './config';
import { IMPOSTOR_MARKET_ABI, IMPOSTOR_MARKET_FACTORY_ABI, MARKET_PHASE } from './marketAbi';
import {
  attestationSignatures,
  attestationValue,
  getZap,
  prepareIncoWallet,
  revealIncoRole,
} from './client';
import { formatWalletError, getPublicClient } from './wallet';
import { wakeMetaMask, withMetaMaskOverlay } from './mmOverlay';

const ZERO = '0x0000000000000000000000000000000000000000';

const factoryArgs = () => ({
  address: INCO_CONFIG.marketFactoryAddress,
  abi: IMPOSTOR_MARKET_FACTORY_ABI,
});

const marketArgs = (address) => ({ address, abi: IMPOSTOR_MARKET_ABI });

const requireMarketConfigured = () => {
  if (!isMarketConfigured()) {
    throw new Error(
      'Prediction market not deployed. Run: cd inco && npm run deploy:market:testnet, then npm run build:inco',
    );
  }
};

async function withRetry(fn, tries = 10, delayMs = 2500) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

/** Address of the market for a match, or null if it hasn't been opened. */
export async function findMarket(matchId) {
  if (!isMarketConfigured()) return null;
  const publicClient = await getPublicClient(undefined, INCO_CONFIG.network);
  const address = await publicClient.readContract({
    ...factoryArgs(),
    functionName: 'marketOfMatch',
    args: [BigInt(matchId)],
  });
  return address && address !== ZERO ? address : null;
}

/** Host opens the market right after roles are dealt. Idempotent per match. */
export async function openMarket(matchId, candidates, onStatus) {
  try {
    requireMarketConfigured();
    const existing = await findMarket(matchId);
    if (existing) {
      if (onStatus) onStatus('Prediction market already open ✓');
      return { address: existing, hash: null, alreadyOpen: true };
    }

    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);
    if (onStatus) onStatus('MetaMask → open prediction market');

    const hash = await withMetaMaskOverlay('Confirm — open the impostor market', async () => {
      await wakeMetaMask();
      return client.writeContract({
        ...factoryArgs(),
        functionName: 'createMarket',
        args: [BigInt(matchId), candidates],
        account,
        chain: client.chain,
        gas: 3500000n,
      });
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') throw new Error('createMarket reverted on-chain.');

    const address = await findMarket(matchId);
    if (!address) throw new Error('Market created but address not found — check the factory.');
    if (onStatus) onStatus('Prediction market open ✓');
    return { address, hash };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

/** Pot, phase and bet count for the UI. */
export async function readMarket(marketAddress, viewer) {
  const publicClient = await getPublicClient(undefined, INCO_CONFIG.network);
  const [phase, pot, bets, winningIndex, impostor, winningStake, settledAt] =
    await publicClient.readContract({
      ...marketArgs(marketAddress),
      functionName: 'summary',
    });

  const result = {
    address: marketAddress,
    phase: MARKET_PHASE[Number(phase)] || 'unknown',
    pot,
    potEth: formatEther(pot),
    bets: Number(bets),
    winningIndex: Number(winningIndex),
    impostor: impostor === ZERO ? null : impostor,
    winningStake,
    settledAt: Number(settledAt),
    myStake: 0n,
    myBetPlaced: false,
    myPayout: 0n,
    myClaimed: false,
    myWinner: false,
  };

  if (viewer) {
    const [stake, pick, proven, winner, claimed] = await publicClient.readContract({
      ...marketArgs(marketAddress),
      functionName: 'betOf',
      args: [viewer],
    });
    result.myStake = stake;
    result.myStakeEth = formatEther(stake);
    result.myBetPlaced = stake > 0n;
    result.myPick = Number(pick);
    result.myProven = proven;
    result.myWinner = winner;
    result.myClaimed = claimed;
    result.myPayout = await publicClient.readContract({
      ...marketArgs(marketAddress),
      functionName: 'payoutOf',
      args: [viewer],
    });
    result.myPayoutEth = formatEther(result.myPayout);
  }

  return result;
}

/** Candidate wallets in market order; the 1-based position is what bettors encrypt. */
export async function readCandidates(marketAddress) {
  const publicClient = await getPublicClient(undefined, INCO_CONFIG.network);
  const count = Number(
    await publicClient.readContract({
      ...marketArgs(marketAddress),
      functionName: 'candidateCount',
    }),
  );
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const address = await publicClient.readContract({
      ...marketArgs(marketAddress),
      functionName: 'candidates',
      args: [BigInt(i)],
    });
    out.push({ address: String(address).toLowerCase(), index: i + 1 });
  }
  return out;
}

/** Minimum msg.value: stake floor plus the Inco encrypted-input fee. */
export async function readMinBet(marketAddress) {
  const publicClient = await getPublicClient(undefined, INCO_CONFIG.network);
  return publicClient.readContract({
    ...marketArgs(marketAddress),
    functionName: 'minBetValue',
  });
}

/**
 * Encrypt a candidate pick and stake ETH on it.
 * @param candidateIndex 1-based index into the market's candidate list
 */
export async function placeBet(marketAddress, candidateIndex, stakeEth, onStatus) {
  try {
    requireMarketConfigured();
    if (!candidateIndex || candidateIndex < 1) throw new Error('Pick a player first.');

    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);

    const existing = await publicClient.readContract({
      ...marketArgs(marketAddress),
      functionName: 'betOf',
      args: [account],
    });
    if (existing[0] > 0n) {
      if (onStatus) onStatus('You already have a bet on this round');
      return { hash: null, alreadyBet: true };
    }

    const fee = await publicClient.readContract({
      ...marketArgs(marketAddress),
      functionName: 'betFee',
    });
    const stake = parseEther(String(stakeEth));
    const value = stake + fee;

    if (onStatus) onStatus('Encrypting your pick…');
    const zap = await getZap();
    const ciphertext = await zap.encrypt(BigInt(candidateIndex), {
      accountAddress: account,
      dappAddress: marketAddress,
    });

    if (onStatus) onStatus(`MetaMask → stake ${formatEther(stake)} ETH on your pick`);
    const hash = await withMetaMaskOverlay(
      `Confirm bet — ${formatEther(stake)} ETH on a sealed pick`,
      async () => {
        await wakeMetaMask();
        return client.writeContract({
          ...marketArgs(marketAddress),
          functionName: 'bet',
          args: [ciphertext],
          account,
          chain: client.chain,
          value,
          gas: 1200000n,
        });
      },
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') throw new Error('bet reverted on-chain.');
    if (onStatus) onStatus('Bet placed — your pick stays encrypted ✓');
    return { hash, stake, account };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

/** Close betting — called by the host when the final vote begins. */
export async function lockBetting(marketAddress, onStatus) {
  try {
    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);
    const summary = await readMarket(marketAddress);
    if (summary.phase !== 'betting') return { hash: null, alreadyLocked: true };

    if (onStatus) onStatus('MetaMask → close betting');
    const hash = await withMetaMaskOverlay('Confirm — close betting', async () => {
      await wakeMetaMask();
      return client.writeContract({
        ...marketArgs(marketAddress),
        functionName: 'lockBetting',
        account,
        chain: client.chain,
        gas: 200000n,
      });
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return { hash };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

/**
 * Find the impostor by revealing each market candidate on-chain.
 * Used when the server never attached impostorWallet to gameOver.
 */
export async function findImpostorAmongCandidates(marketAddress, onStatus) {
  const candidates = await readCandidates(marketAddress);
  if (!candidates.length) throw new Error('Market has no candidates.');

  for (let i = 0; i < candidates.length; i += 1) {
    const who = candidates[i].address;
    if (onStatus) {
      onStatus(`Scanning roles on-chain (${i + 1}/${candidates.length})…`);
    }
    const revealed = await revealIncoRole(who);
    if (revealed.wasImpostor) {
      return { address: who, revealed };
    }
  }
  throw new Error('No impostor found among market candidates — roles may not be assigned.');
}

/**
 * Settle the market by proving who the impostor was.
 * Pass impostorAddress when known; otherwise scans every candidate on-chain.
 */
export async function settleMarket(marketAddress, impostorAddress, onStatus) {
  try {
    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);

    const summary = await readMarket(marketAddress);
    if (
      summary.phase === 'settled' ||
      summary.phase === 'finalized' ||
      summary.phase === 'refunding'
    ) {
      return { hash: null, alreadySettled: true };
    }

    let who = impostorAddress;
    let revealed;
    if (who) {
      if (onStatus) onStatus('Revealing the impostor role on-chain…');
      revealed = await revealIncoRole(who);
      if (!revealed.wasImpostor) {
        // Server tip was wrong — fall back to a full scan
        if (onStatus) onStatus('Hint was not the impostor — scanning all candidates…');
        const found = await findImpostorAmongCandidates(marketAddress, onStatus);
        who = found.address;
        revealed = found.revealed;
      }
    } else {
      const found = await findImpostorAmongCandidates(marketAddress, onStatus);
      who = found.address;
      revealed = found.revealed;
    }

    if (!revealed.signatures || !revealed.signatures.length) {
      throw new Error('No covalidator signatures for the reveal — try again in a moment.');
    }

    if (onStatus) onStatus('MetaMask → settle the market');
    const hash = await withMetaMaskOverlay('Confirm — settle the impostor market', async () => {
      await wakeMetaMask();
      return client.writeContract({
        ...marketArgs(marketAddress),
        functionName: 'settle',
        args: [who, revealed.value, revealed.signatures],
        account,
        chain: client.chain,
        gas: 900000n,
      });
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') throw new Error('settle reverted on-chain.');
    if (onStatus) onStatus('Market settled ✓ winners can claim');
    return { hash, impostor: who };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

/**
 * Prove a winning pick: reveal your own encrypted pick, then attest it on-chain.
 * Losing picks are never revealed.
 */
export async function proveWin(marketAddress, onStatus) {
  try {
    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);

    const handle = await publicClient.readContract({
      ...marketArgs(marketAddress),
      functionName: 'pickHandleOf',
      args: [account],
    });
    if (!handle || /^0x0+$/.test(handle)) throw new Error('You did not bet on this round.');

    if (onStatus) onStatus('MetaMask → reveal your pick');
    const revealHash = await withMetaMaskOverlay(
      'Confirm — reveal your pick to claim',
      async () => {
        await wakeMetaMask();
        return client.writeContract({
          ...marketArgs(marketAddress),
          functionName: 'revealMyPick',
          account,
          chain: client.chain,
          gas: 400000n,
        });
      },
    );
    await publicClient.waitForTransactionReceipt({ hash: revealHash });

    if (onStatus) onStatus('Waiting for covalidator attestation…');
    const zap = await getZap();
    const results = await withRetry(() => zap.attestedReveal([handle]));
    const first = results && results[0];
    const value = BigInt(attestationValue(first));
    const signatures = attestationSignatures(first);
    if (!signatures.length) throw new Error('No attestation signatures yet — retry shortly.');

    if (onStatus) onStatus('MetaMask → prove your winning pick');
    const hash = await withMetaMaskOverlay('Confirm — prove your winning pick', async () => {
      await wakeMetaMask();
      return client.writeContract({
        ...marketArgs(marketAddress),
        functionName: 'proveWin',
        args: [value, signatures],
        account,
        chain: client.chain,
        gas: 900000n,
      });
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      throw new Error('proveWin reverted — your pick was wrong, or the claim window closed.');
    }
    if (onStatus) onStatus('Winning pick proven ✓ claim once the window closes');
    return { hash, pick: Number(value) };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

/** Close the prove window and lock in the payout ratio. */
export async function finalizeMarket(marketAddress, onStatus) {
  try {
    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);
    if (onStatus) onStatus('MetaMask → finalize payouts');
    const hash = await withMetaMaskOverlay('Confirm — finalize payouts', async () => {
      await wakeMetaMask();
      return client.writeContract({
        ...marketArgs(marketAddress),
        functionName: 'finalize',
        account,
        chain: client.chain,
        gas: 200000n,
      });
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return { hash };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

/** Withdraw winnings (or a refund if the market was unwound). */
export async function claimWinnings(marketAddress, onStatus) {
  try {
    const { client, account, meta } = await prepareIncoWallet();
    const publicClient = await getPublicClient(meta.rpcUrl, meta.network);

    const payout = await publicClient.readContract({
      ...marketArgs(marketAddress),
      functionName: 'payoutOf',
      args: [account],
    });
    if (payout === 0n) throw new Error('Nothing to claim on this market.');

    if (onStatus) onStatus(`MetaMask → claim ${formatEther(payout)} ETH`);
    const hash = await withMetaMaskOverlay(
      `Confirm — claim ${formatEther(payout)} ETH`,
      async () => {
        await wakeMetaMask();
        return client.writeContract({
          ...marketArgs(marketAddress),
          functionName: 'claim',
          account,
          chain: client.chain,
          gas: 300000n,
        });
      },
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') throw new Error('claim reverted on-chain.');
    if (onStatus) onStatus(`Claimed ${formatEther(payout)} ETH ✓`);
    return { hash, payout };
  } catch (err) {
    throw new Error(formatWalletError(err, INCO_CONFIG.network));
  }
}

export { isMarketConfigured };
