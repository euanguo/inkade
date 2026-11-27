import { asDocumentId, asHighlightId, asSpaceId, type DocumentHighlight } from "@inkade/core";
import { initInkadeI18n, t } from "@inkade/i18n";
import {
  enqueueOfflineAction,
  isRetryableNetworkError,
} from "../../core/offline-queue.ts";
import {
  createClipperSdkClient,
  syncHighlightToInkade,
  syncSelectionClipToInkade,
} from "../../core/sync.ts";
import {
  loadClipperSettings,
  resolveWebAppDocUrl,
  type SaveHighlightOfflinePayload,
} from "../../shared/storage.ts";
import {
  getWebExt,
  isRestrictedTabUrl,
  type WebExtTab,
} from "../../shared/webext.ts";
import {
  SEMANTIC_BADGE_ERROR,
  SEMANTIC_BADGE_SUCCESS,
  type BackgroundRuntimeMessage,
  type SendRuntimeResponse,
} from "../types.ts";
import {
  broadcastClipperStateChanged,
  buildSelectionFallbackArticle,
  ensureScriptInjected,
  extractBundleFromTab,
  notifyTabToast,
  setTransientBadge,
  updateTabClipBadge,
} from "../utils.ts";

async function pushHighlightsToTab(
  tabId: number | undefined,
  documentId: string,
  highlights: readonly DocumentHighlight[],
  injectContentUi: boolean,
): Promise<void> {
  if (tabId === undefined) return;
  if (injectContentUi) {
    await ensureScriptInjected(tabId, "content-page-ui.js");
  }
  await getWebExt()?.tabs
    ?.sendMessage(tabId, {
      type: "INKADE_RENDER_HIGHLIGHTS",
      documentId,
      highlights,
    })
    .catch(() => {});
  await updateTabClipBadge(tabId, { found: true, highlights });
}

