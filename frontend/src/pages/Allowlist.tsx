import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import toast from "react-hot-toast";
import { useStablecoin } from "../hooks/useStablecoin";
import { parseError } from "../utils/errors";
import {
  deriveStablecoinPDA,
  deriveAllowlistEntryPDA,
  shortenAddress,
} from "../utils/pda";

interface Props {
  mintAddress: string;
}

export default function Allowlist({ mintAddress }: Props) {
  const { state, program, refetch } = useStablecoin(mintAddress);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [addAddress, setAddAddress] = useState("");
  const [removeAddress, setRemoveAddress] = useState("");
  const [checkAddress, setCheckAddress] = useState("");
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [checking, setChecking] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to manage the allowlist.</p>
      </div>
    );
  }

  if (state && !state.enableAllowlist) {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <div className="bg-amber-900/20 border border-amber-800/50 rounded-xl p-6 text-center">
          <h3 className="text-amber-400 font-medium mb-2">Allowlist Not Enabled</h3>
          <p className="text-sm text-amber-300/70">
            This stablecoin does not have the allowlist feature enabled (SSS-3).
          </p>
        </div>
      </div>
    );
  }

  const handleAdd = async () => {
    if (!program || !publicKey) return;
    try {
      setAdding(true);
      const mint = new PublicKey(mintAddress);
      const address = new PublicKey(addAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [allowlistEntry] = deriveAllowlistEntryPDA(stablecoinPDA, address);

      // Only the authority can manage the allowlist
      if (!state || !state.authority.equals(publicKey)) {
        toast.error("Only the master authority can manage the allowlist.");
        return;
      }

      const tx = await (program.methods as any)
        .addToAllowlist(address)
        .accounts({
          authority: publicKey,
          stablecoin: stablecoinPDA,
          allowlistEntry,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Address added to allowlist! Tx: ${sig.slice(0, 8)}...`);
      setAddAddress("");
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async () => {
    if (!program || !publicKey) return;
    try {
      setRemoving(true);
      const mint = new PublicKey(mintAddress);
      const address = new PublicKey(removeAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [allowlistEntry] = deriveAllowlistEntryPDA(stablecoinPDA, address);

      // Only the authority can manage the allowlist
      if (!state || !state.authority.equals(publicKey)) {
        toast.error("Only the master authority can manage the allowlist.");
        return;
      }

      const tx = await (program.methods as any)
        .removeFromAllowlistEntry(address)
        .accounts({
          authority: publicKey,
          stablecoin: stablecoinPDA,
          allowlistEntry,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Address removed from allowlist! Tx: ${sig.slice(0, 8)}...`);
      setRemoveAddress("");
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setRemoving(false);
    }
  };

  const handleCheck = async () => {
    try {
      setChecking(true);
      setCheckResult(null);
      const mint = new PublicKey(mintAddress);
      const address = new PublicKey(checkAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [allowlistEntry] = deriveAllowlistEntryPDA(stablecoinPDA, address);

      const accountInfo = await connection.getAccountInfo(allowlistEntry);
      if (!accountInfo) {
        setCheckResult("NOT ON ALLOWLIST - No allowlist entry found for this address.");
      } else if (program) {
        const entry = await (program.account as any).allowlistEntry.fetch(allowlistEntry);
        setCheckResult(
          `ALLOWLISTED - Added by: ${shortenAddress(entry.addedBy.toBase58())} | Since: ${new Date(entry.addedAt.toNumber() * 1000).toLocaleString()}`
        );
      }
    } catch {
      setCheckResult("NOT ON ALLOWLIST - No entry found.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Allowlist Management</h1>
      <p className="text-sm text-slate-400">
        SSS-3 feature: Only allowlisted addresses can send/receive this stablecoin.
      </p>

      {/* Check */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-cyan-400 mb-4">Check Address</h2>
        <div className="space-y-4">
          <input
            type="text"
            value={checkAddress}
            onChange={(e) => setCheckAddress(e.target.value.trim())}
            placeholder="Address to check"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
          <button
            onClick={handleCheck}
            disabled={checking || !checkAddress}
            className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {checking ? "Checking..." : "Check Allowlist Status"}
          </button>
          {checkResult && (
            <div
              className={`p-4 rounded-lg text-sm ${
                checkResult.startsWith("ALLOWLISTED")
                  ? "bg-emerald-900/30 border border-emerald-800/50 text-emerald-300"
                  : "bg-amber-900/30 border border-amber-800/50 text-amber-300"
              }`}
            >
              {checkResult}
            </div>
          )}
        </div>
      </div>

      {/* Add */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-emerald-400 mb-4">Add to Allowlist</h2>
        <div className="space-y-4">
          <input
            type="text"
            value={addAddress}
            onChange={(e) => setAddAddress(e.target.value.trim())}
            placeholder="Address to add to allowlist"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !addAddress || !publicKey}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {adding ? "Adding..." : "Add to Allowlist"}
          </button>
        </div>
      </div>

      {/* Remove */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-red-400 mb-4">Remove from Allowlist</h2>
        <div className="space-y-4">
          <input
            type="text"
            value={removeAddress}
            onChange={(e) => setRemoveAddress(e.target.value.trim())}
            placeholder="Address to remove from allowlist"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
          <button
            onClick={handleRemove}
            disabled={removing || !removeAddress || !publicKey}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {removing ? "Removing..." : "Remove from Allowlist"}
          </button>
        </div>
      </div>
    </div>
  );
}
