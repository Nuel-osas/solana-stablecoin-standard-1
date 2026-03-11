# SDK Reference

## Installation

```bash
yarn add @stbr/sss-token
```

## Presets

### SSS-1 (Minimal)

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-token";

const stable = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_1,
  name: "Simple USD",
  symbol: "SUSD",
  decimals: 6,
  authority: adminKeypair,
});
```

### SSS-2 (Compliant)

```typescript
const stable = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_2,
  name: "Compliant USD",
  symbol: "CUSD",
  decimals: 6,
  authority: adminKeypair,
});
```

### Custom Configuration

```typescript
const stable = await SolanaStablecoin.create(connection, {
  name: "Custom Token",
  symbol: "CTOK",
  decimals: 6,
  authority: adminKeypair,
  extensions: {
    permanentDelegate: true,
    transferHook: false,
    defaultAccountFrozen: true,
  },
});
```

## Core Operations

### Mint

```typescript
await stable.mintTokens({
  recipient: userPublicKey,
  amount: 1_000_000, // 1 token with 6 decimals
  minter: minterKeypair,
});
```

### Burn

```typescript
await stable.burn({
  amount: 500_000,
  burner: burnerKeypair,
  from: tokenAccountPublicKey,
});
```

### Freeze / Thaw

```typescript
await stable.freezeAccount({
  account: tokenAccountPublicKey,
  authority: pauserKeypair,
});

await stable.thawAccount({
  account: tokenAccountPublicKey,
  authority: pauserKeypair,
});
```

### Pause / Unpause

```typescript
await stable.pause(pauserKeypair);
await stable.unpause(pauserKeypair);
```

### Role Management

```typescript
await stable.assignRole({
  role: "minter",
  assignee: minterPublicKey,
  authority: masterKeypair,
});

await stable.revokeRole({
  role: "minter",
  assignee: minterPublicKey,
  authority: masterKeypair,
});
```

## Compliance Module (SSS-2)

### Blacklist

```typescript
// Add to blacklist (requires blacklister keypair)
await stable.compliance.blacklistAdd(
  addressPublicKey,
  "OFAC sanctions match",
  blacklisterKeypair
);

// Check if blacklisted
const isBlacklisted = await stable.compliance.isBlacklisted(addressPublicKey);

// Get blacklist entry details
const entry = await stable.compliance.getBlacklistEntry(addressPublicKey);
// { address, reason, blacklistedAt, blacklistedBy }

// Remove from blacklist (requires blacklister keypair)
await stable.compliance.blacklistRemove(addressPublicKey, blacklisterKeypair);
```

### Seize

```typescript
await stable.compliance.seize({
  sourceAccount: frozenAccountPublicKey,
  treasuryAccount: treasuryPublicKey,
  seizer: seizerKeypair,
});
```

## Allowlist Module (SSS-3)

```typescript
// Add to allowlist (master authority only)
await stable.compliance.allowlistAdd(addressPublicKey, authorityKeypair);

// Remove from allowlist
await stable.compliance.allowlistRemove(addressPublicKey, authorityKeypair);

// Check if allowlisted
const isAllowed = await stable.compliance.isAllowlisted(addressPublicKey);

// Get allowlist entry details
const entry = await stable.compliance.getAllowlistEntry(addressPublicKey);
// { address, stablecoin, addedBy, addedAt }
```

## Authority & Supply Cap

```typescript
// Two-step authority transfer (prevents loss from typos)
await stable.nominateAuthority(currentAuthorityKeypair, newAuthorityPubkey);
await stable.acceptAuthority(newAuthorityKeypair);

// Set supply cap (0 = unlimited)
await stable.setSupplyCap(authorityKeypair, 1_000_000_000);
```

## Query Functions

```typescript
// Total supply
const supply = await stable.getTotalSupply();

// Stablecoin state
const state = await stable.getState();
// { authority, mint, name, symbol, decimals, paused, ... }
```

## PDA Helpers

```typescript
import { findStablecoinPDA, findRolePDA, findBlacklistPDA, findMinterInfoPDA, findAllowlistPDA } from "@stbr/sss-token";

const [stablecoinPDA, bump] = findStablecoinPDA(mintPublicKey, programId);
const [rolePDA] = findRolePDA(stablecoinPDA, "minter", assigneePublicKey, programId);
const [blacklistPDA] = findBlacklistPDA(stablecoinPDA, addressPublicKey, programId);
const [minterInfoPDA] = findMinterInfoPDA(stablecoinPDA, minterPublicKey, programId);
const [allowlistPDA] = findAllowlistPDA(stablecoinPDA, addressPublicKey, programId);
```
