import type { InboxTabPref, UnifiedInboxEntry } from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import { formatLocalizedBriefingSummary } from "../../lib/briefings-i18n.ts";

export interface ShareTargetParams {
  readonly title?: string | undefined;
  readonly text?: string | undefined;
  readonly url?: string | undefined;
}

export type InboxFilterTab = InboxTabPref;

export interface InboxViewUrlState {
  readonly tab?: InboxFilterTab | undefined;
  readonly q?: string | undefined;
  readonly item?: string | undefined;
}

export interface InboxViewProps {
  readonly shareTarget?: ShareTargetParams | undefined;
  readonly readonly?: boolean | undefined;
  readonly initialTab?: InboxFilterTab | undefined;
  readonly initialQuery?: string | undefined;
  readonly initialItemId?: string | undefined;
  readonly urlState?: InboxViewUrlState | undefined;
  readonly onUrlStateChange?: ((patch: Partial<InboxViewUrlState>) => void) | undefined;
  readonly onClearShareTarget?: (() => void) | undefined;
}

export type UnifiedInboxItem = UnifiedInboxEntry;

export function buildLocalPresetIso(dateStr: string, hour: number): string {
  const parts = dateStr.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(Date.now() + 24 * 3_600_000).toISOString();
  }
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

export function formatSnoozeUntilShort(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso.slice(0, 10);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const min = String(dt.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}`;
}

export function getInboxItemSubtitle(
  item: UnifiedInboxItem,
  t: ReturnType<typeof useInkadeTranslation>["t"],
): string {
  if (item.kind === "conflict") {
    return t("inbox.conflictBindingsCount", { count: item.conflict.bindings.length });
  }
  return formatLocalizedBriefingSummary(item.subtitle, item.subtitle, t);
}

export function formatRelativeTime(
  iso: string,
  t: ReturnType<typeof useInkadeTranslation>["t"],
): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso.slice(0, 10);
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return t("common.justNow");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("common.minutesAgo", { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("common.hoursAgo", { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 14) return t("common.daysAgo", { count: diffDay });
  return iso.slice(0, 10);
}

export function getQueueDotClassName(item: UnifiedInboxItem): string {
  switch (item.kind) {
    case "blocking_question":
      return item.binding.pendingApproval?.urgency === "high"
        ? "bg-destructive"
        : "bg-amber-500";
    case "conflict":
      return "bg-amber-500";
    case "failed":
    case "briefing_failed":
      return "bg-destructive";
    case "digest":
      return item.unread ? "bg-primary" : "bg-primary/50";
    case "clip":
      return item.unread ? "bg-blue-500" : "bg-muted-foreground/45";
  }
}

export function getItemKindLabel(
  item: UnifiedInboxItem,
  t: ReturnType<typeof useInkadeTranslation>["t"],
): string {
  switch (item.kind) {
    case "blocking_question":
      return t("inbox.kindBlockingQuestion");
    case "conflict":
      return t("inbox.kindConflict");
    case "failed":
      return t("inbox.kindFailed");
    case "briefing_failed":
      return t("inbox.kindBriefingFailed");
    case "digest":
      return t("inbox.kindDigest");
    case "clip":
      if (item.doc.kind === "outline") return t("common.kindOutline");
      if (item.doc.kind === "article") return t("common.kindArticle");
      return t("inbox.kindClip");
  }
}
