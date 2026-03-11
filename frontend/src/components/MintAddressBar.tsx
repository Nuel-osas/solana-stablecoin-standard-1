interface Props {
  mintAddress: string;
  onMintAddressChange: (addr: string) => void;
}

export default function MintAddressBar({ mintAddress, onMintAddressChange }: Props) {
  return (
    <div className="px-4 md:px-6 py-3 bg-slate-900/60 border-b border-slate-800">
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-slate-400 whitespace-nowrap">
          Mint Address
        </label>
        <input
          type="text"
          value={mintAddress}
          onChange={(e) => onMintAddressChange(e.target.value.trim())}
          placeholder="Enter stablecoin mint address (e.g., 7Kz3...)"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono"
        />
        {mintAddress && (
          <button
            onClick={() => onMintAddressChange("")}
            className="text-slate-500 hover:text-slate-300 text-xs"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
