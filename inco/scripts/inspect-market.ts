import hre from "hardhat";
import fs from "fs";
import path from "path";
import { formatEther } from "viem";

async function main() {
  const deploy = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../.inco-deploy.json"), "utf8"),
  );
  const market = (process.env.MARKET ||
    "0x77d64D31b0A57Ae28693f2D02304Aa5d02C76a34") as `0x${string}`;

  const publicClient = await hre.viem.getPublicClient();
  const [wallet] = await hre.viem.getWalletClients();
  const m = await hre.viem.getContractAt("ImpostorMarket", market);

  console.log("block:", (await publicClient.getBlockNumber()).toString());
  console.log("market:", market, "factory:", deploy.marketFactoryAddress);
  const summary = (await m.read.summary()) as any[];
  console.log(
    "phase:", summary[0],
    "pot:", formatEther(summary[1]),
    "bets:", summary[2].toString(),
  );
  console.log("bettorCount:", (await m.read.bettorCount()).toString());
  console.log("balance:", formatEther(await publicClient.getBalance({ address: market })));

  const mine = (await m.read.betOf([wallet.account.address])) as any[];
  console.log("my stake:", formatEther(mine[0]), "handle:", mine[5]);

  const logs = await publicClient.getLogs({
    address: market,
    fromBlock: "earliest",
    toBlock: "latest",
  });
  console.log("events emitted:", logs.length);
  logs.forEach((l) => console.log("  topic0", l.topics[0], "block", l.blockNumber));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
