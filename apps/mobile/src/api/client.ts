import { QueryClient } from "@tanstack/react-query";
import { t as inkadeT } from "@inkade/i18n";
import {
  InkadeClient,
  inkadeQueryKeys,
  type FetchLike,
} from "@inkade/sdk";
import {
  enqueueOfflineMutationWithCache,
  flushOfflineMutationQueue,
  type OfflineMutationPayload,
} from "@inkade/sdk/offline";
import { fetch as expoFetch } from "expo/fetch";
import * as Network from "expo-network";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { triggerOutcomeHaptic } from "../lib/haptics.ts";
import { isLikelyNetworkError } from "../lib/text-format.ts";
import { SqliteOfflineCacheBackend } from "../storage/sqlite-offline-backend.ts";
import { useAppStore } from "../store/app-store.ts";

export { isLikelyNetworkError };

export const mobileQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "offlineFirst",
      staleTime: 15_000,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
    },
    mutations: {
      networkMode: "offlineFirst",
    },
  },
});

export const mobileOfflineBackend = new SqliteOfflineCacheBackend();

const rnFetch: FetchLike = (input, init) => {
  if (typeof expoFetch === "function") {
    const target = typeof input === "string" || input instanceof URL ? input : input.url;
    return expoFetch(target, init) as unknown as Promise<Response>;
  }
  return globalThis.fetch(input, init);
};

export function createConfiguredInkadeClient(
  baseUrl: string,
  authMode: "token" | "local-auto",
  token?: string | null,
): InkadeClient {
  return new InkadeClient({
    baseUrl,
    ...(authMode === "token" && token ? { token } : {}),
    fetch: rnFetch,
  });
}

export function useInkadeClient(): InkadeClient | null {
  const baseUrl = useAppStore((s) => s.baseUrl);
  const authMode = useAppStore((s) => s.authMode);
  const token = useAppStore((s) => s.token);
  const status = useAppStore((s) => s.connectionStatus);

  return useMemo(() => {
    if (!baseUrl || status !== "connected") return null;
    return createConfiguredInkadeClient(baseUrl, authMode, token);
  }, [baseUrl, authMode, token, status]);
}

let mutationCounter = 0;
let activeFlushPromise: Promise<void> | null = null;

export async function queueOfflineMutation(
  payload: OfflineMutationPayload,
): Promise<void> {
  const id = `mob_mut_${Date.now()}_${++mutationCounter}`;
  await enqueueOfflineMutationWithCache(mobileOfflineBackend, payload, id);
  const queued = await mobileOfflineBackend.listMutations();
  useAppStore.getState().setPendingMutationCount(queued.length);
}

export async function refreshPendingMutationCount(): Promise<number> {
  const queued = await mobileOfflineBackend.listMutations();
  useAppStore.getState().setPendingMutationCount(queued.length);
  return queued.length;
}

/**
 * Flushes pending offline mutations with a module-level single-flight lock so reconnect events,
 * foreground transitions, and manual sync taps never race against duplicate replays.
 */
export async function flushOfflineQueueNow(silent = false): Promise<void> {
  const { baseUrl, authMode, token, connectionStatus } = useAppStore.getState();
  if (!baseUrl || connectionStatus !== "connected") return;
  if (activeFlushPromise) {
    return activeFlushPromise;
  }

  const run = async () => {
    const pending = await mobileOfflineBackend.listMutations();
    useAppStore.getState().setPendingMutationCount(pending.length);
    if (pending.length === 0) return;

    const client = createConfiguredInkadeClient(baseUrl, authMode, token);
    useAppStore.getState().setSyncState(true, pending.length);
    try {
      const res = await flushOfflineMutationQueue(mobileOfflineBackend, client);
      useAppStore.getState().setSyncState(false, res.remaining);

      if (res.applied.length > 0) {
        await mobileQueryClient.invalidateQueries({ queryKey: inkadeQueryKeys.all });
        useAppStore.getState().bumpWebRefresh();
        if (!silent) {
          void triggerOutcomeHaptic(useAppStore.getState().hapticsEnabled, "success");
          useAppStore.getState().showToast({
            message: inkadeT("mobile.offline.flushedToast", { applied: res.applied.length }),
            tone: "success",
          });
        }
      }
      if (res.conflicts.length > 0) {
        await mobileQueryClient.invalidateQueries({ queryKey: inkadeQueryKeys.all });
        useAppStore.getState().showToast({
          message: inkadeT("mobile.offline.conflictToast", { count: res.conflicts.length }),
          tone: "warning",
        });
      }
      const hardFailure = res.failed.find((f) => !f.retryable);
      if (hardFailure) {
        useAppStore.getState().showToast({
          message:
            hardFailure.error instanceof Error
              ? hardFailure.error.message
              : inkadeT("common.unknownError"),
          tone: "error",
        });
      }
      if (res.failed.some((f) => f.retryable) && !silent && res.applied.length === 0) {
        useAppStore.getState().showToast({
          message: inkadeT("mobile.offline.bannerOffline"),
          tone: "warning",
        });
      }
    } finally {
      const after = await mobileOfflineBackend.listMutations().catch(() => []);
      useAppStore.getState().setSyncState(false, after.length);
    }
  };

  activeFlushPromise = run().finally(() => {
    activeFlushPromise = null;
  });
  return activeFlushPromise;
}

/**
 * Mount once at the root app shell (`app/_layout.tsx`) to track OS connectivity transitions and
 * automatically trigger single-flight queue flushes on reconnect or foreground resume.
 */
export function useOfflineSyncController(): void {
  const client = useInkadeClient();
  const networkState = Network.useNetworkState();

  const online =
    networkState.isConnected !== false && networkState.isInternetReachable !== false;

  useEffect(() => {
    useAppStore.getState().setIsOnline(online);
  }, [online]);

  useEffect(() => {
    void refreshPendingMutationCount();
  }, []);

  useEffect(() => {
    if (online && client) {
      void flushOfflineQueueNow(true);
    }
  }, [online, client]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && client) {
        void flushOfflineQueueNow(true);
      }
    });
    return () => sub.remove();
  }, [client]);
}
