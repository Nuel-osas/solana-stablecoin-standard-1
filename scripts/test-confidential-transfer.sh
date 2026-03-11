#!/usr/bin/env bash
# ============================================================================
# SSS-3 Confidential Transfer — Full Flow Test
# ============================================================================
#
# Builds Token-2022 v10.0.0 with zk-ops, starts a local validator,
# and runs the complete confidential transfer flow:
#
#   mint → create accounts → configure CT → deposit → apply pending →
#   confidential transfer → apply pending (recipient) → withdraw
#
# Requirements:
#   - Solana CLI 3.1.x  (solana, solana-test-validator, solana-keygen)
#   - spl-token CLI 5.x  (spl-token)
#   - cargo-build-sbf     (ships with Solana CLI)
#   - git, python3
#
# Usage:
#   ./scripts/test-confidential-transfer.sh
#
# The script is idempotent — it cleans up after itself on exit.
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WORK_DIR="/tmp/sss3-ct-test"
VALIDATOR_PID=""
ORIGINAL_CONFIG_URL=""

# ── Helpers ──────────────────────────────────────────────────────────────────

step()  { echo -e "\n${CYAN}[$1/${TOTAL_STEPS}]${NC} ${BOLD}$2${NC}"; }
pass()  { echo -e "  ${GREEN}✓ $1${NC}"; PASS=$((PASS + 1)); }
fail()  { echo -e "  ${RED}✗ $1${NC}"; FAIL=$((FAIL + 1)); }
info()  { echo -e "  ${YELLOW}→ $1${NC}"; }

cleanup() {
    echo ""
    if [ -n "$VALIDATOR_PID" ] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
        info "Stopping test validator (PID $VALIDATOR_PID)..."
        kill "$VALIDATOR_PID" 2>/dev/null || true
        wait "$VALIDATOR_PID" 2>/dev/null || true
    fi
    if [ -n "$ORIGINAL_CONFIG_URL" ]; then
        solana config set --url "$ORIGINAL_CONFIG_URL" > /dev/null 2>&1 || true
        info "Restored Solana config to $ORIGINAL_CONFIG_URL"
    fi
    rm -rf "$WORK_DIR/test-ledger" 2>/dev/null || true
    rm -f "$WORK_DIR/recipient.json" 2>/dev/null || true
}
trap cleanup EXIT

TOTAL_STEPS=10

echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     SSS-3 Confidential Transfer — Full Flow Test           ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"

# ── Preflight checks ────────────────────────────────────────────────────────

for cmd in solana solana-test-validator solana-keygen spl-token cargo-build-sbf git python3; do
    if ! command -v "$cmd" &>/dev/null; then
        echo -e "${RED}Missing required tool: $cmd${NC}"
        exit 1
    fi
done
info "All required tools found"

ORIGINAL_CONFIG_URL=$(solana config get 2>/dev/null | grep "RPC URL" | awk '{print $3}')
mkdir -p "$WORK_DIR"

# ── Step 1: Build Token-2022 v10.0.0 with zk-ops ────────────────────────────

step 1 "Building Token-2022 v10.0.0 with zk-ops feature"

if [ -f "$WORK_DIR/token-2022/target/deploy/spl_token_2022.so" ]; then
    info "Using cached build from $WORK_DIR/token-2022"
    pass "Token-2022 v10.0.0 already built"
else
    info "Cloning solana-program/token-2022..."
    rm -rf "$WORK_DIR/token-2022"
    git clone --depth 1 https://github.com/solana-program/token-2022.git "$WORK_DIR/token-2022" 2>&1 | tail -1

    info "Building with cargo-build-sbf (this takes ~30s)..."
    cd "$WORK_DIR/token-2022/program"
    if cargo build-sbf 2>&1 | tail -2; then
        pass "Token-2022 v10.0.0 built with zk-ops"
    else
        fail "Failed to build Token-2022"
        exit 1
    fi
fi

TOKEN_2022_SO="$WORK_DIR/token-2022/target/deploy/spl_token_2022.so"

# ── Step 2: Start test validator ─────────────────────────────────────────────

step 2 "Starting test validator with custom Token-2022"

# Kill any existing validator
pkill -f solana-test-validator 2>/dev/null || true
sleep 1
rm -rf "$WORK_DIR/test-ledger"

solana config set --url localhost > /dev/null 2>&1

cd "$WORK_DIR"
solana-test-validator \
    --bpf-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb "$TOKEN_2022_SO" \
    --reset \
    --ledger "$WORK_DIR/test-ledger" \
    --quiet &
VALIDATOR_PID=$!

# Wait for validator to be ready
for i in $(seq 1 30); do
    if solana cluster-version &>/dev/null; then
        break
    fi
    sleep 1
done

if solana cluster-version &>/dev/null; then
    pass "Test validator running (PID $VALIDATOR_PID)"
else
    fail "Test validator failed to start"
    exit 1
fi

solana airdrop 100 > /dev/null 2>&1

# ── Step 3: Create mint with ConfidentialTransferMint extension ──────────────

step 3 "Creating Token-2022 mint with ConfidentialTransferMint"

MINT_OUTPUT=$(spl-token create-token \
    --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
    --enable-confidential-transfers auto \
    --decimals 6 2>&1)

