import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { findStablecoinPDA, findRolePDA, findMinterInfoPDA, findOracleConfigPDA } from "./pda";
import { ComplianceModule } from "./compliance";
import { roleToAnchorEnum } from "./types";
import type {
  StablecoinConfig,
  StablecoinState,
  RoleType,
  MintParams,
  BurnParams,
  FreezeParams,
  ThawParams,
  TransferParams,
} from "./types";

import idlJson from "./idl/sss_token.json";

const PROGRAM_ID = new PublicKey("BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq");
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey("B9HzG9fuxbuJBG2wTSP6UmxBSQLdaUAk62Kcdf41WxAt");

export enum Presets {
  SSS_1 = "SSS_1",
  SSS_2 = "SSS_2",
  SSS_3 = "SSS_3",
}

/**
 * Create an Anchor Program instance from a connection and wallet.
 */
function createProgram(
  provider: anchor.AnchorProvider,
  programId?: PublicKey
): anchor.Program {
  const pid = programId ?? PROGRAM_ID;
  // Override the IDL's embedded address so forked/redeployed programs work
  const idl = { ...idlJson, address: pid.toBase58() } as anchor.Idl;
  return new anchor.Program(idl, provider);
}

/**
 * A read-only wallet adapter for loading state without signing.
 */
class ReadOnlyWallet implements anchor.Wallet {
  publicKey: PublicKey;
  payer: Keypair;

  constructor() {
    this.payer = Keypair.generate();
    this.publicKey = this.payer.publicKey;
  }

  async signTransaction<T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(
    tx: T
  ): Promise<T> {
    throw new Error("Read-only wallet cannot sign transactions");
  }

  async signAllTransactions<T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    throw new Error("Read-only wallet cannot sign transactions");
  }
}

export class SolanaStablecoin {
  public readonly connection: Connection;
  public readonly programId: PublicKey;
  public readonly mint: PublicKey;
  public readonly stablecoinPDA: PublicKey;
  public readonly compliance: ComplianceModule;

  private bump: number;
  private program: anchor.Program;

  private constructor(
    connection: Connection,
    programId: PublicKey,
    mint: PublicKey,
    stablecoinPDA: PublicKey,
    bump: number,
    program: anchor.Program
  ) {
    this.connection = connection;
    this.programId = programId;
    this.mint = mint;
    this.stablecoinPDA = stablecoinPDA;
    this.bump = bump;
    this.program = program;
    this.compliance = new ComplianceModule(this, program);
  }

  /**
   * Get the underlying Anchor Program instance.
   */
  getProgram(): anchor.Program {
    return this.program;
  }

  /**
   * Create and initialize a new stablecoin.
   * Sends the `initialize` instruction on-chain.
   */
  static async create(
    connection: Connection,
    config: StablecoinConfig,
    programId?: PublicKey
  ): Promise<SolanaStablecoin> {
    const pid = programId ?? PROGRAM_ID;
    const mintKeypair = Keypair.generate();
    const [stablecoinPDA, bump] = findStablecoinPDA(mintKeypair.publicKey, pid);

    // Determine preset config
    let enablePermanentDelegate = false;
    let enableTransferHook = false;
    let defaultAccountFrozen = false;
    let enableAllowlist = false;

    if (config.preset === Presets.SSS_2) {
      enablePermanentDelegate = true;
      enableTransferHook = true;
    } else if (config.preset === Presets.SSS_3) {
      enablePermanentDelegate = true;
      enableTransferHook = true;
      enableAllowlist = true;
    }

    if (config.extensions) {
      enablePermanentDelegate = config.extensions.permanentDelegate ?? enablePermanentDelegate;
      enableTransferHook = config.extensions.transferHook ?? enableTransferHook;
      defaultAccountFrozen = config.extensions.defaultAccountFrozen ?? defaultAccountFrozen;
      enableAllowlist = config.extensions.enableAllowlist ?? enableAllowlist;
    }

    const supplyCap = config.supplyCap
      ? (config.supplyCap instanceof anchor.BN ? config.supplyCap : new anchor.BN(config.supplyCap.toString()))
      : null;

    const initConfig = {
      name: config.name,
      symbol: config.symbol,
      uri: config.uri ?? "",
      decimals: config.decimals ?? 6,
      enablePermanentDelegate,
      enableTransferHook,
      defaultAccountFrozen,
      enableAllowlist,
      supplyCap,
    };

    // Build provider from the authority keypair
    const wallet = {
      publicKey: config.authority.publicKey,
      payer: config.authority,
      signTransaction: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T): Promise<T> => {
        if (tx instanceof anchor.web3.Transaction) {
          tx.partialSign(config.authority);
        }
        return tx;
      },
      signAllTransactions: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(txs: T[]): Promise<T[]> => {
        for (const tx of txs) {
          if (tx instanceof anchor.web3.Transaction) {
            tx.partialSign(config.authority);
          }
        }
        return txs;
      },
    } as anchor.Wallet;

    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    const program = createProgram(provider, pid);

