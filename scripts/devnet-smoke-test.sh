#!/usr/bin/env bash
###############################################################################
# SSS Devnet Smoke Test
#
# Exercises the full sss-token CLI on devnet (SSS-1, SSS-2, SSS-3) and logs
# every transaction signature to evidence/DEVNET_EVIDENCE.md.
#
# Prerequisites:
#   - solana CLI configured for devnet with a funded keypair
#   - sss-token CLI installed (npm link or yarn cli)
#   - spl-token CLI installed
#
# Usage:
#   chmod +x scripts/devnet-smoke-test.sh
#   ./scripts/devnet-smoke-test.sh
###############################################################################
set -e

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CLUSTER="devnet"
KEYPAIR="${SOLANA_KEYPAIR:-$HOME/.config/solana/id.json}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
EVIDENCE_FILE="$PROJECT_ROOT/evidence/DEVNET_EVIDENCE.md"
LOG_FILE="$PROJECT_ROOT/evidence/devnet-smoke-test.log"

# Signer wallet address
AUTHORITY=$(solana-keygen pubkey "$KEYPAIR")

# Secondary wallet for transfer / compliance tests
# Generate a throwaway keypair for the test run
SECONDARY_KP="$PROJECT_ROOT/evidence/.smoke-test-secondary.json"
solana-keygen new --no-bip39-passphrase --force -o "$SECONDARY_KP" 2>/dev/null
SECONDARY_ADDR=$(solana-keygen pubkey "$SECONDARY_KP")

# Third wallet (for blacklist / allowlist target)
THIRD_KP="$PROJECT_ROOT/evidence/.smoke-test-third.json"
solana-keygen new --no-bip39-passphrase --force -o "$THIRD_KP" 2>/dev/null
THIRD_ADDR=$(solana-keygen pubkey "$THIRD_KP")

echo "=== SSS Devnet Smoke Test ==="
echo "Authority : $AUTHORITY"
echo "Secondary : $SECONDARY_ADDR"
echo "Third     : $THIRD_ADDR"
echo "Cluster   : $CLUSTER"
echo ""

# ---------------------------------------------------------------------------
# Evidence file setup
# ---------------------------------------------------------------------------
mkdir -p "$PROJECT_ROOT/evidence"
cat > "$EVIDENCE_FILE" << 'HEADER'
# SSS Devnet Smoke Test Evidence

HEADER

echo "**Run timestamp:** $(date -u '+%Y-%m-%d %H:%M:%S UTC')" >> "$EVIDENCE_FILE"
echo "" >> "$EVIDENCE_FILE"
echo "**Authority wallet:** \`$AUTHORITY\`" | sed "s|\$AUTHORITY|$AUTHORITY|" >> "$EVIDENCE_FILE"
echo "" >> "$EVIDENCE_FILE"

cat >> "$EVIDENCE_FILE" << 'TABLE_HEADER'
## Transaction Log

| # | Preset | Operation | Command (abbreviated) | Transaction Signature | Status |
|---|--------|-----------|----------------------|----------------------|--------|
TABLE_HEADER

# Counter for row numbering
ROW=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Extract a transaction signature from CLI output.
# The sss-token CLI prints signatures in various formats; we look for a
# base58 string that is 87-88 chars (typical Solana tx sig).
extract_sig() {
  local output="$1"
  # Try to find a signature-like string (base58, 80-90 chars)
  local sig
  sig=$(echo "$output" | grep -oE '[1-9A-HJ-NP-Za-km-z]{80,90}' | head -1 || true)
  if [ -z "$sig" ]; then
    # Fallback: look for "signature:" or "Signature:" or "tx:" patterns
    sig=$(echo "$output" | grep -iE '(signature|tx)[: ]+' | grep -oE '[1-9A-HJ-NP-Za-km-z]{43,}' | head -1 || true)
  fi
  if [ -z "$sig" ]; then
    sig="(not captured)"
  fi
  echo "$sig"
}

