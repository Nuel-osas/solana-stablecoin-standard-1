import { PublicKey } from "@solana/web3.js";

export const SSS_TOKEN_PROGRAM_ID = new PublicKey(
  "BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq"
);

export const SSS_TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "B9HzG9fuxbuJBG2wTSP6UmxBSQLdaUAk62Kcdf41WxAt"
);

export function deriveStablecoinPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin"), mint.toBuffer()],
    SSS_TOKEN_PROGRAM_ID
  );
}

export function deriveRoleAssignmentPDA(
  stablecoin: PublicKey,
  roleStr: string,
  assignee: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("role"),
      stablecoin.toBuffer(),
      Buffer.from(roleStr),
      assignee.toBuffer(),
    ],
    SSS_TOKEN_PROGRAM_ID
  );
}

export function deriveBlacklistEntryPDA(
  stablecoin: PublicKey,
  address: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("blacklist"),
      stablecoin.toBuffer(),
      address.toBuffer(),
    ],
    SSS_TOKEN_PROGRAM_ID
  );
}

export function deriveAllowlistEntryPDA(
  stablecoin: PublicKey,
  address: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowlist"),
      stablecoin.toBuffer(),
      address.toBuffer(),
    ],
    SSS_TOKEN_PROGRAM_ID
  );
}

export function deriveMinterInfoPDA(
  stablecoin: PublicKey,
  minter: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("minter_info"),
      stablecoin.toBuffer(),
      minter.toBuffer(),
    ],
    SSS_TOKEN_PROGRAM_ID
  );
}

export function shortenAddress(addr: string, chars = 4): string {
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}
