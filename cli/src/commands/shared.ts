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
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require("../idl/sss_token.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hookIdl = require("../idl/sss_transfer_hook.json");

// ANSI colors
export const c = {
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

// Load program IDs from root .env, env vars, or fall back to defaults
function loadRootEnv(): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const envPath = path.resolve(__dirname, "../../../.env");
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.match(/^([A-Za-z_]+)=(.+)$/);
      if (m) vars[m[1]] = m[2].trim();
    }
  } catch {}
  return vars;
}

export const _env = loadRootEnv();

export const PROGRAM_ID = new PublicKey(
  process.env.SSS_TOKEN_PROGRAM_ID || _env.SSS_TOKEN_PROGRAM_ID || "BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq"
);
export const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  process.env.SSS_TRANSFER_HOOK_PROGRAM_ID || _env.SSS_TRANSFER_HOOK_PROGRAM_ID || "B9HzG9fuxbuJBG2wTSP6UmxBSQLdaUAk62Kcdf41WxAt"
);

// Re-export everything command modules need
export {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  anchor,
  BN,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
  fs,
  path,
  idl,
  hookIdl,
};

export function detectPreset(s: any): string {
  if (s.enableAllowlist) return "SSS-3 (Private)";
  if (s.enablePermanentDelegate || s.enableTransferHook) return "SSS-2 (Compliant)";
  return "SSS-1 (Minimal)";
}

export function formatAmount(raw: string | number, decimals: number): string {
  const n = Number(raw) / Math.pow(10, decimals);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals });
}

export function loadKeypair(filepath: string): Keypair {
  const resolved = filepath.startsWith("~")
    ? path.join(process.env.HOME || "", filepath.slice(1))
    : filepath;
  const secretKey = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

export function getConnection(cluster: string): Connection {
  if (cluster === "localnet") {
    return new Connection("http://localhost:8899", "confirmed");
  }
  if (cluster.startsWith("http")) {
    return new Connection(cluster, "confirmed");
  }
  return new Connection(clusterApiUrl(cluster as any), "confirmed");
}

export function getProgram(
  connection: Connection,
  authority: Keypair
): anchor.Program {
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new anchor.Program(idl as any, provider);
}

export function getHookProgram(
  connection: Connection,
  authority: Keypair
): anchor.Program {
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new anchor.Program(hookIdl as any, provider);
}

export function getExtraAccountMetaListPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    TRANSFER_HOOK_PROGRAM_ID
  );
}

export async function initializeExtraAccountMetaList(
  connection: Connection,
  authority: Keypair,
  mint: PublicKey
): Promise<string> {
  const hookProgram = getHookProgram(connection, authority);
  const [extraAccountMetaListPDA] = getExtraAccountMetaListPDA(mint);

  const tx = await hookProgram.methods
    .initializeExtraAccountMetaList()
    .accounts({
      payer: authority.publicKey,
      extraAccountMetaList: extraAccountMetaListPDA,
      mint: mint,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}

export function getStablecoinPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin"), mint.toBuffer()],
    PROGRAM_ID
  );
}

export function getRolePDA(
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

export function getMinterInfoPDA(
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

export function getBlacklistPDA(
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

export function getAllowlistPDA(
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

export function getOracleConfigPDA(
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

export function requireMint(opts: any): PublicKey {
  if (!opts.mint) {
    console.error("Error: --mint <address> is required for this command.");
    process.exit(1);
  }
  return new PublicKey(opts.mint);
}

/** Convert a human-readable amount (e.g. "1.5") to base units given decimals. */
export async function parseAmount(amountStr: string, mint: PublicKey, connection: Connection): Promise<BN> {
  const mintInfo = await connection.getParsedAccountInfo(mint);
  const decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals ?? 6;
  const parts = amountStr.split(".");
  const whole = parts[0];
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return new BN(whole + frac);
}

/** Map role string to Anchor enum object. */
export function roleToEnum(role: string): any {
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
