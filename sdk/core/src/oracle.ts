/**
 * Oracle module — Pyth Hermes HTTP integration for stablecoin price feeds.
 * Uses native fetch (Node 18+), no extra dependencies.
 */

// Pyth Hermes price feed IDs (hex-encoded, without 0x prefix)
// Source: https://pyth.network/developers/price-feed-ids
export const PRICE_FEED_IDS = {
  "usdc": "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  "usdt": "2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  "sol":  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
} as const;

export type FeedAlias = keyof typeof PRICE_FEED_IDS;

const HERMES_BASE_URL = "https://hermes.pyth.network";

export interface PriceData {
  /** The feed ID used */
  feedId: string;
  /** Price as a floating-point number (e.g. 0.9998) */
  price: number;
  /** Confidence interval as a floating-point number */
  confidence: number;
  /** Exponent applied to the raw price integer */
  expo: number;
  /** Unix timestamp of the price update */
  publishTime: number;
}

export interface PegStatus {
  /** The feed ID used */
  feedId: string;
  /** Current price */
  price: number;
  /** Confidence interval */
  confidence: number;
  /** Absolute deviation from $1.00 (e.g. 0.0002 means price is $0.9998 or $1.0002) */
  deviation: number;
  /** Deviation as a percentage string (e.g. "0.02%") */
  deviationPercent: string;
  /** True if deviation exceeds the threshold (default 1%) */
  isDepegged: boolean;
  /** Unix timestamp of the price update */
  publishTime: number;
}

export class OracleModule {
  private baseUrl: string;

  constructor(hermesBaseUrl?: string) {
    this.baseUrl = hermesBaseUrl ?? HERMES_BASE_URL;
  }

  /**
   * Resolve a feed alias (e.g. "usdc") or pass through a raw hex feed ID.
   */
  resolveFeedId(feedOrAlias: string): string {
    const lower = feedOrAlias.toLowerCase() as FeedAlias;
    if (lower in PRICE_FEED_IDS) {
      return PRICE_FEED_IDS[lower];
    }
    // Treat as raw hex feed ID (strip optional 0x prefix)
    return feedOrAlias.replace(/^0x/, "");
  }

  /**
   * Fetch the latest price for a given Pyth price feed.
   * @param priceFeedId - Hex feed ID or alias ("usdc", "usdt", "sol")
   */
  async getPrice(priceFeedId: string): Promise<PriceData> {
    const feedId = this.resolveFeedId(priceFeedId);
    const url = `${this.baseUrl}/v2/updates/price/latest?ids[]=${feedId}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Pyth Hermes API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as any;

    if (!json.parsed || json.parsed.length === 0) {
      throw new Error(`No price data returned for feed ${feedId}`);
    }

    const parsed = json.parsed[0];
    const priceInfo = parsed.price;

    const price = Number(priceInfo.price) * Math.pow(10, priceInfo.expo);
    const confidence = Number(priceInfo.conf) * Math.pow(10, priceInfo.expo);

    return {
      feedId,
      price,
      confidence,
      expo: priceInfo.expo,
      publishTime: priceInfo.publish_time,
    };
  }

  /**
   * Get peg status for a stablecoin feed — measures deviation from $1.00.
   * @param feedId - Hex feed ID or alias ("usdc", "usdt")
   * @param depegThreshold - Deviation threshold to flag as depegged (default 0.01 = 1%)
   */
  async getPegStatus(feedId: string, depegThreshold: number = 0.01): Promise<PegStatus> {
    const priceData = await this.getPrice(feedId);
    const deviation = Math.abs(priceData.price - 1.0);
    const deviationPercent = (deviation * 100).toFixed(4) + "%";
    const isDepegged = deviation >= depegThreshold;

    return {
      feedId: priceData.feedId,
      price: priceData.price,
      confidence: priceData.confidence,
      deviation,
      deviationPercent,
      isDepegged,
      publishTime: priceData.publishTime,
    };
  }
}
