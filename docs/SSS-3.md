# SSS-3: Private Stablecoin Standard (Experimental)

## Overview

SSS-3 defines the private stablecoin — SSS-2 plus **allowlist-gated transfers** and **confidential transfer extension**. Only pre-approved addresses can send or receive tokens, and the mint is configured for future confidential (ZK-encrypted) transfers.

**Status**: Experimental proof-of-concept. The Solana ZK ElGamal program required for full confidential transfer operations is not yet enabled on devnet/mainnet. The ConfidentialTransferMint extension is initialized on the mint to signal intent and readiness.

**Use cases**: Institutional tokens, permissioned stablecoins, jurisdiction-restricted tokens, private settlement networks.

## Specification

### Token Properties

| Property | Value |
|----------|-------|
| Token Standard | Token-2022 (SPL Token Extensions) |
| Extensions | Metadata Pointer, Permanent Delegate, Transfer Hook, ConfidentialTransferMint |
| Mint Authority | Stablecoin PDA |
| Freeze Authority | Stablecoin PDA |
| Permanent Delegate | Stablecoin PDA |
| Transfer Hook | SSS Transfer Hook Program |
| Confidential Transfer | Extension initialized (experimental) |

### Additional Instructions (Beyond SSS-2)

| Instruction | Description | Required Role |
|-------------|-------------|---------------|
| `add_to_allowlist` | Add address to allowlist | Master Authority |
| `remove_from_allowlist_entry` | Remove from allowlist | Master Authority |

### Allowlist Model

SSS-3 uses **scoped allowlists** — only pre-approved addresses can participate:

- Transfer hook checks allowlist on **every transfer**
- Both sender and recipient must be on the allowlist
- Allowlist is managed by the master authority only
- Allowlist entries include `addedBy` and `addedAt` for audit trail

### Transfer Hook Flow (SSS-3)

```
Every Token-2022 Transfer:
  1. Token-2022 invokes transfer hook
  2. Hook derives blacklist PDAs for sender and recipient
  3. If either is blacklisted → transfer REJECTED
  4. Hook derives allowlist PDAs for sender and recipient
  5. If either is NOT on allowlist → transfer REJECTED
  6. Transfer APPROVED
```

Both blacklist and allowlist are enforced simultaneously.

### Confidential Transfer Extension

The `ConfidentialTransferMint` Token-2022 extension is initialized on SSS-3 mints with:

- **Authority**: The initializing authority (can update CT config)
- **Auto-approve new accounts**: `true` (accounts don't need separate CT approval)
- **Auditor ElGamal pubkey**: `None` (no auditor — experimental PoC)

#### Current Limitations & Localnet Testing Results

We tested the full confidential transfer flow on localnet (Solana 3.1.10) and documented exactly where tooling breaks:

| Step | Status | Details |
|------|--------|---------|
| `ConfidentialTransferMint` init on mint | **Working** | Extension initialized during SSS-3 `initialize` instruction. Verified in test suite. |
| Token account creation | **Working** | Standard Token-2022 `create-account`. |
| Account CT configuration | **Working** | `spl-token configure-confidential-transfer-account` succeeds. ElGamal encryption keys are generated and stored on the account. |
| Deposit into confidential balance | **Blocked** | `spl-token deposit-confidential-tokens` fails with `InvalidInstructionData`. The CLI (v5.5.0) sends instruction data the on-chain Token-2022 program does not recognize. |
| Confidential transfer | **Blocked** | Depends on deposit. |
| ZK ElGamal Proof program (localnet) | **Available** | Native program `ZkE1Gama1Proof11111111111111111111111111111` is present in the Solana 3.1.10 test validator. |
| ZK ElGamal Proof program (devnet/mainnet) | **Disabled** | Undergoing security audit. |
| TypeScript SDK support | **Not available** | `@solana/spl-token` v0.4.x does not export confidential transfer client functions. No standalone npm package exists. |

#### Root Cause Analysis

The deposit failure is **not** a CLI version mismatch. After tracing through the Token-2022 Rust source (`spl-token-2022` v6.0.0), we found the root cause:

The Token-2022 program is compiled **without the `zk-ops` Rust feature flag**. In `extension/confidential_transfer/processor.rs`, all CT operations (deposit, withdraw, transfer) are gated by `#[cfg(feature = "zk-ops")]`:

```rust
ConfidentialTransferInstruction::Deposit => {
    #[cfg(feature = "zk-ops")]
    {
        let data = decode_instruction_data::<DepositInstructionData>(input)?;
        process_deposit(program_id, accounts, data.amount.into(), data.decimals)
    }
    #[cfg(not(feature = "zk-ops"))]
    Err(ProgramError::InvalidInstructionData)
}
```

When `zk-ops` is disabled at compile time, the program unconditionally returns `InvalidInstructionData` for deposit, withdraw, and transfer — regardless of the client or instruction format used. This applies to both the localnet test validator and the mainnet-cloned program.

We verified this by:
1. Trying the `spl-token` CLI (v5.5.0) — `InvalidInstructionData`
2. Trying `@solana-program/token-2022` v0.9.0 instruction builders — same error
3. Manually constructing the deposit instruction in TypeScript — same error
4. Cloning Token-2022 from mainnet (`--clone TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) — same error

No client-side workaround exists. The fix requires Solana to ship a Token-2022 build with `zk-ops` enabled.

#### What Works Today

- The `ConfidentialTransferMint` extension is initialized on the mint account
- The extension can be queried and verified on-chain
- Token accounts can be configured for confidential transfers (ElGamal keys generated)
- The extension signals that the mint is "CT-ready" for when the tooling catches up
- All allowlist and blacklist enforcement works independently of confidential transfers

#### Roadmap

When the `spl-token` CLI and TypeScript SDK are updated to match the on-chain program:

1. Deposits will convert public token balances into encrypted confidential balances
2. Transfers will use ZK range proofs to verify amounts without revealing them
3. Withdrawals will decrypt confidential balances back to public amounts
4. The ZK ElGamal Proof program will need to be enabled on devnet/mainnet for production use

### Initialization

```rust
StablecoinInitConfig {
    name: "Private USD",
    symbol: "PUSD",
    uri: "https://...",
    decimals: 6,
    enable_permanent_delegate: true,
    enable_transfer_hook: true,
    default_account_frozen: false,
    enable_allowlist: true,  // enables allowlist + ConfidentialTransferMint
    supply_cap: None,
}
```

### Comparison

| Feature | SSS-1 | SSS-2 | SSS-3 |
|---------|-------|-------|-------|
| Mint/Burn | Yes | Yes | Yes |
| Freeze/Thaw | Yes | Yes | Yes |
| Pause/Unpause | Yes | Yes | Yes |
| Transfer Hook | | Yes | Yes |
| Blacklist | | Yes | Yes |
| Permanent Delegate | | Yes | Yes |
| Token Seizure | | Yes | Yes |
| Allowlist | | | Yes |
| Confidential Transfer | | | Yes (experimental) |
| Access model | Open | Blacklist | Allowlist + Blacklist |
| Privacy | None | None | Extension ready |
