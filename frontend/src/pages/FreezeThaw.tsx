import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, ParsedAccountData } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import toast from "react-hot-toast";
import { useStablecoin } from "../hooks/useStablecoin";
import { parseError } from "../utils/errors";
import {
  deriveStablecoinPDA,
  deriveRoleAssignmentPDA,
  shortenAddress,
} from "../utils/pda";

interface Props {
  mintAddress: string;
}

interface FrozenAccountInfo {
  address: string;
  owner: string;
}

export default function FreezeThaw({ mintAddress }: Props) {
  const { state, program, refetch } = useStablecoin(mintAddress);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [freezeAddress, setFreezeAddress] = useState("");
  const [thawAddress, setThawAddress] = useState("");
  const [checkAddress, setCheckAddress] = useState("");
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [freezing, setFreezing] = useState(false);
  const [thawing, setThawing] = useState(false);
  const [checking, setChecking] = useState(false);

  // Frozen accounts state
  const [frozenAccounts, setFrozenAccounts] = useState<FrozenAccountInfo[]>([]);
  const [loadingFrozen, setLoadingFrozen] = useState(false);
  const [useManualThaw, setUseManualThaw] = useState(false);

  const fetchFrozenAccounts = useCallback(async () => {
    if (!mintAddress) {
      setFrozenAccounts([]);
      return;
    }
    try {
      setLoadingFrozen(true);
      const mint = new PublicKey(mintAddress);
      const largestAccounts = await connection.getTokenLargestAccounts(mint);

      const frozen: FrozenAccountInfo[] = [];
      for (const acct of largestAccounts.value) {
        const acctInfo = await connection.getAccountInfo(acct.address);
        if (!acctInfo) continue;

        // Byte 108 is the account state: 2 = Frozen
        const accountState = acctInfo.data[108];
        if (accountState === 2) {
          // Also fetch parsed info to get the owner wallet
          const parsedInfo = await connection.getParsedAccountInfo(acct.address);
          const parsed = (parsedInfo.value?.data as ParsedAccountData)?.parsed?.info;
          const owner = parsed?.owner as string || acct.address.toBase58();

          frozen.push({
            address: acct.address.toBase58(),
            owner,
          });
        }
      }

      setFrozenAccounts(frozen);
      // Reset selection when list refreshes
      if (frozen.length > 0) {
        setThawAddress(frozen[0].owner);
        setUseManualThaw(false);
      } else {
        setThawAddress("");
      }
    } catch (err: any) {
      console.error("Failed to fetch frozen accounts:", err);
      setFrozenAccounts([]);
    } finally {
      setLoadingFrozen(false);
    }
  }, [mintAddress, connection]);

  useEffect(() => {
    fetchFrozenAccounts();
  }, [fetchFrozenAccounts]);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to manage freeze/thaw operations.</p>
      </div>
    );
  }

  const handleFreeze = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setFreezing(true);
      const mint = new PublicKey(mintAddress);
      const target = new PublicKey(freezeAddress);
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

      const targetAccount = getAssociatedTokenAddressSync(
        mint,
        target,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      const tx = await (program.methods as any)
        .freezeAccount()
        .accounts({
          authority: publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment: isAuthority ? null : roleAssignment,
          targetAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Account frozen! Tx: ${sig.slice(0, 8)}...`);
      setFreezeAddress("");
      // Refresh frozen accounts list after freezing
      fetchFrozenAccounts();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setFreezing(false);
    }
  };

  const handleThaw = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setThawing(true);
      const mint = new PublicKey(mintAddress);
      const target = new PublicKey(thawAddress);
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

      const targetAccount = getAssociatedTokenAddressSync(
        mint,
        target,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      const tx = await (program.methods as any)
        .thawAccount()
        .accounts({
          authority: publicKey,
          stablecoin: stablecoinPDA,
          mint,
          roleAssignment: isAuthority ? null : roleAssignment,
          targetAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Account thawed! Tx: ${sig.slice(0, 8)}...`);
      setThawAddress("");
      // Refresh frozen accounts list after thawing
      fetchFrozenAccounts();
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setThawing(false);
    }
  };

  const handleCheckStatus = async () => {
    try {
      setChecking(true);
      setCheckResult(null);
      const mint = new PublicKey(mintAddress);
      const target = new PublicKey(checkAddress);

      const targetAccount = getAssociatedTokenAddressSync(
        mint,
        target,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      const accountInfo = await connection.getAccountInfo(targetAccount);
      if (!accountInfo) {
        setCheckResult(`NO ACCOUNT - No token account found for ${shortenAddress(target.toBase58())}. The wallet may not hold this token.`);
        return;
      }

      // Parse the token account data to check frozen state
      // Token-2022 account layout: the state byte is at offset 108
      // State: 0 = Uninitialized, 1 = Initialized, 2 = Frozen
      const data = accountInfo.data;
      const accountState = data[108];

      if (accountState === 2) {
        setCheckResult(`FROZEN - The token account for ${shortenAddress(target.toBase58())} is currently frozen.`);
      } else if (accountState === 1) {
        setCheckResult(`ACTIVE - The token account for ${shortenAddress(target.toBase58())} is not frozen.`);
      } else {
        setCheckResult(`UNKNOWN - Unexpected account state (${accountState}).`);
      }
    } catch (err: any) {
      setCheckResult(`ERROR - Could not check status: ${err.message}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Freeze / Thaw Accounts</h1>

      {/* Check Freeze Status */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Check Freeze Status
        </h2>
        <div className="space-y-4">
          <input
            type="text"
            value={checkAddress}
            onChange={(e) => setCheckAddress(e.target.value.trim())}
            placeholder="Wallet address to check"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
          <button
            onClick={handleCheckStatus}
            disabled={checking || !checkAddress}
            className="w-full py-2.5 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {checking ? "Checking..." : "Check Freeze Status"}
          </button>
          {checkResult && (
            <div
              className={`p-4 rounded-lg text-sm ${
                checkResult.startsWith("FROZEN")
                  ? "bg-cyan-900/30 border border-cyan-800/50 text-cyan-300"
                  : checkResult.startsWith("ACTIVE")
                  ? "bg-emerald-900/30 border border-emerald-800/50 text-emerald-300"
                  : "bg-yellow-900/30 border border-yellow-800/50 text-yellow-300"
              }`}
            >
              {checkResult}
            </div>
          )}
        </div>
      </div>

      {/* Side-by-side Freeze / Thaw */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Freeze Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-cyan-400 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
            </svg>
            Freeze Account
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Wallet Address</label>
              <input
                type="text"
                value={freezeAddress}
                onChange={(e) => setFreezeAddress(e.target.value.trim())}
                placeholder="Address to freeze"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
              />
            </div>
            <button
              onClick={handleFreeze}
              disabled={freezing || !freezeAddress || !publicKey}
              className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
            >
              {freezing ? "Freezing..." : "Freeze Account"}
            </button>
          </div>
        </div>

        {/* Thaw Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-emerald-400 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
            </svg>
            Thaw Account
          </h2>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-slate-400">
                  {useManualThaw ? "Wallet Address" : "Frozen Account"}
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchFrozenAccounts}
                    disabled={loadingFrozen}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors disabled:text-slate-500"
                    title="Refresh frozen accounts list"
                  >
                    {loadingFrozen ? (
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                  </button>
                  {frozenAccounts.length === 0 && !loadingFrozen && (
                    <button
                      onClick={() => {
                        setUseManualThaw(!useManualThaw);
                        setThawAddress("");
                      }}
                      className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {useManualThaw ? "Use dropdown" : "Enter manually"}
                    </button>
                  )}
                </div>
              </div>

              {loadingFrozen ? (
                <div className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-500 flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Scanning for frozen accounts...
                </div>
              ) : frozenAccounts.length > 0 && !useManualThaw ? (
                <select
                  value={thawAddress}
                  onChange={(e) => setThawAddress(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 0.5rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.5em 1.5em',
                    paddingRight: '2.5rem',
                  }}
                >
                  {frozenAccounts.map((acct) => (
                    <option key={acct.address} value={acct.owner}>
                      {shortenAddress(acct.owner, 6)} (token: {shortenAddress(acct.address, 4)})
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  {frozenAccounts.length === 0 && !useManualThaw && (
                    <div className="mb-2 px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-xs text-slate-500">
                      No frozen accounts found.{" "}
                      <button
                        onClick={() => setUseManualThaw(true)}
                        className="text-emerald-400 hover:text-emerald-300 underline"
                      >
                        Enter address manually
                      </button>
                    </div>
                  )}
                  {(useManualThaw || (frozenAccounts.length === 0 && useManualThaw)) && (
                    <input
                      type="text"
                      value={thawAddress}
                      onChange={(e) => setThawAddress(e.target.value.trim())}
                      placeholder="Address to thaw"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  )}
                </>
              )}
            </div>

            {frozenAccounts.length > 0 && !useManualThaw && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {frozenAccounts.length} frozen account{frozenAccounts.length !== 1 ? "s" : ""} found
                </span>
                <button
                  onClick={() => {
                    setUseManualThaw(true);
                    setThawAddress("");
                  }}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Enter manually instead
                </button>
              </div>
            )}

            {useManualThaw && frozenAccounts.length > 0 && (
              <button
                onClick={() => {
                  setUseManualThaw(false);
                  setThawAddress(frozenAccounts[0].owner);
                }}
                className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                Back to dropdown ({frozenAccounts.length} frozen)
              </button>
            )}

            <button
              onClick={handleThaw}
              disabled={thawing || !thawAddress || !publicKey}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
            >
              {thawing ? "Thawing..." : "Thaw Account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
