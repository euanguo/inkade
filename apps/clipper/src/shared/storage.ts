import type { ExtractedArticle } from "@inkade/clipper-core/extractor";
import {
  type AdeKind,
  asSpaceId,
  clipperTemplateSchema,
  type ClipperTemplate,
  type ClipperTemplateBehavior,
  DEFAULT_HOST_KIND,
  type DocumentId,
  type HighlightColor,
  normalizeHostKind,
  type SpaceId,
} from "@inkade/core";
import { DEFAULT_LOCALE, normalizeInkadeLocale, type InkadeLocale } from "@inkade/i18n";
import { getWebExt, type WebExtStorageArea } from "./webext.ts";

export type ClipExtractionMode = "client-dom" | "server-ingest";
export type ClipperAiProviderKind = "openai-compatible" | "anthropic" | "gemini";
export type ClipperReaderTheme = "light" | "sepia" | "dark";
export type ClipperSurfaceTheme = "system" | "light" | "light-dimmed" | "dark" | "dark-dimmed";
export type ClipperAccentPreset = "mono" | "indigo" | "sage" | "terracotta";

export interface ClipperAiProviderConfig {
  readonly enabled: boolean;
  readonly kind: ClipperAiProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export interface ClipperSettings {
  readonly serverUrl: string;
  readonly webAppUrl: string;
  readonly token: string;
  readonly defaultSpaceId: SpaceId | "";
  readonly defaultTags: readonly string[];
  readonly clipMode: ClipExtractionMode;
  readonly mirrorImages: boolean;
  readonly autoMirrorImagesAsync: boolean;
  readonly compressImagesToWebp: boolean;
  readonly saveHtmlSnapshot: boolean;
  readonly highlightColor: HighlightColor;
  readonly showFloatingToolbar: boolean;
  readonly autoRestoreHighlights: boolean;
  readonly defaultAppendToDaily: boolean;
  readonly defaultAdeKind: AdeKind;
  readonly autoClosePopupOnClip: boolean;
  readonly readerTheme: ClipperReaderTheme;
  readonly readerFontSize: number;
  readonly surfaceTheme: ClipperSurfaceTheme;
  readonly accentPreset: ClipperAccentPreset;
  readonly locale: InkadeLocale;
  readonly aiProvider: ClipperAiProviderConfig;
}

export interface ClipPageOfflinePayload {
  readonly extracted: ExtractedArticle;
  readonly spaceId?: SpaceId | undefined;
  readonly title?: string | undefined;
  readonly markdownOverride?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly properties?: Record<string, unknown> | null | undefined;
  readonly existingDocumentId?: DocumentId | undefined;
  readonly updateMetadataOnly?: boolean | undefined;
  readonly mode?: ClipExtractionMode | undefined;
  readonly mirrorImages?: boolean | undefined;
  readonly asyncMirror?: boolean | undefined;
  readonly compressWebp?: boolean | undefined;
  readonly saveHtmlSnapshot?: boolean | undefined;
  readonly appendToDaily?: boolean | undefined;
  readonly dailyLineOverride?: string | undefined;
  readonly tabId?: number | undefined;
  readonly templateBehavior?: ClipperTemplateBehavior | undefined;
}

export interface SaveHighlightOfflinePayload {
  readonly url: string;
  readonly title?: string | undefined;
  readonly spaceId?: SpaceId | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly extracted?: ExtractedArticle | undefined;
  readonly existingDocumentId?: DocumentId | undefined;
  readonly mirrorImages?: boolean | undefined;
  readonly saveHtmlSnapshot?: boolean | undefined;
  readonly compressWebp?: boolean | undefined;
  readonly anchor: {
    readonly quote: string;
    readonly prefixContext?: string | undefined;
    readonly suffixContext?: string | undefined;
  };
  readonly color?: HighlightColor | undefined;
  readonly noteMarkdown?: string | undefined;
}

export interface AppendDailyOfflinePayload {
  readonly title: string;
  readonly url: string;
  readonly documentId: string;
  readonly customMarkdown?: string | undefined;
  readonly date?: string | undefined;
}

export interface DispatchAdeOfflinePayload {
  readonly url: string;
  readonly title?: string | undefined;
  readonly spaceId?: SpaceId | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly extracted?: ExtractedArticle | undefined;
  readonly existingDocumentId?: DocumentId | undefined;
  readonly adeKind: AdeKind;
  readonly prompt: string;
  readonly selectionAnchor?:
    | {
        readonly quote: string;
        readonly prefixContext?: string | undefined;
        readonly suffixContext?: string | undefined;
      }
    | undefined;
  readonly appendToDaily?: boolean | undefined;
}

export interface IngestUrlOfflinePayload {
  readonly url: string;
  readonly spaceId?: SpaceId | undefined;
  readonly title?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly mirrorImages?: boolean | undefined;
  readonly compressWebp?: boolean | undefined;
  readonly saveHtmlSnapshot?: boolean | undefined;
  readonly appendToDaily?: boolean | undefined;
}

export interface ClipperOfflineQueueItemBase {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly attempts: number;
  readonly lastError?: string | undefined;
}

export type ClipperOfflineQueueItem = ClipperOfflineQueueItemBase &
  (
    | { readonly kind: "clip-page"; readonly payload: ClipPageOfflinePayload }
    | { readonly kind: "save-highlight"; readonly payload: SaveHighlightOfflinePayload }
    | { readonly kind: "append-daily"; readonly payload: AppendDailyOfflinePayload }
    | { readonly kind: "dispatch-ade"; readonly payload: DispatchAdeOfflinePayload }
    | { readonly kind: "ingest-url"; readonly payload: IngestUrlOfflinePayload }
  );

export interface PendingPairingSession {
  readonly nonce: string;
  readonly expectedOrigin: string;
  readonly createdAt: number;
}

export interface CachedWorkspaceTags {
  readonly tags: readonly { readonly tag: string; readonly count: number }[];
  readonly fetchedAt: number;
}

export interface PopupDraft {
  readonly url: string;
  readonly title: string;
  readonly tagsCsv: string;
  readonly spaceId: SpaceId | "";
  readonly highlightNote: string;
  readonly aiSummary: string;
  readonly savedAt: number;
}

export const CLIPPER_STORAGE_KEY = "inkade:clipper:settings";
export const CLIPPER_LOCAL_SECRETS_KEY = "inkade:clipper:local-secrets";
export const CLIPPER_TEMPLATES_KEY = "inkade:clipper:templates";
export const CLIPPER_OFFLINE_QUEUE_KEY = "inkade:clipper:offline-queue";
export const CLIPPER_PENDING_PAIRING_KEY = "inkade:clipper:pending-pairing";
export const CLIPPER_TAG_CACHE_KEY = "inkade:clipper:tag-cache";
export const CLIPPER_POPUP_DRAFT_KEY = "inkade:clipper:popup-draft";

const PAIRING_SESSION_TTL_MS = 5 * 60 * 1000;
const POPUP_DRAFT_TTL_MS = 10 * 60 * 1000;

export const DEFAULT_AI_PROVIDER: ClipperAiProviderConfig = {
  enabled: false,
  kind: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
};

export const DEFAULT_CLIPPER_SETTINGS: ClipperSettings = {
  serverUrl: "http://127.0.0.1:4100",
  webAppUrl: "",
  token: "",
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
  locale: DEFAULT_LOCALE,
  aiProvider: DEFAULT_AI_PROVIDER,
};

export function normalizeServerUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function resolveWebAppBaseUrl(settings: Pick<ClipperSettings, "serverUrl" | "webAppUrl">): string {
  const web = normalizeServerUrl(settings.webAppUrl);
  if (web) return web;
  return normalizeServerUrl(settings.serverUrl);
}

export function resolveWebAppDocUrl(
  settings: Pick<ClipperSettings, "serverUrl" | "webAppUrl">,
  docId: string,
): string {
  const base = resolveWebAppBaseUrl(settings);
  return `${base}/docs/${encodeURIComponent(docId)}`;
}

export function parseTagsCsv(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(/[,，]/)) {
    const cleaned = part.trim().replace(/^#+/, "");
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      tags.push(cleaned);
    }
  }
  return tags;
}

