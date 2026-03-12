import { Command } from "commander";
import {
  c,
  PublicKey,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  requireMint,
  detectPreset,
  formatAmount,
} from "./shared";

export function registerStatusCommands(cli: Command): void {
  cli
    .command("status")
    .description("Get stablecoin status")
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

        console.log(`\n${c.cyan}Fetching stablecoin status...${c.reset}`);
        console.log(`  Mint: ${mint.toBase58()}`);
        console.log(`  Stablecoin PDA: ${stablecoinPDA.toBase58()}`);

        const stablecoin = await (program.account as any).stablecoin.fetch(stablecoinPDA);

        const preset = detectPreset(stablecoin);
        const dec = stablecoin.decimals;
        const totalMinted = formatAmount(stablecoin.totalMinted.toString(), dec);
        const totalBurned = formatAmount(stablecoin.totalBurned.toString(), dec);
        const capRaw = stablecoin.supplyCap?.toString() ?? "0";
        const supplyCap = capRaw === "0" ? "Unlimited" : formatAmount(capRaw, dec);
        const netSupply = formatAmount(
          (Number(stablecoin.totalMinted.toString()) - Number(stablecoin.totalBurned.toString())).toString(),
          dec
        );

        const on = `${c.green}${c.bold}Enabled${c.reset}`;
        const off = `${c.dim}Disabled${c.reset}`;
        const pauseLabel = stablecoin.paused
          ? `${c.bg.red}${c.white}${c.bold} PAUSED ${c.reset}`
          : `${c.bg.green}${c.white}${c.bold} ACTIVE ${c.reset}`;

        console.log(`\n  ${c.bold}${c.cyan}═══ ${stablecoin.name} (${stablecoin.symbol}) ═══${c.reset}`);
        console.log(`  ${c.dim}Preset:${c.reset}    ${c.yellow}${preset}${c.reset}`);
        console.log(`  ${c.dim}Status:${c.reset}    ${pauseLabel}`);
        console.log();
        console.log(`  ${c.dim}Authority:${c.reset} ${stablecoin.authority.toBase58()}`);
        console.log(`  ${c.dim}Mint:${c.reset}      ${stablecoin.mint.toBase58()}`);
        console.log(`  ${c.dim}Decimals:${c.reset}  ${stablecoin.decimals}`);
        if (stablecoin.uri) console.log(`  ${c.dim}URI:${c.reset}       ${stablecoin.uri}`);
        console.log();
        console.log(`  ${c.bold}Supply${c.reset}`);
        console.log(`  ${c.dim}Current:${c.reset}   ${c.white}${netSupply}${c.reset} ${stablecoin.symbol}`);
        console.log(`  ${c.dim}Minted:${c.reset}    ${c.green}${totalMinted}${c.reset}`);
        console.log(`  ${c.dim}Burned:${c.reset}    ${c.red}${totalBurned}${c.reset}`);
        console.log(`  ${c.dim}Cap:${c.reset}       ${supplyCap}`);
        console.log();
        console.log(`  ${c.bold}Extensions${c.reset}`);
        console.log(`  ${c.dim}Permanent Delegate:${c.reset}     ${stablecoin.enablePermanentDelegate ? on : off}`);
        console.log(`  ${c.dim}Transfer Hook:${c.reset}          ${stablecoin.enableTransferHook ? on : off}`);
        console.log(`  ${c.dim}Default Account Frozen:${c.reset} ${stablecoin.defaultAccountFrozen ? on : off}`);
        console.log(`  ${c.dim}Allowlist:${c.reset}              ${stablecoin.enableAllowlist ? on : off}`);
        if (stablecoin.enableAllowlist) {
          console.log(`  ${c.dim}Confidential Transfer:${c.reset}  ${c.magenta}Enabled (Experimental)${c.reset}`);
        }
        const pending = stablecoin.pendingAuthority?.toBase58();
        if (pending && pending !== PublicKey.default.toBase58()) {
          console.log();
          console.log(`  ${c.yellow}Pending Authority:${c.reset} ${pending}`);
        }
        console.log();
      } catch (err: any) {
        console.error(`\nError fetching status: ${err.message}`);
        process.exit(1);
      }
    });
}
