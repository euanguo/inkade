import {
  type EmbedHostCapability,
  type EmbedHostTheme,
  type EmbedProjectContext,
  type HostGotoAnchorPayload,
  type HostHelloPayload,
  type HostToInkadeMessage,
  INKADE_EMBED_PROTOCOL,
  type InkadePlaceChangedPayload,
  type InkadeReadyPayload,
  type InkadeRequestOpenThreadPayload,
  type InkadeRequestSpawnThreadPayload,
  type InkadeRouteChangedPayload,
  type InkadeSaveStateChangedPayload,
  type InkadeStatusChangedPayload,
  type InkadeToHostMessage,
  parseInkadeToHostMessage,
} from "@inkade/core";
import type { FetchLike } from "./http-transport.ts";
import { subscribeInkadeEvents } from "./sse.ts";

export interface EmbedMessageEventLike {
  readonly data: unknown;
  readonly origin?: string | undefined;
  readonly source?: unknown;
}

export interface EmbedWindowTargetLike {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface EmbedIframeLike {
  readonly contentWindow: EmbedWindowTargetLike | null;
  readonly src?: string | undefined;
  addEventListener?(type: "load", listener: () => void): void;
  removeEventListener?(type: "load", listener: () => void): void;
}

export interface EmbedHostWindowLike {
  addEventListener(type: "message", listener: (event: EmbedMessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: EmbedMessageEventLike) => void): void;
}

export interface InkadeEmbedHostOptions {
  readonly hostId: string;
  readonly hostName?: string | undefined;
  readonly capabilities?: readonly EmbedHostCapability[] | undefined;
  readonly theme?: EmbedHostTheme | undefined;
  readonly cssVars?: Readonly<Record<string, string>> | undefined;
  readonly projectContext?: EmbedProjectContext | undefined;
  readonly targetOrigin?: string | undefined;
  readonly hostWindow?: EmbedHostWindowLike | undefined;
  readonly onReady?: ((payload: InkadeReadyPayload) => void) | undefined;
  readonly onRouteChange?: ((payload: InkadeRouteChangedPayload) => void) | undefined;
  readonly onStatusChange?: ((payload: InkadeStatusChangedPayload) => void) | undefined;
  readonly onSaveStateChange?: ((payload: InkadeSaveStateChangedPayload) => void) | undefined;
  readonly onPlaceChange?: ((payload: InkadePlaceChangedPayload) => void) | undefined;
  readonly onSpawnThread?: (
    payload: InkadeRequestSpawnThreadPayload,
  ) => unknown;
  readonly onOpenThread?: (
    payload: InkadeRequestOpenThreadPayload,
  ) => unknown;
  readonly onCopy?: ((text: string) => Promise<boolean | void> | boolean | void) | undefined;
  readonly onOpenUrl?: ((url: string) => Promise<void> | void) | undefined;
  readonly serverBaseUrl?: string | undefined;
  readonly authToken?: string | undefined;
  readonly embedSessionId?: string | undefined;
  readonly fetch?: FetchLike | typeof fetch | undefined;
}

export interface InkadeEmbedHostController {
  readonly sendHello: (override?: Partial<Omit<HostHelloPayload, "hostId">>) => void;
  readonly navigate: (path: string) => void;
  readonly gotoAnchor: (payload: HostGotoAnchorPayload) => void;
  readonly setTheme: (theme: EmbedHostTheme) => void;
  readonly setContext: (context: EmbedProjectContext) => void;
  readonly destroy: () => void;
}

function inferTargetOrigin(iframe: EmbedIframeLike | null, explicitOrigin?: string): string {
  if (explicitOrigin && explicitOrigin.trim().length > 0) {
    return explicitOrigin.trim();
  }
  if (iframe?.src) {
    try {
      const parsed = new URL(iframe.src);
      if (parsed.origin && parsed.origin !== "null") {
        return parsed.origin;
      }
    } catch {
      // ignore relative or malformed src
    }
  }
  return "*";
}

function resolveHostWindow(explicit?: EmbedHostWindowLike): EmbedHostWindowLike | null {
  if (explicit) return explicit;
  const g = globalThis as unknown as {
    window?: EmbedHostWindowLike | undefined;
  };
  if (
    g.window &&
    typeof g.window.addEventListener === "function" &&
    typeof g.window.removeEventListener === "function"
  ) {
    return g.window;
  }
  return null;
}

export function createInkadeEmbedHost(
  iframe: EmbedIframeLike | null,
  options: InkadeEmbedHostOptions,
): InkadeEmbedHostController {
  const targetOrigin = inferTargetOrigin(iframe, options.targetOrigin);
  const hostWindow = resolveHostWindow(options.hostWindow);
  const serverBaseUrl = options.serverBaseUrl?.replace(/\/+$/, "");
  const fetchFn: FetchLike =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let destroyed = false;

  const post = (message: HostToInkadeMessage): void => {
    if (destroyed) return;
    const win = iframe?.contentWindow;
    if (win && typeof win.postMessage === "function") {
      win.postMessage(message, targetOrigin);
      return;
    }
    if (serverBaseUrl && (options.authToken || options.embedSessionId)) {
      const headers = new Headers();
      headers.set("content-type", "application/json");
      if (options.authToken) {
        headers.set("authorization", `Bearer ${options.authToken}`);
      }
      void fetchFn(`${serverBaseUrl}/api/v1/embed/command`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...(options.embedSessionId ? { embedSessionId: options.embedSessionId } : {}),
          message,
        }),
      }).catch(() => {});
    }
  };

  const buildHelloPayload = (
    override?: Partial<Omit<HostHelloPayload, "hostId">>,
  ): HostHelloPayload => {
    const theme = override?.theme ?? options.theme;
    const hostName = override?.hostName ?? options.hostName;
    const cssVars = override?.cssVars ?? options.cssVars;
    const projectContext = override?.projectContext ?? options.projectContext;
    return {
      hostId: options.hostId,
      capabilities: [...(override?.capabilities ?? options.capabilities ?? [])],
      ...(hostName ? { hostName } : {}),
      ...(theme ? { theme } : {}),
      ...(cssVars ? { cssVars: { ...cssVars } } : {}),
      ...(projectContext ? { projectContext } : {}),
    };
  };

  const sendHello = (override?: Partial<Omit<HostHelloPayload, "hostId">>): void => {
    post({
      protocol: INKADE_EMBED_PROTOCOL,
      type: "host.hello",
      payload: buildHelloPayload(override),
    });
  };

  const reply = (requestId: string, result: unknown, ok = true, error?: string): void => {
    post({
      protocol: INKADE_EMBED_PROTOCOL,
      type: "host.response",
      requestId,
      payload: {
        ok,
        ...(result !== undefined ? { result } : {}),
        ...(error ? { error } : {}),
      },
    });
  };

  const handleRequest = async (
    requestId: string,
    fn: (() => unknown) | undefined,
    unsupportedLabel: string,
  ): Promise<void> => {
    if (!fn) {
      reply(requestId, undefined, false, unsupportedLabel);
      return;
    }
    try {
      const result = await fn();
      reply(requestId, result ?? { handled: true }, true);
    } catch (err) {
      reply(requestId, undefined, false, err instanceof Error ? err.message : String(err));
    }
  };

  const handleInkadeMessage = (msg: InkadeToHostMessage): void => {
    switch (msg.type) {
      case "inkade.ready":
        sendHello();
        options.onReady?.(msg.payload);
        break;
      case "inkade.route_changed":
        options.onRouteChange?.(msg.payload);
        break;
      case "inkade.status_changed":
        options.onStatusChange?.(msg.payload);
        break;
      case "inkade.save_state_changed":
        options.onSaveStateChange?.(msg.payload);
        break;
      case "inkade.place_changed":
        options.onPlaceChange?.(msg.payload);
        break;
      case "inkade.request.spawn_thread":
        void handleRequest(
          msg.requestId,
          options.onSpawnThread ? () => options.onSpawnThread?.(msg.payload) : undefined,
          "spawn_thread capability not configured on host",
        );
        break;
      case "inkade.request.open_thread":
        void handleRequest(
          msg.requestId,
          options.onOpenThread ? () => options.onOpenThread?.(msg.payload) : undefined,
          "open_thread capability not configured on host",
        );
        break;
      case "inkade.request.copy":
        void handleRequest(
          msg.requestId,
          options.onCopy ? () => options.onCopy?.(msg.payload.text) : undefined,
          "copy_clipboard capability not configured on host",
        );
        break;
      case "inkade.request.open_url":
        void handleRequest(
          msg.requestId,
          options.onOpenUrl ? () => options.onOpenUrl?.(msg.payload.url) : undefined,
          "open_external_url capability not configured on host",
        );
        break;
    }
  };

  const onMessage = (event: EmbedMessageEventLike): void => {
    if (destroyed) return;
    if (iframe?.contentWindow && event.source && event.source !== iframe.contentWindow) {
      return;
    }
    if (targetOrigin !== "*" && event.origin && event.origin !== targetOrigin) {
      return;
    }

    const msg = parseInkadeToHostMessage(event.data);
    if (!msg) return;
    handleInkadeMessage(msg);
  };

  const onIframeLoad = (): void => {
    sendHello();
  };

  hostWindow?.addEventListener("message", onMessage);
  iframe?.addEventListener?.("load", onIframeLoad);
  const sseSub =
    serverBaseUrl && options.authToken
      ? subscribeInkadeEvents(
          {
            baseUrl: serverBaseUrl,
            token: options.authToken,
            fetch: fetchFn,
          },
          {
            onEvent: (event) => {
              if (destroyed || event.type !== "embed.shell_event") return;
              if (event.payload.direction !== "inkade_to_host") return;
              if (
                options.embedSessionId &&
                event.payload.embedSessionId &&
                event.payload.embedSessionId !== options.embedSessionId
              ) {
                return;
              }
              handleInkadeMessage(event.payload.message);
            },
          },
        )
      : null;
  sendHello();

  return {
    sendHello,
    navigate: (path) => {
      post({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "host.navigate",
        payload: { path },
      });
    },
    gotoAnchor: (payload) => {
      post({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "host.goto_anchor",
        payload,
      });
    },
    setTheme: (theme) => {
      post({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "host.theme_changed",
        payload: { theme },
      });
    },
    setContext: (context) => {
      post({
        protocol: INKADE_EMBED_PROTOCOL,
        type: "host.context_changed",
        payload: context,
      });
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      hostWindow?.removeEventListener("message", onMessage);
      iframe?.removeEventListener?.("load", onIframeLoad);
      sseSub?.unsubscribe();
    },
  };
}
