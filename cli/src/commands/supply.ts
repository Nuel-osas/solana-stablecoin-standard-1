import { Command } from "commander";
import {
  BN,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  requireMint,
} from "./shared";

export function registerSupplyCommands(cli: Command): void {
  cli
    .command("supply")
    .description("Get total supply")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const mint = requireMint(opts);

        console.log(`\nFetching total supply for mint: ${mint.toBase58()}`);

        const supply = await connection.getTokenSupply(mint);

        console.log(`\n  Total Supply: ${supply.value.uiAmountString}`);
        console.log(`  Raw Amount: ${supply.value.amount}`);
        console.log(`  Decimals: ${supply.value.decimals}`);
      } catch (err: any) {
        console.error(`\nError fetching supply: ${err.message}`);
        process.exit(1);
      }
    });

  cli
    .command("set-supply-cap")
    .description("Set or update the supply cap (0 = unlimited)")
    .requiredOption("--cap <amount>", "New supply cap (raw amount, 0 = unlimited)")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const cap = new BN(opts.cap);

        console.log(`\nSetting supply cap for mint: ${mint.toBase58()}`);
        console.log(`  New cap: ${cap.toString() === "0" ? "Unlimited" : cap.toString()}`);

        const tx = await program.methods
          .setSupplyCap(cap)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
          })
          .rpc();

        console.log(`\n  Supply cap updated successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError setting supply cap: ${err.message}`);
        process.exit(1);
      }
    });
}
