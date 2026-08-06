import { useState } from "react";
import { login } from "../api";
import { Lock } from "lucide-react";

export default function Login() {
  const [authSubject, setAuthSubject] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(authSubject, password || undefined);
      window.location.href = "/";
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0b]">
      <div className="w-full max-w-md px-6">
        <div className="flex flex-col items-center mb-8">
          <img
            src="/littleLogo.jpeg"
            alt="UtahMeta"
            className="w-40 h-auto mb-4"
          />
          <p className="text-gray-500 text-sm mt-2">Sign in to browse and watch your media</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Username"
            value={authSubject}
            onChange={(e) => setAuthSubject(e.target.value)}
            className="w-full bg-white/5 text-white border border-white/10 rounded-xl p-3.5 text-sm focus:outline-none focus:border-amber-500/50 transition"
            required
          />
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/5 text-white border border-white/10 rounded-xl pl-11 p-3.5 text-sm focus:outline-none focus:border-amber-500/50 transition"
            />
          </div>
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
