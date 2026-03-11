import { useMemo, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { Toaster } from "react-hot-toast";

import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import MintAddressBar from "./components/MintAddressBar";
import Dashboard from "./pages/Dashboard";
import MintBurn from "./pages/MintBurn";
import Blacklist from "./pages/Blacklist";
import Roles from "./pages/Roles";
import Allowlist from "./pages/Allowlist";
import Authority from "./pages/Authority";
import MinterQuotas from "./pages/MinterQuotas";
import AuditLog from "./pages/AuditLog";

export default function App() {
  const endpoint = useMemo(() => clusterApiUrl("devnet"), []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );
  const [mintAddress, setMintAddress] = useState("");

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#1e293b",
                color: "#e2e8f0",
                border: "1px solid #334155",
              },
            }}
          />
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-col flex-1 overflow-hidden">
              <Header />
              <MintAddressBar
                mintAddress={mintAddress}
                onMintAddressChange={setMintAddress}
              />
              <main className="flex-1 overflow-y-auto p-4 md:p-6">
                <Routes>
                  <Route
                    path="/"
                    element={<Dashboard mintAddress={mintAddress} />}
                  />
                  <Route
                    path="/mint-burn"
                    element={<MintBurn mintAddress={mintAddress} />}
                  />
                  <Route
                    path="/blacklist"
                    element={<Blacklist mintAddress={mintAddress} />}
                  />
                  <Route
                    path="/roles"
                    element={<Roles mintAddress={mintAddress} />}
                  />
                  <Route
                    path="/allowlist"
                    element={<Allowlist mintAddress={mintAddress} />}
                  />
                  <Route
                    path="/authority"
                    element={<Authority mintAddress={mintAddress} />}
                  />
                  <Route
                    path="/minter-quotas"
                    element={<MinterQuotas mintAddress={mintAddress} />}
                  />
                  <Route
                    path="/audit-log"
                    element={<AuditLog mintAddress={mintAddress} />}
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </main>
            </div>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
