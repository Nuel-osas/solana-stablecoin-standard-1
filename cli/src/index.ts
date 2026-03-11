#!/usr/bin/env node
process.removeAllListeners("warning");

import { Command } from "commander";

// ANSI colors
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  bg: {
    green: "\x1b[42m",
    red: "\x1b[41m",
  },
};

function detectPreset(s: any): string {
  if (s.enableAllowlist) return "SSS-3 (Private)";
  if (s.enablePermanentDelegate || s.enableTransferHook) return "SSS-2 (Compliant)";
  return "SSS-1 (Minimal)";
}

function formatAmount(raw: string | number, decimals: number): string {
  const n = Number(raw) / Math.pow(10, decimals);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals });
}
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

// Load program IDs from root .env, env vars, or fall back to defaults
function loadRootEnv(): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const envPath = path.resolve(__dirname, "../../.env");
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m) vars[m[1]] = m[2].trim();
    }
  } catch {}
  return vars;
}
const _env = loadRootEnv();

const PROGRAM_ID = new PublicKey(
  process.env.SSS_TOKEN_PROGRAM_ID || _env.SSS_TOKEN_PROGRAM_ID || "BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq"
);
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  process.env.SSS_TRANSFER_HOOK_PROGRAM_ID || _env.SSS_TRANSFER_HOOK_PROGRAM_ID || "B9HzG9fuxbuJBG2wTSP6UmxBSQLdaUAk62Kcdf41WxAt"
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

function getAllowlistPDA(
  stablecoinPDA: PublicKey,
  address: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowlist"),
      stablecoinPDA.toBuffer(),
      address.toBuffer(),
    ],
    PROGRAM_ID
  );
}

function getOracleConfigPDA(
  stablecoinPDA: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("oracle_config"),
      stablecoinPDA.toBuffer(),
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

/** Convert a human-readable amount (e.g. "1.5") to base units given decimals. */
async function parseAmount(amountStr: string, mint: PublicKey, connection: Connection): Promise<BN> {
  const mintInfo = await connection.getParsedAccountInfo(mint);
  const decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals ?? 6;
  const parts = amountStr.split(".");
  const whole = parts[0];
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return new BN(whole + frac);
}

/** Map role string to Anchor enum object. */
function roleToEnum(role: string): any {
  const map: Record<string, any> = {
    minter: { minter: {} },
    burner: { burner: {} },
    blacklister: { blacklister: {} },
    pauser: { pauser: {} },
    seizer: { seizer: {} },
  };
  const r = map[role.toLowerCase()];
  if (!r) {
    console.error(`Error: Unknown role "${role}". Valid roles: minter, burner, blacklister, pauser, seizer`);
    process.exit(1);
  }
  return r;
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

      console.log(`\n${c.cyan}${c.bold}Initializing SSS-1 stablecoin${c.reset}: ${opts.name} (${opts.symbol})`);
      console.log(`  ${c.dim}Cluster:${c.reset}   ${opts.cluster}`);
      console.log(`  ${c.dim}Authority:${c.reset} ${authority.publicKey.toBase58()}`);
      console.log(`  ${c.dim}Mint:${c.reset}      ${mintKeypair.publicKey.toBase58()}`);
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
          enableAllowlist: false,
          supplyCap: null,
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

      console.log(`\n  ${c.green}${c.bold}Stablecoin initialized successfully!${c.reset}`);
      console.log(`  ${c.dim}Transaction:${c.reset} ${tx}`);
      console.log(`\n  ${c.yellow}Save this for subsequent commands:${c.reset}`);
      console.log(`    --mint ${c.bold}${mintKeypair.publicKey.toBase58()}${c.reset}`);
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

      console.log(`\n${c.cyan}${c.bold}Initializing SSS-2 stablecoin${c.reset}: ${opts.name} (${opts.symbol})`);
      console.log(`  ${c.dim}Cluster:${c.reset}   ${opts.cluster}`);
      console.log(`  ${c.dim}Authority:${c.reset} ${authority.publicKey.toBase58()}`);
      console.log(`  ${c.dim}Mint:${c.reset}      ${mintKeypair.publicKey.toBase58()}`);
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
          enableAllowlist: false,
          supplyCap: null,
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

      console.log(`\n  ${c.green}${c.bold}Stablecoin initialized successfully!${c.reset}`);
      console.log(`  ${c.dim}Transaction:${c.reset} ${tx}`);
      console.log(`\n  ${c.yellow}Save this for subsequent commands:${c.reset}`);
      console.log(`    --mint ${c.bold}${mintKeypair.publicKey.toBase58()}${c.reset}`);
    } catch (err: any) {
      console.error(`\nError initializing SSS-2 stablecoin: ${err.message}`);
      process.exit(1);
    }
  });

