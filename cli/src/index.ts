#!/usr/bin/env node

import { Command } from "commander";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require("./idl/sss_token.json");

const PROGRAM_ID = new PublicKey(
  "CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ"
);
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "63pY5GPBHKJ3gu99xTNH9yxUKgp8kUowiiHYzZtaE31E"
);

const cli = new Command();

cli
  .name("sss-token")
  .description("CLI for the Solana Stablecoin Standard (SSS)")
  .version("0.1.0");

// ============ Helpers ============

function loadKeypair(filepath: string): Keypair {
  const resolved = filepath.startsWith("~")
    ? path.join(process.env.HOME || "", filepath.slice(1))
    : filepath;
  const secretKey = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

function getConnection(cluster: string): Connection {
  if (cluster === "localnet") {
    return new Connection("http://localhost:8899", "confirmed");
  }
  return new Connection(clusterApiUrl(cluster as any), "confirmed");
}

function getProgram(
  connection: Connection,
  authority: Keypair
): anchor.Program {
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new anchor.Program(idl as any, provider);
}

function getStablecoinPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin"), mint.toBuffer()],
    PROGRAM_ID
  );
}

function getRolePDA(
  stablecoinPDA: PublicKey,
  roleName: string,
  assignee: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("role"),
      stablecoinPDA.toBuffer(),
      Buffer.from(roleName),
      assignee.toBuffer(),
    ],
    PROGRAM_ID
  );
}

function getMinterInfoPDA(
  stablecoinPDA: PublicKey,
  minter: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("minter_info"),
      stablecoinPDA.toBuffer(),
      minter.toBuffer(),
    ],
    PROGRAM_ID
  );
}

function getBlacklistPDA(
  stablecoinPDA: PublicKey,
  address: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("blacklist"),
      stablecoinPDA.toBuffer(),
      address.toBuffer(),
    ],
    PROGRAM_ID
  );
}

function requireMint(opts: any): PublicKey {
  if (!opts.mint) {
    console.error("Error: --mint <address> is required for this command.");
    process.exit(1);
  }
  return new PublicKey(opts.mint);
}

// ============ Init Commands ============

const initCmd = cli.command("init").description("Initialize a new stablecoin");

initCmd
  .command("sss-1")
  .description("Initialize an SSS-1 (minimal) stablecoin")
  .requiredOption("--name <name>", "Token name")
  .requiredOption("--symbol <symbol>", "Token symbol")
  .option("--uri <uri>", "Metadata URI", "")
  .option("--decimals <decimals>", "Token decimals", "6")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mintKeypair = Keypair.generate();
      const [stablecoinPDA] = getStablecoinPDA(mintKeypair.publicKey);

      console.log(`\nInitializing SSS-1 stablecoin: ${opts.name} (${opts.symbol})`);
      console.log(`  Cluster: ${opts.cluster}`);
      console.log(`  Authority: ${authority.publicKey.toBase58()}`);
      console.log(`  Mint: ${mintKeypair.publicKey.toBase58()}`);
      console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

      const tx = await program.methods
        .initialize({
          name: opts.name,
          symbol: opts.symbol,
          uri: opts.uri,
          decimals: parseInt(opts.decimals),
          enablePermanentDelegate: false,
          enableTransferHook: false,
          defaultAccountFrozen: false,
        })
        .accounts({
          authority: authority.publicKey,
          mint: mintKeypair.publicKey,
          stablecoin: stablecoinPDA,
          transferHookProgram: null,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([mintKeypair])
        .rpc();

      console.log(`\n  Stablecoin initialized successfully!`);
      console.log(`  Transaction: ${tx}`);
      console.log(`\n  Save these values for subsequent commands:`);
      console.log(`    --mint ${mintKeypair.publicKey.toBase58()}`);
    } catch (err: any) {
      console.error(`\nError initializing SSS-1 stablecoin: ${err.message}`);
      process.exit(1);
    }
  });

