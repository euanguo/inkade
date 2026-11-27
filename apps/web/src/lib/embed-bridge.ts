import {
  type AdeThreadBinding,
  type EmbedHostCapability,
  type EmbedProjectContext,
  type HostGotoAnchorPayload,
  type HostToInkadeMessage,
  INKADE_EMBED_PROTOCOL,
  type InkadeEventPayloadMap,
  type InkadePlaceChangedPayload,
  type InkadeRouteChangedPayload,
  type InkadeSaveStateChangedPayload,
  type InkadeStatusChangedPayload,
  type InkadeToHostMessage,
  parseHostToInkadeMessage,
  type SelectionAnchor,
} from "@inkade/core";
import { usePreferencesStore } from "@inkade/views/lib/preferences-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEmbedSessionId, getInkadeClient } from "./api.ts";
import { getAppBasePath } from "./base-path.ts";

export interface EmbedBridgeHostInfo {
  readonly hostId: string;
  readonly hostName?: string | undefined;
  readonly capabilities: readonly EmbedHostCapability[];
  readonly projectContext?: EmbedProjectContext | undefined;
}

export interface EmbedBridgeApi {
  readonly connected: boolean;
  readonly hostInfo: EmbedBridgeHostInfo | null;
  readonly canSpawnThread: boolean;
  readonly canOpenThread: boolean;
  readonly canCopyClipboard: boolean;
  readonly canOpenExternalUrl: boolean;
  readonly emitRouteChanged: (payload: InkadeRouteChangedPayload) => void;
  readonly emitStatusChanged: (payload: InkadeStatusChangedPayload) => void;
  readonly emitSaveStateChanged: (payload: InkadeSaveStateChangedPayload) => void;
  readonly emitPlaceChanged: (payload: InkadePlaceChangedPayload) => void;
  readonly handleServerShellEvent: (payload: InkadeEventPayloadMap["embed.shell_event"]) => void;
  readonly requestSpawnThread: (payload: {
    readonly documentId: string;
    readonly documentTitle: string;
    readonly nodeId?: string | null | undefined;
    readonly selectionAnchor?: SelectionAnchor | null | undefined;
    readonly prompt: string;
    readonly title: string;
    readonly projectRuleId?: string | undefined;
  }) => Promise<unknown>;
  readonly requestOpenThread: (binding: AdeThreadBinding) => Promise<unknown>;
  readonly requestCopy: (text: string) => Promise<boolean>;
  readonly requestOpenUrl: (url: string) => Promise<void>;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (err: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function getInitialParentTargetOrigin(): string {
  if (typeof document !== "undefined" && document.referrer) {
    try {
      const origin = new URL(document.referrer).origin;
      if (origin && origin !== "null") return origin;
    } catch {
      // ignore referrer parse failure
    }
  }
  return "*";
}

function applyHostCssVars(hostId: string, cssVars?: Readonly<Record<string, string>>): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-inkade-host", hostId);
  if (!cssVars) return;
  for (const [key, val] of Object.entries(cssVars)) {
    if (key.startsWith("--") && typeof val === "string") {
      root.style.setProperty(key, val);
    }
  }
}

function stripBasePathPrefix(rawPath: string): string {
  const base = getAppBasePath();
  const normalized = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (base && (normalized === base || normalized.startsWith(`${base}/`))) {
    return normalized.slice(base.length) || "/";
  }
  return normalized;
}

export function useEmbedBridge(options: {
  readonly enabled: boolean;
  readonly currentPath: string;
  readonly onNavigatePath: (path: string) => void;
  readonly onGotoAnchor?: ((payload: HostGotoAnchorPayload) => void) | undefined;
}): EmbedBridgeApi {
  const { enabled, currentPath, onNavigatePath, onGotoAnchor } = options;
  const [hostInfo, setHostInfo] = useState<EmbedBridgeHostInfo | null>(null);
  const lockedOriginRef = useRef<string | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map());
  const navigateRef = useRef(onNavigatePath);
  navigateRef.current = onNavigatePath;
  const gotoAnchorRef = useRef(onGotoAnchor);
  gotoAnchorRef.current = onGotoAnchor;

  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  const embedSessionId = enabled ? getEmbedSessionId() : null;
  const isTopLevelTicketMode =
    enabled &&
    typeof window !== "undefined" &&
    window.parent === window &&
    Boolean(embedSessionId);

