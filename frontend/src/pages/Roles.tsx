import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import toast from "react-hot-toast";
import { useStablecoin } from "../hooks/useStablecoin";
import {
  deriveStablecoinPDA,
  deriveRoleAssignmentPDA,
  deriveMinterInfoPDA,
} from "../utils/pda";

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
  const [assigning, setAssigning] = useState(false);
  const [revoking, setRevoking] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">Enter a mint address above to manage roles.</p>
      </div>
    );
  }

  const handleAssign = async () => {
    if (!program || !publicKey || !state) return;
    try {
      setAssigning(true);
      const mint = new PublicKey(mintAddress);
      const assigneePk = new PublicKey(assignee);
      const [stablecoinPDA] = deriveStablecoinPDA(mint);
      const roleStr = assignRole.toLowerCase();
      const [roleAssignment] = deriveRoleAssignmentPDA(stablecoinPDA, roleStr, assigneePk);

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
      setAssignee("");
    } catch (err: any) {
      toast.error(err.message || "Failed to assign role");
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
      setRevokeAssignee("");
    } catch (err: any) {
      toast.error(err.message || "Failed to revoke role");
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
            <input
              type="text"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value.trim())}
              placeholder="Wallet address to assign role to"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
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
              onChange={(e) => setRevokeRole(e.target.value)}
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
            <input
              type="text"
              value={revokeAssignee}
              onChange={(e) => setRevokeAssignee(e.target.value.trim())}
              placeholder="Wallet address to revoke role from"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
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
