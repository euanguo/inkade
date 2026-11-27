import type {
  BatchUpdateTasksInput,
  CreateTaskInput,
  DocumentId,
  DocumentRecord,
  OutlineNode,
  RescheduleTaskInput,
  SpaceId,
  TaskPriority,
  TaskRecurrenceRule,
  TaskScheduleSlot,
  TaskTargetId,
  UpdateTaskInput,
  WorkspaceTaskItem,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";
import type { TaskListFilter } from "../query-keys.ts";

export type ListTasksParams = TaskListFilter;

export interface CreateTaskResponse {
  readonly node: OutlineNode;
  readonly document: DocumentRecord;
}

export interface UpdateTaskResponse {
  readonly node: OutlineNode;
  readonly document?: DocumentRecord | undefined;
  readonly spawnedNextNode?: OutlineNode | null | undefined;
  readonly deletedSpawnedNodeId?: TaskTargetId | null | undefined;
}

export interface BatchUpdateTasksResponse {
  readonly updated: readonly OutlineNode[];
  readonly spawned: readonly OutlineNode[];
}

export interface UpsertTaskInput {
  readonly taskId?: TaskTargetId | undefined;
  readonly documentId?: DocumentId | undefined;
  readonly spaceId?: SpaceId | undefined;
  readonly title?: string | undefined;
  readonly noteMarkdown?: string | undefined;
  readonly checked?: boolean | undefined;
  readonly priority?: TaskPriority | null | undefined;
  readonly scheduledDate?: string | null | undefined;
  readonly scheduledStartMin?: number | null | undefined;
  readonly scheduledSlot?: TaskScheduleSlot | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly durationMin?: number | null | undefined;
  readonly recurrenceRule?: TaskRecurrenceRule | null | undefined;
}

export interface TasksResource {
  list(params?: ListTasksParams): Promise<readonly WorkspaceTaskItem[]>;
  create(input: CreateTaskInput): Promise<CreateTaskResponse>;
  update(taskId: TaskTargetId, input: UpdateTaskInput): Promise<UpdateTaskResponse>;
  batchUpdate(input: BatchUpdateTasksInput): Promise<BatchUpdateTasksResponse>;
  reschedule(input: RescheduleTaskInput): Promise<OutlineNode>;
  upsert(input: UpsertTaskInput): Promise<CreateTaskResponse | UpdateTaskResponse>;
}

export function createTasksResource(transport: InkadeHttpTransport): TasksResource {
  return {
    async list(params = {}) {
      const query = buildQuery({
        status: params.status,
        sourceEngine: params.sourceEngine,
        spaceId: params.spaceId,
        tag: params.tag,
        priority: params.priority,
        bucket: params.bucket,
        scheduledDate: params.scheduledDate,
        dueDate: params.dueDate,
        includeAnytime: params.includeAnytime,
        limit: params.limit,
        offset: params.offset,
      });
      const res = await transport.requestJson<{ readonly tasks: readonly WorkspaceTaskItem[] }>(
        `/api/v1/tasks${query}`,
      );
      return res.tasks;
    },

    create(input) {
      return transport.requestJson<CreateTaskResponse>("/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    update(taskId, input) {
      return transport.requestJson<UpdateTaskResponse>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
    },

    batchUpdate(input) {
      return transport.requestJson<BatchUpdateTasksResponse>("/api/v1/tasks/batch-update", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async reschedule(input) {
      const res = await transport.requestJson<{ readonly node: OutlineNode }>(
        "/api/v1/tasks/reschedule",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.node;
    },

    async upsert(input) {
      if (input.taskId) {
        return this.update(input.taskId, {
          title: input.title,
          noteMarkdown: input.noteMarkdown,
          checked: input.checked,
          priority: input.priority,
          scheduledDate: input.scheduledDate,
          scheduledStartMin: input.scheduledStartMin,
          scheduledSlot: input.scheduledSlot,
          dueDate: input.dueDate,
          durationMin: input.durationMin,
          recurrenceRule: input.recurrenceRule,
        });
      }
      const created = await this.create({
        title: input.title ?? "",
        documentId: input.documentId,
        spaceId: input.spaceId,
        noteMarkdown: input.noteMarkdown,
        priority: input.priority,
        scheduledDate: input.scheduledDate,
        scheduledStartMin: input.scheduledStartMin,
        scheduledSlot: input.scheduledSlot,
        dueDate: input.dueDate,
        durationMin: input.durationMin,
        recurrenceRule: input.recurrenceRule,
        parseQuickSyntax: false,
      });
      if (input.checked === true) {
        return this.update(created.node.id, { checked: true });
      }
      return created;
    },
  };
}
