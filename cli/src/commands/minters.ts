import { Command } from "commander";
import {
  PublicKey,
  SystemProgram,
  BN,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  getRolePDA,
  getMinterInfoPDA,
  requireMint,
} from "./shared";

export function registerMintersCommands(cli: Command): void {
  const mintersCmd = cli.command("minters").description("Minter management");

  mintersCmd
    .command("add")
    .description("Add a minter")
    .requiredOption("--address <address>", "Minter address")
    .option("--quota <amount>", "Minting quota (0 = unlimited)", "0")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const assignee = new PublicKey(opts.address);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(stablecoinPDA, "minter", assignee);
        const [minterInfo] = getMinterInfoPDA(stablecoinPDA, assignee);

        console.log(`\nAdding minter ${assignee.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .assignRole({ minter: {} }, assignee)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            roleAssignment,
            minterInfo,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log(`\n  Minter added successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError adding minter: ${err.message}`);
        process.exit(1);
      }
    });

  mintersCmd
    .command("remove")
    .description("Remove a minter")
    .requiredOption("--address <address>", "Minter address to remove")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const assignee = new PublicKey(opts.address);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(stablecoinPDA, "minter", assignee);

        console.log(`\nRemoving minter ${assignee.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .revokeRole({ minter: {} }, assignee)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            roleAssignment,
          })
          .rpc();

        console.log(`\n  Minter removed successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError removing minter: ${err.message}`);
        process.exit(1);
      }
    });

  mintersCmd
    .command("list")
    .description("List all minters")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const [stablecoinPDA] = getStablecoinPDA(mint);

        console.log(`\nListing minters for mint: ${mint.toBase58()}`);

        // Fetch all RoleAssignment accounts for this stablecoin
        const accounts = await (program.account as any).roleAssignment.all([
          {
            memcmp: {
              offset: 8, // after discriminator
              bytes: stablecoinPDA.toBase58(),
            },
          },
        ]);

        const minters = accounts.filter(
          (acc: any) => acc.account.role && "minter" in acc.account.role && acc.account.active
        );

        if (minters.length === 0) {
          console.log("\n  No minters found.");
        } else {
          console.log(`\n  Found ${minters.length} minter(s):`);
          for (const m of minters) {
            const assignee = (m.account as any).assignee.toBase58();
            console.log(`    - ${assignee} (PDA: ${m.publicKey.toBase58()})`);

            // Try to fetch minter info for quota details
            try {
              const [minterInfoPDA] = getMinterInfoPDA(
                stablecoinPDA,
                (m.account as any).assignee
              );
              const minterInfo = await (program.account as any).minterInfo.fetch(
                minterInfoPDA
              );
              const quota = (minterInfo as any).quota.toString();
              const minted = (minterInfo as any).minted.toString();
              console.log(`      Quota: ${quota === "0" ? "unlimited" : quota}, Minted: ${minted}`);
            } catch {
              // minter info might not exist yet
            }
          }
        }
      } catch (err: any) {
        console.error(`\nError listing minters: ${err.message}`);
        process.exit(1);
      }
    });

  cli
    .command("update-minter-quota")
    .description("Update an existing minter's quota")
    .requiredOption("--address <address>", "Minter address")
    .requiredOption("--quota <amount>", "New quota in tokens (0 = unlimited)")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Authority keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const minter = new PublicKey(opts.address);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [minterInfo] = getMinterInfoPDA(stablecoinPDA, minter);
        const stablecoinData = await (program.account as any).stablecoin.fetch(stablecoinPDA);
        const decimals = stablecoinData.decimals;
        const quota = opts.quota === "0" ? new BN(0) : new BN(Math.round(parseFloat(opts.quota) * Math.pow(10, decimals)));

        console.log(`\nUpdating quota for minter: ${minter.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);
        console.log(`  New quota: ${quota.toString() === "0" ? "Unlimited" : quota.toString()}`);

        const tx = await program.methods
          .updateMinterQuota(quota)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            minterInfo,
          })
          .rpc();

        console.log(`\n  Minter quota updated successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError updating minter quota: ${err.message}`);
        process.exit(1);
      }
    });
}