CT_MINT=$(echo "$MINT_OUTPUT" | grep "Address:" | awk '{print $2}')
if [ -n "$CT_MINT" ]; then
    pass "Mint created: $CT_MINT"
else
    fail "Failed to create mint"
    exit 1
fi

# ── Step 4: Create sender account + configure CT ────────────────────────────

step 4 "Creating sender account and configuring confidential transfers"

SENDER_OUTPUT=$(spl-token create-account "$CT_MINT" 2>&1)
SENDER_ATA=$(echo "$SENDER_OUTPUT" | grep "Creating account" | awk '{print $3}')
info "Sender ATA: $SENDER_ATA"

if spl-token configure-confidential-transfer-account --address "$SENDER_ATA" 2>&1 | grep -q "Signature"; then
    pass "Sender CT configured (ElGamal keys generated)"
else
    fail "Failed to configure sender CT"
    exit 1
fi

# ── Step 5: Create recipient account + configure CT ─────────────────────────

step 5 "Creating recipient account and configuring confidential transfers"

solana-keygen new --no-bip39-passphrase -o "$WORK_DIR/recipient.json" --force > /dev/null 2>&1
RECIPIENT=$(solana-keygen pubkey "$WORK_DIR/recipient.json")
solana airdrop 5 "$RECIPIENT" > /dev/null 2>&1
info "Recipient: $RECIPIENT"

spl-token create-account "$CT_MINT" --owner "$RECIPIENT" --fee-payer ~/.config/solana/id.json > /dev/null 2>&1
RECIPIENT_ATA=$(spl-token accounts "$CT_MINT" --owner "$RECIPIENT" --output json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['accounts'][0]['address'])")
info "Recipient ATA: $RECIPIENT_ATA"

if spl-token configure-confidential-transfer-account --address "$RECIPIENT_ATA" --owner "$WORK_DIR/recipient.json" 2>&1 | grep -q "Signature"; then
    pass "Recipient CT configured (ElGamal keys generated)"
else
    fail "Failed to configure recipient CT"
    exit 1
fi

# ── Step 6: Mint tokens ─────────────────────────────────────────────────────

step 6 "Minting 1000 tokens (public balance)"

if spl-token mint "$CT_MINT" 1000 2>&1 | grep -q "Signature"; then
    pass "Minted 1000 tokens to sender"
else
    fail "Failed to mint tokens"
    exit 1
fi

# ── Step 7: Deposit into confidential balance ────────────────────────────────

step 7 "Depositing 100 tokens into confidential balance"

if spl-token deposit-confidential-tokens "$CT_MINT" 100 --address "$SENDER_ATA" 2>&1 | grep -q "Signature"; then
    pass "Deposited 100 tokens into confidential balance"
else
    fail "Deposit failed — zk-ops may not be enabled"
    exit 1
fi

spl-token apply-pending-balance --address "$SENDER_ATA" > /dev/null 2>&1
info "Applied pending balance"

# ── Step 8: Confidential transfer ───────────────────────────────────────────

step 8 "Confidential transfer: 50 tokens → recipient (ZK proofs)"

if spl-token transfer "$CT_MINT" 50 "$RECIPIENT" --confidential 2>&1 | grep -q "Signature"; then
    pass "Confidential transfer succeeded — ZK proofs verified on-chain"
else
    fail "Confidential transfer failed"
    exit 1
fi

spl-token apply-pending-balance --address "$RECIPIENT_ATA" --owner "$WORK_DIR/recipient.json" > /dev/null 2>&1
info "Applied pending balance on recipient"

# ── Step 9: Withdraw from confidential balance ──────────────────────────────

step 9 "Withdrawing 25 tokens from recipient's confidential balance"

if spl-token withdraw-confidential-tokens "$CT_MINT" 25 --address "$RECIPIENT_ATA" --owner "$WORK_DIR/recipient.json" 2>&1 | grep -q "Signature"; then
    pass "Withdrew 25 tokens back to public balance"
else
    fail "Withdraw failed"
    exit 1
fi

# ── Step 10: Verify final balances ───────────────────────────────────────────

step 10 "Verifying final balances"

SENDER_BAL=$(spl-token balance "$CT_MINT" 2>/dev/null)
RECIP_BAL=$(spl-token balance "$CT_MINT" --owner "$RECIPIENT" 2>/dev/null)

info "Sender public balance:    $SENDER_BAL (expected: 900)"
info "Recipient public balance: $RECIP_BAL (expected: 25)"

if [ "$SENDER_BAL" = "900" ] && [ "$RECIP_BAL" = "25" ]; then
    pass "Final balances correct"
else
    fail "Unexpected balances — sender: $SENDER_BAL, recipient: $RECIP_BAL"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}${BOLD}  All $PASS/$TOTAL checks passed${NC}"
    echo -e "${GREEN}${BOLD}  Full confidential transfer flow verified ✓${NC}"
else
    echo -e "${RED}${BOLD}  $FAIL/$TOTAL checks failed${NC}"
fi
echo -e "${BOLD}══════════════════════════════════════════════════════════════${NC}"
echo ""

exit "$FAIL"
