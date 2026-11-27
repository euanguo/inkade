import { describe, expect, test } from "bun:test";
import {
  asApprovalId,
  asAuditBatchId,
  asBriefingJobId,
  asBriefingRunId,
  asDocumentId,
  asSpaceId,
  asThreadBindingId,
  asWorkspaceId,
} from "./ids.ts";
import {
  buildUnifiedInboxEntries,
  countUnifiedInboxActive,
  countUnifiedInboxBadge,
  isDocInboxUnread,
  isInboxArchivedDoc,
  withDocInboxSnooze,
  withDocInboxUnread,
} from "./inbox.ts";
import {
  isSystemInternalDocument,
  type AdeThreadBinding,
  type AgentBriefingRunRecord,
  type DocumentRecord,
} from "./types/index.ts";

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: asDocumentId("doc_1"),
    workspaceId: asWorkspaceId("ws_1"),
    spaceId: asSpaceId("spc_inbox"),
    kind: "clip",
    title: "Test Clip",
    slug: "test-clip",
    dailyDate: null,
    contentMarkdown: "Body",
    contentJson: null,
    contentText: "Body",
    excerpt: "Body",
    tags: [],
    sourceUrl: undefined,
    sourceMeta: null,
    properties: null,
    version: 1,
    pinned: false,
    unreadAgentUpdate: false,
    lastEditedByType: "human",
    trashedAt: null,
    createdAt: "2026-11-24T08:00:00.000Z",
    updatedAt: "2026-11-24T09:00:00.000Z",
    ...overrides,
  };
}

function makeBinding(overrides: Partial<AdeThreadBinding> = {}): AdeThreadBinding {
  return {
    id: asThreadBindingId("bnd_1"),
    workspaceId: asWorkspaceId("ws_1"),
    documentId: asDocumentId("doc_1"),
    nodeId: null,
    selectionAnchor: null,
    adeKind: "bb",
    externalWorkspaceId: null,
    externalThreadId: "thr_1",
    deepLink: null,
    title: "Thread 1",
    status: "queued",
    lastSummary: null,
    unreadResult: false,
    lastSyncedAt: "2026-11-24T10:00:00.000Z",
    createdAt: "2026-11-24T08:00:00.000Z",
    ...overrides,
  };
}

