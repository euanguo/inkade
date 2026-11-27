import { adeKindSchema, isValidDailyDate, type AdeKind } from "@inkade/core";

export const DEFAULT_QUICK_CAPTURE_SHORTCUT = "CommandOrControl+Shift+Space";

export type InkadeDeepLinkRoute =
  | {
      readonly kind: "daily";
      readonly date?: string | undefined;
      readonly nodeId?: string | undefined;
      readonly webPath: string;
    }
  | {
      readonly kind: "document";
      readonly documentId: string;
      readonly webPath: string;
    }
  | {
      readonly kind: "thread";
      readonly adeKind: AdeKind;
      readonly externalThreadId: string;
      readonly webPath: string;
    }
  | {
      readonly kind: "capture";
      readonly title?: string | undefined;
      readonly text?: string | undefined;
      readonly url?: string | undefined;
      readonly spaceId?: string | undefined;
      readonly webPath: string;
    }
  | {
      readonly kind: "inbox";
      readonly title?: string | undefined;
      readonly text?: string | undefined;
      readonly url?: string | undefined;
      readonly webPath: string;
    }
  | {
      readonly kind: "tasks";
      readonly webPath: "/tasks";
    }
  | {
      readonly kind: "settings";
      readonly section?: string | undefined;
      readonly webPath: string;
    };

export interface TrayAttentionState {
  readonly waitingCount: number;
  readonly hasAttention: boolean;
  readonly badgeText: string;
  readonly status: "idle" | "attention";
}

export interface GlobalShortcutRegistration {
  readonly accelerator: string;
  readonly action: "toggle-quick-capture";
  readonly webviewWindow: "quick-capture";
}

export interface DesktopNotificationPayload {
  readonly title: string;
  readonly body: string;
  readonly deepLink?: string | undefined;
}

export interface TauriRuntimeBridge {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen?(
    event: string,
    handler: (payload: unknown) => void,
  ): Promise<() => void> | (() => void);
}

/**
 * Parses an `inkade://` deep link into a strongly typed route and matching `apps/web` path.
 * Returns `null` for non-`inkade:` URLs or unrecognized routes.
 */
export function parseInkadeDeepLink(rawUrl: string): InkadeDeepLinkRoute | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "inkade:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (host === "daily") {
    const rawDate = segments[0];
    const date = rawDate && isValidDailyDate(rawDate) ? rawDate : undefined;
    if (rawDate && !date) {
      return null;
    }
    const nodeId = parsed.searchParams.get("nodeId")?.trim() || undefined;
    const base = date ? `/daily/${encodeURIComponent(date)}` : "/daily";
    const webPath = nodeId ? `${base}?nodeId=${encodeURIComponent(nodeId)}` : base;
    return {
      kind: "daily",
      ...(date ? { date } : {}),
      ...(nodeId ? { nodeId } : {}),
      webPath,
    };
  }

  if (host === "doc" || host === "docs") {
    const documentId = segments[0]?.trim();
    if (!documentId) return null;
    return {
      kind: "document",
      documentId,
      webPath: `/docs/${encodeURIComponent(documentId)}`,
    };
  }

  if (host === "thread" || host === "threads") {
    const rawAde = segments[0]?.trim() ?? "";
    const parsedAde = adeKindSchema.safeParse(rawAde);
    const externalThreadId = segments.slice(1).join("/").trim();
    if (!parsedAde.success || !externalThreadId) {
      return null;
    }
    const adeKind: AdeKind = parsedAde.data;
    const qs = new URLSearchParams({
      ade: adeKind,
      threadId: externalThreadId,
    });
    return {
      kind: "thread",
      adeKind,
      externalThreadId,
      webPath: `/threads?${qs.toString()}`,
    };
  }

  if (host === "capture" || host === "inbox") {
    const title = parsed.searchParams.get("title")?.trim() || undefined;
    const text = parsed.searchParams.get("text")?.trim() || undefined;
    const url = parsed.searchParams.get("url")?.trim() || undefined;
    const spaceId = parsed.searchParams.get("spaceId")?.trim() || undefined;
    const qs = new URLSearchParams();
    if (title) qs.set("title", title);
    if (text) qs.set("text", text);
    if (url) qs.set("url", url);
    if (spaceId && host === "capture") qs.set("spaceId", spaceId);
    const queryStr = qs.toString();
    const webPath = queryStr ? `/inbox?${queryStr}` : "/inbox";

    if (host === "capture") {
      return {
        kind: "capture",
        ...(title ? { title } : {}),
        ...(text ? { text } : {}),
        ...(url ? { url } : {}),
        ...(spaceId ? { spaceId } : {}),
        webPath,
      };
    }
    return {
      kind: "inbox",
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
      ...(url ? { url } : {}),
      webPath,
    };
  }

  if (host === "tasks") {
    return {
      kind: "tasks",
      webPath: "/tasks",
    };
  }

  if (host === "settings") {
    const section = segments[0]?.trim() || undefined;
    const webPath = section ? `/settings/${encodeURIComponent(section)}` : "/settings";
    return {
      kind: "settings",
      ...(section ? { section } : {}),
      webPath,
    };
  }

  return null;
}

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function formatInkadeDeepLink(route: DistributiveOmit<InkadeDeepLinkRoute, "webPath">): string {
  switch (route.kind) {
    case "daily": {
      const base = route.date ? `inkade://daily/${encodeURIComponent(route.date)}` : "inkade://daily";
      return route.nodeId ? `${base}?nodeId=${encodeURIComponent(route.nodeId)}` : base;
    }
    case "document":
      return `inkade://doc/${encodeURIComponent(route.documentId)}`;
    case "thread":
      return `inkade://thread/${encodeURIComponent(route.adeKind)}/${encodeURIComponent(route.externalThreadId)}`;
    case "capture":
    case "inbox": {
      const qs = new URLSearchParams();
      if (route.title) qs.set("title", route.title);
      if (route.text) qs.set("text", route.text);
      if (route.url) qs.set("url", route.url);
      if (route.kind === "capture" && route.spaceId) qs.set("spaceId", route.spaceId);
      const q = qs.toString();
      return q ? `inkade://${route.kind}?${q}` : `inkade://${route.kind}`;
    }
    case "tasks":
      return "inkade://tasks";
    case "settings":
      return route.section
        ? `inkade://settings/${encodeURIComponent(route.section)}`
        : "inkade://settings";
  }
}

