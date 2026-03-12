# Solana Stablecoin Standard (SSS)

[![CI](https://github.com/Nuel-osas/solana-stablecoin-standard-1/actions/workflows/ci.yml/badge.svg)](https://github.com/Nuel-osas/solana-stablecoin-standard-1/actions/workflows/ci.yml)

A modular SDK with opinionated presets covering the most common stablecoin architectures on Solana. Built on Token-2022 extensions.

Think **OpenZeppelin for stablecoins**: the library is the SDK, the standards (SSS-1, SSS-2, SSS-3) are opinionated presets that get adopted.

## Devnet Deployment

Both programs are live on Solana Devnet:

| Program | Program ID |
|---------|-----------|
| **sss_token** | [`BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq`](https://explorer.solana.com/address/BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq?cluster=devnet) |
| **sss_transfer_hook** | [`B9HzG9fuxbuJBG2wTSP6UmxBSQLdaUAk62Kcdf41WxAt`](https://explorer.solana.com/address/B9HzG9fuxbuJBG2wTSP6UmxBSQLdaUAk62Kcdf41WxAt?cluster=devnet) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│               Layer 3 — Standard Presets             │
│  SSS-1 (Minimal)  SSS-2 (Compliant)  SSS-3 (Private)│
├─────────────────────────────────────────────────────┤
│               Layer 2 — Modules                      │
│  Compliance Module (Blacklist + Allowlist)            │
│  Transfer Hook (Blacklist & Allowlist Enforcement)    │
│  Permanent Delegate (Token Seizure)                  │
├─────────────────────────────────────────────────────┤
│               Layer 1 — Base SDK                     │
│  Token Creation · Mint/Freeze Authority              │
│  Role Management · CLI · TypeScript SDK              │
└─────────────────────────────────────────────────────┘
```

## Standards

| Standard | Name | Description |
|----------|------|-------------|
| **SSS-1** | Minimal Stablecoin | Mint authority + freeze authority + metadata. What's needed on every stable, nothing more. |
| **SSS-2** | Compliant Stablecoin | SSS-1 + permanent delegate + transfer hook + blacklist enforcement. USDC/USDT-class compliance. |
| **SSS-3** | Private Stablecoin | SSS-2 + allowlist-gated transfers + confidential transfer extension. **End-to-end CT with transfer hook + allowlist enforcement verified** — full SSS-3 flow on localnet (`bash scripts/test-ct-e2e.sh`, 14/14 checks). |

## Quick Start

```bash
yarn install
yarn cli --help
```

### Initialize a stablecoin

```bash
# SSS-1: Minimal
yarn cli init sss-1 --name "My Stablecoin" --symbol "MUSD" --decimals 6

# SSS-2: Compliant
yarn cli init sss-2 --name "Regulated USD" --symbol "RUSD" --decimals 6

# SSS-3: Private (allowlist-gated)
yarn cli init sss-3 --name "Private USD" --symbol "PUSD" --decimals 6
```

### Operations

```bash
# Mint tokens (human-readable amounts, e.g. 1000 or 1.5)
yarn cli mint --to <recipient> --amount 1000 --mint <address>

# Burn tokens
yarn cli burn --amount 1.5 --mint <address>

# Freeze/thaw accounts
yarn cli freeze --account <address> --mint <address>
yarn cli thaw --account <address> --mint <address>

# Pause/unpause all operations
yarn cli pause --mint <address>
yarn cli unpause --mint <address>

# Check status
yarn cli status --mint <address>
yarn cli supply --mint <address>
```

### Metadata

```bash
# Update metadata URI (logo, docs, legal text). Authority-only.
# Name and symbol are immutable after initialization to prevent ticker confusion.
yarn cli update-metadata --uri "https://example.com/new-metadata.json" --mint <address>
```

### Role Management

```bash
# Assign any role (minter, burner, blacklister, pauser, seizer)
yarn cli roles assign --role burner --address <address> --mint <address>
yarn cli roles assign --role minter --address <address> --mint <address>

# Revoke a role
yarn cli roles revoke --role burner --address <address> --mint <address>

# List all active role assignments
yarn cli roles list --mint <address>
yarn cli roles list --mint <address> --role minter    # filter by role

# Check what roles an address has
yarn cli roles check --address <address> --mint <address>
```

### SSS-2 Compliance

```bash
# Blacklist management
yarn cli blacklist add --address <address> --reason "OFAC match" --mint <address>
yarn cli blacklist remove --address <address> --mint <address>

# Seize tokens (via permanent delegate)
yarn cli seize --from <token-account> --to <treasury> --mint <address>

# Minter management (convenience shortcut for roles assign --role minter)
yarn cli minters list --mint <address>
yarn cli minters add --address <address> --mint <address>
yarn cli minters remove --address <address> --mint <address>

# Audit
yarn cli audit-log --mint <address>
yarn cli holders --mint <address>
```

### SSS-3 Allowlist

```bash
# Allowlist management (authority-only)
yarn cli allowlist add --address <address> --mint <address>
yarn cli allowlist remove --address <address> --mint <address>
```

### TypeScript SDK

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-token";

// SSS-1: Minimal
const minimal = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_1,
  name: "My Stablecoin",
  symbol: "MYUSD",
  authority: adminKeypair,
});

// SSS-2: Compliant
const compliant = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_2,
  name: "Regulated USD",
  symbol: "RUSD",
  authority: adminKeypair,
});

// SSS-3: Private (allowlist-gated)
const private = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_3,
  name: "Private USD",
  symbol: "PUSD",
  authority: adminKeypair,
});

// Operations
await compliant.mintTokens({ recipientTokenAccount, amount: 1_000_000, minter });
await compliant.burn({ amount: 500_000, burner, tokenAccount });
await compliant.assignRole({ role: "minter", assignee: minterPubkey, authority });

// Compliance (SSS-2/SSS-3)
await compliant.compliance.blacklistAdd(address, "Sanctions match", blacklisterKeypair);
await compliant.compliance.blacklistRemove(address, blacklisterKeypair);
await compliant.compliance.seize({ sourceAccount, treasuryAccount, seizer });
const isBlacklisted = await compliant.compliance.isBlacklisted(address);

// Allowlist (SSS-3)
await private.compliance.allowlistAdd(address, authorityKeypair);
await private.compliance.allowlistRemove(address, authorityKeypair);
const isAllowed = await private.compliance.isAllowlisted(address);

// Authority management
await compliant.nominateAuthority(currentAuthority, newAuthorityPubkey);
await compliant.acceptAuthority(newAuthorityKeypair);
await compliant.setSupplyCap(authority, 1_000_000_000);

// State
const state = await compliant.getState();
const supply = await compliant.getTotalSupply();
```

## Project Structure

```
solana-stablecoin-standard/
├── programs/
│   ├── sss-token/               # Core Anchor program (SSS-1 + SSS-2 + SSS-3)
│   │   └── src/
│   │       ├── lib.rs            # Program entrypoint
│   │       ├── state.rs          # Account definitions
│   │       ├── instructions/     # All instruction handlers
│   │       │   ├── initialize.rs # Token + stablecoin init
│   │       │   ├── mint.rs       # Mint with quota + cap enforcement
│   │       │   ├── burn.rs       # Burn with supply tracking
│   │       │   ├── freeze.rs     # Freeze/thaw accounts
│   │       │   ├── pause.rs      # Global pause/unpause
│   │       │   ├── roles.rs      # RBAC, authority transfer, supply cap
│   │       │   ├── compliance.rs # Blacklist + seize (SSS-2)
│   │       │   ├── allowlist.rs  # Allowlist management (SSS-3)
│   │       │   └── oracle.rs    # Pyth oracle price enforcement
│   │       ├── error.rs          # Error codes
│   │       ├── events.rs         # Event definitions (all timestamped)
│   │       └── constants.rs      # Seeds and limits
│   └── sss-transfer-hook/       # Transfer hook (blacklist + allowlist enforcement)
├── sdk/
│   └── core/                    # TypeScript SDK (@stbr/sss-token)
├── cli/                         # Admin CLI (sss-token)
├── backend/                     # Backend services (Docker)
├── tests/                       # 58 integration tests
│   ├── sss-1.ts                 # SSS-1 tests (7)
│   ├── sss-2.ts                 # SSS-2 compliance tests (7)
│   ├── sss-3.ts                 # SSS-3 allowlist tests (10)
│   ├── authority.ts             # Authority transfer tests (7)
│   ├── supply-cap.ts            # Supply cap + quota tests (10)
│   └── roles-edge-cases.ts      # Roles edge cases (16)
├── trident-tests/               # Trident fuzz tests
├── docs/                        # Documentation
└── Anchor.toml                  # Anchor workspace config
```

## Role-Based Access Control

No single key controls everything:

| Role | Capabilities |
|------|-------------|
| **Master Authority** | Assign/revoke all roles, transfer authority (two-step), set supply cap, manage allowlist |
| **Minter** | Mint tokens (with per-minter quotas) |
| **Burner** | Burn tokens |
| **Pauser** | Pause/unpause, freeze/thaw accounts |
| **Blacklister** | Add/remove from blacklist (SSS-2/SSS-3) |
| **Seizer** | Seize tokens via permanent delegate (SSS-2/SSS-3) |

Master authority can also perform any role's action directly without needing a role assignment.

## Security Features

- **Two-step authority transfer**: `nominate_authority` -> `accept_authority` prevents loss from typos (inspired by Circle FiatToken v2)
- **Supply cap enforcement**: Optional `supply_cap` enforced at the program level on every mint
- **Per-minter quotas**: Individual minting limits tracked on-chain
- **Blacklist audit trail**: Deactivation instead of deletion — full on-chain history preserved
- **Event timestamps**: Every event emission includes `Clock::get()` timestamp for auditability
- **`security_txt!` macro**: Both programs embed [security.txt](https://github.com/nickelreads/solana-security-txt) for responsible disclosure
- **Role separation**: No single key controls everything — see RBAC table above
- **Immutable compliance config**: SSS-1/SSS-2/SSS-3 extensions set at init, cannot be changed afterward
- **PDA authority model**: All sensitive operations use program-derived authority, not EOA keys
- **On-chain oracle enforcement**: Optional Pyth price validation rejects mint/burn when price is stale or depegged

## Oracle Price Enforcement (Pyth)

Optional on-chain price validation during mint/burn operations. When configured, the program reads the Pyth price feed directly on-chain and rejects operations if the price is stale (exceeds `max_staleness_secs`) or depegged (exceeds `max_deviation_bps` from $1.00). The devnet integration test proves staleness rejection using SOL/USD (a non-stablecoin feed); depeg rejection uses the same code path with deviation comparison instead.

```bash
# Configure oracle (authority-only)
yarn cli configure-oracle \
  --mint <address> \
  --price-feed <pyth-account> \
  --max-deviation 100 \
  --max-staleness 60

# Disable oracle enforcement
yarn cli configure-oracle --mint <address> --price-feed <pyth-account> --disable
```

```typescript
// SDK
await stablecoin.configureOracle({
  authority,
  priceFeed: pythUsdcFeedAccount,
  maxDeviationBps: 100,      // 1%
  maxStalenessSecs: 60,
  enabled: true,
});
```

**How it works:** The `oracle_config` and `price_feed` accounts are optional on `mint_tokens` and `burn_tokens`. When present and enabled, `validate_oracle_price` reads the Pyth price feed, computes deviation from $1.00 in basis points, and rejects the transaction if the price is stale or depegged. When not present, mint/burn work exactly as before (backwards compatible).

**Design choice:** Pyth devnet price feed accounts contain live data updated by Pyth publishers. Cloned Pyth accounts on a local validator go stale immediately (frozen timestamp), so oracle integration tests run on devnet intentionally — see the test environment table below.

## Token-2022 Extensions Used

| Extension | SSS-1 | SSS-2 | SSS-3 | Purpose |
|-----------|-------|-------|-------|---------|
| Metadata Pointer | Yes | Yes | Yes | On-chain metadata |
| Mint/Freeze Authority | Yes | Yes | Yes | Token control |
| Permanent Delegate | | Yes | Yes | Token seizure |
| Transfer Hook | | Yes | Yes | Blacklist + allowlist enforcement on every transfer |
| Default Account State | | Optional | Optional | Freeze new accounts by default |
| ConfidentialTransferMint | | | Yes | ZK-encrypted balances (experimental PoC) |

## SSS-3 Confidential Transfer (End-to-End Verified on Localnet)

SSS-3 stablecoins support **end-to-end ZK confidential transfers** on localnet with full transfer hook + allowlist enforcement. The test creates a full SSS-3 stablecoin (transfer hook + allowlist + CT), adds parties to the allowlist, then performs deposit → confidential transfer (ZK proofs + allowlist enforcement) → withdraw.

### How it works
Our Anchor program uses `spl-token-2022 v6` for CPI, but SPL Token-2022 instruction formats are **ABI-stable** — v6 CPI calls work correctly against v10 Token-2022 runtime. The transfer hook's allowlist is enforced even during confidential transfers via a `fallback` handler.

### CT Verification Results (14/14 checks passed)

| Step | Status | Notes |
|------|--------|-------|
| Build SSS-3 programs | Working | Anchor build |
| Build Token-2022 v10 with zk-ops | Working | Built from source |
| Start validator (v10 + SSS programs) | Working | Custom validator setup |
| **Create SSS-3 mint via `init sss-3`** | **Working** | v6 CPI → v10 runtime, hook + allowlist + CT |
| Auto-init transfer hook ExtraAccountMetaList | Working | Hook ready for enforcement |
| Verify CT extension on mint | Working | `ConfidentialTransferMint` confirmed |
| Assign minter + mint 1000 tokens | Working | Program RBAC + mint |
| **Add sender to allowlist** | **Working** | SSS-3 compliance requirement |
| Configure CT (ElGamal keys) | Working | Sender + recipient configured |
| **Add recipient to allowlist** | **Working** | SSS-3 compliance requirement |
| **Deposit 100 into confidential balance** | **Working** | Public → encrypted |
| **Confidential transfer 50 tokens** | **Working** | ZK proofs + transfer hook allowlist enforced |
| **Withdraw 25 from confidential** | **Working** | Encrypted → public |
| Verify final balances (900 / 25) | Working | Sender: 900 public, Recipient: 25 public |

### How to reproduce

```bash
# End-to-end CT on SSS-3 program mint (14/14 checks):
bash scripts/test-ct-e2e.sh

# Standalone CT verification + anchor tests:
yarn test:ct
```

The e2e test builds Token-2022 v10.0.0 from [source](https://github.com/solana-program/token-2022), starts a validator with v10 + SSS programs, creates an SSS-3 stablecoin, and runs the full CT flow. See [`evidence/CT-PROOF.md`](evidence/CT-PROOF.md) for details.

### Cluster availability

| Cluster | CT Status | Why |
|---------|-----------|-----|
| **Localnet** | **Working** | Token-2022 v10 with `zk-ops` loaded via `--bpf-program` |
| Devnet/Mainnet | Blocked upstream | ZK ElGamal Proof program disabled (security audit pending) |

## Testing

219+ tests across multiple test suites, all passing:

```
  Anchor Integration Tests (136 tests):
    SSS-1: Minimal Stablecoin (7 tests)
    SSS-2: Compliant Stablecoin (7 tests)
    SSS-3: Private Stablecoin — Allowlist + CT (11 tests)
    Authority Transfer (7 tests)
    Supply Cap & Minter Quotas (10 tests)
    Roles Edge Cases (16 tests)
    Role Escalation & Access Control (13 tests)
    Burn Edge Cases (6 tests)
    Pause/Unpause Edge Cases (7 tests)
    Freeze/Thaw Edge Cases (5 tests)
    Supply Cap Edge Cases (4 tests)
    Blacklist Edge Cases (7 tests)
    Authority Transfer Edge Cases (6 tests)
    Allowlist Edge Cases (6 tests)
    Initialization Edge Cases (6 tests)
    Minter Quota Edge Cases (5 tests)
    Combined Compliance Scenarios (3 tests)
    CLI Smoke Tests (12 tests)

  SDK Unit Tests (24 tests)
  Backend API Tests (24 tests)
  Docker Smoke Tests (6 tests)
  Trident Fuzz Flows (17 flows)

  136 anchor + 12 CLI + 24 SDK + 24 backend + 6 docker + 17 fuzz = 219+
```

### Test Environment Matrix

| Command | Environment | What it tests | Why that environment |
|---------|-------------|---------------|---------------------|
| `anchor test` | Local validator | Core program logic (136 tests) | Deterministic, no network dependency |
| `yarn test:sdk` | Local/unit | SDK TypeScript modules | Pure unit tests |
| `yarn test:ct` | Localnet (custom validator) | **End-to-end CT on SSS-3 program mint** (14/14) | Requires Token-2022 v10 with `zk-ops` |
| `yarn test:oracle:devnet` | **Devnet** | Oracle price enforcement (4 tests) | Pyth price feeds are live external accounts — cloned accounts on local validator go stale immediately |
| `yarn test:cli` | **Devnet** | CLI smoke tests (12 tests) | Verifies CLI commands work against live stablecoins |
| `yarn --cwd backend test` | Local | Backend API endpoints | No chain dependency |

### Run Tests

```bash
# Core program tests (local validator, deterministic)
anchor test

# SSS-3 end-to-end confidential transfer (14/14 checks)
yarn test:ct

# Oracle integration (devnet — requires live Pyth price feeds)
yarn test:oracle:devnet

# SDK unit tests
cd sdk/core && yarn test

# CLI smoke tests (devnet)
yarn test:cli

# Backend API tests
cd backend && yarn test
```

### Docker Smoke Test

Builds and starts the full containerised stack (API + indexer), then runs 6 end-to-end checks against the live endpoints.

```bash
colima start          # if using colima
cd backend/docker
./smoke-test.sh
```

### Trident Fuzz Testing

Property-based fuzz testing via [Trident](https://github.com/Ackee-Blockchain/trident) (Ackee Blockchain). The harness executes real program instructions through `process_transaction` against a local SVM and checks invariants after each flow.

```bash
anchor build
cd trident-tests/fuzz_tests/fuzz_0
cargo run
```

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
- `sss_token`: `BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq`
- `sss_transfer_hook`: `B9HzG9fuxbuJBG2wTSP6UmxBSQLdaUAk62Kcdf41WxAt`

## License

MIT

## Contributing

PRs welcome. Please open an issue first to discuss significant changes.
