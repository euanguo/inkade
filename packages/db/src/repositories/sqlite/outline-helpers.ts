import { and, asc, eq, isNull } from "drizzle-orm";
import {
  createId,
  createOrderKeyBetween,
  extractInlineTags,
  ID_PREFIXES,
  InkadeError,
  type ActorType,
  type AuditBatchId,
  type ExecutionMode,
  type OutlineNode,
} from "@inkade/core";
import { documents, outlineNodes } from "../../schema/sqlite.ts";
import type {
  InsertOutlineNodeDirectInput,
  ResolveOrderKeyOptions,
  UpdateOutlineNodeDirectPatch,
} from "../ports/outline.port.ts";
import {
  addDocumentTagsSync,
  nowIso,
  syncOutgoingLinksSync,
  upsertFtsEntrySync,
  type SqliteRepoContext,
} from "./helpers.ts";
import { mapOutlineNodeRow } from "./mappers.ts";
import { recordOutlinePostMutationRevisionSync } from "./revision-helpers.ts";
import { syncDocumentTasksForDocumentSync } from "./task-sync-helpers.ts";

export function syncOutlineNodeContentEffectsSync(
  ctx: SqliteRepoContext,
  params: {
    readonly workspaceId: string;
    readonly doc: typeof documents.$inferSelect;
    readonly nodeId: string;
    readonly contentMarkdown: string;
    readonly contentText: string;
    readonly noteMarkdown: string;
    readonly noteText: string;
  },
): void {
  const combined = [params.contentMarkdown, params.noteMarkdown].filter(Boolean).join("\n");
  syncOutgoingLinksSync(
    ctx.sqlite,
    ctx.db,
    params.workspaceId,
    params.doc.id,
    params.nodeId,
    combined,
  );
  const tags = extractInlineTags(combined);
  if (tags.length > 0) {
    addDocumentTagsSync(ctx.sqlite, ctx.db, params.doc.id, tags);
    syncDocumentTasksForDocumentSync(ctx, params.workspaceId, params.doc.id);
  }
  upsertFtsEntrySync(ctx.sqlite, {
    entityKey: `nod:${params.nodeId}`,
    workspaceId: params.workspaceId,
    entityType: "outline_node",
    documentId: params.doc.id,
    nodeId: params.nodeId,
    spaceId: params.doc.spaceId,
    kind: params.doc.kind,
    title: params.doc.title,
    body: [params.contentText, params.noteText].filter(Boolean).join(" "),
  });
}

export function collectOutlineSubtreeIdsSync(
  nodes: readonly (typeof outlineNodes.$inferSelect)[],
  rootId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentNodeId) continue;
    const list = children.get(n.parentNodeId) ?? [];
    list.push(n.id);
    children.set(n.parentNodeId, list);
  }
  const subtreeIds: string[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.pop();
    if (!cur || subtreeIds.includes(cur)) continue;
    subtreeIds.push(cur);
    queue.push(...(children.get(cur) ?? []));
  }
  return subtreeIds;
}

export function requireActiveDocSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  documentId: string,
): typeof documents.$inferSelect {
  const doc = ctx.db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
    .get();
  if (!doc || doc.trashedAt !== null) {
    throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
  }
  return doc;
}

export function requireActiveNodeSync(
  ctx: SqliteRepoContext,
  documentId: string,
  nodeId: string,
): typeof outlineNodes.$inferSelect {
  const row = ctx.db
    .select()
    .from(outlineNodes)
    .where(and(eq(outlineNodes.documentId, documentId), eq(outlineNodes.id, nodeId)))
    .get();
  if (!row || row.deletedAt !== null) {
    throw new InkadeError("NOT_FOUND", `Outline node "${nodeId}" not found`);
  }
  return row;
}

