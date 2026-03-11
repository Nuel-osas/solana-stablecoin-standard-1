import express from "express";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";

const app = express();
app.use(express.json());

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID_STR = process.env.PROGRAM_ID || "BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq";
const STABLECOIN_MINT_STR = process.env.STABLECOIN_MINT;
const OPERATOR_KEYPAIR_PATH = process.env.OPERATOR_KEYPAIR || "";
const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH || "./audit.log";
const API_KEY = process.env.API_KEY || "";
const EVENTS_STORE_PATH = process.env.EVENTS_STORE_PATH || "./events.ndjson";

const connection = new Connection(RPC_URL, "confirmed");
const programId = new PublicKey(PROGRAM_ID_STR);

// Load IDL from file
let idl: any;
try {
  const idlPath = path.resolve(__dirname, "../../target/idl/sss_token.json");
  idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
} catch {
  idl = null;
}

// ============ Operator Setup ============

let operatorKeypair: Keypair | null = null;
let program: anchor.Program | null = null;

function loadOperator(): void {
  if (!OPERATOR_KEYPAIR_PATH) return;
  try {
    const resolved = OPERATOR_KEYPAIR_PATH.startsWith("~")
      ? path.join(process.env.HOME || "", OPERATOR_KEYPAIR_PATH.slice(1))
      : OPERATOR_KEYPAIR_PATH;
    const secretKey = JSON.parse(fs.readFileSync(resolved, "utf-8"));
    operatorKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));

    if (idl) {
      const wallet = new anchor.Wallet(operatorKeypair);
      const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
      });
      const programIdl = { ...idl, address: programId.toBase58() };
      program = new anchor.Program(programIdl as anchor.Idl, provider);
    }

    console.log(`Operator loaded: ${operatorKeypair.publicKey.toBase58()}`);
  } catch (e: any) {
    console.warn(`Failed to load operator keypair: ${e.message}`);
  }
}

loadOperator();

function requireOperator(res: express.Response): boolean {
  if (!operatorKeypair || !program) {
    res.status(503).json({
      error: "Operator keypair not configured. Set OPERATOR_KEYPAIR env var.",
    });
    return false;
  }
  return true;
}

function requireMint(res: express.Response): PublicKey | null {
  if (!STABLECOIN_MINT_STR) {
    res.status(400).json({ error: "STABLECOIN_MINT environment variable not set" });
    return null;
  }
  return new PublicKey(STABLECOIN_MINT_STR);
}

// ============ Authentication Middleware ============

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  // If no API_KEY is configured, auth is disabled (development mode)
  if (!API_KEY) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer <API_KEY>" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== API_KEY) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  next();
}

// ============ PDA Derivation ============

function findStablecoinPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin"), mint.toBuffer()],
    programId
  );
}

function findBlacklistPDA(stablecoin: PublicKey, address: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("blacklist"), stablecoin.toBuffer(), address.toBuffer()],
    programId
  );
}

function findRolePDA(stablecoin: PublicKey, role: string, assignee: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("role"), stablecoin.toBuffer(), Buffer.from(role), assignee.toBuffer()],
    programId
  );
}

function findMinterInfoPDA(stablecoin: PublicKey, minter: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("minter_info"), stablecoin.toBuffer(), minter.toBuffer()],
    programId
  );
}

// ============ Audit Log (durable: rehydrated from disk on startup) ============

interface AuditEntry {
  timestamp: string;
  action: string;
  status: "success" | "failed";
  reference?: string;
  signature?: string;
  error?: string;
  details: Record<string, any>;
}

let auditLog: AuditEntry[] = [];

