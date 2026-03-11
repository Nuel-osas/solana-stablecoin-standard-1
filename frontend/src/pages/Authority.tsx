import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import toast from "react-hot-toast";
import BN from "bn.js";
import { useStablecoin } from "../hooks/useStablecoin";
import { deriveStablecoinPDA } from "../utils/pda";
import { parseError } from "../utils/errors";

interface Props {
  mintAddress: string;
}

export default function Authority({ mintAddress }: Props) {
  const { state, program, refetch } = useStablecoin(mintAddress);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [newAuthority, setNewAuthority] = useState("");
  const [nominating, setNominating] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const [supplyCap, setSupplyCap] = useState("");
  const [settingCap, setSettingCap] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to manage authority & supply cap.</p>
      </div>
    );
  }

  const handleNominate = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setNominating(true);
      const mint = new PublicKey(mintAddress);
      const newAuth = new PublicKey(newAuthority);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);

      if (!state.authority.equals(publicKey)) {
        toast.error("Only the current master authority can nominate a new authority.");
        return;
      }

      const tx = await (program.methods as any)
        .nominateAuthority(newAuth)
        .accounts({
          authority: publicKey,
          stablecoin: stablecoinPDA,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Authority nominated! Tx: ${sig.slice(0, 8)}...`);
      setNewAuthority("");
      refetch();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setNominating(false);
    }
  };

  const handleAccept = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setAccepting(true);
      const mint = new PublicKey(mintAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);

      if (!state.pendingAuthority.equals(publicKey)) {
        toast.error("Only the nominated pending authority can accept.");
        return;
      }

      const tx = await (program.methods as any)
        .acceptAuthority()
        .accounts({
          newAuthority: publicKey,
          stablecoin: stablecoinPDA,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Authority transferred! Tx: ${sig.slice(0, 8)}...`);
      refetch();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setAccepting(false);
    }
  };

  const handleSetSupplyCap = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setSettingCap(true);
      const mint = new PublicKey(mintAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);

      if (!state.authority.equals(publicKey)) {
        toast.error("Only the master authority can set the supply cap.");
        return;
      }

      const capValue = supplyCap === "" || supplyCap === "0"
        ? new BN(0)
        : new BN(Number(supplyCap) * Math.pow(10, state.decimals));

      const tx = await (program.methods as any)
        .setSupplyCap(capValue)
        .accounts({
          authority: publicKey,
          stablecoin: stablecoinPDA,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Supply cap updated! Tx: ${sig.slice(0, 8)}...`);
      setSupplyCap("");
      refetch();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setSettingCap(false);
    }
  };

  const isDefaultPubkey = state?.pendingAuthority.equals(PublicKey.default);
  const currentCap = state
    ? state.supplyCap.toNumber() === 0
      ? "Unlimited"
      : (state.supplyCap.toNumber() / Math.pow(10, state.decimals)).toLocaleString()
    : "...";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Authority & Supply Cap</h1>

      {/* Current state */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Current State</h2>
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
            <span className="text-sm text-slate-400">Authority</span>
            <span className="text-sm text-slate-200 font-mono">
              {state ? state.authority.toBase58() : "..."}
            </span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
            <span className="text-sm text-slate-400">Pending Authority</span>
            <span className={`text-sm font-mono ${isDefaultPubkey ? "text-slate-500" : "text-amber-400"}`}>
              {state ? (isDefaultPubkey ? "None" : state.pendingAuthority.toBase58()) : "..."}
            </span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-sm text-slate-400">Supply Cap</span>
            <span className="text-sm text-slate-200">{currentCap}</span>
          </div>
        </div>
      </div>

      {/* Nominate authority */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-indigo-400 mb-2">Nominate New Authority</h2>
        <p className="text-xs text-slate-500 mb-4">
          Step 1 of 2: Nominate a new authority. They must call "Accept" to complete the transfer.
          This two-step process prevents accidental loss from typos.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">New Authority Address</label>
            <input
              type="text"
              value={newAuthority}
              onChange={(e) => setNewAuthority(e.target.value.trim())}
              placeholder="Wallet address of the new authority"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
          </div>
          <button
            onClick={handleNominate}
            disabled={nominating || !newAuthority || !publicKey}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {nominating ? "Nominating..." : "Nominate Authority"}
          </button>
        </div>
      </div>

      {/* Accept authority */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-emerald-400 mb-2">Accept Authority</h2>
        <p className="text-xs text-slate-500 mb-4">
          Step 2 of 2: If you are the nominated pending authority, click to accept and become the new master authority.
        </p>
        {state && !isDefaultPubkey ? (
          <div className="space-y-4">
            <div className="bg-amber-900/20 border border-amber-800/40 rounded-lg px-4 py-3">
              <p className="text-sm text-amber-400">
                Pending authority: <span className="font-mono">{state.pendingAuthority.toBase58()}</span>
              </p>
            </div>
            <button
              onClick={handleAccept}
              disabled={accepting || !publicKey}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
            >
              {accepting ? "Accepting..." : "Accept Authority"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No pending authority nomination.</p>
        )}
      </div>

      {/* Supply cap */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-amber-400 mb-2">Set Supply Cap</h2>
        <p className="text-xs text-slate-500 mb-4">
          Set the maximum total supply. Enforced on every mint. Set to 0 to remove the cap (unlimited).
          Current cap: <span className="text-slate-300">{currentCap}</span>
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">
              New Supply Cap (in tokens, e.g. 1000000)
            </label>
            <input
              type="number"
              value={supplyCap}
              onChange={(e) => setSupplyCap(e.target.value)}
              placeholder="0 = unlimited"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
            />
          </div>
          <button
            onClick={handleSetSupplyCap}
            disabled={settingCap || !publicKey}
            className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {settingCap ? "Setting..." : "Set Supply Cap"}
          </button>
        </div>
      </div>
    </div>
  );
}
