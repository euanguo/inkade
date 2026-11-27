import { asDocumentId, asSpaceId } from "@inkade/core";
import { initInkadeI18n, t } from "@inkade/i18n";
import {
  enqueueOfflineAction,
  isRetryableNetworkError,
} from "../../core/offline-queue.ts";
import {
  createClipperSdkClient,
  saveImageClipToInkade,
} from "../../core/sync.ts";
import { executeUnifiedClip } from "../../core/unified-clip.ts";
import {
  loadClipperSettings,
  resolveWebAppDocUrl,
  type ClipPageOfflinePayload,
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
  extractBundleFromTab,
  formatClipSuccessMessage,
  loadActiveTemplates,
  notifyTabToast,
  setTransientBadge,
  trackBackgroundTask,
  updateTabClipBadge,
} from "../utils.ts";

export async function handleClipPageAction(
  tab: WebExtTab | undefined,
  usePointerTarget = false,
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

  const bundle = await extractBundleFromTab(tab.id, usePointerTarget);
  if (!bundle) {
    await setTransientBadge(tab.id, "!", SEMANTIC_BADGE_ERROR);
    return;
  }

  const templates = await loadActiveTemplates();
  const unifiedInput = {
    extracted: bundle.article,
    spaceId: settings.defaultSpaceId || undefined,
    tags: [...settings.defaultTags],
    dedupeByUrl: true,
    preserveExistingTags: true,
    templates,
    preferTemplateDefaults: true,
    aiProvider: settings.aiProvider,
    selection: bundle.selection,
    selectionMarkdown: bundle.selectionMarkdown,
    mode: settings.clipMode,
    mirrorImages: settings.mirrorImages,
    asyncMirror: settings.autoMirrorImagesAsync,
    compressWebp: settings.compressImagesToWebp,
    saveHtmlSnapshot: settings.saveHtmlSnapshot,
    appendToDaily: settings.defaultAppendToDaily,
  };

  try {
    const client = createClipperSdkClient({
      serverUrl: settings.serverUrl,
      token: settings.token,
    });
    const res = await executeUnifiedClip(client, {
      ...unifiedInput,
      onBackgroundTasks: trackBackgroundTask,
    });
    const docId = res.document?.id;
    const docTitle = res.document?.title ?? bundle.article.title;
    const openUrl = docId ? resolveWebAppDocUrl(settings, docId) : undefined;
    await setTransientBadge(
      tab.id,
      "✓",
      SEMANTIC_BADGE_SUCCESS,
      res.document ? { found: true, highlights: [] } : null,
    );
    await notifyTabToast(tab.id, "success", formatClipSuccessMessage(res, docTitle), openUrl);
    broadcastClipperStateChanged({
      tabId: tab.id,
      url: bundle.article.url,
      documentId: docId,
      reason: "clip",
    });
  } catch (err) {
    if (isRetryableNetworkError(err)) {
      await enqueueOfflineAction({
        kind: "clip-page",
        label: bundle.article.title,
        payload: {
          extracted: bundle.article,
          spaceId: unifiedInput.spaceId,
          tags: unifiedInput.tags,
          mode: unifiedInput.mode,
          mirrorImages: unifiedInput.mirrorImages,
          compressWebp: unifiedInput.compressWebp,
          saveHtmlSnapshot: unifiedInput.saveHtmlSnapshot,
          appendToDaily: unifiedInput.appendToDaily,
        },
        error: err,
      });
      await notifyTabToast(
        tab.id,
        "info",
        t("clipper.clipQueuedOffline", { title: bundle.article.title }),
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

export async function handleClipLinkAction(
  linkUrl: string,
  tab: WebExtTab | undefined,
): Promise<void> {
  const settings = await loadClipperSettings();
  initInkadeI18n(settings.locale);
  if (!settings.serverUrl || !settings.token) {
    await getWebExt()?.runtime?.openOptionsPage?.();
    return;
  }

  const defaultSpaceId = settings.defaultSpaceId || undefined;
  const ingestPayload = {
    url: linkUrl,
    ...(defaultSpaceId ? { spaceId: defaultSpaceId } : {}),
    tags: [...settings.defaultTags],
    mirrorImages: settings.mirrorImages,
    saveHtmlSnapshot: settings.saveHtmlSnapshot,
  };

  try {
    const client = createClipperSdkClient({
      serverUrl: settings.serverUrl,
      token: settings.token,
    });
    const res = await client.clips.ingestUrl(ingestPayload);
    await setTransientBadge(tab?.id, "✓", SEMANTIC_BADGE_SUCCESS);
    await notifyTabToast(
      tab?.id,
      "success",
      t("clipper.linkClippedNotice", { title: res.document.title }),
      resolveWebAppDocUrl(settings, res.document.id),
    );
    broadcastClipperStateChanged({
      tabId: tab?.id,
      url: linkUrl,
      documentId: res.document.id,
      reason: "clip-link",
    });
  } catch (err) {
    if (isRetryableNetworkError(err)) {
      await enqueueOfflineAction({
        kind: "ingest-url",
        label: linkUrl,
        payload: ingestPayload,
        error: err,
      });
      await notifyTabToast(
        tab?.id,
        "info",
        t("clipper.clipQueuedOffline", { title: linkUrl }),
      );
      return;
    }
    await setTransientBadge(tab?.id, "!", SEMANTIC_BADGE_ERROR);
    await notifyTabToast(
      tab?.id,
      "error",
      t("clipper.clipFailed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

export async function handleSaveImageAction(
  srcUrl: string,
  tab: WebExtTab | undefined,
): Promise<void> {
  const settings = await loadClipperSettings();
  initInkadeI18n(settings.locale);
  if (!settings.serverUrl || !settings.token) {
    await getWebExt()?.runtime?.openOptionsPage?.();
    return;
  }

  try {
    const client = createClipperSdkClient({
      serverUrl: settings.serverUrl,
      token: settings.token,
    });
    const res = await saveImageClipToInkade(client, {
      imageUrl: srcUrl,
      pageUrl: tab?.url ?? srcUrl,
      pageTitle: tab?.title,
      spaceId: settings.defaultSpaceId || undefined,
      tags: settings.defaultTags,
    });
    await setTransientBadge(tab?.id, "✓", SEMANTIC_BADGE_SUCCESS);
    await notifyTabToast(
      tab?.id,
      "success",
      t("clipper.imageClippedNotice", { title: res.document.title }),
      resolveWebAppDocUrl(settings, res.document.id),
    );
    broadcastClipperStateChanged({
      tabId: tab?.id,
      url: tab?.url,
      documentId: res.document.id,
      reason: "clip-image",
    });
  } catch (err) {
    await setTransientBadge(tab?.id, "!", SEMANTIC_BADGE_ERROR);
    await notifyTabToast(
      tab?.id,
      "error",
      t("clipper.clipFailed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

export function handleBgClipPageMessage(
  msg: BackgroundRuntimeMessage,
  senderTabId: number | undefined,
  sendResponse: SendRuntimeResponse,
): boolean {
  const article = msg.article ?? msg.extracted;
  if (msg.type !== "INKADE_BG_CLIP_PAGE" || !article) return false;

  const targetTabId = msg.tabId ?? senderTabId;
  void (async () => {
    const settings = await loadClipperSettings();
    initInkadeI18n(settings.locale);
    if (!settings.serverUrl || !settings.token) {
      sendResponse({ ok: false, error: t("clipper.setupPromptTitle") });
      return;
    }
    const templates = msg.markdownOverride === undefined ? await loadActiveTemplates() : undefined;
    const offlinePayload: ClipPageOfflinePayload = {
      extracted: article,
      spaceId:
        (msg.spaceId ? asSpaceId(msg.spaceId) : undefined) ?? (settings.defaultSpaceId || undefined),
      title: msg.title,
      markdownOverride: msg.markdownOverride,
      tags: msg.tags ? [...msg.tags] : [...settings.defaultTags],
      properties: msg.properties,
      existingDocumentId: msg.existingDocumentId ? asDocumentId(msg.existingDocumentId) : undefined,
      updateMetadataOnly: msg.updateMetadataOnly,
      mode: msg.mode ?? settings.clipMode,
      mirrorImages: msg.mirrorImages ?? settings.mirrorImages,
      compressWebp: settings.compressImagesToWebp,
      saveHtmlSnapshot: msg.saveHtmlSnapshot ?? settings.saveHtmlSnapshot,
      appendToDaily: msg.appendToDaily ?? settings.defaultAppendToDaily,
      dailyLineOverride: msg.dailyLineOverride,
    };
    try {
      const client = createClipperSdkClient({
        serverUrl: settings.serverUrl,
        token: settings.token,
      });
      const res = await executeUnifiedClip(client, {
        ...offlinePayload,
        dedupeByUrl: msg.dedupeByUrl ?? false,
        preserveExistingTags: msg.preserveExistingTags ?? false,
        templates,
        templateIdOverride: msg.templateIdOverride,
        templateBehavior: msg.templateBehavior,
        preferTemplateDefaults: msg.markdownOverride === undefined,
        aiProvider: settings.aiProvider,
        asyncMirror: settings.autoMirrorImagesAsync,
        fastAsyncRaceMs: 1500,
        onBackgroundTasks: trackBackgroundTask,
      });
      const docId = res.document?.id;
      const docTitle = res.document?.title ?? article.title;
      if (targetTabId !== undefined && res.document) {
        await updateTabClipBadge(targetTabId, { found: true, highlights: [] });
      }
      broadcastClipperStateChanged({
        tabId: targetTabId,
        url: article.url,
        documentId: docId,
        reason: "clip",
      });
      sendResponse({
        ok: true,
        document: res.document,
        mirroredImages: res.mirroredImages,
        mirrorPending: res.mirrorPending,
        dailyOnly: res.dailyOnly,
        message: formatClipSuccessMessage(res, docTitle),
        openUrl: docId ? resolveWebAppDocUrl(settings, docId) : undefined,
      });
    } catch (err) {
      if (isRetryableNetworkError(err)) {
        await enqueueOfflineAction({
          kind: "clip-page",
          label: msg.title || article.title,
          payload: offlinePayload,
          error: err,
        });
        sendResponse({
          ok: true,
          queued: true,
          message: t("clipper.clipQueuedOffline", { title: msg.title || article.title }),
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

export function handleUiClipArticleMessage(
  msg: BackgroundRuntimeMessage,
  senderTabId: number | undefined,
  sendResponse: SendRuntimeResponse,
): boolean {
  if (msg.type !== "INKADE_UI_CLIP_ARTICLE" || !msg.article) return false;

  const article = msg.article;
  void (async () => {
    const settings = await loadClipperSettings();
    initInkadeI18n(settings.locale);
    if (!settings.serverUrl || !settings.token) {
      sendResponse({ ok: false, error: t("clipper.setupPromptTitle") });
      return;
    }
    const templates = await loadActiveTemplates();
    const clipPayload: ClipPageOfflinePayload = {
      extracted: article,
      spaceId:
        (msg.spaceId ? asSpaceId(msg.spaceId) : undefined) ?? (settings.defaultSpaceId || undefined),
      tags: [...settings.defaultTags],
      mode: "client-dom",
      mirrorImages: settings.mirrorImages,
      asyncMirror: settings.autoMirrorImagesAsync,
      compressWebp: settings.compressImagesToWebp,
      saveHtmlSnapshot: settings.saveHtmlSnapshot,
      appendToDaily: settings.defaultAppendToDaily,
    };
    try {
      const client = createClipperSdkClient({
        serverUrl: settings.serverUrl,
        token: settings.token,
      });
      const res = await executeUnifiedClip(client, {
        ...clipPayload,
        dedupeByUrl: true,
        preserveExistingTags: true,
        templates,
        preferTemplateDefaults: true,
        aiProvider: settings.aiProvider,
        fastAsyncRaceMs: 1500,
        onBackgroundTasks: trackBackgroundTask,
      });
      const docId = res.document?.id;
      const docTitle = res.document?.title ?? article.title;
      if (senderTabId !== undefined && res.document) {
        await updateTabClipBadge(senderTabId, { found: true, highlights: [] });
      }
      broadcastClipperStateChanged({
        tabId: senderTabId,
        url: article.url,
        documentId: docId,
        reason: "clip",
      });
      sendResponse({
        ok: true,
        message: formatClipSuccessMessage(res, docTitle),
        openUrl: docId ? resolveWebAppDocUrl(settings, docId) : undefined,
      });
    } catch (err) {
      if (isRetryableNetworkError(err)) {
        await enqueueOfflineAction({
          kind: "clip-page",
          label: article.title,
          payload: clipPayload,
          error: err,
        });
        sendResponse({
          ok: true,
          queued: true,
          message: t("clipper.clipQueuedOffline", { title: article.title }),
        });
        return;
      }
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true;
}
