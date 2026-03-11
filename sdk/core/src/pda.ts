import { PublicKey } from "@solana/web3.js";

const STABLECOIN_SEED = Buffer.from("stablecoin");
const ROLE_SEED = Buffer.from("role");
const BLACKLIST_SEED = Buffer.from("blacklist");
const MINTER_INFO_SEED = Buffer.from("minter_info");
const ALLOWLIST_SEED = Buffer.from("allowlist");
const ORACLE_CONFIG_SEED = Buffer.from("oracle_config");

export function findStablecoinPDA(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STABLECOIN_SEED, mint.toBuffer()],
    programId
  );
}

export function findRolePDA(
  stablecoin: PublicKey,
  role: string,
  assignee: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ROLE_SEED, stablecoin.toBuffer(), Buffer.from(role), assignee.toBuffer()],
    programId
  );
}

export function findBlacklistPDA(
  stablecoin: PublicKey,
  address: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, stablecoin.toBuffer(), address.toBuffer()],
    programId
  );
}

export function findMinterInfoPDA(
  stablecoin: PublicKey,
  minter: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINTER_INFO_SEED, stablecoin.toBuffer(), minter.toBuffer()],
    programId
  );
}

export function findAllowlistPDA(
  stablecoin: PublicKey,
  address: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ALLOWLIST_SEED, stablecoin.toBuffer(), address.toBuffer()],
    programId
  );
}

export function findOracleConfigPDA(
  stablecoin: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORACLE_CONFIG_SEED, stablecoin.toBuffer()],
    programId
  );
}
