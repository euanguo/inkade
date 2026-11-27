import type {
  OutlineNode,
  OutlineNodeId,
  TaskPriority,
  TaskRecurrenceRule,
  TaskScheduleSlot,
} from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";

export interface TaskPriorityStyleSpec {
  readonly barClass: string;
  readonly dotClass: string;
  readonly pillClass: string;
}

export const TASK_PRIORITY_STYLES: Readonly<Record<TaskPriority, TaskPriorityStyleSpec>> = {
  p1: {
    barClass: "bg-red-500",
    dotClass: "bg-red-500",
    pillClass:
      "border-red-500/30 bg-red-500/10 text-red-600 dark:border-red-400/35 dark:bg-red-500/15 dark:text-red-400",
  },
  p2: {
    barClass: "bg-amber-500",
    dotClass: "bg-amber-500",
    pillClass:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/15 dark:text-amber-400",
  },
  p3: {
    barClass: "bg-blue-500",
    dotClass: "bg-blue-500",
    pillClass:
      "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:border-blue-400/35 dark:bg-blue-500/15 dark:text-blue-400",
  },
  p4: {
    barClass: "bg-slate-400 dark:bg-slate-500",
    dotClass: "bg-slate-400 dark:bg-slate-500",
    pillClass:
      "border-border bg-muted/65 text-muted-foreground",
  },
  none: {
    barClass: "",
    dotClass: "bg-muted-foreground/35",
    pillClass: "",
  },
};

type KanbanI18nT = ReturnType<typeof useInkadeTranslation>["t"];

export type TaskPriorityLabelKey =
  | "tasks.priorityP1"
  | "tasks.priorityP2"
  | "tasks.priorityP3"
  | "tasks.priorityP4"
  | "tasks.priorityNone"
  | "tasks.priorityShortP1"
  | "tasks.priorityShortP2"
  | "tasks.priorityShortP3"
  | "tasks.priorityShortP4";

export function getTaskPriorityLabelKey(
  priority: TaskPriority,
  short = false,
): TaskPriorityLabelKey {
  switch (priority) {
    case "p1":
      return short ? "tasks.priorityShortP1" : "tasks.priorityP1";
    case "p2":
      return short ? "tasks.priorityShortP2" : "tasks.priorityP2";
    case "p3":
      return short ? "tasks.priorityShortP3" : "tasks.priorityP3";
    case "p4":
      return short ? "tasks.priorityShortP4" : "tasks.priorityP4";
    case "none":
      return "tasks.priorityNone";
  }
}

export type TaskSlotLabelKey =
  | "tasks.slotMorning"
  | "tasks.slotAfternoon"
  | "tasks.slotEvening"
  | "tasks.slotToday";

export function getTaskSlotLabelKey(slot: TaskScheduleSlot): TaskSlotLabelKey {
  switch (slot) {
    case "morning":
      return "tasks.slotMorning";
    case "afternoon":
      return "tasks.slotAfternoon";
    case "evening":
      return "tasks.slotEvening";
    case "today":
      return "tasks.slotToday";
  }
}

export type TaskRecurrenceLabelKey =
  | "tasks.recurrenceDaily"
  | "tasks.recurrenceWeekdays"
  | "tasks.recurrenceWeekly"
  | "tasks.recurrenceMonthly"
  | "tasks.recurrenceCustom";

export type TaskSourceEngineBadgeKey =
  | "tasks.sourceBadgeOutline"
  | "tasks.sourceBadgeArticle"
  | "tasks.sourceBadgeClip";

export function getTaskSourceEngineBadgeKey(
  sourceEngine?: "outline" | "markdown",
  docKind?: string,
): TaskSourceEngineBadgeKey {
  const effectiveKind = docKind ?? (sourceEngine === "markdown" ? "article" : "outline");
  if (effectiveKind === "clip") return "tasks.sourceBadgeClip";
  if (effectiveKind === "article" || sourceEngine === "markdown") return "tasks.sourceBadgeArticle";
  return "tasks.sourceBadgeOutline";
}

export function getTaskRecurrenceLabelKey(rule: TaskRecurrenceRule): TaskRecurrenceLabelKey {
  switch (rule) {
    case "daily":
      return "tasks.recurrenceDaily";
    case "weekdays":
      return "tasks.recurrenceWeekdays";
    case "weekly":
      return "tasks.recurrenceWeekly";
    case "monthly":
      return "tasks.recurrenceMonthly";
    default:
      return "tasks.recurrenceCustom";
  }
}

export function formatTaskDurationLabel(
  durationMin: number,
  t: KanbanI18nT,
): string {
  if (durationMin >= 60 && durationMin % 30 === 0) {
    const hours = Number((durationMin / 60).toFixed(1));
    return t("tasks.durationHours", { hours });
  }
  return t("tasks.durationMinutes", { minutes: durationMin });
}

export type KanbanGroupMode = "status" | "priority" | "branch";

export interface KanbanColumnModel {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly accentClass: string;
  readonly cards: readonly OutlineNode[];
  readonly targetParentId: OutlineNodeId | null;
  readonly targetChecked?: boolean | null | undefined;
  readonly targetPriority?: TaskPriority | undefined;
}