/** Load existing audit entries from disk on startup */
function loadAuditLog(): void {
  try {
    if (fs.existsSync(AUDIT_LOG_PATH)) {
      const content = fs.readFileSync(AUDIT_LOG_PATH, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      auditLog = lines.map((line) => JSON.parse(line));
      console.log(`Loaded ${auditLog.length} audit entries from ${AUDIT_LOG_PATH}`);
    }
  } catch (e: any) {
    console.warn(`Failed to load audit log from disk: ${e.message}`);
    auditLog = [];
  }
}

loadAuditLog();

function logAudit(entry: AuditEntry): void {
  auditLog.push(entry);
  const line = JSON.stringify(entry);
  console.log(`[AUDIT] ${line}`);
  try {
    fs.appendFileSync(AUDIT_LOG_PATH, line + "\n");
  } catch {
    // Non-fatal
  }
  // Fire webhooks for this action
  dispatchWebhooks(entry);
}

// ============ Webhook Service (with delivery + retry) ============

interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  createdAt: string;
}

const WEBHOOK_STORE_PATH = process.env.WEBHOOK_STORE_PATH || "./webhooks.json";
let webhooks: Webhook[] = [];

function loadWebhooks(): void {
  try {
    if (fs.existsSync(WEBHOOK_STORE_PATH)) {
      webhooks = JSON.parse(fs.readFileSync(WEBHOOK_STORE_PATH, "utf-8"));
      console.log(`Loaded ${webhooks.length} webhooks from ${WEBHOOK_STORE_PATH}`);
    }
  } catch {
    webhooks = [];
  }
}

function saveWebhooks(): void {
  try {
    fs.writeFileSync(WEBHOOK_STORE_PATH, JSON.stringify(webhooks, null, 2));
  } catch {
    // Non-fatal
  }
}

loadWebhooks();

/** Deliver a webhook payload with retry (up to 3 attempts, exponential backoff) */
async function deliverWebhook(webhook: Webhook, payload: any): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", webhook.secret)
    .update(body)
    .digest("hex");

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const url = new URL(webhook.url);
        const transport = url.protocol === "https:" ? https : http;
        const req = transport.request(
          url,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-SSS-Signature": signature,
              "X-SSS-Delivery": `${Date.now()}`,
            },
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
            res.resume(); // drain response
          }
        );
        req.on("error", reject);
        req.setTimeout(10000, () => {
          req.destroy(new Error("Webhook delivery timeout"));
        });
        req.write(body);
        req.end();
      });
      return; // Success
    } catch (e: any) {
      console.warn(`Webhook ${webhook.id} delivery attempt ${attempt}/3 failed: ${e.message}`);
      if (attempt < 3) {
        // Exponential backoff: 1s, 2s
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
  console.error(`Webhook ${webhook.id} delivery failed after 3 attempts to ${webhook.url}`);
}

/** Dispatch an audit event to all matching webhooks */
function dispatchWebhooks(entry: AuditEntry): void {
  for (const wh of webhooks) {
    if (wh.events.includes(entry.action) || wh.events.includes("*")) {
      // Fire and forget (don't block the API response)
      deliverWebhook(wh, {
        event: entry.action,
        timestamp: entry.timestamp,
        data: entry,
      }).catch(() => {});
    }
  }
}

// ============ Health ============

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    operator: operatorKeypair ? operatorKeypair.publicKey.toBase58() : "not configured",
    mint: STABLECOIN_MINT_STR ?? "not set",
    programId: programId.toBase58(),
    authEnabled: !!API_KEY,
  });
});

// ============ Read Endpoints (no auth required) ============

