import {
  asOutlineNodeId,
  classifyTaskBucket,
  computeLocalTextEmbedding,
  cosineSimilarity,
  DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
  DEFAULT_WORKSPACE_STORAGE_QUOTA_BYTES,
  evaluateScopeAccess,
  formatUtcIsoDate,
  InkadeError,
  isSystemInternalDocument,
  resolveAllowedSpaceIds,
  slotForScheduledStartMin,
  todayLocalDateString,
  type AdeThreadBinding,
  type AwaySummaryItem,
  type AwaySummaryQuery,
  type AwaySummaryResponse,
  type DocumentGraph,
  type DocumentGraphEdge,
  type DocumentGraphNode,
  type DocumentId,
  type DocumentSummary,
  type LinkId,
  type OutlineNode,
  type OutlineNodeId,
  type ParsedListTasksQuery,
  type Space,
  type SpaceId,
  type StorageBucketsResponse,
  type UnlinkedMentionItem,
  type WorkspaceGraph,
  type WorkspaceGraphEdge,
  type WorkspaceGraphNode,
  type WorkspaceGraphQuery,
  type WorkspaceSummary,
  type WorkspaceTaskItem,
  type WorkspaceTaskSubtask,
} from "@inkade/core";
import {
  DEFAULT_SPACE_IDS,
  type AuditRepo,
  type DocumentRepo,
  type OutlineRepo,
  type RevisionLinkRepo,
  type SearchConfigRepo,
  type SpaceRepo,
  type ThreadBindingRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";
import type { DocumentService } from "./document-service.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export type ListTasksServiceQuery = {
  readonly [K in keyof ParsedListTasksQuery]?: ParsedListTasksQuery[K] | undefined;
};

function buildRecentDateKeys(days = 90): string[] {
  const result: string[] = [];
  const today = new Date();
  const baseUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    result.push(formatUtcIsoDate(new Date(baseUtc - i * 86_400_000)));
  }
  return result;
}

function stripCodeAndWikilinks(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/\[\[[^[\]]+?\]\]/g, " ");
}

function countOccurrences(haystack: string, needle: string): { count: number; firstIndex: number } {
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  if (!lowerNeedle) return { count: 0, firstIndex: -1 };

  let count = 0;
  let firstIndex = -1;
  let pos = 0;
  while (true) {
    const idx = lowerHaystack.indexOf(lowerNeedle, pos);
    if (idx < 0) break;
    if (firstIndex < 0) firstIndex = idx;
    count++;
    pos = idx + lowerNeedle.length;
  }
  return { count, firstIndex };
}

export interface WorkspaceServiceRepos {
  readonly documentRepo: DocumentRepo;
  readonly outlineRepo: OutlineRepo;
  readonly revisionLinkRepo: RevisionLinkRepo;
  readonly threadBindingRepo: ThreadBindingRepo;
  readonly auditRepo: AuditRepo;
  readonly spaceRepo: SpaceRepo;
  readonly searchConfigRepo?: SearchConfigRepo | undefined;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
}

function buildScopeFilter(principal: Principal, allSpaces: readonly Space[]) {
  const allowedSpaces = resolveAllowedSpaceIds(principal.scope, allSpaces);
  const spaceIds = allowedSpaces === "*" ? undefined : [...allowedSpaces];
  const allowedKinds = principal.scope.allowedKinds;
  const tagAllowlist = principal.scope.tagAllowlist;
  const isEmpty =
    (spaceIds !== undefined && spaceIds.length === 0) ||
    (allowedKinds !== undefined && allowedKinds.length === 0);
  return { spaceIds, allowedKinds, tagAllowlist, isEmpty };
}

export class WorkspaceService {
  constructor(
    private readonly repos: WorkspaceServiceRepos,
    private readonly documentService: DocumentService,
  ) {}

  async getSummary(principal: Principal): Promise<WorkspaceSummary> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const filter = buildScopeFilter(principal, allSpaces);
    const [allDocs, allBindings] = await Promise.all([
      filter.isEmpty
        ? Promise.resolve([] as readonly DocumentSummary[])
        : this.repos.documentRepo.listDocumentSummaries(principal.workspaceId, {
            spaceIds: filter.spaceIds,
            allowedKinds: filter.allowedKinds,
            tagAllowlist: filter.tagAllowlist,
            includeTrashed: false,
            limit: null,
          }),
      this.repos.threadBindingRepo.listThreadBindings(principal.workspaceId),
    ]);

