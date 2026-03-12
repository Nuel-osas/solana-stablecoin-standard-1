import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import toast from "react-hot-toast";
import { useStablecoin } from "../hooks/useStablecoin";
import { parseError } from "../utils/errors";

interface Props {
  mintAddress: string;
}

export default function Transfer({ mintAddress }: Props) {
  const { state } = useStablecoin(mintAddress);
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [transferring, setTransferring] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to transfer tokens.</p>
      </div>
    );
  }

  const handleTransfer = async () => {
    if (!publicKey || !state || !signTransaction) return;
    try {
      setTransferring(true);
      const mint = new PublicKey(mintAddress);
      const recipientPubkey = new PublicKey(recipient);
      const decimals = state.decimals;
      const rawAmount = BigInt(Math.round(parseFloat(amount) * Math.pow(10, decimals)));

      const senderATA = getAssociatedTokenAddressSync(
        mint, publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      const recipientATA = getAssociatedTokenAddressSync(
        mint, recipientPubkey, false, TOKEN_2022_PROGRAM_ID
      );

      // Step 1: Create recipient ATA if needed (separate tx so the account
      // exists when we resolve transfer hook extra accounts in step 2)
      const recipientATAInfo = await connection.getAccountInfo(recipientATA);
      if (!recipientATAInfo) {
        const createAtaTx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            recipientATA,
            recipientPubkey,
            mint,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          )
        );
        createAtaTx.feePayer = publicKey;
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        createAtaTx.recentBlockhash = blockhash;
        const signedAta = await signTransaction(createAtaTx);
        const ataSig = await connection.sendRawTransaction(signedAta.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
        await connection.confirmTransaction(
          { signature: ataSig, blockhash, lastValidBlockHeight },
          "confirmed"
        );
      }

      // Step 2: Build transfer with hook accounts (needs both ATAs to exist
      // so the library can fetch account data for dynamic PDA resolution)
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        connection,
        senderATA,
        mint,
        recipientATA,
        publicKey,
        rawAmount,
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID,
      );

      const tx = new Transaction().add(transferIx);
      tx.feePayer = publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      toast.success(`Transfer successful! Tx: ${sig.slice(0, 8)}...`);
      setAmount("");
      setRecipient("");
    } catch (err: any) {
      console.error("Transfer error:", err, err?.logs);
      toast.error(parseError(err));
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Transfer Tokens</h1>

      <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4">
        <p className="text-sm text-amber-300">
          SSS-2/SSS-3 tokens use transfer hooks that wallets cannot resolve natively.
          Use this page to transfer tokens instead of your wallet's built-in send.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-indigo-400 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          Send Tokens
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Recipient Address</label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              placeholder="Wallet address to send tokens to"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="any"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={handleTransfer}
            disabled={transferring || !amount || !recipient || !publicKey}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {transferring ? "Transferring..." : "Transfer Tokens"}
          </button>
        </div>
      </div>
    </div>
  );
}
