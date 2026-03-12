import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { shortenAddress } from "../utils/pda";
import idl from "../idl/sss_token.json";

interface Props {
  mintAddress: string;
  onMintAddressChange: (addr: string) => void;
}

interface StablecoinEntry {
  mint: string;
  name: string;
  symbol: string;
  tier: string;
  tierColor: string;
}

function detectTier(account: any): { tier: string; tierColor: string } {
  const hasDelegate = account.enablePermanentDelegate;
  const hasHook = account.enableTransferHook;
  const hasAllowlist = account.enableAllowlist;

  if (hasAllowlist && hasHook && hasDelegate) {
    return { tier: "SSS-3", tierColor: "text-purple-400" };
  }
  if (hasHook && hasDelegate) {
    return { tier: "SSS-2", tierColor: "text-indigo-400" };
  }
  return { tier: "SSS-1", tierColor: "text-emerald-400" };
}

export default function MintAddressBar({ mintAddress, onMintAddressChange }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [stablecoins, setStablecoins] = useState<StablecoinEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchStablecoins = useCallback(async () => {
    if (!wallet.publicKey) {
      setStablecoins([]);
      return;
    }
    try {
      setLoading(true);
      const provider = new AnchorProvider(
        connection,
        wallet as any,
        { commitment: "confirmed" }
      );
      const program = new Program(idl as any, provider);

      // Fetch all Stablecoin accounts where authority = connected wallet
      // Authority is at offset 8 (after 8-byte discriminator)
      const accounts = await (program.account as any).stablecoin.all([
        { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } },
      ]);

      const entries: StablecoinEntry[] = accounts.map((a: any) => {
        const { tier, tierColor } = detectTier(a.account);
        return {
          mint: a.account.mint.toBase58(),
          name: a.account.name,
          symbol: a.account.symbol,
          tier,
          tierColor,
        };
      });

      setStablecoins(entries);
    } catch (err: any) {
      console.error("Failed to fetch stablecoins:", err);
    } finally {
      setLoading(false);
    }
  }, [connection, wallet.publicKey]);

  useEffect(() => {
    fetchStablecoins();
  }, [fetchStablecoins]);

  const selected = stablecoins.find(sc => sc.mint === mintAddress);

  return (
    <div className="px-4 md:px-6 py-3 bg-slate-900/60 border-b border-slate-800">
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-slate-400 whitespace-nowrap">
          Mint
        </label>

        {/* Always-editable text input */}
        <input
          type="text"
          value={mintAddress}
          onChange={(e) => onMintAddressChange(e.target.value.trim())}
          placeholder="Paste mint address or select from your tokens below"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
        />

        {mintAddress && (
          <>
            <button
              onClick={() => navigator.clipboard.writeText(mintAddress)}
              className="text-slate-500 hover:text-slate-300 text-xs whitespace-nowrap"
              title="Copy mint address"
            >
              Copy
            </button>
            <button
              onClick={() => onMintAddressChange("")}
              className="text-slate-500 hover:text-slate-300 text-xs whitespace-nowrap"
            >
              Clear
            </button>
          </>
        )}
      </div>

      {/* Your tokens dropdown — always visible if you have tokens */}
      {wallet.publicKey && (
        <div className="mt-2 flex items-center gap-2">
          {stablecoins.length > 0 ? (
            <>
              <label className="text-[10px] font-medium text-slate-500 whitespace-nowrap uppercase tracking-wider">
                My tokens
              </label>
              <select
                value={stablecoins.find(sc => sc.mint === mintAddress) ? mintAddress : ""}
                onChange={(e) => {
                  if (e.target.value) onMintAddressChange(e.target.value);
                }}
                className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono appearance-none cursor-pointer"
              >
                <option value="">-- Select from your stablecoins --</option>
                {stablecoins.map((sc) => (
                  <option key={sc.mint} value={sc.mint}>
                    [{sc.tier}] {sc.symbol} — {sc.name} ({shortenAddress(sc.mint)})
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="text-[10px] text-slate-600">
              {loading ? "Loading your tokens..." : "No tokens found for this wallet"}
            </span>
          )}
          <button
            onClick={fetchStablecoins}
            disabled={loading}
            className="text-[10px] text-cyan-400 hover:text-cyan-300 disabled:text-slate-600 transition-colors whitespace-nowrap"
          >
            {loading ? "..." : "Refresh"}
          </button>
        </div>
      )}

      {/* Selected token info */}
      {selected && (
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          <span className={`font-semibold ${selected.tierColor}`}>{selected.tier}</span>
          <span className="text-slate-400">{selected.name} ({selected.symbol})</span>
        </div>
      )}
    </div>
  );
}
