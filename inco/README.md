# Among Us Roles (Inco)

Confidential Impostor/Crewmate assignment using [ConfidentialDeck](https://docs.inco.org/games/overview) on Inco Lightning.

## Role encoding

After `assignRoles()`, each player peeks their handle:

- `value <= impostorCount` → **Impostor**
- otherwise → **Crewmate**

## Setup

```bash
cd inco
npm install
npm run compile
```

### Local node

```bash
npm run node:up
npm run deploy:local
npm run node:down   # when done
```

### Base Sepolia

```bash
cp .env.example .env   # set PRIVATE_KEY_BASE_SEPOLIA
npm run deploy:testnet
```

Copy the deployed address into the game root `.env` / webpack define:

```
INCO_ROLES_ADDRESS=0x...
INCO_NETWORK=baseSepolia   # or local
```

## Flow

1. Host calls `openMatch(n)` with `msg.value >= deckFee(n)`
2. Each human wallet calls `join()`
3. Anyone calls `assignRoles()`
4. Frontend `peekMyCards` on `myRoleHandle()`
5. On eject, host/client calls `revealRole(address)` then `readRevealed`
