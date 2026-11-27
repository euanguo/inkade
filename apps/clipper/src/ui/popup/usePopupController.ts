import type { ExtractedArticle, PageExtractionBundle } from "@inkade/clipper-core/extractor";
import {
  BUILTIN_CLIPPER_TEMPLATES,
  matchTemplateForPage,
  renderClipTemplate,
} from "@inkade/clipper-core/templates";
import type { ClipLookupResult, ClipperTemplate } from "@inkade/core";
import { setInkadeLocale, useInkadeLocale, useInkadeTranslation } from "@inkade/i18n";
import { useCallback, useEffect, useRef } from "react";
import { useDebounceCallback, useEventListener } from "usehooks-ts";
import { generateAiSummaryAndTags, isAiProviderReady } from "../../core/interpreter.ts";
import {
  enqueueOfflineAction,
  flushOfflineQueue,
  isRetryableNetworkError,
} from "../../core/offline-queue.ts";
import {
  createClipperSdkClient,
  lookupClipState,
  resolveClipperConnection,
  syncHighlightToInkade,
  syncSelectionClipToInkade,
} from "../../core/sync.ts";
import { executeUnifiedClip, resolveTemplatePlanForArticle } from "../../core/unified-clip.ts";
import {
  clearPopupDraft,
  formatTagsCsv,
  loadCachedWorkspaceTags,
  loadClipperSettings,
  loadOfflineQueueItems,
  loadPopupDraft,
  loadStoredClipperTemplates,
  parseTagsCsv,
  saveCachedWorkspaceTags,
  savePopupDraft,
  type ClipperSettings,
} from "../../shared/storage.ts";
import {
  getWebExt,
  hasHostOriginPermission,
  isRestrictedTabUrl,
  requestHostOriginPermission,
  resolveTargetTab,
  sendMessageEnsuringScript,
  type WebExtTab,
} from "../../shared/webext.ts";
import { formatSummaryAsCallout } from "../shared/clipper-ui-helpers.ts";
import { useClipperThemeAndStorageSync } from "../shared/useSettingsSync.ts";
import { usePopupStore } from "../stores/popup-store.ts";
import { useClipperSettingsStore } from "../stores/settings-store.ts";

