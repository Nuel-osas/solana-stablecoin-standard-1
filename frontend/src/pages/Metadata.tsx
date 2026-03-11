import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import toast from "react-hot-toast";
import { useStablecoin } from "../hooks/useStablecoin";
import { deriveStablecoinPDA } from "../utils/pda";
import { parseError } from "../utils/errors";

interface Props {
  mintAddress: string;
}

export default function Metadata({ mintAddress }: Props) {
  const { state, program, refetch } = useStablecoin(mintAddress);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [newUri, setNewUri] = useState("");
  const [updating, setUpdating] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to manage metadata.</p>
      </div>
    );
  }

  const handleUpdateMetadata = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setUpdating(true);
      const mint = new PublicKey(mintAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);

      if (!state.authority.equals(publicKey)) {
        toast.error("Only the master authority can update metadata.");
        return;
      }

      const tx = await (program.methods as any)
        .updateMetadata(newUri)
        .accounts({
          authority: publicKey,
          mint,
          stablecoin: stablecoinPDA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Metadata updated! Tx: ${sig.slice(0, 8)}...`);
      setNewUri("");
      refetch();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Metadata</h1>

      {/* Current metadata */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Current Metadata</h2>
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
            <span className="text-sm text-slate-400">Name</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-200 font-mono">
                {state ? state.name : "..."}
              </span>
              <span className="text-xs text-slate-600 bg-slate-800 px-2 py-0.5 rounded">immutable</span>
            </div>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
            <span className="text-sm text-slate-400">Symbol</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-200 font-mono">
                {state ? state.symbol : "..."}
              </span>
              <span className="text-xs text-slate-600 bg-slate-800 px-2 py-0.5 rounded">immutable</span>
            </div>
          </div>
          <div className="flex justify-between items-start py-2">
            <span className="text-sm text-slate-400">URI</span>
            <span className="text-sm text-slate-200 font-mono break-all text-right max-w-[70%]">
              {state ? (state.uri || "(empty)") : "..."}
            </span>
          </div>
        </div>
      </div>

      {/* Update URI */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-indigo-400 mb-2">Update Metadata URI</h2>
        <p className="text-xs text-slate-500 mb-4">
          Update the metadata URI for this stablecoin. Only the master authority can perform this action.
          Name and symbol are immutable after initialization.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">New URI</label>
            <input
              type="text"
              value={newUri}
              onChange={(e) => setNewUri(e.target.value)}
              placeholder="https://example.com/metadata.json"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
          </div>
          <button
            onClick={handleUpdateMetadata}
            disabled={updating || !newUri || !publicKey}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {updating ? "Updating..." : "Update URI"}
          </button>
        </div>
      </div>
    </div>
  );
}
