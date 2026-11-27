import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  asDocumentId,
  asOutlineNodeId,
  asSpaceId,
  InkadeError,
  markdownToPlainText,
  slotForScheduledStartMin,
  type ActorType,
  type AuditBatchId,
  type CreateOutlineNodeInput,
  type DocumentId,
  type DocumentKind,
  type DocumentTaskRecord,
  type ExecutionMode,
  type MoveOutlineNodeInput,
  type OutlineNode,
  type UpdateOutlineNodeInput,
} from "@inkade/core";
import { documentLinks, documents, outlineNodes } from "../../schema/sqlite.ts";
import type {
  IndexedDocumentTaskRow,
  InsertOutlineNodeDirectInput,
  ListDocumentTasksFilter,
  ListOutlineNodesOptions,
  OutlineRepo,
  ResolveOrderKeyOptions,
  SearchOutlineNodesOptions,
  UpdateOutlineNodeDirectPatch,
  WorkspaceMirrorNodePair,
  WorkspaceOutlineNodeMatch,
} from "../ports/outline.port.ts";
import { nowIso, syncToPromise, type SqliteRepoContext } from "./helpers.ts";
import { mapOutlineNodeRow } from "./mappers.ts";
import {
  assertOutlineCycleSync,
  collectOutlineSubtreeIdsSync,
  insertOutlineNodeRowSync,
  recordOutlineOrTouchDocSync,
  requireActiveDocSync,
  requireActiveNodeSync,
  resolveOutlineOrderKeySync,
  syncOutlineNodeContentEffectsSync,
  updateOutlineNodeRowSync,
} from "./outline-helpers.ts";
import { ensureOutlineBaselineRevisionSync } from "./revision-helpers.ts";
import {
  getDocumentTaskByIdSync,
  listDocumentTasksSync,
  syncDocumentTasksForDocumentSync,
} from "./task-sync-helpers.ts";

export class SqliteOutlineRepo implements OutlineRepo {
  constructor(private readonly ctx: SqliteRepoContext) {}

  listOutlineNodes(documentId: string, options?: ListOutlineNodesOptions): Promise<readonly OutlineNode[]> {
    return syncToPromise(() => {
      const conds = [eq(outlineNodes.documentId, documentId)];
      if (!options?.includeDeleted) conds.push(isNull(outlineNodes.deletedAt));
      return this.ctx.db
        .select()
        .from(outlineNodes)
        .where(and(...conds))
        .orderBy(asc(outlineNodes.orderKey), asc(outlineNodes.id))
        .all()
        .map(mapOutlineNodeRow);
    });
  }