export function formatTagsCsv(tags: readonly string[]): string {
  return tags.join(", ");
}

function getSyncOrLocalArea(): WebExtStorageArea | null {
  const ext = getWebExt();
  return ext?.storage?.sync ?? ext?.storage?.local ?? null;
}

function getLocalOnlyArea(): WebExtStorageArea | null {
  const ext = getWebExt();
  return ext?.storage?.local ?? null;
}

function sanitizeAiProvider(
  raw: Partial<ClipperAiProviderConfig> | null | undefined,
  localApiKey?: string,
): ClipperAiProviderConfig {
  const kind: ClipperAiProviderKind =
    raw?.kind === "anthropic" || raw?.kind === "gemini" || raw?.kind === "openai-compatible"
      ? raw.kind
      : DEFAULT_AI_PROVIDER.kind;
  return {
    enabled: Boolean(raw?.enabled),
    kind,
    baseUrl:
      typeof raw?.baseUrl === "string" && raw.baseUrl.trim()
        ? normalizeServerUrl(raw.baseUrl)
        : DEFAULT_AI_PROVIDER.baseUrl,
    model:
      typeof raw?.model === "string" && raw.model.trim()
        ? raw.model.trim()
        : DEFAULT_AI_PROVIDER.model,
    apiKey:
      typeof localApiKey === "string"
        ? localApiKey.trim()
        : typeof raw?.apiKey === "string"
          ? raw.apiKey.trim()
          : "",
  };
}

