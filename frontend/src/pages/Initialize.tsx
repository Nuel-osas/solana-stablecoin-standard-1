import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { BN, Program, AnchorProvider } from "@coral-xyz/anchor";
import toast from "react-hot-toast";
import { deriveStablecoinPDA, SSS_TRANSFER_HOOK_PROGRAM_ID } from "../utils/pda";
import { parseError } from "../utils/errors";
import idl from "../idl/sss_token.json";
import hookIdl from "../idl/sss_transfer_hook.json";

type Preset = "sss-1" | "sss-2" | "sss-3" | null;

interface PresetInfo {
  label: string;
  tag: string;
  description: string;
  color: string;
  borderColor: string;
  tagBg: string;
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
  defaultAccountFrozen: boolean;
  enableAllowlist: boolean;
}

const PRESETS: Record<Exclude<Preset, null>, PresetInfo> = {
  "sss-1": {
    label: "SSS-1",
    tag: "Minimal",
    description:
      "Basic stablecoin with Token-2022 metadata. No compliance features, no transfer restrictions. Ideal for testing or simple tokens.",
    color: "text-emerald-400",
    borderColor: "border-emerald-500/50",
    tagBg: "bg-emerald-900/40 text-emerald-400",
    enablePermanentDelegate: false,
    enableTransferHook: false,
    defaultAccountFrozen: false,
    enableAllowlist: false,
  },
  "sss-2": {
    label: "SSS-2",
    tag: "Compliant",
    description:
      "Full compliance stablecoin with permanent delegate (seize/freeze), transfer hook (blacklist enforcement), and role-based access control. Suitable for regulated stablecoins.",
    color: "text-indigo-400",
    borderColor: "border-indigo-500/50",
    tagBg: "bg-indigo-900/40 text-indigo-400",
    enablePermanentDelegate: true,
    enableTransferHook: true,
    defaultAccountFrozen: false,
    enableAllowlist: false,
  },
  "sss-3": {
    label: "SSS-3",
    tag: "Private",
    description:
      "Most restrictive tier. Includes all SSS-2 features plus allowlist enforcement -- only approved addresses can hold or transfer tokens. Designed for permissioned/private tokens.",
    color: "text-purple-400",
    borderColor: "border-purple-500/50",
    tagBg: "bg-purple-900/40 text-purple-400",
    enablePermanentDelegate: true,
    enableTransferHook: true,
    defaultAccountFrozen: false,
    enableAllowlist: true,
  },
};

