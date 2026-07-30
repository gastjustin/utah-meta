import { useState } from "react";
import { login } from "../api";
import { Film } from "lucide-react";

export default function Login() {
  const [authSubject, setAuthSubject] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(authSubject, displayName || undefined);
      window.location.href = "/";
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0b]">
      <div className="w-full max-w-md px-6">
        <div className="flex flex-col items-center mb-8">
          <Film className="w-12 h-12 text-amber-500 mb-3" />
          <h1 className="text-3xl font-bold text-white tracking-tight">UtahMeta</h1>
          <p className="text-gray-500 text-sm mt-2">Sign in to browse and watch your media</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="User id (e.g. justin)"
            value={authSubject}
            onChange={(e) => setAuthSubject(e.target.value)}
            className="w-full bg-white/5 text-white border border-white/10 rounded-xl p-3.5 text-sm focus:outline-none focus:border-amber-500/50 transition"
            required
          />
          <input
            type="text"
            placeholder="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-white/5 text-white border border-white/10 rounded-xl p-3.5 text-sm focus:outline-none focus:border-amber-500/50 transition"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold py-3.5 rounded-xl transition"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
