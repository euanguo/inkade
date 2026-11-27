import type {
  SpaceId,
  TaskBucket,
  TaskPriority,
  TaskSourceEngine,
  TasksQuickAddPreset,
  TasksStatusFilter,
  WorkspaceTaskItem,
} from "@inkade/core";
import type { TasksBoardGroupMode } from "../TasksBoardView.tsx";

export type TasksWorkspaceMode = "list" | "board" | "agenda";
export type TaskStatusFilter = "all" | "open" | "completed";
export type TaskGroupFilter = "all" | "today" | "overdue" | "anytime" | "ade";
export type TaskSourceEngineFilter = "all" | TaskSourceEngine;
export type QuickAddPreset = TasksQuickAddPreset;

export interface TasksViewUrlState {
  readonly view?: TasksWorkspaceMode | undefined;
  readonly boardGroup?: TasksBoardGroupMode | undefined;
  readonly group?: TaskGroupFilter | undefined;
  readonly status?: TasksStatusFilter | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly engine?: TaskSourceEngine | undefined;
  readonly space?: SpaceId | undefined;
  readonly tag?: string | undefined;
  readonly q?: string | undefined;
}

export interface TasksViewProps {
  readonly readonly?: boolean | undefined;
  readonly initialViewMode?: TasksWorkspaceMode | undefined;
  readonly urlState?: TasksViewUrlState | undefined;
  readonly onUrlStateChange?: ((patch: Partial<TasksViewUrlState>) => void) | undefined;
}

export interface TasksStats {
  readonly open: number;
  readonly completed: number;
  readonly total: number;
  readonly completionPercent: number;
  readonly today: number;
  readonly overdue: number;
  readonly anytime: number;
  readonly ade: number;
}

export interface TaskKpiGroup {
  readonly key: TaskGroupFilter;
  readonly label: string;
  readonly count: number;
  readonly tone?: "warning" | "primary" | undefined;
}

export type TasksBucketedGroups = Record<TaskBucket, WorkspaceTaskItem[]>;

export type TaskSectionIconKey =
  | "alert"
  | "sun"
  | "moon"
  | "calendar"
  | "clock"
  | "inbox";

export type TasksFlatVirtualRow =
  | {
      readonly kind: "header";
      readonly key: string;
      readonly bucket?: TaskBucket | undefined;
      readonly icon: TaskSectionIconKey;
      readonly heading: string;
      readonly count: number;
      readonly toneClass?: string | undefined;
    }
  | {
      readonly kind: "completed-toggle";
      readonly key: string;
      readonly count: number;
      readonly expanded: boolean;
    }
  | {
      readonly kind: "task";
      readonly key: string;
      readonly item: WorkspaceTaskItem;
    };
