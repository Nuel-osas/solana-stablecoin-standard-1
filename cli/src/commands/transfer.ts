import { Command } from "commander";
import {
  c,
  path,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
  PublicKey,
  loadKeypair,
  getConnection,
} from "./shared";

export function registerTransferCommands(cli: Command): void {
  cli
    .command("transfer")
    .description("Transfer tokens (with transfer hook support)")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .requiredOption("--to <address>", "Recipient wallet address")
    .requiredOption("--amount <number>", "Amount to transfer (human-readable)")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Sender keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      const keypairPath = opts.keypair.startsWith("~")
        ? path.join(process.env.HOME || "", opts.keypair.slice(1))
        : opts.keypair;
      const sender = loadKeypair(keypairPath);
      const connection = getConnection(opts.cluster);
      const mint = new PublicKey(opts.mint);
      const recipient = new PublicKey(opts.to);

      // Get mint info for decimals
      const mintInfo = await connection.getTokenSupply(mint);
      const decimals = mintInfo.value.decimals;
      const rawAmount = BigInt(Math.round(parseFloat(opts.amount) * Math.pow(10, decimals)));

      const senderATA = getAssociatedTokenAddressSync(mint, sender.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const recipientATA = getAssociatedTokenAddressSync(mint, recipient, false, TOKEN_2022_PROGRAM_ID);

      console.log(`\n${c.bold}Transfer${c.reset}`);
      console.log(`  Mint:      ${mint.toBase58()}`);
      console.log(`  From:      ${sender.publicKey.toBase58()}`);
      console.log(`  To:        ${recipient.toBase58()}`);
      console.log(`  Amount:    ${opts.amount}`);

      try {
        const tx = new (await import("@solana/web3.js")).Transaction();

        // Create recipient ATA first (must exist before resolving hook accounts)
        const recipientATAInfo = await connection.getAccountInfo(recipientATA);
        if (!recipientATAInfo) {
          const createAtaTx = new (await import("@solana/web3.js")).Transaction();
          createAtaTx.add(
            createAssociatedTokenAccountInstruction(
              sender.publicKey, recipientATA, recipient, mint,
              TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
            )
          );
          createAtaTx.feePayer = sender.publicKey;
          createAtaTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
          createAtaTx.sign(sender);
          const ataSig = await connection.sendRawTransaction(createAtaTx.serialize());
          await connection.confirmTransaction(ataSig, "confirmed");
          console.log(`  Created recipient ATA: ${recipientATA.toBase58()}`);
        }

        // Build transfer instruction with hook accounts
        const transferIx = await createTransferCheckedWithTransferHookInstruction(
          connection, senderATA, mint, recipientATA, sender.publicKey,
          rawAmount, decimals, [], "confirmed", TOKEN_2022_PROGRAM_ID,
        );
        tx.add(transferIx);

        tx.feePayer = sender.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.sign(sender);

        const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        await connection.confirmTransaction(sig, "confirmed");

        console.log(`\n  ${c.green}${c.bold}Transfer successful!${c.reset}`);
        console.log(`  TX: ${sig}`);
      } catch (err: any) {
        console.error(`\n  ${c.red}Error:${c.reset} ${err.message || err}`);
        if (err.logs) console.error("  Logs:", err.logs.join("\n  "));
        process.exit(1);
      }
    });
}
