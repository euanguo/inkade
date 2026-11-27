import {
  asOutlineNodeId,
  createId,
  extractInlineTags,
  ID_PREFIXES,
  InkadeError,
  markdownToPlainText,
  type ActorType,
  type ApiTokenId,
  type AuditBatchId,
  type BatchOutlineNodesResult,
  type DocumentRecord,
  type ExecutionMode,
  type OutlineBatchOperation,
  type OutlineNode,
  type OutlineNodeId,
  type RevisionId,
  type UserId,
  type WorkspaceId,
} from "@inkade/core";
import type {
  DocumentRepo,
  OutlineRepo,
  OutlineRevisionRestoreResult,
  RevisionLinkRepo,
  SearchConfigRepo,
  TransactionRunner,
} from "@inkade/db";

export interface OutlineTxRepos {
  readonly tx: TransactionRunner;
  readonly documentRepo: DocumentRepo;
  readonly outlineRepo: OutlineRepo;
  readonly revisionLinkRepo: RevisionLinkRepo;
  readonly searchConfigRepo: SearchConfigRepo;
}

export interface OutlineTxActorOptions {
  readonly actorType?: ActorType | undefined;
  readonly actorId?: UserId | ApiTokenId | string | null | undefined;
  readonly batchId?: AuditBatchId | null | undefined;
  readonly executionMode?: ExecutionMode | undefined;
}

async function syncNodeSideEffects(
  repos: Pick<OutlineTxRepos, "revisionLinkRepo" | "searchConfigRepo">,
  workspaceId: WorkspaceId,
  doc: Pick<DocumentRecord, "id" | "spaceId" | "kind" | "title">,
  node: OutlineNode,
  inlineTags: Set<string>,
): Promise<void> {
  const combinedMarkdown = [node.contentMarkdown, node.noteMarkdown].filter(Boolean).join("\n");
  for (const tag of extractInlineTags(combinedMarkdown)) {
    inlineTags.add(tag);
  }
  await repos.revisionLinkRepo.syncOutgoingLinks(
    workspaceId,
    doc.id,
    node.id,
    combinedMarkdown,
  );
  await repos.searchConfigRepo.upsertFtsEntry({
    entityKey: `nod:${node.id}`,
    workspaceId,
    entityType: "outline_node",
    documentId: doc.id,
    nodeId: node.id,
    spaceId: doc.spaceId,
    kind: doc.kind,
    title: doc.title,
    body: [node.contentText, node.noteText].filter(Boolean).join(" "),
  });
}

function collectSubtreeIds(
  rootId: string,
  nodeMap: ReadonlyMap<string, OutlineNode>,
): OutlineNodeId[] {
  const result: OutlineNodeId[] = [asOutlineNodeId(rootId)];
  const visited = new Set<string>([rootId]);
  const childrenByParent = new Map<string, OutlineNode[]>();
  for (const node of nodeMap.values()) {
    if (!node.parentNodeId) continue;
    const list = childrenByParent.get(node.parentNodeId);
    if (list) list.push(node);
    else childrenByParent.set(node.parentNodeId, [node]);
  }
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = childrenByParent.get(parentId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      result.push(child.id);
      queue.push(child.id);
    }
  }
  return result;
}

function orderSnapshotTopologically(snapshot: readonly OutlineNode[]): OutlineNode[] {
  const byId = new Set(snapshot.map((n) => n.id));
  const sorted = [...snapshot].sort(
    (a, b) => a.orderKey.localeCompare(b.orderKey) || a.id.localeCompare(b.id),
  );
  const childrenByParent = new Map<string | null, OutlineNode[]>();
  for (const node of sorted) {
    const parentKey = node.parentNodeId && byId.has(node.parentNodeId) ? node.parentNodeId : null;
    const list = childrenByParent.get(parentKey);
    if (list) list.push(node);
    else childrenByParent.set(parentKey, [node]);
  }

  const ordered: OutlineNode[] = [];
  const queue: Array<string | null> = [null];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const node of childrenByParent.get(parentId) ?? []) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      ordered.push(node);
      queue.push(node.id);
    }
  }
  return ordered;
}