# Extract a mint address from init output
extract_mint() {
  local output="$1"
  # Look for a public key (base58, 32-44 chars) after "mint" or on its own line
  local mint
  mint=$(echo "$output" | grep -iE '(mint|address|created)' | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -1 || true)
  if [ -z "$mint" ]; then
    mint=$(echo "$output" | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -1 || true)
  fi
  echo "$mint"
}

# Log a row to the evidence table
log_evidence() {
  local preset="$1"
  local operation="$2"
  local command_abbrev="$3"
  local sig="$4"
  local status="$5"
  ROW=$((ROW + 1))
  local sig_display="$sig"
  if [ "$sig" != "(not captured)" ] && [ "$sig" != "(expected failure)" ]; then
    sig_display="[\`${sig:0:12}...\`](https://explorer.solana.com/tx/${sig}?cluster=devnet)"
  else
    sig_display="\`$sig\`"
  fi
  echo "| $ROW | $preset | $operation | \`$command_abbrev\` | $sig_display | $status |" >> "$EVIDENCE_FILE"
}

# Run a CLI command, capture output, extract sig, and log it
run_and_log() {
  local preset="$1"
  local operation="$2"
  local command_abbrev="$3"
  shift 3
  local full_cmd="$*"

  echo "[$preset] $operation ..."
  echo "  > $full_cmd"

  local output
  local exit_code=0
  output=$(eval "$full_cmd" 2>&1) || exit_code=$?

  # Log full output for debugging
  echo "--- [$preset] $operation ---" >> "$LOG_FILE"
  echo "$full_cmd" >> "$LOG_FILE"
  echo "$output" >> "$LOG_FILE"
  echo "exit_code=$exit_code" >> "$LOG_FILE"
  echo "" >> "$LOG_FILE"

  local sig
  sig=$(extract_sig "$output")

  if [ $exit_code -eq 0 ]; then
    log_evidence "$preset" "$operation" "$command_abbrev" "$sig" "SUCCESS"
    echo "  -> OK (sig: ${sig:0:20}...)"
  else
    log_evidence "$preset" "$operation" "$command_abbrev" "$sig" "FAILED (exit $exit_code)"
    echo "  -> FAILED (exit $exit_code)"
    echo "  Output: $output"
    return $exit_code
  fi

  # Return the output so callers can parse it
  echo "$output" > /tmp/sss_last_output.txt
}

# Run a command that is EXPECTED to fail (negative test)
run_expect_fail() {
  local preset="$1"
  local operation="$2"
  local command_abbrev="$3"
  shift 3
  local full_cmd="$*"

  echo "[$preset] $operation (expected failure) ..."
  echo "  > $full_cmd"

  local output
  local exit_code=0
  output=$(eval "$full_cmd" 2>&1) || exit_code=$?

  echo "--- [$preset] $operation (expect fail) ---" >> "$LOG_FILE"
  echo "$full_cmd" >> "$LOG_FILE"
  echo "$output" >> "$LOG_FILE"
  echo "exit_code=$exit_code" >> "$LOG_FILE"
  echo "" >> "$LOG_FILE"

  if [ $exit_code -ne 0 ]; then
    log_evidence "$preset" "$operation" "$command_abbrev" "(expected failure)" "EXPECTED FAIL"
    echo "  -> Correctly failed (exit $exit_code)"
  else
    log_evidence "$preset" "$operation" "$command_abbrev" "(unexpected)" "UNEXPECTED SUCCESS"
    echo "  -> WARNING: expected failure but command succeeded"
  fi

  echo "$output" > /tmp/sss_last_output.txt
}

# ---------------------------------------------------------------------------
# Preflight: ensure we have SOL on devnet
# ---------------------------------------------------------------------------
echo ""
echo "=== Preflight Checks ==="
BALANCE=$(solana balance --keypair "$KEYPAIR" --url devnet | grep -oE '[0-9]+(\.[0-9]+)?' | head -1)
echo "Authority balance: $BALANCE SOL"
if (( $(echo "$BALANCE < 0.5" | bc -l) )); then
  echo "Low balance — requesting airdrop..."
  solana airdrop 2 --keypair "$KEYPAIR" --url devnet || true
  sleep 5
