import { z } from "zod";
import {
  asAuditLogId,
  type ApiTokenId,
  type AuditBatchId,
  type AuditLogId,
  type DocumentId,
  type OutlineNodeId,
  type RevisionId,
  type SpaceId,
  type ThreadBindingId,
} from "./ids.ts";
import {
  agentApprovalDecisionSchema,
  agentSteeringModeSchema,
  isoTimestampSchema,
  type AdeThreadBinding,
  type AdeThreadStatus,
  type AuditLogRecord,
  type DocumentKind,
  type DocumentRecord,
  type ExecutionMode,
  type OutlineNode,
  type SelectionAnchor,
} from "./types/index.ts";

export {
  AUTONOMY_LEVELS,
  QUIET_AUTONOMY_MODES,
  autonomyLevelSchema,
  autonomyLevelToScopePatch,
  deriveAutonomyPolicy,
  deriveQuietGovernanceSummary,
  quietAutonomyModeSchema,
  quietModeToScopePatch,
  type AutonomyLevel,
  type AutonomyPolicySummary,
  type QuietAutonomyMode,
  type QuietGovernanceSummary,
} from "./scope.ts";

export const DEFAULT_WORKSPACE_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;

export const approveThreadBindingInputSchema = z.object({
  decision: agentApprovalDecisionSchema,
  note: z.string().trim().max(1000).optional(),
  alwaysAllow: z.boolean().optional(),
});
export type ApproveThreadBindingInput = z.infer<typeof approveThreadBindingInputSchema>;

export const steerThreadBindingInputSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  mode: agentSteeringModeSchema.default("queued"),
});
export type SteerThreadBindingInput = z.infer<typeof steerThreadBindingInputSchema>;
export type SteerThreadBindingRequestInput = z.input<typeof steerThreadBindingInputSchema>;

export const awaySummaryQuerySchema = z.object({
  since: isoTimestampSchema.optional(),
});
export type AwaySummaryQuery = z.infer<typeof awaySummaryQuerySchema>;

export const THREAD_CONFLICT_SCOPES = ["node", "selection", "document"] as const;
export type ThreadConflictScope = (typeof THREAD_CONFLICT_SCOPES)[number];

export interface ThreadConflictItem {
  readonly documentId: DocumentId;
  readonly scope: ThreadConflictScope;
  readonly nodeId: OutlineNodeId | null;
  readonly bindingIds: readonly ThreadBindingId[];
  readonly bindings: readonly AdeThreadBinding[];
  readonly reason: string;
}

export const AWAY_SUMMARY_CATEGORIES = [
  "needs_decision",
  "failed",
  "completed",
  "unread_document",
] as const;
export type AwaySummaryCategory = (typeof AWAY_SUMMARY_CATEGORIES)[number];

export interface AwaySummaryItem {
  readonly id: string;
  readonly category: AwaySummaryCategory;
  readonly documentId: DocumentId;
  readonly documentTitle: string;
  readonly documentKind: DocumentKind;
  readonly spaceId: SpaceId;
  readonly bindingId?: ThreadBindingId | null | undefined;
  readonly title: string;
  readonly summary: string | null;
  readonly status?: AdeThreadStatus | undefined;
  readonly updatedAt: string;
}

export interface AwaySummaryResponse {
  readonly since: string;
  readonly generatedAt: string;
  readonly elapsedMs: number;
  readonly totalCount: number;
  readonly counts: {
    readonly needsDecision: number;
    readonly failed: number;
    readonly completed: number;
    readonly unreadDocuments: number;
  };
  readonly items: readonly AwaySummaryItem[];
}

export const STORAGE_BUCKET_KEYS = [
  "articles",
  "outlines",
  "clips",
  "embeddings",
  "attachments",
] as const;
export type StorageBucketKey = (typeof STORAGE_BUCKET_KEYS)[number];

export interface StorageBucketStats {
  readonly key: StorageBucketKey;
  readonly count: number;
  readonly bytes: number;
}

export interface StorageBucketsResponse {
  readonly articleCount: number;
  readonly outlineCount: number;
  readonly clipCount: number;
  readonly totalDocumentCount: number;
  readonly trashedDocumentCount: number;
  readonly indexedCount: number;
  readonly attachmentCount: number;
  readonly attachmentBytes: number;
  readonly contentBytes: number;
  readonly totalUsedBytes: number;
  readonly quotaLimitBytes: number;
  readonly usedRatio: number;
  readonly remainingPercent: number;
  readonly buckets: readonly StorageBucketStats[];
}