    const visibleDocs = allDocs.filter(
      (doc) =>
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        ).allowed,
    );
    const visibleDocMap = new Map(visibleDocs.map((d) => [d.id, d]));

    const visibleActiveSpaces = allSpaces.filter(
      (s) =>
        s.archivedAt === null &&
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: s.id, resourceType: "space" },
          allSpaces,
        ).allowed,
    );

    const countBySpace = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const dailyDocByDate = new Map<string, DocumentSummary>();

    for (const doc of visibleDocs) {
      countBySpace.set(doc.spaceId, (countBySpace.get(doc.spaceId) ?? 0) + 1);
      for (const tag of doc.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
      if (doc.kind === "outline" && doc.dailyDate) {
        dailyDocByDate.set(doc.dailyDate, doc);
      }
    }

    const inboxSpace =
      visibleActiveSpaces.find((s) => s.id === DEFAULT_SPACE_IDS.inbox) ??
      visibleActiveSpaces.find((s) => s.slug === "inbox");
    const inboxCount = inboxSpace ? (countBySpace.get(inboxSpace.id) ?? 0) : 0;

    let attentionThreadsCount = 0;
    for (const binding of allBindings) {
      if (!visibleDocMap.has(binding.documentId)) continue;
      if (binding.status === "waiting_input" || binding.unreadResult) {
        attentionThreadsCount++;
      }
    }

    const dateKeys = buildRecentDateKeys(90);
    const dailyActivity = await Promise.all(
      dateKeys.map(async (date) => {
        const doc = dailyDocByDate.get(date);
        if (!doc) {
          return {
            date,
            documentId: null,
            nodeCount: 0,
            openTaskCount: 0,
            completedTaskCount: 0,
          };
        }
        const nodes = await this.repos.outlineRepo.listOutlineNodes(doc.id);
        let openTaskCount = 0;
        let completedTaskCount = 0;
        for (const node of nodes) {
          if (node.checked === false) openTaskCount++;
          else if (node.checked === true) completedTaskCount++;
        }
        return {
          date,
          documentId: doc.id,
          nodeCount: nodes.length,
          openTaskCount,
          completedTaskCount,
        };
      }),
    );

    const tags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));

    return {
      spaces: visibleActiveSpaces.map((s) => ({
        spaceId: s.id,
        slug: s.slug,
        name: s.name,
        activeCount: countBySpace.get(s.id) ?? 0,
      })),
      inboxCount,
      attentionThreadsCount,
      tags,
      dailyActivity,
    };
  }

  async listTasks(
    principal: Principal,
    query: ListTasksServiceQuery = {},
  ): Promise<readonly WorkspaceTaskItem[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );

    if (query.spaceId) {
      assertScope(
        principal.scope,
        "read",
        { spaceId: query.spaceId, resourceType: "space" },
        allSpaces,
      );
    }

    const filter = buildScopeFilter(principal, allSpaces);
    const [indexedRows, bindings] = await Promise.all([
      filter.isEmpty
        ? Promise.resolve([])
        : this.repos.outlineRepo.listDocumentTasks(principal.workspaceId, {
            status: query.status ?? "all",
            sourceEngine: query.sourceEngine,
            spaceId: query.spaceId,
            spaceIds: filter.spaceIds,
            allowedKinds: filter.allowedKinds,
            tag: query.tag,
            tagAllowlist: filter.tagAllowlist,
            priority: query.priority,
            scheduledDate: query.scheduledDate,
            dueDate: query.dueDate,
            includeAnytime: query.includeAnytime !== false,
          }),
      this.repos.threadBindingRepo.listThreadBindings(principal.workspaceId),
    ]);

    const visibleRows = indexedRows.filter(
      (entry) =>
        evaluateScopeAccess(
          principal.scope,
          "read",
          {
            spaceId: entry.task.spaceId,
            kind: entry.documentKind,
            tags: entry.task.tags,
          },
          allSpaces,
        ).allowed,
    );

    const outlineDocIds = [
      ...new Set(
        visibleRows
          .filter((entry) => entry.task.sourceEngine === "outline")
          .map((entry) => entry.task.docId),
      ),
    ];
    const outlineNodesLists = await Promise.all(
      outlineDocIds.map(async (docId) => ({
        docId,
        nodes: await this.repos.outlineRepo.listOutlineNodes(docId),
      })),
    );
    const outlineNodeById = new Map<string, OutlineNode>();
    const subtasksByParent = new Map<OutlineNodeId, WorkspaceTaskSubtask[]>();
    for (const { nodes } of outlineNodesLists) {
      for (const candidate of nodes) {
        outlineNodeById.set(candidate.id, candidate);
        if (!candidate.parentNodeId || candidate.checked === null) continue;
        const sub: WorkspaceTaskSubtask = {
          id: candidate.id,
          contentMarkdown: candidate.contentMarkdown,
          contentText: candidate.contentText,
          checked: candidate.checked === true,
        };
        const list = subtasksByParent.get(candidate.parentNodeId);
        if (list) list.push(sub);
        else subtasksByParent.set(candidate.parentNodeId, [sub]);
      }
    }

    const bindingsByNodeId = new Map<OutlineNodeId, AdeThreadBinding[]>();
    for (const binding of bindings) {
      if (!binding.nodeId) continue;
      const list = bindingsByNodeId.get(binding.nodeId);
      if (list) list.push(binding);
      else bindingsByNodeId.set(binding.nodeId, [binding]);
    }

    const todayIso = todayLocalDateString();
    const priorityRank: Readonly<Record<string, number>> = {
      p1: 1,
      p2: 2,
      p3: 3,
      p4: 4,
      none: 5,
    };

    const items: WorkspaceTaskItem[] = [];

    for (const entry of visibleRows) {
      const { task } = entry;
      if (query.bucket) {
        const itemBucket = classifyTaskBucket(
          {
            checked: task.completed,
            scheduledDate: task.scheduledDate,
            dueDate: task.dueDate,
          },
          todayIso,
        );
        if (itemBucket !== query.bucket) continue;
      }

      if (task.sourceEngine === "outline") {
        const outlineNode = outlineNodeById.get(task.blockKey);
        if (!outlineNode) continue;
        const subtasks = subtasksByParent.get(outlineNode.id);
        items.push({
          taskId: task.id,
          sourceEngine: "outline",
          blockKey: task.blockKey,
          lineIndex: task.lineIndex,
          node: outlineNode,
          document: {
            id: task.docId,
            title: entry.documentTitle,
            kind: entry.documentKind,
            spaceId: task.spaceId,
            dailyDate: entry.documentDailyDate,
            tags: task.tags,
          },
          bindings: bindingsByNodeId.get(outlineNode.id) ?? [],
          ...(subtasks && subtasks.length > 0 ? { subtasks } : {}),
        });
        continue;
      }

      const virtualNodeId = asOutlineNodeId(task.id);
      const virtualNode: OutlineNode = {
        id: virtualNodeId,
        documentId: task.docId,
        parentNodeId: null,
        orderKey: String(task.lineIndex ?? 0).padStart(6, "0"),
        contentMarkdown: task.title,
        contentText: task.title,
        noteMarkdown: "",
        noteText: "",
        checked: task.completed,
        collapsed: false,
        authorType: "human",
        authorId: null,
        sourceBindingId: null,
        ...(task.priority ? { priority: task.priority } : {}),
        ...(task.scheduledDate ? { scheduledDate: task.scheduledDate } : {}),
        ...(task.scheduledStartMin !== null
          ? {
              scheduledStartMin: task.scheduledStartMin,
              scheduledSlot: slotForScheduledStartMin(task.scheduledStartMin),
            }
          : {}),
        ...(task.durationMin !== null ? { durationMin: task.durationMin } : {}),
        ...(task.dueDate ? { dueDate: task.dueDate } : {}),
        ...(task.recurrenceRule ? { recurrenceRule: task.recurrenceRule } : {}),
        createdAt: task.updatedAt,
        updatedAt: task.updatedAt,
        deletedAt: null,
      };
      items.push({
        taskId: task.id,
        sourceEngine: "markdown",
        blockKey: task.blockKey,
        lineIndex: task.lineIndex,
        node: virtualNode,
        document: {
          id: task.docId,
          title: entry.documentTitle,
          kind: entry.documentKind,
          spaceId: task.spaceId,
          dailyDate: entry.documentDailyDate,
          tags: task.tags,
        },
        bindings: [],
      });
    }

    items.sort((a, b) => {
      const schedA = a.node.scheduledDate ?? "9999-12-31";
      const schedB = b.node.scheduledDate ?? "9999-12-31";
      if (schedA !== schedB) return schedA.localeCompare(schedB);
      const startA = a.node.scheduledStartMin ?? 9999;
      const startB = b.node.scheduledStartMin ?? 9999;
      if (startA !== startB) return startA - startB;
      const rankA = priorityRank[a.node.priority ?? "none"] ?? 5;
      const rankB = priorityRank[b.node.priority ?? "none"] ?? 5;
      if (rankA !== rankB) return rankA - rankB;
      return a.node.orderKey.localeCompare(b.node.orderKey);
    });

    const offset = Math.max(query.offset ?? 0, 0);
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
    return items.slice(offset, offset + limit);
  }

  async findUnlinkedMentions(
    principal: Principal,
    documentId: DocumentId,
  ): Promise<readonly UnlinkedMentionItem[]> {
    const targetDoc = await this.documentService.getDocument(principal, documentId);
    const rawAliases = Array.isArray(targetDoc.properties?.aliases)
      ? targetDoc.properties.aliases.filter((v): v is string => typeof v === "string")
      : [];

    const terms = [...new Set([targetDoc.title, ...rawAliases].map((t) => t.trim()))].filter(
      (t) => t.length >= 2,
    );
    if (terms.length === 0) return [];

    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const filter = buildScopeFilter(principal, allSpaces);
    const allDocs = filter.isEmpty
      ? []
      : await this.repos.documentRepo.listDocuments(principal.workspaceId, {
          spaceIds: filter.spaceIds,
          allowedKinds: filter.allowedKinds,
          tagAllowlist: filter.tagAllowlist,
          includeTrashed: false,
          limit: null,
        });

    const visibleDocs = allDocs.filter(
      (doc) =>
        doc.id !== documentId &&
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        ).allowed,
    );

    const mentions: UnlinkedMentionItem[] = [];

    for (const doc of visibleDocs) {
      if (doc.contentMarkdown) {
        const cleaned = stripCodeAndWikilinks(doc.contentMarkdown);
        let bestCount = 0;
        let bestIdx = -1;
        let matchedLen = 0;
        for (const term of terms) {
          const { count, firstIndex } = countOccurrences(cleaned, term);
          if (count > 0) {
            bestCount += count;
            if (bestIdx < 0 || firstIndex < bestIdx) {
              bestIdx = firstIndex;
              matchedLen = term.length;
            }
          }
        }
        if (bestCount > 0 && bestIdx >= 0) {
          const start = Math.max(0, bestIdx - 40);
          const end = Math.min(cleaned.length, bestIdx + matchedLen + 40);
          mentions.push({
            documentId: doc.id,
            documentTitle: doc.title,
            spaceId: doc.spaceId,
            kind: doc.kind,
            nodeId: null,
            snippet: cleaned.slice(start, end).replace(/\s+/g, " ").trim(),
            matchCount: bestCount,
          });
        }
      }

      if (doc.kind === "outline") {
        const nodes = await this.repos.outlineRepo.listOutlineNodes(doc.id);
        for (const node of nodes) {
          const combined = [node.contentMarkdown, node.noteMarkdown].filter(Boolean).join(" ");
          const cleaned = stripCodeAndWikilinks(combined);
          let bestCount = 0;
          let bestIdx = -1;
          let matchedLen = 0;
          for (const term of terms) {
            const { count, firstIndex } = countOccurrences(cleaned, term);
            if (count > 0) {
              bestCount += count;
              if (bestIdx < 0 || firstIndex < bestIdx) {
                bestIdx = firstIndex;
                matchedLen = term.length;
              }
            }
          }
          if (bestCount > 0 && bestIdx >= 0) {
            const start = Math.max(0, bestIdx - 40);
            const end = Math.min(cleaned.length, bestIdx + matchedLen + 40);
            mentions.push({
              documentId: doc.id,
              documentTitle: doc.title,
              spaceId: doc.spaceId,
              kind: doc.kind,
              nodeId: node.id,
              snippet: cleaned.slice(start, end).replace(/\s+/g, " ").trim(),
              matchCount: bestCount,
            });
          }
        }
      }
    }

    return mentions;
  }

  async getDocumentGraph(
    principal: Principal,
    documentId: DocumentId,
    depthInput = 2,
  ): Promise<DocumentGraph> {
    const maxDepth = Math.min(Math.max(depthInput, 1), 2);
    const centerDoc = await this.documentService.getDocument(principal, documentId);
    if (centerDoc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }

    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const filter = buildScopeFilter(principal, allSpaces);
    const allDocs = filter.isEmpty
      ? []
      : await this.repos.documentRepo.listDocumentSummaries(principal.workspaceId, {
          spaceIds: filter.spaceIds,
          allowedKinds: filter.allowedKinds,
          tagAllowlist: filter.tagAllowlist,
          includeTrashed: false,
          limit: null,
        });

    const visibleDocMap = new Map<DocumentId, DocumentSummary>();
    for (const doc of allDocs) {
      if (
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        ).allowed
      ) {
        visibleDocMap.set(doc.id, doc);
      }
    }

    const depthById = new Map<DocumentId, number>([[centerDoc.id, 0]]);
    const frontier: Array<{ id: DocumentId; depth: number }> = [{ id: centerDoc.id, depth: 0 }];
    const edgeMap = new Map<LinkId, DocumentGraphEdge>();

    while (frontier.length > 0) {
      const current = frontier.shift();
      if (!current || current.depth >= maxDepth) continue;

      const [outgoing, incoming] = await Promise.all([
        this.repos.revisionLinkRepo.listOutgoingLinks(principal.workspaceId, current.id),
        this.repos.revisionLinkRepo.listBacklinks(principal.workspaceId, current.id),
      ]);

      for (const link of [...outgoing, ...incoming]) {
        if (!link.targetDocumentId) continue;
        if (!visibleDocMap.has(link.sourceDocumentId) || !visibleDocMap.has(link.targetDocumentId)) {
          continue;
        }

        edgeMap.set(link.id, {
          id: link.id,
          sourceDocumentId: link.sourceDocumentId,
          targetDocumentId: link.targetDocumentId,
          anchorText: link.anchorText,
        });

        const neighborId =
          link.sourceDocumentId === current.id ? link.targetDocumentId : link.sourceDocumentId;
        if (!depthById.has(neighborId)) {
          const nextDepth = current.depth + 1;
          depthById.set(neighborId, nextDepth);
          frontier.push({ id: neighborId, depth: nextDepth });
        }
      }
    }

    const nodes: DocumentGraphNode[] = [];
    for (const [docId, depth] of depthById.entries()) {
      const doc = visibleDocMap.get(docId);
      if (!doc) continue;
      nodes.push({
        id: doc.id,
        title: doc.title,
        slug: doc.slug,
        spaceId: doc.spaceId,
        kind: doc.kind,
        tags: doc.tags,
        depth,
      });
    }

    return {
      centerDocumentId: centerDoc.id,
      nodes,
      edges: [...edgeMap.values()],
    };
  }

  async getAwaySummary(
    principal: Principal,
    query: AwaySummaryQuery = {},
  ): Promise<AwaySummaryResponse> {
    const nowMs = Date.now();
    const hasExplicitSince = typeof query.since === "string" && query.since.trim().length > 0;
    const sinceIso = hasExplicitSince
      ? query.since!.trim()
      : new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    const sinceMs = Date.parse(sinceIso);
    if (!Number.isFinite(sinceMs)) {
      throw new InkadeError("VALIDATION_ERROR", `Invalid "since" timestamp: "${sinceIso}"`);
    }

    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const filter = buildScopeFilter(principal, allSpaces);
    const [allDocs, allBindings] = await Promise.all([
      filter.isEmpty
        ? Promise.resolve([] as readonly DocumentSummary[])
        : this.repos.documentRepo.listDocumentSummaries(principal.workspaceId, {
            spaceIds: filter.spaceIds,
            allowedKinds: filter.allowedKinds,
            tagAllowlist: filter.tagAllowlist,
            includeTrashed: false,
            limit: null,
          }),
      this.repos.threadBindingRepo.listThreadBindings(principal.workspaceId),
    ]);

    const visibleDocs = allDocs.filter(
      (doc) =>
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        ).allowed,
    );
    const visibleDocMap = new Map(visibleDocs.map((d) => [d.id, d]));

    const needsDecision: AwaySummaryItem[] = [];
    const failed: AwaySummaryItem[] = [];
    const completed: AwaySummaryItem[] = [];
    const unreadDocuments: AwaySummaryItem[] = [];

    for (const binding of allBindings) {
      const doc = visibleDocMap.get(binding.documentId);
      if (!doc) continue;

      const updatedTs = Math.max(
        Date.parse(binding.lastSyncedAt) || 0,
        Date.parse(binding.createdAt) || 0,
      );
      const isSince = updatedTs >= sinceMs;

      const hasPendingDecision =
        binding.status === "waiting_input" ||
        (binding.pendingApproval != null && !binding.pendingApproval.decision);

      if (hasPendingDecision) {
        if (!hasExplicitSince || isSince) {
          needsDecision.push({
            id: `binding:${binding.id}`,
            category: "needs_decision",
            documentId: doc.id,
            documentTitle: doc.title,
            documentKind: doc.kind,
            spaceId: doc.spaceId,
            bindingId: binding.id,
            title: binding.pendingApproval?.action ?? binding.title,
            summary: binding.lastSummary,
            status: binding.status,
            updatedAt: binding.lastSyncedAt,
          });
        }
        continue;
      }

      if (binding.status === "failed") {
        if (hasExplicitSince ? isSince : binding.unreadResult || isSince) {
          failed.push({
            id: `binding:${binding.id}`,
            category: "failed",
            documentId: doc.id,
            documentTitle: doc.title,
            documentKind: doc.kind,
            spaceId: doc.spaceId,
            bindingId: binding.id,
            title: binding.title,
            summary: binding.lastSummary,
            status: binding.status,
            updatedAt: binding.lastSyncedAt,
          });
        }
        continue;
      }

      if (binding.status === "completed") {
        if (hasExplicitSince ? isSince : binding.unreadResult || isSince) {
          completed.push({
            id: `binding:${binding.id}`,
            category: "completed",
            documentId: doc.id,
            documentTitle: doc.title,
            documentKind: doc.kind,
            spaceId: doc.spaceId,
            bindingId: binding.id,
            title: binding.title,
            summary: binding.lastSummary,
            status: binding.status,
            updatedAt: binding.lastSyncedAt,
          });
        }
      }
    }

    for (const doc of visibleDocs) {
      if (!doc.unreadAgentUpdate) continue;
      const docTs = Date.parse(doc.updatedAt) || 0;
      if (hasExplicitSince ? docTs >= sinceMs : true) {
        unreadDocuments.push({
          id: `doc:${doc.id}`,
          category: "unread_document",
          documentId: doc.id,
          documentTitle: doc.title,
          documentKind: doc.kind,
          spaceId: doc.spaceId,
          bindingId: null,
          title: doc.title,
          summary: doc.excerpt || null,
          updatedAt: doc.updatedAt,
        });
      }
    }

    const byNewest = (a: AwaySummaryItem, b: AwaySummaryItem) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
    needsDecision.sort(byNewest);
    failed.sort(byNewest);
    completed.sort(byNewest);
    unreadDocuments.sort(byNewest);

    const items = [...needsDecision, ...failed, ...completed, ...unreadDocuments];
    return {
      since: sinceIso,
      generatedAt: new Date(nowMs).toISOString(),
      elapsedMs: Math.max(0, nowMs - sinceMs),
      totalCount: items.length,
      counts: {
        needsDecision: needsDecision.length,
        failed: failed.length,
        completed: completed.length,
        unreadDocuments: unreadDocuments.length,
      },
      items,
    };
  }

  async getStorageBuckets(principal: Principal): Promise<StorageBucketsResponse> {
    const quotaRaw = process.env.INKADE_STORAGE_QUOTA_BYTES;
    const parsedQuota = quotaRaw ? Number(quotaRaw) : Number.NaN;
    const quotaLimitBytes =
      Number.isFinite(parsedQuota) && parsedQuota > 0
        ? Math.floor(parsedQuota)
        : DEFAULT_WORKSPACE_STORAGE_QUOTA_BYTES;

    const isUnrestrictedAdmin =
      principal.scope.permission === "admin" &&
      principal.scope.spaceIds === "*" &&
      !principal.scope.allowedKinds &&
      (!principal.scope.tagAllowlist || principal.scope.tagAllowlist.length === 0);

    if (isUnrestrictedAdmin) {
      return this.repos.auditRepo.getStorageBuckets(principal.workspaceId, {
        visibleDocumentIds: "*",
        quotaLimitBytes,
      });
    }

    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const filter = buildScopeFilter(principal, allSpaces);
    const allDocs = filter.isEmpty
      ? []
      : await this.repos.documentRepo.listDocumentSummaries(principal.workspaceId, {
          spaceIds: filter.spaceIds,
          allowedKinds: filter.allowedKinds,
          tagAllowlist: filter.tagAllowlist,
          includeTrashed: true,
          limit: null,
        });

    const visibleDocIds = new Set<DocumentId>();
    for (const doc of allDocs) {
      if (
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        ).allowed
      ) {
        visibleDocIds.add(doc.id);
      }
    }

    return this.repos.auditRepo.getStorageBuckets(principal.workspaceId, {
      visibleDocumentIds: visibleDocIds,
      quotaLimitBytes,
    });
  }

  async getWorkspaceGraph(
    principal: Principal,
    query: WorkspaceGraphQuery = {},
  ): Promise<WorkspaceGraph> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );

    let spaceFilterSet: Set<SpaceId> | null = null;
    if (query.spaceId) {
      const targetExists = allSpaces.some((s) => s.id === query.spaceId);
      if (!targetExists) {
        return { nodes: [], edges: [] };
      }
      assertScope(
        principal.scope,
        "read",
        { spaceId: query.spaceId, resourceType: "space" },
        allSpaces,
      );
      const childrenByParent = new Map<SpaceId, SpaceId[]>();
      for (const space of allSpaces) {
        if (!space.parentId) continue;
        const list = childrenByParent.get(space.parentId) ?? [];
        list.push(space.id);
        childrenByParent.set(space.parentId, list);
      }
      spaceFilterSet = new Set<SpaceId>([query.spaceId]);
      const queue: SpaceId[] = [query.spaceId];
      while (queue.length > 0) {
        const cur = queue.shift();
        if (!cur) continue;
        for (const child of childrenByParent.get(cur) ?? []) {
          if (!spaceFilterSet.has(child)) {
            spaceFilterSet.add(child);
            queue.push(child);
          }
        }
      }
    }

    const filter = buildScopeFilter(principal, allSpaces);
    const allDocs = filter.isEmpty
      ? []
      : await this.repos.documentRepo.listDocumentSummaries(principal.workspaceId, {
          spaceIds: filter.spaceIds,
          allowedKinds: filter.allowedKinds,
          tagAllowlist: filter.tagAllowlist,
          includeTrashed: false,
          limit: null,
        });

    const visibleDocs = allDocs.filter((doc) => {
      if (doc.trashedAt !== null || isSystemInternalDocument(doc)) return false;
      if (
        !evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        ).allowed
      ) {
        return false;
      }
      if (spaceFilterSet && !spaceFilterSet.has(doc.spaceId)) return false;
      if (query.kind && doc.kind !== query.kind) return false;
      if (query.tag && !doc.tags.includes(query.tag)) return false;
      return true;
    });

    if (visibleDocs.length === 0) {
      return { nodes: [], edges: [] };
    }

    const visibleIds = new Set(visibleDocs.map((d) => d.id));
    const includeSemantic = query.includeSemantic !== false;

    const [rawLinks, rawMirrors, rawEmbeddings] = await Promise.all([
      this.repos.revisionLinkRepo.listWorkspaceDocumentLinks(principal.workspaceId),
      this.repos.outlineRepo.listWorkspaceMirrorNodePairs(principal.workspaceId),
      includeSemantic && this.repos.searchConfigRepo
        ? this.repos.searchConfigRepo.listDocumentEmbeddings(principal.workspaceId)
        : Promise.resolve([]),
    ]);

    const edges: WorkspaceGraphEdge[] = [];
    const explicitPairs = new Set<string>();
    const mirrorPairs = new Set<string>();

    const makeUndirectedKey = (a: DocumentId, b: DocumentId): string =>
      a < b ? `${a}|${b}` : `${b}|${a}`;

    for (const link of rawLinks) {
      if (
        !visibleIds.has(link.sourceDocumentId) ||
        !visibleIds.has(link.targetDocumentId) ||
        link.sourceDocumentId === link.targetDocumentId
      ) {
        continue;
      }
      explicitPairs.add(makeUndirectedKey(link.sourceDocumentId, link.targetDocumentId));
      edges.push({
        id: `explicit:${link.sourceDocumentId}:${link.targetDocumentId}`,
        source: link.sourceDocumentId,
        target: link.targetDocumentId,
        kind: "explicit",
        weight: 1,
      });
    }

    for (const mirror of rawMirrors) {
      if (
        !visibleIds.has(mirror.mirrorDocumentId) ||
        !visibleIds.has(mirror.targetDocumentId) ||
        mirror.mirrorDocumentId === mirror.targetDocumentId
      ) {
        continue;
      }
      const pairKey = makeUndirectedKey(mirror.mirrorDocumentId, mirror.targetDocumentId);
      if (mirrorPairs.has(pairKey)) continue;
      mirrorPairs.add(pairKey);
      edges.push({
        id: `mirror:${pairKey}`,
        source: mirror.mirrorDocumentId,
        target: mirror.targetDocumentId,
        kind: "mirror",
        weight: 0.95,
      });
    }

    if (includeSemantic && visibleDocs.length >= 2) {
      const semanticThreshold = query.semanticThreshold ?? 0.45;
      const byModel = new Map<string, Map<DocumentId, readonly number[]>>();
      for (const emb of rawEmbeddings) {
        if (!visibleIds.has(emb.documentId) || emb.vector.length === 0) continue;
        let modelMap = byModel.get(emb.model);
        if (!modelMap) {
          modelMap = new Map();
          byModel.set(emb.model, modelMap);
        }
        modelMap.set(emb.documentId, emb.vector);
      }

      let primaryStoredMap: Map<DocumentId, readonly number[]> | null = null;
      for (const modelMap of byModel.values()) {
        if (!primaryStoredMap || modelMap.size > primaryStoredMap.size) {
          primaryStoredMap = modelMap;
        }
      }

      const localVectors = new Map<DocumentId, readonly number[]>();
      const getFallbackVector = (doc: DocumentSummary): readonly number[] => {
        const cached = localVectors.get(doc.id);
        if (cached) return cached;
        const vec = computeLocalTextEmbedding(
          `${doc.title}\n${doc.tags.join(" ")}\n${doc.excerpt}`,
          DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
        );
        localVectors.set(doc.id, vec);
        return vec;
      };

      const semanticCandidates = new Map<string, WorkspaceGraphEdge>();
      const topNeighborsByDoc = new Map<
        DocumentId,
        Array<{ readonly targetId: DocumentId; readonly score: number }>
      >();

      for (let i = 0; i < visibleDocs.length; i++) {
        const a = visibleDocs[i];
        if (!a) continue;
        for (let j = i + 1; j < visibleDocs.length; j++) {
          const b = visibleDocs[j];
          if (!b) continue;
          const pairKey = makeUndirectedKey(a.id, b.id);
          if (explicitPairs.has(pairKey)) continue;

          const vecA = primaryStoredMap?.get(a.id);
          const vecB = primaryStoredMap?.get(b.id);
          let similarity = 0;
          if (vecA && vecB && vecA.length === vecB.length) {
            similarity = cosineSimilarity(vecA, vecB);
          } else {
            similarity = cosineSimilarity(getFallbackVector(a), getFallbackVector(b));
          }

          if (similarity < semanticThreshold) continue;
          const listA = topNeighborsByDoc.get(a.id) ?? [];
          listA.push({ targetId: b.id, score: similarity });
          topNeighborsByDoc.set(a.id, listA);

          const listB = topNeighborsByDoc.get(b.id) ?? [];
          listB.push({ targetId: a.id, score: similarity });
          topNeighborsByDoc.set(b.id, listB);
        }
      }

      for (const [docId, neighbors] of topNeighborsByDoc.entries()) {
        neighbors.sort((x, y) => y.score - x.score);
        for (const n of neighbors.slice(0, 3)) {
          const pairKey = makeUndirectedKey(docId, n.targetId);
          if (semanticCandidates.has(pairKey)) continue;
          const [source, target] = docId < n.targetId ? [docId, n.targetId] : [n.targetId, docId];
          semanticCandidates.set(pairKey, {
            id: `semantic:${pairKey}`,
            source,
            target,
            kind: "semantic",
            weight: Number(n.score.toFixed(4)),
          });
        }
      }

      for (const edge of semanticCandidates.values()) {
        edges.push(edge);
      }
    }

    const degreeById = new Map<DocumentId, number>();
    for (const edge of edges) {
      degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
      degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
    }

    const includeIsolated = query.includeIsolated !== false;
    const nodes: WorkspaceGraphNode[] = [];
    for (const doc of visibleDocs) {
      const degree = degreeById.get(doc.id) ?? 0;
      if (!includeIsolated && degree === 0) continue;
      nodes.push({
        id: doc.id,
        title: doc.title,
        slug: doc.slug,
        kind: doc.kind,
        spaceId: doc.spaceId,
        tags: doc.tags,
        updatedAt: doc.updatedAt,
        degree,
      });
    }

    nodes.sort(
      (a, b) =>
        b.degree - a.degree ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.title.localeCompare(b.title),
    );

    return { nodes, edges };
  }
}
