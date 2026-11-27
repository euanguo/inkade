import type {
  AdeThreadBinding,
  AdeThreadStatus,
  DocumentId,
  DocumentKind,
  DocumentRecord,
  DocumentSummary,
  LibraryViewMode,
  SavedViewId,
  SortDirection,
  SpaceId,
  TaskPriority,
} from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import type { DocumentSortField } from "../../lib/typed-properties.ts";

export const LIBRARY_PAGE_SIZE = 100;

export interface LibraryDisplayOptions {
  readonly showExcerpt: boolean;
  readonly showTags: boolean;
  readonly showAdeBadge: boolean;
  readonly showProperties: boolean;
  readonly showEmptyDailies: boolean;
  readonly density: "compact" | "comfortable";
}

export const DOC_PRIORITY_BADGE_LABELS: Readonly<Record<TaskPriority, string>> = {
  p1: "P1",
  p2: "P2",
  p3: "P3",
  p4: "P4",
  none: "—",
};

export function extractDocPriority(doc: Pick<DocumentRecord, "properties">): TaskPriority {
  const raw = doc.properties?.["priority"];
  if (raw === "p1" || raw === "p2" || raw === "p3" || raw === "p4") {
    return raw;
  }
  return "none";
}

export function isEmptyDailyDocument(doc: DocumentSummary): boolean {
  if (!doc.dailyDate || doc.pinned || doc.unreadAgentUpdate || doc.tags.length > 0) {
    return false;
  }
  const stripped = doc.excerpt
    .replace(/^#?\s*\d{4}-\d{2}-\d{2}[^\n]*\n*/u, "")
    .trim();
  return stripped.length === 0;
}

export function formatRelativeDate(
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

export interface AdeSummary {
  readonly total: number;
  readonly waitingCount: number;
  readonly primaryStatus: AdeThreadStatus;
}

const ADE_STATUS_PRIORITY: Readonly<Record<AdeThreadStatus, number>> = {
  waiting_input: 5,
  running: 4,
  failed: 3,
  queued: 2,
  completed: 1,
  archived: 0,
};

export const ADE_STATUS_BADGE_VARIANT: Readonly<
  Record<AdeThreadStatus, "warning" | "info" | "error" | "secondary" | "success" | "outline">
> = {
  waiting_input: "warning",
  running: "info",
  failed: "error",
  queued: "secondary",
  completed: "success",
  archived: "outline",
};

export function summarizeDocAde(bindings: readonly AdeThreadBinding[] | undefined): AdeSummary | null {
  if (!bindings || bindings.length === 0) return null;
  let waitingCount = 0;
  let primaryStatus: AdeThreadStatus = bindings[0]!.status;
  for (const b of bindings) {
    if (b.status === "waiting_input") waitingCount += 1;
    if (ADE_STATUS_PRIORITY[b.status] > ADE_STATUS_PRIORITY[primaryStatus]) {
      primaryStatus = b.status;
    }
  }
  return {
    total: bindings.length,
    waitingCount,
    primaryStatus,
  };
}

export function getKindBadgeVariant(kind: DocumentKind): "info" | "secondary" | "outline" {
  if (kind === "article") return "info";
  if (kind === "clip") return "secondary";
  return "outline";
}

export interface LibraryViewUrlState {
  readonly view?: LibraryViewMode | undefined;
  readonly sort?: DocumentSortField | undefined;
  readonly dir?: SortDirection | undefined;
  readonly kind?: "all" | DocumentKind | undefined;
  readonly q?: string | undefined;
  readonly doc?: DocumentId | undefined;
}

export interface DocumentListViewProps {
  readonly spaceId?: SpaceId | undefined;
  readonly initialSpaceId?: SpaceId | undefined;
  readonly initialTag?: string | undefined;
  readonly initialKind?: DocumentKind | undefined;
  readonly initialPinnedOnly?: boolean | undefined;
  readonly initialUnreadOnly?: boolean | undefined;
  readonly activeViewId?: SavedViewId | undefined;
  readonly readonly?: boolean | undefined;
  readonly urlState?: LibraryViewUrlState | undefined;
  readonly onUrlStateChange?: ((patch: Partial<LibraryViewUrlState>) => void) | undefined;
  readonly onSelectDocument?: ((doc: DocumentSummary) => void) | undefined;
}
