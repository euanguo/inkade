import { detectBindingConflicts, type ThreadConflictItem } from "./agent-control.ts";
import { asSpaceId, type AuditBatchId, type SpaceId, type ThreadBindingId } from "./ids.ts";
import {
  isSystemInternalDocument,
  type AdeThreadBinding,
  type AgentBriefingRunRecord,
  type DocumentSummary,
} from "./types/index.ts";

export const INBOX_ARCHIVED_PROP = "inboxArchived";
export const INBOX_SNOOZED_UNTIL_PROP = "inboxSnoozedUntil";
export const INBOX_MARKED_UNREAD_PROP = "inboxMarkedUnread";

export const UNIFIED_INBOX_BUCKETS = ["exceptions", "digest", "clips", "snoozed"] as const;
export type UnifiedInboxBucket = (typeof UNIFIED_INBOX_BUCKETS)[number];
export type UnifiedInboxActiveBucket = Exclude<UnifiedInboxBucket, "snoozed">;

export type UnifiedInboxKind =
  | "blocking_question"
  | "conflict"
  | "failed"
  | "briefing_failed"
  | "digest"
  | "clip";

export interface UnifiedInboxCounts {
  readonly all: number;
  readonly exceptions: number;
  readonly digest: number;
  readonly clips: number;
  readonly snoozed: number;
}

export interface InboxBatchDigestMetadata {
  readonly batchId: AuditBatchId;
  readonly summary?: string | null | undefined;
  readonly createdAt: string;
}

interface UnifiedInboxEntryBase {
  readonly id: string;
  readonly kind: UnifiedInboxKind;
  readonly bucket: UnifiedInboxActiveBucket;
  readonly priority: 0 | 1 | 2 | 3 | 4;
  readonly sortAt: string;
  readonly title: string;
  readonly subtitle: string;
  readonly unread: boolean;
  readonly snoozedUntil: string | null;
}

export type UnifiedInboxEntry =
  | (UnifiedInboxEntryBase & {
      readonly kind: "blocking_question";
      readonly bucket: "exceptions";
      readonly priority: 0;
      readonly binding: AdeThreadBinding;
    })
  | (UnifiedInboxEntryBase & {
      readonly kind: "conflict";
      readonly bucket: "exceptions";
      readonly priority: 1;
      readonly conflict: ThreadConflictItem;
    })
  | (UnifiedInboxEntryBase & {
      readonly kind: "failed";
      readonly bucket: "exceptions";
      readonly priority: 2;
      readonly binding: AdeThreadBinding;
    })
  | (UnifiedInboxEntryBase & {
      readonly kind: "briefing_failed";
      readonly bucket: "exceptions";
      readonly priority: 2;
      readonly briefingRun: AgentBriefingRunRecord;
    })
  | (UnifiedInboxEntryBase & {
      readonly kind: "digest";
      readonly bucket: "digest";
      readonly priority: 3;
      readonly doc: DocumentSummary;
      readonly batchId?: AuditBatchId | null | undefined;
      readonly batchSummary?: string | null | undefined;
    })
  | (UnifiedInboxEntryBase & {
      readonly kind: "clip";
      readonly bucket: "clips";
      readonly priority: 4;
      readonly doc: DocumentSummary;
    });

export interface BuildUnifiedInboxOptions {
  readonly docs: readonly DocumentSummary[];
  readonly bindings: readonly AdeThreadBinding[];
  readonly briefingRuns?: readonly AgentBriefingRunRecord[] | undefined;
  readonly inboxSpaceId?: SpaceId | undefined;
  readonly nowMs?: number | undefined;
  readonly recentApprovalIds?: ReadonlySet<ThreadBindingId | string> | undefined;
  readonly bindingSnoozeMap?: Readonly<Record<string, string>> | undefined;
  readonly bindingUnreadMap?: Readonly<Record<string, boolean>> | undefined;
  readonly docLatestBatchMap?: Readonly<Record<string, InboxBatchDigestMetadata>> | undefined;
}

export interface UnifiedInboxResult {
  readonly active: readonly UnifiedInboxEntry[];
  readonly snoozed: readonly UnifiedInboxEntry[];
  readonly counts: UnifiedInboxCounts;
}