export default function Initialize() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [selectedPreset, setSelectedPreset] = useState<Preset>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [uri, setUri] = useState("");
  const [decimals, setDecimals] = useState("6");
  const [supplyCap, setSupplyCap] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdMint, setCreatedMint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const getProgram = useCallback(() => {
    if (!publicKey || !signTransaction) return null;
    const provider = new AnchorProvider(
      connection,
      { publicKey, signTransaction, signAllTransactions: async (txs: any[]) => txs } as any,
      { commitment: "confirmed" }
    );
    return new Program(idl as any, provider);
  }, [connection, publicKey, signTransaction]);

  const handleSubmit = async () => {
    if (!publicKey || !signTransaction || !selectedPreset) return;
    const program = getProgram();
    if (!program) {
      toast.error("Connect your wallet first.");
      return;
    }

    if (!name.trim()) {
      toast.error("Token name is required.");
      return;
    }
    if (!symbol.trim()) {
      toast.error("Token symbol is required.");
      return;
    }

    const preset = PRESETS[selectedPreset];

    try {
      setSubmitting(true);
      setCreatedMint(null);

      const mintKeypair = Keypair.generate();
      const [stablecoinPDA] = deriveStablecoinPDA(mintKeypair.publicKey);

      const parsedDecimals = parseInt(decimals) || 6;
      const parsedSupplyCap = supplyCap.trim()
        ? new BN(parseFloat(supplyCap) * Math.pow(10, parsedDecimals))
        : null;

      const needsHook = preset.enableTransferHook;

      const tx = await (program.methods as any)
        .initialize({
          name: name.trim(),
          symbol: symbol.trim(),
          uri: uri.trim(),
          decimals: parsedDecimals,
          enablePermanentDelegate: preset.enablePermanentDelegate,
          enableTransferHook: preset.enableTransferHook,
          defaultAccountFrozen: preset.defaultAccountFrozen,
          enableAllowlist: preset.enableAllowlist,
          supplyCap: parsedSupplyCap,
        })
        .accounts({
          authority: publicKey,
          mint: mintKeypair.publicKey,
          stablecoin: stablecoinPDA,
          transferHookProgram: needsHook ? SSS_TRANSFER_HOOK_PROGRAM_ID : null,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .transaction();

      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      // Mint keypair must sign the transaction
      tx.partialSign(mintKeypair);

      // Wallet signs the transaction
      const signedTx = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(sig, "confirmed");

      // For SSS-2/SSS-3: initialize the transfer hook's ExtraAccountMetaList
      if (preset.enableTransferHook) {
        toast.success("Token created! Initializing transfer hook...");
        const hookProvider = new AnchorProvider(
          connection,
          { publicKey, signTransaction, signAllTransactions: async (txs: any[]) => txs } as any,
          { commitment: "confirmed" }
        );
        const hookProgram = new Program(hookIdl as any, hookProvider);

        const [extraAccountMetaListPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from("extra-account-metas"), mintKeypair.publicKey.toBuffer()],
          SSS_TRANSFER_HOOK_PROGRAM_ID
        );

        const hookTx = await (hookProgram.methods as any)
          .initializeExtraAccountMetaList()
          .accounts({
            payer: publicKey,
            extraAccountMetaList: extraAccountMetaListPDA,
            mint: mintKeypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .transaction();

        hookTx.feePayer = publicKey;
        hookTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        const signedHookTx = await signTransaction(hookTx);
        const hookSig = await connection.sendRawTransaction(signedHookTx.serialize());
        await connection.confirmTransaction(hookSig, "confirmed");
      }

      const mintAddr = mintKeypair.publicKey.toBase58();
      setCreatedMint(mintAddr);
      toast.success(`${preset.label} stablecoin created! Tx: ${sig.slice(0, 8)}...`);
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (!createdMint) return;
    navigator.clipboard.writeText(createdMint);
    setCopied(true);
    toast.success("Mint address copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Initialize Stablecoin</h1>
      <p className="text-sm text-slate-400">
        Create a new stablecoin token. Choose a standard tier, fill in the details, and deploy.
      </p>

      {/* Success Card — shown at top for easy copy */}
      {createdMint && (
        <div className="bg-emerald-900/20 border border-emerald-800/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-emerald-400 mb-2">
            Stablecoin Created
          </h2>
          <p className="text-sm text-slate-400 mb-3">
            Copy the mint address below and use it in the other pages (Dashboard, Mint/Burn, Roles, etc.).
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 font-mono break-all select-all">
              {createdMint}
            </code>
            <button
              onClick={handleCopy}
              className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Preset Selection */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(Object.entries(PRESETS) as [Exclude<Preset, null>, PresetInfo][]).map(
          ([key, preset]) => (
            <button
              key={key}
              onClick={() => setSelectedPreset(key)}
              className={`text-left bg-slate-900 border rounded-xl p-4 transition-all hover:bg-slate-800 ${
                selectedPreset === key
                  ? `${preset.borderColor} ring-1 ring-opacity-50`
                  : "border-slate-800"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`font-bold ${preset.color}`}>{preset.label}</span>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${preset.tagBg}`}
                >
                  {preset.tag}
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{preset.description}</p>
            </button>
          )
        )}
      </div>

      {/* Config Details (shown when a preset is selected) */}
      {selectedPreset && (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">
              {PRESETS[selectedPreset].label} Configuration
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {[
                {
                  label: "Permanent Delegate",
                  value: PRESETS[selectedPreset].enablePermanentDelegate,
                },
                {
                  label: "Transfer Hook",
                  value: PRESETS[selectedPreset].enableTransferHook,
                },
                {
                  label: "Default Frozen",
                  value: PRESETS[selectedPreset].defaultAccountFrozen,
                },
                {
                  label: "Allowlist",
                  value: PRESETS[selectedPreset].enableAllowlist,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`rounded-lg px-3 py-2 text-center border ${
                    item.value
                      ? "bg-emerald-900/30 text-emerald-400 border-emerald-800/40"
                      : "bg-slate-800 text-slate-500 border-slate-700"
                  }`}
                >
                  {item.label}: {item.value ? "ON" : "OFF"}
                </div>
              ))}
            </div>
          </div>

          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Token Details</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. USD Stablecoin"
                  maxLength={32}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Symbol <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="e.g. USDS"
                  maxLength={10}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  URI <span className="text-slate-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="https://example.com/metadata.json"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Decimals</label>
                  <input
                    type="number"
                    value={decimals}
                    onChange={(e) => setDecimals(e.target.value)}
                    min="0"
                    max="18"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    Supply Cap <span className="text-slate-600">(optional)</span>
                  </label>
                  <input
                    type="number"
                    value={supplyCap}
                    onChange={(e) => setSupplyCap(e.target.value)}
                    placeholder="No cap"
                    min="0"
                    step="any"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting || !publicKey || !name.trim() || !symbol.trim()}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
              >
                {submitting
                  ? "Deploying..."
                  : `Deploy ${PRESETS[selectedPreset].label} Stablecoin`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* No wallet connected */}
      {!publicKey && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center">
          <p className="text-slate-500 text-sm">
            Connect your wallet to initialize a stablecoin.
          </p>
        </div>
      )}
    </div>
  );
}
