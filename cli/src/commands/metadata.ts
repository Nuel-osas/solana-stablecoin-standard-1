import { Command } from "commander";
import {
  c,
  TOKEN_2022_PROGRAM_ID,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  requireMint,
} from "./shared";

export function registerMetadataCommands(cli: Command): void {
  cli
    .command("update-metadata")
    .description("Update stablecoin metadata URI")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .requiredOption("--uri <string>", "New metadata URI")
    .option("--keypair <path>", "Path to authority keypair JSON")
    .option("--cluster <url>", "Solana cluster URL", "https://api.devnet.solana.com")
    .action(async (opts) => {
      const keypairPath = opts.keypair || `${process.env.HOME}/.config/solana/id.json`;
      const authority = loadKeypair(keypairPath);
      const connection = getConnection(opts.cluster);
      const program = getProgram(connection, authority);

      const mint = requireMint(opts);
      const uri: string = opts.uri;

      const [stablecoinPDA] = getStablecoinPDA(mint);

      console.log(`\n${c.bold}Update Metadata${c.reset}`);
      console.log(`  Mint:       ${mint.toBase58()}`);
      console.log(`  URI:        ${uri}`);
      console.log(`  Authority:  ${authority.publicKey.toBase58()}`);

      try {
        const txSig = await program.methods
          .updateMetadata(uri)
          .accounts({
            authority: authority.publicKey,
            mint,
            stablecoin: stablecoinPDA,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([authority])
          .rpc();

        console.log(`\n  ${c.green}Metadata updated successfully!${c.reset}`);
        console.log(`  TX: ${txSig}`);
      } catch (err: any) {
        console.error(`\n  ${c.red}Error:${c.reset} ${err.message}`);
        process.exit(1);
      }
    });
}