export interface LedgerCascadePreview {
  readonly targetId: AuditLogId;
  readonly documentId: DocumentId | null;
  readonly targetFound: boolean;
  readonly reversible: boolean;
  readonly affectedAuditIds: readonly AuditLogId[];
  readonly affectedEntries: readonly AuditLogRecord[];
  readonly totalAffectedCount: number;
}

export interface AuditRollbackResult {
  readonly restoredRevisionId: RevisionId;
  readonly rollbackAuditLog: AuditLogRecord;
  readonly affectedAuditIds: readonly AuditLogId[];
  readonly document: DocumentRecord;
  readonly nodes?: readonly OutlineNode[] | undefined;
}

export const batchRollbackInputSchema = z.object({
  force: z.boolean().optional(),
});
export type BatchRollbackInput = z.infer<typeof batchRollbackInputSchema>;

export interface BatchRollbackConflict {
  readonly documentId: DocumentId;
  readonly documentTitle: string;
  readonly conflictReason: string;
  readonly conflictingAuditIds: readonly AuditLogId[];
  readonly latestHumanEditAt: string | null;
}

export interface BatchRollbackItemResult {
  readonly auditLogId: AuditLogId;
  readonly documentId: DocumentId;
  readonly restoredRevisionId: RevisionId;
  readonly rollbackAuditLog: AuditLogRecord;
  readonly document: DocumentRecord;
  readonly nodes?: readonly OutlineNode[] | undefined;
}

export interface BatchRollbackResult {
  readonly batchId: AuditBatchId;
  readonly rolledBackCount: number;
  readonly skippedAlreadyReversedCount: number;
  readonly conflicts: readonly BatchRollbackConflict[];
  readonly items: readonly BatchRollbackItemResult[];
  readonly deletedDocumentIds?: readonly DocumentId[] | undefined;
  readonly deletedSpaceIds?: readonly SpaceId[] | undefined;
  readonly restoredSchemaSpaceIds?: readonly SpaceId[] | undefined;
}

export interface AuditBatchDigestSummary {
  readonly batchId: AuditBatchId;
  readonly executionMode: ExecutionMode;
  readonly tokenId: ApiTokenId | null;
  readonly tokenName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly documentIds: readonly DocumentId[];
  readonly mutationCount: number;
  readonly reversible: boolean;
  readonly reversed: boolean;
  readonly summary: string;
}

export interface RenderOutlineMarkdownOptions {
  readonly rootParentId?: OutlineNodeId | null | undefined;
  readonly notePrefix?: string | undefined;
}

/**
 * Renders active outline nodes deterministically into indented Markdown bullets.
 */
export function renderOutlineNodesToMarkdown(
  nodes: readonly OutlineNode[],
  options?: RenderOutlineMarkdownOptions,
): string {
  const activeNodes = nodes.filter((node) => node.deletedAt === null);
  if (activeNodes.length === 0) return "";

  const childrenMap = new Map<OutlineNodeId | null, OutlineNode[]>();
  for (const node of activeNodes) {
    const key = node.parentNodeId;
    const list = childrenMap.get(key);
    if (list) list.push(node);
    else childrenMap.set(key, [node]);
  }

  for (const list of childrenMap.values()) {
    list.sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : a.id.localeCompare(b.id)));
  }

  const lines: string[] = [];
  const visited = new Set<OutlineNodeId>();
  const notePrefix = options?.notePrefix ?? "> ";

  const walk = (parentId: OutlineNodeId | null, depth: number) => {
    const children = childrenMap.get(parentId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const indent = "  ".repeat(depth);
      const bullet = child.checked === null ? "-" : child.checked ? "- [x]" : "- [ ]";
      const body = child.contentMarkdown.trimEnd();
      lines.push(`${indent}${bullet} ${body}`);
      if (child.noteMarkdown && child.noteMarkdown.trim().length > 0) {
        const noteIndent = "  ".repeat(depth + 1);
        for (const noteLine of child.noteMarkdown.trimEnd().split(/\r?\n/)) {
          lines.push(`${noteIndent}${notePrefix}${noteLine}`);
        }
      }
      walk(child.id, depth + 1);
    }
  };

  walk(options?.rootParentId ?? null, 0);
  return lines.join("\n");
}

function selectionsOverlap(a: SelectionAnchor, b: SelectionAnchor): boolean {
  if (
    a.startOffset !== undefined &&
    a.endOffset !== undefined &&
    b.startOffset !== undefined &&
    b.endOffset !== undefined
  ) {
    if (a.startOffset === a.endOffset && b.startOffset === b.endOffset) {
      return a.startOffset === b.startOffset;
    }
    return Math.max(a.startOffset, b.startOffset) < Math.min(a.endOffset, b.endOffset);
  }

  if (a.headingSlug && b.headingSlug && a.headingSlug === b.headingSlug) {
    return true;
  }

  const qa = a.quote.trim().toLowerCase();
  const qb = b.quote.trim().toLowerCase();
  if (!qa || !qb) return false;
  return qa === qb || qa.includes(qb) || qb.includes(qa);
}