export function getUnifiedInboxBucket(kind: UnifiedInboxKind): UnifiedInboxActiveBucket {
  switch (kind) {
    case "blocking_question":
    case "conflict":
    case "failed":
    case "briefing_failed":
      return "exceptions";
    case "digest":
      return "digest";
    case "clip":
      return "clips";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function readPropsRecord(doc: Pick<DocumentSummary, "properties">): Record<string, unknown> | null {
  if (!doc.properties || typeof doc.properties !== "object" || Array.isArray(doc.properties)) {
    return null;
  }
  return doc.properties;
}

/** Returns true when a document was explicitly triaged/archived out of Inbox. */
export function isInboxArchivedDoc(doc: Pick<DocumentSummary, "properties">): boolean {
  const props = readPropsRecord(doc);
  return props?.[INBOX_ARCHIVED_PROP] === true;
}

/** Reads the ISO snooze deadline stored on a document's properties, if valid. */
export function getDocInboxSnoozedUntil(doc: Pick<DocumentSummary, "properties">): string | null {
  const props = readPropsRecord(doc);
  const raw = props?.[INBOX_SNOOZED_UNTIL_PROP];
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

/** Returns true when a document in Inbox has been manually flagged unread. */
export function isDocInboxUnread(doc: Pick<DocumentSummary, "properties">): boolean {
  const props = readPropsRecord(doc);
  return props?.[INBOX_MARKED_UNREAD_PROP] === true;
}

/** Checks whether an ISO timestamp snooze deadline is still in the future relative to `nowMs`. */
export function isSnoozeActive(
  snoozedUntil: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (typeof snoozedUntil !== "string" || !snoozedUntil.trim()) return false;
  const targetMs = Date.parse(snoozedUntil);
  return !Number.isNaN(targetMs) && targetMs > nowMs;
}

/** Returns a shallow clone of `properties` with Inbox snooze updated or cleared. */
export function withDocInboxSnooze(
  properties: Record<string, unknown> | null | undefined,
  snoozedUntil: string | null,
): Record<string, unknown> | null {
  const next: Record<string, unknown> =
    properties && typeof properties === "object" && !Array.isArray(properties)
      ? { ...properties }
      : {};
  if (snoozedUntil) {
    next[INBOX_SNOOZED_UNTIL_PROP] = snoozedUntil;
  } else {
    delete next[INBOX_SNOOZED_UNTIL_PROP];
  }
  return Object.keys(next).length > 0 ? next : null;
}

/** Returns a shallow clone of `properties` with Inbox manual unread flag updated. */
export function withDocInboxUnread(
  properties: Record<string, unknown> | null | undefined,
  unread: boolean,
): Record<string, unknown> | null {
  const next: Record<string, unknown> =
    properties && typeof properties === "object" && !Array.isArray(properties)
      ? { ...properties }
      : {};
  if (unread) {
    next[INBOX_MARKED_UNREAD_PROP] = true;
  } else {
    delete next[INBOX_MARKED_UNREAD_PROP];
  }
  return Object.keys(next).length > 0 ? next : null;
}

function resolveNonDocSnooze(
  entryId: string,
  bindingId: string | null,
  map: Readonly<Record<string, string>> | undefined,
  nowMs: number,
): string | null {
  if (!map) return null;
  const candidate = map[entryId] ?? (bindingId ? map[bindingId] : undefined) ?? null;
  return isSnoozeActive(candidate, nowMs) ? candidate : null;
}

function resolveUnreadOverride(
  entryId: string,
  bindingId: string | null,
  map: Readonly<Record<string, boolean>> | undefined,
  fallback: boolean,
): boolean {
  if (!map) return fallback;
  if (entryId in map) return Boolean(map[entryId]);
  if (bindingId && bindingId in map) return Boolean(map[bindingId]);
  return fallback;
}

function sortInboxEntries(items: UnifiedInboxEntry[]): UnifiedInboxEntry[] {
  return items.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.sortAt.localeCompare(a.sortAt);
  });
}

/**
 * Single source of truth for computing Quiet Autonomy Inbox 4-bucket queues and counts:
 * - `exceptions`: blocking questions (`request_human_decision`), conflicts, failed runs
 * - `digest`: passive background agent updates ready for calm inspection or 1-click batch undo
 * - `clips`: captures / drafts awaiting organization (never includes system backing docs)
 * - `snoozed`: deferred entries
 */
export function buildUnifiedInboxEntries(options: BuildUnifiedInboxOptions): UnifiedInboxResult {
  const {
    docs,
    bindings,
    briefingRuns = [],
    inboxSpaceId = asSpaceId("spc_inbox"),
    nowMs = Date.now(),
    recentApprovalIds,
    bindingSnoozeMap,
    bindingUnreadMap,
    docLatestBatchMap,
  } = options;

  const visibleDocs = docs.filter((d) => !isSystemInternalDocument(d));
  const docsById = new Map(visibleDocs.map((d) => [d.id, d]));
  const active: UnifiedInboxEntry[] = [];
  const snoozed: UnifiedInboxEntry[] = [];

  const pushEntry = (entry: UnifiedInboxEntry): void => {
    if (isSnoozeActive(entry.snoozedUntil, nowMs)) {
      snoozed.push(entry);
    } else {
      active.push(entry);
    }
  };

  // 1) Exceptions: Blocking human decisions from agents (or legacy pending approvals)
  for (const binding of bindings) {
    if (
      binding.pendingApproval &&
      ((binding.status === "waiting_input" && !binding.pendingApproval.decision) ||
        Boolean(recentApprovalIds?.has(binding.id)))
    ) {
      const targetDoc = docsById.get(binding.documentId);
      const id = `apr:${binding.id}`;
      const questionTitle =
        binding.pendingApproval.question || binding.pendingApproval.action || binding.title;
      const questionSubtitle =
        binding.pendingApproval.context ||
        targetDoc?.title ||
        binding.title ||
        binding.externalThreadId;
      pushEntry({
        id,
        kind: "blocking_question",
        bucket: "exceptions",
        priority: 0,
        sortAt: binding.lastSyncedAt || binding.createdAt,
        title: questionTitle,
        subtitle: questionSubtitle,
        unread: resolveUnreadOverride(id, binding.id, bindingUnreadMap, true),
        snoozedUntil: resolveNonDocSnooze(id, binding.id, bindingSnoozeMap, nowMs),
        binding,
      });
    }
  }

  // 2) Exceptions: Concurrent Editing Conflicts
  const conflicts = detectBindingConflicts(bindings);
  for (const conflict of conflicts) {
    const targetDoc = docsById.get(conflict.documentId);
    const latestAt = conflict.bindings.reduce(
      (max, b) => (b.lastSyncedAt > max ? b.lastSyncedAt : max),
      "",
    );
    const id = `cfl:${conflict.documentId}:${conflict.nodeId ?? conflict.scope}`;
    pushEntry({
      id,
      kind: "conflict",
      bucket: "exceptions",
      priority: 1,
      sortAt: latestAt || new Date(0).toISOString(),
      title: targetDoc?.title || conflict.documentId,
      subtitle: conflict.reason,
      unread: resolveUnreadOverride(id, null, bindingUnreadMap, true),
      snoozedUntil: resolveNonDocSnooze(id, null, bindingSnoozeMap, nowMs),
      conflict,
    });
  }

  // 3) Exceptions: Failed Thread Bindings
  for (const binding of bindings) {
    if (binding.status === "failed") {
      const targetDoc = docsById.get(binding.documentId);
      const id = `fail:${binding.id}`;
      pushEntry({
        id,
        kind: "failed",
        bucket: "exceptions",
        priority: 2,
        sortAt: binding.lastSyncedAt || binding.createdAt,
        title: binding.title || targetDoc?.title || binding.externalThreadId,
        subtitle: binding.lastSummary || targetDoc?.title || binding.adeKind,
        unread: resolveUnreadOverride(id, binding.id, bindingUnreadMap, true),
        snoozedUntil: resolveNonDocSnooze(id, binding.id, bindingSnoozeMap, nowMs),
        binding,
      });
    }
  }

  // 3b) Exceptions: Failed Scheduled Agent Briefing Runs (undismissed)
  const succeededBriefingBatchByDoc = new Map<string, InboxBatchDigestMetadata>();
  for (const run of briefingRuns) {
    if (run.status === "failed" && run.dismissedAt === null) {
      const id = `brf:${run.id}`;
      pushEntry({
        id,
        kind: "briefing_failed",
        bucket: "exceptions",
        priority: 2,
        sortAt: run.finishedAt || run.startedAt,
        title: run.jobName,
        subtitle: run.errorMessage || "Briefing run failed",
        unread: resolveUnreadOverride(id, run.id, bindingUnreadMap, true),
        snoozedUntil: resolveNonDocSnooze(id, run.id, bindingSnoozeMap, nowMs),
        briefingRun: run,
      });
    } else if (run.status === "succeeded" && run.documentId && run.batchId) {
      const createdAt = run.finishedAt || run.startedAt;
      const existing = succeededBriefingBatchByDoc.get(run.documentId);
      if (!existing || createdAt > existing.createdAt) {
        succeededBriefingBatchByDoc.set(run.documentId, {
          batchId: run.batchId,
          summary: run.summary ?? run.jobName,
          createdAt,
        });
      }
    }
  }

  // 4) Digest: Quiet background agent updates
  const digestDocIds = new Set<string>();
  for (const doc of visibleDocs) {
    if (doc.trashedAt === null && doc.unreadAgentUpdate) {
      digestDocIds.add(doc.id);
      const rawSnooze = getDocInboxSnoozedUntil(doc);
      const auditMeta = docLatestBatchMap?.[doc.id];
      const briefingMeta = succeededBriefingBatchByDoc.get(doc.id);
      const batchMeta =
        auditMeta && briefingMeta
          ? briefingMeta.createdAt >= auditMeta.createdAt
            ? briefingMeta
            : auditMeta
          : (auditMeta ?? briefingMeta);
      pushEntry({
        id: `rev:${doc.id}`,
        kind: "digest",
        bucket: "digest",
        priority: 3,
        sortAt: doc.updatedAt,
        title: doc.title,
        subtitle: batchMeta?.summary || doc.excerpt,
        unread: true,
        snoozedUntil: isSnoozeActive(rawSnooze, nowMs) ? rawSnooze : null,
        doc,
        batchId: batchMeta?.batchId ?? null,
        batchSummary: batchMeta?.summary ?? null,
      });
    }
  }

  // 5) Captures: Unarchived Inbox Documents & Web Clips (deduplicated against digest, system docs excluded)
  for (const doc of visibleDocs) {
    if (
      doc.trashedAt === null &&
      !isInboxArchivedDoc(doc) &&
      !digestDocIds.has(doc.id) &&
      (doc.spaceId === inboxSpaceId || doc.kind === "clip")
    ) {
      const rawSnooze = getDocInboxSnoozedUntil(doc);
      pushEntry({
        id: `clip:${doc.id}`,
        kind: "clip",
        bucket: "clips",
        priority: 4,
        sortAt: doc.updatedAt,
        title: doc.title,
        subtitle: doc.excerpt,
        unread: isDocInboxUnread(doc),
        snoozedUntil: isSnoozeActive(rawSnooze, nowMs) ? rawSnooze : null,
        doc,
      });
    }
  }

  sortInboxEntries(active);
  sortInboxEntries(snoozed);

  let exceptions = 0;
  let digest = 0;
  let clips = 0;
  for (const item of active) {
    if (item.bucket === "exceptions") exceptions += 1;
    else if (item.bucket === "digest") digest += 1;
    else clips += 1;
  }

  return {
    active,
    snoozed,
    counts: {
      all: active.length,
      exceptions,
      digest,
      clips,
      snoozed: snoozed.length,
    },
  };
}

/**
 * Computes total active Inbox items across Exceptions, Digest, and Captures.
 */
export function countUnifiedInboxActive(options: BuildUnifiedInboxOptions): number {
  return buildUnifiedInboxEntries(options).active.length;
}

/**
 * Computes the Quiet Autonomy unread alert badge count for sidebar and mobile chrome.
 * Only true `exceptions` (blocking questions, conflicts, failed runs) surface red badges.
 */
export function countUnifiedInboxBadge(options: BuildUnifiedInboxOptions): number {
  return buildUnifiedInboxEntries(options).counts.exceptions;
}
