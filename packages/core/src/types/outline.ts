import { z } from "zod";
import {
  documentIdSchema,
  outlineNodeIdSchema,
  spaceIdSchema,
  taskTargetIdSchema,
  threadBindingIdSchema,
  type ApiTokenId,
  type DocumentId,
  type OutlineNodeId,
  type SpaceId,
  type TaskTargetId,
  type ThreadBindingId,
  type UserId,
  type WorkspaceId,
} from "../ids.ts";
import { TASK_SCHEDULE_SLOTS, type TaskScheduleSlot } from "../schedule.ts";
import {
  taskBucketSchema,
  taskPrioritySchema,
  taskRecurrenceRuleSchema,
  type TaskPriority,
  type TaskRecurrenceRule,
  type WorkspaceTaskSubtask,
} from "../tasks.ts";
import { dailyDateSchema, type DocumentKind } from "./common.ts";
import type { AdeThreadBinding } from "./thread.ts";

export const TASK_SOURCE_ENGINES = ["outline", "markdown"] as const;
export type TaskSourceEngine = (typeof TASK_SOURCE_ENGINES)[number];
export const taskSourceEngineSchema = z.enum(TASK_SOURCE_ENGINES);
export const scheduledStartMinSchema = z.number().int().min(0).max(1439);

export interface OutlineNode {
  readonly id: OutlineNodeId;
  readonly documentId: DocumentId;
  readonly parentNodeId: OutlineNodeId | null;
  readonly orderKey: string;
  readonly contentMarkdown: string;
  readonly contentText: string;
  readonly noteMarkdown?: string | undefined;
  readonly noteText?: string | undefined;
  readonly checked: boolean | null;
  readonly collapsed: boolean;
  readonly authorType: "human" | "agent";
  readonly authorId: UserId | ApiTokenId | null;
  readonly sourceBindingId: ThreadBindingId | null;
  readonly mirrorOfNodeId?: OutlineNodeId | null | undefined;
  readonly rolledOverToDocId?: DocumentId | null | undefined;
  readonly priority?: TaskPriority | null | undefined;
  readonly scheduledDate?: string | null | undefined;
  readonly scheduledSlot?: TaskScheduleSlot | null | undefined;
  readonly scheduledStartMin?: number | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly durationMin?: number | null | undefined;
  readonly recurrenceRule?: TaskRecurrenceRule | null | undefined;
  readonly completedAt?: string | null | undefined;
  readonly spawnedNextNodeId?: OutlineNodeId | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface DocumentTaskRecord {
  readonly id: TaskTargetId;
  readonly workspaceId: WorkspaceId;
  readonly sourceEngine: TaskSourceEngine;
  readonly docId: DocumentId;
  readonly blockKey: string;
  readonly lineIndex: number | null;
  readonly title: string;
  readonly completed: boolean;
  readonly priority: TaskPriority | null;
  readonly scheduledDate: string | null;
  readonly scheduledStartMin: number | null;
  readonly durationMin: number | null;
  readonly dueDate: string | null;
  readonly recurrenceRule: TaskRecurrenceRule | null;
  readonly spaceId: SpaceId;
  readonly tags: readonly string[];
  readonly updatedAt: string;
}

export interface WorkspaceTaskItem {
  readonly taskId?: TaskTargetId | undefined;
  readonly sourceEngine?: TaskSourceEngine | undefined;
  readonly blockKey?: string | undefined;
  readonly lineIndex?: number | null | undefined;
  readonly node: OutlineNode;
  readonly document: {
    readonly id: DocumentId;
    readonly title: string;
    readonly kind?: DocumentKind | undefined;
    readonly spaceId: SpaceId;
    readonly dailyDate: string | null;
    readonly tags: readonly string[];
  };
  readonly bindings: readonly AdeThreadBinding[];
  readonly subtasks?: readonly WorkspaceTaskSubtask[] | undefined;
}

export interface UpdateOutlineNodeResult {
  readonly node: OutlineNode;
  readonly spawnedNextNode?: OutlineNode | null | undefined;
  readonly deletedSpawnedNodeId?: OutlineNodeId | null | undefined;
}

const taskScheduleSlotSchema = z.enum(TASK_SCHEDULE_SLOTS);
const batchOutlineNodeRefSchema = z.string().trim().min(1);

export const createOutlineNodeInputSchema = z.object({
  documentId: documentIdSchema,
  parentNodeId: outlineNodeIdSchema.nullable().default(null),
  afterNodeId: outlineNodeIdSchema.nullable().optional(),
  beforeNodeId: outlineNodeIdSchema.nullable().optional(),
  orderKey: z.string().min(1).optional(),
  contentMarkdown: z.string(),
  noteMarkdown: z.string().optional(),
  checked: z.boolean().nullable().default(null),
  collapsed: z.boolean().default(false),
  authorType: z.enum(["human", "agent"]).default("human"),
  authorId: z.string().min(1).nullable().optional(),
  sourceBindingId: threadBindingIdSchema.nullable().optional(),
  mirrorOfNodeId: outlineNodeIdSchema.nullable().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  scheduledDate: dailyDateSchema.nullable().optional(),
  scheduledSlot: taskScheduleSlotSchema.nullable().optional(),
  scheduledStartMin: scheduledStartMinSchema.nullable().optional(),
  dueDate: dailyDateSchema.nullable().optional(),
  durationMin: z.number().int().min(1).max(1440).nullable().optional(),
  recurrenceRule: taskRecurrenceRuleSchema.nullable().optional(),
});
export type CreateOutlineNodeInput = z.input<typeof createOutlineNodeInputSchema>;
export type ParsedCreateOutlineNodeInput = z.infer<typeof createOutlineNodeInputSchema>;

export const updateOutlineNodeInputSchema = z.object({
  contentMarkdown: z.string().optional(),
  noteMarkdown: z.string().optional(),
  checked: z.boolean().nullable().optional(),
  collapsed: z.boolean().optional(),
  sourceBindingId: threadBindingIdSchema.nullable().optional(),
  mirrorOfNodeId: outlineNodeIdSchema.nullable().optional(),
  rolledOverToDocId: documentIdSchema.nullable().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  scheduledDate: dailyDateSchema.nullable().optional(),
  scheduledSlot: taskScheduleSlotSchema.nullable().optional(),
  scheduledStartMin: scheduledStartMinSchema.nullable().optional(),
  dueDate: dailyDateSchema.nullable().optional(),
  durationMin: z.number().int().min(1).max(1440).nullable().optional(),
  recurrenceRule: taskRecurrenceRuleSchema.nullable().optional(),
  spawnedNextNodeId: outlineNodeIdSchema.nullable().optional(),
});
export type UpdateOutlineNodeInput = z.infer<typeof updateOutlineNodeInputSchema>;

export const moveOutlineNodeInputSchema = z.object({
  parentNodeId: outlineNodeIdSchema.nullable(),
  afterNodeId: outlineNodeIdSchema.nullable().optional(),
  beforeNodeId: outlineNodeIdSchema.nullable().optional(),
  orderKey: z.string().min(1).optional(),
});
export type MoveOutlineNodeInput = z.infer<typeof moveOutlineNodeInputSchema>;

export const outlineBatchCreateOpSchema = createOutlineNodeInputSchema
  .omit({
    documentId: true,
    parentNodeId: true,
    afterNodeId: true,
    beforeNodeId: true,
    authorType: true,
    mirrorOfNodeId: true,
  })
  .extend({
    op: z.literal("create"),
    tempId: z.string().min(1).optional(),
    documentId: documentIdSchema.optional(),
    parentNodeId: batchOutlineNodeRefSchema.nullable().default(null),
    afterNodeId: batchOutlineNodeRefSchema.nullable().optional(),
    beforeNodeId: batchOutlineNodeRefSchema.nullable().optional(),
    authorType: z.enum(["human", "agent"]).optional(),
    mirrorOfNodeId: batchOutlineNodeRefSchema.nullable().optional(),
  });

export const outlineBatchUpdateOpSchema = updateOutlineNodeInputSchema
  .omit({ mirrorOfNodeId: true })
  .extend({
    op: z.literal("update"),
    nodeId: outlineNodeIdSchema,
    documentId: documentIdSchema.optional(),
    mirrorOfNodeId: batchOutlineNodeRefSchema.nullable().optional(),
  });

export const outlineBatchMoveOpSchema = moveOutlineNodeInputSchema
  .omit({
    parentNodeId: true,
    afterNodeId: true,
    beforeNodeId: true,
  })
  .extend({
    op: z.literal("move"),
    nodeId: outlineNodeIdSchema,
    documentId: documentIdSchema.optional(),
    parentNodeId: batchOutlineNodeRefSchema.nullable(),
    afterNodeId: batchOutlineNodeRefSchema.nullable().optional(),
    beforeNodeId: batchOutlineNodeRefSchema.nullable().optional(),
  });

export const outlineBatchDeleteOpSchema = z.object({
  op: z.literal("delete"),
  nodeId: outlineNodeIdSchema,
  documentId: documentIdSchema.optional(),
});

export const outlineBatchOperationSchema = z.discriminatedUnion("op", [
  outlineBatchCreateOpSchema,
  outlineBatchUpdateOpSchema,
  outlineBatchMoveOpSchema,
  outlineBatchDeleteOpSchema,
]);
export type OutlineBatchOperation = z.input<typeof outlineBatchOperationSchema>;
export type ParsedOutlineBatchOperation = z.infer<typeof outlineBatchOperationSchema>;

export const batchOutlineNodesInputSchema = z.object({
  documentId: documentIdSchema.optional(),
  operations: z.array(outlineBatchOperationSchema).min(1).max(500),
});
export type BatchOutlineNodesRequestInput = z.input<typeof batchOutlineNodesInputSchema>;
export type BatchOutlineNodesInput = z.infer<typeof batchOutlineNodesInputSchema>;

export interface BatchOutlineNodesResult {
  readonly documentId: DocumentId;
  readonly tempIdMap: Readonly<Record<string, OutlineNodeId>>;
  readonly created: readonly OutlineNode[];
  readonly updated: readonly OutlineNode[];
  readonly moved: readonly OutlineNode[];
  readonly deletedIds: readonly OutlineNodeId[];
  readonly nodes: readonly OutlineNode[];
}

export const listTasksQuerySchema = z.object({
  status: z.enum(["open", "completed", "all"]).default("all"),
  sourceEngine: taskSourceEngineSchema.optional(),
  spaceId: spaceIdSchema.optional(),
  tag: z.string().min(1).optional(),
  priority: taskPrioritySchema.optional(),
  bucket: taskBucketSchema.optional(),
  scheduledDate: dailyDateSchema.optional(),
  dueDate: dailyDateSchema.optional(),
  includeAnytime: z.coerce.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListTasksQuery = z.input<typeof listTasksQuerySchema>;
export type ParsedListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const createTaskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(4000).optional(),
    contentMarkdown: z.string().trim().min(1).max(4000).optional(),
    noteMarkdown: z.string().max(20000).optional(),
    documentId: documentIdSchema.optional(),
    spaceId: spaceIdSchema.optional(),
    parentNodeId: outlineNodeIdSchema.nullable().optional(),
    priority: taskPrioritySchema.nullable().optional(),
    scheduledDate: dailyDateSchema.nullable().optional(),
    scheduledSlot: taskScheduleSlotSchema.nullable().optional(),
    scheduledStartMin: scheduledStartMinSchema.nullable().optional(),
    dueDate: dailyDateSchema.nullable().optional(),
    durationMin: z.number().int().min(1).max(1440).nullable().optional(),
    recurrenceRule: taskRecurrenceRuleSchema.nullable().optional(),
    parseQuickSyntax: z.boolean().default(true),
    referenceDate: dailyDateSchema.optional(),
  })
  .refine(
    (data) =>
      Boolean(
        (data.title && data.title.trim()) ||
          (data.contentMarkdown && data.contentMarkdown.trim()),
      ),
    { message: "Task title or contentMarkdown is required" },
  );
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
export type ParsedCreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const updateTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(4000).optional(),
  contentMarkdown: z.string().trim().min(1).max(4000).optional(),
  noteMarkdown: z.string().max(20000).optional(),
  checked: z.boolean().optional(),
  completed: z.boolean().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  scheduledDate: dailyDateSchema.nullable().optional(),
  scheduledSlot: taskScheduleSlotSchema.nullable().optional(),
  scheduledStartMin: scheduledStartMinSchema.nullable().optional(),
  dueDate: dailyDateSchema.nullable().optional(),
  durationMin: z.number().int().min(1).max(1440).nullable().optional(),
  recurrenceRule: taskRecurrenceRuleSchema.nullable().optional(),
});
export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>;
export type ParsedUpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

export const batchUpdateTasksInputSchema = z.object({
  nodeIds: z.array(taskTargetIdSchema).min(1).max(200),
  checked: z.boolean().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  scheduledDate: dailyDateSchema.nullable().optional(),
  scheduledSlot: taskScheduleSlotSchema.nullable().optional(),
  scheduledStartMin: scheduledStartMinSchema.nullable().optional(),
  dueDate: dailyDateSchema.nullable().optional(),
  durationMin: z.number().int().min(1).max(1440).nullable().optional(),
  recurrenceRule: taskRecurrenceRuleSchema.nullable().optional(),
});
export type BatchUpdateTasksInput = z.infer<typeof batchUpdateTasksInputSchema>;

export const rescheduleTaskInputSchema = z.object({
  nodeId: taskTargetIdSchema,
  scheduledDate: dailyDateSchema.nullable(),
  scheduledSlot: taskScheduleSlotSchema.nullable().optional(),
  scheduledStartMin: scheduledStartMinSchema.nullable().optional(),
  durationMin: z.number().int().min(1).max(1440).nullable().optional(),
});
export type RescheduleTaskInput = z.infer<typeof rescheduleTaskInputSchema>;