  getOutlineNodeById(documentId: string, nodeId: string): Promise<OutlineNode | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(outlineNodes)
        .where(and(eq(outlineNodes.documentId, documentId), eq(outlineNodes.id, nodeId)))
        .get();
      return row ? mapOutlineNodeRow(row) : null;
    });
  }

  findDocumentIdByNodeId(workspaceId: string, nodeId: string): Promise<DocumentId | null> {
    return syncToPromise(() => {
      const node = this.ctx.db
        .select({ documentId: outlineNodes.documentId })
        .from(outlineNodes)
        .where(eq(outlineNodes.id, nodeId))
        .get();
      if (!node) return null;
      const doc = this.ctx.db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, node.documentId)))
        .get();
      return doc ? (doc.id as DocumentId) : null;
    });
  }

  createOutlineNode(
    workspaceId: string,
    input: CreateOutlineNodeInput,
    options?: {
      readonly id?: string | undefined;
      readonly batchId?: AuditBatchId | null | undefined;
      readonly executionMode?: ExecutionMode | undefined;
    },
  ): Promise<OutlineNode> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const doc = requireActiveDocSync(this.ctx, workspaceId, input.documentId);
        const parentNodeId = input.parentNodeId ?? null;
        if (parentNodeId !== null) requireActiveNodeSync(this.ctx, input.documentId, parentNodeId);
        const orderKey = resolveOutlineOrderKeySync(this.ctx, input.documentId, parentNodeId, {
          afterNodeId: input.afterNodeId,
          beforeNodeId: input.beforeNodeId,
          explicitOrderKey: input.orderKey,
        });
        const ts = nowIso();
        if (doc.kind === "outline") ensureOutlineBaselineRevisionSync(this.ctx.db, doc, ts);

        const contentText = markdownToPlainText(input.contentMarkdown);
        const noteMarkdown = input.noteMarkdown ?? "";
        const noteText = noteMarkdown ? markdownToPlainText(noteMarkdown) : "";
        const node = insertOutlineNodeRowSync(this.ctx, {
          id: options?.id ? (options.id as OutlineNode["id"]) : undefined,
          documentId: input.documentId,
          parentNodeId,
          orderKey,
          contentMarkdown: input.contentMarkdown,
          contentText,
          noteMarkdown,
          noteText,
          checked: input.checked ?? null,
          collapsed: input.collapsed ?? false,
          authorType: input.authorType ?? "human",
          authorId: input.authorId ?? null,
          sourceBindingId: input.sourceBindingId ?? null,
          mirrorOfNodeId: input.mirrorOfNodeId ?? null,
          priority: input.priority ?? null,
          scheduledDate:
            input.scheduledDate !== undefined
              ? input.scheduledDate
              : input.checked !== null && input.checked !== undefined
                ? doc.dailyDate
                : null,
          scheduledSlot:
            input.scheduledSlot !== undefined
              ? input.scheduledSlot
              : input.scheduledStartMin !== undefined && input.scheduledStartMin !== null
                ? slotForScheduledStartMin(input.scheduledStartMin)
                : null,
          scheduledStartMin: input.scheduledStartMin ?? null,
          dueDate: input.dueDate ?? null,
          durationMin: input.durationMin ?? null,
          recurrenceRule: input.recurrenceRule ?? null,
          completedAt: input.checked === true ? ts : null,
          ts,
        });
        syncOutlineNodeContentEffectsSync(this.ctx, {
          workspaceId,
          doc,
          nodeId: node.id,
          contentMarkdown: input.contentMarkdown,
          contentText,
          noteMarkdown,
          noteText,
        });
        recordOutlineOrTouchDocSync(
          this.ctx,
          doc,
          node.authorType,
          node.authorId,
          "Added outline node",
          ts,
          true,
          { batchId: options?.batchId, executionMode: options?.executionMode },
        );
        return node;
      }),
    );
  }

  updateOutlineNode(
    workspaceId: string,
    documentId: string,
    nodeId: string,
    input: UpdateOutlineNodeInput,
    options?: {
      readonly actorType?: ActorType | undefined;
      readonly actorId?: string | null | undefined;
      readonly batchId?: AuditBatchId | null | undefined;
      readonly executionMode?: ExecutionMode | undefined;
    },
  ): Promise<OutlineNode> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const doc = requireActiveDocSync(this.ctx, workspaceId, documentId);
        const current = requireActiveNodeSync(this.ctx, documentId, nodeId);
        const ts = nowIso();
        if (doc.kind === "outline") ensureOutlineBaselineRevisionSync(this.ctx.db, doc, ts);

        const nextMd = input.contentMarkdown ?? current.contentMarkdown;
        const mdChanged = input.contentMarkdown !== undefined && nextMd !== current.contentMarkdown;
        const nextText = mdChanged ? markdownToPlainText(nextMd) : current.contentText;
        const nextNote = input.noteMarkdown ?? current.noteMarkdown;
        const noteChanged = input.noteMarkdown !== undefined && nextNote !== current.noteMarkdown;
        const nextNoteText = noteChanged ? (nextNote ? markdownToPlainText(nextNote) : "") : current.noteText;
        const nextCompletedAt =
          input.checked === undefined
            ? current.taskCompletedAt
            : input.checked === true
              ? current.checked === true
                ? (current.taskCompletedAt ?? ts)
                : ts
              : null;
        const becomingTaskInDaily =
          current.checked === null &&
          input.checked !== undefined &&
          input.checked !== null &&
          input.scheduledDate === undefined &&
          current.taskScheduledDate === null &&
          doc.dailyDate !== null;

        const updated = updateOutlineNodeRowSync(this.ctx, documentId, nodeId, {
          contentMarkdown: nextMd,
          contentText: nextText,
          noteMarkdown: nextNote,
          noteText: nextNoteText,
          checked: input.checked !== undefined ? input.checked : current.checked,
          collapsed: input.collapsed ?? current.collapsed,
          sourceBindingId: input.sourceBindingId !== undefined ? input.sourceBindingId : current.sourceBindingId,
          mirrorOfNodeId: input.mirrorOfNodeId !== undefined ? input.mirrorOfNodeId : current.mirrorOfNodeId,
          rolledOverToDocId: input.rolledOverToDocId !== undefined ? input.rolledOverToDocId : current.rolledOverToDocId,
          priority: input.priority !== undefined ? input.priority : (current.taskPriority as OutlineNode["priority"]),
          scheduledDate: input.scheduledDate !== undefined ? input.scheduledDate : becomingTaskInDaily ? doc.dailyDate : current.taskScheduledDate,
          scheduledSlot:
            input.scheduledSlot !== undefined
              ? input.scheduledSlot
              : input.scheduledStartMin !== undefined && input.scheduledStartMin !== null
                ? slotForScheduledStartMin(input.scheduledStartMin)
                : input.scheduledDate === null
                  ? null
                  : (current.taskScheduledSlot as OutlineNode["scheduledSlot"]),
          scheduledStartMin:
            input.scheduledStartMin !== undefined
              ? input.scheduledStartMin
              : input.scheduledDate === null
                ? null
                : current.taskScheduledStartMin,
          dueDate: input.dueDate !== undefined ? input.dueDate : current.taskDueDate,
          durationMin: input.durationMin !== undefined ? input.durationMin : current.taskDurationMin,
          recurrenceRule: input.recurrenceRule !== undefined ? input.recurrenceRule : current.taskRecurrenceRule,
          completedAt: nextCompletedAt,
          spawnedNextNodeId: input.spawnedNextNodeId !== undefined ? input.spawnedNextNodeId : current.taskSpawnedNextNodeId,
          updatedAt: ts,
        });

        if (mdChanged || noteChanged) {
          syncOutlineNodeContentEffectsSync(this.ctx, {
            workspaceId, doc, nodeId, contentMarkdown: nextMd, contentText: nextText, noteMarkdown: nextNote, noteText: nextNoteText,
          });
        }
        recordOutlineOrTouchDocSync(
          this.ctx, doc, options?.actorType ?? "human", options?.actorId ?? null,
          "Updated outline node", ts, options?.actorType !== undefined,
          { batchId: options?.batchId, executionMode: options?.executionMode },
        );
        return updated;
      }),
    );
  }

  moveOutlineNode(
    workspaceId: string,
    documentId: string,
    nodeId: string,
    input: MoveOutlineNodeInput,
    options?: {
      readonly actorType?: ActorType | undefined;
      readonly actorId?: string | null | undefined;
      readonly batchId?: AuditBatchId | null | undefined;
      readonly executionMode?: ExecutionMode | undefined;
    },
  ): Promise<OutlineNode> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const doc = requireActiveDocSync(this.ctx, workspaceId, documentId);
        requireActiveNodeSync(this.ctx, documentId, nodeId);
        assertOutlineCycleSync(this.ctx, documentId, nodeId, input.parentNodeId);
        const nextOrderKey = resolveOutlineOrderKeySync(this.ctx, documentId, input.parentNodeId, {
          excludeNodeId: nodeId, afterNodeId: input.afterNodeId, beforeNodeId: input.beforeNodeId, explicitOrderKey: input.orderKey,
        });
        const ts = nowIso();
        if (doc.kind === "outline") ensureOutlineBaselineRevisionSync(this.ctx.db, doc, ts);
        this.ctx.db
          .update(outlineNodes)
          .set({ parentNodeId: input.parentNodeId, orderKey: nextOrderKey, updatedAt: ts })
          .where(and(eq(outlineNodes.documentId, documentId), eq(outlineNodes.id, nodeId)))
          .run();
        recordOutlineOrTouchDocSync(
          this.ctx, doc, options?.actorType ?? "human", options?.actorId ?? null,
          "Moved outline node", ts, options?.actorType !== undefined,
          { batchId: options?.batchId, executionMode: options?.executionMode },
        );
        return mapOutlineNodeRow(requireActiveNodeSync(this.ctx, documentId, nodeId));
      }),
    );
  }

  softDeleteOutlineNode(
    workspaceId: string,
    documentId: string,
    nodeId: string,
    options?: {
      readonly actorType?: ActorType | undefined;
      readonly actorId?: string | null | undefined;
      readonly batchId?: AuditBatchId | null | undefined;
      readonly executionMode?: ExecutionMode | undefined;
    },
  ): Promise<readonly OutlineNode[]> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const doc = requireActiveDocSync(this.ctx, workspaceId, documentId);
        const allNodes = this.ctx.db
          .select()
          .from(outlineNodes)
          .where(and(eq(outlineNodes.documentId, documentId), isNull(outlineNodes.deletedAt)))
          .all();
        const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
        if (!nodeMap.has(nodeId)) throw new InkadeError("NOT_FOUND", `Outline node "${nodeId}" not found`);

        const subtreeIds = collectOutlineSubtreeIdsSync(allNodes, nodeId);
        const ts = nowIso();
        if (doc.kind === "outline") ensureOutlineBaselineRevisionSync(this.ctx.db, doc, ts);
        this.ctx.db.update(outlineNodes).set({ deletedAt: ts, updatedAt: ts }).where(inArray(outlineNodes.id, subtreeIds)).run();
        for (const id of subtreeIds) {
          this.ctx.sqlite.query("DELETE FROM search_fts WHERE entity_key = ?").run(`nod:${id}`);
          this.ctx.db.delete(documentLinks).where(eq(documentLinks.sourceNodeId, id)).run();
        }
        syncDocumentTasksForDocumentSync(this.ctx, workspaceId, documentId);
        recordOutlineOrTouchDocSync(
          this.ctx, doc, options?.actorType ?? "human", options?.actorId ?? null,
          `Deleted outline subtree (${subtreeIds.length} nodes)`, ts, options?.actorType !== undefined,
          { batchId: options?.batchId, executionMode: options?.executionMode },
        );
        return subtreeIds
          .map((id) => nodeMap.get(id))
          .filter((n): n is typeof outlineNodes.$inferSelect => n !== undefined)
          .map((n) => mapOutlineNodeRow({ ...n, deletedAt: ts, updatedAt: ts }));
      }),
    );
  }

  assertNoOutlineNodeCycle(documentId: string, nodeId: string, newParentNodeId: string | null): Promise<void> {
    return syncToPromise(() => assertOutlineCycleSync(this.ctx, documentId, nodeId, newParentNodeId));
  }

  resolveOrderKeyForParent(documentId: string, parentNodeId: string | null, options?: ResolveOrderKeyOptions): Promise<string> {
    return syncToPromise(() => resolveOutlineOrderKeySync(this.ctx, documentId, parentNodeId, options));
  }

  insertOutlineNodeDirect(input: InsertOutlineNodeDirectInput): Promise<OutlineNode> {
    return syncToPromise(() => insertOutlineNodeRowSync(this.ctx, input));
  }

  updateOutlineNodeDirect(documentId: string, nodeId: string, patch: UpdateOutlineNodeDirectPatch): Promise<OutlineNode> {
    return syncToPromise(() => updateOutlineNodeRowSync(this.ctx, documentId, nodeId, patch));
  }

  moveOutlineNodeDirect(
    documentId: string, nodeId: string, parentNodeId: string | null, orderKey: string, updatedAt: string,
  ): Promise<OutlineNode> {
    return syncToPromise(() => {
      this.ctx.db
        .update(outlineNodes)
        .set({ parentNodeId, orderKey, updatedAt })
        .where(and(eq(outlineNodes.documentId, documentId), eq(outlineNodes.id, nodeId)))
        .run();
      return mapOutlineNodeRow(requireActiveNodeSync(this.ctx, documentId, nodeId));
    });
  }

  softDeleteOutlineNodesDirect(documentId: string, nodeIds: readonly string[], deletedAt: string): Promise<void> {
    return syncToPromise(() => {
      if (nodeIds.length === 0) return;
      this.ctx.db
        .update(outlineNodes)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(eq(outlineNodes.documentId, documentId), inArray(outlineNodes.id, [...nodeIds])))
        .run();
      const docRow = this.ctx.db
        .select({ workspaceId: documents.workspaceId })
        .from(documents)
        .where(eq(documents.id, documentId))
        .get();
      if (docRow) {
        syncDocumentTasksForDocumentSync(this.ctx, docRow.workspaceId, documentId);
      }
    });
  }

  markNodesRolledOver(nodeIds: readonly string[], toDocumentId: string, updatedAt: string): Promise<void> {
    return syncToPromise(() => {
      if (nodeIds.length === 0) return;
      this.ctx.db.update(outlineNodes).set({ rolledOverToDocId: toDocumentId, updatedAt }).where(inArray(outlineNodes.id, [...nodeIds])).run();
    });
  }

  upsertOutlineNodeFromSnapshot(
    documentId: string,
    snap: OutlineNode,
    computed: { readonly contentText: string; readonly noteMarkdown: string; readonly noteText: string; readonly updatedAt: string },
  ): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: outlineNodes.id })
        .from(outlineNodes)
        .where(and(eq(outlineNodes.documentId, documentId), eq(outlineNodes.id, snap.id)))
        .get();
      const baseFields = {
        parentNodeId: snap.parentNodeId, orderKey: snap.orderKey, contentMarkdown: snap.contentMarkdown,
        contentText: computed.contentText, noteMarkdown: computed.noteMarkdown, noteText: computed.noteText,
        checked: snap.checked, collapsed: snap.collapsed, sourceBindingId: snap.sourceBindingId,
        mirrorOfNodeId: snap.mirrorOfNodeId ?? null, rolledOverToDocId: snap.rolledOverToDocId ?? null,
        taskPriority: snap.priority ?? null,
        taskScheduledDate: snap.scheduledDate ?? null,
        taskScheduledSlot: snap.scheduledSlot ?? null,
        taskScheduledStartMin: snap.scheduledStartMin ?? null,
        taskDueDate: snap.dueDate ?? null,
        taskDurationMin: snap.durationMin ?? null,
        taskRecurrenceRule: snap.recurrenceRule ?? null,
        taskCompletedAt: snap.completedAt ?? null,
        taskSpawnedNextNodeId: snap.spawnedNextNodeId ?? null,
        deletedAt: null, updatedAt: computed.updatedAt,
      };
      if (existing) {
        this.ctx.db.update(outlineNodes).set(baseFields).where(eq(outlineNodes.id, snap.id)).run();
      } else {
        this.ctx.db
          .insert(outlineNodes)
          .values({
            ...baseFields, id: snap.id, documentId, authorType: snap.authorType, authorId: snap.authorId,
            createdAt: snap.createdAt || computed.updatedAt,
          })
          .run();
      }
      const docRow = this.ctx.db
        .select({ workspaceId: documents.workspaceId })
        .from(documents)
        .where(eq(documents.id, documentId))
        .get();
      if (docRow) {
        syncDocumentTasksForDocumentSync(this.ctx, docRow.workspaceId, documentId);
      }
    });
  }

  syncDocumentTasksForDocument(workspaceId: string, documentId: string): Promise<readonly DocumentTaskRecord[]> {
    return syncToPromise(() => syncDocumentTasksForDocumentSync(this.ctx, workspaceId, documentId));
  }

  listDocumentTasks(
    workspaceId: string,
    filter?: ListDocumentTasksFilter,
  ): Promise<readonly IndexedDocumentTaskRow[]> {
    return syncToPromise(() => listDocumentTasksSync(this.ctx, workspaceId, filter));
  }

  getDocumentTaskById(workspaceId: string, taskId: string): Promise<IndexedDocumentTaskRow | null> {
    return syncToPromise(() => getDocumentTaskByIdSync(this.ctx, workspaceId, taskId));
  }

  findOutlineNodeByIdInWorkspace(
    workspaceId: string,
    nodeId: string,
  ): Promise<WorkspaceOutlineNodeMatch | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select({
          node: outlineNodes,
          documentId: documents.id,
          documentTitle: documents.title,
          spaceId: documents.spaceId,
          documentKind: documents.kind,
        })
        .from(outlineNodes)
        .innerJoin(documents, eq(outlineNodes.documentId, documents.id))
        .where(
          and(
            eq(documents.workspaceId, workspaceId),
            isNull(documents.trashedAt),
            eq(outlineNodes.id, nodeId),
            isNull(outlineNodes.deletedAt),
          ),
        )
        .get();
      if (!row) return null;
      return {
        node: mapOutlineNodeRow(row.node),
        documentId: asDocumentId(row.documentId),
        documentTitle: row.documentTitle,
        spaceId: asSpaceId(row.spaceId),
        documentKind: row.documentKind as DocumentKind,
      };
    });
  }

  listMirrorNodesOf(
    workspaceId: string,
    sourceNodeId: string,
  ): Promise<readonly WorkspaceOutlineNodeMatch[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select({
          node: outlineNodes,
          documentId: documents.id,
          documentTitle: documents.title,
          spaceId: documents.spaceId,
          documentKind: documents.kind,
        })
        .from(outlineNodes)
        .innerJoin(documents, eq(outlineNodes.documentId, documents.id))
        .where(
          and(
            eq(documents.workspaceId, workspaceId),
            isNull(documents.trashedAt),
            eq(outlineNodes.mirrorOfNodeId, sourceNodeId),
            isNull(outlineNodes.deletedAt),
          ),
        )
        .all();
      return rows.map((row) => ({
        node: mapOutlineNodeRow(row.node),
        documentId: asDocumentId(row.documentId),
        documentTitle: row.documentTitle,
        spaceId: asSpaceId(row.spaceId),
        documentKind: row.documentKind as DocumentKind,
      }));
    });
  }

  searchOutlineNodes(
    workspaceId: string,
    query: string,
    options?: SearchOutlineNodesOptions,
  ): Promise<readonly WorkspaceOutlineNodeMatch[]> {
    return syncToPromise(() => {
      if (options?.spaceIds !== undefined && options.spaceIds.length === 0) return [];
      if (options?.allowedKinds !== undefined && options.allowedKinds.length === 0) return [];
      const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
      const cleanQ = query.trim().toLowerCase();

      const conds = [
        eq(documents.workspaceId, workspaceId),
        isNull(documents.trashedAt),
        isNull(outlineNodes.deletedAt),
      ];
      if (options?.spaceIds && options.spaceIds.length > 0) {
        conds.push(inArray(documents.spaceId, [...options.spaceIds]));
      }
      if (options?.allowedKinds && options.allowedKinds.length > 0) {
        conds.push(inArray(documents.kind, [...options.allowedKinds]));
      }

      const rows = this.ctx.db
        .select({
          node: outlineNodes,
          documentId: documents.id,
          documentTitle: documents.title,
          spaceId: documents.spaceId,
          documentKind: documents.kind,
          propertiesJson: documents.propertiesJson,
        })
        .from(outlineNodes)
        .innerJoin(documents, eq(outlineNodes.documentId, documents.id))
        .where(and(...conds))
        .all();

      const matches: WorkspaceOutlineNodeMatch[] = [];
      for (const row of rows) {
        if (row.propertiesJson && row.propertiesJson.includes('"systemRole"')) continue;
        if (
          cleanQ &&
          !row.node.contentText.toLowerCase().includes(cleanQ) &&
          !row.node.contentMarkdown.toLowerCase().includes(cleanQ) &&
          !row.documentTitle.toLowerCase().includes(cleanQ) &&
          !row.node.id.toLowerCase().includes(cleanQ)
        ) {
          continue;
        }
        matches.push({
          node: mapOutlineNodeRow(row.node),
          documentId: asDocumentId(row.documentId),
          documentTitle: row.documentTitle,
          spaceId: asSpaceId(row.spaceId),
          documentKind: row.documentKind as DocumentKind,
        });
        if (matches.length >= limit) break;
      }
      return matches;
    });
  }

  listWorkspaceMirrorNodePairs(workspaceId: string): Promise<readonly WorkspaceMirrorNodePair[]> {
    return syncToPromise(() => {
      const mirrorRows = this.ctx.db
        .select({
          mirrorDocumentId: outlineNodes.documentId,
          mirrorOfNodeId: outlineNodes.mirrorOfNodeId,
        })
        .from(outlineNodes)
        .innerJoin(documents, eq(outlineNodes.documentId, documents.id))
        .where(
          and(
            eq(documents.workspaceId, workspaceId),
            isNull(documents.trashedAt),
            isNull(outlineNodes.deletedAt),
            isNotNull(outlineNodes.mirrorOfNodeId),
          ),
        )
        .all();

      if (mirrorRows.length === 0) return [];
      const targetNodeIds = [
        ...new Set(
          mirrorRows
            .map((r) => r.mirrorOfNodeId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      ];
      if (targetNodeIds.length === 0) return [];

      const targetRows = this.ctx.db
        .select({
          nodeId: outlineNodes.id,
          documentId: outlineNodes.documentId,
        })
        .from(outlineNodes)
        .innerJoin(documents, eq(outlineNodes.documentId, documents.id))
        .where(
          and(
            eq(documents.workspaceId, workspaceId),
            isNull(documents.trashedAt),
            isNull(outlineNodes.deletedAt),
            inArray(outlineNodes.id, targetNodeIds),
          ),
        )
        .all();

      const docByNodeId = new Map(targetRows.map((row) => [row.nodeId, row.documentId]));
      const seen = new Set<string>();
      const pairs: WorkspaceMirrorNodePair[] = [];
      for (const row of mirrorRows) {
        if (!row.mirrorOfNodeId) continue;
        const targetDocId = docByNodeId.get(row.mirrorOfNodeId);
        if (!targetDocId || targetDocId === row.mirrorDocumentId) continue;
        const key = `${row.mirrorDocumentId}|${targetDocId}|${row.mirrorOfNodeId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({
          mirrorDocumentId: asDocumentId(row.mirrorDocumentId),
          targetDocumentId: asDocumentId(targetDocId),
          mirrorOfNodeId: asOutlineNodeId(row.mirrorOfNodeId),
        });
      }
      return pairs;
    });
  }
}
