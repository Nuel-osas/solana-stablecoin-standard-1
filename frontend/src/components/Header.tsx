import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { shortenAddress } from "../utils/pda";
import { useState } from "react";
import { NavLink } from "react-router-dom";

export default function Header() {
  const { publicKey } = useWallet();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="flex items-center justify-between px-4 md:px-6 py-3 bg-slate-900 border-b border-slate-800">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <button
          className="md:hidden text-slate-400 hover:text-white"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="md:hidden flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center font-bold text-xs">S</div>
          <span className="text-sm font-semibold">SSS</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-900/40 text-emerald-400 text-xs rounded-full border border-emerald-800/50">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Devnet
        </span>
        {publicKey && (
          <span className="hidden sm:inline text-xs text-slate-400 font-mono">
            {shortenAddress(publicKey.toBase58(), 6)}
          </span>
        )}
        <WalletMultiButton
          style={{
            backgroundColor: "#4f46e5",
            height: "36px",
            fontSize: "13px",
            borderRadius: "8px",
            padding: "0 16px",
          }}
        />
      </div>

      {/* Mobile nav dropdown */}
      {mobileMenuOpen && (
        <div className="absolute top-14 left-0 right-0 z-50 bg-slate-900 border-b border-slate-800 p-4 md:hidden">
          <nav className="space-y-2">
            {[
              { to: "/", label: "Dashboard" },
              { to: "/mint-burn", label: "Mint / Burn" },
              { to: "/blacklist", label: "Blacklist" },
              { to: "/roles", label: "Roles" },
              { to: "/allowlist", label: "Allowlist" },
              { to: "/audit-log", label: "Audit Log" },
            ].map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === "/"}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-lg text-sm ${
                    isActive
                      ? "bg-indigo-600/20 text-indigo-400"
                      : "text-slate-400 hover:text-white hover:bg-slate-800"
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