export function assertOutlineCycleSync(
  ctx: SqliteRepoContext,
  documentId: string,
  nodeId: string,
  newParentId: string | null,
): void {
  if (newParentId === null) return;
  if (newParentId === nodeId) {
    throw new InkadeError("INVALID_PARENT_CYCLE", "An outline node cannot be its own parent");
  }
  const rows = ctx.db
    .select({
      id: outlineNodes.id,
      parentNodeId: outlineNodes.parentNodeId,
      deletedAt: outlineNodes.deletedAt,
    })
    .from(outlineNodes)
    .where(eq(outlineNodes.documentId, documentId))
    .all();
  const parentMap = new Map(rows.map((r) => [r.id, r]));
  const targetParent = parentMap.get(newParentId);
  if (!targetParent || targetParent.deletedAt !== null) {
    throw new InkadeError("NOT_FOUND", `Parent outline node "${newParentId}" not found`);
  }
  const visited = new Set<string>([nodeId]);
  let cursor: string | null = newParentId;
  while (cursor !== null) {
    if (visited.has(cursor)) {
      throw new InkadeError(
        "INVALID_PARENT_CYCLE",
        `Moving node "${nodeId}" under "${newParentId}" creates a cycle`,
      );
    }
    visited.add(cursor);
    cursor = parentMap.get(cursor)?.parentNodeId ?? null;
  }
}

export function resolveOutlineOrderKeySync(
  ctx: SqliteRepoContext,
  documentId: string,
  parentNodeId: string | null,
  options?: ResolveOrderKeyOptions,
): string {
  if (options?.explicitOrderKey) return options.explicitOrderKey;
  const siblings = ctx.db
    .select({ id: outlineNodes.id, orderKey: outlineNodes.orderKey })
    .from(outlineNodes)
    .where(
      and(
        eq(outlineNodes.documentId, documentId),
        isNull(outlineNodes.deletedAt),
        parentNodeId === null
          ? isNull(outlineNodes.parentNodeId)
          : eq(outlineNodes.parentNodeId, parentNodeId),
      ),
    )
    .orderBy(asc(outlineNodes.orderKey))
    .all()
    .filter((s) => s.id !== options?.excludeNodeId);

  const { afterNodeId, beforeNodeId } = options ?? {};
  if (afterNodeId && beforeNodeId) {
    const a = siblings.findIndex((s) => s.id === afterNodeId);
    const b = siblings.findIndex((s) => s.id === beforeNodeId);
    if (a < 0 || b < 0) {
      throw new InkadeError("NOT_FOUND", "Reference sibling node not found under parent");
    }
    return createOrderKeyBetween(siblings[a]?.orderKey ?? null, siblings[b]?.orderKey ?? null);
  }
  if (afterNodeId) {
    const idx = siblings.findIndex((s) => s.id === afterNodeId);
    if (idx < 0) throw new InkadeError("NOT_FOUND", `Reference sibling "${afterNodeId}" not found`);
    return createOrderKeyBetween(siblings[idx]?.orderKey ?? null, siblings[idx + 1]?.orderKey ?? null);
  }
  if (beforeNodeId) {
    const idx = siblings.findIndex((s) => s.id === beforeNodeId);
    if (idx < 0) throw new InkadeError("NOT_FOUND", `Reference sibling "${beforeNodeId}" not found`);
    return createOrderKeyBetween(
      idx > 0 ? (siblings[idx - 1]?.orderKey ?? null) : null,
      siblings[idx]?.orderKey ?? null,
    );
  }
  return createOrderKeyBetween(siblings.at(-1)?.orderKey ?? null, null);
}

