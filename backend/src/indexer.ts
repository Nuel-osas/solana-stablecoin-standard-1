import { Connection, PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = process.env.PROGRAM_ID || "BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq";
const EVENTS_STORE_PATH = process.env.EVENTS_STORE_PATH || "./events.ndjson";

const connection = new Connection(RPC_URL, "confirmed");

// Known Anchor event discriminators (first 8 bytes of sha256("event:<EventName>"))
const EVENT_DISCRIMINATORS: Record<string, string> = {};

function computeEventDiscriminator(eventName: string): Buffer {
  const hash = crypto.createHash("sha256").update(`event:${eventName}`).digest();
  return hash.subarray(0, 8);
}

// Must match the #[event] struct names in programs/sss-token/src/events.rs
const KNOWN_EVENTS = [
  "StablecoinInitialized",
  "TokensMinted",
  "TokensBurned",
  "AccountFrozen",
  "AccountThawed",
  "Paused",
  "Unpaused",
  "RoleAssigned",
  "RoleRevoked",
  "AuthorityTransferred",
  "BlacklistAdded",
  "BlacklistRemoved",
  "TokensSeized",
];

for (const eventName of KNOWN_EVENTS) {
  const disc = computeEventDiscriminator(eventName);
  EVENT_DISCRIMINATORS[disc.toString("hex")] = eventName;
}

export interface IndexedEvent {
  type: string;
  data: string;
  signature: string;
  slot: number;
  timestamp: number;
}

function classifyEvent(base64Data: string): string {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length < 8) return "unknown";

    const discriminator = buffer.subarray(0, 8).toString("hex");
    return EVENT_DISCRIMINATORS[discriminator] ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Append an indexed event to the shared NDJSON file (readable by the API server) */
function persistEvent(event: IndexedEvent): void {
  try {
    fs.appendFileSync(EVENTS_STORE_PATH, JSON.stringify(event) + "\n");
  } catch {
    // Non-fatal
  }
}

async function startIndexer() {
  const programId = new PublicKey(PROGRAM_ID);
  console.log(`Starting event indexer for program: ${programId.toBase58()}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Events store: ${EVENTS_STORE_PATH}`);
  console.log(`Tracking ${KNOWN_EVENTS.length} event types`);

  let eventCount = 0;

  const subscriptionId = connection.onLogs(
    programId,
    (logs) => {
      const { signature, logs: logMessages } = logs;

      for (const log of logMessages) {
        if (log.startsWith("Program data: ")) {
          try {
            const data = log.replace("Program data: ", "");
            const eventType = classifyEvent(data);

            const event: IndexedEvent = {
              type: eventType,
              data,
              signature,
              slot: 0,
              timestamp: Date.now(),
            };

            console.log(`[${eventType}] tx ${signature}`);
            persistEvent(event);
            eventCount++;
          } catch {
            // Skip unparseable logs
          }
        }
      }
    },
    "confirmed"
  );

  console.log(`Subscribed to program logs (subscription: ${subscriptionId})`);
  console.log("Indexer running... Press Ctrl+C to stop.");

  process.on("SIGINT", () => {
    console.log(`\nStopping indexer. Indexed ${eventCount} events this session.`);
    connection.removeOnLogsListener(subscriptionId);
    process.exit(0);
  });
}

startIndexer().catch(console.error);
