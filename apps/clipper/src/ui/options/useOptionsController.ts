import { zodResolver } from "@hookform/resolvers/zod";
import {
  type AdeKind,
  DEFAULT_HOST_KIND,
  type HighlightColor,
  type Space,
  type SpaceId,
} from "@inkade/core";
import {
  setInkadeLocale,
  useInkadeLocale,
  useInkadeTranslation,
  type InkadeLocale,
} from "@inkade/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { AI_PROVIDER_PRESETS, testAiProviderConnection } from "../../core/interpreter.ts";
import {
  clearOfflineQueue,
  flushOfflineQueue,
  removeOfflineQueueItem,
  retryOfflineQueueItem,
} from "../../core/offline-queue.ts";
import {
  createClipperSdkClient,
  probeLocalInkadeServers,
  resolveClipperConnection,
  type ClipperConnectionInfo,
} from "../../core/sync.ts";
import {
  DEFAULT_AI_PROVIDER,
  DEFAULT_CLIPPER_SETTINGS,
  loadCachedWorkspaceTags,
  loadClipperSettings,
  loadOfflineQueueItems,
  normalizeServerUrl,
  saveClipperSettings,
  type ClipExtractionMode,
  type ClipperAccentPreset,
  type ClipperAiProviderKind,
  type ClipperOfflineQueueItem,
  type ClipperReaderTheme,
  type ClipperSettings,
  type ClipperSurfaceTheme,
} from "../../shared/storage.ts";
import type { TagSuggestionItem } from "../TagChipsInput.tsx";
import type { ClipperUiStatus } from "../shared/clipper-ui-helpers.ts";
import { useClipperThemeAndStorageSync } from "../shared/useSettingsSync.ts";

export interface ConnectionFormValues {
  serverUrl: string;
  webAppUrl: string;
  token: string;
}

export interface AiFormValues {
  aiEnabled: boolean;
  aiKind: ClipperAiProviderKind;
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
}

export interface OptionsCaptureState {
  defaultSpaceId: SpaceId | "";
  defaultTags: string[];
  clipMode: ClipExtractionMode;
  mirrorImages: boolean;
  autoMirrorImagesAsync: boolean;
  compressImagesToWebp: boolean;
  saveHtmlSnapshot: boolean;
  highlightColor: HighlightColor;
  showFloatingToolbar: boolean;
  autoRestoreHighlights: boolean;
  defaultAppendToDaily: boolean;
  defaultAdeKind: AdeKind;
  autoClosePopupOnClip: boolean;
  readerTheme: ClipperReaderTheme;
  readerFontSize: number;
  surfaceTheme: ClipperSurfaceTheme;
  accentPreset: ClipperAccentPreset;
  selectedLocale: InkadeLocale;
}

const INITIAL_CAPTURE_STATE: OptionsCaptureState = {
  defaultSpaceId: "",
  defaultTags: [],
  clipMode: "client-dom",
  mirrorImages: true,
  autoMirrorImagesAsync: true,
  compressImagesToWebp: false,
  saveHtmlSnapshot: true,
  highlightColor: "amber",
  showFloatingToolbar: true,
  autoRestoreHighlights: true,
  defaultAppendToDaily: false,
  defaultAdeKind: DEFAULT_HOST_KIND,
  autoClosePopupOnClip: false,
  readerTheme: "sepia",
  readerFontSize: 17,
  surfaceTheme: "system",
  accentPreset: "mono",
  selectedLocale: "zh-CN",
};

