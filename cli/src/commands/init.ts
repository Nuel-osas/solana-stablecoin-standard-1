import { Command } from "commander";
import {
  c,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  BN,
  TOKEN_2022_PROGRAM_ID,
  fs,
  TRANSFER_HOOK_PROGRAM_ID,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  initializeExtraAccountMetaList,
} from "./shared";

export function registerInitCommands(cli: Command): void {
  const initCmd = cli.command("init").description("Initialize a new stablecoin");

  initCmd
    .command("sss-1")
    .description("Initialize an SSS-1 (minimal) stablecoin")
    .requiredOption("--name <name>", "Token name")
    .requiredOption("--symbol <symbol>", "Token symbol")
    .option("--uri <uri>", "Metadata URI", "")
    .option("--decimals <decimals>", "Token decimals", "6")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mintKeypair = Keypair.generate();
        const [stablecoinPDA] = getStablecoinPDA(mintKeypair.publicKey);

        console.log(`\n${c.cyan}${c.bold}Initializing SSS-1 stablecoin${c.reset}: ${opts.name} (${opts.symbol})`);
        console.log(`  ${c.dim}Cluster:${c.reset}   ${opts.cluster}`);
        console.log(`  ${c.dim}Authority:${c.reset} ${authority.publicKey.toBase58()}`);
        console.log(`  ${c.dim}Mint:${c.reset}      ${mintKeypair.publicKey.toBase58()}`);
        console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

        const tx = await program.methods
          .initialize({
            name: opts.name,
            symbol: opts.symbol,
            uri: opts.uri,
            decimals: parseInt(opts.decimals),
            enablePermanentDelegate: false,
            enableTransferHook: false,
            defaultAccountFrozen: false,
            enableAllowlist: false,
            supplyCap: null,
          })
          .accounts({
            authority: authority.publicKey,
            mint: mintKeypair.publicKey,
            stablecoin: stablecoinPDA,
            transferHookProgram: null,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          } as any)
          .signers([mintKeypair])
          .rpc();

        console.log(`\n  ${c.green}${c.bold}Stablecoin initialized successfully!${c.reset}`);
        console.log(`  ${c.dim}Transaction:${c.reset} ${tx}`);
        console.log(`\n  ${c.yellow}Save this for subsequent commands:${c.reset}`);
        console.log(`    --mint ${c.bold}${mintKeypair.publicKey.toBase58()}${c.reset}`);
      } catch (err: any) {
        console.error(`\nError initializing SSS-1 stablecoin: ${err.message}`);
        process.exit(1);
      }
    });

  initCmd
    .command("sss-2")
    .description("Initialize an SSS-2 (compliant) stablecoin")
    .requiredOption("--name <name>", "Token name")
    .requiredOption("--symbol <symbol>", "Token symbol")
    .option("--uri <uri>", "Metadata URI", "")
    .option("--decimals <decimals>", "Token decimals", "6")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mintKeypair = Keypair.generate();
        const [stablecoinPDA] = getStablecoinPDA(mintKeypair.publicKey);

        console.log(`\n${c.cyan}${c.bold}Initializing SSS-2 stablecoin${c.reset}: ${opts.name} (${opts.symbol})`);
        console.log(`  ${c.dim}Cluster:${c.reset}   ${opts.cluster}`);
        console.log(`  ${c.dim}Authority:${c.reset} ${authority.publicKey.toBase58()}`);
        console.log(`  ${c.dim}Mint:${c.reset}      ${mintKeypair.publicKey.toBase58()}`);
        console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

        const tx = await program.methods
          .initialize({
            name: opts.name,
            symbol: opts.symbol,
            uri: opts.uri,
            decimals: parseInt(opts.decimals),
            enablePermanentDelegate: true,
            enableTransferHook: true,
            defaultAccountFrozen: false,
            enableAllowlist: false,
            supplyCap: null,
          })
          .accounts({
            authority: authority.publicKey,
            mint: mintKeypair.publicKey,
            stablecoin: stablecoinPDA,
            transferHookProgram: TRANSFER_HOOK_PROGRAM_ID,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([mintKeypair])
          .rpc();

        // Initialize transfer hook ExtraAccountMetaList
        const hookTx = await initializeExtraAccountMetaList(connection, authority, mintKeypair.publicKey);
        console.log(`\n  ${c.green}${c.bold}Stablecoin initialized successfully!${c.reset}`);
        console.log(`  ${c.dim}Transaction:${c.reset} ${tx}`);
        console.log(`  ${c.dim}Transfer Hook initialized:${c.reset} ${hookTx}`);
        console.log(`\n  ${c.yellow}Save this for subsequent commands:${c.reset}`);
        console.log(`    --mint ${c.bold}${mintKeypair.publicKey.toBase58()}${c.reset}`);
      } catch (err: any) {
        console.error(`\nError initializing SSS-2 stablecoin: ${err.message}`);
        process.exit(1);
      }
    });

  initCmd
    .command("sss-3")
    .description("Initialize an SSS-3 (private/allowlist) stablecoin")
    .requiredOption("--name <name>", "Token name")
    .requiredOption("--symbol <symbol>", "Token symbol")
    .option("--uri <uri>", "Metadata URI", "")
    .option("--decimals <decimals>", "Token decimals", "6")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mintKeypair = Keypair.generate();
        const [stablecoinPDA] = getStablecoinPDA(mintKeypair.publicKey);

        console.log(`\n${c.cyan}${c.bold}Initializing SSS-3 stablecoin${c.reset}: ${opts.name} (${opts.symbol})`);
        console.log(`  ${c.dim}Cluster:${c.reset}   ${opts.cluster}`);
        console.log(`  ${c.dim}Authority:${c.reset} ${authority.publicKey.toBase58()}`);
        console.log(`  ${c.dim}Mint:${c.reset}      ${mintKeypair.publicKey.toBase58()}`);
        console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

        const tx = await program.methods
          .initialize({
            name: opts.name,
            symbol: opts.symbol,
            uri: opts.uri,
            decimals: parseInt(opts.decimals),
            enablePermanentDelegate: true,
            enableTransferHook: true,
            defaultAccountFrozen: false,
            enableAllowlist: true,
            supplyCap: null,
          })
          .accounts({
            authority: authority.publicKey,
            mint: mintKeypair.publicKey,
            stablecoin: stablecoinPDA,
            transferHookProgram: TRANSFER_HOOK_PROGRAM_ID,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([mintKeypair])
          .rpc();

        // Initialize transfer hook ExtraAccountMetaList
        const hookTx = await initializeExtraAccountMetaList(connection, authority, mintKeypair.publicKey);
        console.log(`\n  Stablecoin initialized successfully!`);
        console.log(`  Transaction: ${tx}`);
        console.log(`  ${c.dim}Transfer Hook initialized:${c.reset} ${hookTx}`);
        console.log(`  ${c.magenta}ConfidentialTransferMint:${c.reset} Enabled (Experimental)`);
        console.log(`  ${c.dim}Note: Full confidential transfers require ZK ElGamal program (not yet live on devnet/mainnet)${c.reset}`);
        console.log(`\n  Save these values for subsequent commands:`);
        console.log(`    --mint ${mintKeypair.publicKey.toBase58()}`);
      } catch (err: any) {
        console.error(`\nError initializing SSS-3 stablecoin: ${err.message}`);
        process.exit(1);
      }
    });

  initCmd
    .command("custom")
    .description("Initialize with a custom TOML/JSON config")
    .requiredOption("--config <path>", "Path to config file (TOML or JSON)")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const config = JSON.parse(fs.readFileSync(opts.config, "utf-8"));
        const mintKeypair = Keypair.generate();
        const [stablecoinPDA] = getStablecoinPDA(mintKeypair.publicKey);

        console.log(`\nInitializing custom stablecoin from config: ${opts.config}`);
        console.log(`  Authority: ${authority.publicKey.toBase58()}`);
        console.log(`  Mint: ${mintKeypair.publicKey.toBase58()}`);
        console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

        const enableTransferHook = config.enableTransferHook ?? config.enable_transfer_hook ?? false;

        const tx = await program.methods
          .initialize({
            name: config.name,
            symbol: config.symbol,
            uri: config.uri ?? "",
            decimals: config.decimals ?? 6,
            enablePermanentDelegate: config.enablePermanentDelegate ?? config.enable_permanent_delegate ?? false,
            enableTransferHook,
            defaultAccountFrozen: config.defaultAccountFrozen ?? config.default_account_frozen ?? false,
            enableAllowlist: config.enableAllowlist ?? config.enable_allowlist ?? false,
            supplyCap: config.supplyCap ? new BN(config.supplyCap) : null,
          })
          .accounts({
            authority: authority.publicKey,
            mint: mintKeypair.publicKey,
            stablecoin: stablecoinPDA,
            transferHookProgram: enableTransferHook ? TRANSFER_HOOK_PROGRAM_ID : null,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          } as any)
          .signers([mintKeypair])
          .rpc();

        // Initialize transfer hook ExtraAccountMetaList if hook is enabled
        if (enableTransferHook) {
          const hookTx = await initializeExtraAccountMetaList(connection, authority, mintKeypair.publicKey);
          console.log(`  ${c.dim}Transfer Hook initialized:${c.reset} ${hookTx}`);
        }

        console.log(`\n  ${c.green}${c.bold}Stablecoin initialized successfully!${c.reset}`);
        console.log(`  ${c.dim}Transaction:${c.reset} ${tx}`);
        console.log(`\n  ${c.yellow}Save this for subsequent commands:${c.reset}`);
        console.log(`    --mint ${c.bold}${mintKeypair.publicKey.toBase58()}${c.reset}`);
      } catch (err: any) {
        console.error(`\nError initializing custom stablecoin: ${err.message}`);
        process.exit(1);
      }
    });
}
