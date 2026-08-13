# Inco contracts — Among Us roles + impostor market

Hardhat workspace for confidential roles and the prediction market. Game-level docs live in the [root README](../README.md).

## Contracts

| Contract | Role |
|----------|------|
| `AmongUsRoles` | Open match, join, FHE shuffle + deal, peek, public reveal |
| `ConfidentialDeck` | `e.shuffledRange` / deal / reveal / verify attestation |
| `ImpostorMarketFactory` | One `ImpostorMarket` per `matchId` |
| `ImpostorMarket` | Encrypted picks, parimutuel ETH pot, settle, claim, refund |

Role encoding: `value <= impostorCount` → Impostor, else Crewmate.

Market: no paying self-bets; picks stay encrypted until a winner proves; `abandon()` after 6h refunds everyone.

## Setup

```bash
cd inco
npm install
npm run compile
```

### Local Inco / Anvil

```bash
npm run node:up
npm run deploy:local
npm run deploy:market:local
npm run node:down
```

### Base Sepolia

```bash
cp .env.example .env.local   # PRIVATE_KEY + BASE_SEPOLIA_RPC_URL
npm run deploy:testnet
npm run deploy:market:testnet
```

Both deploy scripts write `../.inco-deploy.json` (gitignored). Rebuild the client (`npm run build:inco` from repo root) so addresses are baked into `static/inco.bundle.js`.

## Match flow

1. Host `openMatch(seats)`
2. Each wallet `join()` (idempotent, no FHE)
3. Host `assignRoles{value: deckFee(n)}` — shuffle + deal
4. Client `attestedDecrypt(myRoleHandle)`
5. On eject / settle: `revealRole(who)` then attested reveal + `e.verifyDecryption`

## Market flow

1. After roles are assigned: `createMarket(matchId, candidates)`
2. `bet(ciphertext)` with `msg.value >= MIN_STAKE + betFee()`
3. `lockBetting` when the final vote starts
4. `settle(impostor, roleValue, signatures)`
5. Winners: `revealMyPick` → `proveWin` (3 minute window on new deploys)
6. `finalize` then `claim`

E2E helpers (need a funded deployer key):

```bash
npx hardhat run scripts/e2e-market.ts --network baseSepolia
npx hardhat run scripts/e2e-payout.ts --network baseSepolia
```
