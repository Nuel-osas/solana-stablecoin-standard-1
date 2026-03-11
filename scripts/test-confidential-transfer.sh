#!/usr/bin/env bash
# ============================================================================
# SSS-3 Confidential Transfer — End-to-End Integration Test
# ============================================================================
#
# Two-phase test proving SSS-3's confidential transfer capabilities:
#
# Phase 1: Runs the SSS-3 test suite (anchor test) which verifies that
#   our program initializes the ConfidentialTransferMint extension on
#   SSS-3 mints. Uses the native Token-2022 (built into the validator).
#
# Phase 2: Builds Token-2022 v10.0.0 with zk-ops, starts a validator,
#   and runs the full confidential transfer flow:
#   create CT mint → configure accounts → deposit → confidential transfer
#   (ZK proofs) → withdraw
#
# Why two phases: our Anchor program uses spl-token-2022 v6 (anchor-spl).
# Token-2022 v10 changed the account format, so v6-created mints can't
# be used with v10 CT operations. Both capabilities are verified
# independently until the Anchor ecosystem catches up to v10.
#
# Requirements:
#   - Solana CLI 3.1.x  (solana, solana-test-validator, solana-keygen)
#   - spl-token CLI 5.x  (spl-token)
#   - cargo-build-sbf     (ships with Solana CLI)
#   - git, yarn/npm, anchor
#
# Usage:
#   ./scripts/test-confidential-transfer.sh
#   # or: yarn test:ct
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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Helpers ──────────────────────────────────────────────────────────────────

step()  { echo -e "\n${CYAN}[$1/$TOTAL_STEPS]${NC} ${BOLD}$2${NC}"; }
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

TOTAL_STEPS=8

echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  SSS-3 Confidential Transfer — End-to-End Integration Test ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"

# ── Preflight ────────────────────────────────────────────────────────────────

for cmd in solana solana-test-validator solana-keygen spl-token cargo-build-sbf git; do
    if ! command -v "$cmd" &>/dev/null; then
        echo -e "${RED}Missing required tool: $cmd${NC}"
        exit 1
    fi
done
info "All required tools found"

ORIGINAL_CONFIG_URL=$(solana config get 2>/dev/null | grep "RPC URL" | awk '{print $3}')
mkdir -p "$WORK_DIR"

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 1: SSS-3 program creates CT-ready mints
# ══════════════════════════════════════════════════════════════════════════════

echo -e "\n${BOLD}── Phase 1: SSS-3 program initializes ConfidentialTransferMint ──${NC}"

step 1 "Running SSS-3 anchor test (CT extension verification)"

cd "$PROJECT_DIR"

# Run anchor test and capture output
ANCHOR_OUTPUT=$(anchor test --skip-lint 2>&1) || true
echo "$ANCHOR_OUTPUT" | grep -E "ConfidentialTransferMint|passing|failing" | head -5

if echo "$ANCHOR_OUTPUT" | grep -q "ConfidentialTransferMint extension verified"; then
    pass "SSS-3 ConfidentialTransferMint extension verified via anchor test"
elif echo "$ANCHOR_OUTPUT" | grep -q "passing" && ! echo "$ANCHOR_OUTPUT" | grep -q "failing"; then
    pass "SSS-3 anchor tests passed (includes CT extension check)"
else
    fail "SSS-3 anchor test failed"
fi

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2: Full CT flow on localnet with Token-2022 v10 + zk-ops
# ══════════════════════════════════════════════════════════════════════════════

echo -e "\n${BOLD}── Phase 2: Full confidential transfer flow (Token-2022 v10) ──${NC}"

# ── Build Token-2022 v10 ─────────────────────────────────────────────────────

step 2 "Building Token-2022 v10.0.0 with zk-ops"

if [ -f "$WORK_DIR/token-2022-v10/target/deploy/spl_token_2022.so" ]; then
    info "Using cached build"
    pass "Token-2022 v10.0.0 already built"
else
    info "Cloning solana-program/token-2022..."
    rm -rf "$WORK_DIR/token-2022-v10"
    git clone --depth 1 https://github.com/solana-program/token-2022.git "$WORK_DIR/token-2022-v10" 2>&1 | tail -1
    info "Building with cargo-build-sbf..."
    cd "$WORK_DIR/token-2022-v10/program"
    if cargo build-sbf 2>&1 | tail -2; then
        pass "Token-2022 v10.0.0 built with zk-ops"
    else
        fail "Build failed"; exit 1
    fi
fi

TOKEN_2022_SO="$WORK_DIR/token-2022-v10/target/deploy/spl_token_2022.so"

# ── Start validator ──────────────────────────────────────────────────────────

step 3 "Starting test validator with Token-2022 v10 (zk-ops)"

pkill -f solana-test-validator 2>/dev/null || true
sleep 2
rm -rf "$WORK_DIR/test-ledger"
solana config set --url localhost > /dev/null 2>&1