export async function batchMutateOutlineInTx(
  repos: OutlineTxRepos,
  workspaceId: WorkspaceId,
  doc: DocumentRecord,
  operations: readonly OutlineBatchOperation[],
  options: OutlineTxActorOptions = {},
): Promise<BatchOutlineNodesResult> {
  return repos.tx.runInTx(async () => {
    const now = new Date().toISOString();
    const actorType: ActorType = options.actorType ?? "human";
    const actorId = options.actorId ?? null;
    const existingNodes = await repos.outlineRepo.listOutlineNodes(doc.id);
    const nodeMap = new Map<string, OutlineNode>(existingNodes.map((n) => [n.id, n]));

    if (operations.length > 0) {
      await repos.revisionLinkRepo.ensureOutlineBaselineRevision(doc, now);
    }

    const tempIdMap: Record<string, OutlineNodeId> = {};
    const created: OutlineNode[] = [];
    const updated: OutlineNode[] = [];
    const moved: OutlineNode[] = [];
    const deletedIds: OutlineNodeId[] = [];
    const inlineTags = new Set<string>();

    const resolveOptionalId = (raw?: string | null): string | null => {
      if (!raw) return null;
      return tempIdMap[raw] ?? raw;
    };
    const resolveRequiredId = (raw: string): string => tempIdMap[raw] ?? raw;

    for (const op of operations) {
      if (op.op === "create") {
        const parentNodeId = resolveOptionalId(op.parentNodeId);
        const orderKey = await repos.outlineRepo.resolveOrderKeyForParent(doc.id, parentNodeId, {
          afterNodeId: resolveOptionalId(op.afterNodeId),
          beforeNodeId: resolveOptionalId(op.beforeNodeId),
          explicitOrderKey: op.orderKey,
        });
        const nodeId = createId(ID_PREFIXES.outlineNode);
        const contentMarkdown = op.contentMarkdown;
        const noteMarkdown = op.noteMarkdown ?? "";
        const checked = op.checked ?? null;
        const node = await repos.outlineRepo.insertOutlineNodeDirect({
          id: nodeId,
          documentId: doc.id,
          parentNodeId,
          orderKey,
          contentMarkdown,
          contentText: markdownToPlainText(contentMarkdown),
          noteMarkdown,
          noteText: markdownToPlainText(noteMarkdown),
          checked,
          collapsed: op.collapsed ?? false,
          authorType: op.authorType ?? (actorType === "agent" ? "agent" : "human"),
          authorId: op.authorId ?? actorId,
          sourceBindingId: op.sourceBindingId ?? null,
          mirrorOfNodeId: resolveOptionalId(op.mirrorOfNodeId),
          priority: op.priority ?? null,
          scheduledDate:
            op.scheduledDate !== undefined
              ? op.scheduledDate
              : checked !== null
                ? doc.dailyDate
                : null,
          scheduledSlot: op.scheduledSlot ?? null,
          scheduledStartMin: op.scheduledStartMin ?? null,
          dueDate: op.dueDate ?? null,
          durationMin: op.durationMin ?? null,
          recurrenceRule: op.recurrenceRule ?? null,
          completedAt: checked === true ? now : null,
          spawnedNextNodeId: null,
          ts: now,
        });

        if (op.tempId) {
          tempIdMap[op.tempId] = node.id;
        }
        nodeMap.set(node.id, node);
        created.push(node);
        await syncNodeSideEffects(repos, workspaceId, doc, node, inlineTags);
        continue;
      }

      if (op.op === "update") {
        const targetId = resolveRequiredId(op.nodeId);
        const existing = nodeMap.get(targetId);
        if (!existing) {
          throw new InkadeError("NOT_FOUND", `Outline node "${op.nodeId}" not found`);
        }

        const resolvedMirrorId =
          op.mirrorOfNodeId !== undefined ? resolveOptionalId(op.mirrorOfNodeId) : undefined;
        if (resolvedMirrorId === targetId) {
          throw new InkadeError("INVALID_PARENT_CYCLE", `Outline node "${targetId}" cannot mirror itself`);
        }

        const nextContentMd = op.contentMarkdown;
        const nextNoteMd = op.noteMarkdown;
        const updatedNode = await repos.outlineRepo.updateOutlineNodeDirect(doc.id, targetId, {
          ...(nextContentMd !== undefined
            ? {
                contentMarkdown: nextContentMd,
                contentText: markdownToPlainText(nextContentMd),
              }
            : {}),
          ...(nextNoteMd !== undefined
            ? {
                noteMarkdown: nextNoteMd,
                noteText: markdownToPlainText(nextNoteMd),
              }
            : {}),
          ...(op.checked !== undefined
            ? {
                checked: op.checked,
                completedAt: op.checked === true ? (existing.completedAt ?? now) : null,
              }
            : {}),
          ...(op.collapsed !== undefined ? { collapsed: op.collapsed } : {}),
          ...(op.sourceBindingId !== undefined ? { sourceBindingId: op.sourceBindingId } : {}),
          ...(op.mirrorOfNodeId !== undefined
            ? { mirrorOfNodeId: resolvedMirrorId }
            : {}),
          ...(op.rolledOverToDocId !== undefined
            ? { rolledOverToDocId: op.rolledOverToDocId }
            : {}),
          ...(op.priority !== undefined ? { priority: op.priority } : {}),
          ...(op.scheduledDate !== undefined ? { scheduledDate: op.scheduledDate } : {}),
          ...(op.scheduledSlot !== undefined ? { scheduledSlot: op.scheduledSlot } : {}),
          ...(op.scheduledStartMin !== undefined ? { scheduledStartMin: op.scheduledStartMin } : {}),
          ...(op.dueDate !== undefined ? { dueDate: op.dueDate } : {}),
          ...(op.durationMin !== undefined ? { durationMin: op.durationMin } : {}),
          ...(op.recurrenceRule !== undefined ? { recurrenceRule: op.recurrenceRule } : {}),
          ...(op.spawnedNextNodeId !== undefined
            ? { spawnedNextNodeId: op.spawnedNextNodeId }
            : {}),
          updatedAt: now,
        });
        nodeMap.set(updatedNode.id, updatedNode);
        updated.push(updatedNode);
        if (nextContentMd !== undefined || nextNoteMd !== undefined) {
          await syncNodeSideEffects(repos, workspaceId, doc, updatedNode, inlineTags);
        }
        continue;
      }

      if (op.op === "move") {
        const targetId = resolveRequiredId(op.nodeId);
        if (!nodeMap.has(targetId)) {
          throw new InkadeError("NOT_FOUND", `Outline node "${op.nodeId}" not found`);
        }
        const newParentId = resolveOptionalId(op.parentNodeId);
        await repos.outlineRepo.assertNoOutlineNodeCycle(doc.id, targetId, newParentId);
        const orderKey = await repos.outlineRepo.resolveOrderKeyForParent(doc.id, newParentId, {
          excludeNodeId: targetId,
          afterNodeId: resolveOptionalId(op.afterNodeId),
          beforeNodeId: resolveOptionalId(op.beforeNodeId),
          explicitOrderKey: op.orderKey,
        });
        const movedNode = await repos.outlineRepo.moveOutlineNodeDirect(
          doc.id,
          targetId,
          newParentId,
          orderKey,
          now,
        );
        nodeMap.set(movedNode.id, movedNode);
        moved.push(movedNode);
        continue;
      }

      if (op.op === "delete") {
        const targetId = resolveRequiredId(op.nodeId);
        if (!nodeMap.has(targetId)) {
          throw new InkadeError("NOT_FOUND", `Outline node "${op.nodeId}" not found`);
        }
        const subtreeIds = collectSubtreeIds(targetId, nodeMap);
        await repos.outlineRepo.softDeleteOutlineNodesDirect(doc.id, subtreeIds, now);
        await repos.revisionLinkRepo.deleteLinksForNodes(subtreeIds);
        await repos.searchConfigRepo.deleteNodesFts(subtreeIds);
        for (const sid of subtreeIds) {
          nodeMap.delete(sid);
          deletedIds.push(sid);
        }
      }
    }

    if (inlineTags.size > 0) {
      await repos.documentRepo.addDocumentTags(doc.id, [...inlineTags]);
    }

    if (operations.length > 0) {
      await repos.revisionLinkRepo.recordOutlinePostMutationRevision({
        documentId: doc.id,
        currentVersion: doc.version,
        actorType,
        actorId,
        changeSummary: `Batch mutated outline (${operations.length} ops)`,
        batchId: options.batchId,
        executionMode: options.executionMode,
        ts: now,
      });
    }

    const nodes = await repos.outlineRepo.listOutlineNodes(doc.id);
    return {
      documentId: doc.id,
      tempIdMap,
      created,
      updated,
      moved,
      deletedIds,
      nodes,
    };
  });
}

