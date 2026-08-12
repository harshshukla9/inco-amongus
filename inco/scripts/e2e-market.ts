import hre from "hardhat";
import fs from "fs";
import path from "path";
import { formatEther } from "viem";
import { Lightning } from "@inco/lightning-js/lite";

/**
 * End-to-end exercise of the market against Base Sepolia: create it for the current
 * assigned match, encrypt a pick, stake on it, and read the resulting state back.
 */
async function main() {
  const deploy = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../.inco-deploy.json"), "utf8"),
  );
  const publicClient = await hre.viem.getPublicClient();
  const [wallet] = await hre.viem.getWalletClients();
  const me = wallet.account.address;

  const roles = await hre.viem.getContractAt("AmongUsRoles", deploy.contractAddress);
  const factory = await hre.viem.getContractAt(
    "ImpostorMarketFactory",
    deploy.marketFactoryAddress,
  );

  const state = await roles.read.state();
  const matchId = (await roles.read.matchId()) as bigint;
  const count = (await roles.read.playerCount()) as bigint;
  if (state !== 2) throw new Error(`roles state is ${state}, need Assigned(2)`);

  const players: `0x${string}`[] = [];
  for (let i = 0n; i < count; i += 1n) {
    players.push((await roles.read.playerAt([i])) as `0x${string}`);
  }
  console.log("match", matchId.toString(), "candidates", players);

  let market = (await factory.read.marketOfMatch([matchId])) as `0x${string}`;
  if (market === "0x0000000000000000000000000000000000000000") {
    console.log("creating market…");
    const hash = await factory.write.createMarket([matchId, players]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("createMarket status:", receipt.status, "gas:", receipt.gasUsed.toString());
    market = (await factory.read.marketOfMatch([matchId])) as `0x${string}`;
  }
  console.log("market:", market);

  const m = await hre.viem.getContractAt("ImpostorMarket", market);
  const fee = (await m.read.betFee()) as bigint;
  const minValue = (await m.read.minBetValue()) as bigint;
  console.log("betFee:", formatEther(fee), "ETH · minBetValue:", formatEther(minValue), "ETH");
  console.log("candidateCount:", (await m.read.candidateCount()).toString());

  const existing = (await m.read.betOf([me])) as any[];
  if ((existing[0] as bigint) > 0n) {
    console.log("already bet from this wallet — stake", formatEther(existing[0] as bigint));
  } else {
    // Bet on candidate 1; the deployer is not required to be a candidate
    const zap = await Lightning.baseSepoliaTestnet({
      hostChainRpcUrls: [process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"],
    });
    console.log("encrypting pick…");
    const ciphertext = await zap.encrypt(1n, {
      accountAddress: me,
      dappAddress: market,
    });
    console.log("ciphertext bytes:", (ciphertext.length - 2) / 2);

    const stake = 20000000000000n; // 0.00002 ETH
    const hash = await m.write.bet([ciphertext], { value: stake + fee });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("bet status:", receipt.status, "gas:", receipt.gasUsed.toString());
  }

  const summary = (await m.read.summary()) as any[];
  console.log("phase:", summary[0], "pot:", formatEther(summary[1]), "bets:", summary[2].toString());
  const mine = (await m.read.betOf([me])) as any[];
  console.log(
    "my stake:", formatEther(mine[0]),
    "· pick (should be 0 while secret):", mine[1],
    "· handle:", String(mine[5]).slice(0, 18) + "…",
  );
  console.log("market balance:", formatEther(await publicClient.getBalance({ address: market })));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
