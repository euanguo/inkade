import { describe, expect, test } from "bun:test";
import {
  asApiTokenId,
  asAuditLogId,
  asBriefingJobId,
  asBriefingRunId,
  asDocumentId,
  asEventId,
  asHighlightId,
  asRevisionId,
  asSavedViewId,
  asShareLinkId,
  asSpaceId,
  asTemplateId,
  asThreadBindingId,
  asWorkspaceId,
  type AdeThreadBinding,
  type DocumentHighlight,
  type DocumentRecord,
  type DocumentTemplate,
  type InkadeEvent,
  type InkadeEventEnvelopeBase,
  type SavedView,
  type ShareLink,
} from "@inkade/core";
import type { QueryClient } from "@tanstack/react-query";
import React from "react";
import { createInkadeClient } from "../client.ts";
import { inkadeQueryKeys } from "../query-keys.ts";
import { InkadeSdkProvider } from "./provider.tsx";
import { inkadeQueries } from "./queries.ts";
import {
  applyInkadeEventToQueryCache,
  pruneStaleAgentTools,
  reduceActiveAgentTools,
} from "./realtime.ts";

function makeEventBase(
  overrides: Partial<InkadeEventEnvelopeBase> = {},
): InkadeEventEnvelopeBase {
  return {
    seq: 1,
    eventId: asEventId("evt_1"),
    workspaceId: asWorkspaceId("ws_default"),
    spaceId: asSpaceId("spc_1"),
    actorType: "agent",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeDoc(id: ReturnType<typeof asDocumentId>, kind: DocumentRecord["kind"] = "article"): DocumentRecord {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId: asWorkspaceId("ws_default"),
    spaceId: asSpaceId("spc_1"),
    kind,
    title: "Test Doc",
    slug: "test-doc",
    dailyDate: null,
    contentMarkdown: "",
    contentJson: null,
    contentText: "",
    excerpt: "",
    tags: [],
    version: 1,
    pinned: false,
    unreadAgentUpdate: false,
    lastEditedByType: "agent",
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeBinding(documentId: ReturnType<typeof asDocumentId>): AdeThreadBinding {
  const now = new Date().toISOString();
  return {
    id: asThreadBindingId("thr_1"),
    workspaceId: asWorkspaceId("ws_default"),
    documentId,
    nodeId: null,
    selectionAnchor: null,
    adeKind: "any",
    externalWorkspaceId: null,
    externalThreadId: "ext_1",
    deepLink: null,
    title: "Thread",
    status: "running",
    lastSummary: null,
    unreadResult: false,
    lastSyncedAt: now,
    createdAt: now,
  };
}

function makeHighlight(documentId: ReturnType<typeof asDocumentId>): DocumentHighlight {
  const now = new Date().toISOString();
  return {
    id: asHighlightId("hlt_1"),
    workspaceId: asWorkspaceId("ws_default"),
    documentId,
    quote: "Quote",
    prefixContext: "",
    suffixContext: "",
    color: "amber",
    noteMarkdown: "",
    bindingId: null,
    status: "open",
    resolvedAt: null,
    resolvedByType: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeTemplate(): DocumentTemplate {
  const now = new Date().toISOString();
  return {
    id: asTemplateId("tpl_1"),
    workspaceId: asWorkspaceId("ws_default"),
    name: "Daily Note",
    kind: "outline",
    description: "",
    contentMarkdown: "",
    isDefaultDaily: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makeShareLink(documentId: ReturnType<typeof asDocumentId>): ShareLink {
  const now = new Date().toISOString();
  return {
    id: asShareLinkId("shr_1"),
    workspaceId: asWorkspaceId("ws_default"),
    documentId,
    token: "tok_share_1",
    expiresAt: null,
    revokedAt: now,
    createdAt: now,
  };
}

function makeSavedView(): SavedView {
  const now = new Date().toISOString();
  return {
    id: asSavedViewId("viw_1"),
    workspaceId: asWorkspaceId("ws_default"),
    name: "Pinned",
    filter: { pinnedOnly: true },
    displayMode: "grid",
    groupByField: null,
    visibleColumns: null,
    columnWidths: null,
    sortRules: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe("@inkade/sdk/react zero-DOM headless layer", () => {
  test("creates InkadeSdkProvider element with injected client without DOM dependencies", () => {
    const client = createInkadeClient({ baseUrl: "http://127.0.0.1:3456", token: "tok_abc" });
    const child = React.createElement("span", null, "probe");
    const element = InkadeSdkProvider({
      client,
      sseConfig: { enabled: true },
      children: child,
    });

    expect((element.props as { value: { client: typeof client; sseConfig?: unknown } }).value.client).toBe(
      client,
    );
    expect(client.getConnectionConfig().baseUrl).toBe("http://127.0.0.1:3456");
    expect(client.getConnectionConfig().token).toBe("tok_abc");
  });

  test("applyInkadeEventToQueryCache invalidates expected query keys and ignores transient agent.tool.*", () => {
    const invalidated: unknown[] = [];
    const fakeQueryClient = {
      invalidateQueries: (opts: { queryKey: readonly unknown[] }) => {
        invalidated.push(opts.queryKey);
        return Promise.resolve();
      },
    } as Pick<QueryClient, "invalidateQueries">;

    const startedEvent: InkadeEvent<"agent.tool.started"> = {
      ...makeEventBase(),
      type: "agent.tool.started",
      payload: {
        invocationId: "inv_1",
        transport: "mcp",
        toolName: "get_document",
        tokenId: asApiTokenId("tok_1"),
        tokenName: "Cursor Agent",
        mutating: false,
      },
    };
    applyInkadeEventToQueryCache(fakeQueryClient, startedEvent);
    expect(invalidated).toHaveLength(0);

    const doc42 = asDocumentId("doc_42");
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase({ documentId: doc42, documentKind: "outline" }),
      type: "document.updated",
      payload: { document: makeDoc(doc42, "outline") },
    });
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "documents"]);
    expect(invalidated).toContainEqual(inkadeQueryKeys.document(doc42));
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "daily"]);

    invalidated.length = 0;
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase({ documentId: doc42 }),
      type: "thread.binding.claimed",
      payload: { binding: makeBinding(doc42) },
    });
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "thread-bindings"]);

    // Phase 0: verify highlight, template, share, saved_view, and audit.rolled_back invalidations
    invalidated.length = 0;
    const docHl1 = asDocumentId("doc_hl_1");
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase({ documentId: docHl1 }),
      type: "highlight.created",
      payload: { highlight: makeHighlight(docHl1) },
    });
    expect(invalidated).toContainEqual(inkadeQueryKeys.highlights(docHl1));

    invalidated.length = 0;
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase(),
      type: "highlight.deleted",
      payload: { highlightId: asHighlightId("hlt_1"), documentId: docHl1 },
    });
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "highlights"]);

    invalidated.length = 0;
    const hlt1 = asHighlightId("hlt_1");
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase({ documentId: docHl1 }),
      type: "highlight.comment.created",
      payload: {
        highlight: makeHighlight(docHl1),
        comment: {
          id: "cmt_1" as never,
          workspaceId: asWorkspaceId("ws_default"),
          highlightId: hlt1,
          documentId: docHl1,
          authorType: "human",
          authorId: "usr_1",
          authorName: "Euan",
          bodyMarkdown: "Check this claim",
          sentToAgentAt: null,
          wakeEventId: null,
          createdAt: new Date().toISOString(),
        },
      },
    });
    expect(invalidated).toContainEqual(inkadeQueryKeys.highlights(docHl1));
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "comment-threads", docHl1]);
    expect(invalidated).toContainEqual(inkadeQueryKeys.highlightComments(hlt1));

    invalidated.length = 0;
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase({ documentId: docHl1 }),
      type: "highlight.resolved",
      payload: {
        highlight: {
          ...makeHighlight(docHl1),
          status: "resolved",
          resolvedAt: new Date().toISOString(),
          resolvedByType: "agent",
        },
        resolved: true,
      },
    });
    expect(invalidated).toContainEqual(inkadeQueryKeys.highlights(docHl1));
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "comment-threads", docHl1]);
    expect(invalidated).toContainEqual(inkadeQueryKeys.highlightComments(hlt1));

    invalidated.length = 0;
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase(),
      type: "template.updated",
      payload: { template: makeTemplate() },
    });
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "templates"]);

    invalidated.length = 0;
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase(),
      type: "share.revoked",
      payload: { shareLink: makeShareLink(doc42) },
    });
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "share-links"]);

    invalidated.length = 0;
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase(),
      type: "saved_view.created",
      payload: { savedView: makeSavedView() },
    });
    expect(invalidated).toContainEqual(inkadeQueryKeys.savedViews());

    invalidated.length = 0;
    const docOut1 = asDocumentId("doc_out_1");
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase({ documentId: docOut1, documentKind: "outline" }),
      type: "audit.rolled_back",
      payload: {
        restoredRevisionId: asRevisionId("rev_1"),
        rollbackAuditLog: {
          id: asAuditLogId("aud_1"),
          workspaceId: asWorkspaceId("ws_default"),
          principalKind: "user",
          tokenId: null,
          tokenName: null,
          transport: "rest",
          action: "rollback",
          resource: `document:${docOut1}`,
          spaceId: asSpaceId("spc_1"),
          documentId: docOut1,
          decision: "allowed",
          reason: null,
          summary: "Rollback",
          createdAt: new Date().toISOString(),
        },
        affectedAuditIds: [asAuditLogId("aud_0")],
        document: makeDoc(docOut1, "outline"),
      },
    });
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "audit-logs"]);
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "documents"]);
    expect(invalidated).toContainEqual(inkadeQueryKeys.workspaceSummary());
    expect(invalidated).toContainEqual(inkadeQueryKeys.storageBuckets());
    expect(invalidated).toContainEqual(inkadeQueryKeys.document(docOut1));
    expect(invalidated).toContainEqual(inkadeQueryKeys.revisions(docOut1));
    expect(invalidated).toContainEqual(inkadeQueryKeys.backlinks(docOut1));
    expect(invalidated).toContainEqual(inkadeQueryKeys.outlineNodes(docOut1));
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "daily"]);
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "tasks"]);

    invalidated.length = 0;
    const jobId = asBriefingJobId("brj_1");
    const runId = asBriefingRunId("brr_1");
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase(),
      type: "briefing.failed",
      payload: {
        run: {
          id: runId,
          jobId,
          jobName: "Morning Clips & RSS",
          workspaceId: asWorkspaceId("ws_default"),
          triggerKind: "schedule",
          status: "failed",
          batchId: null,
          documentId: null,
          summary: null,
          citations: [],
          errorMessage: "Provider timed out",
          dismissedAt: null,
          durationMs: 1200,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      },
    });
    expect(invalidated).toContainEqual(inkadeQueryKeys.briefingJobs());
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "briefing-runs"]);

    invalidated.length = 0;
    applyInkadeEventToQueryCache(fakeQueryClient, {
      ...makeEventBase({ documentId: doc42 }),
      type: "briefing.succeeded",
      payload: {
        run: {
          id: runId,
          jobId,
          jobName: "Morning Clips & RSS",
          workspaceId: asWorkspaceId("ws_default"),
          triggerKind: "manual",
          status: "succeeded",
          batchId: null,
          documentId: doc42,
          summary: "Done",
          citations: [],
          errorMessage: null,
          dismissedAt: null,
          durationMs: 400,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      },
    });
    expect(invalidated).toContainEqual(inkadeQueryKeys.briefingJobs());
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "briefing-runs"]);
    expect(invalidated).toContainEqual([...inkadeQueryKeys.all, "documents"]);
    expect(invalidated).toContainEqual(inkadeQueryKeys.document(doc42));
  });

  test("inkadeQueryKeys keeps distinct pagination keys for documents and tasks", () => {
    const docPage1 = inkadeQueryKeys.documents({ spaceId: asSpaceId("spc_1"), limit: 20, offset: 0 });
    const docPage2 = inkadeQueryKeys.documents({ spaceId: asSpaceId("spc_1"), limit: 20, offset: 20 });
    expect(docPage1).not.toEqual(docPage2);

    const taskPage1 = inkadeQueryKeys.tasks({ status: "open", limit: 50, offset: 0 });
    const taskPage2 = inkadeQueryKeys.tasks({ status: "open", limit: 50, offset: 50 });
    expect(taskPage1).not.toEqual(taskPage2);
  });

  test("reduceActiveAgentTools and pruneStaleAgentTools track and age out concurrent tool calls", () => {
    const started = reduceActiveAgentTools(
      [],
      {
        ...makeEventBase({ documentId: asDocumentId("doc_9") }),
        type: "agent.tool.started",
        payload: {
          invocationId: "inv_1",
          transport: "mcp",
          toolName: "patch_document_section",
          tokenId: asApiTokenId("tok_1"),
          tokenName: "Cursor Agent",
          mutating: true,
        },
      },
      1_000,
    );
    expect(started).toHaveLength(1);
    expect(started[0]?.toolName).toBe("patch_document_section");
    expect(started[0]?.tokenName).toBe("Cursor Agent");

    expect(pruneStaleAgentTools(started, 15_000, 10_000)).toHaveLength(1);
    expect(pruneStaleAgentTools(started, 15_000, 20_000)).toHaveLength(0);

    const finished = reduceActiveAgentTools(
      started,
      {
        ...makeEventBase(),
        type: "agent.tool.finished",
        payload: {
          invocationId: "inv_1",
          transport: "mcp",
          toolName: "patch_document_section",
          tokenId: asApiTokenId("tok_1"),
          tokenName: "Cursor Agent",
          mutating: true,
          status: "ok",
        },
      },
      1_200,
    );
    expect(finished).toHaveLength(0);
  });

  test("inkadeQueries builds stable queryOptions factories aligned with inkadeQueryKeys", () => {
    const client = createInkadeClient({ baseUrl: "http://127.0.0.1:3456" });
    const docId = asDocumentId("doc_opts_1");

    expect([...inkadeQueries.bootstrap(client).queryKey]).toEqual([...inkadeQueryKeys.bootstrap()]);
    expect([...inkadeQueries.whoami(client).queryKey]).toEqual([...inkadeQueryKeys.whoami()]);
    expect([...inkadeQueries.spaces(client, true).queryKey]).toEqual([
      ...inkadeQueryKeys.spaces(true),
    ]);
    expect([...inkadeQueries.document(client, docId).queryKey]).toEqual([
      ...inkadeQueryKeys.document(docId),
    ]);
    expect([...inkadeQueries.outlineNodes(client, docId).queryKey]).toEqual([
      ...inkadeQueryKeys.outlineNodes(docId),
    ]);
    expect([...inkadeQueries.tasks(client, { status: "open" }).queryKey]).toEqual([
      ...inkadeQueryKeys.tasks({ status: "open" }),
    ]);
    expect([...inkadeQueries.aiSettings(client).queryKey]).toEqual([
      ...inkadeQueryKeys.aiSettings(),
    ]);
  });
});