function sanitizeSettings(
  raw: Partial<ClipperSettings> | null | undefined,
  localSecrets?: { token?: string; aiApiKey?: string } | null,
): ClipperSettings {
  if (!raw) {
    return {
      ...DEFAULT_CLIPPER_SETTINGS,
      ...(localSecrets?.token ? { token: localSecrets.token.trim() } : {}),
      aiProvider: sanitizeAiProvider(undefined, localSecrets?.aiApiKey),
    };
  }
  const highlightColor: HighlightColor =
    raw.highlightColor === "amber" ||
    raw.highlightColor === "emerald" ||
    raw.highlightColor === "blue" ||
    raw.highlightColor === "rose"
      ? raw.highlightColor
      : DEFAULT_CLIPPER_SETTINGS.highlightColor;
  const clipMode: ClipExtractionMode =
    raw.clipMode === "server-ingest" || raw.clipMode === "client-dom"
      ? raw.clipMode
      : DEFAULT_CLIPPER_SETTINGS.clipMode;
  const defaultAdeKind: AdeKind = normalizeHostKind(raw.defaultAdeKind);
  const readerTheme: ClipperReaderTheme =
    raw.readerTheme === "light" || raw.readerTheme === "dark" || raw.readerTheme === "sepia"
      ? raw.readerTheme
      : DEFAULT_CLIPPER_SETTINGS.readerTheme;
  const surfaceTheme: ClipperSurfaceTheme =
    raw.surfaceTheme === "system" ||
    raw.surfaceTheme === "light" ||
    raw.surfaceTheme === "light-dimmed" ||
    raw.surfaceTheme === "dark" ||
    raw.surfaceTheme === "dark-dimmed"
      ? raw.surfaceTheme
      : DEFAULT_CLIPPER_SETTINGS.surfaceTheme;
  const accentPreset: ClipperAccentPreset =
    raw.accentPreset === "mono" ||
    raw.accentPreset === "indigo" ||
    raw.accentPreset === "sage" ||
    raw.accentPreset === "terracotta"
      ? raw.accentPreset
      : DEFAULT_CLIPPER_SETTINGS.accentPreset;
  const readerFontSize =
    typeof raw.readerFontSize === "number" && Number.isFinite(raw.readerFontSize)
      ? Math.max(13, Math.min(24, Math.round(raw.readerFontSize)))
      : DEFAULT_CLIPPER_SETTINGS.readerFontSize;

  return {
    serverUrl:
      typeof raw.serverUrl === "string" && raw.serverUrl.trim()
        ? normalizeServerUrl(raw.serverUrl)
        : DEFAULT_CLIPPER_SETTINGS.serverUrl,
    webAppUrl: typeof raw.webAppUrl === "string" ? normalizeServerUrl(raw.webAppUrl) : "",
    token:
      typeof raw.token === "string" && raw.token.trim()
        ? raw.token.trim()
        : typeof localSecrets?.token === "string"
          ? localSecrets.token.trim()
          : "",
    defaultSpaceId:
      typeof raw.defaultSpaceId === "string" && raw.defaultSpaceId.trim()
        ? asSpaceId(raw.defaultSpaceId)
        : "",
    defaultTags: Array.isArray(raw.defaultTags)
      ? raw.defaultTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : [],
    clipMode,
    mirrorImages:
      typeof raw.mirrorImages === "boolean"
        ? raw.mirrorImages
        : DEFAULT_CLIPPER_SETTINGS.mirrorImages,
    autoMirrorImagesAsync:
      typeof raw.autoMirrorImagesAsync === "boolean"
        ? raw.autoMirrorImagesAsync
        : DEFAULT_CLIPPER_SETTINGS.autoMirrorImagesAsync,
    compressImagesToWebp:
      typeof raw.compressImagesToWebp === "boolean"
        ? raw.compressImagesToWebp
        : DEFAULT_CLIPPER_SETTINGS.compressImagesToWebp,
    saveHtmlSnapshot:
      typeof raw.saveHtmlSnapshot === "boolean"
        ? raw.saveHtmlSnapshot
        : DEFAULT_CLIPPER_SETTINGS.saveHtmlSnapshot,
    highlightColor,
    showFloatingToolbar:
      typeof raw.showFloatingToolbar === "boolean"
        ? raw.showFloatingToolbar
        : DEFAULT_CLIPPER_SETTINGS.showFloatingToolbar,
    autoRestoreHighlights:
      typeof raw.autoRestoreHighlights === "boolean"
        ? raw.autoRestoreHighlights
        : DEFAULT_CLIPPER_SETTINGS.autoRestoreHighlights,
    defaultAppendToDaily:
      typeof raw.defaultAppendToDaily === "boolean"
        ? raw.defaultAppendToDaily
        : DEFAULT_CLIPPER_SETTINGS.defaultAppendToDaily,
    defaultAdeKind,
    autoClosePopupOnClip:
      typeof raw.autoClosePopupOnClip === "boolean"
        ? raw.autoClosePopupOnClip
        : DEFAULT_CLIPPER_SETTINGS.autoClosePopupOnClip,
    readerTheme,
    readerFontSize,
    surfaceTheme,
    accentPreset,
    locale: normalizeInkadeLocale(raw.locale),
    aiProvider: sanitizeAiProvider(raw.aiProvider, localSecrets?.aiApiKey),
  };
}

