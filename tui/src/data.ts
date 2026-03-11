import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import * as crypto from "crypto";

// ── Types ────────────────────────────────────────────────────────────────

export interface StablecoinStateData {
  authority: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
  paused: boolean;
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
  defaultAccountFrozen: boolean;
  enableAllowlist: boolean;
  totalMinted: anchor.BN;
  totalBurned: anchor.BN;
  supplyCap: anchor.BN | null;
  pendingAuthority: PublicKey | null;
  bump: number;
}

export interface SupplyInfo {
  currentSupply: string;
  totalMinted: string;
  totalBurned: string;
  supplyCap: string;
  decimals: number;
}

export interface LogEvent {
  type: string;
  signature: string;
  timestamp: number;
}

// ── Known Anchor event discriminators ────────────────────────────────────

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

const EVENT_DISCRIMINATORS: Record<string, string> = {};

for (const eventName of KNOWN_EVENTS) {
  const hash = crypto.createHash("sha256").update(`event:${eventName}`).digest();
  const disc = hash.subarray(0, 8).toString("hex");
  EVENT_DISCRIMINATORS[disc] = eventName;
}

// ── Data fetchers ────────────────────────────────────────────────────────

export async function fetchStablecoinState(
  program: anchor.Program,
  stablecoinPDA: PublicKey
): Promise<StablecoinStateData | null> {
  try {
    const account = await (program.account as any).stablecoin.fetch(stablecoinPDA);
    return account as StablecoinStateData;
  } catch {
    return null;
  }
}

export async function fetchSupplyInfo(
  connection: Connection,
  mint: PublicKey,
  state: StablecoinStateData | null
): Promise<SupplyInfo> {
  const decimals = state?.decimals ?? 6;
  const fmt = (val: anchor.BN | null | undefined): string => {
    if (!val) return "0";
    const n = Number(val.toString()) / Math.pow(10, decimals);
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals,
    });
  };

  const minted = state?.totalMinted ?? new anchor.BN(0);
  const burned = state?.totalBurned ?? new anchor.BN(0);
  const current = minted.sub(burned);

  return {
    currentSupply: fmt(current),
    totalMinted: fmt(minted),
    totalBurned: fmt(burned),
    supplyCap: state?.supplyCap ? fmt(state.supplyCap) : "Unlimited",
    decimals,
  };
}

export function detectPreset(state: StablecoinStateData): string {
  if (state.enableAllowlist) return "SSS-3 (Private)";
  if (state.enablePermanentDelegate || state.enableTransferHook)
    return "SSS-2 (Compliant)";
  return "SSS-1 (Minimal)";
}

// ── Oracle ───────────────────────────────────────────────────────────────

export interface OraclePriceData {
  feed: string;
  price: number;
  confidence: number;
  deviation: string;
  deviationPct: string;
  isDepegged: boolean;
  publishTime: string;
}

const ORACLE_FEED_IDS: Record<string, string> = {
  usdc: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  usdt: "2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  sol: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

export function resolveFeedId(feed: string): string {
  const lower = feed.toLowerCase();
  if (lower in ORACLE_FEED_IDS) return ORACLE_FEED_IDS[lower];
  return feed.replace(/^0x/, "");
}

export async function fetchOraclePrice(feed: string): Promise<OraclePriceData | null> {
  try {
    const feedId = resolveFeedId(feed);
    const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (!json.parsed || json.parsed.length === 0) return null;
    const p = json.parsed[0].price;
    const price = Number(p.price) * Math.pow(10, p.expo);
    const confidence = Number(p.conf) * Math.pow(10, p.expo);
    const deviation = Math.abs(price - 1.0);
    const isSol = feed.toLowerCase() === "sol";
    return {
      feed: feed.toUpperCase(),
      price,
      confidence,
      deviation: isSol ? "N/A" : `$${deviation.toFixed(6)}`,
      deviationPct: isSol ? "N/A" : `${(deviation * 100).toFixed(4)}%`,
      isDepegged: !isSol && deviation >= 0.01,
      publishTime: new Date(p.publish_time * 1000).toLocaleTimeString(),
    };
  } catch {
    return null;
  }
}

export function subscribeToEvents(
  connection: Connection,
  programId: PublicKey,
  callback: (event: LogEvent) => void
): number {
  return connection.onLogs(
    programId,
    (logs) => {
      const { signature, logs: logMessages } = logs;

      for (const log of logMessages) {
        if (log.startsWith("Program data: ")) {
          try {
            const data = log.replace("Program data: ", "");
            const buffer = Buffer.from(data, "base64");
            if (buffer.length < 8) continue;

            const disc = buffer.subarray(0, 8).toString("hex");
            const eventType = EVENT_DISCRIMINATORS[disc] ?? "Unknown";

            callback({
              type: eventType,
              signature,
              timestamp: Date.now(),
            });
          } catch {
            // skip
          }
        }
      }
    },
    "confirmed"
  );
}
