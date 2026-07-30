const TOKEN_KEY = "utahmeta_token";
const USER_KEY = "utahmeta_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getCurrentUser(): { userId: string; authSubject: string; isAdmin: boolean; displayName: string } | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isAdmin(): boolean {
  return getCurrentUser()?.isAdmin ?? false;
}

export async function api<T = any>(
  path: string,
  opts?: RequestInit
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((opts?.headers as Record<string, string>) || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...opts, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.status === 204 ? (null as T) : ((await res.json()) as T);
}

export async function login(
  authSubject: string,
  displayName?: string
): Promise<{ token: string; user: any }> {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authSubject, displayName }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  setToken(data.token);
  localStorage.setItem(USER_KEY, JSON.stringify({
    userId: data.user.userId,
    authSubject: data.user.authSubject,
    isAdmin: data.user.isAdmin,
    displayName: data.user.displayName,
  }));
  return data;
}

export const CLIENT_IDS = [
  "web_chrome",
  "web_firefox",
  "web_safari",
  "android_tv",
  "android_mobile",
  "ios",
  "apple_tv",
  "roku",
  "lg_webos",
];