/**
 * Detects concurrent active (`running` or `waiting_input`) thread bindings targeting the same document,
 * classifying node-level and selection-level overlaps ahead of document-level concurrency.
 */
export function detectBindingConflicts(
  bindings: readonly AdeThreadBinding[],
): ThreadConflictItem[] {
  const byDoc = new Map<DocumentId, AdeThreadBinding[]>();

  for (const binding of bindings) {
    if (binding.status !== "running" && binding.status !== "waiting_input") continue;
    const list = byDoc.get(binding.documentId);
    if (list) list.push(binding);
    else byDoc.set(binding.documentId, [binding]);
  }

  const conflicts: ThreadConflictItem[] = [];

  for (const [documentId, docBindings] of byDoc.entries()) {
    if (docBindings.length < 2) continue;

    const sortedBindings = [...docBindings].sort((a, b) => {
      const timeCmp = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      if (Number.isFinite(timeCmp) && timeCmp !== 0) return timeCmp;
      return a.id.localeCompare(b.id);
    });

    const nodeCounts = new Map<OutlineNodeId, number>();
    for (const b of sortedBindings) {
      if (b.nodeId) {
        nodeCounts.set(b.nodeId, (nodeCounts.get(b.nodeId) ?? 0) + 1);
      }
    }
    const collidingNodeIds = [...nodeCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([nodeId]) => nodeId)
      .sort();

    let hasSelectionOverlap = false;
    if (collidingNodeIds.length === 0) {
      for (let i = 0; i < sortedBindings.length; i++) {
        const left = sortedBindings[i];
        if (!left?.selectionAnchor) continue;
        for (let j = i + 1; j < sortedBindings.length; j++) {
          const right = sortedBindings[j];
          if (!right?.selectionAnchor) continue;
          if (selectionsOverlap(left.selectionAnchor, right.selectionAnchor)) {
            hasSelectionOverlap = true;
            break;
          }
        }
        if (hasSelectionOverlap) break;
      }
    }

    const scope: ThreadConflictScope =
      collidingNodeIds.length > 0
        ? "node"
        : hasSelectionOverlap
          ? "selection"
          : "document";
    const nodeId = collidingNodeIds[0] ?? null;
    const bindingIds = sortedBindings.map((b) => b.id);

    const reason =
      scope === "node"
        ? `${bindingIds.length} active threads target outline node "${nodeId}"`
        : scope === "selection"
          ? `${bindingIds.length} active threads overlap on a text selection in document "${documentId}"`
          : `${bindingIds.length} active threads are concurrently editing document "${documentId}"`;

    conflicts.push({
      documentId,
      scope,
      nodeId,
      bindingIds,
      bindings: sortedBindings,
      reason,
    });
  }

  conflicts.sort((a, b) => a.documentId.localeCompare(b.documentId));
  return conflicts;
}

const READ_ONLY_MCP_ACTIONS = new Set([
  "whoami_scope",
  "list_spaces",
  "search_documents",
  "list_documents",
  "get_document",
  "list_revisions",
  "get_revision_diff",
  "get_daily_outline",
  "list_bound_threads",
  "create_upload_url",
  "list_tasks",
  "list_highlights",
  "list_templates",
  "get_audit_logs",
  "semantic_search",
  "document.export.markdown",
  "workspace.export.zip",
  "thread.binding.approve",
  "thread.binding.steer",
]);

function isDocumentMutationAuditEntry(entry: AuditLogRecord): boolean {
  if (entry.decision !== "allowed") return false;
  const action = entry.action.trim();
  if (!action) return false;
  const upper = action.toUpperCase();
  if (upper.startsWith("GET ") || upper.startsWith("HEAD ") || upper.startsWith("OPTIONS ")) {
    return false;
  }
  if (READ_ONLY_MCP_ACTIONS.has(action)) {
    return false;
  }
  if (
    entry.beforeRevisionId != null ||
    entry.afterRevisionId != null ||
    entry.reversible === true ||
    entry.action === "audit.rollback"
  ) {
    return true;
  }
  return (
    upper.startsWith("POST ") ||
    upper.startsWith("PATCH ") ||
    upper.startsWith("PUT ") ||
    upper.startsWith("DELETE ") ||
    !action.startsWith("get_")
  );
}

