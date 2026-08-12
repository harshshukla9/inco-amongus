import hre from "hardhat";
import { formatEther } from "viem";

const MARKET = (process.env.MARKET ||
  "0x214e044a83979d31feA2C2Ddab108cF6957D6e64") as `0x${string}`;
const WALLET = (
  process.env.WALLET || "0xdC4f1522f2dE9C4059F0845D6d54C2a9745C908f"
) as `0x${string}`;

async function main() {
  const publicClient = await hre.viem.getPublicClient();
  const m = await hre.viem.getContractAt("ImpostorMarket", MARKET);

  let summary = (await m.read.summary()) as any[];
  let phase = Number(summary[0]);
  const settledAt = Number(summary[6]);
  const window = Number(await m.read.PROVE_WINDOW());
  const unlockAt = settledAt + window;

  console.log("phase", phase, "proveWindow", window, "s");

  if (phase === 2) {
    while (true) {
      const now = Math.floor(Date.now() / 1000);
      if (now > unlockAt) break;
      const left = unlockAt - now;
      console.log(`prove window open — ${left}s left until finalize`);
      await new Promise((r) => setTimeout(r, Math.min(left + 5, 60) * 1000));
    }
    for (let i = 0; i < 10; i += 1) {
      try {
        const hash = await m.write.finalize();
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log("finalize:", receipt.status);
        break;
      } catch (err: any) {
        console.log("finalize retry:", String(err?.details || err?.message).slice(0, 140));
        await new Promise((r) => setTimeout(r, 8000));
      }
    }
  }

  summary = (await m.read.summary()) as any[];
  const payout = (await m.read.payoutOf([WALLET])) as bigint;
  const bet = (await m.read.betOf([WALLET])) as any[];
  console.log("final phase:", Number(summary[0]), "(3=Finalized 4=Refunding)");
  console.log(
    "claimable for",
    WALLET,
    ":",
    formatEther(payout),
    "ETH · proven",
    bet[2],
    "winner",
    bet[3],
    "claimed",
    bet[4],
  );
  if (payout > 0n) {
    console.log("READY — switch MetaMask to that wallet, open game, press B → CLAIM");
  }
}

main().catch((e) => {
  console.error(e?.shortMessage || e?.message || e);
  process.exit(1);
});
