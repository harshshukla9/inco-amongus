import hre from "hardhat";
import fs from "fs";
import path from "path";
import { formatEther, toHex } from "viem";
import { Lightning } from "@inco/lightning-js/lite";

const asHex = (s: any) => (typeof s === "string" ? s : toHex(s));
const plaintext = (a: any) =>
  a?.plaintext?.value != null ? a.plaintext.value : a?.value != null ? a.value : a;

async function withRetry<T>(fn: () => Promise<T>, tries = 12, delayMs = 5000): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      console.log(`  attestation not ready (${i + 1}/${tries})…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

/**
 * Full winner path on a throwaway market: bet on the real impostor, settle, prove the
 * pick, finalize after the window, and claim. Deployed standalone so it doesn't consume
 * the factory slot for a live match.
 */
/// Base Sepolia caps in-flight txs for delegated (EIP-7702) accounts, so pace the sends.
async function send(label: string, fn: () => Promise<`0x${string}`>, publicClient: any) {
  for (let i = 0; i < 10; i += 1) {
    try {
      const hash = await fn();
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`${label}:`, receipt.status, "gas", receipt.gasUsed.toString());
      await new Promise((r) => setTimeout(r, 3000));
      return receipt;
    } catch (err: any) {
      const msg = String(err?.details || err?.message || err);
      if (!/in-flight transaction limit|replacement transaction|nonce/i.test(msg)) throw err;
      console.log(`  ${label} queued behind a pending tx, retrying…`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error(`${label} could not be submitted`);
}

async function main() {
  const deploy = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../.inco-deploy.json"), "utf8"),
  );
  const publicClient = await hre.viem.getPublicClient();
  const [wallet] = await hre.viem.getWalletClients();
  const me = wallet.account.address;
  const roles = await hre.viem.getContractAt("AmongUsRoles", deploy.contractAddress);

  const count = Number(await roles.read.playerCount());
  const impostorCount = Number(await roles.read.impostorCount());
  const players: `0x${string}`[] = [];
  for (let i = 0; i < count; i += 1) {
    players.push((await roles.read.playerAt([BigInt(i)])) as `0x${string}`);
  }

  const zap = await Lightning.baseSepoliaTestnet({
    hostChainRpcUrls: [process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"],
  });

  // Find the impostor and their attestation up front so we can bet on the right index
  let impostorIndex = 0;
  let impostor: `0x${string}` | null = null;
  let roleValue = 0n;
  let roleSigs: `0x${string}`[] = [];
  for (let i = 0; i < players.length; i += 1) {
    const who = players[i];
    const handle = (await roles.read.roleHandleOf([who])) as `0x${string}`;
    if (!(await roles.read.isRevealed([who]))) {
      const hash = await roles.write.revealRole([who]);
      await publicClient.waitForTransactionReceipt({ hash });
    }
    const res = await withRetry(() => zap.attestedReveal([handle]));
    const value = BigInt(plaintext(res?.[0]));
    if (value >= 1n && value <= BigInt(impostorCount)) {
      impostor = who;
      impostorIndex = i + 1;
      roleValue = value;
      roleSigs = (res?.[0]?.covalidatorSignatures || []).map(asHex);
    }
  }
  if (!impostor) throw new Error("no impostor among seated players");
  console.log("impostor is candidate", impostorIndex, impostor);

  console.log("deploying throwaway market…");
  const market = await hre.viem.deployContract("ImpostorMarket", [
    deploy.contractAddress,
    999999n,
    me,
    players,
  ]);
  console.log("market:", market.address);

  // Base Sepolia's public RPC is load balanced and lags; wait until the node sees the code
  for (let i = 0; i < 30; i += 1) {
    const code = await publicClient.getCode({ address: market.address });
    if (code && code !== "0x") break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const fee = (await withRetry(() => market.read.betFee(), 15, 2000)) as bigint;
  const stake = 20000000000000n;
  const ciphertext = await zap.encrypt(BigInt(impostorIndex), {
    accountAddress: me,
    dappAddress: market.address,
  });
  await send("bet", () => market.write.bet([ciphertext], { value: stake + fee }), publicClient);

  console.log("settling with", roleSigs.length, "sigs, value", roleValue.toString());
  await send(
    "settle",
    () => market.write.settle([impostor!, roleValue, roleSigs], { gas: 900000n }),
    publicClient,
  );

  await send("revealMyPick", () => market.write.revealMyPick(), publicClient);

  const pickHandle = (await market.read.pickHandleOf([me])) as `0x${string}`;
  const pickRes = await withRetry(() => zap.attestedReveal([pickHandle]));
  const pickValue = BigInt(plaintext(pickRes?.[0]));
  const pickSigs = (pickRes?.[0]?.covalidatorSignatures || []).map(asHex);
  console.log("revealed pick:", pickValue.toString(), "sigs", pickSigs.length);

  await send(
    "proveWin",
    () => market.write.proveWin([pickValue, pickSigs], { gas: 900000n }),
    publicClient,
  );

  const window = Number(await market.read.PROVE_WINDOW());
  console.log(`waiting ${window + 20}s for the prove window to close…`);
  await new Promise((r) => setTimeout(r, (window + 20) * 1000));

  await send("finalize", () => market.write.finalize(), publicClient);

  const payout = (await market.read.payoutOf([me])) as bigint;
  console.log("payout:", formatEther(payout), "ETH (staked", formatEther(stake), ")");

  const balBefore = await publicClient.getBalance({ address: me });
  await send("claim", () => market.write.claim(), publicClient);
  const balAfter = await publicClient.getBalance({ address: me });
  console.log("balance delta:", formatEther(balAfter - balBefore));
  const summary = (await market.read.summary()) as any[];
  console.log("final phase:", summary[0], "winningStake:", formatEther(summary[5]));
}

main().catch((e) => {
  console.error(e?.shortMessage || e?.message || e);
  if (e?.metaMessages) console.error(e.metaMessages.join("\n"));
  if (e?.cause?.message) console.error("cause:", e.cause.message);
  process.exit(1);
});
