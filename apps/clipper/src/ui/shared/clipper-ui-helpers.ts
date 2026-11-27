import {
  formatHostDisplayName,
  isNeutralHostKind,
  type AdeKind,
  type AdeThreadStatus,
  type HighlightColor,
} from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import { probeLocalInkadeServers } from "../../core/sync.ts";
import {
  DEFAULT_CLIPPER_SETTINGS,
  generateNonce,
  normalizeServerUrl,
  resolveWebAppBaseUrl,
  resolveWebAppDocUrl,
  savePendingPairingSession,
  type ClipperSettings,
} from "../../shared/storage.ts";
import { getWebExt } from "../../shared/webext.ts";

export type ClipperTranslateFn = ReturnType<typeof useInkadeTranslation>["t"];

export interface ClipperUiStatus {
  readonly kind: "success" | "error";
  readonly text: string;
  readonly docId?: string | undefined;
}

export const HIGHLIGHT_COLOR_ORDER = ["amber", "emerald", "blue", "rose"] as const;

export const HIGHLIGHT_SWATCH_CSS: Readonly<Record<HighlightColor, string>> = {
  amber: "var(--warning)",
  emerald: "var(--success)",
  blue: "var(--info)",
  rose: "var(--color-rose-500, #f43f5e)",
};

export function formatSummaryAsCallout(summary: string): string {
  const cleaned = summary.trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("> [!")) return cleaned;
  const quoted = cleaned
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return `> [!NOTE]\n${quoted}`;
}

export function getHighlightColorLabel(t: ClipperTranslateFn, color: HighlightColor): string {
  if (color === "emerald") return t("clipper.colorEmerald");
  if (color === "blue") return t("clipper.colorBlue");
  if (color === "rose") return t("clipper.colorRose");
  return t("clipper.colorAmber");
}

export function getAdeHostLabel(t: ClipperTranslateFn, kind: AdeKind): string {
  if (isNeutralHostKind(kind)) return t("clipper.adeAny");
  return formatHostDisplayName(kind, t("clipper.adeAny"));
}

export function getThreadStatusLabel(t: ClipperTranslateFn, status: AdeThreadStatus): string {
  if (status === "queued") return t("common.statusQueued");
  if (status === "running") return t("common.statusRunning");
  if (status === "waiting_input") return t("common.statusWaitingInput");
  if (status === "completed") return t("common.statusCompleted");
  if (status === "failed") return t("common.statusFailed");
  return t("common.statusArchived");
}

export function openClipperExternalUrl(url: string): void {
  const ext = getWebExt();
  if (ext?.tabs?.create) {
    void ext.tabs.create({ url });
  } else if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function openDocInInkadeTab(
  settings: Pick<ClipperSettings, "serverUrl" | "webAppUrl">,
  docId: string,
): void {
  openClipperExternalUrl(resolveWebAppDocUrl(settings, docId));
}

export async function launchClipperPairingFlow(options: {
  readonly serverUrl: string;
  readonly webAppUrl: string;
  readonly probeLocal?: boolean | undefined;
}): Promise<void> {
  let targetServer =
    normalizeServerUrl(options.serverUrl) || DEFAULT_CLIPPER_SETTINGS.serverUrl;
  if (options.probeLocal) {
    const probed = await probeLocalInkadeServers();
    if (probed) {
      targetServer = probed.serverUrl;
    }
  }
  const baseWeb = resolveWebAppBaseUrl({
    serverUrl: targetServer,
    webAppUrl: normalizeServerUrl(options.webAppUrl),
  });
  const nonce = generateNonce();
  let expectedOrigin = "";
  try {
    expectedOrigin = new URL(baseWeb).origin;
  } catch {
    expectedOrigin = "";
  }
  await savePendingPairingSession({
    nonce,
    expectedOrigin,
    createdAt: Date.now(),
  });
  const pairUrl = `${baseWeb}/clipper/pair?nonce=${encodeURIComponent(nonce)}&serverUrl=${encodeURIComponent(targetServer)}`;
  openClipperExternalUrl(pairUrl);
}
