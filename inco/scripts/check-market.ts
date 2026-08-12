import hre from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Dry-runs createMarket against the live roles contract so constructor guards
 * (seated players, dealt role handles) are validated before a real match needs them.
 */
async function main() {
  const deploy = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../.inco-deploy.json"), "utf8"),
  );
  const publicClient = await hre.viem.getPublicClient();
  const roles = await hre.viem.getContractAt("AmongUsRoles", deploy.contractAddress);
  const factory = await hre.viem.getContractAt(
    "ImpostorMarketFactory",
    deploy.marketFactoryAddress,
  );

  const state = await roles.read.state();
  const matchId = await roles.read.matchId();
  const count = await roles.read.playerCount();
  console.log("roles state:", state, "(0=Idle 1=Joining 2=Assigned)");
  console.log("matchId:", matchId.toString(), "players:", count.toString());

  const players: string[] = [];
  for (let i = 0n; i < (count as bigint); i += 1n) {
    players.push((await roles.read.playerAt([i])) as string);
  }
  for (const p of players) {
    const handle = await roles.read.roleHandleOf([p]);
    console.log(" ", p, "handle", String(handle).slice(0, 18) + "…");
  }

  const existing = await factory.read.marketOfMatch([matchId]);
  console.log("existing market for match:", existing);

  if (state !== 2) {
    console.log("Roles not Assigned — skipping createMarket simulation.");
    return;
  }
  if (players.length < 3) {
    console.log("Fewer than 3 seats — market needs 3+ candidates.");
    return;
  }
  if (existing !== "0x0000000000000000000000000000000000000000") {
    console.log("Market already exists for this match; nothing to simulate.");
    return;
  }

  const [wallet] = await hre.viem.getWalletClients();
  const { result } = await publicClient.simulateContract({
    address: deploy.marketFactoryAddress,
    abi: factory.abi,
    functionName: "createMarket",
    args: [matchId, players],
    account: wallet.account,
  });
  console.log("createMarket simulation OK → market would deploy at", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
