import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../api";
import { Users as UsersIcon, Shield, Trash2, UserPlus, ShieldCheck, ShieldOff } from "lucide-react";

interface User {
  userId: string;
  displayName: string;
  authSubject: string;
  isAdmin: boolean;
  homeNodeId: string | null;
  _count: { devices: number; watchStates: number };
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const currentUser = getCurrentUser();

  async function load() {
    setLoading(true);
    try {
      setUsers(await api<User[]>("/users"));
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
        body: JSON.stringify({ displayName: newName, authSubject: newSubject }),
      });
      setShowCreate(false);
      setNewName("");
      setNewSubject("");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading)
    return <div className="text-gray-400 p-8">Loading users...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <UsersIcon className="w-6 h-6 text-blue-400" /> User Management
        </h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm transition"
        >
          <UserPlus className="w-4 h-4" /> Add User
        </button>
      </div>

      {error && (
        <div className="bg-red-900 text-red-200 text-sm p-3 rounded">{error}</div>
      )}

      {showCreate && (
        <div className="bg-gray-800 rounded-lg p-5 space-y-3">
          <h2 className="text-white font-medium">Create New User</h2>
          <input
            type="text"
            placeholder="Display name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Auth subject (login id)"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm"
          />
          <button
            onClick={createUser}
            disabled={!newName || !newSubject}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded text-sm transition"
          >
            Create
          </button>
        </div>
      )}

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm text-gray-300">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-700">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Login ID</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Devices</th>
              <th className="px-4 py-3">Watch States</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.userId} className="border-b border-gray-700/50 hover:bg-gray-700/30">
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
                    <span className="inline-flex items-center gap-1 bg-blue-900 text-blue-300 px-2 py-0.5 rounded text-xs">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  ) : (
                    <span className="bg-gray-700 text-gray-400 px-2 py-0.5 rounded text-xs">
                      User
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{user._count.devices}</td>
                <td className="px-4 py-3">{user._count.watchStates}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => toggleAdmin(user)}
                    title={user.isAdmin ? "Remove admin" : "Make admin"}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-gray-600 transition"
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
