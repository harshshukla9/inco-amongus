import hre from "hardhat";
import fs from "fs";
import path from "path";
import { formatEther, toHex } from "viem";
import { Lightning } from "@inco/lightning-js/lite";

const asHex = (s: any) => (typeof s === "string" ? s : toHex(s));
const plaintext = (a: any) =>
  a?.plaintext?.value != null ? a.plaintext.value : a?.value != null ? a.value : a;

/**
 * Proves the settlement path end to end: reveal roles, find the impostor, and verify
 * the covalidator attestation on-chain through ImpostorMarket.settle.
 */
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

async function main() {
  const deploy = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../.inco-deploy.json"), "utf8"),
  );
  const market = (process.env.MARKET ||
    "0x77d64D31b0A57Ae28693f2D02304Aa5d02C76a34") as `0x${string}`;

  const publicClient = await hre.viem.getPublicClient();
  const roles = await hre.viem.getContractAt("AmongUsRoles", deploy.contractAddress);
  const m = await hre.viem.getContractAt("ImpostorMarket", market);

  const impostorCount = Number(await roles.read.impostorCount());
  const count = (await m.read.candidateCount()) as bigint;
  const zap = await Lightning.baseSepoliaTestnet({
    hostChainRpcUrls: [process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"],
  });

  let impostor: `0x${string}` | null = null;
  let roleValue = 0n;
  let signatures: string[] = [];

  for (let i = 0n; i < count; i += 1n) {
    const who = (await m.read.candidates([i])) as `0x${string}`;
    const handle = (await m.read.roleHandleSnapshot([who])) as `0x${string}`;
    if (!(await roles.read.isRevealed([who]))) {
      console.log("revealing role for", who);
      const hash = await roles.write.revealRole([who]);
      await publicClient.waitForTransactionReceipt({ hash });
    }
    // Reveal propagation to the covalidators lags the tx by a few seconds
    const results = await withRetry(() => zap.attestedReveal([handle]));
    const value = BigInt(plaintext(results?.[0]));
    const sigs = (results?.[0]?.covalidatorSignatures || []).map(asHex);
    console.log(who, "role value", value.toString(), "sigs", sigs.length);
    if (value >= 1n && value <= BigInt(impostorCount)) {
      impostor = who;
      roleValue = value;
      signatures = sigs;
    }
  }

  if (!impostor) throw new Error("no impostor found among candidates");
  console.log("impostor:", impostor, "roleValue:", roleValue.toString());

  const before = (await m.read.summary()) as any[];
  if (Number(before[0]) >= 2) {
    console.log("already settled, phase", before[0]);
    return;
  }

  console.log("settling…");
  const hash = await m.write.settle([impostor, roleValue, signatures as `0x${string}`[]]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("settle status:", receipt.status, "gas:", receipt.gasUsed.toString());

  const after = (await m.read.summary()) as any[];
  console.log(
    "phase:", after[0],
    "winningIndex:", after[3],
    "impostor:", after[4],
    "pot:", formatEther(after[1]),
  );
}

main().catch((e) => {
  console.error(e?.shortMessage || e?.message || e);
  process.exit(1);
});
