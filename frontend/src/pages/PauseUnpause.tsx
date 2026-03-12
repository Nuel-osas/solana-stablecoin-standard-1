import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import toast from "react-hot-toast";
import { useStablecoin } from "../hooks/useStablecoin";
import { parseError } from "../utils/errors";
import {
  deriveStablecoinPDA,
  deriveRoleAssignmentPDA,
} from "../utils/pda";

interface Props {
  mintAddress: string;
}

export default function PauseUnpause({ mintAddress }: Props) {
  const { state, program, refetch } = useStablecoin(mintAddress);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [loading, setLoading] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to manage pause state.</p>
      </div>
    );
  }

  const isPaused = state?.paused ?? false;

  const handleToggle = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setLoading(true);
      const mint = new PublicKey(mintAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [roleAssignment] = deriveRoleAssignmentPDA(stablecoinPDA, "pauser", publicKey);

      const isAuthority = state.authority.equals(publicKey);

      // Check if wallet has pauser role or is authority
      if (!isAuthority) {
        const roleInfo = await connection.getAccountInfo(roleAssignment);
        if (!roleInfo) {
          toast.error("You don't have the Pauser role. Ask the authority to assign it via the Roles page.");
          return;
        }
      }

      const method = isPaused ? "unpause" : "pause";

      const tx = await (program.methods as any)
        [method]()
        .accounts({
          pauser: publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: isAuthority ? null : roleAssignment,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(
        isPaused
          ? `Stablecoin unpaused! Tx: ${sig.slice(0, 8)}...`
          : `Stablecoin paused! Tx: ${sig.slice(0, 8)}...`
      );
      refetch();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Pause / Unpause</h1>

      {/* Current Status */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center space-y-6">
        <div>
          <p className="text-sm text-slate-400 mb-2">Current Status</p>
          <div
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-lg font-semibold ${
              isPaused
                ? "bg-red-900/40 border border-red-700/50 text-red-400"
                : "bg-emerald-900/40 border border-emerald-700/50 text-emerald-400"
            }`}
          >
            <span
              className={`w-3 h-3 rounded-full ${
                isPaused ? "bg-red-500 animate-pulse" : "bg-emerald-500"
              }`}
            />
            {isPaused ? "PAUSED" : "ACTIVE"}
          </div>
        </div>

        {/* Toggle Button */}
        <button
          onClick={handleToggle}
          disabled={loading || !publicKey || !state}
          className={`w-full py-4 text-lg font-semibold rounded-xl transition-colors ${
            isPaused
              ? "bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white"
              : "bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white"
          }`}
        >
          {loading
            ? isPaused
              ? "Unpausing..."
              : "Pausing..."
            : isPaused
            ? "Unpause Stablecoin"
            : "Pause Stablecoin"}
        </button>

        {!publicKey && (
          <p className="text-sm text-slate-500">Connect your wallet to toggle pause state.</p>
        )}
      </div>

      {/* Warning */}
      <div className="bg-amber-900/20 border border-amber-800/40 rounded-xl p-4">
        <p className="text-amber-400 text-sm font-medium mb-1">Warning</p>
        <p className="text-amber-300/70 text-sm leading-relaxed">
          Pausing the stablecoin stops <strong>all</strong> token operations globally — minting,
          burning, and transfers will be blocked for every holder until the contract is unpaused.
          Only wallets with the <strong>Pauser</strong> role or the authority can toggle this.
        </p>
      </div>
    </div>
  );
}