    // Send the initialize instruction
    await program.methods
      .initialize(initConfig)
      .accounts({
        authority: config.authority.publicKey,
        mint: mintKeypair.publicKey,
        stablecoin: stablecoinPDA,
        transferHookProgram: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([mintKeypair])
      .rpc();

    return new SolanaStablecoin(
      connection,
      pid,
      mintKeypair.publicKey,
      stablecoinPDA,
      bump,
      program
    );
  }

  /**
   * Load an existing stablecoin by mint address.
   * Creates a read-only provider for fetching state.
   * Pass an `AnchorProvider` if you need to send transactions.
   */
  static async load(
    connection: Connection,
    mint: PublicKey,
    programId?: PublicKey,
    provider?: anchor.AnchorProvider
  ): Promise<SolanaStablecoin> {
    const pid = programId ?? PROGRAM_ID;
    const [stablecoinPDA, bump] = findStablecoinPDA(mint, pid);

    let anchorProvider: anchor.AnchorProvider;
    if (provider) {
      anchorProvider = provider;
    } else {
      const readOnlyWallet = new ReadOnlyWallet();
      anchorProvider = new anchor.AnchorProvider(connection, readOnlyWallet, {
        commitment: "confirmed",
      });
    }

    const program = createProgram(anchorProvider, pid);

    return new SolanaStablecoin(connection, pid, mint, stablecoinPDA, bump, program);
  }

  /**
   * Fetch on-chain state of the stablecoin.
   */
  async getState(): Promise<StablecoinState | null> {
    try {
      const account = await (this.program.account as any).stablecoin.fetch(
        this.stablecoinPDA
      );
      return {
        authority: account.authority,
        mint: account.mint,
        name: account.name,
        symbol: account.symbol,
        uri: account.uri,
        decimals: account.decimals,
        paused: account.paused,
        enablePermanentDelegate: account.enablePermanentDelegate,
        enableTransferHook: account.enableTransferHook,
        defaultAccountFrozen: account.defaultAccountFrozen,
        enableAllowlist: account.enableAllowlist,
        totalMinted: account.totalMinted,
        totalBurned: account.totalBurned,
        supplyCap: account.supplyCap,
        pendingAuthority: account.pendingAuthority,
        bump: account.bump,
      } as StablecoinState;
    } catch (e: any) {
      // Account does not exist
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
   * Mint tokens to a recipient token account.
   */
  async mintTokens(params: MintParams): Promise<string> {
    const amount =
      params.amount instanceof anchor.BN
        ? params.amount
        : new anchor.BN(params.amount.toString());

    const [rolePDA] = findRolePDA(
      this.stablecoinPDA,
      "minter",
      params.minter.publicKey,
      this.programId
    );
    const [minterInfoPDA] = findMinterInfoPDA(
      this.stablecoinPDA,
      params.minter.publicKey,
      this.programId
    );

    const txSig = await this.program.methods
      .mintTokens(amount)
      .accounts({
        minter: params.minter.publicKey,
        stablecoin: this.stablecoinPDA,
        mint: this.mint,
        roleAssignment: rolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: params.recipientTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([params.minter])
      .rpc();

    return txSig;
  }

  /**
   * Burn tokens from a token account.
   */
  async burn(params: BurnParams): Promise<string> {
    const amount =
      params.amount instanceof anchor.BN
        ? params.amount
        : new anchor.BN(params.amount.toString());

    const [rolePDA] = findRolePDA(
      this.stablecoinPDA,
      "burner",
      params.burner.publicKey,
      this.programId
    );

    const txSig = await this.program.methods
      .burnTokens(amount)
      .accounts({
        burner: params.burner.publicKey,
        stablecoin: this.stablecoinPDA,
        mint: this.mint,
        roleAssignment: rolePDA,
        burnFrom: params.tokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([params.burner])
      .rpc();

    return txSig;
  }

  /**
   * Freeze a token account. Caller must have pauser role or be master authority.
   */
  async freezeAccount(params: FreezeParams): Promise<string> {
    const [rolePDA] = findRolePDA(
      this.stablecoinPDA,
      "pauser",
      params.authority.publicKey,
      this.programId
    );

    const txSig = await this.program.methods
      .freezeAccount()
      .accounts({
        authority: params.authority.publicKey,
        stablecoin: this.stablecoinPDA,
        mint: this.mint,
        roleAssignment: rolePDA,
        targetAccount: params.tokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([params.authority])
      .rpc();

    return txSig;
  }

  /**
   * Thaw a frozen token account. Caller must have pauser role or be master authority.
   */
  async thawAccount(params: ThawParams): Promise<string> {
    const [rolePDA] = findRolePDA(
      this.stablecoinPDA,
      "pauser",
      params.authority.publicKey,
      this.programId
    );

    const txSig = await this.program.methods
      .thawAccount()
      .accounts({
        authority: params.authority.publicKey,
        stablecoin: this.stablecoinPDA,
        mint: this.mint,
        roleAssignment: rolePDA,
        targetAccount: params.tokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([params.authority])
      .rpc();

    return txSig;
  }

  /**
   * Transfer tokens with transfer hook support.
   * Wallets cannot resolve transfer hook extra accounts natively,
   * so this method must be used instead of standard wallet transfers.
   */
  async transfer(params: TransferParams): Promise<string> {
    const mintInfo = await this.connection.getTokenSupply(this.mint);
    const decimals = mintInfo.value.decimals;

    const amount = typeof params.amount === "number"
      ? BigInt(Math.round(params.amount * Math.pow(10, decimals)))
      : BigInt(params.amount.toString());

    const senderATA = getAssociatedTokenAddressSync(
      this.mint, params.sender.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    const recipientATA = getAssociatedTokenAddressSync(
      this.mint, params.recipient, false, TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction();

    // Create recipient ATA first (must exist before resolving hook accounts)
    const recipientATAInfo = await this.connection.getAccountInfo(recipientATA);
    if (!recipientATAInfo) {
      const createAtaTx = new Transaction();
      createAtaTx.add(
        createAssociatedTokenAccountInstruction(
          params.sender.publicKey, recipientATA, params.recipient, this.mint,
          TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
        )
      );
      createAtaTx.feePayer = params.sender.publicKey;
      createAtaTx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      createAtaTx.sign(params.sender);
      const ataSig = await this.connection.sendRawTransaction(createAtaTx.serialize());
      await this.connection.confirmTransaction(ataSig, "confirmed");
    }

    // Build transfer instruction with hook accounts
    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      this.connection, senderATA, this.mint, recipientATA, params.sender.publicKey,
      amount, decimals, [], "confirmed", TOKEN_2022_PROGRAM_ID,
    );
    tx.add(transferIx);

    tx.feePayer = params.sender.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.sign(params.sender);

    const sig = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });
    await this.connection.confirmTransaction(sig, "confirmed");

    return sig;
  }

  /**
   * Pause all token operations. Caller must have pauser role.
   */
  async pause(authority: Keypair): Promise<string> {
    const [rolePDA] = findRolePDA(
      this.stablecoinPDA,
      "pauser",
      authority.publicKey,
      this.programId
    );

    const txSig = await this.program.methods
      .pause()
      .accounts({
        authority: authority.publicKey,
        stablecoin: this.stablecoinPDA,
        roleAssignment: rolePDA,
      })
      .signers([authority])
      .rpc();

    return txSig;
  }

  /**
   * Unpause token operations. Caller must have pauser role.
   */
  async unpause(authority: Keypair): Promise<string> {
    const [rolePDA] = findRolePDA(
      this.stablecoinPDA,
      "pauser",
      authority.publicKey,
      this.programId
    );

    const txSig = await this.program.methods
      .unpause()
      .accounts({
        authority: authority.publicKey,
        stablecoin: this.stablecoinPDA,
        roleAssignment: rolePDA,
      })
      .signers([authority])
      .rpc();

    return txSig;
  }

  /**
   * Assign a role to an address. Caller must be master authority.
   */
  async assignRole(params: {
    role: RoleType;
    assignee: PublicKey;
    authority: Keypair;
  }): Promise<string> {
    const roleEnum = roleToAnchorEnum(params.role);

    const [rolePDA] = findRolePDA(
      this.stablecoinPDA,
      params.role,
      params.assignee,
      this.programId
    );

    // minterInfo is only needed when assigning the minter role
    let minterInfo: PublicKey | null = null;
    if (params.role === "minter") {
      const [minterInfoPDA] = findMinterInfoPDA(
        this.stablecoinPDA,
        params.assignee,
        this.programId
      );
      minterInfo = minterInfoPDA;
    }

    const txSig = await this.program.methods
      .assignRole(roleEnum, params.assignee)
      .accounts({
        authority: params.authority.publicKey,
        stablecoin: this.stablecoinPDA,
        roleAssignment: rolePDA,
        minterInfo: minterInfo,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([params.authority])
      .rpc();

    return txSig;
  }

  /**
   * Revoke a role from an address. Caller must be master authority.
   */
  async revokeRole(params: {
    role: RoleType;
    assignee: PublicKey;
    authority: Keypair;
  }): Promise<string> {
    const roleEnum = roleToAnchorEnum(params.role);

    const [rolePDA] = findRolePDA(
      this.stablecoinPDA,
      params.role,
      params.assignee,
      this.programId
    );

    const txSig = await this.program.methods
      .revokeRole(roleEnum, params.assignee)
      .accounts({
        authority: params.authority.publicKey,
        stablecoin: this.stablecoinPDA,
        roleAssignment: rolePDA,
      })
      .signers([params.authority])
      .rpc();

    return txSig;
  }

  /**
   * Nominate a new authority (two-step transfer, step 1).
   * The nominated authority must call acceptAuthority() to complete.
   */
  async nominateAuthority(
    currentAuthority: Keypair,
    newAuthority: PublicKey
  ): Promise<string> {
    const txSig = await this.program.methods
      .nominateAuthority(newAuthority)
      .accounts({
        authority: currentAuthority.publicKey,
        stablecoin: this.stablecoinPDA,
      })
      .signers([currentAuthority])
      .rpc();

    return txSig;
  }

  /**
   * Accept a pending authority nomination (two-step transfer, step 2).
   */
  async acceptAuthority(newAuthority: Keypair): Promise<string> {
    const txSig = await this.program.methods
      .acceptAuthority()
      .accounts({
        newAuthority: newAuthority.publicKey,
        stablecoin: this.stablecoinPDA,
      })
      .signers([newAuthority])
      .rpc();

    return txSig;
  }

  /**
   * Direct transfer of master authority (single-step, use with caution).
   * Prefer nominateAuthority + acceptAuthority for safety.
   */
  async transferAuthority(
    currentAuthority: Keypair,
    newAuthority: PublicKey
  ): Promise<string> {
    const txSig = await this.program.methods
      .transferAuthority(newAuthority)
      .accounts({
        authority: currentAuthority.publicKey,
        stablecoin: this.stablecoinPDA,
      })
      .signers([currentAuthority])
      .rpc();

    return txSig;
  }

  /**
   * Set or update the supply cap. Pass 0 to remove the cap.
   */
  async setSupplyCap(
    authority: Keypair,
    supplyCap: number | anchor.BN
  ): Promise<string> {
    const cap = supplyCap instanceof anchor.BN
      ? supplyCap
      : new anchor.BN(supplyCap.toString());

    const txSig = await this.program.methods
      .setSupplyCap(cap)
      .accounts({
        authority: authority.publicKey,
        stablecoin: this.stablecoinPDA,
      })
      .signers([authority])
      .rpc();

    return txSig;
  }

  /**
   * Update an existing minter's quota. Caller must be master authority.
   */
  async updateMinterQuota(
    authority: Keypair,
    minter: PublicKey,
    newQuota: number | anchor.BN
  ): Promise<string> {
    const quota = newQuota instanceof anchor.BN
      ? newQuota
      : new anchor.BN(newQuota.toString());

    const [minterInfoPDA] = findMinterInfoPDA(
      this.stablecoinPDA,
      minter,
      this.programId
    );

    const txSig = await this.program.methods
      .updateMinterQuota(quota)
      .accounts({
        authority: authority.publicKey,
        stablecoin: this.stablecoinPDA,
        minterInfo: minterInfoPDA,
      })
      .signers([authority])
      .rpc();

    return txSig;
  }

  /**
   * Configure oracle price enforcement for mint/burn operations.
   * When enabled, minting/burning will be rejected if the stablecoin depegs
   * beyond the configured threshold.
   */
  async configureOracle(params: {
    authority: Keypair;
    priceFeed: PublicKey;
    maxDeviationBps: number;
    maxStalenessSecs: number;
    enabled: boolean;
  }): Promise<string> {
    const [oracleConfigPDA] = findOracleConfigPDA(
      this.stablecoinPDA,
      this.programId
    );

    const txSig = await this.program.methods
      .configureOracle(
        params.priceFeed,
        params.maxDeviationBps,
        new anchor.BN(params.maxStalenessSecs),
        params.enabled
      )
      .accounts({
        authority: params.authority.publicKey,
        stablecoin: this.stablecoinPDA,
        oracleConfig: oracleConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([params.authority])
      .rpc();

    return txSig;
  }

  /**
   * Update the stablecoin's metadata URI. Only master authority.
   * Name and symbol are immutable after initialization.
   */
  async updateMetadata(authority: Keypair, uri: string): Promise<string> {
    const txSig = await this.program.methods
      .updateMetadata(uri)
      .accounts({
        authority: authority.publicKey,
        mint: this.mint,
        stablecoin: this.stablecoinPDA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    return txSig;
  }

  /**
   * Get total supply (minted - burned).
   */
  async getTotalSupply(): Promise<anchor.BN> {
    const state = await this.getState();
    if (!state) return new anchor.BN(0);
    return state.totalMinted.sub(state.totalBurned);
  }
}
