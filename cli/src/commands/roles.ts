import { Command } from "commander";
import {
  c,
  PublicKey,
  SystemProgram,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  getRolePDA,
  getMinterInfoPDA,
  requireMint,
  roleToEnum,
} from "./shared";

export function registerRolesCommands(cli: Command): void {
  const rolesCmd = cli.command("roles").description("Role management (minter, burner, blacklister, pauser, seizer)");

  rolesCmd
    .command("assign")
    .description("Assign a role to an address")
    .requiredOption("--role <role>", "Role to assign (minter, burner, blacklister, pauser, seizer)")
    .requiredOption("--address <address>", "Address to assign the role to")
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
        const roleName = opts.role.toLowerCase();
        const roleEnum = roleToEnum(roleName);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(stablecoinPDA, roleName, assignee);

        // minterInfo is only needed for minter role
        const minterInfo = roleName === "minter"
          ? getMinterInfoPDA(stablecoinPDA, assignee)[0]
          : null;

        console.log(`\nAssigning ${c.bold}${roleName}${c.reset} role to ${assignee.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .assignRole(roleEnum, assignee)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            roleAssignment,
            minterInfo,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();

        console.log(`\n  ${c.green}${c.bold}Role assigned successfully!${c.reset}`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError assigning role: ${err.message}`);
        process.exit(1);
      }
    });

  rolesCmd
    .command("revoke")
    .description("Revoke a role from an address")
    .requiredOption("--role <role>", "Role to revoke (minter, burner, blacklister, pauser, seizer)")
    .requiredOption("--address <address>", "Address to revoke the role from")
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
        const roleName = opts.role.toLowerCase();
        const roleEnum = roleToEnum(roleName);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(stablecoinPDA, roleName, assignee);

        console.log(`\nRevoking ${c.bold}${roleName}${c.reset} role from ${assignee.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);

        const tx = await program.methods
          .revokeRole(roleEnum, assignee)
          .accounts({
            authority: authority.publicKey,
            stablecoin: stablecoinPDA,
            roleAssignment,
          })
          .rpc();

        console.log(`\n  ${c.green}${c.bold}Role revoked successfully!${c.reset}`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError revoking role: ${err.message}`);
        process.exit(1);
      }
    });

  rolesCmd
    .command("list")
    .description("List all role assignments")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--role <role>", "Filter by role (minter, burner, blacklister, pauser, seizer)")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const [stablecoinPDA] = getStablecoinPDA(mint);

        console.log(`\nListing roles for mint: ${mint.toBase58()}`);

        const accounts = await (program.account as any).roleAssignment.all([
          { memcmp: { offset: 8, bytes: stablecoinPDA.toBase58() } },
        ]);

        const roleNames = ["minter", "burner", "blacklister", "pauser", "seizer"];
        let filtered = accounts.filter((acc: any) => acc.account.active);

        if (opts.role) {
          const filterRole = opts.role.toLowerCase();
          filtered = filtered.filter((acc: any) => {
            const role = acc.account.role;
            return role && filterRole in role;
          });
        }

        if (filtered.length === 0) {
          console.log("\n  No active role assignments found.");
        } else {
          console.log(`\n  Found ${filtered.length} active role(s):\n`);
          for (const a of filtered) {
            const assignee = (a.account as any).assignee.toBase58();
            const role = Object.keys(a.account.role)[0] || "unknown";
            console.log(`    ${c.cyan}${role.padEnd(13)}${c.reset} ${assignee}`);
          }
        }
      } catch (err: any) {
        console.error(`\nError listing roles: ${err.message}`);
        process.exit(1);
      }
    });

  rolesCmd
    .command("check")
    .description("Check what roles an address has")
    .requiredOption("--address <address>", "Address to check")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const authority = loadKeypair(opts.keypair);
        const program = getProgram(connection, authority);
        const mint = requireMint(opts);
        const target = new PublicKey(opts.address);
        const [stablecoinPDA] = getStablecoinPDA(mint);

        console.log(`\nChecking roles for ${target.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}\n`);

        const roleNames = ["minter", "burner", "blacklister", "pauser", "seizer"];
        for (const roleName of roleNames) {
          const [rolePDA] = getRolePDA(stablecoinPDA, roleName, target);
          try {
            const roleAccount = await (program.account as any).roleAssignment.fetch(rolePDA);
            if (roleAccount.active) {
              console.log(`    ${c.green}${c.bold}YES${c.reset}  ${roleName}`);
            } else {
              console.log(`    ${c.dim}NO   ${roleName}${c.reset}`);
            }
          } catch {
            console.log(`    ${c.dim}NO   ${roleName}${c.reset}`);
          }
        }

        // Check if authority
        const stablecoin = await (program.account as any).stablecoin.fetch(stablecoinPDA);
        if (stablecoin.authority.toBase58() === target.toBase58()) {
          console.log(`\n    ${c.yellow}${c.bold}★ Master Authority${c.reset}`);
        }
      } catch (err: any) {
        console.error(`\nError checking roles: ${err.message}`);
        process.exit(1);
      }
    });
}
