import hre from "hardhat";
import fs from "fs";
import path from "path";

const deployFile = path.resolve(__dirname, "../../.inco-deploy.json");

/**
 * Deploys ImpostorMarketFactory against the AmongUsRoles address already in .inco-deploy.json,
 * so the prediction market always points at the roles contract the client is using.
 */
async function main() {
  if (!fs.existsSync(deployFile)) {
    throw new Error("Missing .inco-deploy.json — deploy AmongUsRoles first (npm run deploy:testnet)");
  }
  const current = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  const rolesAddress = process.env.INCO_ROLES_ADDRESS || current.contractAddress;
  if (!rolesAddress) throw new Error("No AmongUsRoles address to bind the market factory to");

  const network = hre.network.name === "anvil" ? "local" : hre.network.name;
  if (current.network && current.network !== network) {
    throw new Error(
      `.inco-deploy.json targets ${current.network} but this run is on ${network} — redeploy roles first`,
    );
  }

  const factory = await hre.viem.deployContract("ImpostorMarketFactory", [rolesAddress]);
  console.log("ImpostorMarketFactory deployed at", factory.address, "on", network);
  console.log("bound to AmongUsRoles", rolesAddress);

  const out = {
    ...current,
    marketFactoryAddress: factory.address,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(deployFile, JSON.stringify(out, null, 2));
  console.log("Wrote", deployFile);
  console.log(`export INCO_MARKET_FACTORY=${factory.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
