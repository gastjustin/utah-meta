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
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="bg-gray-800 p-8 rounded-xl shadow-lg w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <Film className="w-8 h-8 text-blue-500" />
          <h1 className="text-2xl font-bold text-white">UtahMeta</h1>
        </div>
        <p className="text-gray-400 text-sm mb-6">
          Sign in with your user id to browse and watch media.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="User id (e.g. justin)"
            value={authSubject}
            onChange={(e) => setAuthSubject(e.target.value)}
            className="w-full bg-gray-700 text-white border border-gray-600 rounded-lg p-3 focus:outline-none focus:border-blue-500"
            required
          />
          <input
            type="text"
            placeholder="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-gray-700 text-white border border-gray-600 rounded-lg p-3 focus:outline-none focus:border-blue-500"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
