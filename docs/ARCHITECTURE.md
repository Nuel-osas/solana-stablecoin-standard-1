# Architecture

## Layer Model

The Solana Stablecoin Standard follows a three-layer architecture, similar to OpenZeppelin's approach where the library (SDK) makes standards easy to deploy, and the standards (SSS-1, SSS-2) are what get adopted.

### Layer 1 — Base SDK

The foundation layer provides:

- **Token creation** with Token-2022 mint authority + freeze authority + metadata
- **Role management program** — no single key controls everything
- **CLI + TypeScript SDK** for all operations

Every stablecoin uses Layer 1. It provides the minimum viable functionality for any token that needs issuance control.

### Layer 2 — Modules

Composable pieces that add capabilities on top of Layer 1:

- **Compliance Module**: Transfer hook for blacklist enforcement, blacklist PDAs, permanent delegate for seizure

Each module is independently testable and optional. Modules are enabled at initialization time and cannot be changed afterward (by design — changing compliance guarantees after launch would undermine trust).

### Layer 3 — Standard Presets

Opinionated combinations of Layer 1 + Layer 2:

- **SSS-1 (Minimal)**: Layer 1 only. For simple stablecoins — internal tokens, DAO treasuries, ecosystem settlement. Compliance is reactive (freeze accounts as needed).
- **SSS-2 (Compliant)**: Layer 1 + Compliance Module. For regulated stablecoins — USDC/USDT-class tokens where regulators expect on-chain blacklist enforcement and token seizure capabilities.

## Data Flow

```
User Action → CLI/SDK → Anchor Program → Token-2022 Extensions
                                      ↓
                              State Accounts (PDAs)
                              ├── Stablecoin Config
                              ├── Role Assignments
                              ├── Minter Info (quotas)
                              └── Blacklist Entries (SSS-2)
```

### Transfer Flow (SSS-2)

```
Transfer Request → Token-2022 → Transfer Hook Program
                                        ↓
                                Check Blacklist PDAs
                                (sender + recipient)
                                        ↓
                              ✓ Approved → Transfer completes
                              ✗ Blacklisted → Transfer rejected
```

## Security Model

### Role Separation

The system enforces strict separation of concerns:

1. **Master Authority**: Can only manage roles. Cannot directly mint, burn, or seize.
2. **Minters**: Can only mint, subject to per-minter quotas.
3. **Pausers**: Can freeze/thaw individual accounts and pause/unpause global operations.
4. **Blacklisters**: Can only manage the blacklist. Cannot seize tokens.
5. **Seizers**: Can only seize from blacklisted accounts. Cannot blacklist.

This prevents any single compromised key from causing maximum damage.

### PDA Authority

All sensitive operations (minting, freezing, seizing) are performed by the Stablecoin PDA, not by any EOA. The PDA is derived deterministically from the mint address, making it verifiable and non-custodial.

### Immutable Compliance Configuration

Whether compliance features (permanent delegate, transfer hook) are enabled is set at initialization and stored immutably. This prevents:
- Upgrading a "safe" SSS-1 token to SSS-2 and retroactively gaining seizure powers
- Downgrading SSS-2 to avoid blacklist enforcement

### Transfer Hook Enforcement

The transfer hook checks blacklist PDAs on **every transfer**. There are no gaps — the hook runs at the Token-2022 program level, not at the application level. This means even direct SPL transfers (not going through the SSS program) are subject to blacklist checks.

## Account Structure

```
Stablecoin (PDA: ["stablecoin", mint])
├── authority: Pubkey (master)
├── mint: Pubkey
├── config flags (paused, compliance settings)
├── supply tracking (total_minted, total_burned)
└── _reserved: [u8; 64] (future upgrades)

RoleAssignment (PDA: ["role", stablecoin, role_type, assignee])
├── role: enum
├── assignee: Pubkey
└── active: bool

MinterInfo (PDA: ["minter_info", stablecoin, minter])
├── quota: u64
└── minted: u64

BlacklistEntry (PDA: ["blacklist", stablecoin, address])
├── reason: String
├── blacklisted_at: i64
└── blacklisted_by: Pubkey
```