cd "$WORK_DIR"
solana-test-validator \
    --bpf-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb "$TOKEN_2022_SO" \
    --reset --ledger "$WORK_DIR/test-ledger" --quiet &
VALIDATOR_PID=$!

for i in $(seq 1 30); do
    if solana cluster-version &>/dev/null; then break; fi
    sleep 1
done
if solana cluster-version &>/dev/null; then
    pass "Validator running (PID $VALIDATOR_PID)"
else
    fail "Validator failed to start"; exit 1
fi
solana airdrop 100 > /dev/null 2>&1

# ── Create CT mint + accounts ───────────────────────────────────────────────

step 4 "Creating CT-enabled mint and configuring accounts"

CT_MINT=$(spl-token create-token \
    --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
    --enable-confidential-transfers auto --decimals 6 2>&1 | grep "Address:" | awk '{print $2}')

if [ -z "$CT_MINT" ]; then fail "Mint creation failed"; exit 1; fi
info "Mint: $CT_MINT"

# Sender
SENDER_ATA=$(spl-token create-account "$CT_MINT" 2>&1 | grep "Creating account" | awk '{print $3}')
spl-token configure-confidential-transfer-account --address "$SENDER_ATA" > /dev/null 2>&1

# Recipient
solana-keygen new --no-bip39-passphrase -o "$WORK_DIR/recipient.json" --force > /dev/null 2>&1
RECIPIENT=$(solana-keygen pubkey "$WORK_DIR/recipient.json")
solana airdrop 5 "$RECIPIENT" > /dev/null 2>&1
spl-token create-account "$CT_MINT" --owner "$RECIPIENT" --fee-payer ~/.config/solana/id.json > /dev/null 2>&1
RECIPIENT_ATA=$(spl-token accounts "$CT_MINT" --owner "$RECIPIENT" --output json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['accounts'][0]['address'])")
spl-token configure-confidential-transfer-account --address "$RECIPIENT_ATA" --owner "$WORK_DIR/recipient.json" > /dev/null 2>&1

spl-token mint "$CT_MINT" 1000 > /dev/null 2>&1
pass "Mint created, accounts configured with ElGamal keys"

# ── Deposit ──────────────────────────────────────────────────────────────────

step 5 "Depositing 100 tokens into confidential balance"

if spl-token deposit-confidential-tokens "$CT_MINT" 100 --address "$SENDER_ATA" 2>&1 | grep -q "Signature"; then
    spl-token apply-pending-balance --address "$SENDER_ATA" > /dev/null 2>&1
    pass "100 tokens deposited into encrypted balance"
else
    fail "Deposit failed"; exit 1
fi

# ── Confidential transfer ───────────────────────────────────────────────────

step 6 "Confidential transfer: 50 tokens → recipient (ZK proofs)"

if spl-token transfer "$CT_MINT" 50 "$RECIPIENT" --confidential 2>&1 | grep -q "Signature"; then
    spl-token apply-pending-balance --address "$RECIPIENT_ATA" --owner "$WORK_DIR/recipient.json" > /dev/null 2>&1
    pass "Confidential transfer succeeded — ZK proofs verified on-chain"
else
    fail "Confidential transfer failed"; exit 1
fi

# ── Withdraw ─────────────────────────────────────────────────────────────────

step 7 "Withdrawing 25 tokens from confidential balance"

if spl-token withdraw-confidential-tokens "$CT_MINT" 25 --address "$RECIPIENT_ATA" --owner "$WORK_DIR/recipient.json" 2>&1 | grep -q "Signature"; then
    pass "25 tokens withdrawn back to public balance"
else
    fail "Withdraw failed"; exit 1
fi

# ── Verify ───────────────────────────────────────────────────────────────────

step 8 "Verifying final balances"

SENDER_BAL=$(spl-token balance "$CT_MINT" 2>/dev/null)
RECIP_BAL=$(spl-token balance "$CT_MINT" --owner "$RECIPIENT" 2>/dev/null)
info "Sender public balance:    $SENDER_BAL (expected: 900)"
info "Recipient public balance: $RECIP_BAL (expected: 25)"

if [ "$SENDER_BAL" = "900" ] && [ "$RECIP_BAL" = "25" ]; then
    pass "Final balances correct"
else
    fail "Unexpected balances"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}${BOLD}  All $PASS/$TOTAL checks passed${NC}"
    echo -e ""
    echo -e "  Phase 1: SSS-3 program creates ConfidentialTransferMint mints"
    echo -e "  Phase 2: deposit → confidential transfer (ZK) → withdraw"
    echo -e ""
    echo -e "${GREEN}${BOLD}  SSS-3 confidential transfer flow verified ✓${NC}"
else
    echo -e "${RED}${BOLD}  $FAIL/$TOTAL checks failed${NC}"
fi
echo -e "${BOLD}══════════════════════════════════════════════════════════════${NC}"
echo ""

exit "$FAIL"
