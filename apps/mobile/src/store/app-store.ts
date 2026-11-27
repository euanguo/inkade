import { create } from "zustand";
import type { WhoAmIScopeResponse } from "@inkade/sdk";
import type { MobileAuthMode } from "../storage/credentials.ts";
import {
  readKvBoolean,
  readKvString,
  removeKvKey,
  writeKvBoolean,
  writeKvString,
} from "../storage/kv.ts";

export type ConnectionStatus =
  | "booting"
  | "unconfigured"
  | "connecting"
  | "connected"
  | "error";

export interface MobileToastItem {
  readonly id: string;
  readonly message: string;
  readonly tone: "default" | "success" | "warning" | "error";
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void | Promise<void>) | undefined;
}

const HAPTICS_KV_KEY = "inkade:mobile:haptics";
const WHOAMI_KV_KEY = "inkade:mobile:whoami-cache";

let toastSeq = 0;

/**
 * Loads the last known `whoami` scope metadata from local SQLite KV so offline cold starts still
 * have valid `workspaceId` and `visibleSpaces` IDs.
 */
export function loadCachedWhoami(): WhoAmIScopeResponse | null {
  const raw = readKvString(WHOAMI_KV_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WhoAmIScopeResponse> | null;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.workspaceId === "string" &&
      Array.isArray(parsed.visibleSpaces)
    ) {
      return parsed as WhoAmIScopeResponse;
    }
  } catch {
    return null;
  }
  return null;
}

export interface MobileAppState {
  readonly connectionStatus: ConnectionStatus;
  readonly connectionError: string | null;
  readonly baseUrl: string | null;
  readonly authMode: MobileAuthMode;
  readonly token: string | null;
  readonly whoami: WhoAmIScopeResponse | null;
  readonly isOnline: boolean;
  readonly isSyncingQueue: boolean;
  readonly pendingMutationCount: number;
  readonly hapticsEnabled: boolean;
  readonly webSurfaceBg: string | null;
  readonly webSurfaceIsDark: boolean | null;
  readonly pendingWebPath: string | null;
  readonly webRefreshNonce: number;
  readonly toasts: readonly MobileToastItem[];

  setConnectionBooting: () => void;
  setConnectionUnconfigured: () => void;
  setConnectionConnecting: (baseUrl: string, authMode: MobileAuthMode, token?: string) => void;
  setConnectionReady: (input: {
    readonly baseUrl: string;
    readonly authMode: MobileAuthMode;
    readonly token?: string | undefined;
    readonly whoami: WhoAmIScopeResponse;
  }) => void;
  setConnectionError: (message: string) => void;
  clearConnection: () => void;
  setWhoami: (whoami: WhoAmIScopeResponse | null) => void;
  setIsOnline: (online: boolean) => void;
  setSyncState: (syncing: boolean, pendingCount?: number) => void;
  setPendingMutationCount: (count: number) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setWebSurfaceTheme: (isDark: boolean, backgroundColor: string) => void;
  requestWebNavigation: (path: string) => void;
  consumePendingWebPath: () => void;
  bumpWebRefresh: () => void;
  showToast: (input: Omit<MobileToastItem, "id">, durationMs?: number) => string;
  dismissToast: (id: string) => void;
}

export const useAppStore = create<MobileAppState>((set, get) => ({
  connectionStatus: "booting",
  connectionError: null,
  baseUrl: null,
  authMode: "token",
  token: null,
  whoami: null,
  isOnline: true,
  isSyncingQueue: false,
  pendingMutationCount: 0,
  hapticsEnabled: readKvBoolean(HAPTICS_KV_KEY, true),
  webSurfaceBg: null,
  webSurfaceIsDark: null,
  pendingWebPath: null,
  webRefreshNonce: 0,
  toasts: [],

  setConnectionBooting: () => set({ connectionStatus: "booting", connectionError: null }),

  setConnectionUnconfigured: () => {
    removeKvKey(WHOAMI_KV_KEY);
    set({
      connectionStatus: "unconfigured",
      connectionError: null,
      baseUrl: null,
      token: null,
      whoami: null,
    });
  },

  setConnectionConnecting: (baseUrl, authMode, token) =>
    set({
      connectionStatus: "connecting",
      connectionError: null,
      baseUrl,
      authMode,
      token: token ?? null,
    }),

  setConnectionReady: (input) => {
    try {
      writeKvString(WHOAMI_KV_KEY, JSON.stringify(input.whoami));
    } catch {
      // Ignore KV persistence failures; in-memory state still works for the session.
    }
    set({
      connectionStatus: "connected",
      connectionError: null,
      baseUrl: input.baseUrl,
      authMode: input.authMode,
      token: input.token ?? null,
      whoami: input.whoami,
    });
  },

  setConnectionError: (message) =>
    set({
      connectionStatus: "error",
      connectionError: message,
    }),

  clearConnection: () => {
    removeKvKey(WHOAMI_KV_KEY);
    set({
      connectionStatus: "unconfigured",
      connectionError: null,
      baseUrl: null,
      authMode: "token",
      token: null,
      whoami: null,
      webSurfaceBg: null,
      webSurfaceIsDark: null,
      pendingWebPath: null,
    });
  },

  setWhoami: (whoami) => set({ whoami }),

  setIsOnline: (online) => set({ isOnline: online }),

  setSyncState: (syncing, pendingCount) =>
    set((prev) => ({
      isSyncingQueue: syncing,
      pendingMutationCount: pendingCount ?? prev.pendingMutationCount,
    })),

  setPendingMutationCount: (count) => set({ pendingMutationCount: count }),

  setHapticsEnabled: (enabled) => {
    writeKvBoolean(HAPTICS_KV_KEY, enabled);
    set({ hapticsEnabled: enabled });
  },

  setWebSurfaceTheme: (isDark, backgroundColor) =>
    set({ webSurfaceIsDark: isDark, webSurfaceBg: backgroundColor }),

  requestWebNavigation: (path) => set({ pendingWebPath: path }),

  consumePendingWebPath: () => set({ pendingWebPath: null }),

  bumpWebRefresh: () => set((prev) => ({ webRefreshNonce: prev.webRefreshNonce + 1 })),

  showToast: (input, durationMs = input.onAction ? 5000 : 2800) => {
    const id = `toast_${++toastSeq}`;
    const item: MobileToastItem = { id, ...input };
    set((prev) => ({
      toasts: [...prev.toasts.slice(-2), item],
    }));
    setTimeout(() => {
      get().dismissToast(id);
    }, durationMs);
    return id;
  },

  dismissToast: (id) =>
    set((prev) => ({
      toasts: prev.toasts.filter((t) => t.id !== id),
    })),
}));