describe("inbox core unification", () => {
  test("aggregates 4 quiet buckets, keeps badge strictly to exceptions, and filters system docs", () => {
    const nowMs = Date.parse("2026-11-24T12:00:00.000Z");
    const docs: DocumentRecord[] = [
      makeDoc({ id: asDocumentId("doc_clip_active"), kind: "clip", title: "Clip Active" }),
      makeDoc({
        id: asDocumentId("doc_system_tasks_inbox"),
        spaceId: asSpaceId("spc_inbox"),
        kind: "outline",
        title: "Tasks Inbox",
        slug: "tasks-inbox",
        properties: { systemRole: "tasks_inbox" },
        unreadAgentUpdate: true,
      }),
      makeDoc({
        id: asDocumentId("doc_clip_archived"),
        kind: "clip",
        properties: { inboxArchived: true },
        title: "Clip Archived",
      }),
      makeDoc({
        id: asDocumentId("doc_clip_snoozed"),
        kind: "clip",
        properties: { inboxSnoozedUntil: "2026-11-24T18:00:00.000Z" },
        title: "Clip Snoozed",
      }),
      makeDoc({
        id: asDocumentId("doc_clip_expired_snooze"),
        kind: "clip",
        properties: { inboxSnoozedUntil: "2026-11-24T10:00:00.000Z", inboxMarkedUnread: true },
        title: "Clip Expired Snooze",
      }),
      makeDoc({
        id: asDocumentId("doc_review"),
        spaceId: asSpaceId("spc_research"),
        kind: "article",
        unreadAgentUpdate: true,
        title: "Agent Digest Doc",
      }),
    ];

    expect(isSystemInternalDocument(docs[1]!)).toBe(true);
    expect(isSystemInternalDocument(docs[0]!)).toBe(false);

    const bindings: AdeThreadBinding[] = [
      makeBinding({
        id: asThreadBindingId("bnd_question"),
        documentId: asDocumentId("doc_review"),
        status: "waiting_input",
        pendingApproval: {
          id: asApprovalId("apr_1"),
          action: "Choose archive destination",
          risk: "medium",
          requestKind: "blocking_question",
          question: "Move deprecated notes to Archive or keep inline?",
          options: ["Archive", "Keep inline"],
        },
      }),
      makeBinding({
        id: asThreadBindingId("bnd_conflict_2"),
        documentId: asDocumentId("doc_review"),
        status: "running",
      }),
      makeBinding({
        id: asThreadBindingId("bnd_failed"),
        documentId: asDocumentId("doc_clip_active"),
        status: "failed",
        lastSummary: "Timeout",
      }),
    ];

    const batchId = asAuditBatchId("bat_digest_1");
    const result = buildUnifiedInboxEntries({
      docs,
      bindings,
      nowMs,
      docLatestBatchMap: {
        doc_review: { batchId, summary: "Updated synthesis section", createdAt: "2026-11-24T11:30:00.000Z" },
      },
    });

    expect(result.counts).toEqual({
      all: 6,
      exceptions: 3, // 1 blocking_question + 1 conflict + 1 failed
      digest: 1, // doc_review (system Tasks Inbox doc excluded)
      clips: 2, // doc_clip_active + doc_clip_expired_snooze (system Tasks Inbox doc excluded)
      snoozed: 1,
    });
    expect(result.active.map((i) => i.kind)).toEqual([
      "blocking_question",
      "conflict",
      "failed",
      "digest",
      "clip",
      "clip",
    ]);
    expect(result.active.some((i) => i.title === "Tasks Inbox")).toBe(false);
    expect(result.snoozed.map((i) => i.id)).toEqual(["clip:doc_clip_snoozed"]);
    expect(countUnifiedInboxActive({ docs, bindings, nowMs })).toBe(6);
    expect(countUnifiedInboxBadge({ docs, bindings, nowMs })).toBe(3);

    const digestEntry = result.active.find((i) => i.kind === "digest");
    expect(digestEntry?.kind === "digest" ? digestEntry.batchId : null).toBe(batchId);

    const expiredItem = result.active.find((i) => i.id === "clip:doc_clip_expired_snooze");
    expect(expiredItem?.unread).toBe(true);
    expect(expiredItem?.snoozedUntil).toBeNull();
  });

  test("handles property helpers without mutating existing properties", () => {
    const doc = makeDoc({ properties: { status: "open", inboxArchived: true } });
    expect(isInboxArchivedDoc(doc)).toBe(true);
    expect(isDocInboxUnread(doc)).toBe(false);

    const withSnooze = withDocInboxSnooze(doc.properties, "2026-11-25T09:00:00.000Z");
    expect(withSnooze).toEqual({
      status: "open",
      inboxArchived: true,
      inboxSnoozedUntil: "2026-11-25T09:00:00.000Z",
    });

    const clearedSnooze = withDocInboxSnooze(withSnooze, null);
    expect(clearedSnooze).toEqual({ status: "open", inboxArchived: true });

    const withUnread = withDocInboxUnread(null, true);
    expect(withUnread).toEqual({ inboxMarkedUnread: true });
    expect(withDocInboxUnread(withUnread, false)).toBeNull();
  });

  test("routes failed briefing runs to exceptions and succeeded briefing writes to digest with batch attribution", () => {
    const nowMs = Date.parse("2026-11-26T08:00:00.000Z");
    const dailyDoc = makeDoc({
      id: asDocumentId("doc_daily_1"),
      spaceId: asSpaceId("spc_daily"),
      kind: "outline",
      title: "Daily · 2026-11-26",
      dailyDate: "2026-11-26",
      unreadAgentUpdate: true,
      updatedAt: "2026-11-26T07:31:00.000Z",
    });
    const batchId = asAuditBatchId("bat_briefing_1");
    const runs: AgentBriefingRunRecord[] = [
      {
        id: asBriefingRunId("brr_fail_1"),
        jobId: asBriefingJobId("brj_1"),
        jobName: "Morning Clips & RSS",
        workspaceId: asWorkspaceId("ws_1"),
        triggerKind: "schedule",
        status: "failed",
        batchId: null,
        documentId: null,
        summary: null,
        citations: [],
        errorMessage: "Provider 503 Service Unavailable",
        dismissedAt: null,
        durationMs: 42,
        startedAt: "2026-11-26T07:30:00.000Z",
        finishedAt: "2026-11-26T07:30:01.000Z",
      },
      {
        id: asBriefingRunId("brr_fail_dismissed"),
        jobId: asBriefingJobId("brj_1"),
        jobName: "Dismissed Briefing Failure",
        workspaceId: asWorkspaceId("ws_1"),
        triggerKind: "manual",
        status: "failed",
        batchId: null,
        documentId: null,
        summary: null,
        citations: [],
        errorMessage: "Old timeout",
        dismissedAt: "2026-11-26T07:35:00.000Z",
        durationMs: 12,
        startedAt: "2026-11-26T07:20:00.000Z",
        finishedAt: "2026-11-26T07:20:01.000Z",
      },
      {
        id: asBriefingRunId("brr_ok_1"),
        jobId: asBriefingJobId("brj_2"),
        jobName: "Daily Digest Briefing",
        workspaceId: asWorkspaceId("ws_1"),
        triggerKind: "manual",
        status: "succeeded",
        batchId,
        documentId: dailyDoc.id,
        summary: "Synthesized 3 clips with [1][2] citations",
        citations: [],
        errorMessage: null,
        dismissedAt: null,
        durationMs: 120,
        startedAt: "2026-11-26T07:31:00.000Z",
        finishedAt: "2026-11-26T07:31:02.000Z",
      },
    ];

    const result = buildUnifiedInboxEntries({
      docs: [dailyDoc],
      bindings: [],
      briefingRuns: runs,
      nowMs,
    });

    expect(result.counts).toEqual({
      all: 2,
      exceptions: 1,
      digest: 1,
      clips: 0,
      snoozed: 0,
    });
    expect(result.active[0]?.kind).toBe("briefing_failed");
    expect(result.active[0]?.subtitle).toContain("Provider 503");
    const digest = result.active[1];
    expect(digest?.kind).toBe("digest");
    expect(digest?.kind === "digest" ? digest.batchId : null).toBe(batchId);
    expect(countUnifiedInboxBadge({ docs: [dailyDoc], bindings: [], briefingRuns: runs, nowMs })).toBe(1);
  });
});