export async function rolloverUncheckedNodesInTx(
  repos: OutlineTxRepos,
  workspaceId: WorkspaceId,
  fromDoc: DocumentRecord,
  toDoc: DocumentRecord,
  options: OutlineTxActorOptions = {},
): Promise<readonly OutlineNode[]> {
  if (fromDoc.id === toDoc.id) {
    return [];
  }

  return repos.tx.runInTx(async () => {
    const now = new Date().toISOString();
    const actorType: ActorType = options.actorType ?? "human";
    const actorId = options.actorId ?? null;
    const sourceNodes = await repos.outlineRepo.listOutlineNodes(fromDoc.id);
    const sourceById = new Map(sourceNodes.map((n) => [n.id, n]));
    const seedUnchecked = sourceNodes.filter(
      (n) => n.checked === false && n.rolledOverToDocId === null,
    );
    if (seedUnchecked.length === 0) {
      return [];
    }

    const includedMap = new Map<OutlineNodeId, OutlineNode>();
    for (const node of seedUnchecked) {
      includedMap.set(node.id, node);
      let cursorParentId = node.parentNodeId;
      const seen = new Set<string>([node.id]);
      while (cursorParentId && !seen.has(cursorParentId)) {
        seen.add(cursorParentId);
        const parent = sourceById.get(cursorParentId);
        if (!parent || parent.rolledOverToDocId !== null || parent.checked === true) {
          break;
        }
        includedMap.set(parent.id, parent);
        cursorParentId = parent.parentNodeId;
      }
    }
    const candidates = [...includedMap.values()];

    await repos.revisionLinkRepo.ensureOutlineBaselineRevision(toDoc, now);

    const candidateById = new Set(candidates.map((c) => c.id));
    const orderedSources = orderSnapshotTopologically(
      candidates.map((c) =>
        c.parentNodeId && !candidateById.has(c.parentNodeId) ? { ...c, parentNodeId: null } : c,
      ),
    );

    const oldToNewId = new Map<string, OutlineNodeId>();
    const insertedNodes: OutlineNode[] = [];
    const inlineTags = new Set<string>();

    for (const src of orderedSources) {
      const targetParentId = src.parentNodeId ? (oldToNewId.get(src.parentNodeId) ?? null) : null;
      const orderKey = await repos.outlineRepo.resolveOrderKeyForParent(toDoc.id, targetParentId);
      const newId = createId(ID_PREFIXES.outlineNode);
      oldToNewId.set(src.id, newId);

      const inserted = await repos.outlineRepo.insertOutlineNodeDirect({
        id: newId,
        documentId: toDoc.id,
        parentNodeId: targetParentId,
        orderKey,
        contentMarkdown: src.contentMarkdown,
        contentText: src.contentText,
        noteMarkdown: src.noteMarkdown ?? "",
        noteText: src.noteText ?? "",
        checked: src.checked,
        collapsed: src.collapsed,
        authorType: src.authorType,
        authorId: src.authorId,
        sourceBindingId: src.sourceBindingId,
        mirrorOfNodeId: src.mirrorOfNodeId ?? null,
        priority: src.priority ?? null,
        scheduledDate: src.scheduledDate ?? toDoc.dailyDate ?? null,
        scheduledSlot: src.scheduledSlot ?? null,
        dueDate: src.dueDate ?? null,
        durationMin: src.durationMin ?? null,
        recurrenceRule: src.recurrenceRule ?? null,
        completedAt: null,
        spawnedNextNodeId: null,
        ts: now,
      });

      insertedNodes.push(inserted);
      await syncNodeSideEffects(repos, workspaceId, toDoc, inserted, inlineTags);
    }

    await repos.outlineRepo.markNodesRolledOver(
      orderedSources.map((s) => s.id),
      toDoc.id,
      now,
    );

    if (inlineTags.size > 0) {
      await repos.documentRepo.addDocumentTags(toDoc.id, [...inlineTags]);
    }

    await repos.revisionLinkRepo.recordOutlinePostMutationRevision({
      documentId: toDoc.id,
      currentVersion: toDoc.version,
      actorType,
      actorId,
      changeSummary: `Rolled over ${insertedNodes.length} unchecked nodes from "${fromDoc.title}"`,
      batchId: options.batchId,
      executionMode: options.executionMode,
      ts: now,
    });

    return insertedNodes;
  });
}

