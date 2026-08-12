import hre from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const impostorCount = 1;
  const game = await hre.viem.deployContract("AmongUsRoles", [impostorCount]);
  const address = game.address;
  const network = hre.network.name === "anvil" ? "local" : hre.network.name;

  console.log("AmongUsRoles deployed at", address, "on", network);

  const out = {
    contractAddress: address,
    network: network === "baseSepolia" ? "baseSepolia" : "local",
    impostorCount,
    enabled: true,
    updatedAt: new Date().toISOString(),
  };
  const dest = path.resolve(__dirname, "../../.inco-deploy.json");
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log("Wrote", dest);
  console.log(`export INCO_ROLES_ADDRESS=${address}`);
  console.log(`export INCO_NETWORK=${out.network}`);
  console.log("export INCO_ENABLED=true");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
