import { Command } from "commander";
import {
  PublicKey,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  loadKeypair,
  getConnection,
  getProgram,
  getStablecoinPDA,
  getRolePDA,
  getMinterInfoPDA,
  requireMint,
  parseAmount,
} from "./shared";

export function registerMintCommands(cli: Command): void {
  cli
    .command("mint")
    .description("Mint tokens to a recipient")
    .requiredOption("--to <address>", "Recipient address")
    .requiredOption("--amount <amount>", "Amount to mint (e.g. 1000 or 1.5)")
    .requiredOption("--mint <address>", "Stablecoin mint address")
    .option("--cluster <cluster>", "Solana cluster", "devnet")
    .option("--keypair <path>", "Minter keypair", "~/.config/solana/id.json")
    .action(async (opts) => {
      try {
        const connection = getConnection(opts.cluster);
        const minter = loadKeypair(opts.keypair);
        const program = getProgram(connection, minter);
        const mint = requireMint(opts);
        const recipient = new PublicKey(opts.to);
        const amount = await parseAmount(opts.amount, mint, connection);
        const [stablecoinPDA] = getStablecoinPDA(mint);
        const [roleAssignment] = getRolePDA(stablecoinPDA, "minter", minter.publicKey);
        const [minterInfo] = getMinterInfoPDA(stablecoinPDA, minter.publicKey);

        const recipientATA = getAssociatedTokenAddressSync(
          mint,
          recipient,
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );

        console.log(`\nMinting ${opts.amount} tokens to ${recipient.toBase58()}`);
        console.log(`  Mint: ${mint.toBase58()}`);
        console.log(`  Recipient ATA: ${recipientATA.toBase58()}`);
        console.log(`  Amount (base units): ${amount.toString()}`);

        // Auto-create recipient ATA if it doesn't exist
        const ataInfo = await connection.getAccountInfo(recipientATA);
        if (!ataInfo) {
          const { Transaction } = await import("@solana/web3.js");
          const createAtaTx = new Transaction().add(
            createAssociatedTokenAccountInstruction(
              minter.publicKey, recipientATA, recipient, mint,
              TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
            )
          );
          createAtaTx.feePayer = minter.publicKey;
          createAtaTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
          createAtaTx.sign(minter);
          const ataSig = await connection.sendRawTransaction(createAtaTx.serialize());
          await connection.confirmTransaction(ataSig, "confirmed");
          console.log(`  Created recipient ATA automatically`);
        }

        const tx = await program.methods
          .mintTokens(amount)
          .accounts({
            minter: minter.publicKey,
            stablecoin: stablecoinPDA,
            mint,
            roleAssignment,
            minterInfo,
            recipientTokenAccount: recipientATA,
            oracleConfig: null,
            priceFeed: null,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc();

        console.log(`\n  Tokens minted successfully!`);
        console.log(`  Transaction: ${tx}`);
      } catch (err: any) {
        console.error(`\nError minting tokens: ${err.message}`);
        process.exit(1);
      }
    });
}
