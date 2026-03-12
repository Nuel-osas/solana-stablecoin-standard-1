import { Command } from "commander";
import {
  getConnection,
  getStablecoinPDA,
  requireMint,
} from "./shared";

export function registerHoldersCommands(cli: Command): void {
  cli
    .command("holders")
    .description("List token holders")
    .option("--min-balance <amount>", "Minimum balance filter", "0")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const mint = requireMint(opts);
        const minBalance = parseInt(opts.minBalance) || 0;

        console.log(`\nListing holders for mint: ${mint.toBase58()}`);

        const largestAccounts = await connection.getTokenLargestAccounts(mint);

        const holders = largestAccounts.value.filter(
          (acc) => parseInt(acc.amount) >= minBalance
        );

        if (holders.length === 0) {
          console.log("\n  No holders found.");
        } else {
          console.log(`\n  Found ${holders.length} holder(s):`);
          for (const holder of holders) {
            console.log(
              `    ${holder.address.toBase58()}: ${holder.uiAmountString} (raw: ${holder.amount})`
            );
          }
        }
      } catch (err: any) {
        console.error(`\nError listing holders: ${err.message}`);
        process.exit(1);
      }
    });

  cli
    .command("audit-log")
    .description("View audit log")
    .option("--action <type>", "Filter by action type")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--limit <count>", "Number of recent transactions to fetch", "20")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const mint = requireMint(opts);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const limit = parseInt(opts.limit) || 20;

        console.log(`\nFetching audit log for mint: ${mint.toBase58()}`);
        console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

        const signatures = await connection.getSignaturesForAddress(
          stablecoinPDA,
          { limit }
        );

        if (signatures.length === 0) {
          console.log("\n  No transactions found.");
        } else {
          console.log(`\n  Found ${signatures.length} transaction(s):`);
          for (const sig of signatures) {
            const time = sig.blockTime
              ? new Date(sig.blockTime * 1000).toISOString()
              : "unknown";
            const status = sig.err ? "FAILED" : "SUCCESS";
            console.log(`    [${time}] ${status} ${sig.signature}`);
            if (sig.memo) {
              console.log(`      Memo: ${sig.memo}`);
            }
          }
        }
      } catch (err: any) {
        console.error(`\nError fetching audit log: ${err.message}`);
        process.exit(1);
      }
    });
}