export async function loadClipperSettings(): Promise<ClipperSettings> {
  const area = getSyncOrLocalArea();
  const localArea = getLocalOnlyArea();

  let localSecrets: { token?: string; aiApiKey?: string } | null = null;
  if (localArea) {
    try {
      const secretData = await localArea.get(CLIPPER_LOCAL_SECRETS_KEY);
      const rawSecrets = secretData[CLIPPER_LOCAL_SECRETS_KEY] as
        | { token?: string; aiApiKey?: string }
        | undefined;
      if (rawSecrets && typeof rawSecrets === "object") {
        localSecrets = rawSecrets;
      }
    } catch {
      // ignore local secret lookup failure
    }
  } else if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = globalThis.localStorage.getItem(CLIPPER_LOCAL_SECRETS_KEY);
      if (raw) {
        localSecrets = JSON.parse(raw) as { token?: string; aiApiKey?: string };
      }
    } catch {
      // ignore
    }
  }

  if (area) {
    try {
      const data = await area.get(CLIPPER_STORAGE_KEY);
      const raw = data[CLIPPER_STORAGE_KEY] as Partial<ClipperSettings> | undefined;
      if (raw && typeof raw === "object") {
        return sanitizeSettings(raw, localSecrets);
      }
    } catch {
      // fall through to localStorage
    }
  }

  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const serialized = globalThis.localStorage.getItem(CLIPPER_STORAGE_KEY);
      if (serialized) {
        return sanitizeSettings(JSON.parse(serialized) as Partial<ClipperSettings>, localSecrets);
      }
    } catch {
      // ignore invalid JSON
    }
  }

  return sanitizeSettings(undefined, localSecrets);
}