export function insertOutlineNodeRowSync(
  ctx: SqliteRepoContext,
  input: InsertOutlineNodeDirectInput,
): OutlineNode {
  const ts = input.ts ?? nowIso();
  const row: typeof outlineNodes.$inferSelect = {
    id: input.id ?? createId(ID_PREFIXES.outlineNode),
    documentId: input.documentId,
    parentNodeId: input.parentNodeId,
    orderKey: input.orderKey,
    contentMarkdown: input.contentMarkdown,
    contentText: input.contentText,
    noteMarkdown: input.noteMarkdown,
    noteText: input.noteText,
    checked: input.checked,
    collapsed: input.collapsed,
    authorType: input.authorType,
    authorId: input.authorId,
    sourceBindingId: input.sourceBindingId,
    mirrorOfNodeId: input.mirrorOfNodeId,
    rolledOverToDocId: null,
    taskPriority: input.priority ?? null,
    taskScheduledDate: input.scheduledDate ?? null,
    taskScheduledSlot: input.scheduledSlot ?? null,
    taskScheduledStartMin: input.scheduledStartMin ?? null,
    taskDueDate: input.dueDate ?? null,
    taskDurationMin: input.durationMin ?? null,
    taskRecurrenceRule: input.recurrenceRule ?? null,
    taskCompletedAt: input.completedAt ?? null,
    taskSpawnedNextNodeId: input.spawnedNextNodeId ?? null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  ctx.db.insert(outlineNodes).values(row).run();
  const docRow = ctx.db
    .select({ workspaceId: documents.workspaceId })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .get();
  if (docRow && input.checked !== null) {
    syncDocumentTasksForDocumentSync(ctx, docRow.workspaceId, input.documentId);
  }
  return mapOutlineNodeRow(row);
}

export function updateOutlineNodeRowSync(
  ctx: SqliteRepoContext,
  documentId: string,
  nodeId: string,
  patch: UpdateOutlineNodeDirectPatch,
): OutlineNode {
  ctx.db
    .update(outlineNodes)
    .set({
      ...(patch.contentMarkdown !== undefined ? { contentMarkdown: patch.contentMarkdown } : {}),
      ...(patch.contentText !== undefined ? { contentText: patch.contentText } : {}),
      ...(patch.noteMarkdown !== undefined ? { noteMarkdown: patch.noteMarkdown } : {}),
      ...(patch.noteText !== undefined ? { noteText: patch.noteText } : {}),
      ...(patch.checked !== undefined ? { checked: patch.checked } : {}),
      ...(patch.collapsed !== undefined ? { collapsed: patch.collapsed } : {}),
      ...(patch.sourceBindingId !== undefined ? { sourceBindingId: patch.sourceBindingId } : {}),
      ...(patch.mirrorOfNodeId !== undefined ? { mirrorOfNodeId: patch.mirrorOfNodeId } : {}),
      ...(patch.rolledOverToDocId !== undefined ? { rolledOverToDocId: patch.rolledOverToDocId } : {}),
      ...(patch.priority !== undefined ? { taskPriority: patch.priority } : {}),
      ...(patch.scheduledDate !== undefined ? { taskScheduledDate: patch.scheduledDate } : {}),
      ...(patch.scheduledSlot !== undefined ? { taskScheduledSlot: patch.scheduledSlot } : {}),
      ...(patch.scheduledStartMin !== undefined ? { taskScheduledStartMin: patch.scheduledStartMin } : {}),
      ...(patch.dueDate !== undefined ? { taskDueDate: patch.dueDate } : {}),
      ...(patch.durationMin !== undefined ? { taskDurationMin: patch.durationMin } : {}),
      ...(patch.recurrenceRule !== undefined ? { taskRecurrenceRule: patch.recurrenceRule } : {}),
      ...(patch.completedAt !== undefined ? { taskCompletedAt: patch.completedAt } : {}),
      ...(patch.spawnedNextNodeId !== undefined ? { taskSpawnedNextNodeId: patch.spawnedNextNodeId } : {}),
      updatedAt: patch.updatedAt,
    })
    .where(and(eq(outlineNodes.documentId, documentId), eq(outlineNodes.id, nodeId)))
    .run();
  const docRow = ctx.db
    .select({ workspaceId: documents.workspaceId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .get();
  if (docRow) {
    syncDocumentTasksForDocumentSync(ctx, docRow.workspaceId, documentId);
  }
  return mapOutlineNodeRow(requireActiveNodeSync(ctx, documentId, nodeId));
}

export function recordOutlineOrTouchDocSync(
  ctx: SqliteRepoContext,
  doc: typeof documents.$inferSelect,
  actorType: ActorType,
  actorId: string | null,
  summary: string,
  ts: string,
  updateLastEditedBy = true,
  auditContext?: {
    readonly batchId?: AuditBatchId | null | undefined;
    readonly executionMode?: ExecutionMode | undefined;
  },
): void {
  if (doc.kind === "outline") {
    recordOutlinePostMutationRevisionSync(ctx.db, {
      documentId: doc.id,
      currentVersion: doc.version,
      actorType,
      actorId,
      changeSummary: summary,
      batchId: auditContext?.batchId,
      executionMode: auditContext?.executionMode,
      ts,
      updateLastEditedBy,
    });
  } else {
    ctx.db.update(documents).set({ updatedAt: ts }).where(eq(documents.id, doc.id)).run();
  }
}
