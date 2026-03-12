import { useState, useEffect, useCallback } from "react";
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

  const [knownMinters, setKnownMinters] = useState<string[]>([]);
  const [updateMode, setUpdateMode] = useState<"select" | "manual">("select");
  const [scanning, setScanning] = useState(false);

  // Add a minter to knownMinters if not already present
  const addKnownMinter = useCallback((address: string) => {
    setKnownMinters((prev) =>
      prev.includes(address) ? prev : [...prev, address]
    );
  }, []);

  // Check if an address is a minter (has MinterInfo PDA on-chain)
  const checkIfMinter = useCallback(
    async (address: PublicKey): Promise<boolean> => {
      if (!mintAddress) return false;
      try {
        const mint = new PublicKey(mintAddress);
        const [stablecoinPDA] = deriveStablecoinPDA(mint);
        const [minterInfoPDA] = deriveMinterInfoPDA(stablecoinPDA, address);
        const info = await connection.getAccountInfo(minterInfoPDA);
        return info !== null;
      } catch {
        return false;
      }
    },
    [mintAddress, connection]
  );

  // Auto-scan connected wallet on mount / wallet change
  useEffect(() => {
    if (!publicKey || !mintAddress) return;
    let cancelled = false;

    (async () => {
      const isMinter = await checkIfMinter(publicKey);
      if (!cancelled && isMinter) {
        addKnownMinter(publicKey.toBase58());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicKey, mintAddress, checkIfMinter, addKnownMinter]);

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
      const totalMinted = minterInfo.minted.toNumber();
      const remaining = Math.max(0, quota - totalMinted);

      const minterAddr = minter.toBase58();
      setQuotaInfo({
        minter: minterAddr,
        quota: quota === 0 ? "Unlimited" : (quota / Math.pow(10, decimals)).toLocaleString(),
        totalMinted: (totalMinted / Math.pow(10, decimals)).toLocaleString(),
        remaining: quota === 0 ? "Unlimited" : (remaining / Math.pow(10, decimals)).toLocaleString(),
      });

      // Add to known minters on successful check
      addKnownMinter(minterAddr);
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setChecking(false);
    }
  };

  const handleScanWallet = async () => {
    if (!publicKey || !mintAddress) return;
    setScanning(true);
    try {
      const isMinter = await checkIfMinter(publicKey);
      if (isMinter) {
        addKnownMinter(publicKey.toBase58());
        toast.success("Connected wallet is a minter!");
      } else {
        toast("Connected wallet is not a minter for this token.", { icon: "ℹ️" });
      }
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setScanning(false);
    }
  };

  const handleUpdate = async () => {
    if (!program || !publicKey || !state) return;
    const addrToUse = updateMode === "manual" ? updateAddress : updateAddress;
    if (!addrToUse) return;
    try {
      setUpdating(true);
      const mint = new PublicKey(mintAddress);
      const minter = new PublicKey(addrToUse);
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

  const shortenAddr = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-4)}`;

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
            <div className="flex gap-2">
              <input
                type="text"
                value={checkAddress}
                onChange={(e) => setCheckAddress(e.target.value.trim())}
                placeholder="Wallet address of the minter"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
              />
              {publicKey && (
                <button
                  onClick={() => setCheckAddress(publicKey.toBase58())}
                  className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-cyan-400 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  My Wallet
                </button>
              )}
            </div>
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

      {/* Scan minters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-purple-400 mb-2">Known Minters</h2>
        <p className="text-xs text-slate-500 mb-4">
          Discovered minters appear here. Check a minter quota above to add them, or scan your wallet.
        </p>
        <div className="space-y-3">
          {publicKey && (
            <button
              onClick={handleScanWallet}
              disabled={scanning}
              className="w-full py-2.5 bg-purple-600/20 hover:bg-purple-600/30 disabled:bg-slate-700 disabled:text-slate-500 text-purple-400 border border-purple-500/30 font-medium rounded-lg text-sm transition-colors"
            >
              {scanning ? "Scanning..." : "Scan Connected Wallet"}
            </button>
          )}
          {knownMinters.length === 0 ? (
            <p className="text-xs text-slate-600 text-center py-2">
              No minters discovered yet. Use &quot;Check Quota&quot; or &quot;Scan&quot; to find minters.
            </p>
          ) : (
            <div className="space-y-1">
              {knownMinters.map((addr) => (
                <div
                  key={addr}
                  className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2"
                >
                  <span className="text-sm text-slate-200 font-mono">
                    {shortenAddr(addr)}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setCheckAddress(addr);
                        handleCheck();
                      }}
                      className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      Check
                    </button>
                    <button
                      onClick={() => {
                        setUpdateMode("select");
                        setUpdateAddress(addr);
                      }}
                      className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                    >
                      Update
                    </button>
                  </div>
                </div>
              ))}
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
            {knownMinters.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={updateMode === "manual" ? "__manual__" : updateAddress}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__manual__") {
                      setUpdateMode("manual");
                      setUpdateAddress("");
                    } else {
                      setUpdateMode("select");
                      setUpdateAddress(val);
                    }
                  }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                >
                  <option value="" disabled>
                    Select a known minter...
                  </option>
                  {knownMinters.map((addr) => (
                    <option key={addr} value={addr}>
                      {shortenAddr(addr)}
                    </option>
                  ))}
                  <option value="__manual__">-- Enter address manually --</option>
                </select>
                {updateMode === "manual" && (
                  <input
                    type="text"
                    value={updateAddress}
                    onChange={(e) => setUpdateAddress(e.target.value.trim())}
                    placeholder="Paste minter wallet address"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                  />
                )}
              </div>
            ) : (
              <input
                type="text"
                value={updateAddress}
                onChange={(e) => setUpdateAddress(e.target.value.trim())}
                placeholder="Wallet address of the minter"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
              />
            )}
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
