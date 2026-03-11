import { useState, useEffect } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, ConfirmedSignatureInfo } from "@solana/web3.js";
import { deriveStablecoinPDA, shortenAddress } from "../utils/pda";

interface Props {
  mintAddress: string;
}

export default function AuditLog({ mintAddress }: Props) {
  const { connection } = useConnection();
  const [signatures, setSignatures] = useState<ConfirmedSignatureInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mintAddress) {
      setSignatures([]);
      return;
    }

    const fetchSignatures = async () => {
      try {
        setLoading(true);
        setError(null);
        const mint = new PublicKey(mintAddress);
        const [pda] = deriveStablecoinPDA(mint);

        const sigs = await connection.getSignaturesForAddress(pda, {
          limit: 50,
        });
        setSignatures(sigs);
      } catch (err: any) {
        setError(err.message || "Failed to fetch transaction signatures");
      } finally {
        setLoading(false);
      }
    };

    fetchSignatures();
  }, [mintAddress, connection]);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to view the audit log.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Audit Log</h1>
        <span className="text-sm text-slate-400">
          {signatures.length} transaction{signatures.length !== 1 ? "s" : ""}
        </span>
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

      {!loading && signatures.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-500">No transactions found for this stablecoin.</p>
        </div>
      )}

      {signatures.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Signature
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Block Time
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Slot
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Memo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {signatures.map((sig) => (
                  <tr
                    key={sig.signature}
                    className="hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <a
                        href={`https://explorer.solana.com/tx/${sig.signature}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 font-mono text-xs"
                      >
                        {shortenAddress(sig.signature, 8)}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {sig.blockTime
                        ? new Date(sig.blockTime * 1000).toLocaleString()
                        : "N/A"}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">
                      {sig.slot.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {sig.err ? (
                        <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-red-900/40 text-red-400 border border-red-800/50">
                          Failed
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-800/50">
                          Success
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px] truncate">
                      {sig.memo || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
