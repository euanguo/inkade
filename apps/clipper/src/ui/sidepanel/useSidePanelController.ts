import type { ExtractedHighlightAnchor, PageExtractionBundle } from "@inkade/clipper-core/extractor";
import { BUILTIN_CLIPPER_TEMPLATES, matchTemplateForPage } from "@inkade/clipper-core/templates";
import {
  asDocumentId,
  type DocumentHighlight,
  type HighlightColor,
  type HighlightId,
} from "@inkade/core";
import { useInkadeLocale, useInkadeTranslation } from "@inkade/i18n";
import { useCallback, useEffect, useRef } from "react";
import {
  enqueueOfflineAction,
  flushOfflineQueue,
  isRetryableNetworkError,
} from "../../core/offline-queue.ts";
import {
  appendClipToDaily,
  createClipperSdkClient,
  dispatchClipToAde,
  lookupClipState,
  resolveClipperConnection,
} from "../../core/sync.ts";
import { executeUnifiedClip } from "../../core/unified-clip.ts";
import {
  loadClipperSettings,
  loadOfflineQueueItems,
  loadStoredClipperTemplates,
  resolveWebAppDocUrl,
  type ClipperSettings,
} from "../../shared/storage.ts";
import {
  getWebExt,
  isRestrictedTabUrl,
  resolveTargetTab,
  sendMessageEnsuringScript,
} from "../../shared/webext.ts";
import { getAdeHostLabel } from "../shared/clipper-ui-helpers.ts";
import { useClipperThemeAndStorageSync } from "../shared/useSettingsSync.ts";
import { useClipperSettingsStore } from "../stores/settings-store.ts";
import {
  useSidePanelStore,
  type NoteSaveState,
  type RelatedScope,
} from "../stores/sidepanel-store.ts";

