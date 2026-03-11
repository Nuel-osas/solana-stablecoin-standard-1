import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { findBlacklistPDA, findRolePDA, findAllowlistPDA } from "./pda";
import type { BlacklistParams, SeizeParams } from "./types";

export class ComplianceModule {
  private stablecoin: any; // SolanaStablecoin (avoid circular import)
  private program: anchor.Program;

  constructor(stablecoin: any, program: anchor.Program) {
    this.stablecoin = stablecoin;
    this.program = program;
  }

  /**
   * Add an address to the blacklist. SSS-2 only.
   * Caller must have blacklister role.
   */
  async blacklistAdd(
    address: PublicKey,
    reason: string,
    blacklister: Keypair
  ): Promise<string> {
    const [blacklistPDA] = findBlacklistPDA(
      this.stablecoin.stablecoinPDA,
      address,
      this.stablecoin.programId
    );

    const [rolePDA] = findRolePDA(
      this.stablecoin.stablecoinPDA,
      "blacklister",
      blacklister.publicKey,
      this.stablecoin.programId
    );

    const txSig = await this.program.methods
      .addToBlacklist(address, reason)
      .accounts({
        blacklister: blacklister.publicKey,
        stablecoin: this.stablecoin.stablecoinPDA,
        roleAssignment: rolePDA,
        blacklistEntry: blacklistPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklister])
      .rpc();

    return txSig;
  }

  /**
   * Remove an address from the blacklist. SSS-2 only.
   * Caller must have blacklister role.
   */
  async blacklistRemove(
    address: PublicKey,
    blacklister: Keypair
  ): Promise<string> {
    const [blacklistPDA] = findBlacklistPDA(
      this.stablecoin.stablecoinPDA,
      address,
      this.stablecoin.programId
    );

    const [rolePDA] = findRolePDA(
      this.stablecoin.stablecoinPDA,
      "blacklister",
      blacklister.publicKey,
      this.stablecoin.programId
    );

    const txSig = await this.program.methods
      .removeFromBlacklist(address)
      .accounts({
        blacklister: blacklister.publicKey,
        stablecoin: this.stablecoin.stablecoinPDA,
        roleAssignment: rolePDA,
        blacklistEntry: blacklistPDA,
      })
      .signers([blacklister])
      .rpc();

    return txSig;
  }

  /**
   * Check if an address is blacklisted.
   */
  async isBlacklisted(address: PublicKey): Promise<boolean> {
    const entry = await this.getBlacklistEntry(address);
    return entry !== null && entry.active;
  }

  /**
   * Seize tokens from a blacklisted/frozen account. SSS-2 only.
   * Uses permanent delegate to transfer tokens to treasury.
   * Caller must have seizer role.
   */
  async seize(params: SeizeParams): Promise<string> {
    const [rolePDA] = findRolePDA(
      this.stablecoin.stablecoinPDA,
      "seizer",
      params.seizer.publicKey,
      this.stablecoin.programId
    );

    // The blacklist entry PDA is derived from the owner of the source account.
    // Anchor will resolve source_account.owner automatically from the IDL seeds,
    // but we pass the blacklistEntry explicitly.
    // We need to read the source_account to find its owner for the blacklist PDA.
    // However, the IDL uses "source_account.owner" in the seeds, which Anchor
    // resolves at runtime. We just need to pass the accounts.

    const txSig = await this.program.methods
      .seize()
      .accounts({
        seizer: params.seizer.publicKey,
        stablecoin: this.stablecoin.stablecoinPDA,
        mint: this.stablecoin.mint,
        roleAssignment: rolePDA,
        sourceAccount: params.sourceAccount,
        treasuryAccount: params.treasuryAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([params.seizer])
      .rpc();

    return txSig;
  }

  /**
   * Get the blacklist entry for an address.
   */
  async getBlacklistEntry(address: PublicKey): Promise<{
    stablecoin: PublicKey;
    address: PublicKey;
    reason: string;
    blacklistedAt: anchor.BN;
    blacklistedBy: PublicKey;
    active: boolean;
    bump: number;
  } | null> {
    const [blacklistPDA] = findBlacklistPDA(
      this.stablecoin.stablecoinPDA,
      address,
      this.stablecoin.programId
    );

    try {
      const account = await (this.program.account as any).blacklistEntry.fetch(
        blacklistPDA
      );
      return {
        stablecoin: account.stablecoin,
        address: account.address,
        reason: account.reason,
        blacklistedAt: account.blacklistedAt,
        blacklistedBy: account.blacklistedBy,
        active: account.active,
        bump: account.bump,
      };
    } catch (e: any) {
      if (
        e.message?.includes("Account does not exist") ||
        e.message?.includes("Could not find")
      ) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Add an address to the allowlist. SSS-3 only.
   * Caller must be master authority.
   */
  async allowlistAdd(
    address: PublicKey,
    authority: Keypair
  ): Promise<string> {
    const [allowlistPDA] = findAllowlistPDA(
      this.stablecoin.stablecoinPDA,
      address,
      this.stablecoin.programId
    );

    const txSig = await this.program.methods
      .addToAllowlist(address)
      .accounts({
        authority: authority.publicKey,
        stablecoin: this.stablecoin.stablecoinPDA,
        allowlistEntry: allowlistPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    return txSig;
  }

  /**
   * Remove an address from the allowlist. SSS-3 only.
   * Caller must be master authority.
   */
  async allowlistRemove(
    address: PublicKey,
    authority: Keypair
  ): Promise<string> {
    const [allowlistPDA] = findAllowlistPDA(
      this.stablecoin.stablecoinPDA,
      address,
      this.stablecoin.programId
    );

    const txSig = await this.program.methods
      .removeFromAllowlistEntry(address)
      .accounts({
        authority: authority.publicKey,
        stablecoin: this.stablecoin.stablecoinPDA,
        allowlistEntry: allowlistPDA,
      })
      .signers([authority])
      .rpc();

    return txSig;
  }

  /**
   * Check if an address is on the allowlist.
   */
  async isAllowlisted(address: PublicKey): Promise<boolean> {
    const [allowlistPDA] = findAllowlistPDA(
      this.stablecoin.stablecoinPDA,
      address,
      this.stablecoin.programId
    );

    const accountInfo = await this.stablecoin.connection.getAccountInfo(allowlistPDA);
    return accountInfo !== null;
  }

  /**
   * Get the allowlist entry for an address.
   */
  async getAllowlistEntry(address: PublicKey): Promise<{
    stablecoin: PublicKey;
    address: PublicKey;
    addedAt: anchor.BN;
    addedBy: PublicKey;
    bump: number;
  } | null> {
    const [allowlistPDA] = findAllowlistPDA(
      this.stablecoin.stablecoinPDA,
      address,
      this.stablecoin.programId
    );

    try {
      const account = await (this.program.account as any).allowlistEntry.fetch(
        allowlistPDA
      );
      return {
        stablecoin: account.stablecoin,
        address: account.address,
        addedAt: account.addedAt,
        addedBy: account.addedBy,
        bump: account.bump,
      };
    } catch (e: any) {
      if (
        e.message?.includes("Account does not exist") ||
        e.message?.includes("Could not find")
      ) {
        return null;
      }
      throw e;
    }
  }
}