export function useOptionsController() {
  const { t } = useInkadeTranslation();
  const { setLocale } = useInkadeLocale();

  const connectionSchema = useMemo(
    () =>
      z.object({
        serverUrl: z
          .string()
          .trim()
          .min(1, t("validation.required"))
          .refine(
            (val) => {
              const normalized = normalizeServerUrl(val);
              return Boolean(normalized && z.url().safeParse(normalized).success);
            },
            { message: t("validation.urlInvalid") },
          ),
        webAppUrl: z
          .string()
          .refine(
            (val) => !val.trim() || z.url().safeParse(normalizeServerUrl(val)).success,
            { message: t("validation.urlInvalid") },
          ),
        token: z.string(),
      }),
    [t],
  );

  const aiSchema = useMemo(
    () =>
      z.object({
        aiEnabled: z.boolean(),
        aiKind: z.enum(["openai-compatible", "anthropic", "gemini"]),
        aiBaseUrl: z
          .string()
          .refine(
            (val) => !val.trim() || z.url().safeParse(normalizeServerUrl(val)).success,
            { message: t("validation.urlInvalid") },
          ),
        aiModel: z.string(),
        aiApiKey: z.string(),
      }),
    [t],
  );

  const connectionForm = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionSchema),
    defaultValues: {
      serverUrl: DEFAULT_CLIPPER_SETTINGS.serverUrl,
      webAppUrl: "",
      token: "",
    },
  });
  const {
    reset: resetConnectionForm,
    getValues: getConnectionValues,
    setValue: setConnectionValue,
  } = connectionForm;

  const aiForm = useForm<AiFormValues>({
    resolver: zodResolver(aiSchema),
    defaultValues: {
      aiEnabled: false,
      aiKind: DEFAULT_AI_PROVIDER.kind,
      aiBaseUrl: DEFAULT_AI_PROVIDER.baseUrl,
      aiModel: DEFAULT_AI_PROVIDER.model,
      aiApiKey: "",
    },
  });
  const { reset: resetAiForm, getValues: getAiValues, setValue: setAiValue } = aiForm;

  const watchedServerUrl = useWatch({ control: connectionForm.control, name: "serverUrl" });
  const watchedToken = useWatch({ control: connectionForm.control, name: "token" });

  const [capture, setCapture] = useState<OptionsCaptureState>(INITIAL_CAPTURE_STATE);
  const [spaces, setSpaces] = useState<readonly Space[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<readonly TagSuggestionItem[]>([]);
  const [connInfo, setConnInfo] = useState<ClipperConnectionInfo | null>(null);
  const [testing, setTesting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<readonly ClipperOfflineQueueItem[]>([]);
  const [flushingQueue, setFlushingQueue] = useState(false);
  const [busyQueueId, setBusyQueueId] = useState<string | null>(null);
  const [status, setStatus] = useState<ClipperUiStatus | null>(null);

  const hydrateFromSettings = useCallback(
    async (loaded: ClipperSettings) => {
      resetConnectionForm({
        serverUrl: loaded.serverUrl,
        webAppUrl: loaded.webAppUrl,
        token: loaded.token,
      });
      setCapture({
        defaultSpaceId: loaded.defaultSpaceId,
        defaultTags: [...loaded.defaultTags],
        clipMode: loaded.clipMode,
        mirrorImages: loaded.mirrorImages,
        autoMirrorImagesAsync: loaded.autoMirrorImagesAsync,
        compressImagesToWebp: loaded.compressImagesToWebp,
        saveHtmlSnapshot: loaded.saveHtmlSnapshot,
        highlightColor: loaded.highlightColor,
        showFloatingToolbar: loaded.showFloatingToolbar,
        autoRestoreHighlights: loaded.autoRestoreHighlights,
        defaultAppendToDaily: loaded.defaultAppendToDaily,
        defaultAdeKind: loaded.defaultAdeKind,
        autoClosePopupOnClip: loaded.autoClosePopupOnClip,
        readerTheme: loaded.readerTheme,
        readerFontSize: loaded.readerFontSize,
        surfaceTheme: loaded.surfaceTheme,
        accentPreset: loaded.accentPreset,
        selectedLocale: loaded.locale,
      });
      setLocale(loaded.locale);
      resetAiForm({
        aiEnabled: loaded.aiProvider.enabled,
        aiKind: loaded.aiProvider.kind,
        aiBaseUrl: loaded.aiProvider.baseUrl,
        aiModel: loaded.aiProvider.model,
        aiApiKey: loaded.aiProvider.apiKey,
      });

      if (loaded.serverUrl && loaded.token) {
        try {
          const client = createClipperSdkClient({
            serverUrl: loaded.serverUrl,
            token: loaded.token,
          });
          const conn = await resolveClipperConnection(client);
          setConnInfo(conn);
          setSpaces(conn.visibleSpaces.filter((s) => s.archivedAt === null));
        } catch {
          // ignore background refresh error
        }
      }
    },
    [resetAiForm, resetConnectionForm, setLocale],
  );

  const refreshQueueItems = useCallback(async () => {
    setOfflineQueue(await loadOfflineQueueItems());
  }, []);

  useClipperThemeAndStorageSync({
    surfaceThemeOverride: capture.surfaceTheme,
    accentPresetOverride: capture.accentPreset,
    onSettingsExternalChange: hydrateFromSettings,
    onOfflineQueueExternalChange: refreshQueueItems,
  });

  useEffect(() => {
    void (async () => {
      const [loaded, queueItems, cachedTags] = await Promise.all([
        loadClipperSettings(),
        loadOfflineQueueItems(),
        loadCachedWorkspaceTags(),
      ]);
      setOfflineQueue(queueItems);
      if (cachedTags?.tags) setTagSuggestions(cachedTags.tags);
      await hydrateFromSettings(loaded);
    })();
  }, [hydrateFromSettings]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setStatus(null);
    try {
      const { serverUrl, token } = getConnectionValues();
      const client = createClipperSdkClient({
        serverUrl: normalizeServerUrl(serverUrl),
        token: token.trim(),
      });
      const conn = await resolveClipperConnection(client);
      setConnInfo(conn);
      setSpaces(conn.visibleSpaces.filter((s) => s.archivedAt === null));
      if (!capture.defaultSpaceId && conn.defaultSpaceId) {
        setCapture((prev) => ({ ...prev, defaultSpaceId: prev.defaultSpaceId || conn.defaultSpaceId }));
      }
      setStatus({
        kind: "success",
        text: t("clipper.connectionOk", {
          tokenName: conn.tokenName,
          permission: conn.scopeSummary.permission,
          spacesCount: conn.visibleSpaces.length,
        }),
      });
    } catch (error) {
      setConnInfo(null);
      setStatus({
        kind: "error",
        text: t("clipper.connectionFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setTesting(false);
    }
  }, [capture.defaultSpaceId, getConnectionValues, t]);

  const handleProbeLocalServer = useCallback(async () => {
    setProbing(true);
    setStatus(null);
    try {
      const found = await probeLocalInkadeServers();
      if (found) {
        setConnectionValue("serverUrl", found.serverUrl, {
          shouldDirty: true,
          shouldValidate: true,
        });
        setStatus({ kind: "success", text: t("clipper.probeLocalFound", { url: found.serverUrl }) });
      } else {
        setStatus({ kind: "error", text: t("clipper.probeLocalNotFound") });
      }
    } finally {
      setProbing(false);
    }
  }, [setConnectionValue, t]);

  const saveAllSettings = useCallback(async () => {
    const connValues = getConnectionValues();
    const aiValues = getAiValues();
    const saved = await saveClipperSettings({
      serverUrl: normalizeServerUrl(connValues.serverUrl),
      webAppUrl: normalizeServerUrl(connValues.webAppUrl),
      token: connValues.token.trim(),
      defaultSpaceId: capture.defaultSpaceId,
      defaultTags: capture.defaultTags,
      clipMode: capture.clipMode,
      mirrorImages: capture.mirrorImages,
      autoMirrorImagesAsync: capture.autoMirrorImagesAsync,
      compressImagesToWebp: capture.compressImagesToWebp,
      saveHtmlSnapshot: capture.saveHtmlSnapshot,
      highlightColor: capture.highlightColor,
      showFloatingToolbar: capture.showFloatingToolbar,
      autoRestoreHighlights: capture.autoRestoreHighlights,
      defaultAppendToDaily: capture.defaultAppendToDaily,
      defaultAdeKind: capture.defaultAdeKind,
      autoClosePopupOnClip: capture.autoClosePopupOnClip,
      readerTheme: capture.readerTheme,
      readerFontSize: capture.readerFontSize,
      surfaceTheme: capture.surfaceTheme,
      accentPreset: capture.accentPreset,
      locale: capture.selectedLocale,
      aiProvider: {
        enabled: aiValues.aiEnabled,
        kind: aiValues.aiKind,
        baseUrl: normalizeServerUrl(aiValues.aiBaseUrl),
        model: aiValues.aiModel.trim(),
        apiKey: aiValues.aiApiKey.trim(),
      },
    });
    setInkadeLocale(saved.locale);
    setLocale(saved.locale);
    setStatus({ kind: "success", text: t("clipper.settingsSavedToast") });
  }, [capture, getAiValues, getConnectionValues, setLocale, t]);

  const handleConnectionSubmit = useMemo(
    () => connectionForm.handleSubmit(saveAllSettings),
    [connectionForm, saveAllSettings],
  );

  const handleAiSubmit = useMemo(
    () => aiForm.handleSubmit(saveAllSettings),
    [aiForm, saveAllSettings],
  );

  const updateCapturePatch = useCallback(
    async <K extends keyof OptionsCaptureState>(
      capturePatch: Pick<OptionsCaptureState, K> | Partial<OptionsCaptureState>,
      settingsPatch: Partial<ClipperSettings>,
    ) => {
      setCapture((prev) => ({ ...prev, ...capturePatch }));
      const saved = await saveClipperSettings(settingsPatch);
      setInkadeLocale(saved.locale);
      setLocale(saved.locale);
      setStatus({ kind: "success", text: t("clipper.settingsAutoSavedToast") });
    },
    [setLocale, t],
  );

  const handleAiProviderChange = useCallback(
    (nextKind: ClipperAiProviderKind) => {
      const { aiKind, aiBaseUrl, aiModel } = getAiValues();
      const prevPreset = AI_PROVIDER_PRESETS[aiKind];
      const nextPreset = AI_PROVIDER_PRESETS[nextKind];
      setAiValue("aiKind", nextKind, { shouldDirty: true });
      if (!aiBaseUrl.trim() || normalizeServerUrl(aiBaseUrl) === prevPreset.baseUrl) {
        setAiValue("aiBaseUrl", nextPreset.baseUrl, { shouldDirty: true, shouldValidate: true });
      }
      if (!aiModel.trim() || aiModel.trim() === prevPreset.model) {
        setAiValue("aiModel", nextPreset.model, { shouldDirty: true });
      }
    },
    [getAiValues, setAiValue],
  );

  const handleTestAi = useCallback(async () => {
    setTestingAi(true);
    setStatus(null);
    try {
      const { aiKind, aiBaseUrl, aiModel, aiApiKey } = getAiValues();
      await testAiProviderConnection({
        enabled: true,
        kind: aiKind,
        baseUrl: normalizeServerUrl(aiBaseUrl),
        model: aiModel.trim(),
        apiKey: aiApiKey.trim(),
      });
      setStatus({ kind: "success", text: t("clipper.aiTestSuccess") });
    } catch (error) {
      setStatus({
        kind: "error",
        text: t("clipper.aiEnrichFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setTestingAi(false);
    }
  }, [getAiValues, t]);

  const buildClientFromForm = useCallback(() => {
    const { serverUrl, token } = getConnectionValues();
    return createClipperSdkClient({
      serverUrl: normalizeServerUrl(serverUrl),
      token: token.trim(),
    });
  }, [getConnectionValues]);

  const handleFlushQueue = useCallback(async () => {
    setFlushingQueue(true);
    try {
      const res = await flushOfflineQueue(buildClientFromForm());
      setOfflineQueue(await loadOfflineQueueItems());
      setStatus({
        kind: res.remaining > 0 && res.lastError ? "error" : "success",
        text: t("clipper.offlineQueueFlushed", {
          synced: res.synced,
          remaining: res.remaining,
        }),
      });
    } finally {
      setFlushingQueue(false);
    }
  }, [buildClientFromForm, t]);

  const handleRetryQueueItem = useCallback(
    async (id: string) => {
      setBusyQueueId(id);
      try {
        const res = await retryOfflineQueueItem(buildClientFromForm(), id);
        setOfflineQueue(await loadOfflineQueueItems());
        setStatus({
          kind: res.synced ? "success" : "error",
          text: res.synced
            ? t("clipper.offlineQueueFlushed", { synced: 1, remaining: res.remaining })
            : res.error || t("common.unknownError"),
        });
      } finally {
        setBusyQueueId(null);
      }
    },
    [buildClientFromForm, t],
  );

  const handleClearQueue = useCallback(async () => {
    await clearOfflineQueue();
    setOfflineQueue([]);
  }, []);

  const handleRemoveQueueItem = useCallback(async (id: string) => {
    const next = await removeOfflineQueueItem(id);
    setOfflineQueue(next);
  }, []);

  const hasValidCredentials = Boolean(watchedServerUrl.trim() && watchedToken.trim());

  return {
    connectionForm,
    aiForm,
    watchedServerUrl,
    watchedToken,
    hasValidCredentials,
    capture,
    spaces,
    tagSuggestions,
    connInfo,
    testing,
    probing,
    testingAi,
    offlineQueue,
    flushingQueue,
    busyQueueId,
    status,
    getConnectionValues,
    buildClientFromForm,
    handleTestConnection,
    handleProbeLocalServer,
    handleConnectionSubmit,
    handleAiSubmit,
    updateCapturePatch,
    handleAiProviderChange,
    handleTestAi,
    handleFlushQueue,
    handleRetryQueueItem,
    handleClearQueue,
    handleRemoveQueueItem,
  };
}
