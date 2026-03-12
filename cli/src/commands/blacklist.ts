import { Command } from "commander";
import {
  PublicKey,
  SystemProgram,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  getRolePDA,
  getBlacklistPDA,
  requireMint,
} from "./shared";

export function registerBlacklistCommands(cli: Command): void {
  const blacklistCmd = cli
    .command("blacklist")
    .description("Blacklist management (SSS-2)");

  blacklistCmd
    .command("add")
    .description("Add address to blacklist")
    .requiredOption("--address <address>", "Address to blacklist")
    .option("--reason <reason>", "Reason for blacklisting", "Compliance action")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Blacklister keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const blacklister = loadKeypair(opts.keypair);
        const program = getProgram(connection, blacklister);
        const mint = requireMint(opts);
        const targetAddress = new PublicKey(opts.address);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(
          stablecoinPDA,
          "blacklister",
          blacklister.publicKey
        );
        const [blacklistEntry] = getBlacklistPDA(stablecoinPDA, targetAddress);

        console.log(`\nAdding ${targetAddress.toBase58()} to blacklist`);
        console.log(`  Reason: ${opts.reason}`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .addToBlacklist(targetAddress, opts.reason)
          .accounts({
            blacklister: blacklister.publicKey,
            stablecoin: stablecoinPDA,
            roleAssignment,
            blacklistEntry,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log(`\n  Address blacklisted successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError adding to blacklist: ${err.message}`);
        process.exit(1);
      }
    });

  blacklistCmd
    .command("remove")
    .description("Remove address from blacklist")
    .requiredOption("--address <address>", "Address to remove")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Blacklister keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const blacklister = loadKeypair(opts.keypair);
        const program = getProgram(connection, blacklister);
        const mint = requireMint(opts);
        const targetAddress = new PublicKey(opts.address);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(
          stablecoinPDA,
          "blacklister",
          blacklister.publicKey
        );
        const [blacklistEntry] = getBlacklistPDA(stablecoinPDA, targetAddress);

        console.log(`\nRemoving ${targetAddress.toBase58()} from blacklist`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .removeFromBlacklist(targetAddress)
          .accounts({
            blacklister: blacklister.publicKey,
            stablecoin: stablecoinPDA,
            roleAssignment,
            blacklistEntry,
          })
          .rpc();

        console.log(`\n  Address removed from blacklist successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError removing from blacklist: ${err.message}`);
        process.exit(1);
      }
    });
}