initCmd
  .command("sss-2")
  .description("Initialize an SSS-2 (compliant) stablecoin")
  .requiredOption("--name <name>", "Token name")
  .requiredOption("--symbol <symbol>", "Token symbol")
  .option("--uri <uri>", "Metadata URI", "")
  .option("--decimals <decimals>", "Token decimals", "6")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mintKeypair = Keypair.generate();
      const [stablecoinPDA] = getStablecoinPDA(mintKeypair.publicKey);

      console.log(`\nInitializing SSS-2 stablecoin: ${opts.name} (${opts.symbol})`);
      console.log(`  Cluster: ${opts.cluster}`);
      console.log(`  Authority: ${authority.publicKey.toBase58()}`);
      console.log(`  Mint: ${mintKeypair.publicKey.toBase58()}`);
      console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

      const tx = await program.methods
        .initialize({
          name: opts.name,
          symbol: opts.symbol,
          uri: opts.uri,
          decimals: parseInt(opts.decimals),
          enablePermanentDelegate: true,
          enableTransferHook: true,
          defaultAccountFrozen: false,
        })
        .accounts({
          authority: authority.publicKey,
          mint: mintKeypair.publicKey,
          stablecoin: stablecoinPDA,
          transferHookProgram: TRANSFER_HOOK_PROGRAM_ID,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([mintKeypair])
        .rpc();

      console.log(`\n  Stablecoin initialized successfully!`);
      console.log(`  Transaction: ${tx}`);
      console.log(`\n  Save these values for subsequent commands:`);
      console.log(`    --mint ${mintKeypair.publicKey.toBase58()}`);
    } catch (err: any) {
      console.error(`\nError initializing SSS-2 stablecoin: ${err.message}`);
      process.exit(1);
    }
  });

