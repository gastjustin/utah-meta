import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../api";
import { Settings as SettingsIcon, Save, Home, Volume2 } from "lucide-react";

interface HomeNode {
  homeNodeId: string;
  name: string;
  hardwareClass: string;
}

interface AudioPolicy {
  audioPolicyId: string;
  name: string;
  englishOnly: boolean;
  normalizeAudio: boolean;
}

interface UserProfile {
  userId: string;
  displayName: string;
  authSubject: string;
  isAdmin: boolean;
  homeNodeId: string | null;
  defaultAudioPolicyId: string | null;
}

export default function Settings() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [homeNodes, setHomeNodes] = useState<HomeNode[]>([]);
  const [audioPolicies, setAudioPolicies] = useState<AudioPolicy[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [homeNodeId, setHomeNodeId] = useState("");
  const [audioPolicyId, setAudioPolicyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const currentUser = getCurrentUser();

  useEffect(() => {
    Promise.all([
      api<UserProfile>(`/users/${currentUser?.userId}`),
      api<HomeNode[]>("/home-nodes"),
      api<AudioPolicy[]>("/audio-policies").catch(() => []),
    ])
      .then(([p, nodes, policies]) => {
        setProfile(p);
        setHomeNodes(nodes);
        setAudioPolicies(policies);
        setDisplayName(p.displayName);
        setHomeNodeId(p.homeNodeId || "");
        setAudioPolicyId(p.defaultAudioPolicyId || "");
      })
      .catch((err) => setError(err.message));
  }, []);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const updated = await api<UserProfile>(`/users/${profile.userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName,
          homeNodeId: homeNodeId || null,
          defaultAudioPolicyId: audioPolicyId || null,
        }),
      });
      setProfile(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  if (!profile)
    return <div className="text-gray-400 p-8">Loading...</div>;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <SettingsIcon className="w-6 h-6 text-blue-400" /> Settings
      </h1>

      {error && <div className="bg-red-900/50 text-red-300 text-sm p-3 rounded">{error}</div>}
      {saved && <div className="bg-green-900/50 text-green-300 text-sm p-3 rounded">Settings saved</div>}

      {/* Profile section */}
      <div className="bg-gray-800 rounded-lg p-5 space-y-4">
        <h2 className="text-white font-medium">Profile</h2>
        <div>
          <label className="text-sm text-gray-400 block mb-1">Display name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm text-gray-400 block mb-1">Login ID</label>
          <p className="text-gray-500 text-sm font-mono">{profile.authSubject}</p>
        </div>
        <div>
          <label className="text-sm text-gray-400 block mb-1">Role</label>
          <p className="text-sm">
            {profile.isAdmin ? (
              <span className="inline-flex items-center gap-1 bg-blue-900 text-blue-300 px-2 py-0.5 rounded text-xs">
                <SettingsIcon className="w-3 h-3" /> Admin
              </span>
            ) : (
              <span className="bg-gray-700 text-gray-400 px-2 py-0.5 rounded text-xs">User</span>
            )}
          </p>
        </div>
      </div>

      {/* Home node assignment */}
      <div className="bg-gray-800 rounded-lg p-5 space-y-4">
        <h2 className="text-white font-medium flex items-center gap-2">
          <Home className="w-4 h-4 text-blue-400" /> Home Node
        </h2>
        <p className="text-gray-400 text-xs">
          Assign this user to a home node for edge cache pre-loading and predictive staging.
        </p>
        <select
          value={homeNodeId}
          onChange={(e) => setHomeNodeId(e.target.value)}
          className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm"
        >
          <option value="">None</option>
          {homeNodes.map((n) => (
            <option key={n.homeNodeId} value={n.homeNodeId}>
              {n.name} ({n.hardwareClass})
            </option>
          ))}
        </select>
      </div>

      {/* Audio policy */}
      <div className="bg-gray-800 rounded-lg p-5 space-y-4">
        <h2 className="text-white font-medium flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-blue-400" /> Audio Policy
        </h2>
        <p className="text-gray-400 text-xs">
          Default audio policy applied during playback preparation.
        </p>
        <select
          value={audioPolicyId}
          onChange={(e) => setAudioPolicyId(e.target.value)}
          className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm"
        >
          <option value="">None</option>
          {audioPolicies.map((p) => (
            <option key={p.audioPolicyId} value={p.audioPolicyId}>
              {p.name}{p.englishOnly ? " (English only)" : ""}{p.normalizeAudio ? " · Normalized" : ""}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded text-sm transition"
      >
        <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}
