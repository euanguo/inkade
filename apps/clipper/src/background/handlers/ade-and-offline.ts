import { asDocumentId, formatHostDisplayName } from "@inkade/core";
import { initInkadeI18n, t } from "@inkade/i18n";
import {
  enqueueOfflineAction,
  flushOfflineQueue,
  isRetryableNetworkError,
} from "../../core/offline-queue.ts";
import { createClipperSdkClient, dispatchClipToAde } from "../../core/sync.ts";
import {
  loadClipperSettings,
  resolveWebAppDocUrl,
  type DispatchAdeOfflinePayload,
} from "../../shared/storage.ts";
import type { BackgroundRuntimeMessage, SendRuntimeResponse } from "../types.ts";
import { broadcastClipperStateChanged, extractBundleFromTab } from "../utils.ts";

export function handleAdeAndOfflineMessage(
  msg: BackgroundRuntimeMessage,
  senderTabId: number | undefined,
  sendResponse: SendRuntimeResponse,
): boolean {
  if (msg.type === "INKADE_UI_DISPATCH_ADE" && msg.url && msg.anchor) {
    const url = msg.url;
    const title = msg.title ?? url;
    const existingDocumentId = msg.documentId ? asDocumentId(msg.documentId) : undefined;
    const anchor = msg.anchor;
    const customPrompt = msg.prompt?.trim();
    const tabId = msg.tabId ?? senderTabId;
    void (async () => {
      const settings = await loadClipperSettings();
      initInkadeI18n(settings.locale);
      const bundle = !existingDocumentId && tabId ? await extractBundleFromTab(tabId) : null;
      const adePayload: DispatchAdeOfflinePayload = {
        url,
        title,
        existingDocumentId,
        spaceId: settings.defaultSpaceId || undefined,
        tags: [...settings.defaultTags],
        extracted: bundle?.article,
        adeKind: settings.defaultAdeKind,
        prompt: customPrompt || anchor.quote,
        selectionAnchor: anchor,
        appendToDaily: settings.defaultAppendToDaily,
      };
      try {
        const client = createClipperSdkClient({
          serverUrl: settings.serverUrl,
          token: settings.token,
        });
        const res = await dispatchClipToAde(client, adePayload);
        broadcastClipperStateChanged({
          tabId,
          url,
          documentId: res.document.id,
          reason: "dispatch-ade",
        });
        sendResponse({
          ok: true,
          message: t("clipper.sidePanelAdeDispatched", {
            ade: formatHostDisplayName(settings.defaultAdeKind, t("clipper.adeAny")),
          }),
          openUrl: resolveWebAppDocUrl(settings, res.document.id),
        });
      } catch (err) {
        if (isRetryableNetworkError(err)) {
          await enqueueOfflineAction({
            kind: "dispatch-ade",
            label: title,
            payload: adePayload,
            error: err,
          });
          sendResponse({
            ok: true,
            queued: true,
            message: t("clipper.clipQueuedOffline", { title }),
          });
          return;
        }
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (msg.type === "INKADE_FLUSH_OFFLINE_QUEUE") {
    void (async () => {
      try {
        const settings = await loadClipperSettings();
        initInkadeI18n(settings.locale);
        if (!settings.serverUrl || !settings.token) {
          sendResponse({ ok: false, error: t("clipper.setupPromptTitle") });
          return;
        }
        const client = createClipperSdkClient({
          serverUrl: settings.serverUrl,
          token: settings.token,
        });
        const res = await flushOfflineQueue(client);
        broadcastClipperStateChanged({ reason: "offline-flushed" });
        sendResponse({ ok: true, ...res });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  return false;
}
