# Barely Among Us — confidential roles on Inco Lightning

A browser multiplayer social-deduction game (Among Us–style) where **Impostor / Crewmate roles are shuffled and dealt on-chain with [Inco Lightning](https://docs.inco.org)**. The host, the Socket.IO server, and every other player cannot read your role until you decrypt it yourself or it is publicly revealed.

On top of the round there is a **confidential prediction market**: players stake Base Sepolia ETH on who they think the impostor is. Picks are encrypted before they leave the browser, so the board stays unreadable while the game is live. Settlement is trustless — the market verifies a covalidator attestation over the role handle it snapshotted at creation. No oracle. No admin picking a winner.

**Play:** [https://inco-amongus.vercel.app](https://inco-amongus.vercel.app)  
**Realtime server:** [https://inco-amongus.onrender.com](https://inco-amongus.onrender.com)  
**Network:** Base Sepolia (MetaMask)

---

## What this is

Classic crew-vs-impostor loop in Phaser 3:

- Walk the ship, kill, report, discuss, vote, eject
- One impostor among the seated wallets (configurable)
- Multiplayer over Socket.IO; optional local bots to fill the lobby

What is *not* classic: the secret that makes the game work — **who is the impostor** — never sits in the Node process. Roles are an encrypted deck. Each player peeks only their own card with an attested decrypt. Public reveal happens only on eject / game-over settlement.

---

## How confidential compute is used

Inco is not running on every frame. Movement, chat, votes, and kills are ordinary Phaser + sockets. FHE / TEE work happens at a few load-bearing moments:

| When | What | Where |
|------|------|--------|
| Host **START** → `assignRoles` | TEE shuffle of `1..N`, deal one encrypted card per seat | `AmongUsRoles` + `ConfidentialDeck` |
| Player clicks **REVEAL MY ROLE** | Attested decrypt of *your* handle only | `@inco/lightning-js` `attestedDecrypt` |
| Eject / market settle | On-chain `e.reveal` + attested reveal | `revealRole` then covalidator sigs |
| **Place bet** | Encrypt candidate index in the browser, store as `euint256` | `zap.encrypt` → `ImpostorMarket.bet` |
| **Prove win** | Reveal your pick, attest it, verify on-chain | `revealMyPick` + `proveWin` |

`openMatch` and `join` are cheap (no FHE). The shuffle fee is paid in the same transaction as `assignRoles`, same pattern as the working Inco game kits.

Role encoding after the deal:

- `value <= impostorCount` → **Impostor**
- otherwise → **Crewmate**

---

## Architecture

```
Browser (Phaser 3)
  ├── Game / lobby / HUD
  ├── MetaMask  ──►  Base Sepolia
  │                    ├── AmongUsRoles          (shuffle, deal, peek, reveal)
  │                    ├── ImpostorMarketFactory (one market per match)
  │                    └── ImpostorMarket        (encrypted bets, settle, claim)
  └── Socket.IO  ──►  Node server (Render)
                       rooms, movement, meetings, votes
                       does NOT know roles when Inco is on
```

Webpack 4 cannot parse `viem` / `@inco/lightning-js`. Those are bundled separately with **esbuild** into `static/inco.bundle.js` and loaded by `index.html`. The Phaser bundle stays on Webpack.

| Piece | Stack | Deploy |
|-------|--------|--------|
| Client | Phaser 3, Webpack 4, esbuild (Inco) | [Vercel](https://inco-amongus.vercel.app) |
| Realtime | Express + Socket.IO | [Render](https://inco-amongus.onrender.com) |
| Contracts | Solidity 0.8.30, Hardhat, Inco Lightning 1.0.2 | Base Sepolia |

### Live contracts (Base Sepolia)

| Contract | Address |
|----------|---------|
| `AmongUsRoles` | [`0xe2420072bee5181fad9b49bc1d668683326b6a7c`](https://sepolia.basescan.org/address/0xe2420072bee5181fad9b49bc1d668683326b6a7c) |
| `ImpostorMarketFactory` | [`0x5e53b893c888a9553f0c834156980ecace47c658`](https://sepolia.basescan.org/address/0x5e53b893c888a9553f0c834156980ecace47c658) |

---

## Gameplay

1. Open the site, pick a name, **HOST** or **JOIN** with a room code.
2. Connect **MetaMask** (Base Sepolia). Toggle **INCO: ON**.
3. Host **START** → `openMatch` + everyone `join` + host `assignRoles` (FHE shuffle).
4. The round starts immediately. Bottom-left: **REVEAL MY ROLE** (MetaMask decrypt). Walking is not blocked by decrypt.
5. Impostor kills with **Space** (after revealing). Crew reports bodies → discuss → vote.
6. Press **B** (or the top-right market badge) to stake on who the impostor is.
7. At game over the market settles from the on-chain role proof. Winners prove their sealed pick, then claim.

### Controls

| Key / UI | Action |
|----------|--------|
| WASD / arrows | Move |
| Space | Kill (impostor, in range, after role reveal) |
| **B** or market badge | Open impostor market |
| **REVEAL MY ROLE** | Attested decrypt of your Inco card |
| F9 | Debug HUD |

---

## Impostor market

Parimutuel pool in testnet ETH. Design choices:

- **No self-bets that pay.** Betting on yourself can never win — the impostor must bet wrong or abstain.
- **Encrypted picks.** The board is unreadable mid-round; losing picks stay secret forever.
- **Closes at the final vote.** Evidence can move the game, not the public odds.
- **Trustless resolution.** Market snapshots each candidate’s role handle at creation, then `settle` verifies an attestation that that handle decrypts to an impostor value.

### Lifecycle

```
assignRoles
    └─ host createMarket(matchId, candidates)
           │
           ▼
      Betting  ── place sealed bet (min ~0.00002 ETH + Inco fee)
           │
           ▼  (vote starts)
       Locked
           │
           ▼  (game over — anyone can settle)
      Settled  ── 3 min prove window: revealMyPick + proveWin
           │
           ▼
   Finalized / Refunding  ── claim()  (pull only)
```

If nobody proves a correct pick, `finalize` refunds every stake. If a match is abandoned, anyone can `abandon()` **6 hours** after creation and everyone withdraws. Funds are never trapped in the contract.

Anyone can settle at game over (not only the host). If the server never attached the impostor wallet, the client scans candidates on-chain until it finds the impostor role.

---

## Repo layout

```
src/
  scenes/          Menu, lobby, game
  inco/            Wallet, AmongUsRoles + market client (esbuild entry)
  game/            Rules, meeting UI, betting UI
  network.js       Socket.IO client
server/            Express + Socket.IO rooms
inco/
  contracts/       AmongUsRoles, ConfidentialDeck, ImpostorMarket(+Factory)
  scripts/         Deploy + e2e (bet / settle / claim)
scripts/           build-inco.js, copy bundle into dist/
```

---

## Local development

**Need:** Node 18+, MetaMask, Base Sepolia ETH (or a local Inco/Anvil node).

```bash
git clone https://github.com/harshshukla9/inco-amongus.git
cd inco-amongus

npm install
cd server && npm install && cd ..
cd inco && npm install && cd ..

# Terminal 1 — realtime
cd server && npm start          # :3000

# Terminal 2 — game
npm start                       # :8080
```

On localhost the client talks to `http://localhost:3000`. On the Vercel deploy it talks to Render.

Copy `.env.example` if you want to override addresses. Deploy scripts write `.inco-deploy.json` (gitignored); webpack and `build-inco.js` read it at build time.

```bash
cp .env.example .env
# INCO_ROLES_ADDRESS, INCO_MARKET_FACTORY, INCO_NETWORK=baseSepolia, INCO_ENABLED=true
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Dev server + Inco bundle (`localhost:8080`) |
| `npm run build` | Production `dist/` (Webpack + esbuild) |
| `npm run build:inco` | Rebuild `static/inco.bundle.js` only |
| `npm run inco:compile` | Hardhat compile |
| `npm run inco:deploy:testnet` | Deploy `AmongUsRoles` → `.inco-deploy.json` |
| `cd inco && npm run deploy:market:testnet` | Deploy `ImpostorMarketFactory` bound to current roles |

---

## Deploy contracts

```bash
cd inco
cp .env.example .env.local     # PRIVATE_KEY + BASE_SEPOLIA_RPC_URL
npm run compile
npm run deploy:testnet         # AmongUsRoles
npm run deploy:market:testnet  # factory → same .inco-deploy.json
```

Then rebuild the client so the new addresses are baked in:

```bash
npm run build:inco && npm start
```

Contract-level notes: [`inco/README.md`](inco/README.md).

---

## Production

The **client is static**. The **Socket.IO server is a long-lived Node process**. Do not put both on Vercel serverless.

### Frontend — Vercel

- Build: `npm run build`
- Output: `dist`
- See `vercel.json`

Environment variables (required — `.inco-deploy.json` is gitignored):

| Name | Example |
|------|---------|
| `SOCKET_URL` | `https://inco-amongus.onrender.com` |
| `INCO_ROLES_ADDRESS` | `0xe2420072bee5181fad9b49bc1d668683326b6a7c` |
| `INCO_MARKET_FACTORY` | `0x5e53b893c888a9553f0c834156980ecace47c658` |
| `INCO_NETWORK` | `baseSepolia` |
| `INCO_ENABLED` | `true` |
| `INCO_IMPOSTOR_COUNT` | `1` |

No private keys on Vercel. MetaMask talks to Base Sepolia from the browser.

### Realtime — Render (or Railway / Fly)

- Root directory: `server`
- Build: `npm install`
- Start: `npm start` (`PORT` is provided by the host)

```text
CORS_ORIGINS=https://inco-amongus.vercel.app,http://localhost:8080,https://inco-amongus.onrender.com
```

Health check: `GET /health` → `{"ok":true,"service":"amongjs-server"}`.

---

## Security / trust model

- **Roles:** encrypted until the owner peeks or `revealRole` is called. The server only learns a role after the client *claims* it post-peek (needed so kills/wins can be enforced).
- **Bets:** ciphertext on-chain; covalidator attestations required to settle and to prove a win.
- **Self-bet:** rejected in `proveWin` even if the pick is correct.
- **Handle snapshot:** a later match on the singleton `AmongUsRoles` contract cannot retarget an old market.
- **Pull payouts only.** Claim from the same wallet that bet.

This is a **testnet demo**. Stakes are Base Sepolia ETH. Do not use mainnet keys in `inco/.env.local`.

---

## License

MIT. Phaser template originally from [photonstorm/phaser3-project-template](https://github.com/photonstorm/phaser3-project-template).
