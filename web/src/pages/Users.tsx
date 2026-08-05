import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../api";
import { Users as UsersIcon, Shield, Trash2, UserPlus, ShieldCheck, ShieldOff, Server, KeyRound, Check } from "lucide-react";

interface User {
  userId: string;
  displayName: string;
  authSubject: string;
  isAdmin: boolean;
  homeNodeId: string | null;
  _count: { devices: number; watchStates: number };
}

interface HomeNode {
  homeNodeId: string;
  name: string;
  hardwareClass: string;
  cachePath: string;
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newHomeNode, setNewHomeNode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [homeNodes, setHomeNodes] = useState<HomeNode[]>([]);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [resettingPassword, setResettingPassword] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [passwordSet, setPasswordSet] = useState<string | null>(null);
  const currentUser = getCurrentUser();

  async function load() {
    setLoading(true);
    try {
      const [usersData, nodesData] = await Promise.all([
        api<User[]>("/users"),
        api<HomeNode[]>("/home-nodes").catch(() => []),
      ]);
      setUsers(usersData);
      setHomeNodes(nodesData);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleAdmin(user: User) {
    setError("");
    try {
      await api(`/users/${user.userId}`, {
        method: "PATCH",
        body: JSON.stringify({ isAdmin: !user.isAdmin }),
      });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deleteUser(user: User) {
    if (!confirm(`Delete user "${user.displayName}"? This removes their devices and watch state.`))
      return;
    setError("");
    try {
      await api(`/users/${user.userId}`, { method: "DELETE" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function createUser() {
    setError("");
    try {
      await api("/users", {
        method: "POST",
        body: JSON.stringify({
          displayName: newName,
          authSubject: newSubject,
          homeNodeId: newHomeNode || undefined,
          password: newPassword || undefined,
        }),
      });
      setShowCreate(false);
      setNewName("");
      setNewSubject("");
      setNewHomeNode("");
      setNewPassword("");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function assignHomeNode(userId: string, homeNodeId: string) {
    setError("");
    try {
      await api(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ homeNodeId: homeNodeId || null }),
      });
      setEditingNode(null);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function resetPassword(userId: string) {
    if (!resetPasswordValue || resetPasswordValue.length < 4) return;
    setError("");
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ userId, newPassword: resetPasswordValue }),
      });
      setResettingPassword(null);
      setResetPasswordValue("");
      setPasswordSet(userId);
      setTimeout(() => setPasswordSet(null), 3000);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading)
    return <div className="text-gray-500 p-8 text-sm">Loading users...</div>;

  return (
    <div className="fade-in px-6 md:px-8 py-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <UsersIcon className="w-6 h-6 text-amber-500" /> User Management
        </h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-medium px-4 py-2 rounded-lg text-sm transition"
        >
          <UserPlus className="w-4 h-4" /> Add User
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 text-red-300 text-sm p-3 rounded-lg">{error}</div>
      )}

      {showCreate && (
        <div className="bg-[#151517] rounded-xl p-5 space-y-3">
          <h2 className="text-white font-medium">Create New User</h2>
          <input
            type="text"
            placeholder="Display name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-[#1a1a1e] text-white border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500/50"
          />
          <input
            type="text"
            placeholder="Auth subject (login id)"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            className="w-full bg-[#1a1a1e] text-white border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500/50"
          />
          <select
            value={newHomeNode}
            onChange={(e) => setNewHomeNode(e.target.value)}
            className="w-full bg-[#1a1a1e] text-white border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500/50"
          >
            <option value="">No home node assigned</option>
            {homeNodes.map((n) => (
              <option key={n.homeNodeId} value={n.homeNodeId}>{n.name}</option>
            ))}
          </select>
          <input
            type="password"
            placeholder="Password (optional)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full bg-[#1a1a1e] text-white border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500/50"
          />
          <button
            onClick={createUser}
            disabled={!newName || !newSubject}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-medium px-4 py-2 rounded-lg text-sm transition"
          >
            Create
          </button>
        </div>
      )}

      <div className="bg-[#151517] rounded-xl overflow-hidden">
        <table className="w-full text-sm text-gray-300">
          <thead>
            <tr className="text-left text-gray-500 border-b border-white/10">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Login ID</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Home Node</th>
              <th className="px-4 py-3">Devices</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.userId} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 text-white font-medium">
                  {user.displayName}
                  {user.userId === currentUser?.userId && (
                    <span className="text-gray-500 text-xs ml-2">(you)</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-400">
                  {user.authSubject}
                </td>
                <td className="px-4 py-3">
                  {user.isAdmin ? (
                    <span className="inline-flex items-center gap-1 bg-amber-900/40 text-amber-400 px-2 py-0.5 rounded text-xs">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  ) : (
                    <span className="bg-white/5 text-gray-400 px-2 py-0.5 rounded text-xs">
                      User
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {editingNode === user.userId ? (
                    <select
                      autoFocus
                      defaultValue={user.homeNodeId || ""}
                      onBlur={(e) => assignHomeNode(user.userId, e.target.value)}
                      onChange={(e) => assignHomeNode(user.userId, e.target.value)}
                      className="bg-[#1a1a1e] text-white border border-white/10 rounded px-2 py-1 text-xs"
                    >
                      <option value="">None</option>
                      {homeNodes.map((n) => (
                        <option key={n.homeNodeId} value={n.homeNodeId}>{n.name}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setEditingNode(user.userId)}
                      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white transition"
                    >
                      <Server className="w-3 h-3" />
                      {user.homeNodeId
                        ? homeNodes.find((n) => n.homeNodeId === user.homeNodeId)?.name || "Unknown"
                        : "Unassigned"}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3">{user._count.devices}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  {passwordSet === user.userId && (
                    <span className="inline-flex items-center gap-1 text-green-400 text-xs mr-2">
                      <Check className="w-3 h-3" /> Password set
                    </span>
                  )}
                  {resettingPassword === user.userId ? (
                    <div className="inline-flex items-center gap-1">
                      <input
                        type="password"
                        placeholder="New password"
                        value={resetPasswordValue}
                        onChange={(e) => setResetPasswordValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && resetPassword(user.userId)}
                        className="bg-[#1a1a1e] text-white border border-white/10 rounded px-2 py-1 text-xs w-28"
                        autoFocus
                      />
                      <button
                        onClick={() => resetPassword(user.userId)}
                        disabled={resetPasswordValue.length < 4}
                        className="text-amber-500 text-xs disabled:opacity-30"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setResettingPassword(null); setResetPasswordValue(""); }}
                        className="text-gray-500 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setResettingPassword(user.userId); setResetPasswordValue(""); }}
                      title="Reset password"
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-white/10 transition"
                    >
                      <KeyRound className="w-3 h-3" /> Reset
                    </button>
                  )}
                  <button
                    onClick={() => toggleAdmin(user)}
                    title={user.isAdmin ? "Remove admin" : "Make admin"}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-white/10 transition"
                  >
                    {user.isAdmin ? (
                      <><ShieldOff className="w-3 h-3" /> Demote</>
                    ) : (
                      <><ShieldCheck className="w-3 h-3" /> Promote</>
                    )}
                  </button>
                  <button
                    onClick={() => deleteUser(user)}
                    disabled={user.userId === currentUser?.userId}
                    title="Delete user"
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded text-red-400 hover:bg-red-900/50 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