fi

# Airdrop some SOL to secondary wallet for ATA creation
echo "Airdropping to secondary wallet..."
solana airdrop 0.5 "$SECONDARY_ADDR" --url devnet || true
sleep 3

echo ""
echo "=== Starting Smoke Tests ==="
echo ""

###############################################################################
# PART 1: SSS-1 (Minimal)
###############################################################################
echo "============================================="
echo "  PART 1: SSS-1 (Minimal Stablecoin)"
echo "============================================="

# 1.1 Init SSS-1
run_and_log "SSS-1" "Initialize token" "sss-token init sss-1 ..." \
  sss-token init sss-1 --name '"SmokeTest USD"' --symbol '"STUSD"' --decimals 6 --cluster "$CLUSTER" --keypair "$KEYPAIR"

SSS1_MINT=$(extract_mint "$(cat /tmp/sss_last_output.txt)")
echo "  SSS-1 Mint: $SSS1_MINT"

# 1.2 Assign minter role
run_and_log "SSS-1" "Assign minter role" "sss-token roles assign --role minter ..." \
  sss-token roles assign --role minter --address "$AUTHORITY" --mint "$SSS1_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 1.3 Add minter
run_and_log "SSS-1" "Add minter" "sss-token minters add ..." \
  sss-token minters add --address "$AUTHORITY" --mint "$SSS1_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 1.4 Mint tokens
run_and_log "SSS-1" "Mint 1000 tokens" "sss-token mint --amount 1000 ..." \
  sss-token mint --to "$AUTHORITY" --amount 1000 --mint "$SSS1_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 1.5 Get token account for freeze/thaw
SSS1_ATA=$(spl-token address --token "$SSS1_MINT" --owner "$AUTHORITY" --url devnet --output json 2>/dev/null | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -1 || true)
if [ -z "$SSS1_ATA" ]; then
  SSS1_ATA=$(spl-token address --token "$SSS1_MINT" --owner "$AUTHORITY" --url devnet 2>/dev/null | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -1 || true)
fi
echo "  SSS-1 ATA: $SSS1_ATA"

# 1.6 Freeze
run_and_log "SSS-1" "Freeze token account" "sss-token freeze ..." \
  sss-token freeze --account "$SSS1_ATA" --mint "$SSS1_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 1.7 Thaw
run_and_log "SSS-1" "Thaw token account" "sss-token thaw ..." \
  sss-token thaw --account "$SSS1_ATA" --mint "$SSS1_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 1.8 Pause
run_and_log "SSS-1" "Pause token" "sss-token pause ..." \
  sss-token pause --mint "$SSS1_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 1.9 Unpause
run_and_log "SSS-1" "Unpause token" "sss-token unpause ..." \
  sss-token unpause --mint "$SSS1_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 1.10 Status query
run_and_log "SSS-1" "Query status" "sss-token status ..." \
  sss-token status --mint "$SSS1_MINT" --cluster "$CLUSTER"

# 1.11 Supply query
run_and_log "SSS-1" "Query supply" "sss-token supply ..." \
  sss-token supply --mint "$SSS1_MINT" --cluster "$CLUSTER"

# 1.12 Holders query
run_and_log "SSS-1" "Query holders" "sss-token holders ..." \
  sss-token holders --mint "$SSS1_MINT" --cluster "$CLUSTER"

echo ""

###############################################################################
# PART 2: SSS-2 (Compliant)
###############################################################################
echo "============================================="
echo "  PART 2: SSS-2 (Compliant Stablecoin)"
echo "============================================="

# 2.1 Init SSS-2
run_and_log "SSS-2" "Initialize token" "sss-token init sss-2 ..." \
  sss-token init sss-2 --name '"Compliant USD"' --symbol '"CUSD"' --decimals 6 --cluster "$CLUSTER" --keypair "$KEYPAIR"

