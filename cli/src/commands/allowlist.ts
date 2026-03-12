import { Command } from "commander";
import {
  PublicKey,
  SystemProgram,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  getAllowlistPDA,
  requireMint,
} from "./shared";

export function registerAllowlistCommands(cli: Command): void {
  const allowlistCmd = cli
    .command("allowlist")
    .description("Allowlist management (SSS-3)");

  allowlistCmd
    .command("add")
    .description("Add address to allowlist")
    .requiredOption("--address <address>", "Address to allowlist")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const targetAddress = new PublicKey(opts.address);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [allowlistEntry] = getAllowlistPDA(stablecoinPDA, targetAddress);

        console.log(`\nAdding ${targetAddress.toBase58()} to allowlist`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .addToAllowlist(targetAddress)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            allowlistEntry,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log(`\n  Address allowlisted successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError adding to allowlist: ${err.message}`);
        process.exit(1);
      }
    });

  allowlistCmd
    .command("remove")
    .description("Remove address from allowlist")
    .requiredOption("--address <address>", "Address to remove")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const targetAddress = new PublicKey(opts.address);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [allowlistEntry] = getAllowlistPDA(stablecoinPDA, targetAddress);

        console.log(`\nRemoving ${targetAddress.toBase58()} from allowlist`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .removeFromAllowlistEntry(targetAddress)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            allowlistEntry,
          })
          .rpc();

        console.log(`\n  Address removed from allowlist successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError removing from allowlist: ${err.message}`);
        process.exit(1);
      }
    });
}
