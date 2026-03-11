import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import toast from "react-hot-toast";
import { useStablecoin } from "../hooks/useStablecoin";
import { parseError } from "../utils/errors";
import {
  deriveStablecoinPDA,
  deriveRoleAssignmentPDA,
  deriveBlacklistEntryPDA,
  shortenAddress,
} from "../utils/pda";

interface Props {
  mintAddress: string;
}

export default function Blacklist({ mintAddress }: Props) {
  const { state, program, refetch } = useStablecoin(mintAddress);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [addAddress, setAddAddress] = useState("");
  const [addReason, setAddReason] = useState("");
  const [removeAddress, setRemoveAddress] = useState("");
  const [checkAddress, setCheckAddress] = useState("");
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [checking, setChecking] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to manage the blacklist.</p>
      </div>
    );
  }

  const handleAdd = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setAdding(true);
      const mint = new PublicKey(mintAddress);
      const address = new PublicKey(addAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [roleAssignment] = deriveRoleAssignmentPDA(stablecoinPDA, "blacklister", publicKey);
      const [blacklistEntry] = deriveBlacklistEntryPDA(stablecoinPDA, address);

      const isAuthority = state.authority.equals(publicKey);

      // Check if wallet has blacklister role or is authority
      if (!isAuthority) {
        const roleInfo = await connection.getAccountInfo(roleAssignment);
        if (!roleInfo) {
          toast.error("You don't have the Blacklister role. Ask the authority to assign it via the Roles page.");
          return;
        }
      }

      const tx = await (program.methods as any)
        .addToBlacklist(address, addReason)
        .accounts({
          blacklister: publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: isAuthority ? null : roleAssignment,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Address blacklisted! Tx: ${sig.slice(0, 8)}...`);
      setAddAddress("");
      setAddReason("");
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setRemoving(true);
      const mint = new PublicKey(mintAddress);
      const address = new PublicKey(removeAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [roleAssignment] = deriveRoleAssignmentPDA(stablecoinPDA, "blacklister", publicKey);
      const [blacklistEntry] = deriveBlacklistEntryPDA(stablecoinPDA, address);

      const isAuthority = state.authority.equals(publicKey);

      // Check if wallet has blacklister role or is authority
      if (!isAuthority) {
        const roleInfo = await connection.getAccountInfo(roleAssignment);
        if (!roleInfo) {
          toast.error("You don't have the Blacklister role. Ask the authority to assign it via the Roles page.");
          return;
        }
      }

      const tx = await (program.methods as any)
        .removeFromBlacklist(address)
        .accounts({
          blacklister: publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: isAuthority ? null : roleAssignment,
          blacklistEntry,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Address removed from blacklist! Tx: ${sig.slice(0, 8)}...`);
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
      const [blacklistEntry] = deriveBlacklistEntryPDA(stablecoinPDA, address);

      const accountInfo = await connection.getAccountInfo(blacklistEntry);
      if (!accountInfo) {
        setCheckResult("NOT BLACKLISTED - No blacklist entry found for this address.");
      } else if (program) {
        const entry = await (program.account as any).blacklistEntry.fetch(blacklistEntry);
        if (entry.active) {
          setCheckResult(
            `BLACKLISTED - Reason: "${entry.reason}" | By: ${shortenAddress(entry.blacklistedBy.toBase58())} | Since: ${new Date(entry.blacklistedAt.toNumber() * 1000).toLocaleString()}`
          );
        } else {
          setCheckResult("NOT BLACKLISTED - Entry exists but is inactive (was removed).");
        }
      }
    } catch (err: any) {
      setCheckResult("NOT BLACKLISTED - No entry found.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Blacklist Management</h1>

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
            {checking ? "Checking..." : "Check Blacklist Status"}
          </button>
          {checkResult && (
            <div
              className={`p-4 rounded-lg text-sm ${
                checkResult.startsWith("BLACKLISTED")
                  ? "bg-red-900/30 border border-red-800/50 text-red-300"
                  : "bg-emerald-900/30 border border-emerald-800/50 text-emerald-300"
              }`}
            >
              {checkResult}
            </div>
          )}
        </div>
      </div>

      {/* Add */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-red-400 mb-4">Add to Blacklist</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Address</label>
            <input
              type="text"
              value={addAddress}
              onChange={(e) => setAddAddress(e.target.value.trim())}
              placeholder="Address to blacklist"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Reason</label>
            <input
              type="text"
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              placeholder="Reason for blacklisting"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={adding || !addAddress || !addReason || !publicKey}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {adding ? "Adding..." : "Add to Blacklist"}
          </button>
        </div>
      </div>

      {/* Remove */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-emerald-400 mb-4">Remove from Blacklist</h2>
        <div className="space-y-4">
          <input
            type="text"
            value={removeAddress}
            onChange={(e) => setRemoveAddress(e.target.value.trim())}
            placeholder="Address to remove from blacklist"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
          <button
            onClick={handleRemove}
            disabled={removing || !removeAddress || !publicKey}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {removing ? "Removing..." : "Remove from Blacklist"}
          </button>
        </div>
      </div>
    </div>
  );
}
