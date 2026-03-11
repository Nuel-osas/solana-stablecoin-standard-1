import { PublicKey, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

export type RoleType = "minter" | "burner" | "blacklister" | "pauser" | "seizer";

/**
 * Convert a RoleType string to the Anchor enum variant object
 * expected by the IDL (e.g. { minter: {} }).
 */
export function roleToAnchorEnum(role: RoleType): object {
  switch (role) {
    case "minter":
      return { minter: {} };
    case "burner":
      return { burner: {} };
    case "blacklister":
      return { blacklister: {} };
    case "pauser":
      return { pauser: {} };
    case "seizer":
      return { seizer: {} };
  }
}

export interface StablecoinConfig {
  preset?: "SSS_1" | "SSS_2" | "SSS_3";
  name: string;
  symbol: string;
  uri?: string;
  decimals?: number;
  authority: Keypair;
  extensions?: {
    permanentDelegate?: boolean;
    transferHook?: boolean;
    defaultAccountFrozen?: boolean;
    enableAllowlist?: boolean;
  };
  supplyCap?: number | anchor.BN;
}

export interface StablecoinState {
  authority: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
  paused: boolean;
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
  defaultAccountFrozen: boolean;
  enableAllowlist: boolean;
  totalMinted: anchor.BN;
  totalBurned: anchor.BN;
  supplyCap: anchor.BN;
  pendingAuthority: PublicKey;
  bump: number;
}

export interface MintParams {
  recipientTokenAccount: PublicKey;
  amount: number | anchor.BN;
  minter: Keypair;
}

export interface BurnParams {
  amount: number | anchor.BN;
  burner: Keypair;
  tokenAccount: PublicKey;
}

export interface FreezeParams {
  tokenAccount: PublicKey;
  authority: Keypair;
}

export interface ThawParams {
  tokenAccount: PublicKey;
  authority: Keypair;
}

export interface BlacklistParams {
  address: PublicKey;
  reason: string;
  blacklister: Keypair;
}

export interface SeizeParams {
  sourceAccount: PublicKey;
  treasuryAccount: PublicKey;
  seizer: Keypair;
}