  const postToHost = useCallback((msg: InkadeToHostMessage, allowInitialWildcard = false): boolean => {
    if (typeof window === "undefined") {
      return false;
    }
    if (window.parent === window) {
      const activeSessionId = getEmbedSessionId();
      if (!activeSessionId) {
        return false;
      }
      void getInkadeClient()
        .auth.emitEmbedShellEvent({
          embedSessionId: activeSessionId,
          message: msg,
        })
        .catch(() => {});
      return true;
    }
    const targetOrigin =
      lockedOriginRef.current ??
      (allowInitialWildcard ? getInitialParentTargetOrigin() : null);
    if (!targetOrigin) {
      return false;
    }
    window.parent.postMessage(msg, targetOrigin);
    return true;
  }, []);

  const handleParsedHostMessage = useCallback((msg: HostToInkadeMessage): void => {
    if (msg.type === "host.hello") {
      setHostInfo({
        hostId: msg.payload.hostId,
        hostName: msg.payload.hostName,
        capabilities: msg.payload.capabilities,
        projectContext: msg.payload.projectContext,
      });
      applyHostCssVars(msg.payload.hostId, msg.payload.cssVars);
      if (msg.payload.theme) {
        usePreferencesStore.getState().setThemePreference(msg.payload.theme);
      }
      return;
    }

    switch (msg.type) {
      case "host.navigate":
        navigateRef.current(stripBasePathPrefix(msg.payload.path));
        break;
      case "host.goto_anchor":
        gotoAnchorRef.current?.(msg.payload);
        break;
      case "host.theme_changed":
        usePreferencesStore.getState().setThemePreference(msg.payload.theme);
        break;
      case "host.context_changed":
        setHostInfo((prev) =>
          prev ? { ...prev, projectContext: msg.payload } : prev,
        );
        break;
      case "host.response": {
        const pending = pendingRequestsRef.current.get(msg.requestId);
        if (!pending) break;
        pendingRequestsRef.current.delete(msg.requestId);
        clearTimeout(pending.timer);
        if (msg.payload.ok) {
          pending.resolve(msg.payload.result);
        } else {
          pending.reject(new Error(msg.payload.error || "Host bridge request failed"));
        }
        break;
      }
    }
  }, []);