function extractRollbackTargetId(entry: AuditLogRecord): AuditLogId | null {
  if (entry.resource.startsWith("audit:")) {
    const id = entry.resource.slice("audit:".length).trim();
    return id.length > 0 ? asAuditLogId(id) : null;
  }
  const match = /\/audit-logs\/([^/]+)\/rollback(?:\?.*)?$/.exec(entry.resource);
  if (match?.[1]) {
    return asAuditLogId(match[1]);
  }
  return null;
}

function sortDocumentEntriesChronologically(entries: readonly AuditLogRecord[]): AuditLogRecord[] {
  if (entries.length <= 1) return [...entries];

  const firstTs = Date.parse(entries[0]!.createdAt);
  const lastTs = Date.parse(entries[entries.length - 1]!.createdAt);
  const inputLooksDescending = Number.isFinite(firstTs) && Number.isFinite(lastTs) && firstTs > lastTs;

  // Build revision link precedence (afterRevisionId -> beforeRevisionId) to break same-ms ties cleanly.
  const indexById = new Map<string, number>();
  entries.forEach((entry, idx) => indexById.set(entry.id, idx));

  const sorted = [...entries].sort((a, b) => {
    if (a.afterRevisionId && b.beforeRevisionId && a.afterRevisionId === b.beforeRevisionId) {
      return -1;
    }
    if (b.afterRevisionId && a.beforeRevisionId && b.afterRevisionId === a.beforeRevisionId) {
      return 1;
    }
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
      return ta - tb;
    }
    const ia = indexById.get(a.id) ?? 0;
    const ib = indexById.get(b.id) ?? 0;
    return inputLooksDescending ? ib - ia : ia - ib;
  });

  return sorted;
}

/**
 * Computes downstream mutation entries on the same document that follow `targetId`
 * and may require human review when rolling back `targetId`.
 */
export function computeLedgerCascade(
  entries: readonly AuditLogRecord[],
  targetId: AuditLogId,
): LedgerCascadePreview {
  const target = entries.find((e) => e.id === targetId);
  if (!target) {
    return {
      targetId,
      documentId: null,
      targetFound: false,
      reversible: false,
      affectedAuditIds: [],
      affectedEntries: [],
      totalAffectedCount: 0,
    };
  }

  const reversible = Boolean(target.reversible && target.beforeRevisionId);
  if (!target.documentId) {
    return {
      targetId,
      documentId: null,
      targetFound: true,
      reversible,
      affectedAuditIds: [],
      affectedEntries: [],
      totalAffectedCount: 0,
    };
  }

  const sameDocEntries = sortDocumentEntriesChronologically(
    entries.filter((e) => e.documentId === target.documentId),
  );
  const targetIdx = sameDocEntries.findIndex((e) => e.id === targetId);
  if (targetIdx < 0) {
    return {
      targetId,
      documentId: target.documentId,
      targetFound: true,
      reversible,
      affectedAuditIds: [],
      affectedEntries: [],
      totalAffectedCount: 0,
    };
  }

  const laterEntries = sameDocEntries.slice(targetIdx + 1);
  const rolledBackIds = new Set<AuditLogId>();
  const cancelledRollbackIds = new Set<AuditLogId>();

  for (let i = 0; i < laterEntries.length; i++) {
    const entry = laterEntries[i]!;
    if (entry.decision !== "allowed") continue;
    const rolledTargetId = extractRollbackTargetId(entry);
    if (!rolledTargetId) continue;

    if (rolledTargetId === targetId) {
      // Target itself was rolled back at `entry`; earlier post-target edits before `entry` were already reverted.
      for (let j = 0; j <= i; j++) {
        rolledBackIds.add(laterEntries[j]!.id);
      }
      cancelledRollbackIds.add(entry.id);
      continue;
    }

    const rolledIdx = laterEntries.findIndex((candidate) => candidate.id === rolledTargetId);
    if (rolledIdx >= 0 && rolledIdx < i) {
      for (let j = rolledIdx; j < i; j++) {
        rolledBackIds.add(laterEntries[j]!.id);
      }
      cancelledRollbackIds.add(entry.id);
    }
  }

  const affectedEntries = laterEntries.filter((entry) => {
    if (
      rolledBackIds.has(entry.id) ||
      cancelledRollbackIds.has(entry.id) ||
      entry.reversedByAuditId != null
    ) {
      return false;
    }
    return isDocumentMutationAuditEntry(entry);
  });

  return {
    targetId,
    documentId: target.documentId,
    targetFound: true,
    reversible,
    affectedAuditIds: affectedEntries.map((e) => e.id),
    affectedEntries,
    totalAffectedCount: affectedEntries.length,
  };
}