initCmd
  .command("sss-3")
  .description("Initialize an SSS-3 (private/allowlist) stablecoin")
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

      console.log(`\n${c.cyan}${c.bold}Initializing SSS-3 stablecoin${c.reset}: ${opts.name} (${opts.symbol})`);
      console.log(`  ${c.dim}Cluster:${c.reset}   ${opts.cluster}`);
      console.log(`  ${c.dim}Authority:${c.reset} ${authority.publicKey.toBase58()}`);
      console.log(`  ${c.dim}Mint:${c.reset}      ${mintKeypair.publicKey.toBase58()}`);
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
          enableAllowlist: true,
          supplyCap: null,
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
      console.log(`  ${c.magenta}ConfidentialTransferMint:${c.reset} Enabled (Experimental)`);
      console.log(`  ${c.dim}Note: Full confidential transfers require ZK ElGamal program (not yet live on devnet/mainnet)${c.reset}`);
      console.log(`\n  Save these values for subsequent commands:`);
      console.log(`    --mint ${mintKeypair.publicKey.toBase58()}`);
    } catch (err: any) {
      console.error(`\nError initializing SSS-3 stablecoin: ${err.message}`);
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
          enableAllowlist: config.enableAllowlist ?? config.enable_allowlist ?? false,
          supplyCap: config.supplyCap ? new BN(config.supplyCap) : null,
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

      console.log(`\n  ${c.green}${c.bold}Stablecoin initialized successfully!${c.reset}`);
      console.log(`  ${c.dim}Transaction:${c.reset} ${tx}`);
      console.log(`\n  ${c.yellow}Save this for subsequent commands:${c.reset}`);
      console.log(`    --mint ${c.bold}${mintKeypair.publicKey.toBase58()}${c.reset}`);
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
  .requiredOption("--amount <amount>", "Amount to mint (e.g. 1000 or 1.5)")
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
      const amount = await parseAmount(opts.amount, mint, connection);
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
      console.log(`  Amount (base units): ${amount.toString()}`);

      const tx = await program.methods
        .mintTokens(amount)
        .accounts({
          minter: minter.publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment,
          minterInfo,
          recipientTokenAccount: recipientATA,
          oracleConfig: null,
          priceFeed: null,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        } as any)
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
  .requiredOption("--amount <amount>", "Amount to burn (e.g. 500 or 1.5)")
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
      const amount = await parseAmount(opts.amount, mint, connection);
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
      console.log(`  Amount (base units): ${amount.toString()}`);

      const tx = await program.methods
        .burnTokens(amount)
        .accounts({
          burner: burner.publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment,
          burnFrom,
          oracleConfig: null,
          priceFeed: null,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        } as any)
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

      console.log(`\n${c.cyan}Fetching stablecoin status...${c.reset}`);
      console.log(`  Mint: ${mint.toBase58()}`);
      console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

      const stablecoin = await (program.account as any).stablecoin.fetch(stablecoinPDA);

      const preset = detectPreset(stablecoin);
      const dec = stablecoin.decimals;
      const totalMinted = formatAmount(stablecoin.totalMinted.toString(), dec);
      const totalBurned = formatAmount(stablecoin.totalBurned.toString(), dec);
      const capRaw = stablecoin.supplyCap?.toString() ?? "0";
      const supplyCap = capRaw === "0" ? "Unlimited" : formatAmount(capRaw, dec);
      const netSupply = formatAmount(
        (Number(stablecoin.totalMinted.toString()) - Number(stablecoin.totalBurned.toString())).toString(),
        dec
      );

      const on = `${c.green}${c.bold}Enabled${c.reset}`;
      const off = `${c.dim}Disabled${c.reset}`;
      const pauseLabel = stablecoin.paused
        ? `${c.bg.red}${c.white}${c.bold} PAUSED ${c.reset}`
        : `${c.bg.green}${c.white}${c.bold} ACTIVE ${c.reset}`;

      console.log(`\n  ${c.bold}${c.cyan}═══ ${stablecoin.name} (${stablecoin.symbol}) ═══${c.reset}`);
      console.log(`  ${c.dim}Preset:${c.reset}    ${c.yellow}${preset}${c.reset}`);
      console.log(`  ${c.dim}Status:${c.reset}    ${pauseLabel}`);
      console.log();
      console.log(`  ${c.dim}Authority:${c.reset} ${stablecoin.authority.toBase58()}`);
      console.log(`  ${c.dim}Mint:${c.reset}      ${stablecoin.mint.toBase58()}`);
      console.log(`  ${c.dim}Decimals:${c.reset}  ${stablecoin.decimals}`);
      if (stablecoin.uri) console.log(`  ${c.dim}URI:${c.reset}       ${stablecoin.uri}`);
      console.log();
      console.log(`  ${c.bold}Supply${c.reset}`);
      console.log(`  ${c.dim}Current:${c.reset}   ${c.white}${netSupply}${c.reset} ${stablecoin.symbol}`);
      console.log(`  ${c.dim}Minted:${c.reset}    ${c.green}${totalMinted}${c.reset}`);
      console.log(`  ${c.dim}Burned:${c.reset}    ${c.red}${totalBurned}${c.reset}`);
      console.log(`  ${c.dim}Cap:${c.reset}       ${supplyCap}`);
      console.log();
      console.log(`  ${c.bold}Extensions${c.reset}`);
      console.log(`  ${c.dim}Permanent Delegate:${c.reset}     ${stablecoin.enablePermanentDelegate ? on : off}`);
      console.log(`  ${c.dim}Transfer Hook:${c.reset}          ${stablecoin.enableTransferHook ? on : off}`);
      console.log(`  ${c.dim}Default Account Frozen:${c.reset} ${stablecoin.defaultAccountFrozen ? on : off}`);
      console.log(`  ${c.dim}Allowlist:${c.reset}              ${stablecoin.enableAllowlist ? on : off}`);
      if (stablecoin.enableAllowlist) {
        console.log(`  ${c.dim}Confidential Transfer:${c.reset}  ${c.magenta}Enabled (Experimental)${c.reset}`);
      }
      const pending = stablecoin.pendingAuthority?.toBase58();
      if (pending && pending !== PublicKey.default.toBase58()) {
        console.log();
        console.log(`  ${c.yellow}Pending Authority:${c.reset} ${pending}`);
      }
      console.log();
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

// ============ Role Management (Generic) ============

const rolesCmd = cli.command("roles").description("Role management (minter, burner, blacklister, pauser, seizer)");

rolesCmd
  .command("assign")
  .description("Assign a role to an address")
  .requiredOption("--role <role>", "Role to assign (minter, burner, blacklister, pauser, seizer)")
  .requiredOption("--address <address>", "Address to assign the role to")
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
      const roleName = opts.role.toLowerCase();
      const roleEnum = roleToEnum(roleName);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(stablecoinPDA, roleName, assignee);

      // minterInfo is only needed for minter role
      const minterInfo = roleName === "minter"
        ? getMinterInfoPDA(stablecoinPDA, assignee)[0]
        : null;

      console.log(`\nAssigning ${c.bold}${roleName}${c.reset} role to ${assignee.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .assignRole(roleEnum, assignee)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment,
          minterInfo,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      console.log(`\n  ${c.green}${c.bold}Role assigned successfully!${c.reset}`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError assigning role: ${err.message}`);
      process.exit(1);
    }
  });