export async function saveClipperSettings(
  next: Partial<ClipperSettings>,
): Promise<ClipperSettings> {
  const current = await loadClipperSettings();
  const mergedAi = next.aiProvider
    ? { ...current.aiProvider, ...next.aiProvider }
    : current.aiProvider;
  const merged = sanitizeSettings({ ...current, ...next, aiProvider: mergedAi });

  // Strip apiKey before persisting to sync storage; store secrets in local-only storage.
  const syncSafeSettings: ClipperSettings = {
    ...merged,
    aiProvider: {
      ...merged.aiProvider,
      apiKey: "",
    },
  };
  const localSecrets = {
    token: merged.token,
    aiApiKey: merged.aiProvider.apiKey,
  };

  const area = getSyncOrLocalArea();
  if (area) {
    try {
      await area.set({ [CLIPPER_STORAGE_KEY]: syncSafeSettings });
    } catch {
      // fallback below
    }
  }

  const localArea = getLocalOnlyArea();
  if (localArea) {
    try {
      await localArea.set({ [CLIPPER_LOCAL_SECRETS_KEY]: localSecrets });
    } catch {
      // ignore
    }
  }

  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.setItem(CLIPPER_STORAGE_KEY, JSON.stringify(syncSafeSettings));
      globalThis.localStorage.setItem(CLIPPER_LOCAL_SECRETS_KEY, JSON.stringify(localSecrets));
    } catch {
      // ignore storage quota errors
    }
  }

  return merged;
}

export async function loadStoredClipperTemplates(): Promise<ClipperTemplate[] | null> {
  const area = getSyncOrLocalArea();
  const parseList = (raw: unknown): ClipperTemplate[] | null => {
    if (!Array.isArray(raw)) return null;
    const valid: ClipperTemplate[] = [];
    for (const item of raw) {
      const parsed = clipperTemplateSchema.safeParse(item);
      if (parsed.success) valid.push(parsed.data);
    }
    return valid;
  };

  if (area) {
    try {
      const data = await area.get(CLIPPER_TEMPLATES_KEY);
      const parsed = parseList(data[CLIPPER_TEMPLATES_KEY]);
      if (parsed) return parsed;
    } catch {
      // fall through
    }
  }

  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = globalThis.localStorage.getItem(CLIPPER_TEMPLATES_KEY);
      if (raw) {
        return parseList(JSON.parse(raw));
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export async function saveStoredClipperTemplates(
  templates: readonly ClipperTemplate[],
): Promise<void> {
  const area = getSyncOrLocalArea();
  if (area) {
    try {
      await area.set({ [CLIPPER_TEMPLATES_KEY]: [...templates] });
    } catch {
      // ignore
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.setItem(CLIPPER_TEMPLATES_KEY, JSON.stringify(templates));
    } catch {
      // ignore
    }
  }
}

const VALID_QUEUE_KINDS = new Set<ClipperOfflineQueueItem["kind"]>([
  "clip-page",
  "save-highlight",
  "append-daily",
  "dispatch-ade",
  "ingest-url",
]);

function isValidOfflineQueueItem(value: unknown): value is ClipperOfflineQueueItem {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ClipperOfflineQueueItem>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    VALID_QUEUE_KINDS.has(candidate.kind) &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null
  );
}

export async function loadOfflineQueueItems(): Promise<ClipperOfflineQueueItem[]> {
  const localArea = getLocalOnlyArea();
  if (localArea) {
    try {
      const data = await localArea.get(CLIPPER_OFFLINE_QUEUE_KEY);
      const raw = data[CLIPPER_OFFLINE_QUEUE_KEY];
      if (Array.isArray(raw)) {
        return raw.filter(isValidOfflineQueueItem);
      }
    } catch {
      // fall through
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = globalThis.localStorage.getItem(CLIPPER_OFFLINE_QUEUE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter(isValidOfflineQueueItem);
        }
      }
    } catch {
      // ignore
    }
  }
  return [];
}

