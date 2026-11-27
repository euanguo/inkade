import type {
  ExtractedArticle,
  PageExtractionBundle,
} from "@inkade/clipper-core/extractor";
import { BUILTIN_CLIPPER_TEMPLATES } from "@inkade/clipper-core/templates";
import type { ClipLookupResult, ClipperTemplate } from "@inkade/core";
import { t } from "@inkade/i18n";
import { flushOfflineQueue, updateOfflineBadge } from "../core/offline-queue.ts";
import { createClipperSdkClient } from "../core/sync.ts";
import {
  loadClipperSettings,
  loadOfflineQueueItems,
  loadStoredClipperTemplates,
} from "../shared/storage.ts";
import { getWebExt, sendMessageEnsuringScript } from "../shared/webext.ts";
import { SEMANTIC_BADGE_SUCCESS } from "./types.ts";

const pendingBackgroundTasks = new Set<Promise<void>>();

export function broadcastClipperStateChanged(payload: {
  readonly tabId?: number | undefined;
  readonly url?: string | undefined;
  readonly documentId?: string | undefined;
  readonly reason: string;
}): void {
  const ext = getWebExt();
  if (!ext?.runtime?.sendMessage) return;
  try {
    void Promise.resolve(
      ext.runtime.sendMessage({
        type: "INKADE_CLIPPER_STATE_CHANGED",
        ...payload,
      }),
    ).catch(() => {});
  } catch {
    // ignore when no UI surface is listening
  }
}

export async function updateTabClipBadge(
  tabId: number | undefined,
  lookup: Pick<ClipLookupResult, "found" | "highlights"> | null,
): Promise<void> {
  const ext = getWebExt();
  if (!ext?.action || tabId === undefined) return;
  try {
    const queue = await loadOfflineQueueItems();
    if (queue.length > 0) {
      await updateOfflineBadge(queue.length);
      return;
    }
    if (!lookup?.found) {
      await ext.action.setBadgeText({ text: "", tabId });
      return;
    }
    const text = lookup.highlights.length > 0 ? String(lookup.highlights.length) : "✓";
    await ext.action.setBadgeBackgroundColor({ color: SEMANTIC_BADGE_SUCCESS, tabId });
    await ext.action.setBadgeText({ text, tabId });
  } catch {
    // ignore badge errors
  }
}

export async function tryFlushOfflineQueue(): Promise<void> {
  const settings = await loadClipperSettings();
  const pending = await loadOfflineQueueItems();
  if (pending.length === 0) {
    await updateOfflineBadge(0);
    return;
  }
  await updateOfflineBadge(pending.length);
  if (!settings.serverUrl || !settings.token) return;
  try {
    const client = createClipperSdkClient({
      serverUrl: settings.serverUrl,
      token: settings.token,
    });
    await flushOfflineQueue(client);
  } catch {
    // keep offline items until next trigger
  }
}

export function trackBackgroundTask(promise: Promise<void>): void {
  pendingBackgroundTasks.add(promise);
  void promise.finally(() => {
    pendingBackgroundTasks.delete(promise);
  });
}

export async function setTransientBadge(
  tabId: number | undefined,
  text: string,
  color: string,
  restoreLookup?: Pick<ClipLookupResult, "found" | "highlights"> | null,
): Promise<void> {
  const ext = getWebExt();
  if (!ext?.action) return;
  try {
    await ext.action.setBadgeBackgroundColor({
      color,
      ...(tabId !== undefined ? { tabId } : {}),
    });
    await ext.action.setBadgeText({ text, ...(tabId !== undefined ? { tabId } : {}) });
    setTimeout(() => {
      if (tabId !== undefined && restoreLookup) {
        void updateTabClipBadge(tabId, restoreLookup);
      } else {
        void ext.action?.setBadgeText({ text: "", ...(tabId !== undefined ? { tabId } : {}) });
      }
    }, 3000);
  } catch {
    // ignore badge errors
  }
}

export async function ensureScriptInjected(tabId: number, file: string): Promise<boolean> {
  const ext = getWebExt();
  if (!ext?.scripting) return false;
  try {
    await ext.scripting.executeScript({
      target: { tabId },
      files: [file],
    });
    return true;
  } catch {
    return false;
  }
}

export async function notifyTabToast(
  tabId: number | undefined,
  kind: "info" | "success" | "error",
  text: string,
  openUrl?: string,
): Promise<void> {
  if (!tabId) return;
  await sendMessageEnsuringScript(tabId, "content-page-ui.js", {
    type: "INKADE_SHOW_TOAST",
    kind,
    text,
    openUrl,
  });
}

export async function extractBundleFromTab(
  tabId: number,
  usePointerTarget = false,
): Promise<PageExtractionBundle | null> {
  return sendMessageEnsuringScript<PageExtractionBundle>(tabId, "content-extractor.js", {
    type: "INKADE_EXTRACT_BUNDLE",
    usePointerTarget,
  });
}

export function buildSelectionFallbackArticle(
  url: string,
  title: string,
  selectionMarkdown: string,
): ExtractedArticle {
  let domain = "";
  try {
    domain = new URL(url).hostname;
  } catch {
    domain = "";
  }
  const body = `${selectionMarkdown.trim()}\n\n---\nSource: [${url}](${url})`;
  return {
    url,
    title: title.trim() || url,
    markdown: body,
    excerpt: selectionMarkdown.trim().slice(0, 180),
    htmlSnapshot: "",
    cleanHtml: "",
    imageUrls: [],
    meta: { domain },
    variables: {},
    extractor: "extension-selection",
  };
}

export async function loadActiveTemplates(): Promise<readonly ClipperTemplate[]> {
  const stored = await loadStoredClipperTemplates();
  return stored && stored.length > 0 ? stored : BUILTIN_CLIPPER_TEMPLATES;
}

export function formatClipSuccessMessage(
  res: {
    readonly dailyOnly: boolean;
    readonly mirrorPending: boolean;
    readonly mirroredImages: number;
  },
  docTitle: string,
): string {
  if (res.dailyOnly) {
    return t("desktop.captureSuccessDaily");
  }
  if (res.mirrorPending) {
    return t("clipper.clipSuccessAsync", { title: docTitle });
  }
  return t("clipper.clipSuccess", {
    title: docTitle,
    images: res.mirroredImages,
  });
}