rolesCmd
  .command("revoke")
  .description("Revoke a role from an address")
  .requiredOption("--role <role>", "Role to revoke (minter, burner, blacklister, pauser, seizer)")
  .requiredOption("--address <address>", "Address to revoke the role from")
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
      const roleName = opts.role.toLowerCase();
      const roleEnum = roleToEnum(roleName);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [roleAssignment] = getRolePDA(stablecoinPDA, roleName, assignee);

      console.log(`\nRevoking ${c.bold}${roleName}${c.reset} role from ${assignee.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .revokeRole(roleEnum, assignee)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment,
        })
        .rpc();

      console.log(`\n  ${c.green}${c.bold}Role revoked successfully!${c.reset}`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError revoking role: ${err.message}`);
      process.exit(1);
    }
  });

rolesCmd
  .command("list")
  .description("List all role assignments")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--role <role>", "Filter by role (minter, burner, blacklister, pauser, seizer)")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const [stablecoinPDA] = getStablecoinPDA(mint);

      console.log(`\nListing roles for mint: ${mint.toBase58()}`);

      const accounts = await (program.account as any).roleAssignment.all([
        { memcmp: { offset: 8, bytes: stablecoinPDA.toBase58() } },
      ]);

      const roleNames = ["minter", "burner", "blacklister", "pauser", "seizer"];
      let filtered = accounts.filter((acc: any) => acc.account.active);

      if (opts.role) {
        const filterRole = opts.role.toLowerCase();
        filtered = filtered.filter((acc: any) => {
          const role = acc.account.role;
          return role && filterRole in role;
        });
      }

      if (filtered.length === 0) {
        console.log("\n  No active role assignments found.");
      } else {
        console.log(`\n  Found ${filtered.length} active role(s):\n`);
        for (const a of filtered) {
          const assignee = (a.account as any).assignee.toBase58();
          const role = Object.keys(a.account.role)[0] || "unknown";
          console.log(`    ${c.cyan}${role.padEnd(13)}${c.reset} ${assignee}`);
        }
      }
    } catch (err: any) {
      console.error(`\nError listing roles: ${err.message}`);
      process.exit(1);
    }
  });