export function useSidePanelController() {
  const { t } = useInkadeTranslation();
  const { setLocale } = useInkadeLocale();

  const settings = useClipperSettingsStore((s) => s.settings);
  const setSettings = useClipperSettingsStore((s) => s.setSettings);
  const setSettingsLoaded = useClipperSettingsStore((s) => s.setSettingsLoaded);
  const setOfflineCount = useClipperSettingsStore((s) => s.setOfflineCount);

  const store = useSidePanelStore();
  const { patch } = store;

  useClipperThemeAndStorageSync();

  const activeTabIdRef = useRef<number | null>(null);
  const activeTabUrlRef = useRef<string>("");
  const dirtyNoteIdsRef = useRef<Set<HighlightId>>(new Set());
  const noteSaveTimersRef = useRef<Map<HighlightId, ReturnType<typeof setTimeout>>>(new Map());
  const pendingDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeleteRef = useRef<DocumentHighlight | null>(null);
  const isConfigured = Boolean(settings.serverUrl && settings.token);

  const commitPendingDeleteImmediately = useCallback(async () => {
    const hl = pendingDeleteRef.current;
    if (!hl) return;
    pendingDeleteRef.current = null;
    if (pendingDeleteTimerRef.current) {
      clearTimeout(pendingDeleteTimerRef.current);
      pendingDeleteTimerRef.current = null;
    }
    patch({ pendingDeleteHl: null });
    const cfg = useClipperSettingsStore.getState().settings;
    if (!cfg.serverUrl || !cfg.token) return;
    try {
      const client = createClipperSdkClient({ serverUrl: cfg.serverUrl, token: cfg.token });
      await client.highlights.delete(hl.id);
    } catch {
      // ignore background cleanup delete failure
    }
  }, [patch]);

  useEffect(() => {
    const noteSaveTimers = noteSaveTimersRef.current;
    return () => {
      for (const timer of noteSaveTimers.values()) clearTimeout(timer);
      if (pendingDeleteTimerRef.current) clearTimeout(pendingDeleteTimerRef.current);
    };
  }, []);

  const loadRelatedForQuery = useCallback(
    async (
      queryText: string,
      cfg: ClipperSettings,
      excludeDocId?: string,
      scope: RelatedScope = useSidePanelStore.getState().relatedScope,
    ) => {
      const q = queryText.trim();
      if (!q || !cfg.serverUrl || !cfg.token) {
        patch({ relatedHits: [] });
        return;
      }
      patch({ relatedLoading: true });
      try {
        const client = createClipperSdkClient({ serverUrl: cfg.serverUrl, token: cfg.token });
        if (scope !== "clips") {
          try {
            const sem = await client.search.semantic({ q, limit: 10, mode: "hybrid" });
            const filtered = sem.hits
              .filter((h) => !excludeDocId || h.documentId !== excludeDocId)
              .slice(0, 8)
              .map((h) => ({
                documentId: h.documentId,
                title: h.title,
                snippet: h.snippet,
                matchSource: h.matchSource,
              }));
            if (filtered.length > 0) {
              patch({ relatedHits: filtered });
              return;
            }
          } catch {
            // fallback to lexical search below
          }
        }
        const fts = await client.search.query({
          q,
          limit: 10,
          ...(scope === "clips" ? { kind: "clip" as const } : {}),
        });
        patch({
          relatedHits: fts
            .filter((h) => !excludeDocId || h.documentId !== excludeDocId)
            .slice(0, 8)
            .map((h) => ({ documentId: h.documentId, title: h.title, snippet: h.snippet })),
        });
      } catch {
        patch({ relatedHits: [] });
      } finally {
        patch({ relatedLoading: false });
      }
    },
    [patch],
  );

  const refreshContext = useCallback(
    async (overrideSettings?: ClipperSettings, options?: { readonly lookupOnly?: boolean }) => {
      patch({ refreshing: true });
      try {
        const cfg = overrideSettings ?? (await loadClipperSettings());
        setSettings(cfg);
        setLocale(cfg.locale);
        setSettingsLoaded(true);

        const [queue, storedTemplates] = await Promise.all([
          loadOfflineQueueItems(),
          loadStoredClipperTemplates(),
        ]);
        setOfflineCount(queue.length);

        const tab = await resolveTargetTab();
        const urlChanged = Boolean(tab?.url && tab.url !== activeTabUrlRef.current);
        activeTabIdRef.current = tab?.id ?? null;
        activeTabUrlRef.current = tab?.url ?? "";
        patch({ activeTab: tab });

        if (!tab?.id || isRestrictedTabUrl(tab.url)) {
          patch({ extracted: null, selection: null, lookup: null });
          return;
        }

        if (urlChanged) {
          dirtyNoteIdsRef.current.clear();
          patch({ noteSaveStates: {}, relatedQueryEdited: false });
        }

        const templates =
          storedTemplates && storedTemplates.length > 0
            ? storedTemplates
            : BUILTIN_CLIPPER_TEMPLATES;

        if (!options?.lookupOnly) {
          const bundle = await sendMessageEnsuringScript<PageExtractionBundle>(
            tab.id,
            "content-extractor.js",
            { type: "INKADE_EXTRACT_BUNDLE" },
          );
          if (bundle) {
            const matched = matchTemplateForPage(templates, {
              url: bundle.article.url,
              schemaTypes: bundle.article.meta.schemaTypes,
            });
            patch({
              extracted: bundle.article,
              selection: bundle.selection,
              matchedTemplateName: matched.template?.name ?? "",
            });
          } else {
            patch({ extracted: null, selection: null, matchedTemplateName: "" });
          }
        }

        if (cfg.serverUrl && cfg.token && tab.url) {
          try {
            const client = createClipperSdkClient({ serverUrl: cfg.serverUrl, token: cfg.token });
            const spacesEmpty = useSidePanelStore.getState().spaces.length === 0;
            const [res, conn] = await Promise.all([
              lookupClipState(client, tab.url),
              spacesEmpty
                ? resolveClipperConnection(client).catch(() => null)
                : Promise.resolve(null),
            ]);
            const prevDrafts = useSidePanelStore.getState().noteDrafts;
            const currentSpaceId = useSidePanelStore.getState().spaceId;
            const nextDrafts: Record<string, string> = {};
            for (const hl of res.highlights) {
              nextDrafts[hl.id] = dirtyNoteIdsRef.current.has(hl.id)
                ? (prevDrafts[hl.id] ?? hl.noteMarkdown)
                : hl.noteMarkdown;
            }
            const nextSpaces = conn ? conn.visibleSpaces.filter((s) => s.archivedAt === null) : undefined;
            const fallbackSpaceId =
              !currentSpaceId && conn && !cfg.defaultSpaceId && conn.defaultSpaceId
                ? conn.defaultSpaceId
                : !currentSpaceId && res.found && res.document
                  ? res.document.spaceId
                  : undefined;

            patch({
              lookup: res,
              noteDrafts: nextDrafts,
              ...(nextSpaces ? { spaces: nextSpaces } : {}),
              ...(fallbackSpaceId ? { spaceId: fallbackSpaceId } : {}),
            });
          } catch {
            patch({ lookup: null });
          }
        } else {
          patch({ lookup: null });
        }
      } finally {
        patch({ refreshing: false });
      }
    },
    [patch, setLocale, setOfflineCount, setSettings, setSettingsLoaded],
  );

  useEffect(() => {
    void (async () => {
      const cfg = await loadClipperSettings();
      patch({
        adeKind: cfg.defaultAdeKind,
        appendToDaily: cfg.defaultAppendToDaily,
        adeAppendDaily: cfg.defaultAppendToDaily,
        spaceId: cfg.defaultSpaceId,
      });
      await refreshContext(cfg);
    })();

    const ext = getWebExt();
    const onActivated = (info: { readonly tabId: number }) => {
      if (activeTabIdRef.current !== null && info.tabId === activeTabIdRef.current) return;
      void refreshContext();
    };
    const onUpdated = (
      tabId: number,
      changeInfo: { readonly status?: string; readonly url?: string },
    ) => {
      if (activeTabIdRef.current !== null && tabId !== activeTabIdRef.current) return;
      if (changeInfo.url || changeInfo.status === "complete") {
        void refreshContext(undefined, {
          lookupOnly: !changeInfo.url && changeInfo.status === "complete",
        });
      }
    };
    const onRuntimeMessage = (message: unknown) => {
      if (!message || typeof message !== "object") return false;
      const msg = message as {
        readonly type?: string;
        readonly tabId?: number;
        readonly url?: string;
        readonly selection?: ExtractedHighlightAnchor | null;
      };
      if (msg.type === "INKADE_CLIPPER_STATE_CHANGED") {
        if (
          msg.tabId === undefined ||
          msg.tabId === activeTabIdRef.current ||
          (msg.url && msg.url === activeTabUrlRef.current)
        ) {
          void refreshContext(undefined, { lookupOnly: true });
        }
      }
      if (msg.type === "INKADE_SELECTION_CHANGED") {
        if (msg.tabId === undefined || msg.tabId === activeTabIdRef.current) {
          patch({ selection: msg.selection ?? null });
        }
      }
      return false;
    };

    ext?.tabs?.onActivated?.addListener(onActivated);
    ext?.tabs?.onUpdated?.addListener(onUpdated);
    ext?.runtime?.onMessage?.addListener(onRuntimeMessage);
    return () => {
      ext?.tabs?.onActivated?.removeListener?.(onActivated);
      ext?.tabs?.onUpdated?.removeListener?.(onUpdated);
      ext?.runtime?.onMessage?.removeListener?.(onRuntimeMessage);
    };
  }, [patch, refreshContext]);

  useEffect(() => {
    if (store.relatedQueryEdited) return;
    const defaultQ =
      store.relatedScope === "selection" && store.selection?.quote
        ? store.selection.quote.slice(0, 140)
        : store.extracted?.title || store.activeTab?.title || "";
    patch({ relatedQuery: defaultQ });
  }, [
    patch,
    store.activeTab?.title,
    store.extracted?.title,
    store.relatedQueryEdited,
    store.relatedScope,
    store.selection?.quote,
  ]);

  useEffect(() => {
    if (store.sectionTab !== "related") return;
    const q = store.relatedQuery.trim();
    if (!q || !isConfigured) return;
    void loadRelatedForQuery(q, settings, store.lookup?.document?.id, store.relatedScope);
  }, [
    isConfigured,
    loadRelatedForQuery,
    settings,
    store.lookup?.document?.id,
    store.relatedQuery,
    store.relatedScope,
    store.sectionTab,
  ]);

  useEffect(() => {
    if (store.sectionTab !== "ade" || !isConfigured || !store.lookup?.document?.id) return;
    const hasPending = store.lookup.threadBindings.some(
      (b) => b.status === "queued" || b.status === "running" || b.status === "waiting_input",
    );
    if (!hasPending) return;

    const docId = store.lookup.document.id;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const client = createClipperSdkClient({
            serverUrl: settings.serverUrl,
            token: settings.token,
          });
          const latest = await client.threadBindings.list({ documentId: docId });
          const currentLookup = useSidePanelStore.getState().lookup;
          if (currentLookup && currentLookup.document?.id === docId) {
            patch({ lookup: { ...currentLookup, threadBindings: latest } });
          }
        } catch {
          // ignore transient poll error
        }
      })();
    }, 4000);
    return () => clearInterval(timer);
  }, [
    isConfigured,
    patch,
    settings.serverUrl,
    settings.token,
    store.lookup?.document?.id,
    store.lookup?.threadBindings,
    store.sectionTab,
  ]);

  const handleFlushOffline = useCallback(async () => {
    if (!isConfigured) return;
    patch({ flushingOffline: true });
    try {
      const client = createClipperSdkClient({ serverUrl: settings.serverUrl, token: settings.token });
      const res = await flushOfflineQueue(client);
      setOfflineCount(res.remaining);
      patch({
        status: {
          kind: res.remaining > 0 && res.lastError ? "error" : "success",
          text: t("clipper.offlineQueueFlushed", { synced: res.synced, remaining: res.remaining }),
        },
      });
    } finally {
      patch({ flushingOffline: false });
    }
  }, [isConfigured, patch, setOfflineCount, settings.serverUrl, settings.token, t]);

  const handleQuickClip = useCallback(async () => {
    const state = useSidePanelStore.getState();
    if (!state.extracted || !isConfigured) return;
    patch({ clipping: true, status: null });
    const clipPayload = {
      extracted: state.extracted,
      tabId: state.activeTab?.id,
      spaceId: state.spaceId || settings.defaultSpaceId || undefined,
      tags: [...settings.defaultTags],
      existingDocumentId: state.lookup?.document?.id,
      preserveExistingTags: Boolean(state.lookup?.found),
      mode: settings.clipMode,
      appendToDaily: state.appendToDaily,
    };

    try {
      const ext = getWebExt();
      if (ext?.runtime?.sendMessage) {
        const res = await ext.runtime.sendMessage<{
          readonly ok: boolean;
          readonly document?: { readonly id: string; readonly title?: string };
          readonly queued?: boolean;
          readonly message?: string;
          readonly error?: string;
        }>({ type: "INKADE_BG_CLIP_PAGE", ...clipPayload });
        if (!res?.ok) throw new Error(res?.error || t("common.unknownError"));
        if (res.queued) setOfflineCount((c) => c + 1);
        patch({
          status: {
            kind: "success",
            text:
              res.message || t("clipper.clipSuccess", { title: state.extracted.title, images: 0 }),
            docId: res.document?.id,
          },
        });
        await refreshContext(settings, { lookupOnly: true });
        return;
      }

      const client = createClipperSdkClient({ serverUrl: settings.serverUrl, token: settings.token });
      const storedTemplates = await loadStoredClipperTemplates();
      const templates =
        storedTemplates && storedTemplates.length > 0 ? storedTemplates : BUILTIN_CLIPPER_TEMPLATES;
      const result = await executeUnifiedClip(client, {
        ...clipPayload,
        templates,
        preferTemplateDefaults: true,
        aiProvider: settings.aiProvider,
      });
      patch({
        status: {
          kind: "success",
          text: t("clipper.clipSuccess", {
            title: result.document?.title ?? state.extracted.title,
            images: result.mirroredImages,
          }),
          docId: result.document?.id,
        },
      });
      await refreshContext(settings, { lookupOnly: true });
    } catch (error) {
      if (isRetryableNetworkError(error)) {
        await enqueueOfflineAction({
          kind: "clip-page",
          label: state.extracted.title,
          payload: clipPayload,
          error,
        });
        setOfflineCount((c) => c + 1);
        patch({
          status: {
            kind: "success",
            text: t("clipper.clipQueuedOffline", { title: state.extracted.title }),
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
      patch({ clipping: false });
    }
  }, [isConfigured, patch, refreshContext, setOfflineCount, settings, t]);

  const handleQuickCreateHighlight = useCallback(async () => {
    const state = useSidePanelStore.getState();
    if (!state.selection || !isConfigured || state.creatingHighlight) return;
    patch({ creatingHighlight: true, status: null });
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
          tabId: state.activeTab?.id,
          article: state.extracted ?? undefined,
          title: state.extracted?.title ?? state.selection.title,
          spaceId: state.spaceId || settings.defaultSpaceId || undefined,
          tags: [...settings.defaultTags],
          existingDocumentId: state.lookup?.document?.id,
          anchor: state.selection,
          color: settings.highlightColor,
          noteMarkdown: "",
        });
        if (!res?.ok) throw new Error(res?.error || t("common.unknownError"));
        if (res.queued) setOfflineCount((c) => c + 1);
        patch({
          status: {
            kind: "success",
            text:
              res.message || t("clipper.highlightSuccess", { title: state.extracted?.title ?? "" }),
            docId: res.documentId ? asDocumentId(res.documentId) : undefined,
          },
        });
        await refreshContext(settings, { lookupOnly: true });
      }
    } catch (err) {
      patch({
        status: {
          kind: "error",
          text: t("clipper.highlightFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      });
    } finally {
      patch({ creatingHighlight: false });
    }
  }, [isConfigured, patch, refreshContext, setOfflineCount, settings, t]);

  const broadcastHighlightsToTab = useCallback(
    async (docId: string | undefined, items: readonly DocumentHighlight[]) => {
      const tabId = useSidePanelStore.getState().activeTab?.id;
      const ext = getWebExt();
      if (!tabId || !ext?.tabs) return;
      if (ext.scripting) {
        await ext.scripting
          .executeScript({ target: { tabId }, files: ["content-page-ui.js"] })
          .catch(() => {});
      }
      await ext.tabs
        .sendMessage(tabId, {
          type: "INKADE_RENDER_HIGHLIGHTS",
          documentId: docId,
          highlights: items,
        })
        .catch(() => {});
    },
    [],
  );

  const handleLocateHighlight = useCallback(async (highlightId: HighlightId) => {
    const state = useSidePanelStore.getState();
    const tabId = state.activeTab?.id;
    const ext = getWebExt();
    if (!tabId || !ext?.tabs) return;
    if (ext.scripting) {
      await ext.scripting
        .executeScript({ target: { tabId }, files: ["content-page-ui.js"] })
        .catch(() => {});
    }
    if (state.lookup?.highlights) {
      await ext.tabs
        .sendMessage(tabId, {
          type: "INKADE_RENDER_HIGHLIGHTS",
          documentId: state.lookup.document?.id,
          highlights: state.lookup.highlights,
        })
        .catch(() => {});
    }
    await ext.tabs
      .sendMessage(tabId, { type: "INKADE_SCROLL_TO_HIGHLIGHT", highlightId })
      .catch(() => {});
  }, []);

  const handleUpdateHighlight = useCallback(
    async (
      highlightId: HighlightId,
      patchInput: { readonly color?: HighlightColor; readonly noteMarkdown?: string },
      options?: { readonly silentToast?: boolean },
    ) => {
      const state = useSidePanelStore.getState();
      if (!isConfigured || !state.lookup) return;
      const setSaveState = (next: NoteSaveState) =>
        patch({
          noteSaveStates: { ...useSidePanelStore.getState().noteSaveStates, [highlightId]: next },
        });
      patch({ busyHlId: highlightId });
      if (patchInput.noteMarkdown !== undefined) setSaveState("saving");
      try {
        const client = createClipperSdkClient({ serverUrl: settings.serverUrl, token: settings.token });
        const updated = await client.highlights.update(highlightId, patchInput);
        const currentLookup = useSidePanelStore.getState().lookup;
        if (currentLookup) {
          const nextHighlights = currentLookup.highlights.map((h) =>
            h.id === highlightId ? updated : h,
          );
          patch({ lookup: { ...currentLookup, highlights: nextHighlights } });
          await broadcastHighlightsToTab(currentLookup.document?.id, nextHighlights);
        }
        if (patchInput.noteMarkdown !== undefined) {
          dirtyNoteIdsRef.current.delete(highlightId);
          setSaveState("saved");
        }
        if (!options?.silentToast) {
          patch({ status: { kind: "success", text: t("clipper.highlightUpdated") } });
        }
      } catch (err) {
        if (patchInput.noteMarkdown !== undefined) setSaveState("dirty");
        patch({
          status: {
            kind: "error",
            text: t("clipper.highlightFailed", {
              error: err instanceof Error ? err.message : String(err),
            }),
          },
        });
      } finally {
        patch({ busyHlId: null });
      }
    },
    [broadcastHighlightsToTab, isConfigured, patch, settings.serverUrl, settings.token, t],
  );

  const handleNoteInputChange = useCallback(
    (highlightId: HighlightId, nextValue: string) => {
      const state = useSidePanelStore.getState();
      dirtyNoteIdsRef.current.add(highlightId);
      patch({
        noteDrafts: { ...state.noteDrafts, [highlightId]: nextValue },
        noteSaveStates: { ...state.noteSaveStates, [highlightId]: "dirty" },
      });

      const prior = noteSaveTimersRef.current.get(highlightId);
      if (prior) clearTimeout(prior);
      const timer = setTimeout(() => {
        noteSaveTimersRef.current.delete(highlightId);
        void handleUpdateHighlight(highlightId, { noteMarkdown: nextValue }, { silentToast: true });
      }, 700);
      noteSaveTimersRef.current.set(highlightId, timer);
    },
    [handleUpdateHighlight, patch],
  );

  const flushHighlightNoteNow = useCallback(
    (highlightId: HighlightId) => {
      const pendingTimer = noteSaveTimersRef.current.get(highlightId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        noteSaveTimersRef.current.delete(highlightId);
      }
      const noteMarkdown = useSidePanelStore.getState().noteDrafts[highlightId] ?? "";
      void handleUpdateHighlight(highlightId, { noteMarkdown }, { silentToast: true });
    },
    [handleUpdateHighlight],
  );

  const handleDeleteHighlightWithUndo = useCallback(
    async (hl: DocumentHighlight) => {
      const state = useSidePanelStore.getState();
      if (!isConfigured || !state.lookup) return;
      await commitPendingDeleteImmediately();

      const currentLookup = useSidePanelStore.getState().lookup;
      if (!currentLookup) return;
      const remaining = currentLookup.highlights.filter((item) => item.id !== hl.id);
      pendingDeleteRef.current = hl;
      patch({
        lookup: { ...currentLookup, highlights: remaining },
        pendingDeleteHl: hl,
      });
      await broadcastHighlightsToTab(currentLookup.document?.id, remaining);

      pendingDeleteTimerRef.current = setTimeout(() => {
        void commitPendingDeleteImmediately();
      }, 5000);
    },
    [broadcastHighlightsToTab, commitPendingDeleteImmediately, isConfigured, patch],
  );

  const handleUndoDeleteHighlight = useCallback(async () => {
    const hl = pendingDeleteRef.current;
    const currentLookup = useSidePanelStore.getState().lookup;
    if (!hl || !currentLookup) return;
    pendingDeleteRef.current = null;
    if (pendingDeleteTimerRef.current) {
      clearTimeout(pendingDeleteTimerRef.current);
      pendingDeleteTimerRef.current = null;
    }
    const restored = [hl, ...currentLookup.highlights];
    patch({
      pendingDeleteHl: null,
      lookup: { ...currentLookup, highlights: restored },
    });
    await broadcastHighlightsToTab(currentLookup.document?.id, restored);
  }, [broadcastHighlightsToTab, patch]);

  const handleAppendRelatedToDaily = useCallback(
    async (hit: { readonly documentId: string; readonly title: string }) => {
      if (!isConfigured) return;
      try {
        const client = createClipperSdkClient({ serverUrl: settings.serverUrl, token: settings.token });
        await appendClipToDaily(client, {
          title: hit.title,
          url: resolveWebAppDocUrl(settings, hit.documentId),
          documentId: hit.documentId,
          customMarkdown: `- [[${hit.title}]]`,
        });
        patch({
          status: { kind: "success", text: t("clipper.sidePanelAppendedDaily", { title: hit.title }) },
        });
      } catch (err) {
        patch({
          status: {
            kind: "error",
            text: t("clipper.clipFailed", {
              error: err instanceof Error ? err.message : String(err),
            }),
          },
        });
      }
    },
    [isConfigured, patch, settings, t],
  );

  const handleDispatchAde = useCallback(async () => {
    const state = useSidePanelStore.getState();
    if (!isConfigured || state.adeSubmitting) return;
    const targetUrl = state.extracted?.url || state.activeTab?.url;
    if (!targetUrl) return;
    const targetTitle = state.extracted?.title || state.activeTab?.title || targetUrl;
    const promptText = state.adePrompt.trim() || t("clipper.adePresetSummarize");

    patch({ adeSubmitting: true, status: null });
    const adePayload = {
      url: targetUrl,
      title: targetTitle,
      spaceId: state.spaceId || settings.defaultSpaceId || undefined,
      tags: [...settings.defaultTags],
      extracted: state.extracted ?? undefined,
      existingDocumentId: state.lookup?.document?.id,
      adeKind: state.adeKind,
      prompt: promptText,
      selectionAnchor: state.adeIncludeSelection && state.selection ? state.selection : undefined,
      appendToDaily: state.adeAppendDaily,
    };

    try {
      const client = createClipperSdkClient({ serverUrl: settings.serverUrl, token: settings.token });
      const res = await dispatchClipToAde(client, adePayload);
      patch({
        adePrompt: "",
        status: {
          kind: "success",
          text: t("clipper.sidePanelAdeDispatched", { ade: getAdeHostLabel(t, state.adeKind) }),
          docId: res.document.id,
        },
      });
      await refreshContext(settings, { lookupOnly: true });
    } catch (err) {
      if (isRetryableNetworkError(err)) {
        await enqueueOfflineAction({
          kind: "dispatch-ade",
          label: targetTitle,
          payload: adePayload,
          error: err,
        });
        setOfflineCount((c) => c + 1);
        patch({
          status: { kind: "success", text: t("clipper.clipQueuedOffline", { title: targetTitle }) },
        });
      } else {
        patch({
          status: {
            kind: "error",
            text: t("clipper.clipFailed", {
              error: err instanceof Error ? err.message : String(err),
            }),
          },
        });
      }
    } finally {
      patch({ adeSubmitting: false });
    }
  }, [isConfigured, patch, refreshContext, setOfflineCount, settings, t]);

  return {
    isConfigured,
    refreshContext,
    loadRelatedForQuery,
    handleFlushOffline,
    handleQuickClip,
    handleQuickCreateHighlight,
    handleLocateHighlight,
    handleUpdateHighlight,
    handleNoteInputChange,
    flushHighlightNoteNow,
    handleDeleteHighlightWithUndo,
    handleUndoDeleteHighlight,
    handleAppendRelatedToDaily,
    handleDispatchAde,
  };
}
