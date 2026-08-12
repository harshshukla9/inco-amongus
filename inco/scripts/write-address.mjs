#!/usr/bin/env node
/**
 * After ignition deploy, copy the AmongUsRoles address into ../.inco-deploy.json
 * Usage: node scripts/write-address.mjs <address> [network]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const address = process.argv[2];
const network = process.argv[3] || "baseSepolia";

if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
  console.error("Usage: node scripts/write-address.mjs 0xAddress [network]");
  process.exit(1);
}

const out = {
  contractAddress: address,
  network,
  impostorCount: 1,
  enabled: true,
  updatedAt: new Date().toISOString(),
};

const dest = path.resolve(__dirname, "../../.inco-deploy.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log("Wrote", dest);
console.log("Export before npm start:");
console.log(`  export INCO_ROLES_ADDRESS=${address}`);
console.log(`  export INCO_NETWORK=${network}`);
console.log("  export INCO_ENABLED=true");
