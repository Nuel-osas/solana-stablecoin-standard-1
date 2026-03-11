# Solana Stablecoin Standard (SSS)

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
| **SSS-3** | Private Stablecoin | SSS-2 + allowlist-gated transfers + confidential transfer extension (experimental). Only pre-approved addresses can send/receive. ZK-encrypted balances ready for when Solana enables the ZK ElGamal program. |

## Quick Start

### Initialize a stablecoin

```bash
# SSS-1: Minimal
sss-token init sss-1 --name "My Stablecoin" --symbol "MUSD" --decimals 6

# SSS-2: Compliant
sss-token init sss-2 --name "Regulated USD" --symbol "RUSD" --decimals 6

# SSS-3: Private (allowlist-gated)
sss-token init sss-3 --name "Private USD" --symbol "PUSD" --decimals 6

# Custom config
sss-token init custom --config config.toml
```

### Operations

```bash
# Mint tokens
sss-token mint --to <recipient> --amount 1000000 --mint <address>

# Burn tokens
sss-token burn --amount 500000 --mint <address>

# Freeze/thaw accounts
sss-token freeze --account <address> --mint <address>
sss-token thaw --account <address> --mint <address>

# Pause/unpause all operations
sss-token pause --mint <address>
sss-token unpause --mint <address>

# Check status
sss-token status --mint <address>
sss-token supply --mint <address>
```

### SSS-2 Compliance

```bash
# Blacklist management
sss-token blacklist add --address <address> --reason "OFAC match" --mint <address>
sss-token blacklist remove --address <address> --mint <address>

# Seize tokens (via permanent delegate)
sss-token seize --from <token-account> --to <treasury> --mint <address>

# Minter management
sss-token minters list --mint <address>
sss-token minters add --address <address> --mint <address>
sss-token minters remove --address <address> --mint <address>

# Audit
sss-token audit-log --mint <address>
sss-token holders --mint <address>
```

### SSS-3 Allowlist

```bash
# Allowlist management (authority-only)
sss-token allowlist add --address <address> --mint <address>
sss-token allowlist remove --address <address> --mint <address>
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
│   │       │   └── allowlist.rs  # Allowlist management (SSS-3)
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

## Token-2022 Extensions Used

| Extension | SSS-1 | SSS-2 | SSS-3 | Purpose |
|-----------|-------|-------|-------|---------|
| Metadata Pointer | Yes | Yes | Yes | On-chain metadata |
| Mint/Freeze Authority | Yes | Yes | Yes | Token control |
| Permanent Delegate | | Yes | Yes | Token seizure |
| Transfer Hook | | Yes | Yes | Blacklist + allowlist enforcement on every transfer |
| Default Account State | | Optional | Optional | Freeze new accounts by default |
| ConfidentialTransferMint | | | Yes | ZK-encrypted balances (experimental PoC) |

## SSS-3 Confidential Transfer (Verified on Localnet)

SSS-3 initializes the `ConfidentialTransferMint` extension on the mint, enabling ZK-encrypted confidential transfers. We verified the **complete CT flow** on localnet by building Token-2022 v10.0.0 from source with `zk-ops` enabled.

### Full CT Flow — All Steps Working

| Step | Status | Notes |
|------|--------|-------|
| ConfidentialTransferMint init on mint | Working | Extension verified in test suite |
| Token account creation | Working | Standard Token-2022 accounts |
| Account CT configuration (ElGamal keys) | Working | ElGamal encryption keys generated and stored |
| Deposit into confidential balance | Working | Tokens converted to encrypted balance |
| Apply pending balance | Working | Pending balance applied to available |
| **Confidential transfer** | **Working** | ZK proofs generated and verified on-chain |
| **Withdraw from confidential balance** | **Working** | Decrypted back to public balance |

### How we tested it

The default test validator ships Token-2022 v6.0.0, but the CLI v5.5.0 expects v10.0.0. We built Token-2022 v10.0.0 from [source](https://github.com/solana-program/token-2022) with `zk-ops` (default feature) and loaded it via `solana-test-validator --bpf-program`. Full reproduction steps in [`docs/SSS-3.md`](docs/SSS-3.md).

### Devnet/Mainnet limitations

The ZK ElGamal Proof program is disabled on devnet/mainnet (security audit pending). Once enabled and Token-2022 is updated to v10.0.0+, the same flow will work in production.

## Testing

58 integration tests across 6 test suites, all passing:

```
  SSS-1: Minimal Stablecoin (7 tests)
  SSS-2: Compliant Stablecoin (7 tests)
  SSS-3: Private Stablecoin — Allowlist + Confidential Transfer (11 tests)
  Authority Transfer (7 tests)
  Supply Cap & Minter Quotas (10 tests)
  Roles Edge Cases (16 tests)

  58 passing
```

### Run Tests

```bash
# Anchor integration tests (58 tests)
anchor test

# SSS-3 confidential transfer full flow (localnet, builds Token-2022 v10.0.0)
yarn test:ct

# SDK unit tests
cd sdk/core && yarn test

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
