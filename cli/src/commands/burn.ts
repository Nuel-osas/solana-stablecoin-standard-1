import { Command } from "commander";
import {
  PublicKey,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  getRolePDA,
  requireMint,
  parseAmount,
} from "./shared";

export function registerBurnCommands(cli: Command): void {
  cli
    .command("burn")
    .description("Burn tokens")
    .requiredOption("--amount <amount>", "Amount to burn (e.g. 500 or 1.5)")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--from <address>", "Token account to burn from (defaults to burner's ATA)")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Burner keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const burner = loadKeypair(opts.keypair);
        const program = getProgram(connection, burner);
        const mint = requireMint(opts);
        const amount = await parseAmount(opts.amount, mint, connection);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(stablecoinPDA, "burner", burner.publicKey);

        const burnFrom = opts.from
          ? new PublicKey(opts.from)
          : getAssociatedTokenAddressSync(
              mint,
              burner.publicKey,
              false,
              TOKEN_2022_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            );

        console.log(`\nBurning ${opts.amount} tokens`);
        console.log(`  Mint: ${mint.toBase58()}`);
        console.log(`  Burn from: ${burnFrom.toBase58()}`);
        console.log(`  Amount (base units): ${amount.toString()}`);

        const tx = await program.methods
          .burnTokens(amount)
          .accounts({
            burner: burner.publicKey,
            stablecoin: stablecoinPDA,
            mint,
            roleAssignment,
            burnFrom,
            oracleConfig: null,
            priceFeed: null,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc();

        console.log(`\n  Tokens burned successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError burning tokens: ${err.message}`);
        process.exit(1);
      }
    });
}