export async function saveOfflineQueueItems(
  items: readonly ClipperOfflineQueueItem[],
): Promise<void> {
  const localArea = getLocalOnlyArea();
  if (localArea) {
    try {
      await localArea.set({ [CLIPPER_OFFLINE_QUEUE_KEY]: [...items] });
    } catch {
      // ignore
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.setItem(CLIPPER_OFFLINE_QUEUE_KEY, JSON.stringify(items));
    } catch {
      // ignore
    }
  }
}

function getSessionOrLocalArea(): WebExtStorageArea | null {
  const ext = getWebExt();
  return ext?.storage?.session ?? ext?.storage?.local ?? null;
}

let nonceFallbackSeq = 0;

export function generateNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  nonceFallbackSeq += 1;
  return `pair_${Date.now().toString(36)}_${nonceFallbackSeq.toString(36)}`;
}

export async function savePendingPairingSession(session: PendingPairingSession): Promise<void> {
  const localArea = getLocalOnlyArea();
  if (localArea) {
    try {
      await localArea.set({ [CLIPPER_PENDING_PAIRING_KEY]: session });
    } catch {
      // ignore
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.setItem(CLIPPER_PENDING_PAIRING_KEY, JSON.stringify(session));
    } catch {
      // ignore
    }
  }
}