rolesCmd
  .command("check")
  .description("Check what roles an address has")
  .requiredOption("--address <address>", "Address to check")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const target = new PublicKey(opts.address);
      const [stablecoinPDA] = getStablecoinPDA(mint);

      console.log(`\nChecking roles for ${target.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}\n`);

      const roleNames = ["minter", "burner", "blacklister", "pauser", "seizer"];
      for (const roleName of roleNames) {
        const [rolePDA] = getRolePDA(stablecoinPDA, roleName, target);
        try {
          const roleAccount = await (program.account as any).roleAssignment.fetch(rolePDA);
          if (roleAccount.active) {
            console.log(`    ${c.green}${c.bold}YES${c.reset}  ${roleName}`);
          } else {
            console.log(`    ${c.dim}NO   ${roleName}${c.reset}`);
          }
        } catch {
          console.log(`    ${c.dim}NO   ${roleName}${c.reset}`);
        }
      }

      // Check if authority
      const stablecoin = await (program.account as any).stablecoin.fetch(stablecoinPDA);
      if (stablecoin.authority.toBase58() === target.toBase58()) {
        console.log(`\n    ${c.yellow}${c.bold}★ Master Authority${c.reset}`);
      }
    } catch (err: any) {
      console.error(`\nError checking roles: ${err.message}`);
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

// ============ Authority Management ============

cli
  .command("nominate-authority")
  .description("Nominate a new master authority (two-step transfer, step 1)")
  .requiredOption("--new-authority <address>", "New authority address")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Current authority keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const newAuthority = new PublicKey(opts.newAuthority);
      const [stablecoinPDA] = getStablecoinPDA(mint);

      console.log(`\nNominating new authority: ${newAuthority.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);
      console.log(`  The new authority must call 'accept-authority' to complete the transfer.`);

      const tx = await program.methods
        .nominateAuthority(newAuthority)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
        })
        .rpc();

      console.log(`\n  Authority nominated successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError nominating authority: ${err.message}`);
      process.exit(1);
    }
  });

cli
  .command("accept-authority")
  .description("Accept a pending authority nomination (two-step transfer, step 2)")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "New authority keypair (must be the nominated address)", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const newAuthority = loadKeypair(opts.keypair);
      const program = getProgram(connection, newAuthority);
      const mint = requireMint(opts);
      const [stablecoinPDA] = getStablecoinPDA(mint);

      console.log(`\nAccepting authority for mint: ${mint.toBase58()}`);
      console.log(`  New authority: ${newAuthority.publicKey.toBase58()}`);

      const tx = await program.methods
        .acceptAuthority()
        .accounts({
          newAuthority: newAuthority.publicKey,
          stablecoin: stablecoinPDA,
        })
        .rpc();

      console.log(`\n  Authority transferred successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError accepting authority: ${err.message}`);
      process.exit(1);
    }
  });

cli
  .command("transfer-authority")
  .description("Direct single-step authority transfer (use with caution)")
  .requiredOption("--new-authority <address>", "New authority address")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Current authority keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const newAuthority = new PublicKey(opts.newAuthority);
      const [stablecoinPDA] = getStablecoinPDA(mint);

      console.log(`\n${c.yellow}${c.bold}WARNING: This is a single-step, irreversible authority transfer.${c.reset}`);
      console.log(`  Current authority: ${authority.publicKey.toBase58()}`);
      console.log(`  New authority:     ${newAuthority.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .transferAuthority(newAuthority)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
        })
        .rpc();

      console.log(`\n  ${c.green}${c.bold}Authority transferred successfully!${c.reset}`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError transferring authority: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Supply Cap ============

cli
  .command("set-supply-cap")
  .description("Set or update the supply cap (0 = unlimited)")
  .requiredOption("--cap <amount>", "New supply cap (raw amount, 0 = unlimited)")
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
      const cap = new BN(opts.cap);

      console.log(`\nSetting supply cap for mint: ${mint.toBase58()}`);
      console.log(`  New cap: ${cap.toString() === "0" ? "Unlimited" : cap.toString()}`);

      const tx = await program.methods
        .setSupplyCap(cap)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
        })
        .rpc();

      console.log(`\n  Supply cap updated successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError setting supply cap: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Update Minter Quota ============

cli
  .command("update-minter-quota")
  .description("Update an existing minter's quota")
  .requiredOption("--address <address>", "Minter address")
  .requiredOption("--quota <amount>", "New quota (raw amount, 0 = unlimited)")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const minter = new PublicKey(opts.address);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [minterInfo] = getMinterInfoPDA(stablecoinPDA, minter);
      const quota = new BN(opts.quota);

      console.log(`\nUpdating quota for minter: ${minter.toBase58()}`);
      console.log(`  Mint: ${mint.toBase58()}`);
      console.log(`  New quota: ${quota.toString() === "0" ? "Unlimited" : quota.toString()}`);

      const tx = await program.methods
        .updateMinterQuota(quota)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          minterInfo,
        })
        .rpc();

      console.log(`\n  Minter quota updated successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError updating minter quota: ${err.message}`);
      process.exit(1);
    }
  });

// ============ SSS-3 Allowlist Commands ============

const allowlistCmd = cli
  .command("allowlist")
  .description("Allowlist management (SSS-3)");

allowlistCmd
  .command("add")
  .description("Add address to allowlist")
  .requiredOption("--address <address>", "Address to allowlist")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const targetAddress = new PublicKey(opts.address);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [allowlistEntry] = getAllowlistPDA(stablecoinPDA, targetAddress);

      console.log(`\nAdding ${targetAddress.toBase58()} to allowlist`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .addToAllowlist(targetAddress)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          allowlistEntry,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`\n  Address allowlisted successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError adding to allowlist: ${err.message}`);
      process.exit(1);
    }
  });

allowlistCmd
  .command("remove")
  .description("Remove address from allowlist")
  .requiredOption("--address <address>", "Address to remove")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
  .action(async (opts) => {
    try {
      const connection = getConnection(opts.cluster);
      const authority = loadKeypair(opts.keypair);
      const program = getProgram(connection, authority);
      const mint = requireMint(opts);
      const targetAddress = new PublicKey(opts.address);
      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [allowlistEntry] = getAllowlistPDA(stablecoinPDA, targetAddress);

      console.log(`\nRemoving ${targetAddress.toBase58()} from allowlist`);
      console.log(`  Mint: ${mint.toBase58()}`);

      const tx = await program.methods
        .removeFromAllowlistEntry(targetAddress)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          allowlistEntry,
        })
        .rpc();

      console.log(`\n  Address removed from allowlist successfully!`);
      console.log(`  Transaction: ${tx}`);
    } catch (err: any) {
      console.error(`\nError removing from allowlist: ${err.message}`);
      process.exit(1);
    }
  });

// ============ Oracle: Price Feed ============

const ORACLE_FEED_IDS: Record<string, string> = {
  "usdc": "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  "usdt": "2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  "sol":  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

function resolveOracleFeed(feed: string): string {
  const lower = feed.toLowerCase();
  if (lower in ORACLE_FEED_IDS) return ORACLE_FEED_IDS[lower];
  return feed.replace(/^0x/, "");
}

async function fetchPythPrice(feedId: string): Promise<{
  price: number;
  confidence: number;
  publishTime: number;
}> {
  const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pyth API error: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as any;
  if (!json.parsed || json.parsed.length === 0) throw new Error(`No price data for feed ${feedId}`);
  const p = json.parsed[0].price;
  return {
    price: Number(p.price) * Math.pow(10, p.expo),
    confidence: Number(p.conf) * Math.pow(10, p.expo),
    publishTime: p.publish_time,
  };
}

cli
  .command("price")
  .description("Fetch current price from Pyth oracle")
  .requiredOption("--feed <name>", "Feed name (usdc, usdt, sol) or hex feed ID")
  .action(async (opts) => {
    try {
      const feedId = resolveOracleFeed(opts.feed);
      const label = opts.feed.toUpperCase();

      console.log(`\n${c.bold}Fetching ${label} price from Pyth oracle...${c.reset}\n`);

      const data = await fetchPythPrice(feedId);
      const time = new Date(data.publishTime * 1000).toISOString();

      console.log(`  ${c.cyan}Feed:${c.reset}       ${label} (${feedId.slice(0, 16)}...)`);
      console.log(`  ${c.cyan}Price:${c.reset}      ${c.bold}$${data.price.toFixed(6)}${c.reset}`);
      console.log(`  ${c.cyan}Confidence:${c.reset} \u00b1$${data.confidence.toFixed(6)}`);
      console.log(`  ${c.cyan}Updated:${c.reset}    ${time}`);
      console.log();
    } catch (err: any) {
      console.error(`\n${c.red}Error fetching price: ${err.message}${c.reset}`);
      process.exit(1);
    }
  });

// ============ Oracle: Peg Monitor ============

cli
  .command("peg-monitor")
  .description("Continuously monitor stablecoin peg status with depeg alerts")
  .requiredOption("--feed <name>", "Feed name (usdc, usdt) or hex feed ID")
  .option("--interval <seconds>", "Polling interval in seconds", "10")
  .option("--threshold <percent>", "Depeg alert threshold as percentage", "1")
  .action(async (opts) => {
    const feedId = resolveOracleFeed(opts.feed);
    const label = opts.feed.toUpperCase();
    const intervalSec = parseInt(opts.interval) || 10;
    const threshold = parseFloat(opts.threshold) / 100; // convert % to decimal

    console.log(`\n${c.bold}Peg Monitor: ${label}${c.reset}`);
    console.log(`  Feed:      ${feedId.slice(0, 16)}...`);
    console.log(`  Interval:  ${intervalSec}s`);
    console.log(`  Threshold: ${(threshold * 100).toFixed(2)}%`);
    console.log(`  ${c.dim}Press Ctrl+C to stop${c.reset}\n`);

    const poll = async () => {
      try {
        const data = await fetchPythPrice(feedId);
        const deviation = Math.abs(data.price - 1.0);
        const devPercent = (deviation * 100).toFixed(4);
        const isDepegged = deviation >= threshold;
        const time = new Date(data.publishTime * 1000).toLocaleTimeString();

        if (isDepegged) {
          console.log(
            `  ${c.bg.red}${c.white} DEPEG ${c.reset} ${time}  ` +
            `$${data.price.toFixed(6)}  ` +
            `${c.red}deviation: ${devPercent}%${c.reset}  ` +
            `conf: \u00b1$${data.confidence.toFixed(6)}`
          );
        } else {
          console.log(
            `  ${c.bg.green}${c.white}  PEG  ${c.reset} ${time}  ` +
            `$${data.price.toFixed(6)}  ` +
            `${c.green}deviation: ${devPercent}%${c.reset}  ` +
            `conf: \u00b1$${data.confidence.toFixed(6)}`
          );
        }
      } catch (err: any) {
        console.error(`  ${c.red}[error]${c.reset} ${err.message}`);
      }
    };

    // Initial poll
    await poll();

    // Continuous polling
    const timer = setInterval(poll, intervalSec * 1000);
    process.on("SIGINT", () => {
      clearInterval(timer);
      console.log(`\n${c.dim}Monitor stopped.${c.reset}`);
      process.exit(0);
    });
  });

// ── On-Chain Oracle Configuration ──────────────────────────────────

cli
  .command("configure-oracle")
  .description("Configure on-chain oracle price enforcement for mint/burn operations")
  .requiredOption("--mint <address>", "Stablecoin mint address")
  .requiredOption("--price-feed <address>", "Pyth price feed account address (on-chain)")
  .option("--max-deviation <bps>", "Maximum deviation from $1.00 in basis points", "100")
  .option("--max-staleness <secs>", "Maximum price staleness in seconds", "60")
  .option("--disable", "Disable oracle enforcement")
  .option("--keypair <path>", "Path to authority keypair JSON")
  .option("--cluster <url>", "Solana cluster URL", "https://api.devnet.solana.com")
  .action(async (opts) => {
    const keypairPath = opts.keypair || `${process.env.HOME}/.config/solana/id.json`;
    const authority = loadKeypair(keypairPath);
    const connection = getConnection(opts.cluster);
    const program = getProgram(connection, authority);

    const mint = requireMint(opts);
    const priceFeed = new PublicKey(opts.priceFeed);
    const maxDeviationBps = parseInt(opts.maxDeviation);
    const maxStalenessSecs = parseInt(opts.maxStaleness);
    const enabled = !opts.disable;

    const [stablecoinPDA] = getStablecoinPDA(mint);
    const [oracleConfigPDA] = getOracleConfigPDA(stablecoinPDA);

    console.log(`\n${c.bold}Configure Oracle${c.reset}`);
    console.log(`  Mint:           ${mint.toBase58()}`);
    console.log(`  Price Feed:     ${priceFeed.toBase58()}`);
    console.log(`  Max Deviation:  ${maxDeviationBps} bps (${(maxDeviationBps / 100).toFixed(2)}%)`);
    console.log(`  Max Staleness:  ${maxStalenessSecs}s`);
    console.log(`  Enabled:        ${enabled}`);
    console.log(`  Oracle PDA:     ${oracleConfigPDA.toBase58()}`);

    try {
      const txSig = await program.methods
        .configureOracle(priceFeed, maxDeviationBps, new anchor.BN(maxStalenessSecs), enabled)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          oracleConfig: oracleConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      console.log(`\n  ${c.green}Oracle configured successfully!${c.reset}`);
      console.log(`  TX: ${txSig}`);
    } catch (err: any) {
      console.error(`\n  ${c.red}Error:${c.reset} ${err.message}`);
      process.exit(1);
    }
  });

cli.parse();