export async function restoreOutlineRevisionInTx(
  repos: OutlineTxRepos,
  workspaceId: WorkspaceId,
  doc: DocumentRecord,
  targetRevisionId: RevisionId,
  options: OutlineTxActorOptions & { readonly changeSummary?: string | undefined } = {},
): Promise<OutlineRevisionRestoreResult> {
  return repos.tx.runInTx(async () => {
    const now = new Date().toISOString();
    const actorType: ActorType = options.actorType ?? "human";
    const actorId = options.actorId ?? null;

    const targetRevision = await repos.revisionLinkRepo.getRevisionById(targetRevisionId);
    if (!targetRevision || targetRevision.documentId !== doc.id) {
      throw new InkadeError(
        "NOT_FOUND",
        `Revision "${targetRevisionId}" not found for document "${doc.id}"`,
      );
    }
    if (targetRevision.outlineSnapshot === null) {
      throw new InkadeError(
        "CONFLICT",
        `Revision "${targetRevisionId}" has no outline snapshot to restore`,
      );
    }

    const beforeRevision = await repos.revisionLinkRepo.getLatestRevision(doc.id);
    await repos.revisionLinkRepo.ensureOutlineBaselineRevision(doc, now);

    const existingNodes = await repos.outlineRepo.listOutlineNodes(doc.id);
    if (existingNodes.length > 0) {
      const existingIds = existingNodes.map((n) => n.id);
      await repos.outlineRepo.softDeleteOutlineNodesDirect(doc.id, existingIds, now);
      await repos.revisionLinkRepo.deleteLinksForNodes(existingIds);
      await repos.searchConfigRepo.deleteNodesFts(existingIds);
    }

    const orderedSnapshot = orderSnapshotTopologically(targetRevision.outlineSnapshot);
    const inlineTags = new Set<string>();

    for (const snap of orderedSnapshot) {
      const noteMarkdown = snap.noteMarkdown ?? "";
      const contentText = markdownToPlainText(snap.contentMarkdown);
      const noteText = markdownToPlainText(noteMarkdown);
      await repos.outlineRepo.upsertOutlineNodeFromSnapshot(doc.id, snap, {
        contentText,
        noteMarkdown,
        noteText,
        updatedAt: now,
      });

      const hydratedNode: OutlineNode = {
        ...snap,
        contentText,
        noteMarkdown,
        noteText,
        updatedAt: now,
        deletedAt: null,
      };
      await syncNodeSideEffects(repos, workspaceId, doc, hydratedNode, inlineTags);
    }

    if (inlineTags.size > 0) {
      await repos.documentRepo.addDocumentTags(doc.id, [...inlineTags]);
    }

    const afterRevision = await repos.revisionLinkRepo.recordOutlinePostMutationRevision({
      documentId: doc.id,
      currentVersion: doc.version,
      actorType,
      actorId,
      changeSummary:
        options.changeSummary ?? `Restored outline to revision v${targetRevision.version}`,
      batchId: options.batchId,
      executionMode: options.executionMode,
      ts: now,
    });

    const [updatedDoc, nodes] = await Promise.all([
      repos.documentRepo.getDocumentById(workspaceId, doc.id),
      repos.outlineRepo.listOutlineNodes(doc.id),
    ]);
    if (!updatedDoc) {
      throw new InkadeError("NOT_FOUND", `Document "${doc.id}" not found`);
    }

    return {
      document: updatedDoc,
      nodes,
      beforeRevision,
      afterRevision,
    };
  });
}
