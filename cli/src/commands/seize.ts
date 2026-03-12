import { Command } from "commander";
import {
  PublicKey,
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedWithTransferHookInstruction,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  getRolePDA,
  getBlacklistPDA,
  requireMint,
} from "./shared";

export function registerSeizeCommands(cli: Command): void {
  cli
    .command("seize")
    .description("Seize tokens from blacklisted account (SSS-2)")
    .requiredOption("--from <address>", "Source token account to seize from")
    .requiredOption("--to <address>", "Treasury token account to receive tokens")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Seizer keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const seizer = loadKeypair(opts.keypair);
        const program = getProgram(connection, seizer);
        const mint = requireMint(opts);
        const sourceAccount = new PublicKey(opts.from);
        const treasuryAccount = new PublicKey(opts.to);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(
          stablecoinPDA,
          "seizer",
          seizer.publicKey
        );

        // The blacklist entry PDA uses the owner of the source token account.
        // We need to fetch the source account to get its owner.
        const sourceAccountInfo = await connection.getParsedAccountInfo(sourceAccount);
        if (!sourceAccountInfo.value) {
          console.error("Error: Source token account not found.");
          process.exit(1);
        }
        const parsedData = (sourceAccountInfo.value.data as any)?.parsed;
        const sourceOwner = new PublicKey(parsedData?.info?.owner);
        const [blacklistEntry] = getBlacklistPDA(stablecoinPDA, sourceOwner);

        console.log(`\nSeizing tokens from ${sourceAccount.toBase58()}`);
        console.log(`  To treasury: ${treasuryAccount.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);

        // Resolve transfer hook extra accounts (seize does transfer_checked CPI)
        const dummyIx = await createTransferCheckedWithTransferHookInstruction(
          connection, sourceAccount, mint, treasuryAccount, stablecoinPDA,
          BigInt(1), 6, [], "confirmed", TOKEN_2022_PROGRAM_ID,
        );
        // Extra accounts start after the standard 4 (source, mint, dest, authority)
        const extraKeys = dummyIx.keys.slice(4);

        const tx = await program.methods
          .seize()
          .accounts({
            seizer: seizer.publicKey,
            stablecoin: stablecoinPDA,
            mint,
            roleAssignment,
            blacklistEntry,
            sourceAccount,
            treasuryAccount,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .remainingAccounts(extraKeys)
          .rpc();

        console.log(`\n  Tokens seized successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError seizing tokens: ${err.message}`);
        process.exit(1);
      }
    });
}
