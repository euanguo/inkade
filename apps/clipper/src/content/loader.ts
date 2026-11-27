import { getWebExt } from "../shared/webext.ts";

declare global {
  interface Window {
    __inkadeLastContextTarget?: Element | null;
    __inkadeLoaderAttached?: boolean;
  }
}

export const CLIPPER_LOADER_MESSAGES = {
  pageReady: "INKADE_PAGE_READY",
  pingLoader: "INKADE_PING_LOADER",
} as const;

function bootstrapLoader(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__inkadeLoaderAttached) return;
  window.__inkadeLoaderAttached = true;

  // Track last right-clicked element for feed-level SiteAdapters without loading React or Defuddle.
  document.addEventListener(
    "contextmenu",
    (event) => {
      const target = event.target;
      window.__inkadeLastContextTarget = target instanceof Element ? target : null;
    },
    true,
  );

  const ext = getWebExt();
  ext?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    const type = (message as { readonly type?: string }).type;
    if (type === CLIPPER_LOADER_MESSAGES.pingLoader) {
      sendResponse({ ok: true, url: window.location.href });
      return true;
    }
    return false;
  });

  // One-click Web pairing handshake bridge (Inkade Web /clipper/pair -> background service worker).
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data as {
      readonly type?: unknown;
      readonly nonce?: unknown;
      readonly serverUrl?: unknown;
      readonly webAppUrl?: unknown;
      readonly token?: unknown;
    } | null;
    if (!data || typeof data !== "object") return;
    if (data.type !== "INKADE_CLIPPER_PAIRING_RESPONSE") return;
    if (
      typeof data.nonce !== "string" ||
      typeof data.serverUrl !== "string" ||
      typeof data.token !== "string"
    ) {
      return;
    }
    if (!ext?.runtime?.sendMessage) return;

    const targetOrigin =
      window.location.origin && window.location.origin !== "null" ? window.location.origin : "*";

    void Promise.resolve(
      ext.runtime.sendMessage<{
        readonly ok?: boolean;
        readonly error?: string;
        readonly tokenName?: string;
        readonly spacesCount?: number;
      }>({
        type: "INKADE_COMPLETE_PAIRING",
        nonce: data.nonce,
        serverUrl: data.serverUrl,
        webAppUrl: typeof data.webAppUrl === "string" ? data.webAppUrl : window.location.origin,
        token: data.token,
      }),
    )
      .then((res) => {
        window.postMessage(
          {
            type: "INKADE_CLIPPER_PAIRING_ACK",
            nonce: data.nonce,
            ok: Boolean(res?.ok),
            error: res?.error,
            tokenName: res?.tokenName,
            spacesCount: res?.spacesCount,
          },
          targetOrigin,
        );
      })
      .catch((err) => {
        window.postMessage(
          {
            type: "INKADE_CLIPPER_PAIRING_ACK",
            nonce: data.nonce,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          },
          targetOrigin,
        );
      });
  });

  if (ext?.runtime?.sendMessage) {
    try {
      void Promise.resolve(
        ext.runtime.sendMessage({
          type: CLIPPER_LOADER_MESSAGES.pageReady,
          url: window.location.href,
        }),
      ).catch(() => {});
    } catch {
      // ignore if extension context invalidated
    }
  }
}

bootstrapLoader();
