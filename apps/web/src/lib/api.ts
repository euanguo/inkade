import { createInkadeClient, InkadeClient } from "@inkade/sdk";
import { getAppBasePath, withBasePath } from "./base-path.ts";
import {
  getMobileShellInjectedToken,
  isNativeMobileShell,
  postToNativeShell,
} from "./mobile-shell.ts";

const TOKEN_STORAGE_KEY = "inkade:auth-token";
const EMBED_SESSION_TOKEN_KEY = "inkade:embed:access_token";
const EMBED_SESSION_ID_KEY = "inkade:embed:session_id";

let inMemoryEmbedToken: string | null = null;
let inMemoryEmbedSessionId: string | null = null;

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") return getAppBasePath();
  return `${window.location.origin}${getAppBasePath()}`;
}

export function setEmbedSessionId(sessionId: string | null): void {
  const cleaned = sessionId && sessionId.trim().length > 0 ? sessionId.trim() : null;
  inMemoryEmbedSessionId = cleaned;
  if (typeof window !== "undefined") {
    try {
      if (cleaned) {
        window.sessionStorage.setItem(EMBED_SESSION_ID_KEY, cleaned);
      } else {
        window.sessionStorage.removeItem(EMBED_SESSION_ID_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }
}

export function getEmbedSessionId(): string | null {
  if (inMemoryEmbedSessionId) return inMemoryEmbedSessionId;
  if (typeof window === "undefined") return null;
  try {
    const val = window.sessionStorage.getItem(EMBED_SESSION_ID_KEY);
    if (val && val.trim().length > 0) {
      inMemoryEmbedSessionId = val.trim();
      return inMemoryEmbedSessionId;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function setEmbedAccessToken(token: string | null): void {
  const cleaned = token && token.trim().length > 0 ? token.trim() : null;
  inMemoryEmbedToken = cleaned;
  if (!cleaned) {
    setEmbedSessionId(null);
  }
  if (typeof window !== "undefined") {
    try {
      if (cleaned) {
        window.sessionStorage.setItem(EMBED_SESSION_TOKEN_KEY, cleaned);
      } else {
        window.sessionStorage.removeItem(EMBED_SESSION_TOKEN_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }
  resetInkadeClient();
}

export function getStoredBearerToken(): string | undefined {
  if (inMemoryEmbedToken) return inMemoryEmbedToken;
  if (typeof window === "undefined") return undefined;
  try {
    const embedSession = window.sessionStorage.getItem(EMBED_SESSION_TOKEN_KEY);
    if (embedSession && embedSession.trim().length > 0) {
      inMemoryEmbedToken = embedSession.trim();
      return inMemoryEmbedToken;
    }
    const val = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (val && val.trim().length > 0) return val.trim();
  } catch {
    // ignore storage errors
  }
  return getMobileShellInjectedToken();
}

export function setStoredBearerToken(token: string | null): void {
  if (token === null) {
    inMemoryEmbedToken = null;
    inMemoryEmbedSessionId = null;
  }
  if (typeof window === "undefined") return;
  try {
    if (token === null) {
      window.sessionStorage.removeItem(EMBED_SESSION_TOKEN_KEY);
      window.sessionStorage.removeItem(EMBED_SESSION_ID_KEY);
    }
    if (token && token.trim().length > 0) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
  resetInkadeClient();
}

let cachedClient: InkadeClient | null = null;
const clientListeners = new Set<() => void>();

export function subscribeInkadeClient(listener: () => void): () => void {
  clientListeners.add(listener);
  return () => {
    clientListeners.delete(listener);
  };
}

export function getInkadeClient(): InkadeClient {
  if (!cachedClient) {
    const token = getStoredBearerToken();
    cachedClient = createInkadeClient({
      baseUrl: getAppBasePath(),
      credentials: "include",
      ...(token ? { token } : {}),
    });
  }
  return cachedClient;
}

export function resetInkadeClient(): void {
  cachedClient = null;
  for (const listener of clientListeners) {
    listener();
  }
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const res = await fetch(withBasePath("/api/auth/sign-in/email"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(data?.message ?? `Sign-in failed (${res.status})`);
  }
  setStoredBearerToken(null);
}

export async function signUpWithEmail(name: string, email: string, password: string): Promise<void> {
  const res = await fetch(withBasePath("/api/auth/sign-up/email"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(data?.message ?? `Sign-up failed (${res.status})`);
  }
  setStoredBearerToken(null);
}

export async function signOutSession(): Promise<void> {
  setStoredBearerToken(null);
  await fetch(withBasePath("/api/auth/sign-out"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }).catch(() => undefined);
  if (isNativeMobileShell()) {
    postToNativeShell({ kind: "sign_out" });
  }
}
