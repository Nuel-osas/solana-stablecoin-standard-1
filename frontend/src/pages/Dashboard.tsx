import { useStablecoin } from "../hooks/useStablecoin";
import { shortenAddress } from "../utils/pda";
import { PublicKey } from "@solana/web3.js";

interface Props {
  mintAddress: string;
}

export default function Dashboard({ mintAddress }: Props) {
  const { state, loading, error, stablecoinPDA, currentSupply, refetch } =
    useStablecoin(mintAddress);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-300 mb-2">
            Enter a Mint Address
          </h2>
          <p className="text-sm text-slate-500 max-w-md">
            Paste a stablecoin mint address in the bar above to load the dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-6">
          <h3 className="text-red-400 font-medium mb-2">Error Loading Stablecoin</h3>
          <p className="text-sm text-red-300/70">{error}</p>
          <button
            onClick={refetch}
            className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  const isDefaultPubkey = state.pendingAuthority.equals(PublicKey.default);
  const supplyCapDisplay =
    state.supplyCap.toNumber() === 0
      ? "Unlimited"
      : (state.supplyCap.toNumber() / Math.pow(10, state.decimals)).toLocaleString();

  const totalMintedDisplay = (
    state.totalMinted.toNumber() / Math.pow(10, state.decimals)
  ).toLocaleString();
  const totalBurnedDisplay = (
    state.totalBurned.toNumber() / Math.pow(10, state.decimals)
  ).toLocaleString();
  const currentSupplyDisplay = (
    Number(currentSupply) / Math.pow(10, state.decimals)
  ).toLocaleString();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {state.name}{" "}
            <span className="text-slate-400 font-normal text-lg">({state.symbol})</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1 font-mono">
            PDA: {stablecoinPDA?.toBase58()}
          </p>
        </div>
        <button
          onClick={refetch}
          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm text-slate-300 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap gap-2">
        <span
          className={`px-3 py-1 text-xs rounded-full font-medium ${
            state.paused
              ? "bg-red-900/40 text-red-400 border border-red-800/50"
              : "bg-emerald-900/40 text-emerald-400 border border-emerald-800/50"
          }`}
        >
          {state.paused ? "PAUSED" : "ACTIVE"}
        </span>
        {state.enablePermanentDelegate && (
          <span className="px-3 py-1 text-xs rounded-full bg-amber-900/40 text-amber-400 border border-amber-800/50">
            Permanent Delegate
          </span>
        )}
        {state.enableTransferHook && (
          <span className="px-3 py-1 text-xs rounded-full bg-purple-900/40 text-purple-400 border border-purple-800/50">
            Transfer Hook
          </span>
        )}
        {state.defaultAccountFrozen && (
          <span className="px-3 py-1 text-xs rounded-full bg-cyan-900/40 text-cyan-400 border border-cyan-800/50">
            Default Frozen
          </span>
        )}
        {state.enableAllowlist && (
          <span className="px-3 py-1 text-xs rounded-full bg-blue-900/40 text-blue-400 border border-blue-800/50">
            Allowlist Enabled
          </span>
        )}
      </div>

      {/* Supply cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card label="Current Supply" value={currentSupplyDisplay} accent="indigo" />
        <Card label="Total Minted" value={totalMintedDisplay} accent="emerald" />
        <Card label="Total Burned" value={totalBurnedDisplay} accent="red" />
        <Card label="Supply Cap" value={supplyCapDisplay} accent="amber" />
      </div>

      {/* Details card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DetailRow label="Authority" value={shortenAddress(state.authority.toBase58(), 8)} mono />
          <DetailRow label="Mint" value={shortenAddress(state.mint.toBase58(), 8)} mono />
          <DetailRow label="Decimals" value={state.decimals.toString()} />
          <DetailRow label="URI" value={state.uri || "(none)"} />
          <DetailRow
            label="Pending Authority"
            value={isDefaultPubkey ? "None" : shortenAddress(state.pendingAuthority.toBase58(), 8)}
            mono={!isDefaultPubkey}
          />
          <DetailRow label="Permanent Delegate" value={state.enablePermanentDelegate ? "Enabled" : "Disabled"} />
          <DetailRow label="Transfer Hook" value={state.enableTransferHook ? "Enabled" : "Disabled"} />
          <DetailRow label="Allowlist" value={state.enableAllowlist ? "Enabled" : "Disabled"} />
        </div>
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  const colorMap: Record<string, string> = {
    indigo: "border-indigo-800/50",
    emerald: "border-emerald-800/50",
    red: "border-red-800/50",
    amber: "border-amber-800/50",
  };
  return (
    <div className={`bg-slate-900 border ${colorMap[accent] || "border-slate-800"} rounded-xl p-5`}>
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-slate-800/50 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className={`text-sm text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
