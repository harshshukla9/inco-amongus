import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import * as dotenv from "dotenv";
import path from "path";

// Prefer .env.local (gitignored) over .env
dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, ".env.local"), override: true });

const rawKey = (process.env.PRIVATE_KEY_BASE_SEPOLIA || "").trim();
const PRIVATE_KEY = rawKey
  ? rawKey.startsWith("0x")
    ? rawKey
    : `0x${rawKey}`
  : "";

if (!PRIVATE_KEY) {
  console.warn(
    "[hardhat] PRIVATE_KEY_BASE_SEPOLIA missing — baseSepolia deploys will fail. Set it in inco/.env.local",
  );
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.30",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {},
    anvil: {
      url: process.env.LOCAL_RPC_URL || "http://localhost:8545",
      chainId: 31337,
      accounts: {
        mnemonic:
          process.env.SEED_PHRASE ||
          "test test test test test test test test test test test junk",
        count: 20,
      },
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  mocha: { timeout: 120_000 },
};

export default config;
