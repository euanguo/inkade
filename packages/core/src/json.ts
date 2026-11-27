import { z } from "zod";
import {
  asActorId,
  asDocumentId,
  asOutlineNodeId,
  asThreadBindingId,
} from "./ids.ts";
import {
  TASK_PRIORITIES,
  TASK_RECURRENCE_RULES,
} from "./tasks.ts";
import { TASK_SCHEDULE_SLOTS } from "./schedule.ts";
import {
  agentPendingApprovalSchema,
  agentSteeringNoteSchema,
  agentStepItemSchema,
  selectionAnchorSchema,
  type AgentPendingApproval,
  type AgentSteeringNote,
  type AgentStepItem,
  type SelectionAnchor,
} from "./types/thread.ts";
import type { OutlineNode } from "./types/outline.ts";

export const jsonRecordSchema: z.ZodType<Record<string, unknown>> = z.record(
  z.string(),
  z.unknown(),
);

export const stringArraySchema: z.ZodType<readonly string[]> = z.array(z.string());
export const numberArraySchema: z.ZodType<readonly number[]> = z.array(z.number());
export const agentStepsListSchema: z.ZodType<readonly AgentStepItem[]> =
  z.array(agentStepItemSchema);
export const agentSteeringListSchema: z.ZodType<readonly AgentSteeringNote[]> =
  z.array(agentSteeringNoteSchema);
export const nullablePendingApprovalSchema: z.ZodType<AgentPendingApproval | null> =
  agentPendingApprovalSchema.nullable();
export const nullableSelectionAnchorSchema: z.ZodType<SelectionAnchor | null> =
  selectionAnchorSchema.nullable();

const rawOutlineSnapshotNodeSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  parentNodeId: z.string().min(1).nullable(),
  orderKey: z.string(),
  contentMarkdown: z.string(),
  contentText: z.string().optional().default(""),
  noteMarkdown: z.string().optional(),
  noteText: z.string().optional(),
  checked: z.boolean().nullable(),
  collapsed: z.boolean(),
  authorType: z.enum(["human", "agent"]),
  authorId: z.string().nullable(),
  sourceBindingId: z.string().nullable(),
  mirrorOfNodeId: z.string().nullable().optional(),
  rolledOverToDocId: z.string().nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  scheduledDate: z.string().nullable().optional(),
  scheduledSlot: z.enum(TASK_SCHEDULE_SLOTS).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  durationMin: z.number().nullable().optional(),
  recurrenceRule: z.enum(TASK_RECURRENCE_RULES).nullable().optional(),
  completedAt: z.string().nullable().optional(),
  spawnedNextNodeId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export const outlineSnapshotSchema: z.ZodType<readonly OutlineNode[]> = z
  .array(rawOutlineSnapshotNodeSchema)
  .transform((rows) =>
    rows.map((row): OutlineNode => ({
      id: asOutlineNodeId(row.id),
      documentId: asDocumentId(row.documentId),
      parentNodeId: row.parentNodeId ? asOutlineNodeId(row.parentNodeId) : null,
      orderKey: row.orderKey,
      contentMarkdown: row.contentMarkdown,
      contentText: row.contentText,
      ...(row.noteMarkdown !== undefined ? { noteMarkdown: row.noteMarkdown } : {}),
      ...(row.noteText !== undefined ? { noteText: row.noteText } : {}),
      checked: row.checked,
      collapsed: row.collapsed,
      authorType: row.authorType,
      authorId: row.authorId ? asActorId(row.authorId) : null,
      sourceBindingId: row.sourceBindingId ? asThreadBindingId(row.sourceBindingId) : null,
      ...(row.mirrorOfNodeId !== undefined
        ? { mirrorOfNodeId: row.mirrorOfNodeId ? asOutlineNodeId(row.mirrorOfNodeId) : null }
        : {}),
      ...(row.rolledOverToDocId !== undefined
        ? { rolledOverToDocId: row.rolledOverToDocId ? asDocumentId(row.rolledOverToDocId) : null }
        : {}),
      ...(row.priority !== undefined ? { priority: row.priority } : {}),
      ...(row.scheduledDate !== undefined ? { scheduledDate: row.scheduledDate } : {}),
      ...(row.scheduledSlot !== undefined ? { scheduledSlot: row.scheduledSlot } : {}),
      ...(row.dueDate !== undefined ? { dueDate: row.dueDate } : {}),
      ...(row.durationMin !== undefined ? { durationMin: row.durationMin } : {}),
      ...(row.recurrenceRule !== undefined ? { recurrenceRule: row.recurrenceRule } : {}),
      ...(row.completedAt !== undefined ? { completedAt: row.completedAt } : {}),
      ...(row.spawnedNextNodeId !== undefined
        ? {
            spawnedNextNodeId: row.spawnedNextNodeId
              ? asOutlineNodeId(row.spawnedNextNodeId)
              : null,
          }
        : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    })),
  );

/**
 * Safely parses a JSON column string with a Zod schema, returning `fallback` when empty or invalid.
 */
export function parseJsonWithSchema<T>(
  raw: string | null | undefined,
  schema: z.ZodType<T>,
  fallback: T,
): T {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    const res = schema.safeParse(parsed);
    return res.success ? res.data : fallback;
  } catch {
    return fallback;
  }
}
