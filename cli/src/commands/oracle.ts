import { Command } from "commander";
import {
  c,
  anchor,
  SystemProgram,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  getOracleConfigPDA,
  requireMint,
  PublicKey,
} from "./shared";

const ORACLE_FEED_IDS: Record<string, string> = {
  "usdc": "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  "usdt": "2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  "sol":  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

function resolveOracleFeed(feed: string): string {
  const lower = feed.toLowerCase();
  if (lower in ORACLE_FEED_IDS) return ORACLE_FEED_IDS[lower];
  return feed.replace(/^0x/, "");
}

async function fetchPythPrice(feedId: string): Promise<{
  price: number;
  confidence: number;
  publishTime: number;
}> {
  const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pyth API error: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as any;
  if (!json.parsed || json.parsed.length === 0) throw new Error(`No price data for feed ${feedId}`);
  const p = json.parsed[0].price;
  return {
    price: Number(p.price) * Math.pow(10, p.expo),
    confidence: Number(p.conf) * Math.pow(10, p.expo),
    publishTime: p.publish_time,
  };
}

export function registerOracleCommands(cli: Command): void {
  cli
    .command("price")
    .description("Fetch current price from Pyth oracle")
    .requiredOption("--feed <name>", "Feed name (usdc, usdt, sol) or hex feed ID")
    .action(async (opts) => {
      try {
        const feedId = resolveOracleFeed(opts.feed);
        const label = opts.feed.toUpperCase();

        console.log(`\n${c.bold}Fetching ${label} price from Pyth oracle...${c.reset}\n`);

        const data = await fetchPythPrice(feedId);
        const time = new Date(data.publishTime * 1000).toISOString();

        console.log(`  ${c.cyan}Feed:${c.reset}       ${label} (${feedId.slice(0, 16)}...)`);
        console.log(`  ${c.cyan}Price:${c.reset}      ${c.bold}$${data.price.toFixed(6)}${c.reset}`);
        console.log(`  ${c.cyan}Confidence:${c.reset} \u00b1$${data.confidence.toFixed(6)}`);
        console.log(`  ${c.cyan}Updated:${c.reset}    ${time}`);
        console.log();
      } catch (err: any) {
        console.error(`\n${c.red}Error fetching price: ${err.message}${c.reset}`);
        process.exit(1);
      }
    });

  cli
    .command("peg-monitor")
    .description("Continuously monitor stablecoin peg status with depeg alerts")
    .requiredOption("--feed <name>", "Feed name (usdc, usdt) or hex feed ID")
    .option("--interval <seconds>", "Polling interval in seconds", "10")
    .option("--threshold <percent>", "Depeg alert threshold as percentage", "1")
    .action(async (opts) => {
      const feedId = resolveOracleFeed(opts.feed);
      const label = opts.feed.toUpperCase();
      const intervalSec = parseInt(opts.interval) || 10;
      const threshold = parseFloat(opts.threshold) / 100; // convert % to decimal

      console.log(`\n${c.bold}Peg Monitor: ${label}${c.reset}`);
      console.log(`  Feed:      ${feedId.slice(0, 16)}...`);
      console.log(`  Interval:  ${intervalSec}s`);
      console.log(`  Threshold: ${(threshold * 100).toFixed(2)}%`);
      console.log(`  ${c.dim}Press Ctrl+C to stop${c.reset}\n`);

      const poll = async () => {
        try {
          const data = await fetchPythPrice(feedId);
          const deviation = Math.abs(data.price - 1.0);
          const devPercent = (deviation * 100).toFixed(4);
          const isDepegged = deviation >= threshold;
          const time = new Date(data.publishTime * 1000).toLocaleTimeString();

          if (isDepegged) {
            console.log(
              `  ${c.bg.red}${c.white} DEPEG ${c.reset} ${time}  ` +
              `$${data.price.toFixed(6)}  ` +
              `${c.red}deviation: ${devPercent}%${c.reset}  ` +
              `conf: \u00b1$${data.confidence.toFixed(6)}`
            );
          } else {
            console.log(
              `  ${c.bg.green}${c.white}  PEG  ${c.reset} ${time}  ` +
              `$${data.price.toFixed(6)}  ` +
              `${c.green}deviation: ${devPercent}%${c.reset}  ` +
              `conf: \u00b1$${data.confidence.toFixed(6)}`
            );
          }
        } catch (err: any) {
          console.error(`  ${c.red}[error]${c.reset} ${err.message}`);
        }
      };

      // Initial poll
      await poll();

      // Continuous polling
      const timer = setInterval(poll, intervalSec * 1000);
      process.on("SIGINT", () => {
        clearInterval(timer);
        console.log(`\n${c.dim}Monitor stopped.${c.reset}`);
        process.exit(0);
      });
    });

  cli
    .command("configure-oracle")
    .description("Configure on-chain oracle price enforcement for mint/burn operations")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .requiredOption("--price-feed <address>", "Pyth price feed account address (on-chain)")
    .option("--max-deviation <bps>", "Maximum deviation from $1.00 in basis points", "100")
    .option("--max-staleness <secs>", "Maximum price staleness in seconds", "60")
    .option("--disable", "Disable oracle enforcement")
    .option("--keypair <path>", "Path to authority keypair JSON")
    .option("--cluster <url>", "Solana cluster URL", "https://api.devnet.solana.com")
    .action(async (opts) => {
      const keypairPath = opts.keypair || `${process.env.HOME}/.config/solana/id.json`;
      const authority = loadKeypair(keypairPath);
      const connection = getConnection(opts.cluster);
      const program = getProgram(connection, authority);

      const mint = requireMint(opts);
      const priceFeed = new PublicKey(opts.priceFeed);
      const maxDeviationBps = parseInt(opts.maxDeviation);
      const maxStalenessSecs = parseInt(opts.maxStaleness);
      const enabled = !opts.disable;

      const [stablecoinPDA] = getStablecoinPDA(mint);
      const [oracleConfigPDA] = getOracleConfigPDA(stablecoinPDA);

      console.log(`\n${c.bold}Configure Oracle${c.reset}`);
      console.log(`  Mint:           ${mint.toBase58()}`);
      console.log(`  Price Feed:     ${priceFeed.toBase58()}`);
      console.log(`  Max Deviation:  ${maxDeviationBps} bps (${(maxDeviationBps / 100).toFixed(2)}%)`);
      console.log(`  Max Staleness:  ${maxStalenessSecs}s`);
      console.log(`  Enabled:        ${enabled}`);
      console.log(`  Oracle PDA:     ${oracleConfigPDA.toBase58()}`);

      try {
        const txSig = await program.methods
          .configureOracle(priceFeed, maxDeviationBps, new anchor.BN(maxStalenessSecs), enabled)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            oracleConfig: oracleConfigPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();

        console.log(`\n  ${c.green}Oracle configured successfully!${c.reset}`);
        console.log(`  TX: ${txSig}`);
      } catch (err: any) {
        console.error(`\n  ${c.red}Error:${c.reset} ${err.message}`);
        process.exit(1);
      }
    });
}
