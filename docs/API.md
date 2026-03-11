# Backend API Reference

## Overview

The backend provides REST APIs for stablecoin lifecycle management, event indexing, and compliance operations. All write endpoints execute real on-chain transactions via a configured operator keypair.

## Endpoints

### Health

```
GET /health

Response:
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00Z",
  "operator": "<pubkey>",
  "mint": "<mint_address>",
  "programId": "<program_id>",
  "authEnabled": true
}
```

### Mint/Burn Service

Write endpoints follow a **request → verify → execute → log** lifecycle:
1. **Request** — Validate input and parse addresses
2. **Verify** — Derive PDAs, resolve token account owners
3. **Execute** — Build and submit the Anchor transaction on-chain
4. **Log** — Record the result (success or failure) to the durable audit log and dispatch webhooks

```
POST /api/v1/mint
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "recipient": "<wallet_pubkey>",
  "amount": 1000000,
  "reference": "mint-request-001"
}

Response:
{
  "status": "executed",
  "reference": "mint-request-001",
  "signature": "<tx_signature>"
}
```

```
POST /api/v1/burn
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "amount": 500000,
  "from": "<token_account>",
  "reference": "burn-request-001"
}
```

### Supply

```
GET /api/v1/supply

Response:
{
  "amount": "10000000000",
  "decimals": 6,
  "uiAmount": 10000.0,
  "uiAmountString": "10000",
  "mint": "<mint_address>"
}
```

### Compliance (SSS-2)

```
POST /api/v1/compliance/blacklist
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "address": "<wallet_pubkey>",
  "reason": "OFAC SDN match",
  "reference": "compliance-001"
}
```

```
DELETE /api/v1/compliance/blacklist/:address
Authorization: Bearer <API_KEY>
```

```
GET /api/v1/compliance/blacklist/:address

Response:
{
  "address": "<pubkey>",
  "blacklisted": true,
  "blacklistPDA": "<pda_address>"
}
```

```
POST /api/v1/compliance/seize
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "from": "<source_token_account>",
  "treasury": "<treasury_token_account>",
  "reference": "seize-001"
}
```

Note: The `from` field is a **token account** address. The backend fetches this account on-chain to extract the wallet owner for correct blacklist PDA derivation.

### Events

When the indexer is running, events are classified by type. Use the `type` query parameter to filter.

```
GET /api/v1/events?type=TokensMinted&limit=50&offset=0

Response (indexed events available):
{
  "source": "indexer",
  "events": [
    {
      "type": "TokensMinted",
      "data": "<base64>",
      "signature": "<tx>",
      "slot": 0,
      "timestamp": 1704067200000
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0,
  "programId": "<program_id>"
}

Response (fallback — no indexed events yet):
{
  "source": "on-chain",
  "events": [
    {
      "type": "transaction",
      "signature": "<tx>",
      "slot": 12345,
      "blockTime": 1704067200,
      "err": null
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0,
  "programId": "<program_id>"
}
```

Supported event types (from the on-chain program): `StablecoinInitialized`, `TokensMinted`, `TokensBurned`, `AccountFrozen`, `AccountThawed`, `Paused`, `Unpaused`, `RoleAssigned`, `RoleRevoked`, `AuthorityTransferred`, `BlacklistAdded`, `BlacklistRemoved`, `TokensSeized`.

### Audit Log

The audit log is **durable** — entries are appended to disk and rehydrated on restart.

```
GET /api/v1/audit-log?action=mint&limit=50&offset=0

Response:
{
  "entries": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "action": "mint",
      "status": "success",
      "reference": "mint-request-001",
      "signature": "<tx_signature>",
      "details": { "recipient": "<pubkey>", "amount": "1000000" }
    }
  ],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

### Webhooks

Webhooks are persisted to disk and deliver payloads via HTTP POST with HMAC-SHA256 signatures and retry logic (3 attempts, exponential backoff).

```
POST /api/v1/webhooks
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "url": "https://your-service.com/webhook",
  "events": ["mint", "burn", "blacklist_add", "seize"],
  "secret": "your-webhook-secret"
}
```

```
GET /api/v1/webhooks
Authorization: Bearer <API_KEY>

DELETE /api/v1/webhooks/:id
Authorization: Bearer <API_KEY>
```

Webhook payload format:
```json
{
  "event": "mint",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": { ... }
}
```

The `X-SSS-Signature` header contains the HMAC-SHA256 of the request body using the webhook secret.

## Authentication

All mutating endpoints require an API key via the `Authorization` header:

```
Authorization: Bearer <API_KEY>
```

Set the `API_KEY` environment variable to enable authentication. When not set, auth is disabled (development mode).

Read endpoints (supply, blacklist check, events, audit log) do not require authentication.

## Docker

```bash
cd backend/docker
docker compose up

# If your Docker install exposes the legacy binary instead:
docker-compose up

# Smoke test the stack after startup:
./smoke-test.sh

# Services:
# - API server: http://localhost:3000
# - Event indexer: runs as background worker
# - Health check: http://localhost:3000/health
```

The Docker build context is the repo root, so run from `backend/docker/`.

## Environment Variables

```env
# Required
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq
STABLECOIN_MINT=<mint_address>

# Operator (required for write endpoints)
OPERATOR_KEYPAIR=/path/to/keypair.json

# Authentication (optional, disabled if not set)
API_KEY=your-secret-api-key

# Logging
AUDIT_LOG_PATH=./audit.log
WEBHOOK_STORE_PATH=./webhooks.json
EVENTS_STORE_PATH=./events.ndjson
PORT=3000
LOG_LEVEL=info
```
