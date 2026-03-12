/**
 * Parse Anchor/Solana/Wallet errors into readable messages.
 */
export function parseError(err: any): string {
  const msg = err?.message || err?.toString() || "Unknown error";

  // Wallet errors (check first — no need to parse further)
  if (msg.includes("User rejected")) {
    return "Transaction rejected by wallet.";
  }
  if (msg.includes("Unexpected error")) {
    return "Wallet error — make sure Phantom is set to Devnet and try again.";
  }
  if (msg.includes("Insufficient funds") || msg.includes("insufficient lamports")) {
    return "Insufficient SOL for transaction fees.";
  }

  // Transaction simulation failed — extract the actual error message from logs.
  // This catches transfer hook errors (allowlist/blacklist) with their correct messages.
  if (msg.includes("Transaction simulation failed")) {
    const innerMatch = msg.match(/Error Message: (.+?)(?:\.|$)/);
    if (innerMatch) return innerMatch[1];
  }

  // Check logs array for transfer hook error messages
  const logs: string[] = err?.logs || [];
  const logStr = logs.join(" ");
  if (logStr.includes("Sender is not on the allowlist")) {
    return "Sender is not on the allowlist";
  }
  if (logStr.includes("Recipient is not on the allowlist")) {
    return "Recipient is not on the allowlist";
  }
  if (logStr.includes("Sender is blacklisted")) {
    return "Sender is blacklisted";
  }
  if (logStr.includes("Recipient is blacklisted")) {
    return "Recipient is blacklisted";
  }

  // Anchor program errors (from IDL or error code)
  const anchorMatch = msg.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (anchorMatch) {
    const code = parseInt(anchorMatch[1], 16);
    // Anchor error codes start at 6000
    const anchorCode = code - 6000;
    const programErrors: Record<number, string> = {
      0: "Token operations are paused",
      1: "Unauthorized: you don't have the required role. Assign the role first via the Roles page.",
      2: "Address is blacklisted",
      3: "Address is not blacklisted",
      4: "Compliance module not enabled for this stablecoin",
      5: "Account is frozen",
      6: "Account is not frozen",
      7: "Minter quota exceeded",
      8: "Name too long",
      9: "Symbol too long",
      10: "URI too long",
      11: "Reason string too long",
      12: "Invalid decimals (0-18)",
      13: "Arithmetic overflow",
      14: "Transfer hook not enabled",
      15: "Cannot seize from non-blacklisted account",
      16: "Supply cap would be exceeded",
      17: "No pending authority nomination",
      18: "Caller is not the pending authority",
      19: "Allowlist is not enabled",
      20: "Address is not on the allowlist",
    };
    if (anchorCode in programErrors) {
      return programErrors[anchorCode];
    }
  }

  // Anchor constraint errors
  if (msg.includes("AccountNotInitialized") || msg.includes("Account does not exist")) {
    return "Account not found. You may need to assign the role first via the Roles page.";
  }
  if (msg.includes("ConstraintSeeds") || msg.includes("seeds constraint")) {
    return "PDA mismatch — check the mint address and connected wallet.";
  }
  if (msg.includes("ConstraintHasOne")) {
    return "Account mismatch — the connected wallet may not be the authority.";
  }
  if (msg.includes("already in use")) {
    return "This account already exists (e.g., role already assigned or address already on list).";
  }

  // Generic simulation failure fallback
  if (msg.includes("Transaction simulation failed")) {
    return "Transaction simulation failed — check your inputs and permissions.";
  }

  // Fallback: truncate if too long
  if (msg.length > 120) {
    return msg.slice(0, 117) + "...";
  }
  return msg;
}