  const handleServerShellEvent = useCallback(
    (payload: InkadeEventPayloadMap["embed.shell_event"]): void => {
      if (!enabled || payload.direction !== "host_to_inkade") return;
      const activeSessionId = getEmbedSessionId();
      if (activeSessionId && payload.embedSessionId && payload.embedSessionId !== activeSessionId) {
        return;
      }
      handleParsedHostMessage(payload.message);
    },
    [enabled, handleParsedHostMessage],
  );

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    if (window.parent === window) {
      if (!embedSessionId) return;
      postToHost(
        {
          protocol: INKADE_EMBED_PROTOCOL,
          type: "inkade.ready",
          payload: {
            version: "0.1.0",
            currentPath: currentPathRef.current,
          },
        },
        true,
      );
      return;
    }

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window.parent) return;
      if (lockedOriginRef.current !== null && event.origin !== lockedOriginRef.current) {
        return;
      }

      const msg = parseHostToInkadeMessage(event.data);
      if (!msg) return;

      if (msg.type === "host.hello") {
        // Lock origin on first valid host.hello
        if (lockedOriginRef.current === null && event.origin && event.origin !== "null") {
          lockedOriginRef.current = event.origin;
        }
        handleParsedHostMessage(msg);
        return;
      }

      // Reject subsequent commands until parentOrigin is locked by a valid host.hello
      if (lockedOriginRef.current === null) {
        return;
      }

      handleParsedHostMessage(msg);
    };

    window.addEventListener("message", onMessage);
    postToHost(
      {
        protocol: INKADE_EMBED_PROTOCOL,
        type: "inkade.ready",
        payload: {
          version: "0.1.0",
          currentPath: currentPathRef.current,
        },
      },
      true,
    );

    const pendingMap = pendingRequestsRef.current;
    return () => {
      window.removeEventListener("message", onMessage);
      for (const [, req] of pendingMap) {
        clearTimeout(req.timer);
      }
      pendingMap.clear();
    };
  }, [embedSessionId, enabled, handleParsedHostMessage, postToHost]);

  const sendRequest = useCallback(
    (build: (requestId: string) => InkadeToHostMessage): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const hasParentFrame = typeof window !== "undefined" && window.parent !== window;
        const canSendFrame = hasParentFrame && lockedOriginRef.current !== null;
        const canSendTicket = !hasParentFrame && Boolean(getEmbedSessionId());
        if (!enabled || (!canSendFrame && !canSendTicket)) {
          reject(new Error("Host bridge is not connected"));
          return;
        }
        const requestId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const timer = setTimeout(() => {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error("Host bridge request timed out"));
        }, 15_000);
        pendingRequestsRef.current.set(requestId, { resolve, reject, timer });
        const sent = postToHost(build(requestId));
        if (!sent) {
          clearTimeout(timer);
          pendingRequestsRef.current.delete(requestId);
          reject(new Error("Unable to post message to host window"));
        }
      });
    },
    [enabled, postToHost],
  );

  const emitRouteChanged = useCallback(
    (payload: InkadeRouteChangedPayload) => {
      if (!enabled) return;
      postToHost({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "inkade.route_changed",
        payload,
      });
    },
    [enabled, postToHost],
  );

  const emitStatusChanged = useCallback(
    (payload: InkadeStatusChangedPayload) => {
      if (!enabled) return;
      postToHost({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "inkade.status_changed",
        payload,
      });
    },
    [enabled, postToHost],
  );

  const emitSaveStateChanged = useCallback(
    (payload: InkadeSaveStateChangedPayload) => {
      if (!enabled) return;
      postToHost({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "inkade.save_state_changed",
        payload,
      });
    },
    [enabled, postToHost],
  );

  const emitPlaceChanged = useCallback(
    (payload: InkadePlaceChangedPayload) => {
      if (!enabled) return;
      postToHost({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "inkade.place_changed",
        payload,
      });
    },
    [enabled, postToHost],
  );

  const capabilitiesSet = useMemo(
    () => new Set<EmbedHostCapability>(hostInfo?.capabilities ?? []),
    [hostInfo?.capabilities],
  );

  const requestSpawnThread = useCallback(
    (payload: {
      readonly documentId: string;
      readonly documentTitle: string;
      readonly nodeId?: string | null | undefined;
      readonly selectionAnchor?: SelectionAnchor | null | undefined;
      readonly prompt: string;
      readonly title: string;
      readonly projectRuleId?: string | undefined;
    }) =>
      sendRequest((requestId) => ({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "inkade.request.spawn_thread",
        requestId,
        payload,
      })),
    [sendRequest],
  );

  const requestOpenThread = useCallback(
    (binding: AdeThreadBinding) =>
      sendRequest((requestId) => ({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "inkade.request.open_thread",
        requestId,
        payload: {
          binding: {
            id: binding.id,
            workspaceId: binding.workspaceId,
            documentId: binding.documentId,
            nodeId: binding.nodeId,
            adeKind: binding.adeKind,
            externalWorkspaceId: binding.externalWorkspaceId,
            externalThreadId: binding.externalThreadId,
            deepLink: binding.deepLink,
            title: binding.title,
            status: binding.status,
          },
        },
      })),
    [sendRequest],
  );

  const requestCopy = useCallback(
    async (text: string): Promise<boolean> => {
      await sendRequest((requestId) => ({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "inkade.request.copy",
        requestId,
        payload: { text },
      }));
      return true;
    },
    [sendRequest],
  );

  const requestOpenUrl = useCallback(
    async (url: string): Promise<void> => {
      await sendRequest((requestId) => ({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "inkade.request.open_url",
        requestId,
        payload: { url },
      }));
    },
    [sendRequest],
  );

  return useMemo(
    () => ({
      connected: Boolean(hostInfo) || isTopLevelTicketMode,
      hostInfo,
      canSpawnThread: capabilitiesSet.has("spawn_thread"),
      canOpenThread: capabilitiesSet.has("open_thread"),
      canCopyClipboard: capabilitiesSet.has("copy_clipboard"),
      canOpenExternalUrl: capabilitiesSet.has("open_external_url"),
      emitRouteChanged,
      emitStatusChanged,
      emitSaveStateChanged,
      emitPlaceChanged,
      handleServerShellEvent,
      requestSpawnThread,
      requestOpenThread,
      requestCopy,
      requestOpenUrl,
    }),
    [
      capabilitiesSet,
      emitPlaceChanged,
      emitRouteChanged,
      emitSaveStateChanged,
      emitStatusChanged,
      handleServerShellEvent,
      hostInfo,
      isTopLevelTicketMode,
      requestCopy,
      requestOpenThread,
      requestOpenUrl,
      requestSpawnThread,
    ],
  );
}
