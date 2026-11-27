import type { AdeThreadStatus, DocumentId, OutlineNode, OutlineNodeId } from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import type { KanbanGroupMode } from "@inkade/ui";

export type DailyViewMode = "outline" | "kanban" | "tasks";

export interface DailyViewUrlState {
  readonly view?: DailyViewMode | undefined;
  readonly kanbanGroup?: KanbanGroupMode | undefined;
}

export interface DailyOutlineViewProps {
  readonly date?: string | undefined;
  readonly focusNodeId?: OutlineNodeId | undefined;
  readonly compact?: boolean | undefined;
  readonly readonly?: boolean | undefined;
  readonly urlState?: DailyViewUrlState | undefined;
  readonly onUrlStateChange?: ((patch: Partial<DailyViewUrlState>) => void) | undefined;
}

export interface DailyFocusRailTaskEntry {
  readonly node: OutlineNode;
  readonly isExternal: boolean;
  readonly documentTitle: string;
}

export function getAdeStatusLabel(
  status: AdeThreadStatus,
  t: ReturnType<typeof useInkadeTranslation>["t"],
): string {
  switch (status) {
    case "queued":
      return t("common.statusQueued");
    case "running":
      return t("common.statusRunning");
    case "waiting_input":
      return t("common.statusWaitingShort");
    case "completed":
      return t("common.statusCompleted");
    case "failed":
      return t("common.statusFailed");
    case "archived":
      return t("common.statusArchived");
  }
}

export function findPrevRolloverDocId(
  outlineDocs: readonly { id: DocumentId; dailyDate: string | null; trashedAt: string | null }[],
  currentDate: string,
): DocumentId | null {
  const candidates = outlineDocs
    .filter((d) => d.trashedAt === null && d.dailyDate !== null && d.dailyDate < currentDate)
    .sort((a, b) => (b.dailyDate ?? "").localeCompare(a.dailyDate ?? ""));
  return candidates[0]?.id ?? null;
}
