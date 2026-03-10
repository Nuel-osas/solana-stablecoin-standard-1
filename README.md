# Solana Stablecoin Standard (SSS)

A modular SDK with opinionated presets covering the most common stablecoin architectures on Solana. Built on Token-2022 extensions.

Think **OpenZeppelin for stablecoins**: the library is the SDK, the standards (SSS-1, SSS-2) are opinionated presets that get adopted.

## Devnet Deployment

Both programs are live on Solana Devnet:

| Program | Program ID | Deploy Tx |
|---------|-----------|-----------|
| **sss_token** | [`CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ`](https://explorer.solana.com/address/CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ?cluster=devnet) | [`3XS74f...SvhN79`](https://explorer.solana.com/tx/3XS74f8ofykb2fjiQWS3fzH6sTFMPkkW4JA85U43K6aWxsgPZraYa85NhuHLg5t2noXs6MQrv6ZgE7tSQ9SvhN79?cluster=devnet) |
| **sss_transfer_hook** | [`63pY5GPBHKJ3gu99xTNH9yxUKgp8kUowiiHYzZtaE31E`](https://explorer.solana.com/address/63pY5GPBHKJ3gu99xTNH9yxUKgp8kUowiiHYzZtaE31E?cluster=devnet) | [`5QbKdk...PeSY1NU`](https://explorer.solana.com/tx/5QbKdkonnMv8X9wvNRFvCkozhEoCnCRxAwApgvaWzuHmHhGEGgtuurLz6C5piiqH4ywb5dhhAo5pfHExkKPSY1NU?cluster=devnet) |

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Layer 3 — Standard Presets          │
│  SSS-1 (Minimal)    SSS-2 (Compliant)           │
├─────────────────────────────────────────────────┤
│              Layer 2 — Modules                   │
│  Compliance Module                               │
│  (Transfer Hook, Blacklist, Permanent Delegate)  │
├─────────────────────────────────────────────────┤
│              Layer 1 — Base SDK                  │
│  Token Creation · Mint/Freeze Authority          │
│  Role Management · CLI · TypeScript SDK          │
└─────────────────────────────────────────────────┘
```

## Standards

| Standard | Name | Description |
|----------|------|-------------|
| **SSS-1** | Minimal Stablecoin | Mint authority + freeze authority + metadata. What's needed on every stable, nothing more. |
| **SSS-2** | Compliant Stablecoin | SSS-1 + permanent delegate + transfer hook + blacklist enforcement. USDC/USDT-class compliance. |

## Quick Start

### Initialize a stablecoin

```bash
# SSS-1: Minimal
sss-token init sss-1 --name "My Stablecoin" --symbol "MUSD" --decimals 6

# SSS-2: Compliant
sss-token init sss-2 --name "Regulated USD" --symbol "RUSD" --decimals 6

# Custom config
sss-token init custom --config config.toml
```

### Operations

```bash
# Mint tokens
sss-token mint --to <recipient> --amount 1000000

# Burn tokens
sss-token burn --amount 500000

# Freeze/thaw accounts
sss-token freeze --account <address>
sss-token thaw --account <address>

# Pause/unpause all operations
sss-token pause
sss-token unpause

# Check status
sss-token status
sss-token supply
```

### SSS-2 Compliance

```bash
# Blacklist management
sss-token blacklist add --address <address> --reason "OFAC match"
sss-token blacklist remove --address <address>

# Seize tokens (via permanent delegate)
sss-token seize --from <address> --to <treasury>

# Minter management
sss-token minters list
sss-token minters add --address <address> --quota 1000000
sss-token minters remove --address <address>

# Audit
sss-token audit-log --action mint
sss-token holders --min-balance 1000
```

### TypeScript SDK

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-token";

// SSS-2 preset
const stable = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_2,
  name: "My Stablecoin",
  symbol: "MYUSD",
  decimals: 6,
  authority: adminKeypair,
});

// Or custom config
const custom = await SolanaStablecoin.create(connection, {
  name: "Custom Stable",
  symbol: "CUSD",
  extensions: { permanentDelegate: true, transferHook: false },
});

// Operations
await stable.mintTokens({ recipient, amount: 1_000_000, minter });
await stable.compliance.blacklistAdd(address, "Sanctions match");
await stable.compliance.seize(frozenAccount, treasury);
const supply = await stable.getTotalSupply();
```

## Project Structure

```
solana-stablecoin-standard/
├── programs/
│   ├── sss-token/           # Core Anchor program (SSS-1 + SSS-2)
│   │   └── src/
│   │       ├── lib.rs        # Program entrypoint
│   │       ├── state.rs      # Account definitions
│   │       ├── instructions/ # All instruction handlers
│   │       ├── error.rs      # Error codes
│   │       ├── events.rs     # Event definitions
│   │       └── constants.rs  # Seeds and limits
│   └── sss-transfer-hook/   # Transfer hook program (SSS-2 blacklist enforcement)
├── sdk/
│   └── core/                # TypeScript SDK (@stbr/sss-token)
├── cli/                     # Admin CLI (sss-token)
├── backend/                 # Backend services (Docker)
├── tests/                   # Integration tests
├── docs/                    # Documentation
│   ├── ARCHITECTURE.md
│   ├── SSS-1.md
│   ├── SSS-2.md
│   ├── SDK.md
│   ├── OPERATIONS.md
│   ├── COMPLIANCE.md
│   └── API.md
└── Anchor.toml              # Anchor workspace config
```

## Role-Based Access Control

No single key controls everything:

| Role | Capabilities |
|------|-------------|
| **Master Authority** | Assign/revoke all roles, transfer authority |
| **Minter** | Mint tokens (with per-minter quotas) |
| **Burner** | Burn tokens |
| **Pauser** | Pause/unpause, freeze/thaw accounts |
| **Blacklister** | Add/remove from blacklist (SSS-2) |
| **Seizer** | Seize tokens via permanent delegate (SSS-2) |

## Token-2022 Extensions Used

| Extension | SSS-1 | SSS-2 | Purpose |
|-----------|-------|-------|---------|
| Metadata Pointer | ✓ | ✓ | On-chain metadata |
| Mint/Freeze Authority | ✓ | ✓ | Token control |
| Permanent Delegate | | ✓ | Token seizure |
| Transfer Hook | | ✓ | Blacklist enforcement on every transfer |
| Default Account State | | Optional | Freeze new accounts by default |

## Testing

### Anchor Integration Tests

```bash
anchor test
```

### SDK Unit Tests

```bash
cd sdk/core && yarn test
```

### Backend API Tests

```bash
cd backend && yarn test
```

### Docker Smoke Test

Builds and starts the full containerised stack (API + indexer), then runs 6 end-to-end checks against the live endpoints.

```bash
# Requires a Docker runtime (Docker Desktop or colima)
colima start          # if using colima
cd backend/docker
./smoke-test.sh
```

The smoke test covers: health check, supply endpoint, events endpoint, audit log, and input validation on mint/blacklist write endpoints.

### Trident Fuzz Testing

Property-based fuzz testing via [Trident](https://github.com/Ackee-Blockchain/trident) (Ackee Blockchain). The harness executes real program instructions through `process_transaction` against a local SVM and checks invariants after each flow.

```bash
# Build programs first (Trident loads the .so binaries)
anchor build

# Run the fuzz test (default: 1000 iterations, 100 flow calls each)
cd trident-tests/fuzz_tests/fuzz_0
cargo run

# Custom iteration count
TRIDENT_ITERATIONS=5000 TRIDENT_FLOW_CALLS=200 cargo run
```

Fuzz flows cover: pause/unpause by authority, unauthorized pause/transfer rejection, authority transfer verification, and PDA uniqueness invariants across all role types.

## Development

```bash
# Install dependencies
yarn install

# Build programs
anchor build

# Build SDK
cd sdk/core && yarn build
```

## Devnet Deployment

Programs are already deployed to devnet. To redeploy:

```bash
solana config set --url devnet
solana airdrop 5
anchor deploy --provider.cluster devnet
```

**Current Program IDs:**
- `sss_token`: `CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ`
- `sss_transfer_hook`: `63pY5GPBHKJ3gu99xTNH9yxUKgp8kUowiiHYzZtaE31E`

## License

MIT

## Contributing

PRs welcome. Please open an issue first to discuss significant changes.
