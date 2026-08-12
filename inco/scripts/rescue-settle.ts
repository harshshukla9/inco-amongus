import hre from "hardhat";
import fs from "fs";
import path from "path";
import { formatEther, toHex } from "viem";
import { Lightning } from "@inco/lightning-js/lite";

const MARKET = (process.env.MARKET ||
  "0x214e044a83979d31feA2C2Ddab108cF6957D6e64") as `0x${string}`;

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
      console.log(`  retry (${i + 1}/${tries})…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

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
      console.log(`  ${label} pending, retry…`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error(`${label} failed`);
}

/**
 * Rescue a market that never settled at game over: reveal roles, settle, then either
 * prove a win (if this wallet bet correctly) or leave it for the bettor to claim after
 * finalize / abandon.
 */
async function main() {
  const deploy = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../.inco-deploy.json"), "utf8"),
  );
  const publicClient = await hre.viem.getPublicClient();
  const [wallet] = await hre.viem.getWalletClients();
  const me = wallet.account.address;
  const roles = await hre.viem.getContractAt("AmongUsRoles", deploy.contractAddress);
  const m = await hre.viem.getContractAt("ImpostorMarket", MARKET);

  const summary = (await m.read.summary()) as any[];
  console.log("market", MARKET, "phase", summary[0], "pot", formatEther(summary[1]));
  if (Number(summary[0]) >= 2) {
    console.log("already settled — nothing to rescue via settle");
  } else {
    const impostorCount = Number(await roles.read.impostorCount());
    const count = Number(await m.read.candidateCount());
    const zap = await Lightning.baseSepoliaTestnet({
      hostChainRpcUrls: [process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"],
    });

    let impostor: `0x${string}` | null = null;
    let roleValue = 0n;
    let signatures: `0x${string}`[] = [];

    for (let i = 0; i < count; i += 1) {
      const who = (await m.read.candidates([BigInt(i)])) as `0x${string}`;
      const handle = (await m.read.roleHandleSnapshot([who])) as `0x${string}`;
      if (!(await roles.read.isRevealed([who]))) {
        console.log("revealing", who);
        await send("revealRole", () => roles.write.revealRole([who]), publicClient);
      }
      const res = await withRetry(() => zap.attestedReveal([handle]));
      const value = BigInt(plaintext(res?.[0]));
      const sigs = (res?.[0]?.covalidatorSignatures || []).map(asHex);
      console.log(who, "role", value.toString(), "sigs", sigs.length);
      if (value >= 1n && value <= BigInt(impostorCount)) {
        impostor = who;
        roleValue = value;
        signatures = sigs;
      }
    }
    if (!impostor) throw new Error("could not identify impostor from role reveals");
    console.log("settling impostor", impostor);
    await send(
      "settle",
      () => m.write.settle([impostor!, roleValue, signatures], { gas: 900000n }),
      publicClient,
    );
  }

  const after = (await m.read.summary()) as any[];
  console.log(
    "phase:",
    after[0],
    "impostor:",
    after[4],
    "winningIndex:",
    after[3].toString(),
  );

  // If THIS deployer also has a bet, try to prove + wait + finalize + claim
  const bet = (await m.read.betOf([me])) as any[];
  if ((bet[0] as bigint) > 0n && !bet[2]) {
    console.log("deployer has a bet — attempting proveWin…");
    const zap = await Lightning.baseSepoliaTestnet({
      hostChainRpcUrls: [process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"],
    });
    await send("revealMyPick", () => m.write.revealMyPick(), publicClient);
    const pickHandle = (await m.read.pickHandleOf([me])) as `0x${string}`;
    const pickRes = await withRetry(() => zap.attestedReveal([pickHandle]));
    const pickValue = BigInt(plaintext(pickRes?.[0]));
    const pickSigs = (pickRes?.[0]?.covalidatorSignatures || []).map(asHex);
    console.log("pick", pickValue.toString());
    try {
      await send(
        "proveWin",
        () => m.write.proveWin([pickValue, pickSigs], { gas: 900000n }),
        publicClient,
      );
    } catch (err: any) {
      console.log("proveWin failed (wrong pick or self-bet):", err?.shortMessage || err?.message);
    }
  }

  console.log("\nNext for bettor 0xdC4f…:");
  console.log("  1. Open game → press B → REVEAL PICK & PROVE WIN (within 3 min of settle)");
  console.log("  2. Wait for prove window, then FINALIZE, then CLAIM");
  console.log("  Or wait 6h from market create and anyone can abandon() → claim() refund");
  console.log("settledAt:", Number(after[6]), "now:", Math.floor(Date.now() / 1000));
}

main().catch((e) => {
  console.error(e?.shortMessage || e?.message || e);
  if (e?.metaMessages) console.error(e.metaMessages.join("\n"));
  process.exit(1);
});
