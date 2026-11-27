import {
  buildCompactDiffPreview,
  computeNextRecurrenceDate,
  evaluateScopeAccess,
  InkadeError,
  isValidDailyDate,
  parseIsoToLocalCalendarDate,
  parseQuickTaskSyntax,
  resolveAllowedSpaceIds,
  slotForScheduledStartMin,
  todayLocalDateString,
  type BatchOutlineNodesInput,
  type BatchOutlineNodesRequestInput,
  type BatchOutlineNodesResult,
  type BatchUpdateTasksInput,
  type CreateMirrorNodeInput,
  type CreateOutlineNodeInput,
  type CreateTaskInput,
  type DocumentId,
  type DocumentRecord,
  type MoveOutlineNodeInput,
  type OutlineNode,
  type OutlineNodeId,
  type RescheduleTaskInput,
  type RevisionId,
  type ScopeAction,
  type SpaceId,
  type UpdateOutlineNodeInput,
  type UpdateOutlineNodeResult,
  type WorkspaceId,
} from "@inkade/core";
import {
  DEFAULT_SPACE_IDS,
  type DocumentRepo,
  type OutlineRepo,
  type OutlineRevisionRestoreResult,
  type RevisionLinkRepo,
  type SearchConfigRepo,
  type SpaceRepo,
  type TransactionRunner,
  type WorkspaceOutlineNodeMatch,
  type WorkspaceRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import type { AuditService } from "./audit-service.ts";
import {
  batchMutateOutlineInTx,
  restoreOutlineRevisionInTx,
  rolloverUncheckedNodesInTx,
} from "./outline-tx-workflows.ts";
import {
  assertScope,
  getAllWorkspaceSpaces,
  resolveOutlineNodeDocumentId,
} from "./scope-guard.ts";
import { getOrCreateTasksInboxDocument } from "./outline-task-helpers.ts";
import { parseMarkdownListToOutlineOps, renderTemplateVariables } from "./template-service.ts";
import type { WakeService } from "./wake-service.ts";

export interface OutlineServiceRepos {
  readonly tx: TransactionRunner;
  readonly documentRepo: DocumentRepo;
  readonly outlineRepo: OutlineRepo;
  readonly revisionLinkRepo: RevisionLinkRepo;
  readonly workspaceRepo: WorkspaceRepo;
  readonly spaceRepo: SpaceRepo;
  readonly searchConfigRepo: SearchConfigRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
}

export interface DailyOutlineResult {
  readonly document: DocumentRecord;
  readonly nodes: readonly OutlineNode[];
  readonly created: boolean;
}

export interface CreateTaskResult {
  readonly node: OutlineNode;
  readonly document: DocumentRecord;
}

export interface BatchUpdateTasksResult {
  readonly updated: readonly OutlineNode[];
  readonly spawned: readonly OutlineNode[];
}

export class OutlineService {
  constructor(
    private readonly repos: OutlineServiceRepos,
    private readonly sseHub: SseHub,
    private readonly onDocumentChanged?: (workspaceId: WorkspaceId, documentId: DocumentId) => void,
    private readonly auditService?: AuditService,
    private readonly wakeService?: WakeService,
  ) {}

  private async captureOutlineRevisionAudit(
    principal: Principal,
    doc: DocumentRecord,
    preVersion: number,
    summary: string,
    fallbackAction: string,
  ): Promise<void> {
    if (!this.auditService) return;
    const [beforeRev, afterRev] = await Promise.all([
      this.repos.revisionLinkRepo.getRevision(doc.id, preVersion),
      this.repos.revisionLinkRepo.getLatestRevision(doc.id),
    ]);
    await this.auditService.captureOrRecord(principal, {
      spaceId: doc.spaceId,
      documentId: doc.id,
      beforeRevisionId: beforeRev?.id ?? null,
      afterRevisionId: afterRev?.id ?? null,
      diffPreview: buildCompactDiffPreview(
        beforeRev?.contentMarkdown ?? "",
        afterRev?.contentMarkdown ?? "",
      ),
      reversible: Boolean(beforeRev && afterRev && beforeRev.id !== afterRev.id),
      irreversibleReason:
        beforeRev && afterRev && beforeRev.id !== afterRev.id
          ? null
          : "Missing outline before/after revision snapshot",
      summary,
      fallbackAction,
      fallbackResource: `document:${doc.id}`,
    });
  }

  private async getActiveDocumentOrThrow(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
  ): Promise<DocumentRecord> {
    const doc = await this.repos.documentRepo.getDocumentById(workspaceId, documentId);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    return doc;
  }

  async getOrCreateDailyOutline(
    principal: Principal,
    dailyDate: string,
  ): Promise<DailyOutlineResult> {
    if (!isValidDailyDate(dailyDate)) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        `Invalid dailyDate "${dailyDate}" (expected YYYY-MM-DD)`,
      );
    }

    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const dailySpace =
      allSpaces.find((s) => s.id === DEFAULT_SPACE_IDS.daily && s.archivedAt === null) ??
      allSpaces.find((s) => s.slug === "daily" && s.archivedAt === null) ??
      allSpaces.find((s) => s.defaultKind === "outline" && s.archivedAt === null);

    if (!dailySpace) {
      throw new InkadeError("NOT_FOUND", "Daily outline space not found");
    }

    const existingDocId = await this.repos.documentRepo.findActiveDailyDocumentId(
      principal.workspaceId,
      dailyDate,
    );

    if (existingDocId) {
      const existingDoc = await this.repos.documentRepo.getDocumentById(
        principal.workspaceId,
        existingDocId,
      );
      if (existingDoc) {
        assertScope(
          principal.scope,
          "read",
          { spaceId: existingDoc.spaceId, kind: existingDoc.kind, tags: existingDoc.tags },
          allSpaces,
        );
        const nodes = await this.repos.outlineRepo.listOutlineNodes(existingDoc.id);
        return { document: existingDoc, nodes, created: false };
      }
    }

    assertScope(
      principal.scope,
      "append",
      { spaceId: dailySpace.id, kind: "outline", tags: [] },
      allSpaces,
    );

    const { document, created } = await this.repos.documentRepo.getOrCreateDailyOutline(
      principal.workspaceId,
      dailySpace.id,
      dailyDate,
      `Daily · ${dailyDate}`,
    );

    if (created) {
      const defaultTemplate = await this.repos.workspaceRepo.getDefaultDailyTemplate(
        principal.workspaceId,
      );
      if (defaultTemplate && defaultTemplate.contentMarkdown.trim().length > 0) {
        const parsedDate = new Date(`${dailyDate}T00:00:00Z`);
        const weekdayNames = [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ];
        const rendered = renderTemplateVariables(defaultTemplate.contentMarkdown, {
          date: dailyDate,
          weekday: weekdayNames[parsedDate.getUTCDay()] ?? "Monday",
          space: dailySpace.name,
          title: document.title,
        });
        const ops = parseMarkdownListToOutlineOps(
          document.id,
          rendered,
          principal.actorType === "agent" ? "agent" : "human",
          principal.actorId,
        );
        if (ops.length > 0) {
          await batchMutateOutlineInTx(this.repos, principal.workspaceId, document, ops, {
            actorType: principal.actorType === "agent" ? "agent" : "human",
            actorId: principal.actorId,
          });
        }
      }

      this.sseHub.publish({
        type: "document.created",
        workspaceId: principal.workspaceId,
        spaceId: document.spaceId,
        documentId: document.id,
        documentKind: document.kind,
        tags: document.tags,
        actorType: principal.actorType,
        payload: { document },
      });
    }

    const nodes = await this.repos.outlineRepo.listOutlineNodes(document.id);
    return { document, nodes, created };
  }

  async listNodes(principal: Principal, documentId: DocumentId): Promise<readonly OutlineNode[]> {
    const doc = await this.getActiveDocumentOrThrow(principal.workspaceId, documentId);
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertScope(
      principal.scope,
      "read",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );
    return this.repos.outlineRepo.listOutlineNodes(documentId);
  }

  private async resolveCanonicalMirrorSource(
    workspaceId: WorkspaceId,
    candidateNodeId: string,
    disallowNodeIds?: ReadonlySet<string>,
  ): Promise<WorkspaceOutlineNodeMatch> {
    const visited = new Set<string>();
    let current = await this.repos.outlineRepo.findOutlineNodeByIdInWorkspace(
      workspaceId,
      candidateNodeId,
    );
    if (!current || current.node.deletedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Outline node "${candidateNodeId}" not found`);
    }
    while (true) {
      if (disallowNodeIds?.has(current.node.id) || visited.has(current.node.id)) {
        throw new InkadeError(
          "INVALID_PARENT_CYCLE",
          `Cyclic outline mirror reference detected around "${candidateNodeId}"`,
        );
      }
      visited.add(current.node.id);
      if (!current.node.mirrorOfNodeId) {
        return current;
      }
      const next = await this.repos.outlineRepo.findOutlineNodeByIdInWorkspace(
        workspaceId,
        current.node.mirrorOfNodeId,
      );
      if (!next || next.node.deletedAt !== null) {
        return current;
      }
      current = next;
    }
  }

  private async syncMirrorCluster(principal: Principal, changedNode: OutlineNode): Promise<void> {
    let canonicalId = changedNode.id;
    let canonicalMatch: WorkspaceOutlineNodeMatch | null = null;
    if (changedNode.mirrorOfNodeId) {
      const visited = new Set<string>([changedNode.id]);
      let nextId: string | null = changedNode.mirrorOfNodeId ?? null;
      while (nextId) {
        if (visited.has(nextId)) break;
        visited.add(nextId);
        const found = await this.repos.outlineRepo.findOutlineNodeByIdInWorkspace(
          principal.workspaceId,
          nextId,
        );
        if (!found || found.node.deletedAt !== null) break;
        canonicalMatch = found;
        canonicalId = found.node.id;
        nextId = found.node.mirrorOfNodeId ?? null;
      }
    }

    const mirrors = await this.repos.outlineRepo.listMirrorNodesOf(
      principal.workspaceId,
      canonicalId,
    );
    const targets: WorkspaceOutlineNodeMatch[] = [];
    if (canonicalMatch && canonicalMatch.node.id !== changedNode.id) {
      targets.push(canonicalMatch);
    }
    for (const m of mirrors) {
      if (m.node.id !== changedNode.id && m.node.deletedAt === null) {
        targets.push(m);
      }
    }
    if (targets.length === 0) return;

    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );

    for (const target of targets) {
      const sibling = target.node;
      if (
        sibling.contentMarkdown === changedNode.contentMarkdown &&
        sibling.noteMarkdown === changedNode.noteMarkdown &&
        sibling.checked === changedNode.checked &&
        sibling.priority === changedNode.priority &&
        sibling.scheduledDate === changedNode.scheduledDate &&
        sibling.scheduledSlot === changedNode.scheduledSlot &&
        sibling.scheduledStartMin === changedNode.scheduledStartMin &&
        sibling.dueDate === changedNode.dueDate &&
        sibling.durationMin === changedNode.durationMin &&
        sibling.recurrenceRule === changedNode.recurrenceRule
      ) {
        continue;
      }

      const siblingDoc = await this.repos.documentRepo.getDocumentById(
        principal.workspaceId,
        target.documentId,
      );
      if (!siblingDoc || siblingDoc.trashedAt !== null) continue;

      if (principal.kind === "token") {
        const perm = evaluateScopeAccess(
          principal.scope,
          "write",
          { spaceId: siblingDoc.spaceId, kind: siblingDoc.kind, tags: siblingDoc.tags },
          allSpaces,
        );
        if (!perm.allowed) continue;
      }

      const synced = await this.repos.outlineRepo.updateOutlineNode(
        principal.workspaceId,
        siblingDoc.id,
        sibling.id,
        {
          contentMarkdown: changedNode.contentMarkdown,
          noteMarkdown: changedNode.noteMarkdown,
          checked: changedNode.checked,
          priority: changedNode.priority ?? null,
          scheduledDate: changedNode.scheduledDate ?? null,
          scheduledSlot: changedNode.scheduledSlot ?? null,
          scheduledStartMin: changedNode.scheduledStartMin ?? null,
          dueDate: changedNode.dueDate ?? null,
          durationMin: changedNode.durationMin ?? null,
          recurrenceRule: changedNode.recurrenceRule ?? null,
        },
        {
          actorType: principal.actorType,
          actorId: principal.actorId,
        },
      );

      this.sseHub.publish({
        type: "outline.node.updated",
        workspaceId: principal.workspaceId,
        spaceId: siblingDoc.spaceId,
        documentId: siblingDoc.id,
        documentKind: siblingDoc.kind,
        tags: siblingDoc.tags,
        actorType: principal.actorType,
        payload: { node: synced },
      });
      this.onDocumentChanged?.(principal.workspaceId, siblingDoc.id);
    }
  }

  async createNode(principal: Principal, input: CreateOutlineNodeInput): Promise<OutlineNode> {
    const doc = await this.getActiveDocumentOrThrow(principal.workspaceId, input.documentId);
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertScope(
      principal.scope,
      "append",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    let effectiveInput = input;
    if (input.mirrorOfNodeId) {
      const canonical = await this.resolveCanonicalMirrorSource(
        principal.workspaceId,
        input.mirrorOfNodeId,
      );
      const sourceDoc = await this.repos.documentRepo.getDocumentById(
        principal.workspaceId,
        canonical.documentId,
      );
      if (sourceDoc) {
        assertScope(
          principal.scope,
          "read",
          { spaceId: sourceDoc.spaceId, kind: sourceDoc.kind, tags: sourceDoc.tags },
          allSpaces,
        );
      }
      effectiveInput = {
        ...input,
        mirrorOfNodeId: canonical.node.id,
        contentMarkdown:
          input.contentMarkdown.trim().length > 0
            ? input.contentMarkdown
            : canonical.node.contentMarkdown,
        noteMarkdown:
          input.noteMarkdown !== undefined ? input.noteMarkdown : canonical.node.noteMarkdown,
        checked: input.checked !== undefined ? input.checked : canonical.node.checked,
      };
    }

    const batchCtx = this.auditService?.ensureActiveBatchContext(principal);
    const authorType = principal.kind === "token" ? "agent" : (effectiveInput.authorType ?? "human");
    const created = await this.repos.outlineRepo.createOutlineNode(
      principal.workspaceId,
      {
        ...effectiveInput,
        authorType,
        authorId: effectiveInput.authorId ?? principal.actorId,
      },
      {
        batchId: batchCtx?.batchId,
        executionMode: batchCtx?.executionMode,
      },
    );

    await this.captureOutlineRevisionAudit(
      principal,
      doc,
      doc.version,
      `Created outline node in "${doc.title}"`,
      "outline.node.create",
    );

    this.sseHub.publish({
      type: "outline.node.created",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { node: created },
    });
    this.onDocumentChanged?.(principal.workspaceId, doc.id);

    if (created.mirrorOfNodeId && effectiveInput.contentMarkdown !== input.contentMarkdown) {
      // Newly attached mirror inherited canonical content; no upstream overwrite needed.
    } else if (created.mirrorOfNodeId) {
      await this.syncMirrorCluster(principal, created);
    }

    await this.wakeService?.claimUnownedForDocumentWrite(principal, doc.id);

    return created;
  }

  async createMirrorNode(
    principal: Principal,
    sourceNodeId: OutlineNodeId,
    input: CreateMirrorNodeInput,
  ): Promise<{
    readonly node: OutlineNode;
    readonly canonicalSourceNodeId: OutlineNodeId;
    readonly sourceDocumentId: DocumentId;
  }> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const canonical = await this.resolveCanonicalMirrorSource(
      principal.workspaceId,
      sourceNodeId,
    );
    const sourceDoc = await this.getActiveDocumentOrThrow(
      principal.workspaceId,
      canonical.documentId,
    );
    assertScope(
      principal.scope,
      "read",
      { spaceId: sourceDoc.spaceId, kind: sourceDoc.kind, tags: sourceDoc.tags },
      allSpaces,
    );

    const targetDoc = await this.getActiveDocumentOrThrow(
      principal.workspaceId,
      input.targetDocumentId,
    );
    if (targetDoc.kind !== "outline") {
      throw new InkadeError(
        "VALIDATION_ERROR",
        `Target document "${targetDoc.title}" must have kind "outline" to host a mirror node`,
      );
    }
    assertScope(
      principal.scope,
      "append",
      { spaceId: targetDoc.spaceId, kind: targetDoc.kind, tags: targetDoc.tags },
      allSpaces,
    );

    const created = await this.createNode(principal, {
      documentId: targetDoc.id,
      parentNodeId: input.parentNodeId ?? null,
      afterNodeId: input.afterNodeId ?? undefined,
      beforeNodeId: input.beforeNodeId ?? undefined,
      contentMarkdown: canonical.node.contentMarkdown,
      noteMarkdown: canonical.node.noteMarkdown,
      checked: canonical.node.checked,
      mirrorOfNodeId: canonical.node.id,
      priority: canonical.node.priority ?? null,
      scheduledDate: canonical.node.scheduledDate ?? null,
      scheduledSlot: canonical.node.scheduledSlot ?? null,
      scheduledStartMin: canonical.node.scheduledStartMin ?? null,
      dueDate: canonical.node.dueDate ?? null,
      durationMin: canonical.node.durationMin ?? null,
      recurrenceRule: canonical.node.recurrenceRule ?? null,
    });

    return {
      node: created,
      canonicalSourceNodeId: canonical.node.id,
      sourceDocumentId: canonical.documentId,
    };
  }

  async searchWorkspaceNodes(
    principal: Principal,
    query: string,
    limit = 20,
  ): Promise<readonly WorkspaceOutlineNodeMatch[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const scopedSpaceIds = resolveAllowedSpaceIds(principal.scope, allSpaces);
    const allowedSpaceIdList =
      scopedSpaceIds === "*" ? undefined : ([...scopedSpaceIds] as readonly SpaceId[]);
    const rawMatches = await this.repos.outlineRepo.searchOutlineNodes(
      principal.workspaceId,
      query,
      {
        ...(allowedSpaceIdList ? { spaceIds: allowedSpaceIdList } : {}),
        ...(principal.scope?.allowedKinds ? { allowedKinds: principal.scope.allowedKinds } : {}),
        limit: Math.min(Math.max(limit * 2, 10), 100),
      },
    );

    const docCache = new Map<DocumentId, DocumentRecord | null>();
    const allowed: WorkspaceOutlineNodeMatch[] = [];
    for (const match of rawMatches) {
      let doc = docCache.get(match.documentId);
      if (doc === undefined) {
        doc = await this.repos.documentRepo.getDocumentById(principal.workspaceId, match.documentId);
        docCache.set(match.documentId, doc);
      }
      if (!doc || doc.trashedAt !== null) continue;
      const perm = evaluateScopeAccess(
        principal.scope,
        "read",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      );
      if (!perm.allowed) continue;
      allowed.push(match);
      if (allowed.length >= limit) break;
    }
    return allowed;
  }

  async updateNode(
    principal: Principal,
    nodeId: OutlineNodeId,
    input: UpdateOutlineNodeInput,
    documentIdHint?: DocumentId,
  ): Promise<OutlineNode> {
    const result = await this.updateNodeWithResult(principal, nodeId, input, documentIdHint);
    return result.node;
  }

  async updateNodeWithResult(
    principal: Principal,
    nodeId: OutlineNodeId,
    input: UpdateOutlineNodeInput,
    documentIdHint?: DocumentId,
  ): Promise<UpdateOutlineNodeResult> {
    const documentId =
      documentIdHint ??
      (await resolveOutlineNodeDocumentId(this.repos.outlineRepo, principal.workspaceId, nodeId));
    const [doc, previous, allSpaces] = await Promise.all([
      this.getActiveDocumentOrThrow(principal.workspaceId, documentId),
      this.repos.outlineRepo.getOutlineNodeById(documentId, nodeId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);
    assertScope(
      principal.scope,
      "write",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    let effectiveUpdateInput = input;
    if (input.mirrorOfNodeId !== undefined && input.mirrorOfNodeId !== null) {
      const canonical = await this.resolveCanonicalMirrorSource(
        principal.workspaceId,
        input.mirrorOfNodeId,
        new Set([nodeId]),
      );
      effectiveUpdateInput = {
        ...input,
        mirrorOfNodeId: canonical.node.id,
      };
    }

    const batchCtx = this.auditService?.ensureActiveBatchContext(principal);
    let updated = await this.repos.outlineRepo.updateOutlineNode(
      principal.workspaceId,
      documentId,
      nodeId,
      effectiveUpdateInput,
      {
        actorType: principal.actorType,
        actorId: principal.actorId,
        batchId: batchCtx?.batchId,
        executionMode: batchCtx?.executionMode,
      },
    );

    await this.captureOutlineRevisionAudit(
      principal,
      doc,
      doc.version,
      `Updated outline node "${nodeId}"`,
      "outline.node.update",
    );

    this.sseHub.publish({
      type: "outline.node.updated",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { node: updated },
    });
    this.onDocumentChanged?.(principal.workspaceId, doc.id);

    let spawnedNextNode: OutlineNode | null = null;
    let deletedSpawnedNodeId: OutlineNodeId | null = null;

    // Auto-spawn next recurrence instance upon completing a recurring task
    if (
      previous &&
      previous.checked === false &&
      updated.checked === true &&
      updated.recurrenceRule
    ) {
      const baseDate = updated.scheduledDate ?? doc.dailyDate ?? todayLocalDateString();
      const nextDate = computeNextRecurrenceDate(baseDate, updated.recurrenceRule);
      let targetDoc = doc;
      if (doc.dailyDate !== null) {
        try {
          const nextDaily = await this.getOrCreateDailyOutline(principal, nextDate);
          const canWriteTarget = evaluateScopeAccess(
            principal.scope,
            "append",
            {
              spaceId: nextDaily.document.spaceId,
              kind: nextDaily.document.kind,
              tags: nextDaily.document.tags,
            },
            allSpaces,
          );
          if (canWriteTarget.allowed) {
            targetDoc = nextDaily.document;
          }
        } catch {
          targetDoc = doc;
        }
      }

      spawnedNextNode = await this.repos.outlineRepo.createOutlineNode(principal.workspaceId, {
        documentId: targetDoc.id,
        parentNodeId: targetDoc.id === doc.id ? updated.parentNodeId : null,
        afterNodeId: targetDoc.id === doc.id ? updated.id : undefined,
        contentMarkdown: updated.contentMarkdown,
        noteMarkdown: updated.noteMarkdown,
        checked: false,
        collapsed: false,
        authorType: principal.kind === "token" ? "agent" : "human",
        authorId: principal.actorId,
        priority: updated.priority ?? null,
        scheduledDate: nextDate,
        scheduledSlot: updated.scheduledSlot ?? null,
        scheduledStartMin: updated.scheduledStartMin ?? null,
        dueDate: null,
        durationMin: updated.durationMin ?? null,
        recurrenceRule: updated.recurrenceRule,
      });

      updated = await this.repos.outlineRepo.updateOutlineNode(
        principal.workspaceId,
        doc.id,
        updated.id,
        { spawnedNextNodeId: spawnedNextNode.id },
        { actorType: principal.actorType, actorId: principal.actorId },
      );

      this.sseHub.publish({
        type: "outline.node.created",
        workspaceId: principal.workspaceId,
        spaceId: targetDoc.spaceId,
        documentId: targetDoc.id,
        documentKind: targetDoc.kind,
        tags: targetDoc.tags,
        actorType: principal.actorType,
        payload: { node: spawnedNextNode },
      });
      this.onDocumentChanged?.(principal.workspaceId, targetDoc.id);
    } else if (
      previous &&
      previous.checked === true &&
      updated.checked === false &&
      previous.spawnedNextNodeId
    ) {
      // Undo clean auto-spawned next recurrence instance if untouched by user
      try {
        const spawnedDocId = await resolveOutlineNodeDocumentId(
          this.repos.outlineRepo,
          principal.workspaceId,
          previous.spawnedNextNodeId,
        );
        const [spawnedDoc, spawnedNode] = await Promise.all([
          this.repos.documentRepo.getDocumentById(principal.workspaceId, spawnedDocId),
          this.repos.outlineRepo.getOutlineNodeById(spawnedDocId, previous.spawnedNextNodeId),
        ]);
        if (
          spawnedDoc &&
          spawnedDoc.trashedAt === null &&
          spawnedNode &&
          spawnedNode.deletedAt === null &&
          spawnedNode.checked === false &&
          spawnedNode.updatedAt === spawnedNode.createdAt &&
          evaluateScopeAccess(
            principal.scope,
            "soft_delete",
            { spaceId: spawnedDoc.spaceId, kind: spawnedDoc.kind, tags: spawnedDoc.tags },
            allSpaces,
          ).allowed
        ) {
          await this.repos.outlineRepo.softDeleteOutlineNode(
            principal.workspaceId,
            spawnedDoc.id,
            spawnedNode.id,
            { actorType: principal.actorType, actorId: principal.actorId },
          );
          deletedSpawnedNodeId = spawnedNode.id;
          this.sseHub.publish({
            type: "outline.node.deleted",
            workspaceId: principal.workspaceId,
            spaceId: spawnedDoc.spaceId,
            documentId: spawnedDoc.id,
            documentKind: spawnedDoc.kind,
            tags: spawnedDoc.tags,
            actorType: principal.actorType,
            payload: { nodeIds: [spawnedNode.id], nodes: [spawnedNode] },
          });
          this.onDocumentChanged?.(principal.workspaceId, spawnedDoc.id);
        }
      } catch {
        // Ignore if spawned instance was already removed
      }
      updated = await this.repos.outlineRepo.updateOutlineNode(
        principal.workspaceId,
        doc.id,
        updated.id,
        { spawnedNextNodeId: null },
        { actorType: principal.actorType, actorId: principal.actorId },
      );
    }

    await this.syncMirrorCluster(principal, updated);
    await this.wakeService?.claimUnownedForDocumentWrite(principal, doc.id);

    return {
      node: updated,
      ...(spawnedNextNode ? { spawnedNextNode } : {}),
      ...(deletedSpawnedNodeId ? { deletedSpawnedNodeId } : {}),
    };
  }

  async createTask(principal: Principal, input: CreateTaskInput): Promise<CreateTaskResult> {
    const rawText = (input.title ?? input.contentMarkdown ?? "").trim();
    if (!rawText) {
      throw new InkadeError("VALIDATION_ERROR", "Task title or contentMarkdown is required");
    }

    const useQuickSyntax = input.parseQuickSyntax !== false;
    const parsed = useQuickSyntax
      ? parseQuickTaskSyntax(rawText, parseIsoToLocalCalendarDate(input.referenceDate))
      : { title: rawText };

    const effectiveScheduledDate =
      input.scheduledDate !== undefined ? input.scheduledDate : (parsed.scheduledDate ?? null);
    const effectiveScheduledStartMin =
      input.scheduledStartMin !== undefined
        ? input.scheduledStartMin
        : (parsed.scheduledStartMin ?? null);
    const effectivePriority =
      input.priority !== undefined ? input.priority : (parsed.priority ?? null);
    const effectiveSlot =
      input.scheduledSlot !== undefined
        ? input.scheduledSlot
        : parsed.scheduledSlot !== undefined
          ? parsed.scheduledSlot
          : effectiveScheduledStartMin !== null
            ? slotForScheduledStartMin(effectiveScheduledStartMin)
            : null;
    const effectiveDuration =
      input.durationMin !== undefined ? input.durationMin : (parsed.durationMin ?? null);
    const effectiveDueDate =
      input.dueDate !== undefined ? input.dueDate : (parsed.dueDate ?? null);
    const effectiveRecurrence =
      input.recurrenceRule !== undefined ? input.recurrenceRule : (parsed.recurrenceRule ?? null);

    let targetDoc: DocumentRecord;
    if (input.documentId) {
      targetDoc = await this.getActiveDocumentOrThrow(principal.workspaceId, input.documentId);
      const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
      assertScope(
        principal.scope,
        "append",
        { spaceId: targetDoc.spaceId, kind: targetDoc.kind, tags: targetDoc.tags },
        allSpaces,
      );
    } else if (effectiveScheduledDate) {
      const daily = await this.getOrCreateDailyOutline(principal, effectiveScheduledDate);
      targetDoc = daily.document;
    } else {
      targetDoc = await getOrCreateTasksInboxDocument(
        this.repos.documentRepo,
        this.repos.spacesCache ?? this.repos.spaceRepo,
        this.sseHub,
        principal,
        input.spaceId,
      );
    }

    const node = await this.createNode(principal, {
      documentId: targetDoc.id,
      parentNodeId: input.parentNodeId ?? null,
      contentMarkdown: parsed.title,
      noteMarkdown: input.noteMarkdown,
      checked: false,
      collapsed: false,
      authorType: principal.kind === "token" ? "agent" : "human",
      authorId: principal.actorId,
      priority: effectivePriority,
      scheduledDate: effectiveScheduledDate,
      scheduledSlot: effectiveSlot,
      scheduledStartMin: effectiveScheduledStartMin,
      dueDate: effectiveDueDate,
      durationMin: effectiveDuration,
      recurrenceRule: effectiveRecurrence,
    });

    return { node, document: targetDoc };
  }

  async batchUpdateTasks(
    principal: Principal,
    input: BatchUpdateTasksInput,
  ): Promise<BatchUpdateTasksResult> {
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    const uniqueIds = [...new Set(input.nodeIds)];

    // Pre-verify scope & existence across ALL nodes before mutating any row
    const resolvedTargets: { readonly nodeId: OutlineNodeId; readonly documentId: DocumentId }[] = [];
    const checkedDocIds = new Set<DocumentId>();
    for (const nodeId of uniqueIds) {
      const outlineTargetId = nodeId as OutlineNodeId;
      const documentId = await resolveOutlineNodeDocumentId(
        this.repos.outlineRepo,
        principal.workspaceId,
        outlineTargetId,
      );
      if (!checkedDocIds.has(documentId)) {
        const doc = await this.getActiveDocumentOrThrow(principal.workspaceId, documentId);
        assertScope(
          principal.scope,
          "write",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        );
        checkedDocIds.add(documentId);
      }
      resolvedTargets.push({ nodeId: outlineTargetId, documentId });
    }

    const patch: UpdateOutlineNodeInput = {
      ...(input.checked !== undefined ? { checked: input.checked } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.scheduledDate !== undefined ? { scheduledDate: input.scheduledDate } : {}),
      ...(input.scheduledSlot !== undefined ? { scheduledSlot: input.scheduledSlot } : {}),
      ...(input.scheduledStartMin !== undefined
        ? { scheduledStartMin: input.scheduledStartMin }
        : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
      ...(input.recurrenceRule !== undefined ? { recurrenceRule: input.recurrenceRule } : {}),
    };

    const updated: OutlineNode[] = [];
    const spawned: OutlineNode[] = [];
    for (const target of resolvedTargets) {
      const res = await this.updateNodeWithResult(
        principal,
        target.nodeId,
        patch,
        target.documentId,
      );
      updated.push(res.node);
      if (res.spawnedNextNode) {
        spawned.push(res.spawnedNextNode);
      }
    }

    return { updated, spawned };
  }

  async rescheduleTask(principal: Principal, input: RescheduleTaskInput): Promise<OutlineNode> {
    return this.updateNode(principal, input.nodeId as OutlineNodeId, {
      scheduledDate: input.scheduledDate,
      ...(input.scheduledSlot !== undefined ? { scheduledSlot: input.scheduledSlot } : {}),
      ...(input.scheduledStartMin !== undefined
        ? { scheduledStartMin: input.scheduledStartMin }
        : {}),
      ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
    });
  }

  async moveNode(
    principal: Principal,
    nodeId: OutlineNodeId,
    input: MoveOutlineNodeInput,
    documentIdHint?: DocumentId,
  ): Promise<OutlineNode> {
    const documentId =
      documentIdHint ??
      (await resolveOutlineNodeDocumentId(this.repos.outlineRepo, principal.workspaceId, nodeId));
    const doc = await this.getActiveDocumentOrThrow(principal.workspaceId, documentId);
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    assertScope(
      principal.scope,
      "write",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    const batchCtx = this.auditService?.ensureActiveBatchContext(principal);
    const moved = await this.repos.outlineRepo.moveOutlineNode(
      principal.workspaceId,
      documentId,
      nodeId,
      input,
      {
        actorType: principal.actorType,
        actorId: principal.actorId,
        batchId: batchCtx?.batchId,
        executionMode: batchCtx?.executionMode,
      },
    );

    await this.captureOutlineRevisionAudit(
      principal,
      doc,
      doc.version,
      `Moved outline node "${nodeId}"`,
      "outline.node.move",
    );

    this.sseHub.publish({
      type: "outline.node.moved",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { node: moved },
    });
    await this.wakeService?.claimUnownedForDocumentWrite(principal, doc.id);

    return moved;
  }

  async softDeleteNode(
    principal: Principal,
    nodeId: OutlineNodeId,
    documentIdHint?: DocumentId,
  ): Promise<readonly OutlineNode[]> {
    const documentId =
      documentIdHint ??
      (await resolveOutlineNodeDocumentId(this.repos.outlineRepo, principal.workspaceId, nodeId));
    const doc = await this.getActiveDocumentOrThrow(principal.workspaceId, documentId);
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    assertScope(
      principal.scope,
      "soft_delete",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    const batchCtx = this.auditService?.ensureActiveBatchContext(principal);
    const deleted = await this.repos.outlineRepo.softDeleteOutlineNode(
      principal.workspaceId,
      documentId,
      nodeId,
      {
        actorType: principal.actorType,
        actorId: principal.actorId,
        batchId: batchCtx?.batchId,
        executionMode: batchCtx?.executionMode,
      },
    );

    await this.captureOutlineRevisionAudit(
      principal,
      doc,
      doc.version,
      `Deleted outline subtree (${deleted.length} nodes)`,
      "outline.node.delete",
    );

    this.sseHub.publish({
      type: "outline.node.deleted",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { nodeIds: deleted.map((n) => n.id), nodes: deleted },
    });
    this.onDocumentChanged?.(principal.workspaceId, doc.id);

    return deleted;
  }

  async rolloverUncheckedNodes(
    principal: Principal,
    fromDocumentId: DocumentId,
    toDocumentId: DocumentId,
  ): Promise<readonly OutlineNode[]> {
    const [fromDoc, toDoc, allSpaces] = await Promise.all([
      this.getActiveDocumentOrThrow(principal.workspaceId, fromDocumentId),
      this.getActiveDocumentOrThrow(principal.workspaceId, toDocumentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);

    assertScope(
      principal.scope,
      "read",
      { spaceId: fromDoc.spaceId, kind: fromDoc.kind, tags: fromDoc.tags },
      allSpaces,
    );
    assertScope(
      principal.scope,
      "write",
      { spaceId: toDoc.spaceId, kind: toDoc.kind, tags: toDoc.tags },
      allSpaces,
    );

    const rolled = await rolloverUncheckedNodesInTx(
      this.repos,
      principal.workspaceId,
      fromDoc,
      toDoc,
      { actorType: principal.actorType, actorId: principal.actorId },
    );

    if (rolled.length > 0) {
      await this.captureOutlineRevisionAudit(
        principal,
        toDoc,
        toDoc.version,
        `Rolled over ${rolled.length} nodes into "${toDoc.title}"`,
        "outline.rollover",
      );
    }

    this.sseHub.publish({
      type: "outline.rolled_over",
      workspaceId: principal.workspaceId,
      spaceId: toDoc.spaceId,
      documentId: toDoc.id,
      documentKind: toDoc.kind,
      tags: toDoc.tags,
      actorType: principal.actorType,
      payload: {
        fromDocumentId,
        toDocumentId,
        nodes: rolled,
      },
    });

    return rolled;
  }

  async batchMutate(
    principal: Principal,
    input: BatchOutlineNodesInput | BatchOutlineNodesRequestInput,
  ): Promise<BatchOutlineNodesResult> {
    let documentId = input.documentId;
    if (!documentId) {
      const explicitDocIds = [
        ...new Set(
          input.operations
            .map((op) => op.documentId)
            .filter((id): id is DocumentId => typeof id === "string" && id.length > 0),
        ),
      ];
      if (explicitDocIds.length === 1) {
        documentId = explicitDocIds[0];
      } else if (explicitDocIds.length > 1) {
        throw new InkadeError(
          "VALIDATION_ERROR",
          "All operations in a batch must target a single documentId",
        );
      } else {
        for (const op of input.operations) {
          if (op.op !== "create") {
            documentId = await resolveOutlineNodeDocumentId(
              this.repos.outlineRepo,
              principal.workspaceId,
              op.nodeId,
            );
            break;
          }
        }
      }
    }

    if (!documentId) {
      throw new InkadeError("VALIDATION_ERROR", "documentId is required for outline batch mutation");
    }

    const [doc, allSpaces] = await Promise.all([
      this.getActiveDocumentOrThrow(principal.workspaceId, documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);

    const requiredActions = new Set<ScopeAction>();
    for (const op of input.operations) {
      if (op.op === "delete") requiredActions.add("soft_delete");
      else if (op.op === "update" || op.op === "move") requiredActions.add("write");
      else requiredActions.add("append");
    }

    for (const action of requiredActions) {
      assertScope(
        principal.scope,
        action,
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      );
    }

    const batchCtx = this.auditService?.ensureActiveBatchContext(principal);
    const result = await batchMutateOutlineInTx(
      this.repos,
      principal.workspaceId,
      doc,
      input.operations,
      {
        actorType: principal.kind === "token" ? "agent" : "human",
        actorId: principal.actorId,
        batchId: batchCtx?.batchId,
        executionMode: batchCtx?.executionMode,
      },
    );

    await this.captureOutlineRevisionAudit(
      principal,
      doc,
      doc.version,
      `Batch mutated outline (${input.operations.length} ops)`,
      "outline.batch_mutate",
    );

    this.sseHub.publish({
      type: "outline.batch_mutated",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: {
        documentId: result.documentId,
        tempIdMap: result.tempIdMap,
        createdIds: result.created.map((n) => n.id),
        updatedIds: result.updated.map((n) => n.id),
        movedIds: result.moved.map((n) => n.id),
        deletedIds: result.deletedIds,
      },
    });
    this.onDocumentChanged?.(principal.workspaceId, doc.id);

    for (const node of [...result.created, ...result.updated]) {
      await this.syncMirrorCluster(principal, node);
    }
    await this.wakeService?.claimUnownedForDocumentWrite(principal, doc.id);

    return result;
  }

  async restoreRevisionSnapshot(
    principal: Principal,
    documentId: DocumentId,
    targetRevisionId: RevisionId,
    changeSummary?: string,
  ): Promise<OutlineRevisionRestoreResult> {
    const [doc, allSpaces] = await Promise.all([
      this.getActiveDocumentOrThrow(principal.workspaceId, documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);
    assertScope(
      principal.scope,
      "write",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    const restored = await restoreOutlineRevisionInTx(
      this.repos,
      principal.workspaceId,
      doc,
      targetRevisionId,
      {
        actorType: principal.actorType,
        actorId: principal.actorId,
        changeSummary,
      },
    );

    this.sseHub.publish({
      type: "document.updated",
      workspaceId: principal.workspaceId,
      spaceId: restored.document.spaceId,
      documentId: restored.document.id,
      documentKind: restored.document.kind,
      tags: restored.document.tags,
      actorType: principal.actorType,
      payload: { document: restored.document },
    });
    this.sseHub.publish({
      type: "outline.batch_mutated",
      workspaceId: principal.workspaceId,
      spaceId: restored.document.spaceId,
      documentId: restored.document.id,
      documentKind: restored.document.kind,
      tags: restored.document.tags,
      actorType: principal.actorType,
      payload: {
        documentId: restored.document.id,
        tempIdMap: {},
        createdIds: [],
        updatedIds: restored.nodes.map((n) => n.id),
        movedIds: [],
        deletedIds: [],
      },
    });
    this.onDocumentChanged?.(principal.workspaceId, restored.document.id);

    return restored;
  }
}
