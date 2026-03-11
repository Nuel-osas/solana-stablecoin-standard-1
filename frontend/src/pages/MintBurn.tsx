import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import toast from "react-hot-toast";
import { useStablecoin } from "../hooks/useStablecoin";
import {
  deriveStablecoinPDA,
  deriveRoleAssignmentPDA,
  deriveMinterInfoPDA,
} from "../utils/pda";
import { parseError } from "../utils/errors";

interface Props {
  mintAddress: string;
}

export default function MintBurn({ mintAddress }: Props) {
  const { state, program, refetch } = useStablecoin(mintAddress);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [mintAmount, setMintAmount] = useState("");
  const [mintRecipient, setMintRecipient] = useState("");
  const [burnAmount, setBurnAmount] = useState("");
  const [minting, setMinting] = useState(false);
  const [burning, setBurning] = useState(false);

  if (!mintAddress) {
    return <EmptyState message="Enter a mint address above to access mint/burn operations." />;
  }

  const handleMint = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setMinting(true);
      const mint = new PublicKey(mintAddress);
      const recipient = new PublicKey(mintRecipient);
      const decimals = state.decimals;
      const amount = new BN(parseFloat(mintAmount) * Math.pow(10, decimals));

      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [roleAssignment] = deriveRoleAssignmentPDA(stablecoinPDA, "minter", publicKey);
      const [minterInfo] = deriveMinterInfoPDA(stablecoinPDA, publicKey);

      // Check if wallet has minter role
      const roleInfo = await connection.getAccountInfo(roleAssignment);
      if (!roleInfo) {
        toast.error("You don't have the Minter role. Ask the authority to assign it via the Roles page.");
        return;
      }

      const recipientATA = getAssociatedTokenAddressSync(
        mint,
        recipient,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      // Build transaction — create ATA if it doesn't exist
      const tx = new Transaction();
      const ataInfo = await connection.getAccountInfo(recipientATA);
      if (!ataInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            recipientATA,
            recipient,
            mint,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          )
        );
      }

      const mintIx = await (program.methods as any)
        .mintTokens(amount)
        .accounts({
          minter: publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment,
          minterInfo,
          recipientTokenAccount: recipientATA,
          oracleConfig: null,
          priceFeed: null,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .transaction();
      tx.add(...mintIx.instructions);

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Minted ${mintAmount} tokens! Tx: ${sig.slice(0, 8)}...`);
      setMintAmount("");
      setMintRecipient("");
      refetch();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setMinting(false);
    }
  };

  const handleBurn = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setBurning(true);
      const mint = new PublicKey(mintAddress);
      const decimals = state.decimals;
      const amount = new BN(parseFloat(burnAmount) * Math.pow(10, decimals));

      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [roleAssignment] = deriveRoleAssignmentPDA(stablecoinPDA, "burner", publicKey);

      // Check if wallet has burner role
      const roleInfo = await connection.getAccountInfo(roleAssignment);
      if (!roleInfo) {
        toast.error("You don't have the Burner role. Ask the authority to assign it via the Roles page.");
        return;
      }

      const burnFrom = getAssociatedTokenAddressSync(
        mint,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const tx = await (program.methods as any)
        .burnTokens(amount)
        .accounts({
          burner: publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment,
          burnFrom,
          oracleConfig: null,
          priceFeed: null,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Burned ${burnAmount} tokens! Tx: ${sig.slice(0, 8)}...`);
      setBurnAmount("");
      refetch();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setBurning(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Mint / Burn Tokens</h1>

      {/* Mint Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-emerald-400 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Mint Tokens
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Recipient Address</label>
            <input
              type="text"
              value={mintRecipient}
              onChange={(e) => setMintRecipient(e.target.value.trim())}
              placeholder="Wallet address to receive tokens"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Amount</label>
            <input
              type="number"
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="any"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={handleMint}
            disabled={minting || !mintAmount || !mintRecipient || !publicKey}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {minting ? "Minting..." : "Mint Tokens"}
          </button>
        </div>
      </div>

      {/* Burn Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-red-400 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
          </svg>
          Burn Tokens
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">
              Amount (burns from your token account)
            </label>
            <input
              type="number"
              value={burnAmount}
              onChange={(e) => setBurnAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="any"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={handleBurn}
            disabled={burning || !burnAmount || !publicKey}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {burning ? "Burning..." : "Burn Tokens"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-slate-500 text-sm">{message}</p>
    </div>
  );
}