export function usePopupController() {
  const { t } = useInkadeTranslation();
  const { locale, setLocale } = useInkadeLocale();

  const settings = useClipperSettingsStore((s) => s.settings);
  const settingsLoaded = useClipperSettingsStore((s) => s.settingsLoaded);
  const setSettings = useClipperSettingsStore((s) => s.setSettings);
  const setSettingsLoaded = useClipperSettingsStore((s) => s.setSettingsLoaded);
  const setOfflineCount = useClipperSettingsStore((s) => s.setOfflineCount);
  const saveSettingsPatch = useClipperSettingsStore((s) => s.saveSettingsPatch);

  const store = usePopupStore();
  const { patch } = store;

  useClipperThemeAndStorageSync();

  const userEditedFormRef = useRef(false);
  const draftRestoredRef = useRef(false);
  const autoCloseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current !== null) {
        window.clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, []);

  const applyTemplatePreview = useCallback(
    (
      tpl: ClipperTemplate,
      article: ExtractedArticle,
      baseTags: readonly string[],
      hlList?: ClipLookupResult["highlights"],
    ) => {
      const plan = renderClipTemplate(tpl, {
        article,
        highlights: hlList,
      });
      const mergedTags = [...new Set([...baseTags, ...plan.tags])];
      patch({
        title: plan.title || article.title,
        tagsList: mergedTags,
        mirrorImages: plan.mirrorImages,
        saveSnapshot: plan.saveHtmlSnapshot,
        appendToDaily: plan.appendToDaily,
        ...(plan.targetSpaceId ? { spaceId: plan.targetSpaceId } : {}),
      });
    },
    [patch],
  );

  const connectToServer = useCallback(
    async (cfg: ClipperSettings) => {
      if (!cfg.serverUrl || !cfg.token) {
        patch({ connected: false, connectionError: null });
        return null;
      }
      patch({ connecting: true, connectionError: null });
      try {
        const client = createClipperSdkClient({
          serverUrl: cfg.serverUrl,
          token: cfg.token,
        });
        const conn = await resolveClipperConnection(client);
        const currentSpaceId = usePopupStore.getState().spaceId;
        patch({
          spaces: conn.visibleSpaces.filter((s) => s.archivedAt === null),
          connected: true,
          ...(!cfg.defaultSpaceId && conn.defaultSpaceId && !currentSpaceId
            ? { spaceId: conn.defaultSpaceId }
            : {}),
        });
        void client.workspace
          .summary()
          .then((sum) => {
            patch({ tagSuggestions: sum.tags });
            return saveCachedWorkspaceTags(sum.tags);
          })
          .catch(() => {});
        return client;
      } catch (err) {
        patch({
          connected: false,
          connectionError: err instanceof Error ? err.message : String(err),
        });
        return null;
      } finally {
        patch({ connecting: false });
      }
    },
    [patch],
  );

  const extractFromTab = useCallback(
    async (
      tab: WebExtTab,
      catalog: readonly ClipperTemplate[],
      baseTags: readonly string[],
    ): Promise<PageExtractionBundle | null> => {
      if (!tab.id) return null;
      patch({ extracting: true, extractFailed: false });
      try {
        const [hasPerm, bundle, draft] = await Promise.all([
          tab.url ? hasHostOriginPermission(tab.url) : Promise.resolve(true),
          sendMessageEnsuringScript<PageExtractionBundle>(tab.id, "content-extractor.js", {
            type: "INKADE_EXTRACT_BUNDLE",
          }),
          tab.url ? loadPopupDraft(tab.url) : Promise.resolve(null),
        ]);
        patch({ missingHostPermission: !hasPerm });

        if (!bundle) {
          patch({ extractFailed: true });
          return null;
        }

        const hasSelection = Boolean(bundle.selection && bundle.selection.quote.trim().length >= 2);
        patch({
          extracted: bundle.article,
          selection: bundle.selection,
          selectionMarkdown: bundle.selectionMarkdown ?? "",
          activeMode: hasSelection ? "highlight" : "clip",
        });

        const matched = matchTemplateForPage(catalog, {
          url: bundle.article.url,
          schemaTypes: bundle.article.meta.schemaTypes,
        });
        if (matched.template) {
          patch({
            selectedTemplateId: matched.template.id,
            ...(matched.autoMatched ? { autoMatchedTemplateId: matched.template.id } : {}),
          });
          applyTemplatePreview(matched.template, bundle.article, baseTags);
        } else {
          patch({
            title: bundle.article.title,
            tagsList: [...baseTags],
          });
        }

        if (draft) {
          draftRestoredRef.current = true;
          userEditedFormRef.current = true;
          patch({
            ...(draft.title ? { title: draft.title } : {}),
            ...(draft.tagsCsv ? { tagsList: parseTagsCsv(draft.tagsCsv) } : {}),
            ...(draft.spaceId ? { spaceId: draft.spaceId } : {}),
            ...(draft.highlightNote ? { highlightNote: draft.highlightNote } : {}),
            ...(draft.aiSummary ? { aiSummaryText: draft.aiSummary } : {}),
          });
        }
        return bundle;
      } catch {
        patch({ extractFailed: true });
        return null;
      } finally {
        patch({ extracting: false });
      }
    },
    [applyTemplatePreview, patch],
  );

  useEffect(() => {
    void (async () => {
      const [loaded, storedTemplates, queue, cachedTags] = await Promise.all([
        loadClipperSettings(),
        loadStoredClipperTemplates(),
        loadOfflineQueueItems(),
        loadCachedWorkspaceTags(),
      ]);

      setSettings(loaded);
      setLocale(loaded.locale);
      setSettingsLoaded(true);
      setOfflineCount(queue.length);

      const catalog =
        storedTemplates && storedTemplates.length > 0
          ? storedTemplates
          : BUILTIN_CLIPPER_TEMPLATES;
      patch({
        spaceId: loaded.defaultSpaceId,
        tagsList: [...loaded.defaultTags],
        clipMode: loaded.clipMode,
        mirrorImages: loaded.mirrorImages,
        saveSnapshot: loaded.saveHtmlSnapshot,
        appendToDaily: loaded.defaultAppendToDaily,
        highlightColor: loaded.highlightColor,
        templates: catalog,
        ...(cachedTags?.tags ? { tagSuggestions: cachedTags.tags } : {}),
      });

      const ext = getWebExt();
      const connectionPromise = connectToServer(loaded);
      const active = ext?.tabs ? await resolveTargetTab() : null;
      if (!active?.id || isRestrictedTabUrl(active.url)) {
        patch({ tabRestricted: true, extracting: false });
        await connectionPromise;
        return;
      }
      patch({ activeTab: active });

      const lookupPromise =
        loaded.serverUrl && loaded.token && active.url
          ? lookupClipState(
              createClipperSdkClient({ serverUrl: loaded.serverUrl, token: loaded.token }),
              active.url,
            ).catch(() => null)
          : Promise.resolve(null);

      const [, , lookupRes] = await Promise.allSettled([
        connectionPromise,
        extractFromTab(active, catalog, loaded.defaultTags),
        lookupPromise,
      ]);

      if (lookupRes.status === "fulfilled" && lookupRes.value) {
        const lookupVal = lookupRes.value;
        patch({ existingLookup: lookupVal });
        if (lookupVal.found && lookupVal.document && !userEditedFormRef.current) {
          const prevTags = usePopupStore.getState().tagsList;
          patch({
            spaceId: lookupVal.document.spaceId,
            tagsList: [...new Set([...lookupVal.document.tags, ...prevTags])],
          });
        }
      }
    })();
  }, [connectToServer, extractFromTab, patch, setLocale, setOfflineCount, setSettings, setSettingsLoaded]);

  const debouncedSaveDraft = useDebounceCallback(
    (payload: Parameters<typeof savePopupDraft>[0]) => {
      void savePopupDraft(payload);
    },
    350,
  );

  useEffect(() => {
    if (!store.extracted?.url || !settingsLoaded) return;
    debouncedSaveDraft({
      url: store.extracted.url,
      title: store.title,
      tagsCsv: formatTagsCsv(store.tagsList),
      spaceId: store.spaceId,
      highlightNote: store.highlightNote,
      aiSummary: store.aiSummaryText,
    });
  }, [
    debouncedSaveDraft,
    settingsLoaded,
    store.aiSummaryText,
    store.extracted?.url,
    store.highlightNote,
    store.spaceId,
    store.tagsList,
    store.title,
  ]);

  const scheduleAutoCloseIfEnabled = useCallback(() => {
    if (!settings.autoClosePopupOnClip || typeof window === "undefined") return;
    autoCloseTimerRef.current = window.setTimeout(() => {
      window.close();
    }, 1200);
  }, [settings.autoClosePopupOnClip]);

  const handleToggleLocale = useCallback(async () => {
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const saved = await saveSettingsPatch({ locale: nextLocale });
    setInkadeLocale(saved.locale);
    setLocale(saved.locale);
  }, [locale, saveSettingsPatch, setLocale]);

  const handleGrantOriginPermission = useCallback(async () => {
    const activeTab = usePopupStore.getState().activeTab;
    if (!activeTab?.url) return;
    const granted = await requestHostOriginPermission(activeTab.url);
    patch({
      missingHostPermission: !granted,
      status: {
        kind: granted ? "success" : "error",
        text: granted
          ? t("clipper.hostPermGranted", { origin: new URL(activeTab.url).origin })
          : t("clipper.hostPermDenied"),
      },
    });
    if (granted && activeTab.id) {
      void extractFromTab(activeTab, usePopupStore.getState().templates, settings.defaultTags);
    }
  }, [extractFromTab, patch, settings.defaultTags, t]);

  const handleTriggerTabUi = useCallback(
    async (messageType: "INKADE_START_REGION_PICKER" | "INKADE_TOGGLE_READER") => {
      const tabId = usePopupStore.getState().activeTab?.id;
      if (!tabId) return;
      await sendMessageEnsuringScript(tabId, "content-page-ui.js", { type: messageType });
      if (typeof window !== "undefined") {
        window.close();
      }
    },
    [],
  );

  const handleSelectTemplate = useCallback(
    (templateId: string) => {
      const state = usePopupStore.getState();
      patch({ selectedTemplateId: templateId });
      const tpl = state.templates.find((item) => item.id === templateId);
      if (tpl && state.extracted) {
        applyTemplatePreview(tpl, state.extracted, settings.defaultTags, state.existingLookup?.highlights);
        userEditedFormRef.current = true;
      }
    },
    [applyTemplatePreview, patch, settings.defaultTags],
  );

  const handleRunAiEnrich = useCallback(async () => {
    const state = usePopupStore.getState();
    if (!state.extracted) return;
    if (!isAiProviderReady(settings.aiProvider)) {
      patch({ status: { kind: "error", text: t("clipper.aiNotConfiguredHint") } });
      return;
    }
    patch({ aiEnriching: true, status: null });
    try {
      const res = await generateAiSummaryAndTags(settings.aiProvider, state.extracted);
      const existingLower = new Set(state.tagsList.map((tag) => tag.toLowerCase()));
      const additions = res.tags.filter((tag) => !existingLower.has(tag.toLowerCase()));
      userEditedFormRef.current = true;
      patch({
        ...(additions.length > 0 ? { tagsList: [...state.tagsList, ...additions] } : {}),
        ...(res.summary ? { aiSummaryText: res.summary } : {}),
        status: { kind: "success", text: t("clipper.aiEnrichSuccess") },
      });
    } catch (error) {
      patch({
        status: {
          kind: "error",
          text: t("clipper.aiEnrichFailed", {
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      });
    } finally {
      patch({ aiEnriching: false });
    }
  }, [patch, settings.aiProvider, t]);

  const handleFlushOffline = useCallback(async () => {
    if (!settings.serverUrl || !settings.token) return;
    patch({ flushingOffline: true });
    try {
      const client = createClipperSdkClient({
        serverUrl: settings.serverUrl,
        token: settings.token,
      });
      const res = await flushOfflineQueue(client);
      setOfflineCount(res.remaining);
      patch({
        status: {
          kind: res.remaining > 0 && res.lastError ? "error" : "success",
          text: t("clipper.offlineQueueFlushed", {
            synced: res.synced,
            remaining: res.remaining,
          }),
        },
      });
    } finally {
      patch({ flushingOffline: false });
    }
  }, [patch, setOfflineCount, settings.serverUrl, settings.token, t]);

  const handleClipPage = useCallback(
    async (action: "create-new" | "update-body" | "update-meta") => {
      const state = usePopupStore.getState();
      if (!state.extracted || state.submittingClip) return;
      patch({ submittingClip: true, status: null });

      const updateExisting = action !== "create-new";
      const updateMetadataOnly = action === "update-meta";

      const resolved = updateMetadataOnly
        ? { plan: null, template: null }
        : await resolveTemplatePlanForArticle({
            article: state.extracted,
            templates: state.templates,
            aiProvider: settings.aiProvider,
            selection: state.selection,
            selectionMarkdown: state.selectionMarkdown,
            highlights: state.existingLookup?.highlights,
            templateIdOverride: state.selectedTemplateId || undefined,
          });

      const callout = formatSummaryAsCallout(state.aiSummaryText);
      const bodyBase = resolved.plan?.contentMarkdown ?? state.extracted.markdown;
      const finalMarkdown = updateMetadataOnly
        ? undefined
        : callout
          ? `${callout}\n\n${bodyBase}`
          : resolved.plan?.contentMarkdown;

      const clipPayload = {
        extracted: state.extracted,
        tabId: state.activeTab?.id,
        spaceId: state.spaceId || undefined,
        title: state.title.trim() || resolved.plan?.title || state.extracted.title,
        markdownOverride: finalMarkdown,
        tags: state.tagsList,
        properties: resolved.plan?.properties,
        existingDocumentId: updateExisting ? state.existingLookup?.document?.id : undefined,
        updateMetadataOnly,
        mode: state.clipMode,
        mirrorImages: state.mirrorImages,
        saveHtmlSnapshot: state.saveSnapshot,
        appendToDaily: state.appendToDaily,
        dailyLineOverride: resolved.plan?.dailyLine,
        templateBehavior: updateExisting ? "append-existing" : resolved.template?.behavior,
      };

      try {
        const ext = getWebExt();
        if (ext?.runtime?.sendMessage) {
          const bgRes = await ext.runtime.sendMessage<{
            readonly ok: boolean;
            readonly document?: ClipLookupResult["document"];
            readonly mirroredImages?: number;
            readonly queued?: boolean;
            readonly message?: string;
            readonly error?: string;
          }>({
            type: "INKADE_BG_CLIP_PAGE",
            ...clipPayload,
          });
          if (!bgRes?.ok) throw new Error(bgRes?.error || t("common.unknownError"));
          if (bgRes.queued) {
            setOfflineCount((c) => c + 1);
            patch({
              status: {
                kind: "success",
                text: bgRes.message || t("clipper.clipQueuedOffline", { title: clipPayload.title }),
              },
            });
          } else {
            patch({
              ...(bgRes.document
                ? {
                    existingLookup: {
                      found: true,
                      normalizedUrl: state.existingLookup?.normalizedUrl ?? state.extracted.url,
                      document: bgRes.document,
                      highlights: state.existingLookup?.highlights ?? [],
                      threadBindings: state.existingLookup?.threadBindings ?? [],
                    },
                  }
                : {}),
              status: {
                kind: "success",
                text:
                  bgRes.message ||
                  t("clipper.clipSuccess", {
                    title: bgRes.document?.title ?? clipPayload.title,
                    images: bgRes.mirroredImages ?? 0,
                  }),
                docId: bgRes.document?.id,
              },
            });
            void clearPopupDraft();
            scheduleAutoCloseIfEnabled();
          }
          return;
        }

        const client = createClipperSdkClient({
          serverUrl: settings.serverUrl,
          token: settings.token,
        });
        const result = await executeUnifiedClip(client, clipPayload);
        patch({
          ...(result.document
            ? {
                existingLookup: {
                  found: true,
                  normalizedUrl: state.existingLookup?.normalizedUrl ?? state.extracted.url,
                  document: result.document,
                  highlights: state.existingLookup?.highlights ?? [],
                  threadBindings: state.existingLookup?.threadBindings ?? [],
                },
              }
            : {}),
          status: {
            kind: "success",
            text: t("clipper.clipSuccess", {
              title: result.document?.title ?? clipPayload.title,
              images: result.mirroredImages,
            }),
            docId: result.document?.id,
          },
        });
        void clearPopupDraft();
        scheduleAutoCloseIfEnabled();
      } catch (error) {
        if (isRetryableNetworkError(error)) {
          await enqueueOfflineAction({
            kind: "clip-page",
            label: clipPayload.title,
            payload: clipPayload,
            error,
          });
          setOfflineCount((c) => c + 1);
          patch({
            status: {
              kind: "success",
              text: t("clipper.clipQueuedOffline", { title: clipPayload.title }),
            },
          });
        } else {
          patch({
            status: {
              kind: "error",
              text: t("clipper.clipFailed", {
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          });
        }
      } finally {
        patch({ submittingClip: false });
      }
    },
    [patch, scheduleAutoCloseIfEnabled, setOfflineCount, settings.aiProvider, settings.serverUrl, settings.token, t],
  );

  const handleSyncHighlight = useCallback(async () => {
    const state = usePopupStore.getState();
    if (!state.selection || state.submittingHighlight) return;
    patch({ submittingHighlight: true, status: null });

    const payload = {
      tabId: state.activeTab?.id,
      article: state.extracted ?? undefined,
      title: state.title.trim() || state.extracted?.title || state.selection.title,
      spaceId: state.spaceId || undefined,
      tags: state.tagsList,
      existingDocumentId: state.existingLookup?.document?.id,
      mirrorImages: state.mirrorImages,
      saveHtmlSnapshot: state.saveSnapshot,
      anchor: {
        url: state.selection.url || state.extracted?.url || "",
        title: state.selection.title || state.extracted?.title || "",
        quote: state.selection.quote,
        prefixContext: state.selection.prefixContext,
        suffixContext: state.selection.suffixContext,
      },
      color: state.highlightColor,
      noteMarkdown: state.highlightNote.trim(),
    };

    try {
      const ext = getWebExt();
      if (ext?.runtime?.sendMessage) {
        const res = await ext.runtime.sendMessage<{
          readonly ok: boolean;
          readonly documentId?: string;
          readonly queued?: boolean;
          readonly message?: string;
          readonly error?: string;
        }>({
          type: "INKADE_BG_SYNC_HIGHLIGHT",
          ...payload,
        });
        if (!res?.ok) throw new Error(res?.error || t("common.unknownError"));
        if (res.queued) {
          setOfflineCount((c) => c + 1);
          patch({
            status: {
              kind: "success",
              text: res.message || t("clipper.clipQueuedOffline", { title: payload.title }),
            },
          });
        } else {
          patch({
            highlightNote: "",
            status: {
              kind: "success",
              text: res.message || t("clipper.highlightSuccess", { title: payload.title }),
              docId: res.documentId,
            },
          });
          void clearPopupDraft();
          scheduleAutoCloseIfEnabled();
        }
        return;
      }

      const client = createClipperSdkClient({
        serverUrl: settings.serverUrl,
        token: settings.token,
      });
      const result = await syncHighlightToInkade(client, {
        url: payload.anchor.url,
        title: payload.title,
        spaceId: payload.spaceId,
        tags: payload.tags,
        extracted: payload.article,
        existingDocumentId: payload.existingDocumentId,
        mirrorImages: payload.mirrorImages,
        saveHtmlSnapshot: payload.saveHtmlSnapshot,
        compressWebp: settings.compressImagesToWebp,
        anchor: payload.anchor,
        color: payload.color,
        noteMarkdown: payload.noteMarkdown,
      });
      patch({
        highlightNote: "",
        status: {
          kind: "success",
          text: result.createdClip
            ? t("clipper.highlightSuccessCreated", { title: result.document.title })
            : t("clipper.highlightSuccess", { title: result.document.title }),
          docId: result.document.id,
        },
      });
    } catch (error) {
      patch({
        status: {
          kind: "error",
          text: t("clipper.highlightFailed", {
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      });
    } finally {
      patch({ submittingHighlight: false });
    }
  }, [patch, scheduleAutoCloseIfEnabled, setOfflineCount, settings.compressImagesToWebp, settings.serverUrl, settings.token, t]);

  const handleClipSelectionOnly = useCallback(async () => {
    const state = usePopupStore.getState();
    if (!state.selection || state.submittingHighlight) return;
    patch({ submittingHighlight: true, status: null });
    const targetUrl = state.selection.url || state.extracted?.url || "";
    const targetTitle = state.title.trim() || state.extracted?.title || state.selection.title;
    const md = state.selectionMarkdown || state.selection.quote;

    try {
      const ext = getWebExt();
      if (ext?.runtime?.sendMessage) {
        const res = await ext.runtime.sendMessage<{
          readonly ok: boolean;
          readonly documentId?: string;
          readonly queued?: boolean;
          readonly message?: string;
          readonly error?: string;
        }>({
          type: "INKADE_BG_CLIP_SELECTION",
          tabId: state.activeTab?.id,
          url: targetUrl,
          title: targetTitle,
          selectionMarkdown: md,
          spaceId: state.spaceId || undefined,
          tags: state.tagsList,
        });
        if (!res?.ok) throw new Error(res?.error || t("common.unknownError"));
        if (res.queued) setOfflineCount((c) => c + 1);
        patch({
          status: {
            kind: "success",
            text: res.message || t("clipper.clipSuccess", { title: targetTitle, images: 0 }),
            docId: res.documentId,
          },
        });
        scheduleAutoCloseIfEnabled();
        return;
      }

      const client = createClipperSdkClient({
        serverUrl: settings.serverUrl,
        token: settings.token,
      });
      const doc = await syncSelectionClipToInkade(client, {
        url: targetUrl,
        title: targetTitle,
        selectionMarkdown: md,
        spaceId: state.spaceId || undefined,
        tags: state.tagsList,
      });
      patch({
        status: {
          kind: "success",
          text: t("clipper.clipSuccess", { title: doc.title, images: 0 }),
          docId: doc.id,
        },
      });
    } catch (error) {
      patch({
        status: {
          kind: "error",
          text: t("clipper.clipFailed", {
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      });
    } finally {
      patch({ submittingHighlight: false });
    }
  }, [patch, scheduleAutoCloseIfEnabled, setOfflineCount, settings.serverUrl, settings.token, t]);

  const isConfigured = Boolean(settings.serverUrl && settings.token);

  useEventListener("keydown", (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      if (!isConfigured || !store.extracted) return;
      event.preventDefault();
      if (store.activeMode === "highlight" && store.selection) {
        void handleSyncHighlight();
      } else {
        void handleClipPage(store.existingLookup?.found ? "update-body" : "create-new");
      }
    }
  });

  const markUserEdited = useCallback(() => {
    userEditedFormRef.current = true;
  }, []);

  return {
    isConfigured,
    draftRestored: draftRestoredRef.current,
    markUserEdited,
    connectToServer,
    extractFromTab,
    handleToggleLocale,
    handleGrantOriginPermission,
    handleTriggerTabUi,
    handleSelectTemplate,
    handleRunAiEnrich,
    handleFlushOffline,
    handleClipPage,
    handleSyncHighlight,
    handleClipSelectionOnly,
  };
}
