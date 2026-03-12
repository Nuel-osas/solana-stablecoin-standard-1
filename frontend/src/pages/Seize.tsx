import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedWithTransferHookInstruction,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
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

export default function Seize({ mintAddress }: Props) {
  const { state, program } = useStablecoin(mintAddress);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [sourceAddress, setSourceAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [seizing, setSeizing] = useState(false);
  const [useManualSource, setUseManualSource] = useState(false);
  const [manualSourceAddress, setManualSourceAddress] = useState("");
  const [blacklistedAddresses, setBlacklistedAddresses] = useState<{address: string, reason: string}[]>([]);
  const [loadingBlacklist, setLoadingBlacklist] = useState(false);

  // Fetch blacklisted addresses from on-chain
  const fetchBlacklisted = useCallback(async () => {
    if (!program || !mintAddress) return;
    try {
      setLoadingBlacklist(true);
      const mint = new PublicKey(mintAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const entries = await (program.account as any).blacklistEntry.all([
        { memcmp: { offset: 8, bytes: stablecoinPDA.toBase58() } },
      ]);
      const active = entries
        .filter((e: any) => e.account.active)
        .map((e: any) => ({
          address: e.account.address.toBase58(),
          reason: e.account.reason,
        }));
      setBlacklistedAddresses(active);
    } catch (err: any) {
      console.error("Failed to fetch blacklist:", err);
    } finally {
      setLoadingBlacklist(false);
    }
  }, [program, mintAddress]);

  useEffect(() => { fetchBlacklisted(); }, [fetchBlacklisted]);

  const effectiveSourceAddress = useManualSource ? manualSourceAddress : sourceAddress;

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to seize tokens.</p>
      </div>
    );
  }

  const permanentDelegateEnabled = state?.enablePermanentDelegate ?? false;

  const handleSeize = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setSeizing(true);
      const mint = new PublicKey(mintAddress);
      const sourceWallet = new PublicKey(effectiveSourceAddress);
      const destinationWallet = new PublicKey(destinationAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const [roleAssignment] = deriveRoleAssignmentPDA(stablecoinPDA, "seizer", publicKey);
      const [blacklistEntry] = deriveBlacklistEntryPDA(stablecoinPDA, sourceWallet);

      const isAuthority = state.authority.equals(publicKey);

      // Check if wallet has seizer role or is authority
      if (!isAuthority) {
        const roleInfo = await connection.getAccountInfo(roleAssignment);
        if (!roleInfo) {
          toast.error("You don't have the Seizer role. Ask the authority to assign it via the Roles page.");
          return;
        }
      }

      // Verify the source is actually blacklisted
      const blacklistInfo = await connection.getAccountInfo(blacklistEntry);
      if (!blacklistInfo) {
        toast.error("Source address is not blacklisted. You can only seize from blacklisted accounts.");
        return;
      }

      // Derive ATAs for source and destination
      const sourceATA = getAssociatedTokenAddressSync(
        mint, sourceWallet, false, TOKEN_2022_PROGRAM_ID
      );
      const destinationATA = getAssociatedTokenAddressSync(
        mint, destinationWallet, false, TOKEN_2022_PROGRAM_ID
      );

      // Resolve transfer hook extra accounts (seize does transfer_checked CPI)
      const decimals = state.decimals;
      const dummyIx = await createTransferCheckedWithTransferHookInstruction(
        connection,
        sourceATA,
        mint,
        destinationATA,
        stablecoinPDA,
        BigInt(1),
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID,
      );
      // Extra accounts start after the standard 4 (source, mint, dest, authority)
      const extraKeys = dummyIx.keys.slice(4);

      const tx = await (program.methods as any)
        .seize()
        .accounts({
          seizer: publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment: isAuthority ? null : roleAssignment,
          blacklistEntry,
          sourceAccount: sourceATA,
          treasuryAccount: destinationATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(extraKeys)
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Tokens seized successfully! Tx: ${sig.slice(0, 8)}...`);
      setSourceAddress("");
      setManualSourceAddress("");
      setDestinationAddress("");
      fetchBlacklisted();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setSeizing(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Seize Tokens</h1>

      {/* Warning banner */}
      <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-300">Irreversible Action</p>
            <p className="text-sm text-red-400 mt-1">
              This permanently transfers all tokens from a blacklisted account to the specified treasury wallet.
              This action cannot be undone.
            </p>
          </div>
        </div>
      </div>

      {/* SSS-2 requirement warning */}
      {state && !permanentDelegateEnabled && (
        <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-amber-300">Permanent Delegate Not Enabled</p>
              <p className="text-sm text-amber-400 mt-1">
                Seize requires SSS-2 (permanent delegate) to be enabled on this stablecoin.
                This feature is not available for the current mint.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Seize Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-red-400 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          Seize Tokens from Blacklisted Account
        </h2>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-slate-400">Source Address (blacklisted wallet)</label>
              <div className="flex gap-2">
                <button
                  onClick={() => fetchBlacklisted()}
                  className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  {loadingBlacklist ? "Loading..." : "Refresh"}
                </button>
                {blacklistedAddresses.length > 0 && (
                  <button
                    onClick={() => { setUseManualSource(!useManualSource); setManualSourceAddress(""); }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    {useManualSource ? "Select from list" : "Enter manually"}
                  </button>
                )}
              </div>
            </div>
            {blacklistedAddresses.length > 0 && !useManualSource ? (
              <div>
                <select
                  value={sourceAddress}
                  onChange={(e) => setSourceAddress(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono appearance-none cursor-pointer"
                >
                  <option value="">-- Select blacklisted address --</option>
                  {blacklistedAddresses.map((entry) => (
                    <option key={entry.address} value={entry.address}>
                      {shortenAddress(entry.address)} — {entry.reason}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  {blacklistedAddresses.length} blacklisted address{blacklistedAddresses.length !== 1 ? "es" : ""} on-chain
                </p>
              </div>
            ) : (
              <div>
                {blacklistedAddresses.length === 0 && (
                  <p className="text-xs text-slate-500 mb-2">
                    {loadingBlacklist ? "Loading blacklisted addresses..." : "No blacklisted addresses found on-chain."}
                  </p>
                )}
                <input
                  type="text"
                  value={manualSourceAddress}
                  onChange={(e) => setManualSourceAddress(e.target.value.trim())}
                  placeholder="Wallet address to seize tokens from"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                />
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Destination Address (treasury wallet)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value.trim())}
                placeholder="Treasury wallet address to receive seized tokens"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
              />
              {publicKey && (
                <button
                  onClick={() => setDestinationAddress(publicKey.toBase58())}
                  className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap"
                >
                  My Wallet
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">The wallet that will receive the seized tokens.</p>
          </div>
          <button
            onClick={handleSeize}
            disabled={seizing || !effectiveSourceAddress || !destinationAddress || !publicKey || (state != null && !permanentDelegateEnabled)}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {seizing ? "Seizing Tokens..." : "Seize Tokens"}
          </button>
        </div>
      </div>
    </div>
  );
}
