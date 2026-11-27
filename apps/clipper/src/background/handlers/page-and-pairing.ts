import { initInkadeI18n, t } from "@inkade/i18n";
import { createClipperSdkClient, lookupClipState, resolveClipperConnection } from "../../core/sync.ts";
import {
  clearPendingPairingSession,
  loadClipperSettings,
  loadPendingPairingSession,
  normalizeServerUrl,
  resolveWebAppDocUrl,
  saveClipperSettings,
} from "../../shared/storage.ts";
import {
  getWebExt,
  isRestrictedTabUrl,
  sendMessageEnsuringScript,
} from "../../shared/webext.ts";
import type { BackgroundRuntimeMessage, SendRuntimeResponse } from "../types.ts";
import {
  broadcastClipperStateChanged,
  ensureScriptInjected,
  tryFlushOfflineQueue,
  updateTabClipBadge,
} from "../utils.ts";

export async function dispatchUiTriggerToTab(
  tabId: number | undefined,
  messageType: string,
): Promise<void> {
  if (!tabId) return;
  const ext = getWebExt();
  if (!ext?.tabs) return;
  await ensureScriptInjected(tabId, "content-extractor.js");
  await ensureScriptInjected(tabId, "content-page-ui.js");
  try {
    await ext.tabs.sendMessage(tabId, { type: messageType });
  } catch {
    // ignore
  }
}

export async function handlePageReady(tabId: number | undefined, pageUrl: string): Promise<void> {
  if (!tabId || isRestrictedTabUrl(pageUrl)) return;
  void tryFlushOfflineQueue();
  const settings = await loadClipperSettings();
  if (!settings.serverUrl || !settings.token) return;

  const ext = getWebExt();
  try {
    const client = createClipperSdkClient({
      serverUrl: settings.serverUrl,
      token: settings.token,
    });
    const lookup = await lookupClipState(client, pageUrl);
    await updateTabClipBadge(tabId, lookup);

    if (settings.autoRestoreHighlights) {
      if (lookup.highlights.length > 0) {
        await sendMessageEnsuringScript(tabId, "content-page-ui.js", {
          type: "INKADE_RENDER_HIGHLIGHTS",
          documentId: lookup.document?.id,
          highlights: lookup.highlights,
        });
      } else {
        await ext?.tabs
          ?.sendMessage(tabId, {
            type: "INKADE_RENDER_HIGHLIGHTS",
            documentId: lookup.document?.id,
            highlights: [],
          })
          .catch(() => {});
        if (settings.showFloatingToolbar) {
          await ensureScriptInjected(tabId, "content-page-ui.js");
        }
      }
    } else if (settings.showFloatingToolbar) {
      await ensureScriptInjected(tabId, "content-page-ui.js");
    }
  } catch {
    // Silent ignore when server is offline
  }
}

export function handlePageAndPairingMessage(
  msg: BackgroundRuntimeMessage,
  senderTabId: number | undefined,
  senderTabUrl: string | undefined,
  sendResponse: SendRuntimeResponse,
): boolean {
  const ext = getWebExt();

  if (msg.type === "INKADE_PAGE_READY" && msg.url) {
    const url = msg.url;
    void handlePageReady(senderTabId, url)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === "INKADE_SELECTION_CHANGED") {
    try {
      void Promise.resolve(
        ext?.runtime?.sendMessage?.({
          type: "INKADE_SELECTION_CHANGED",
          tabId: senderTabId,
          selection: msg.selection ?? null,
          selectionMarkdown: msg.selectionMarkdown ?? "",
        }),
      ).catch(() => {});
    } catch {
      // ignore
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "INKADE_PROXY_FETCH" && msg.url) {
    const targetUrl = msg.url;
    const targetMethod = msg.method ?? "GET";
    void (async () => {
      try {
        const res = await fetch(targetUrl, { method: targetMethod });
        const bodyText = await res.text();
        sendResponse({
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          contentType: res.headers.get("content-type") ?? "",
          bodyText,
        });
      } catch {
        sendResponse({
          ok: false,
          status: 0,
          statusText: "FETCH_ERROR",
          contentType: "",
          bodyText: "",
        });
      }
    })();
    return true;
  }

  if (msg.type === "INKADE_UI_OPEN_DOC" && msg.documentId) {
    const docId = msg.documentId;
    void loadClipperSettings().then((settings) => {
      const url = resolveWebAppDocUrl(settings, docId);
      void ext?.tabs?.create?.({ url });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "INKADE_COMPLETE_PAIRING") {
    void (async () => {
      try {
        const session = await loadPendingPairingSession();
        const settings = await loadClipperSettings();
        initInkadeI18n(settings.locale);

        if (!session || !msg.nonce || session.nonce !== msg.nonce) {
          sendResponse({ ok: false, error: t("clipper.pairingSessionInvalid") });
          return;
        }

        if (session.expectedOrigin && senderTabUrl) {
          try {
            const senderOrigin = new URL(senderTabUrl).origin;
            if (senderOrigin !== session.expectedOrigin) {
              sendResponse({ ok: false, error: t("clipper.pairingOriginMismatch") });
              return;
            }
          } catch {
            sendResponse({ ok: false, error: t("clipper.pairingOriginMismatch") });
            return;
          }
        }

        const cleanServer = normalizeServerUrl(msg.serverUrl ?? "");
        const cleanWeb = normalizeServerUrl(msg.webAppUrl ?? "");
        const cleanToken = (msg.token ?? "").trim();
        if (!cleanServer || !cleanToken) {
          sendResponse({ ok: false, error: t("clipper.setupPromptTitle") });
          return;
        }

        const client = createClipperSdkClient({
          serverUrl: cleanServer,
          token: cleanToken,
        });
        const conn = await resolveClipperConnection(client);
        await saveClipperSettings({
          serverUrl: cleanServer,
          webAppUrl: cleanWeb,
          token: cleanToken,
          defaultSpaceId: settings.defaultSpaceId || conn.defaultSpaceId,
        });
        await clearPendingPairingSession();
        broadcastClipperStateChanged({ reason: "pairing-completed" });
        sendResponse({
          ok: true,
          tokenName: conn.tokenName,
          spacesCount: conn.visibleSpaces.length,
        });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  return false;
}
