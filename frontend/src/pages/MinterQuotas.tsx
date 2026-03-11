import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import toast from "react-hot-toast";
import BN from "bn.js";
import { useStablecoin } from "../hooks/useStablecoin";
import {
  deriveStablecoinPDA,
  deriveMinterInfoPDA,
  deriveRoleAssignmentPDA,
} from "../utils/pda";
import { parseError } from "../utils/errors";

interface Props {
  mintAddress: string;
}

interface MinterQuotaInfo {
  minter: string;
  quota: string;
  totalMinted: string;
  remaining: string;
}

export default function MinterQuotas({ mintAddress }: Props) {
  const { state, program, refetch } = useStablecoin(mintAddress);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [checkAddress, setCheckAddress] = useState("");
  const [quotaInfo, setQuotaInfo] = useState<MinterQuotaInfo | null>(null);
  const [checking, setChecking] = useState(false);

  const [updateAddress, setUpdateAddress] = useState("");
  const [newQuota, setNewQuota] = useState("");
  const [updating, setUpdating] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to manage minter quotas.</p>
      </div>
    );
  }

  const handleCheck = async () => {
    if (!program || !state) return;
    try {
      setChecking(true);
      setQuotaInfo(null);
      const mint = new PublicKey(mintAddress);
      const minter = new PublicKey(checkAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [minterInfoPDA] = deriveMinterInfoPDA(stablecoinPDA, minter);

      const info = await connection.getAccountInfo(minterInfoPDA);
      if (!info) {
        toast.error("No minter info found. This address may not have the minter role.");
        return;
      }

      const minterInfo = await (program.account as any).minterInfo.fetch(minterInfoPDA);
      const decimals = state.decimals;
      const quota = minterInfo.quota.toNumber();
      const totalMinted = minterInfo.totalMinted.toNumber();
      const remaining = Math.max(0, quota - totalMinted);

      setQuotaInfo({
        minter: minter.toBase58(),
        quota: quota === 0 ? "Unlimited" : (quota / Math.pow(10, decimals)).toLocaleString(),
        totalMinted: (totalMinted / Math.pow(10, decimals)).toLocaleString(),
        remaining: quota === 0 ? "Unlimited" : (remaining / Math.pow(10, decimals)).toLocaleString(),
      });
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setChecking(false);
    }
  };

  const handleUpdate = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setUpdating(true);
      const mint = new PublicKey(mintAddress);
      const minter = new PublicKey(updateAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [minterInfoPDA] = deriveMinterInfoPDA(stablecoinPDA, minter);

      if (!state.authority.equals(publicKey)) {
        toast.error("Only the master authority can update minter quotas.");
        return;
      }

      const quotaValue = newQuota === "" || newQuota === "0"
        ? new BN(0)
        : new BN(Number(newQuota) * Math.pow(10, state.decimals));

      const tx = await (program.methods as any)
        .updateMinterQuota(quotaValue)
        .accounts({
          authority: publicKey,
          stablecoin: stablecoinPDA,
          minterInfo: minterInfoPDA,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Quota updated! Tx: ${sig.slice(0, 8)}...`);
      setNewQuota("");
      refetch();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Minter Quotas</h1>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <p className="text-sm text-slate-400">
          Each minter has an individual quota limiting how many tokens they can mint.
          The master authority can update quotas at any time. A quota of 0 means unlimited.
        </p>
      </div>

      {/* Check quota */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-cyan-400 mb-4">Check Minter Quota</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Minter Address</label>
            <input
              type="text"
              value={checkAddress}
              onChange={(e) => setCheckAddress(e.target.value.trim())}
              placeholder="Wallet address of the minter"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
            />
          </div>
          <button
            onClick={handleCheck}
            disabled={checking || !checkAddress}
            className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {checking ? "Checking..." : "Check Quota"}
          </button>
          {quotaInfo && (
            <div className="bg-slate-800/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-slate-400">Minter</span>
                <span className="text-sm text-slate-200 font-mono">{quotaInfo.minter.slice(0, 8)}...{quotaInfo.minter.slice(-4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-400">Quota</span>
                <span className="text-sm text-slate-200">{quotaInfo.quota}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-400">Total Minted</span>
                <span className="text-sm text-slate-200">{quotaInfo.totalMinted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-400">Remaining</span>
                <span className="text-sm text-emerald-400 font-medium">{quotaInfo.remaining}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Update quota */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-amber-400 mb-2">Update Minter Quota</h2>
        <p className="text-xs text-slate-500 mb-4">
          Only the master authority ({state ? state.authority.toBase58().slice(0, 8) + "..." : "..."}) can update quotas.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Minter Address</label>
            <input
              type="text"
              value={updateAddress}
              onChange={(e) => setUpdateAddress(e.target.value.trim())}
              placeholder="Wallet address of the minter"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">New Quota (in tokens, 0 = unlimited)</label>
            <input
              type="number"
              value={newQuota}
              onChange={(e) => setNewQuota(e.target.value)}
              placeholder="0 = unlimited"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
            />
          </div>
          <button
            onClick={handleUpdate}
            disabled={updating || !updateAddress || !publicKey}
            className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {updating ? "Updating..." : "Update Quota"}
          </button>
        </div>
      </div>
    </div>
  );
}
