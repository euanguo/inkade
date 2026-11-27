import { readKvString, removeKvKey, writeKvString } from "./kv.ts";

export type MobileAuthMode = "token" | "local-auto";

export interface StoredConnectionCredentials {
  readonly baseUrl: string;
  readonly authMode: MobileAuthMode;
  readonly token?: string | undefined;
}

const CREDENTIALS_STORE_KEY = "inkade.mobile.credentials.v1";

interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

async function resolveSecureStore(): Promise<SecureStoreLike | null> {
  try {
    const mod = (await import("expo-secure-store")) as SecureStoreLike & {
      isAvailableAsync?: () => Promise<boolean>;
    };
    if (mod.isAvailableAsync) {
      const available = await mod.isAvailableAsync();
      if (!available) return null;
    }
    return mod;
  } catch {
    return null;
  }
}

export function normalizeServerBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`.replace(
      /\/+$/,
      "",
    );
  } catch {
    return null;
  }
}

function parseStoredCredentialsJson(raw: string): StoredConnectionCredentials | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const obj = data as { baseUrl?: unknown; authMode?: unknown; token?: unknown };
    if (typeof obj.baseUrl !== "string") return null;
    const normalized = normalizeServerBaseUrl(obj.baseUrl);
    if (!normalized) return null;
    if (obj.authMode !== "token" && obj.authMode !== "local-auto") return null;
    const token = typeof obj.token === "string" && obj.token.length > 0 ? obj.token : undefined;
    return {
      baseUrl: normalized,
      authMode: obj.authMode,
      ...(token ? { token } : {}),
    };
  } catch {
    return null;
  }
}

export async function loadCredentials(): Promise<StoredConnectionCredentials | null> {
  let raw: string | null = null;
  const secure = await resolveSecureStore();
  if (secure) {
    try {
      raw = await secure.getItemAsync(CREDENTIALS_STORE_KEY);
    } catch {
      raw = null;
    }
  }
  if (!raw) {
    raw = readKvString(CREDENTIALS_STORE_KEY);
  }
  if (!raw) return null;
  return parseStoredCredentialsJson(raw);
}

export async function saveCredentials(credentials: StoredConnectionCredentials): Promise<void> {
  const serialized = JSON.stringify({
    baseUrl: credentials.baseUrl.replace(/\/+$/, ""),
    authMode: credentials.authMode,
    ...(credentials.token ? { token: credentials.token } : {}),
  });
  const secure = await resolveSecureStore();
  if (secure) {
    await secure.setItemAsync(CREDENTIALS_STORE_KEY, serialized);
    removeKvKey(CREDENTIALS_STORE_KEY);
    return;
  }
  writeKvString(CREDENTIALS_STORE_KEY, serialized);
}

export async function clearCredentials(): Promise<void> {
  const secure = await resolveSecureStore();
  if (secure) {
    await secure.deleteItemAsync(CREDENTIALS_STORE_KEY).catch(() => {});
  }
  removeKvKey(CREDENTIALS_STORE_KEY);
}
