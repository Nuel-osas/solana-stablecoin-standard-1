import { useState, useCallback, useEffect } from "react";
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
  const [removeManualAddress, setRemoveManualAddress] = useState("");
  const [useManualRemove, setUseManualRemove] = useState(false);
  const [checkAddress, setCheckAddress] = useState("");
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [knownBlacklisted, setKnownBlacklisted] = useState<{address: string, reason: string}[]>([]);
  const [loadingBlacklist, setLoadingBlacklist] = useState(false);

  // Fetch all blacklisted addresses from on-chain
  const fetchBlacklisted = useCallback(async () => {
    if (!program || !mintAddress) return;
    try {
      setLoadingBlacklist(true);
      const mint = new PublicKey(mintAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);

      // Fetch all BlacklistEntry accounts filtered by stablecoin PDA (offset 8 = after discriminator)
      const entries = await (program.account as any).blacklistEntry.all([
        { memcmp: { offset: 8, bytes: stablecoinPDA.toBase58() } },
      ]);

      const active = entries
        .filter((e: any) => e.account.active)
        .map((e: any) => ({
          address: e.account.address.toBase58(),
          reason: e.account.reason,
        }));

      setKnownBlacklisted(active);
    } catch (err: any) {
      console.error("Failed to fetch blacklist:", err);
    } finally {
      setLoadingBlacklist(false);
    }
  }, [program, mintAddress]);

  // Fetch on mount and when mint/program changes
  useEffect(() => {
    fetchBlacklisted();
  }, [fetchBlacklisted]);

  const fillMyWallet = useCallback(
    (setter: (val: string) => void) => {
      if (publicKey) {
        setter(publicKey.toBase58());
      } else {
        toast.error("Wallet not connected");
      }
    },
    [publicKey]
  );

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
      fetchBlacklisted();
      setAddAddress("");
      setAddReason("");
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setAdding(false);
    }
  };

  const effectiveRemoveAddress = useManualRemove ? removeManualAddress : removeAddress;

  const handleRemove = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setRemoving(true);
      const mint = new PublicKey(mintAddress);
      const address = new PublicKey(effectiveRemoveAddress);
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
      fetchBlacklisted();
      setRemoveAddress("");
      setRemoveManualAddress("");
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
          <div className="flex gap-2">
            <input
              type="text"
              value={checkAddress}
              onChange={(e) => setCheckAddress(e.target.value.trim())}
              placeholder="Address to check"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
            <button
              onClick={() => fillMyWallet(setCheckAddress)}
              className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
              title="Use my wallet address"
            >
              My Wallet
            </button>
          </div>
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
            <div className="flex gap-2">
              <input
                type="text"
                value={addAddress}
                onChange={(e) => setAddAddress(e.target.value.trim())}
                placeholder="Address to blacklist"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
              <button
                onClick={() => fillMyWallet(setAddAddress)}
                className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                title="Use my wallet address"
              >
                My Wallet
              </button>
            </div>
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
          {knownBlacklisted.length > 0 && !useManualRemove ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-slate-400">Select blacklisted address</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => fetchBlacklisted()}
                    className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    {loadingBlacklist ? "Loading..." : "Refresh"}
                  </button>
                  <button
                    onClick={() => setUseManualRemove(true)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Enter manually
                  </button>
                </div>
              </div>
              <select
                value={removeAddress}
                onChange={(e) => setRemoveAddress(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono appearance-none cursor-pointer"
              >
                <option value="" className="text-slate-500">-- Select an address --</option>
                {knownBlacklisted.map((entry) => (
                  <option key={entry.address} value={entry.address}>
                    {shortenAddress(entry.address)} — {entry.reason}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {knownBlacklisted.length} blacklisted address{knownBlacklisted.length !== 1 ? "es" : ""} on-chain
              </p>
            </div>
          ) : (
            <div>
              {knownBlacklisted.length > 0 && (
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm text-slate-400">Address to remove</label>
                  <button
                    onClick={() => {
                      setUseManualRemove(false);
                      setRemoveManualAddress("");
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Select from list
                  </button>
                </div>
              )}
              {knownBlacklisted.length === 0 && (
                <div className="mb-2 p-2 rounded-lg bg-slate-800/50 border border-slate-700/50">
                  <p className="text-xs text-slate-500">
                    {loadingBlacklist ? "Loading blacklisted addresses..." : "No blacklisted addresses found on-chain for this mint."}
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={removeManualAddress}
                  onChange={(e) => setRemoveManualAddress(e.target.value.trim())}
                  placeholder="Address to remove from blacklist"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
                <button
                  onClick={() => fillMyWallet(setRemoveManualAddress)}
                  className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                  title="Use my wallet address"
                >
                  My Wallet
                </button>
              </div>
            </div>
          )}
          <button
            onClick={handleRemove}
            disabled={removing || !effectiveRemoveAddress || !publicKey}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {removing ? "Removing..." : "Remove from Blacklist"}
          </button>
        </div>
      </div>
    </div>
  );
}
