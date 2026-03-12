import { Command } from "commander";
import {
  c,
  PublicKey,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  requireMint,
} from "./shared";

export function registerAuthorityCommands(cli: Command): void {
  cli
    .command("nominate-authority")
    .description("Nominate a new master authority (two-step transfer, step 1)")
    .requiredOption("--new-authority <address>", "New authority address")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Current authority keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const newAuthority = new PublicKey(opts.newAuthority);
        const [stablecoinPDA] = getStablecoinPDA(mint);

        console.log(`\nNominating new authority: ${newAuthority.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);
        console.log(`  The new authority must call 'accept-authority' to complete the transfer.`);

        const tx = await program.methods
          .nominateAuthority(newAuthority)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
          })
          .rpc();

        console.log(`\n  Authority nominated successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError nominating authority: ${err.message}`);
        process.exit(1);
      }
    });

  cli
    .command("accept-authority")
    .description("Accept a pending authority nomination (two-step transfer, step 2)")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "New authority keypair (must be the nominated address)", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const newAuthority = loadKeypair(opts.keypair);
        const program = getProgram(connection, newAuthority);
        const mint = requireMint(opts);
        const [stablecoinPDA] = getStablecoinPDA(mint);

        console.log(`\nAccepting authority for mint: ${mint.toBase58()}`);
        console.log(`  New authority: ${newAuthority.publicKey.toBase58()}`);

        const tx = await program.methods
          .acceptAuthority()
          .accounts({
            newAuthority: newAuthority.publicKey,
            stablecoin: stablecoinPDA,
          })
          .rpc();

        console.log(`\n  Authority transferred successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError accepting authority: ${err.message}`);
        process.exit(1);
      }
    });

  cli
    .command("transfer-authority")
    .description("Direct single-step authority transfer (use with caution)")
    .requiredOption("--new-authority <address>", "New authority address")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Current authority keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const newAuthority = new PublicKey(opts.newAuthority);
        const [stablecoinPDA] = getStablecoinPDA(mint);

        console.log(`\n${c.yellow}${c.bold}WARNING: This is a single-step, irreversible authority transfer.${c.reset}`);
        console.log(`  Current authority: ${authority.publicKey.toBase58()}`);
        console.log(`  New authority:     ${newAuthority.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .transferAuthority(newAuthority)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
          })
          .rpc();

        console.log(`\n  ${c.green}${c.bold}Authority transferred successfully!${c.reset}`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError transferring authority: ${err.message}`);
        process.exit(1);
      }
    });
}