export async function handleSaveHighlightAction(
  tab: WebExtTab | undefined,
  fallbackSelectionText?: string,
): Promise<void> {
  if (!tab?.id || isRestrictedTabUrl(tab.url)) {
    await setTransientBadge(tab?.id, "!", SEMANTIC_BADGE_ERROR);
    return;
  }

  const settings = await loadClipperSettings();
  initInkadeI18n(settings.locale);
  if (!settings.serverUrl || !settings.token) {
    await getWebExt()?.runtime?.openOptionsPage?.();
    return;
  }

  const bundle = await extractBundleFromTab(tab.id);
  const selection =
    bundle?.selection ??
    (fallbackSelectionText?.trim()
      ? {
          url: tab.url ?? "",
          title: tab.title ?? tab.url ?? "",
          quote: fallbackSelectionText.trim(),
          prefixContext: "",
          suffixContext: "",
        }
      : null);

  if (!selection) {
    await setTransientBadge(tab.id, "!", SEMANTIC_BADGE_ERROR);
    return;
  }

  const hlPayload: SaveHighlightOfflinePayload = {
    url: selection.url || tab.url || "",
    title: bundle?.article.title ?? selection.title ?? tab.title,
    spaceId: settings.defaultSpaceId || undefined,
    tags: [...settings.defaultTags],
    extracted: bundle?.article,
    mirrorImages: settings.mirrorImages,
    saveHtmlSnapshot: settings.saveHtmlSnapshot,
    compressWebp: settings.compressImagesToWebp,
    anchor: {
      quote: selection.quote,
      prefixContext: selection.prefixContext,
      suffixContext: selection.suffixContext,
    },
    color: settings.highlightColor,
  };

  try {
    const client = createClipperSdkClient({
      serverUrl: settings.serverUrl,
      token: settings.token,
    });
    const res = await syncHighlightToInkade(client, hlPayload);
    const allHighlights = await client.highlights.list(res.document.id).catch(() => [res.highlight]);
    await pushHighlightsToTab(tab.id, res.document.id, allHighlights, true);
    await notifyTabToast(
      tab.id,
      "success",
      res.createdClip
        ? t("clipper.highlightSuccessCreated", { title: res.document.title })
        : t("clipper.highlightSuccess", { title: res.document.title }),
      resolveWebAppDocUrl(settings, res.document.id),
    );
    broadcastClipperStateChanged({
      tabId: tab.id,
      url: hlPayload.url,
      documentId: res.document.id,
      reason: "highlight-create",
    });
  } catch (err) {
    if (isRetryableNetworkError(err)) {
      await enqueueOfflineAction({
        kind: "save-highlight",
        label: hlPayload.title || selection.quote.slice(0, 48),
        payload: hlPayload,
        error: err,
      });
      await notifyTabToast(
        tab.id,
        "info",
        t("clipper.clipQueuedOffline", {
          title: hlPayload.title || selection.quote.slice(0, 48),
        }),
      );
      return;
    }
    await setTransientBadge(tab.id, "!", SEMANTIC_BADGE_ERROR);
    await notifyTabToast(
      tab.id,
      "error",
      t("clipper.highlightFailed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

export async function handleClipSelectionOnlyAction(
  tab: WebExtTab | undefined,
  fallbackSelectionText?: string,
): Promise<void> {
  if (!tab?.id || isRestrictedTabUrl(tab.url)) return;
  const settings = await loadClipperSettings();
  initInkadeI18n(settings.locale);
  if (!settings.serverUrl || !settings.token) {
    await getWebExt()?.runtime?.openOptionsPage?.();
    return;
  }

  const bundle = await extractBundleFromTab(tab.id);
  const selectionMd = bundle?.selectionMarkdown?.trim() || fallbackSelectionText?.trim();
  if (!selectionMd) return;

  const title = bundle?.article.title ?? tab.title ?? tab.url ?? "Selection Clip";
  const url = tab.url ?? "";

  try {
    const client = createClipperSdkClient({
      serverUrl: settings.serverUrl,
      token: settings.token,
    });
    const doc = await syncSelectionClipToInkade(client, {
      url,
      title,
      selectionMarkdown: selectionMd,
      spaceId: settings.defaultSpaceId || undefined,
      tags: settings.defaultTags,
    });
    await setTransientBadge(tab.id, "✓", SEMANTIC_BADGE_SUCCESS);
    await notifyTabToast(
      tab.id,
      "success",
      t("clipper.clipSuccess", { title: doc.title, images: 0 }),
      resolveWebAppDocUrl(settings, doc.id),
    );
    broadcastClipperStateChanged({
      tabId: tab.id,
      url,
      documentId: doc.id,
      reason: "clip-selection",
    });
  } catch (err) {
    if (isRetryableNetworkError(err)) {
      await enqueueOfflineAction({
        kind: "clip-page",
        label: title,
        payload: {
          extracted: buildSelectionFallbackArticle(url, title, selectionMd),
          spaceId: settings.defaultSpaceId || undefined,
          tags: [...settings.defaultTags],
          mode: "client-dom",
          mirrorImages: false,
          saveHtmlSnapshot: false,
        },
        error: err,
      });
      await notifyTabToast(
        tab.id,
        "info",
        t("clipper.clipQueuedOffline", { title }),
      );
      return;
    }
    await setTransientBadge(tab.id, "!", SEMANTIC_BADGE_ERROR);
    await notifyTabToast(
      tab.id,
      "error",
      t("clipper.clipFailed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

export function handleHighlightMessage(
  msg: BackgroundRuntimeMessage,
  senderTabId: number | undefined,
  senderTabUrl: string | undefined,
  senderTabTitle: string | undefined,
  sendResponse: SendRuntimeResponse,
): boolean {
  if (
    (msg.type === "INKADE_UI_CREATE_HIGHLIGHT" || msg.type === "INKADE_BG_SYNC_HIGHLIGHT") &&
    msg.anchor
  ) {
    const anchor = msg.anchor;
    const color = msg.color;
    const noteMarkdown = msg.noteMarkdown ?? "";
    const tabId = msg.tabId ?? senderTabId;
    void (async () => {
      const settings = await loadClipperSettings();
      initInkadeI18n(settings.locale);
      if (!settings.serverUrl || !settings.token) {
        sendResponse({ ok: false, error: t("clipper.setupPromptTitle") });
        return;
      }
      const article =
        msg.article ?? (tabId ? (await extractBundleFromTab(tabId))?.article : undefined);
      const hlPayload: SaveHighlightOfflinePayload = {
        url: anchor.url || senderTabUrl || article?.url || "",
        title: msg.title ?? article?.title ?? anchor.title ?? senderTabTitle,
        spaceId:
          (msg.spaceId ? asSpaceId(msg.spaceId) : undefined) ??
          (settings.defaultSpaceId || undefined),
        tags: msg.tags ? [...msg.tags] : [...settings.defaultTags],
        extracted: article,
        existingDocumentId: msg.existingDocumentId
          ? asDocumentId(msg.existingDocumentId)
          : undefined,
        mirrorImages: msg.mirrorImages ?? settings.mirrorImages,
        saveHtmlSnapshot: msg.saveHtmlSnapshot ?? settings.saveHtmlSnapshot,
        compressWebp: settings.compressImagesToWebp,
        anchor,
        color: color ?? settings.highlightColor,
        noteMarkdown,
      };
      try {
        const client = createClipperSdkClient({
          serverUrl: settings.serverUrl,
          token: settings.token,
        });
        const res = await syncHighlightToInkade(client, hlPayload);
        const highlights = await client.highlights.list(res.document.id).catch(() => [res.highlight]);
        await pushHighlightsToTab(tabId, res.document.id, highlights, true);
        broadcastClipperStateChanged({
          tabId,
          url: hlPayload.url,
          documentId: res.document.id,
          reason: "highlight-create",
        });
        sendResponse({
          ok: true,
          documentId: res.document.id,
          highlights,
          createdClip: res.createdClip,
          message: res.createdClip
            ? t("clipper.highlightSuccessCreated", { title: res.document.title })
            : t("clipper.highlightSuccess", { title: res.document.title }),
          openUrl: resolveWebAppDocUrl(settings, res.document.id),
        });
      } catch (err) {
        if (isRetryableNetworkError(err)) {
          await enqueueOfflineAction({
            kind: "save-highlight",
            label: hlPayload.title || anchor.quote.slice(0, 48),
            payload: hlPayload,
            error: err,
          });
          sendResponse({
            ok: true,
            queued: true,
            message: t("clipper.clipQueuedOffline", {
              title: hlPayload.title || anchor.quote.slice(0, 48),
            }),
          });
          return;
        }
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (msg.type === "INKADE_UI_RESTORE_HIGHLIGHT" && msg.documentId && msg.anchor) {
    const docId = asDocumentId(msg.documentId);
    const anchor = msg.anchor;
    const color = msg.color ?? "amber";
    const noteMarkdown = msg.noteMarkdown ?? "";
    const tabId = msg.tabId ?? senderTabId;
    void (async () => {
      try {
        const settings = await loadClipperSettings();
        const client = createClipperSdkClient({
          serverUrl: settings.serverUrl,
          token: settings.token,
        });
        const highlight = await client.highlights.create(docId, {
          quote: anchor.quote,
          prefixContext: anchor.prefixContext ?? "",
          suffixContext: anchor.suffixContext ?? "",
          color,
          noteMarkdown,
        });
        const highlights = await client.highlights.list(docId).catch(() => [highlight]);
        await pushHighlightsToTab(tabId, docId, highlights, false);
        broadcastClipperStateChanged({
          tabId,
          documentId: docId,
          reason: "highlight-restore",
        });
        sendResponse({ ok: true, highlight, highlights });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (msg.type === "INKADE_UI_UPDATE_HIGHLIGHT" && msg.highlightId && msg.patch) {
    const highlightId = asHighlightId(msg.highlightId);
    const patch = msg.patch;
    void (async () => {
      try {
        const settings = await loadClipperSettings();
        const client = createClipperSdkClient({
          serverUrl: settings.serverUrl,
          token: settings.token,
        });
        const highlight = await client.highlights.update(highlightId, patch);
        broadcastClipperStateChanged({
          tabId: senderTabId,
          documentId: highlight.documentId,
          reason: "highlight-update",
        });
        sendResponse({ ok: true, highlight });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (msg.type === "INKADE_UI_DELETE_HIGHLIGHT" && msg.highlightId) {
    const highlightId = asHighlightId(msg.highlightId);
    const tabId = msg.tabId ?? senderTabId;
    const docId = msg.documentId ? asDocumentId(msg.documentId) : undefined;
    void (async () => {
      try {
        const settings = await loadClipperSettings();
        const client = createClipperSdkClient({
          serverUrl: settings.serverUrl,
          token: settings.token,
        });
        await client.highlights.delete(highlightId);
        if (tabId !== undefined && docId) {
          const highlights = await client.highlights.list(docId).catch(() => []);
          await updateTabClipBadge(tabId, { found: true, highlights });
        }
        broadcastClipperStateChanged({
          tabId,
          documentId: docId,
          reason: "highlight-delete",
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (
    (msg.type === "INKADE_UI_CLIP_SELECTION" || msg.type === "INKADE_BG_CLIP_SELECTION") &&
    msg.url &&
    msg.selectionMarkdown
  ) {
    const url = msg.url;
    const title = msg.title ?? url;
    const selectionMarkdown = msg.selectionMarkdown;
    const spaceId = msg.spaceId ? asSpaceId(msg.spaceId) : undefined;
    const tags = msg.tags;
    const tabId = msg.tabId ?? senderTabId;
    void (async () => {
      const settings = await loadClipperSettings();
      initInkadeI18n(settings.locale);
      if (!settings.serverUrl || !settings.token) {
        sendResponse({ ok: false, error: t("clipper.setupPromptTitle") });
        return;
      }
      try {
        const client = createClipperSdkClient({
          serverUrl: settings.serverUrl,
          token: settings.token,
        });
        const doc = await syncSelectionClipToInkade(client, {
          url,
          title,
          selectionMarkdown,
          spaceId: spaceId ?? (settings.defaultSpaceId || undefined),
          tags: tags ? [...tags] : settings.defaultTags,
        });
        broadcastClipperStateChanged({
          tabId,
          url,
          documentId: doc.id,
          reason: "clip-selection",
        });
        sendResponse({
          ok: true,
          documentId: doc.id,
          message: t("clipper.clipSuccess", { title: doc.title, images: 0 }),
          openUrl: resolveWebAppDocUrl(settings, doc.id),
        });
      } catch (err) {
        if (isRetryableNetworkError(err)) {
          await enqueueOfflineAction({
            kind: "clip-page",
            label: title,
            payload: {
              extracted: buildSelectionFallbackArticle(url, title, selectionMarkdown),
              spaceId: spaceId ?? (settings.defaultSpaceId || undefined),
              tags: tags ? [...tags] : [...settings.defaultTags],
              mode: "client-dom",
              mirrorImages: false,
              saveHtmlSnapshot: false,
            },
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

  return false;
}