initCmd
  .command("custom")
  .description("Initialize with a custom TOML/JSON config")
  .requiredOption("--config <path>", "Path to config file (TOML or JSON)")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const config = JSON.parse(fs.readFileSync(opts.config, "utf-8"));
      const mintKeypair = Keypair.generate();
      const [stablecoinPDA] = getStablecoinPDA(mintKeypair.publicKey);

      console.log(`\nInitializing custom stablecoin from config: ${opts.config}`);
      console.log(`  Authority: ${authority.publicKey.toBase58()}`);
      console.log(`  Mint: ${mintKeypair.publicKey.toBase58()}`);
      console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

      const enableTransferHook = config.enableTransferHook ?? config.enable_transfer_hook ?? false;

      const tx = await program.methods
        .initialize({
          name: config.name,
          symbol: config.symbol,
          uri: config.uri ?? "",
          decimals: config.decimals ?? 6,
          enablePermanentDelegate: config.enablePermanentDelegate ?? config.enable_permanent_delegate ?? false,
          enableTransferHook,
          defaultAccountFrozen: config.defaultAccountFrozen ?? config.default_account_frozen ?? false,
        })
        .accounts({
          authority: authority.publicKey,
          mint: mintKeypair.publicKey,
          stablecoin: stablecoinPDA,
          transferHookProgram: enableTransferHook ? TRANSFER_HOOK_PROGRAM_ID : null,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([mintKeypair])
        .rpc();

      console.log(`\n  Stablecoin initialized successfully!`);
      console.log(`  Transaction: ${tx}`);
      console.log(`\n  Save these values for subsequent commands:`);
      console.log(`    --mint ${mintKeypair.publicKey.toBase58()}`);
    } catch (err: any) {
      console.error(`\nError initializing custom stablecoin: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Mint ============

cli
  .command("mint")
  .description("Mint tokens to a recipient")
  .requiredOption("--to <address>", "Recipient address")
  .requiredOption("--amount <amount>", "Amount to mint (in base units)")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Minter keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const minter = loadKeypair(opts.keypair);
      const program = getProgram(connection, minter);
      const mint = requireMint(opts);
      const recipient = new PublicKey(opts.to);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(stablecoinPDA, "minter", minter.publicKey);
      const [minterInfo] = getMinterInfoPDA(stablecoinPDA, minter.publicKey);

      const recipientATA = getAssociatedTokenAddressSync(
        mint,
        recipient,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      console.log(`\nMinting ${opts.amount} tokens to ${recipient.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);
      console.log(`  Recipient ATA: ${recipientATA.toBase58()}`);

      const tx = await program.methods
        .mintTokens(new BN(opts.amount))
        .accounts({
          minter: minter.publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment,
          minterInfo,
          recipientTokenAccount: recipientATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      console.log(`\n  Tokens minted successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError minting tokens: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Burn ============

cli
  .command("burn")
  .description("Burn tokens")
  .requiredOption("--amount <amount>", "Amount to burn (in base units)")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--from <address>", "Token account to burn from (defaults to burner's ATA)")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Burner keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const burner = loadKeypair(opts.keypair);
      const program = getProgram(connection, burner);
      const mint = requireMint(opts);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(stablecoinPDA, "burner", burner.publicKey);

      const burnFrom = opts.from
        ? new PublicKey(opts.from)
        : getAssociatedTokenAddressSync(
            mint,
            burner.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          );

      console.log(`\nBurning ${opts.amount} tokens`);
      console.log(`  Mint: ${mint.toBase58()}`);
      console.log(`  Burn from: ${burnFrom.toBase58()}`);

      const tx = await program.methods
        .burnTokens(new BN(opts.amount))
        .accounts({
          burner: burner.publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment,
          burnFrom,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      console.log(`\n  Tokens burned successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError burning tokens: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Freeze ============

cli
  .command("freeze")
  .description("Freeze a token account")
  .requiredOption("--account <address>", "Token account to freeze")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(stablecoinPDA, "pauser", authority.publicKey);
      const targetAccount = new PublicKey(opts.account);

      console.log(`\nFreezing account ${targetAccount.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .freezeAccount()
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment,
          targetAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      console.log(`\n  Account frozen successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError freezing account: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Thaw ============

cli
  .command("thaw")
  .description("Thaw a frozen token account")
  .requiredOption("--account <address>", "Token account to thaw")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(stablecoinPDA, "pauser", authority.publicKey);
      const targetAccount = new PublicKey(opts.account);

      console.log(`\nThawing account ${targetAccount.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .thawAccount()
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment,
          targetAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      console.log(`\n  Account thawed successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError thawing account: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Pause ============

cli
  .command("pause")
  .description("Pause all token operations")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Pauser keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(stablecoinPDA, "pauser", authority.publicKey);

      console.log(`\nPausing stablecoin`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .pause()
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment,
        })
        .rpc();

      console.log(`\n  Stablecoin paused successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError pausing stablecoin: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Unpause ============

cli
  .command("unpause")
  .description("Unpause token operations")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Pauser keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(stablecoinPDA, "pauser", authority.publicKey);

      console.log(`\nUnpausing stablecoin`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .unpause()
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment,
        })
        .rpc();

      console.log(`\n  Stablecoin unpaused successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError unpausing stablecoin: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Status ============

cli
  .command("status")
  .description("Get stablecoin status")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const [stablecoinPDA] = getStablecoinPDA(mint);

      console.log(`\nFetching stablecoin status...`);
      console.log(`  Mint: ${mint.toBase58()}`);
      console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

      const stablecoin = await (program.account as any).stablecoin.fetch(stablecoinPDA);

      console.log(`\n  === Stablecoin Status ===`);
      console.log(`  Name: ${stablecoin.name}`);
      console.log(`  Symbol: ${stablecoin.symbol}`);
      console.log(`  URI: ${stablecoin.uri}`);
      console.log(`  Decimals: ${stablecoin.decimals}`);
      console.log(`  Authority: ${stablecoin.authority.toBase58()}`);
      console.log(`  Mint: ${stablecoin.mint.toBase58()}`);
      console.log(`  Paused: ${stablecoin.paused}`);
      console.log(`  Permanent Delegate: ${stablecoin.enablePermanentDelegate}`);
      console.log(`  Transfer Hook: ${stablecoin.enableTransferHook}`);
      console.log(`  Default Account Frozen: ${stablecoin.defaultAccountFrozen}`);
      console.log(`  Total Minted: ${stablecoin.totalMinted.toString()}`);
      console.log(`  Total Burned: ${stablecoin.totalBurned.toString()}`);
    } catch (err: any) {
      console.error(`\nError fetching status: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Supply ============

cli
  .command("supply")
  .description("Get total supply")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const mint = requireMint(opts);

      console.log(`\nFetching total supply for mint: ${mint.toBase58()}`);

      const supply = await connection.getTokenSupply(mint);

      console.log(`\n  Total Supply: ${supply.value.uiAmountString}`);
      console.log(`  Raw Amount: ${supply.value.amount}`);
      console.log(`  Decimals: ${supply.value.decimals}`);
    } catch (err: any) {
      console.error(`\nError fetching supply: ${err.message}`);
      process.exit(1);
    }
  });

// ============ SSS-2 Compliance Commands ============

const blacklistCmd = cli
  .command("blacklist")
  .description("Blacklist management (SSS-2)");

blacklistCmd
  .command("add")
  .description("Add address to blacklist")
  .requiredOption("--address <address>", "Address to blacklist")
  .option("--reason <reason>", "Reason for blacklisting", "Compliance action")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Blacklister keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const blacklister = loadKeypair(opts.keypair);
      const program = getProgram(connection, blacklister);
      const mint = requireMint(opts);
      const targetAddress = new PublicKey(opts.address);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(
        stablecoinPDA,
        "blacklister",
        blacklister.publicKey
      );
      const [blacklistEntry] = getBlacklistPDA(stablecoinPDA, targetAddress);

      console.log(`\nAdding ${targetAddress.toBase58()} to blacklist`);
      console.log(`  Reason: ${opts.reason}`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .addToBlacklist(targetAddress, opts.reason)
        .accounts({
          blacklister: blacklister.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`\n  Address blacklisted successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError adding to blacklist: ${err.message}`);
      process.exit(1);
    }
  });

blacklistCmd
  .command("remove")
  .description("Remove address from blacklist")
  .requiredOption("--address <address>", "Address to remove")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Blacklister keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const blacklister = loadKeypair(opts.keypair);
      const program = getProgram(connection, blacklister);
      const mint = requireMint(opts);
      const targetAddress = new PublicKey(opts.address);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(
        stablecoinPDA,
        "blacklister",
        blacklister.publicKey
      );
      const [blacklistEntry] = getBlacklistPDA(stablecoinPDA, targetAddress);

      console.log(`\nRemoving ${targetAddress.toBase58()} from blacklist`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .removeFromBlacklist(targetAddress)
        .accounts({
          blacklister: blacklister.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment,
          blacklistEntry,
        })
        .rpc();

      console.log(`\n  Address removed from blacklist successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError removing from blacklist: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Seize ============

cli
  .command("seize")
  .description("Seize tokens from blacklisted account (SSS-2)")
  .requiredOption("--from <address>", "Source token account to seize from")
  .requiredOption("--to <address>", "Treasury token account to receive tokens")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Seizer keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const seizer = loadKeypair(opts.keypair);
      const program = getProgram(connection, seizer);
      const mint = requireMint(opts);
      const sourceAccount = new PublicKey(opts.from);
      const treasuryAccount = new PublicKey(opts.to);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(
        stablecoinPDA,
        "seizer",
        seizer.publicKey
      );

      // The blacklist entry PDA uses the owner of the source token account.
      // We need to fetch the source account to get its owner.
      const sourceAccountInfo = await connection.getParsedAccountInfo(sourceAccount);
      if (!sourceAccountInfo.value) {
        console.error("Error: Source token account not found.");
        process.exit(1);
      }
      const parsedData = (sourceAccountInfo.value.data as any)?.parsed;
      const sourceOwner = new PublicKey(parsedData?.info?.owner);
      const [blacklistEntry] = getBlacklistPDA(stablecoinPDA, sourceOwner);

      console.log(`\nSeizing tokens from ${sourceAccount.toBase58()}`);
      console.log(`  To treasury: ${treasuryAccount.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .seize()
        .accounts({
          seizer: seizer.publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment,
          blacklistEntry,
          sourceAccount,
          treasuryAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      console.log(`\n  Tokens seized successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError seizing tokens: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Minter Management ============

const mintersCmd = cli.command("minters").description("Minter management");

mintersCmd
  .command("add")
  .description("Add a minter")
  .requiredOption("--address <address>", "Minter address")
  .option("--quota <amount>", "Minting quota (0 = unlimited)", "0")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const assignee = new PublicKey(opts.address);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(stablecoinPDA, "minter", assignee);
      const [minterInfo] = getMinterInfoPDA(stablecoinPDA, assignee);

      console.log(`\nAdding minter ${assignee.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .assignRole({ minter: {} }, assignee)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment,
          minterInfo,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`\n  Minter added successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError adding minter: ${err.message}`);
      process.exit(1);
    }
  });

mintersCmd
  .command("remove")
  .description("Remove a minter")
  .requiredOption("--address <address>", "Minter address to remove")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const assignee = new PublicKey(opts.address);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(stablecoinPDA, "minter", assignee);

      console.log(`\nRemoving minter ${assignee.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .revokeRole({ minter: {} }, assignee)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment,
        })
        .rpc();

      console.log(`\n  Minter removed successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError removing minter: ${err.message}`);
      process.exit(1);
    }
  });

mintersCmd
  .command("list")
  .description("List all minters")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const [stablecoinPDA] = getStablecoinPDA(mint);

      console.log(`\nListing minters for mint: ${mint.toBase58()}`);

      // Fetch all RoleAssignment accounts for this stablecoin
      const accounts = await (program.account as any).roleAssignment.all([
        {
          memcmp: {
            offset: 8, // after discriminator
            bytes: stablecoinPDA.toBase58(),
          },
        },
      ]);

      const minters = accounts.filter(
        (acc: any) => acc.account.role && "minter" in acc.account.role && acc.account.active
      );

      if (minters.length === 0) {
        console.log("\n  No minters found.");
      } else {
        console.log(`\n  Found ${minters.length} minter(s):`);
        for (const m of minters) {
          const assignee = (m.account as any).assignee.toBase58();
          console.log(`    - ${assignee} (PDA: ${m.publicKey.toBase58()})`);

          // Try to fetch minter info for quota details
          try {
            const [minterInfoPDA] = getMinterInfoPDA(
              stablecoinPDA,
              (m.account as any).assignee
            );
            const minterInfo = await (program.account as any).minterInfo.fetch(
              minterInfoPDA
            );
            const quota = (minterInfo as any).quota.toString();
            const minted = (minterInfo as any).minted.toString();
            console.log(`      Quota: ${quota === "0" ? "unlimited" : quota}, Minted: ${minted}`);
          } catch {
            // minter info might not exist yet
          }
        }
      }
    } catch (err: any) {
      console.error(`\nError listing minters: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Holders ============

cli
  .command("holders")
  .description("List token holders")
  .option("--min-balance <amount>", "Minimum balance filter", "0")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const mint = requireMint(opts);
      const minBalance = parseInt(opts.minBalance) || 0;

      console.log(`\nListing holders for mint: ${mint.toBase58()}`);

      const largestAccounts = await connection.getTokenLargestAccounts(mint);

      const holders = largestAccounts.value.filter(
        (acc) => parseInt(acc.amount) >= minBalance
      );

      if (holders.length === 0) {
        console.log("\n  No holders found.");
      } else {
        console.log(`\n  Found ${holders.length} holder(s):`);
        for (const holder of holders) {
          console.log(
            `    ${holder.address.toBase58()}: ${holder.uiAmountString} (raw: ${holder.amount})`
          );
        }
      }
    } catch (err: any) {
      console.error(`\nError listing holders: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Audit Log ============

cli
  .command("audit-log")
  .description("View audit log")
  .option("--action <type>", "Filter by action type")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--limit <count>", "Number of recent transactions to fetch", "20")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const mint = requireMint(opts);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const limit = parseInt(opts.limit) || 20;

      console.log(`\nFetching audit log for mint: ${mint.toBase58()}`);
      console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

      const signatures = await connection.getSignaturesForAddress(
        stablecoinPDA,
        { limit }
      );

      if (signatures.length === 0) {
        console.log("\n  No transactions found.");
      } else {
        console.log(`\n  Found ${signatures.length} transaction(s):`);
        for (const sig of signatures) {
          const time = sig.blockTime
            ? new Date(sig.blockTime * 1000).toISOString()
            : "unknown";
          const status = sig.err ? "FAILED" : "SUCCESS";
          console.log(`    [${time}] ${status} ${sig.signature}`);
          if (sig.memo) {
            console.log(`      Memo: ${sig.memo}`);
          }
        }
      }
    } catch (err: any) {
      console.error(`\nError fetching audit log: ${err.message}`);
      process.exit(1);
    }
  });

cli.parse();
