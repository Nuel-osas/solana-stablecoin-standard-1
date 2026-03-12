import { useState, useCallback, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import toast from "react-hot-toast";
import { useStablecoin } from "../hooks/useStablecoin";
import {
  deriveStablecoinPDA,
  deriveRoleAssignmentPDA,
  deriveMinterInfoPDA,
  shortenAddress,
} from "../utils/pda";
import { parseError } from "../utils/errors";

interface Props {
  mintAddress: string;
}

const ROLES = ["Minter", "Burner", "Blacklister", "Pauser", "Seizer"] as const;

// Anchor enum representation
function roleToAnchorEnum(role: string) {
  const r = role.toLowerCase();
  return { [r]: {} };
}

export default function Roles({ mintAddress }: Props) {
  const { state, program, refetch } = useStablecoin(mintAddress);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [assignRole, setAssignRole] = useState<string>("Minter");
  const [assignee, setAssignee] = useState("");
  const [revokeRole, setRevokeRole] = useState<string>("Minter");
  const [revokeAssignee, setRevokeAssignee] = useState("");
  const [checkAddress, setCheckAddress] = useState("");
  const [checkResults, setCheckResults] = useState<Record<string, boolean> | null>(null);
  const [checking, setChecking] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [roleHolders, setRoleHolders] = useState<Record<string, string[]>>({});
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [revokeManualEntry, setRevokeManualEntry] = useState(false);

  // Fetch all role assignments from on-chain
  const fetchRoleHolders = useCallback(async () => {
    if (!program || !mintAddress) return;
    try {
      setLoadingRoles(true);
      const mint = new PublicKey(mintAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);

      const entries = await (program.account as any).roleAssignment.all([
        { memcmp: { offset: 8, bytes: stablecoinPDA.toBase58() } },
      ]);

      const grouped: Record<string, string[]> = {};
      for (const e of entries) {
        const acc = e.account;
        if (!acc.active) continue;
        // Anchor enum: { minter: {} } -> key is the role name
        const roleKey = Object.keys(acc.role)[0];
        const roleName = roleKey.charAt(0).toUpperCase() + roleKey.slice(1);
        const addr = acc.assignee.toBase58();
        if (!grouped[roleName]) grouped[roleName] = [];
        if (!grouped[roleName].includes(addr)) grouped[roleName].push(addr);
      }
      setRoleHolders(grouped);
    } catch (err: any) {
      console.error("Failed to fetch role holders:", err);
    } finally {
      setLoadingRoles(false);
    }
  }, [program, mintAddress]);

  useEffect(() => { fetchRoleHolders(); }, [fetchRoleHolders]);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to manage roles.</p>
      </div>
    );
  }

  const handleCheck = async () => {
    try {
      setChecking(true);
      setCheckResults(null);
      const mint = new PublicKey(mintAddress);
      const address = new PublicKey(checkAddress);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);

      const results: Record<string, boolean> = {};
      for (const role of ROLES) {
        const [rolePDA] = deriveRoleAssignmentPDA(stablecoinPDA, role.toLowerCase(), address);
        const info = await connection.getAccountInfo(rolePDA);
        results[role] = !!info;
      }

      // Also check if address is the authority
      if (state) {
        results["Authority"] = state.authority.equals(address);
      }

      setCheckResults(results);
    } catch {
      toast.error("Invalid address");
    } finally {
      setChecking(false);
    }
  };

  const handleAssign = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setAssigning(true);
      const mint = new PublicKey(mintAddress);
      const assigneePk = new PublicKey(assignee);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const roleStr = assignRole.toLowerCase();
      const [roleAssignment] = deriveRoleAssignmentPDA(stablecoinPDA, roleStr, assigneePk);

      // Only the authority can assign roles
      if (!state.authority.equals(publicKey)) {
        toast.error("Only the master authority can assign roles.");
        return;
      }

      const accounts: any = {
        authority: publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment,
        systemProgram: SystemProgram.programId,
      };

      // Only pass minterInfo when assigning minter role
      if (roleStr === "minter") {
        const [minterInfo] = deriveMinterInfoPDA(stablecoinPDA, assigneePk);
        accounts.minterInfo = minterInfo;
      } else {
        accounts.minterInfo = null;
      }

      const tx = await (program.methods as any)
        .assignRole(roleToAnchorEnum(assignRole), assigneePk)
        .accounts(accounts)
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Role "${assignRole}" assigned! Tx: ${sig.slice(0, 8)}...`);
      fetchRoleHolders();
      setAssignee("");
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setAssigning(false);
    }
  };

  const handleRevoke = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setRevoking(true);
      const mint = new PublicKey(mintAddress);
      const assigneePk = new PublicKey(revokeAssignee);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const roleStr = revokeRole.toLowerCase();
      const [roleAssignment] = deriveRoleAssignmentPDA(stablecoinPDA, roleStr, assigneePk);

      // Only the authority can revoke roles
      if (!state.authority.equals(publicKey)) {
        toast.error("Only the master authority can revoke roles.");
        return;
      }

      const tx = await (program.methods as any)
        .revokeRole(roleToAnchorEnum(revokeRole), assigneePk)
        .accounts({
          authority: publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(`Role "${revokeRole}" revoked! Tx: ${sig.slice(0, 8)}...`);
      fetchRoleHolders();
      setRevokeAssignee("");
    } catch (err: any) {
      toast.error(parseError(err));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Role Management</h1>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <p className="text-sm text-slate-400 mb-4">
          Only the master authority ({state ? state.authority.toBase58().slice(0, 8) + "..." : "..."}) can assign or revoke roles.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {ROLES.map((r) => (
            <div
              key={r}
              className="bg-slate-800 rounded-lg px-3 py-2 text-center text-xs text-slate-300 border border-slate-700"
            >
              {r}
            </div>
          ))}
        </div>
      </div>

      {/* Check Roles */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-cyan-400 mb-4">Check Roles</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Wallet Address</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={checkAddress}
                onChange={(e) => setCheckAddress(e.target.value.trim())}
                placeholder="Enter wallet address to check roles"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
              {publicKey && (
                <button
                  onClick={() => setCheckAddress(publicKey.toBase58())}
                  className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap"
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
            {checking ? "Checking..." : "Check Roles"}
          </button>
          {checkResults && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
              {Object.entries(checkResults).map(([role, hasRole]) => (
                <div
                  key={role}
                  className={`rounded-lg px-3 py-2 text-center text-xs font-medium border ${
                    hasRole
                      ? "bg-emerald-900/40 text-emerald-400 border-emerald-800/50"
                      : "bg-slate-800 text-slate-500 border-slate-700"
                  }`}
                >
                  {role}: {hasRole ? "YES" : "NO"}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Assign */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-indigo-400 mb-4">Assign Role</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Role</label>
            <select
              value={assignRole}
              onChange={(e) => setAssignRole(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Assignee Address</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value.trim())}
                placeholder="Wallet address to assign role to"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
              {publicKey && (
                <button
                  onClick={() => setAssignee(publicKey.toBase58())}
                  className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap"
                >
                  My Wallet
                </button>
              )}
            </div>
          </div>
          <button
            onClick={handleAssign}
            disabled={assigning || !assignee || !publicKey}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {assigning ? "Assigning..." : "Assign Role"}
          </button>
        </div>
      </div>

      {/* Revoke */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-amber-400 mb-4">Revoke Role</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Role</label>
            <select
              value={revokeRole}
              onChange={(e) => {
                setRevokeRole(e.target.value);
                setRevokeAssignee("");
                setRevokeManualEntry(false);
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-slate-400">Assignee Address</label>
              <div className="flex gap-2">
                <button
                  onClick={() => fetchRoleHolders()}
                  className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  {loadingRoles ? "Loading..." : "Refresh"}
                </button>
                {(roleHolders[revokeRole]?.length ?? 0) > 0 && (
                  <button
                    onClick={() => { setRevokeManualEntry(!revokeManualEntry); setRevokeAssignee(""); }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    {revokeManualEntry ? "Select from list" : "Enter manually"}
                  </button>
                )}
              </div>
            </div>
            {(roleHolders[revokeRole]?.length ?? 0) > 0 && !revokeManualEntry ? (
              <div>
                <select
                  value={revokeAssignee}
                  onChange={(e) => setRevokeAssignee(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono appearance-none cursor-pointer"
                >
                  <option value="">-- Select {revokeRole} holder --</option>
                  {roleHolders[revokeRole].map((addr) => (
                    <option key={addr} value={addr}>
                      {shortenAddress(addr)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  {roleHolders[revokeRole].length} {revokeRole} holder{roleHolders[revokeRole].length !== 1 ? "s" : ""} on-chain
                </p>
              </div>
            ) : (
              <div>
                {(roleHolders[revokeRole]?.length ?? 0) === 0 && (
                  <p className="text-xs text-slate-500 mb-2">
                    {loadingRoles ? "Loading role holders..." : `No ${revokeRole} holders found on-chain.`}
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={revokeAssignee}
                    onChange={(e) => setRevokeAssignee(e.target.value.trim())}
                    placeholder="Wallet address to revoke role from"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                  {publicKey && (
                    <button
                      onClick={() => setRevokeAssignee(publicKey.toBase58())}
                      className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap"
                    >
                      My Wallet
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleRevoke}
            disabled={revoking || !revokeAssignee || !publicKey}
            className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {revoking ? "Revoking..." : "Revoke Role"}
          </button>
        </div>
      </div>
    </div>
  );
}