/**
 * Computes tray badge display and attention status from the number of `waiting_input` ADE threads.
 */
export function resolveTrayAttentionBadge(waitingCount: number): TrayAttentionState {
  const safeCount = Number.isFinite(waitingCount) ? Math.max(0, Math.floor(waitingCount)) : 0;
  if (safeCount === 0) {
    return {
      waitingCount: 0,
      hasAttention: false,
      badgeText: "",
      status: "idle",
    };
  }
  return {
    waitingCount: safeCount,
    hasAttention: true,
    badgeText: safeCount > 99 ? "99+" : String(safeCount),
    status: "attention",
  };
}

/**
 * Validates and constructs the Tauri v2 global quick-capture shortcut descriptor.
 */
export function createGlobalQuickCaptureShortcut(
  accelerator: string = DEFAULT_QUICK_CAPTURE_SHORTCUT,
): GlobalShortcutRegistration {
  const normalized = accelerator
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("+");

  if (!normalized || !normalized.includes("+")) {
    throw new Error(`Invalid global shortcut accelerator: "${accelerator}"`);
  }

  return {
    accelerator: normalized,
    action: "toggle-quick-capture",
    webviewWindow: "quick-capture",
  };
}

interface TauriInternalsGlobal {
  readonly __TAURI_INTERNALS__?: {
    invoke?<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  } | undefined;
  readonly __TAURI__?: {
    readonly core?: {
      invoke?<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    } | undefined;
    readonly event?: {
      listen?(
        event: string,
        handler: (event: { readonly payload: unknown }) => void,
      ): Promise<() => void>;
    } | undefined;
  } | undefined;
}

/**
 * Detects an active Tauri v2 webview bridge, returning `null` safely in plain browser or test contexts.
 */
export function detectTauriRuntime(): TauriRuntimeBridge | null {
  const g = globalThis as unknown as TauriInternalsGlobal;
  const core = g.__TAURI__?.core;
  const internals = g.__TAURI_INTERNALS__;
  if (typeof core?.invoke !== "function" && typeof internals?.invoke !== "function") {
    return null;
  }
  const invoke = <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (typeof core?.invoke === "function") {
      return core.invoke<T>(command, args);
    }
    return internals!.invoke!<T>(command, args);
  };
  const eventApi = g.__TAURI__?.event;
  return {
    invoke,
    ...(eventApi?.listen
      ? {
          listen: (event: string, handler: (payload: unknown) => void) =>
            eventApi.listen!(event, (ev) => handler(ev.payload)),
        }
      : {}),
  };
}

export async function registerGlobalQuickCaptureShortcut(
  accelerator: string = DEFAULT_QUICK_CAPTURE_SHORTCUT,
  runtime: TauriRuntimeBridge | null = detectTauriRuntime(),
): Promise<GlobalShortcutRegistration> {
  const registration = createGlobalQuickCaptureShortcut(accelerator);
  if (runtime) {
    await runtime.invoke("register_quick_capture_shortcut", {
      accelerator: registration.accelerator,
    });
  }
  return registration;
}

export async function toggleQuickCaptureWindow(
  visible?: boolean,
  runtime: TauriRuntimeBridge | null = detectTauriRuntime(),
): Promise<boolean> {
  if (runtime) {
    return await runtime.invoke<boolean>("toggle_quick_capture", {
      ...(visible !== undefined ? { visible } : {}),
    });
  }
  return visible ?? false;
}

export async function syncTrayWaitingInputCount(
  waitingCount: number,
  runtime: TauriRuntimeBridge | null = detectTauriRuntime(),
): Promise<TrayAttentionState> {
  const state = resolveTrayAttentionBadge(waitingCount);
  if (runtime) {
    await runtime.invoke("update_tray_attention", {
      waitingCount: state.waitingCount,
    });
  }
  return state;
}

export async function dispatchDesktopNotification(
  payload: DesktopNotificationPayload,
  runtime: TauriRuntimeBridge | null = detectTauriRuntime(),
): Promise<boolean> {
  if (runtime) {
    await runtime.invoke("send_desktop_notification", {
      title: payload.title,
      body: payload.body,
      deepLink: payload.deepLink ?? null,
    });
    return true;
  }

  if (typeof globalThis.Notification === "function" && globalThis.Notification.permission === "granted") {
    new globalThis.Notification(payload.title, { body: payload.body });
    return true;
  }

  return false;
}

export async function openDeepLinkInMainWindow(
  rawUrl: string,
  runtime: TauriRuntimeBridge | null = detectTauriRuntime(),
): Promise<InkadeDeepLinkRoute | null> {
  const route = parseInkadeDeepLink(rawUrl);
  if (!route) return null;

  if (runtime) {
    await runtime.invoke("navigate_main_window", {
      path: route.webPath,
    });
  }
  return route;
}