export async function loadPendingPairingSession(): Promise<PendingPairingSession | null> {
  const isValid = (raw: unknown): raw is PendingPairingSession => {
    if (!raw || typeof raw !== "object") return false;
    const obj = raw as Partial<PendingPairingSession>;
    if (typeof obj.nonce !== "string" || !obj.nonce.trim()) return false;
    if (typeof obj.expectedOrigin !== "string") return false;
    if (typeof obj.createdAt !== "number") return false;
    return Date.now() - obj.createdAt <= PAIRING_SESSION_TTL_MS;
  };

  const localArea = getLocalOnlyArea();
  if (localArea) {
    try {
      const data = await localArea.get(CLIPPER_PENDING_PAIRING_KEY);
      const raw = data[CLIPPER_PENDING_PAIRING_KEY];
      if (isValid(raw)) return raw;
    } catch {
      // fall through
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = globalThis.localStorage.getItem(CLIPPER_PENDING_PAIRING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isValid(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export async function clearPendingPairingSession(): Promise<void> {
  const localArea = getLocalOnlyArea();
  if (localArea?.remove) {
    try {
      await localArea.remove(CLIPPER_PENDING_PAIRING_KEY);
    } catch {
      // ignore
    }
  } else if (localArea) {
    try {
      await localArea.set({ [CLIPPER_PENDING_PAIRING_KEY]: null });
    } catch {
      // ignore
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.removeItem(CLIPPER_PENDING_PAIRING_KEY);
    } catch {
      // ignore
    }
  }
}

export async function saveCachedWorkspaceTags(
  tags: readonly { readonly tag: string; readonly count: number }[],
): Promise<void> {
  const payload: CachedWorkspaceTags = {
    tags: tags.slice(0, 60),
    fetchedAt: Date.now(),
  };
  const localArea = getLocalOnlyArea();
  if (localArea) {
    try {
      await localArea.set({ [CLIPPER_TAG_CACHE_KEY]: payload });
    } catch {
      // ignore
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.setItem(CLIPPER_TAG_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }
}

export async function loadCachedWorkspaceTags(): Promise<CachedWorkspaceTags | null> {
  const parseCache = (raw: unknown): CachedWorkspaceTags | null => {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Partial<CachedWorkspaceTags>;
    if (!Array.isArray(obj.tags) || typeof obj.fetchedAt !== "number") return null;
    const cleaned = (obj.tags as unknown[]).filter(
      (item): item is { readonly tag: string; readonly count: number } =>
        typeof item === "object" &&
        item !== null &&
        "tag" in item &&
        typeof item.tag === "string" &&
        "count" in item &&
        typeof item.count === "number",
    );
    return { tags: cleaned, fetchedAt: obj.fetchedAt };
  };

  const localArea = getLocalOnlyArea();
  if (localArea) {
    try {
      const data = await localArea.get(CLIPPER_TAG_CACHE_KEY);
      const parsed = parseCache(data[CLIPPER_TAG_CACHE_KEY]);
      if (parsed) return parsed;
    } catch {
      // fall through
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = globalThis.localStorage.getItem(CLIPPER_TAG_CACHE_KEY);
      if (raw) return parseCache(JSON.parse(raw));
    } catch {
      // ignore
    }
  }
  return null;
}

export async function savePopupDraft(draft: Omit<PopupDraft, "savedAt">): Promise<void> {
  const full: PopupDraft = { ...draft, savedAt: Date.now() };
  const area = getSessionOrLocalArea();
  if (area) {
    try {
      await area.set({ [CLIPPER_POPUP_DRAFT_KEY]: full });
      return;
    } catch {
      // fall through
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.setItem(CLIPPER_POPUP_DRAFT_KEY, JSON.stringify(full));
    } catch {
      // ignore
    }
  }
}

export async function loadPopupDraft(url: string): Promise<PopupDraft | null> {
  const normalizeCheck = (raw: unknown): PopupDraft | null => {
    if (!raw || typeof raw !== "object") return null;
    const d = raw as Partial<PopupDraft>;
    if (typeof d.url !== "string" || d.url !== url || typeof d.savedAt !== "number") return null;
    if (Date.now() - d.savedAt > POPUP_DRAFT_TTL_MS) return null;
    return {
      url: d.url,
      title: typeof d.title === "string" ? d.title : "",
      tagsCsv: typeof d.tagsCsv === "string" ? d.tagsCsv : "",
      spaceId: typeof d.spaceId === "string" && d.spaceId.trim() ? asSpaceId(d.spaceId) : "",
      highlightNote: typeof d.highlightNote === "string" ? d.highlightNote : "",
      aiSummary: typeof d.aiSummary === "string" ? d.aiSummary : "",
      savedAt: d.savedAt,
    };
  };

  const area = getSessionOrLocalArea();
  if (area) {
    try {
      const data = await area.get(CLIPPER_POPUP_DRAFT_KEY);
      const parsed = normalizeCheck(data[CLIPPER_POPUP_DRAFT_KEY]);
      if (parsed) return parsed;
    } catch {
      // fall through
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = globalThis.localStorage.getItem(CLIPPER_POPUP_DRAFT_KEY);
      if (raw) return normalizeCheck(JSON.parse(raw));
    } catch {
      // ignore
    }
  }
  return null;
}

export async function clearPopupDraft(): Promise<void> {
  const area = getSessionOrLocalArea();
  if (area?.remove) {
    try {
      await area.remove(CLIPPER_POPUP_DRAFT_KEY);
    } catch {
      // ignore
    }
  } else if (area) {
    try {
      await area.set({ [CLIPPER_POPUP_DRAFT_KEY]: null });
    } catch {
      // ignore
    }
  }
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.removeItem(CLIPPER_POPUP_DRAFT_KEY);
    } catch {
      // ignore
    }
  }
}
