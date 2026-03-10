#!/usr/bin/env bash
#
# Smoke / integration test for the Dockerised API.
# Run from: backend/docker/
#
# Usage:
#   ./smoke-test.sh
#
set -euo pipefail

###############################################################################
# Config
###############################################################################
BASE_URL="http://localhost:3000"
STARTUP_TIMEOUT=60          # seconds to wait for the health endpoint
POLL_INTERVAL=2             # seconds between health polls
COMPOSE_FILE="docker-compose.yml"
PASS_COUNT=0
FAIL_COUNT=0
COMPOSE_CMD=()

###############################################################################
# Helpers
###############################################################################
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log()  { echo -e "${YELLOW}[smoke-test]${NC} $*"; }
pass() { echo -e "  ${GREEN}PASS${NC} $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

detect_compose() {
  if docker compose version &>/dev/null; then
    COMPOSE_CMD=(docker compose)
    return
  fi

  if command -v docker-compose &>/dev/null; then
    COMPOSE_CMD=(docker-compose)
    return
  fi

  echo "No Docker Compose command found. Install either the 'docker compose' plugin or 'docker-compose'." >&2
  exit 1
}

# Detect jq availability; fall back to grep-based checks.
HAS_JQ=false
if command -v jq &>/dev/null; then
  HAS_JQ=true
fi

json_field() {
  # json_field <json_string> <field>
  # Returns the value of a top-level field (simple scalar).
  local json="$1" field="$2"
  if $HAS_JQ; then
    echo "$json" | jq -r ".$field // empty" 2>/dev/null
  else
    # Crude fallback: extract "field": "value" or "field": value
    echo "$json" | sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^,\"}\]*\)\"\{0,1\}.*/\1/p" | head -1
  fi
}

json_has_field() {
  # json_has_field <json_string> <field>
  local json="$1" field="$2"
  if $HAS_JQ; then
    echo "$json" | jq -e "has(\"$field\")" &>/dev/null
  else
    echo "$json" | grep -q "\"$field\""
  fi
}

###############################################################################
# Cleanup on exit
###############################################################################
cleanup() {
  log "Tearing down containers ..."
  "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" down --volumes --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

###############################################################################
# Build & Start
###############################################################################
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
detect_compose

log "Building Docker images ..."
"${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" build

log "Starting containers in detached mode ..."
"${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" up -d

###############################################################################
# Wait for health endpoint
###############################################################################
log "Waiting up to ${STARTUP_TIMEOUT}s for ${BASE_URL}/health ..."
elapsed=0
while true; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" 2>/dev/null || true)
  if [ "$status" = "200" ]; then
    log "Health endpoint ready (${elapsed}s)."
    break
  fi
  if [ "$elapsed" -ge "$STARTUP_TIMEOUT" ]; then
    log "Timed out waiting for health endpoint after ${STARTUP_TIMEOUT}s."
    log "Container logs:"
    "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" logs --tail=40 api || true
    exit 1
  fi
  sleep "$POLL_INTERVAL"
  elapsed=$((elapsed + POLL_INTERVAL))
done

###############################################################################
# Smoke tests
###############################################################################
log "Running smoke tests ..."

# ---- 1. GET /health --------------------------------------------------------
log "Test: GET /health"
resp=$(curl -s "${BASE_URL}/health")
http_code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health")
status_val=$(json_field "$resp" "status")

if [ "$http_code" = "200" ] && [ "$status_val" = "ok" ]; then
  pass "GET /health -> 200, status=ok"
else
  fail "GET /health -> code=$http_code, status=$status_val (expected 200/ok)"
fi

# ---- 2. GET /api/v1/supply -------------------------------------------------
log "Test: GET /api/v1/supply"
http_code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/supply")
if [ "$http_code" = "200" ] || [ "$http_code" = "400" ] || [ "$http_code" = "500" ]; then
  pass "GET /api/v1/supply -> $http_code (endpoint responds)"
else
  fail "GET /api/v1/supply -> $http_code (endpoint unreachable)"
fi

# ---- 3. GET /api/v1/events -------------------------------------------------
log "Test: GET /api/v1/events"
resp=$(curl -s "${BASE_URL}/api/v1/events")
http_code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/events")
if [ "$http_code" = "200" ] || [ "$http_code" = "400" ]; then
  pass "GET /api/v1/events -> $http_code (endpoint responds)"
else
  fail "GET /api/v1/events -> $http_code (endpoint unreachable)"
fi

# ---- 4. GET /api/v1/audit-log ----------------------------------------------
log "Test: GET /api/v1/audit-log"
resp=$(curl -s "${BASE_URL}/api/v1/audit-log")
http_code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/audit-log")
if [ "$http_code" = "200" ]; then
  if json_has_field "$resp" "entries"; then
    pass "GET /api/v1/audit-log -> 200 with entries array"
  else
    fail "GET /api/v1/audit-log -> 200 but no 'entries' field in response"
  fi
else
  # Accept other codes as long as the endpoint responds
  if [ "$http_code" != "000" ]; then
    pass "GET /api/v1/audit-log -> $http_code (endpoint responds)"
  else
    fail "GET /api/v1/audit-log -> endpoint unreachable"
  fi
fi

# ---- 5. POST /api/v1/mint with missing body --------------------------------
log "Test: POST /api/v1/mint (no body)"
http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  "${BASE_URL}/api/v1/mint")
if [ "$http_code" = "400" ] || [ "$http_code" = "401" ] || [ "$http_code" = "422" ]; then
  pass "POST /api/v1/mint (no body) -> $http_code (rejected as expected)"
else
  fail "POST /api/v1/mint (no body) -> $http_code (expected 400/401/422)"
fi

# ---- 6. POST /api/v1/compliance/blacklist with missing body -----------------
log "Test: POST /api/v1/compliance/blacklist (no body)"
http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  "${BASE_URL}/api/v1/compliance/blacklist")
if [ "$http_code" = "400" ] || [ "$http_code" = "401" ] || [ "$http_code" = "422" ]; then
  pass "POST /api/v1/compliance/blacklist (no body) -> $http_code (rejected as expected)"
else
  fail "POST /api/v1/compliance/blacklist (no body) -> $http_code (expected 400/401/422)"
fi

###############################################################################
# Summary
###############################################################################
echo ""
log "=========================================="
log "Results: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
log "=========================================="

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