SSS2_MINT=$(extract_mint "$(cat /tmp/sss_last_output.txt)")
echo "  SSS-2 Mint: $SSS2_MINT"

# 2.2 Assign roles
run_and_log "SSS-2" "Assign minter role" "sss-token roles assign --role minter ..." \
  sss-token roles assign --role minter --address "$AUTHORITY" --mint "$SSS2_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

run_and_log "SSS-2" "Assign blacklister role" "sss-token roles assign --role blacklister ..." \
  sss-token roles assign --role blacklister --address "$AUTHORITY" --mint "$SSS2_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

run_and_log "SSS-2" "Assign seizer role" "sss-token roles assign --role seizer ..." \
  sss-token roles assign --role seizer --address "$AUTHORITY" --mint "$SSS2_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 2.3 Add minter
run_and_log "SSS-2" "Add minter" "sss-token minters add ..." \
  sss-token minters add --address "$AUTHORITY" --mint "$SSS2_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 2.4 Mint tokens to authority
run_and_log "SSS-2" "Mint 5000 tokens to authority" "sss-token mint --amount 5000 ..." \
  sss-token mint --to "$AUTHORITY" --amount 5000 --mint "$SSS2_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 2.5 Transfer some tokens to secondary (to have tokens to seize later)
run_and_log "SSS-2" "Transfer 500 to secondary" "sss-token transfer --amount 500 ..." \
  sss-token transfer --to "$SECONDARY_ADDR" --amount 500 --mint "$SSS2_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 2.6 Blacklist the secondary address
run_and_log "SSS-2" "Blacklist secondary addr" "sss-token blacklist add ..." \
  sss-token blacklist add --address "$SECONDARY_ADDR" --mint "$SSS2_MINT" --reason '"Smoke test blacklist"' --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 2.7 Seize tokens from blacklisted account
SSS2_SECONDARY_ATA=$(spl-token address --token "$SSS2_MINT" --owner "$SECONDARY_ADDR" --url devnet 2>/dev/null | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -1 || true)
SSS2_AUTHORITY_ATA=$(spl-token address --token "$SSS2_MINT" --owner "$AUTHORITY" --url devnet 2>/dev/null | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -1 || true)

if [ -n "$SSS2_SECONDARY_ATA" ] && [ -n "$SSS2_AUTHORITY_ATA" ]; then
  run_and_log "SSS-2" "Seize tokens from blacklisted" "sss-token seize ..." \
    sss-token seize --from "$SSS2_SECONDARY_ATA" --to "$SSS2_AUTHORITY_ATA" --mint "$SSS2_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"
else
  echo "  Skipping seize — could not resolve ATAs"
  log_evidence "SSS-2" "Seize tokens" "sss-token seize ..." "(skipped)" "SKIPPED (ATA resolution)"
fi

# 2.8 Transfer tokens (normal)
run_and_log "SSS-2" "Transfer 100 tokens" "sss-token transfer --amount 100 ..." \
  sss-token transfer --to "$THIRD_ADDR" --amount 100 --mint "$SSS2_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 2.9 Status / Supply / Holders
run_and_log "SSS-2" "Query status" "sss-token status ..." \
  sss-token status --mint "$SSS2_MINT" --cluster "$CLUSTER"

run_and_log "SSS-2" "Query supply" "sss-token supply ..." \
  sss-token supply --mint "$SSS2_MINT" --cluster "$CLUSTER"

run_and_log "SSS-2" "Query holders" "sss-token holders ..." \
  sss-token holders --mint "$SSS2_MINT" --cluster "$CLUSTER"

echo ""

###############################################################################
# PART 3: SSS-3 (Private / Allowlist)
###############################################################################
echo "============================================="
echo "  PART 3: SSS-3 (Private Stablecoin)"
echo "============================================="

