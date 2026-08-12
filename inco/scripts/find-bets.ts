import hre from "hardhat";
import fs from "fs";
import path from "path";
import { formatEther } from "viem";

const WALLET = (
  process.env.WALLET || "0xdC4f1522f2dE9C4059F0845D6d54C2a9745C908f"
).toLowerCase() as `0x${string}`;

const PHASES = ["Betting", "Locked", "Settled", "Finalized", "Refunding"];

async function main() {
  const deploy = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../.inco-deploy.json"), "utf8"),
  );
  const publicClient = await hre.viem.getPublicClient();
  const factory = await hre.viem.getContractAt(
    "ImpostorMarketFactory",
    deploy.marketFactoryAddress,
  );

  const count = Number(await factory.read.marketCount());
  console.log("factory:", deploy.marketFactoryAddress, "markets:", count);
  console.log("looking for bets from", WALLET);

  const known = [
    "0x77d64D31b0A57Ae28693f2D02304Aa5d02C76a34",
    "0x855e5e10ac1e7af49c98c6576183153f7069898f",
    "0x44c9ed9917b70a08aeb647d14f11a663bc2b9472",
    "0x2d821045c2251c070237722970f7d7a28632876a",
    "0x84a5f89971f9a8c7b2c26da46ae32c0bbd881f4f",
  ];

  const markets: `0x${string}`[] = [];
  for (let i = 0; i < count; i += 1) {
    markets.push((await factory.read.allMarkets([BigInt(i)])) as `0x${string}`);
  }
  for (const m of known) {
    if (!markets.map((x) => x.toLowerCase()).includes(m.toLowerCase())) {
      markets.push(m as `0x${string}`);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  let found = 0;

  for (const address of markets) {
    try {
      const m = await hre.viem.getContractAt("ImpostorMarket", address);
      const bet = (await m.read.betOf([WALLET])) as any[];
      const stake = bet[0] as bigint;
      if (stake === 0n) continue;
      found += 1;

      const summary = (await m.read.summary()) as any[];
      const phase = Number(summary[0]);
      const createdAt = Number(await m.read.createdAt());
      const settledAt = Number(summary[6]);
      const payout = (await m.read.payoutOf([WALLET])) as bigint;
      const balance = await publicClient.getBalance({ address });
      const proveDeadline = settledAt ? settledAt + 180 : 0;
      const abandonAt = createdAt + 6 * 3600;

      console.log("\n── market", address);
      console.log("  phase:", PHASES[phase] || phase);
      console.log("  pot:", formatEther(summary[1]), "ETH · bets:", summary[2].toString());
      console.log("  impostor:", summary[4]);
      console.log("  winningIndex:", summary[3].toString(), "winningStake:", formatEther(summary[5]));
      console.log(
        "  your stake:",
        formatEther(stake),
        "pick:",
        bet[1],
        "proven:",
        bet[2],
        "winner:",
        bet[3],
        "claimed:",
        bet[4],
      );
      console.log("  claimable now:", formatEther(payout), "ETH");
      console.log("  contract balance:", formatEther(balance), "ETH");
      console.log("  created:", new Date(createdAt * 1000).toISOString());
      if (settledAt) {
        console.log(
          "  settled:",
          new Date(settledAt * 1000).toISOString(),
          "· prove window",
          now <= proveDeadline ? `OPEN (${proveDeadline - now}s left)` : "CLOSED",
        );
      }
      console.log(
        "  abandon available:",
        now > abandonAt ? "YES — call abandon() then claim()" : `in ${abandonAt - now}s`,
      );

      if (phase === 0 || phase === 1) {
        console.log("  WHY NO MONEY: market never settled (game over settle didn't run)");
      } else if (phase === 2 && !bet[2]) {
        console.log("  WHY NO MONEY: settled but you never proved your pick — open [B] → REVEAL PICK");
      } else if (phase === 2 && bet[2]) {
        console.log("  WHY NO MONEY: prove window not closed / finalize not called yet");
      } else if ((phase === 3 || phase === 4) && !bet[4] && payout > 0n) {
        console.log("  WHY NO MONEY: claimable — open [B] → CLAIM");
      } else if (bet[4]) {
        console.log("  already claimed");
      } else {
        console.log("  WHY NO MONEY: you lost (wrong pick) or self-bet was rejected");
      }
    } catch (err: any) {
      console.log("skip", address, err?.shortMessage || err?.message || err);
    }
  }

  if (!found) console.log("\nNo bets found from this wallet on known markets.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
