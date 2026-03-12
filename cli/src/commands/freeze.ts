import { Command } from "commander";
import {
  PublicKey,
  TOKEN_2022_PROGRAM_ID,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  getRolePDA,
  requireMint,
} from "./shared";

export function registerFreezeCommands(cli: Command): void {
  cli
    .command("freeze")
    .description("Freeze a token account")
    .requiredOption("--account <address>", "Token account to freeze")
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
        const [roleAssignment] = getRolePDA(stablecoinPDA, "pauser", authority.publicKey);
        const targetAccount = new PublicKey(opts.account);

        console.log(`\nFreezing account ${targetAccount.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .freezeAccount()
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            mint,
            roleAssignment,
            targetAccount,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();

        console.log(`\n  Account frozen successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError freezing account: ${err.message}`);
        process.exit(1);
      }
    });

  cli
    .command("thaw")
    .description("Thaw a frozen token account")
    .requiredOption("--account <address>", "Token account to thaw")
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
        const [roleAssignment] = getRolePDA(stablecoinPDA, "pauser", authority.publicKey);
        const targetAccount = new PublicKey(opts.account);

        console.log(`\nThawing account ${targetAccount.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .thawAccount()
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            mint,
            roleAssignment,
            targetAccount,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();

        console.log(`\n  Account thawed successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError thawing account: ${err.message}`);
        process.exit(1);
      }
    });

  cli
    .command("pause")
    .description("Pause all token operations")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Pauser keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(stablecoinPDA, "pauser", authority.publicKey);

        console.log(`\nPausing stablecoin`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .pause()
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            roleAssignment,
          })
          .rpc();

        console.log(`\n  Stablecoin paused successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError pausing stablecoin: ${err.message}`);
        process.exit(1);
      }
    });

  cli
    .command("unpause")
    .description("Unpause token operations")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Pauser keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(stablecoinPDA, "pauser", authority.publicKey);

        console.log(`\nUnpausing stablecoin`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .unpause()
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            roleAssignment,
          })
          .rpc();

        console.log(`\n  Stablecoin unpaused successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError unpausing stablecoin: ${err.message}`);
        process.exit(1);
      }
    });
}
