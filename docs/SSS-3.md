# SSS-3: Private Stablecoin Standard (Experimental)

## Overview

SSS-3 defines the private stablecoin — SSS-2 plus **allowlist-gated transfers** and **confidential transfer extension**. Only pre-approved addresses can send or receive tokens, and the mint is configured for confidential (ZK-encrypted) transfers.

**Status**: The full confidential transfer flow (deposit, ZK transfer, withdraw) is **verified on localnet** via `yarn test:ct`. On devnet/mainnet, the ZK ElGamal program is not yet enabled and Token-2022 needs to be updated to v10.0.0+.

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

#### Localnet Testing Results — Full CT Flow Verified

We tested the **complete confidential transfer flow** on localnet by building Token-2022 v10.0.0 from source with the `zk-ops` feature flag enabled and loading it into the test validator via `--bpf-program`. Every step works end-to-end:

| Step | Status | Details |
|------|--------|---------|
| `ConfidentialTransferMint` init on mint | **Working** | Extension initialized during SSS-3 `initialize` instruction. Verified in test suite. |
| Token account creation | **Working** | Standard Token-2022 `create-account`. |
| Account CT configuration | **Working** | `spl-token configure-confidential-transfer-account` succeeds. ElGamal encryption keys generated and stored. |
| Deposit into confidential balance | **Working** | `spl-token deposit-confidential-tokens` succeeds with Token-2022 v10.0.0 + `zk-ops`. |
| Apply pending balance | **Working** | Pending confidential balance applied to available balance. |
| **Confidential transfer** | **Working** | `spl-token transfer --confidential` — ZK range proofs generated and verified on-chain. |
| **Withdraw from confidential balance** | **Working** | `spl-token withdraw-confidential-tokens` decrypts back to public balance. |
| ZK ElGamal Proof program (localnet) | **Available** | Native program `ZkE1Gama1Proof11111111111111111111111111111` present in Solana 3.1.10 test validator. |

#### Why It Fails with the Default Test Validator

The test validator bundled with Solana 3.1.10 ships Token-2022 **v6.0.0**, but the `spl-token` CLI v5.5.0 is built against Token-2022 **v10.0.0**. This version mismatch causes `InvalidInstructionData` errors because the instruction data format changed between versions.

Additionally, the v6.0.0 build gates CT operations behind `#[cfg(feature = "zk-ops")]`:

```rust
ConfidentialTransferInstruction::Deposit => {
    #[cfg(feature = "zk-ops")]
    {
        process_deposit(program_id, accounts, data.amount.into(), data.decimals)
    }
    #[cfg(not(feature = "zk-ops"))]
    Err(ProgramError::InvalidInstructionData)
}
```

#### How to Reproduce the Full CT Flow

```bash
# 1. Build Token-2022 v10.0.0 from source (zk-ops is the default feature)
git clone --depth 1 https://github.com/solana-program/token-2022.git
cd token-2022/program && cargo build-sbf

# 2. Start test validator with custom Token-2022
solana-test-validator \
  --bpf-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  target/deploy/spl_token_2022.so --reset

# 3. Create mint with CT extension
spl-token create-token --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --enable-confidential-transfers auto --decimals 6

# 4. Create account & configure CT
spl-token create-account <MINT>
spl-token configure-confidential-transfer-account --address <ATA>

# 5. Mint, deposit, transfer, withdraw
spl-token mint <MINT> 1000
spl-token deposit-confidential-tokens <MINT> 100
spl-token apply-pending-balance --address <ATA>
spl-token transfer <MINT> 50 <RECIPIENT> --confidential
spl-token withdraw-confidential-tokens <MINT> 25 --address <RECIPIENT_ATA>
```

#### Current Limitations (Devnet/Mainnet)

- **ZK ElGamal Proof program**: Disabled on devnet/mainnet (undergoing security audit)
- **TypeScript SDK**: `@solana/spl-token` v0.4.x does not export confidential transfer client functions
- **Production readiness**: Waiting for Solana to enable the ZK proof program and update the deployed Token-2022 to v10.0.0+

#### What Works Today (Without Custom Build)

- The `ConfidentialTransferMint` extension is initialized on the mint account
- The extension can be queried and verified on-chain
- Token accounts can be configured for confidential transfers (ElGamal keys generated)
- All allowlist and blacklist enforcement works independently of confidential transfers

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