# 3.1 Init SSS-3
run_and_log "SSS-3" "Initialize token" "sss-token init sss-3 ..." \
  sss-token init sss-3 --name '"Private USD"' --symbol '"PUSD"' --decimals 6 --cluster "$CLUSTER" --keypair "$KEYPAIR"

SSS3_MINT=$(extract_mint "$(cat /tmp/sss_last_output.txt)")
echo "  SSS-3 Mint: $SSS3_MINT"

# 3.2 Assign minter role
run_and_log "SSS-3" "Assign minter role" "sss-token roles assign --role minter ..." \
  sss-token roles assign --role minter --address "$AUTHORITY" --mint "$SSS3_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 3.3 Add minter
run_and_log "SSS-3" "Add minter" "sss-token minters add ..." \
  sss-token minters add --address "$AUTHORITY" --mint "$SSS3_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 3.4 Mint tokens
run_and_log "SSS-3" "Mint 2000 tokens" "sss-token mint --amount 2000 ..." \
  sss-token mint --to "$AUTHORITY" --amount 2000 --mint "$SSS3_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 3.5 Transfer WITHOUT allowlist (should fail)
run_expect_fail "SSS-3" "Transfer without allowlist (expect fail)" "sss-token transfer ... (no allowlist)" \
  sss-token transfer --to "$SECONDARY_ADDR" --amount 100 --mint "$SSS3_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 3.6 Add sender and recipient to allowlist
run_and_log "SSS-3" "Add authority to allowlist" "sss-token allowlist add (authority) ..." \
  sss-token allowlist add --address "$AUTHORITY" --mint "$SSS3_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

run_and_log "SSS-3" "Add secondary to allowlist" "sss-token allowlist add (secondary) ..." \
  sss-token allowlist add --address "$SECONDARY_ADDR" --mint "$SSS3_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 3.7 Transfer WITH allowlist (should succeed)
run_and_log "SSS-3" "Transfer with allowlist" "sss-token transfer ... (allowlisted)" \
  sss-token transfer --to "$SECONDARY_ADDR" --amount 100 --mint "$SSS3_MINT" --cluster "$CLUSTER" --keypair "$KEYPAIR"

# 3.8 Status / Supply / Holders
run_and_log "SSS-3" "Query status" "sss-token status ..." \
  sss-token status --mint "$SSS3_MINT" --cluster "$CLUSTER"

run_and_log "SSS-3" "Query supply" "sss-token supply ..." \
  sss-token supply --mint "$SSS3_MINT" --cluster "$CLUSTER"

run_and_log "SSS-3" "Query holders" "sss-token holders ..." \
  sss-token holders --mint "$SSS3_MINT" --cluster "$CLUSTER"

echo ""

###############################################################################
# Summary
###############################################################################
echo "============================================="
echo "  Smoke Test Complete"
echo "============================================="

# Append summary to evidence file
cat >> "$EVIDENCE_FILE" << EOF

## Mint Addresses

| Preset | Mint Address |
|--------|-------------|
| SSS-1  | \`$SSS1_MINT\` |
| SSS-2  | \`$SSS2_MINT\` |
| SSS-3  | \`$SSS3_MINT\` |

## Test Wallets

| Role | Address |
|------|---------|
| Authority | \`$AUTHORITY\` |
| Secondary | \`$SECONDARY_ADDR\` |
| Third     | \`$THIRD_ADDR\` |

## Run Info

- **Cluster:** $CLUSTER
- **Total operations:** $ROW
- **Full log:** \`evidence/devnet-smoke-test.log\`
- **Generated by:** \`scripts/devnet-smoke-test.sh\`
EOF

echo ""
echo "Results written to: $EVIDENCE_FILE"
echo "Full log at:        $LOG_FILE"
echo "Total operations:   $ROW"
echo ""
echo "Mint addresses:"
echo "  SSS-1: $SSS1_MINT"
echo "  SSS-2: $SSS2_MINT"
echo "  SSS-3: $SSS3_MINT"

# Cleanup temp keypairs (comment out to keep them)
# rm -f "$SECONDARY_KP" "$THIRD_KP"
