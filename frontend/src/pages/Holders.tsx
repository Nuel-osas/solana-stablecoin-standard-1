import { useState, useEffect, useMemo } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, ParsedAccountData } from "@solana/web3.js";
import { shortenAddress } from "../utils/pda";

interface Props {
  mintAddress: string;
}

interface HolderInfo {
  walletAddress: string;
  balance: number;
  rawBalance: bigint;
}

export default function Holders({ mintAddress }: Props) {
  const { connection } = useConnection();
  const [holders, setHolders] = useState<HolderInfo[]>([]);
  const [totalSupply, setTotalSupply] = useState<number>(0);
  const [decimals, setDecimals] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minBalance, setMinBalance] = useState<string>("");

  useEffect(() => {
    if (!mintAddress) {
      setHolders([]);
      setTotalSupply(0);
      return;
    }

    const fetchHolders = async () => {
      try {
        setLoading(true);
        setError(null);

        const mint = new PublicKey(mintAddress);

        // Fetch mint supply and decimals
        const mintInfo = await connection.getTokenSupply(mint);
        const mintDecimals = mintInfo.value.decimals;
        setDecimals(mintDecimals);
        setTotalSupply(Number(mintInfo.value.amount) / Math.pow(10, mintDecimals));

        // Use getTokenLargestAccounts — works on all RPC nodes including public devnet
        const largestAccounts = await connection.getTokenLargestAccounts(mint);

        const holderList: HolderInfo[] = [];
        for (const acct of largestAccounts.value) {
          if (!acct.uiAmount || acct.uiAmount === 0) continue;
          // Fetch parsed account info to get the owner
          const acctInfo = await connection.getParsedAccountInfo(acct.address);
          const parsed = (acctInfo.value?.data as ParsedAccountData)?.parsed?.info;
          if (!parsed) continue;

          holderList.push({
            walletAddress: parsed.owner as string,
            balance: acct.uiAmount,
            rawBalance: BigInt(acct.amount),
          });
        }

        holderList.sort((a, b) => {
          if (b.rawBalance > a.rawBalance) return 1;
          if (b.rawBalance < a.rawBalance) return -1;
          return 0;
        });

        setHolders(holderList);
      } catch (err: any) {
        setError(err.message || "Failed to fetch token holders");
        setHolders([]);
      } finally {
        setLoading(false);
      }
    };

    fetchHolders();
  }, [mintAddress, connection]);

  const filteredHolders = useMemo(() => {
    const min = parseFloat(minBalance);
    if (isNaN(min) || min <= 0) return holders;
    return holders.filter((h) => h.balance >= min);
  }, [holders, minBalance]);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">
          Enter a mint address above to view token holders.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Token Holders</h1>
        <span className="text-sm text-slate-400">
          {filteredHolders.length} holder{filteredHolders.length !== 1 ? "s" : ""}
          {holders.length !== filteredHolders.length && (
            <span className="text-slate-500"> (of {holders.length} total)</span>
          )}
        </span>
      </div>

      {/* Min balance filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400">Min Balance:</label>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="0"
          value={minBalance}
          onChange={(e) => setMinBalance(e.target.value)}
          className="w-48 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
        {minBalance && (
          <button
            onClick={() => setMinBalance("")}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {!loading && !error && filteredHolders.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-500">
            {holders.length === 0
              ? "No token holders found for this mint."
              : "No holders match the current filter."}
          </p>
        </div>
      )}

      {filteredHolders.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    #
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Wallet Address
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Balance
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    % of Supply
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredHolders.map((holder, index) => {
                  const percentage =
                    totalSupply > 0
                      ? ((holder.balance / totalSupply) * 100).toFixed(2)
                      : "0.00";

                  return (
                    <tr
                      key={holder.walletAddress + index}
                      className="hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={`https://explorer.solana.com/address/${holder.walletAddress}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 font-mono text-xs"
                          title={holder.walletAddress}
                        >
                          {shortenAddress(holder.walletAddress, 8)}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-200 font-mono text-xs">
                        {holder.balance.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: decimals,
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-slate-300 text-xs">
                          {percentage}%
                        </span>
                        <div className="mt-1 w-full bg-slate-800 rounded-full h-1">
                          <div
                            className="bg-indigo-500 h-1 rounded-full"
                            style={{
                              width: `${Math.min(parseFloat(percentage), 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