app.get("/api/v1/supply", async (_req, res) => {
  try {
    const mint = requireMint(res);
    if (!mint) return;

    const supplyResponse = await connection.getTokenSupply(mint);
    const supply = supplyResponse.value;

    res.json({
      amount: supply.amount,
      decimals: supply.decimals,
      uiAmount: supply.uiAmount,
      uiAmountString: supply.uiAmountString,
      mint: mint.toBase58(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/compliance/blacklist/:address", async (req, res) => {
  try {
    const mint = requireMint(res);
    if (!mint) return;

    const addressKey = new PublicKey(req.params.address);
    const [stablecoinPDA] = findStablecoinPDA(mint);
    const [blacklistPDA] = findBlacklistPDA(stablecoinPDA, addressKey);

    const accountInfo = await connection.getAccountInfo(blacklistPDA);
    const blacklisted = accountInfo !== null;

    res.json({
      address: req.params.address,
      blacklisted,
      blacklistPDA: blacklistPDA.toBase58(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/events", async (req, res) => {
  try {
    const { type, limit = "50", offset = "0" } = req.query;
    const limitNum = Math.min(Number(limit), 1000);
    const offsetNum = Number(offset);

    // Read indexed events from the shared NDJSON file written by the indexer
    let indexedEvents: any[] = [];
    try {
      if (fs.existsSync(EVENTS_STORE_PATH)) {
        const content = fs.readFileSync(EVENTS_STORE_PATH, "utf-8");
        indexedEvents = content
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .map((line) => JSON.parse(line));
      }
    } catch {
      // Fall through to on-chain fallback
    }

    if (indexedEvents.length > 0) {
      // Serve classified events from the indexer
      let filtered = indexedEvents;
      if (type) {
        filtered = filtered.filter((e: any) => e.type === type);
      }
      // Most recent first
      filtered.reverse();
      const total = filtered.length;
      const paged = filtered.slice(offsetNum, offsetNum + limitNum);
      res.json({
        source: "indexer",
        events: paged,
        total,
        limit: limitNum,
        offset: offsetNum,
        programId: programId.toBase58(),
      });
    } else {
      // Fallback: query on-chain signatures directly
      const totalToFetch = limitNum + offsetNum;
      const signatures = await connection.getSignaturesForAddress(programId, {
        limit: totalToFetch,
      });
      const paged = signatures.slice(offsetNum, offsetNum + limitNum);
      const events = paged.map((sig) => ({
        type: "transaction",
        signature: sig.signature,
        slot: sig.slot,
        blockTime: sig.blockTime,
        err: sig.err,
      }));
      res.json({
        source: "on-chain",
        events,
        total: signatures.length,
        limit: limitNum,
        offset: offsetNum,
        programId: programId.toBase58(),
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/audit-log", (req, res) => {
  const { action, limit = "50", offset = "0" } = req.query;
  let entries = auditLog;
  if (action) {
    entries = entries.filter((e) => e.action === action);
  }
  const limitNum = Number(limit);
  const offsetNum = Number(offset);
  const paged = entries.slice(offsetNum, offsetNum + limitNum);
  res.json({ entries: paged, total: entries.length, limit: limitNum, offset: offsetNum });
});

// ============ Write Endpoints (auth required, request -> verify -> execute -> log) ============

// Mint
app.post("/api/v1/mint", authMiddleware, async (req, res) => {
  const reference = req.body.reference || `mint_${Date.now()}`;
  try {
    const { recipient, amount } = req.body;
    if (!recipient || !amount) {
      return res.status(400).json({ error: "recipient and amount are required" });
    }
    const mint = requireMint(res);
    if (!mint) return;
    if (!requireOperator(res)) return;

    const recipientKey = new PublicKey(recipient);
    const [stablecoinPDA] = findStablecoinPDA(mint);
    const [rolePDA] = findRolePDA(stablecoinPDA, "minter", operatorKeypair!.publicKey);
    const [minterInfoPDA] = findMinterInfoPDA(stablecoinPDA, operatorKeypair!.publicKey);
    const recipientATA = getAssociatedTokenAddressSync(
      mint, recipientKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const txSig = await program!.methods
      .mintTokens(new anchor.BN(String(amount)))
      .accounts({
        minter: operatorKeypair!.publicKey,
        stablecoin: stablecoinPDA,
        mint,
        roleAssignment: rolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([operatorKeypair!])
      .rpc();

    logAudit({
      timestamp: new Date().toISOString(),
      action: "mint",
      status: "success",
      reference,
      signature: txSig,
      details: { recipient, amount: String(amount), recipientATA: recipientATA.toBase58() },
    });

    res.json({ status: "executed", reference, signature: txSig });
  } catch (error: any) {
    logAudit({
      timestamp: new Date().toISOString(),
      action: "mint",
      status: "failed",
      reference,
      error: error.message,
      details: { recipient: req.body.recipient, amount: req.body.amount },
    });
    res.status(500).json({ error: error.message, reference });
  }
});

// Burn
app.post("/api/v1/burn", authMiddleware, async (req, res) => {
  const reference = req.body.reference || `burn_${Date.now()}`;
  try {
    const { amount, from } = req.body;
    if (!amount) {
      return res.status(400).json({ error: "amount is required" });
    }
    const mint = requireMint(res);
    if (!mint) return;
    if (!requireOperator(res)) return;

    const [stablecoinPDA] = findStablecoinPDA(mint);
    const [rolePDA] = findRolePDA(stablecoinPDA, "burner", operatorKeypair!.publicKey);
    const tokenAccount = from
      ? new PublicKey(from)
      : getAssociatedTokenAddressSync(
          mint, operatorKeypair!.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        );

    const txSig = await program!.methods
      .burnTokens(new anchor.BN(String(amount)))
      .accounts({
        burner: operatorKeypair!.publicKey,
        stablecoin: stablecoinPDA,
        mint,
        roleAssignment: rolePDA,
        burnFrom: tokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([operatorKeypair!])
      .rpc();

    logAudit({
      timestamp: new Date().toISOString(),
      action: "burn",
      status: "success",
      reference,
      signature: txSig,
      details: { amount: String(amount), from: tokenAccount.toBase58() },
    });

    res.json({ status: "executed", reference, signature: txSig });
  } catch (error: any) {
    logAudit({
      timestamp: new Date().toISOString(),
      action: "burn",
      status: "failed",
      reference,
      error: error.message,
      details: { amount: req.body.amount },
    });
    res.status(500).json({ error: error.message, reference });
  }
});

// Blacklist add
app.post("/api/v1/compliance/blacklist", authMiddleware, async (req, res) => {
  const reference = req.body.reference || `blacklist_add_${Date.now()}`;
  try {
    const { address, reason } = req.body;
    if (!address || !reason) {
      return res.status(400).json({ error: "address and reason are required" });
    }
    const mint = requireMint(res);
    if (!mint) return;
    if (!requireOperator(res)) return;

    const addressKey = new PublicKey(address);
    const [stablecoinPDA] = findStablecoinPDA(mint);
    const [blacklistPDA] = findBlacklistPDA(stablecoinPDA, addressKey);
    const [rolePDA] = findRolePDA(stablecoinPDA, "blacklister", operatorKeypair!.publicKey);

    const txSig = await program!.methods
      .addToBlacklist(addressKey, reason)
      .accounts({
        blacklister: operatorKeypair!.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: rolePDA,
        blacklistEntry: blacklistPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([operatorKeypair!])
      .rpc();

    logAudit({
      timestamp: new Date().toISOString(),
      action: "blacklist_add",
      status: "success",
      reference,
      signature: txSig,
      details: { address, reason },
    });

    res.json({ status: "executed", reference, signature: txSig });
  } catch (error: any) {
    logAudit({
      timestamp: new Date().toISOString(),
      action: "blacklist_add",
      status: "failed",
      reference,
      error: error.message,
      details: { address: req.body.address, reason: req.body.reason },
    });
    res.status(500).json({ error: error.message, reference });
  }
});

// Blacklist remove
app.delete("/api/v1/compliance/blacklist/:address", authMiddleware, async (req, res) => {
  const reference = `blacklist_remove_${Date.now()}`;
  try {
    const mint = requireMint(res);
    if (!mint) return;
    if (!requireOperator(res)) return;

    const addressKey = new PublicKey(req.params.address);
    const [stablecoinPDA] = findStablecoinPDA(mint);
    const [blacklistPDA] = findBlacklistPDA(stablecoinPDA, addressKey);
    const [rolePDA] = findRolePDA(stablecoinPDA, "blacklister", operatorKeypair!.publicKey);

    const txSig = await program!.methods
      .removeFromBlacklist(addressKey)
      .accounts({
        blacklister: operatorKeypair!.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: rolePDA,
        blacklistEntry: blacklistPDA,
      })
      .signers([operatorKeypair!])
      .rpc();

    logAudit({
      timestamp: new Date().toISOString(),
      action: "blacklist_remove",
      status: "success",
      reference,
      signature: txSig,
      details: { address: req.params.address },
    });

    res.json({ status: "executed", reference, signature: txSig });
  } catch (error: any) {
    logAudit({
      timestamp: new Date().toISOString(),
      action: "blacklist_remove",
      status: "failed",
      reference,
      error: error.message,
      details: { address: req.params.address },
    });
    res.status(500).json({ error: error.message, reference });
  }
});

// Seize — fetches source token account owner for correct blacklist PDA derivation
app.post("/api/v1/compliance/seize", authMiddleware, async (req, res) => {
  const reference = req.body.reference || `seize_${Date.now()}`;
  try {
    const { from, treasury } = req.body;
    if (!from || !treasury) {
      return res.status(400).json({ error: "from (token account) and treasury (token account) are required" });
    }
    const mint = requireMint(res);
    if (!mint) return;
    if (!requireOperator(res)) return;

    const sourceAccount = new PublicKey(from);
    const treasuryAccount = new PublicKey(treasury);
    const [stablecoinPDA] = findStablecoinPDA(mint);
    const [rolePDA] = findRolePDA(stablecoinPDA, "seizer", operatorKeypair!.publicKey);

    // Fetch the source token account to extract the wallet owner for the blacklist PDA
    const sourceAccountInfo = await connection.getParsedAccountInfo(sourceAccount);
    if (!sourceAccountInfo.value) {
      return res.status(400).json({ error: "Source token account not found on-chain" });
    }
    const parsedData = (sourceAccountInfo.value.data as any)?.parsed;
    if (!parsedData?.info?.owner) {
      return res.status(400).json({ error: "Could not parse owner from source token account" });
    }
    const sourceOwner = new PublicKey(parsedData.info.owner);
    const [blacklistPDA] = findBlacklistPDA(stablecoinPDA, sourceOwner);

    const txSig = await program!.methods
      .seize()
      .accounts({
        seizer: operatorKeypair!.publicKey,
        stablecoin: stablecoinPDA,
        mint,
        roleAssignment: rolePDA,
        blacklistEntry: blacklistPDA,
        sourceAccount,
        treasuryAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([operatorKeypair!])
      .rpc();

    logAudit({
      timestamp: new Date().toISOString(),
      action: "seize",
      status: "success",
      reference,
      signature: txSig,
      details: { from, treasury, sourceOwner: sourceOwner.toBase58() },
    });

    res.json({ status: "executed", reference, signature: txSig });
  } catch (error: any) {
    logAudit({
      timestamp: new Date().toISOString(),
      action: "seize",
      status: "failed",
      reference,
      error: error.message,
      details: { from: req.body.from, treasury: req.body.treasury },
    });
    res.status(500).json({ error: error.message, reference });
  }
});

// ============ Webhook Management (auth required, persisted to disk) ============

app.post("/api/v1/webhooks", authMiddleware, (req, res) => {
  const { url, events, secret } = req.body;
  if (!url || !events || !secret) {
    return res.status(400).json({ error: "url, events, and secret are required" });
  }
  const id = `wh_${Date.now()}`;
  webhooks.push({ id, url, events, secret, createdAt: new Date().toISOString() });
  saveWebhooks();
  res.json({ id });
});

app.get("/api/v1/webhooks", authMiddleware, (_req, res) => {
  res.json({ webhooks: webhooks.map(w => ({ id: w.id, url: w.url, events: w.events })) });
});

app.delete("/api/v1/webhooks/:id", authMiddleware, (req, res) => {
  const idx = webhooks.findIndex(w => w.id === req.params.id);
  if (idx >= 0) {
    webhooks.splice(idx, 1);
    saveWebhooks();
  }
  res.json({ deleted: idx >= 0 });
});

export default app;
