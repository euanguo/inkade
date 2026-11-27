import { describe, expect, it } from "bun:test";
import {
  asDocumentId,
  asHighlightCommentId,
  asHighlightId,
  asThreadBindingId,
  asWorkspaceId,
  type AdeThreadBinding,
  type DocumentHighlight,
  type HighlightComment,
} from "@inkade/core";
import {
  estimateMarginaliaCardHeight,
  filterMarginaliaHighlights,
  formatThreadReceiptInfo,
  MarginaliaOverlay,
  matchHighlightAnchor,
  resolveHighlightBinding,
  resolveMarginaliaCollisions,
} from "./MarginaliaOverlay.tsx";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("MarginaliaOverlay anchor & layout helpers", () => {
  it("matches exact quotes and disambiguates duplicate quotes via prefix/suffix context", () => {
    const doc = [
      "First section discusses alpha stability in detail.",
      "Second section discusses alpha stability under load.",
    ].join("\n\n");

    const secondMatch = matchHighlightAnchor(doc, {
      quote: "alpha stability",
      prefixContext: "Second section discusses ",
      suffixContext: " under load.",
    });

    expect(secondMatch).not.toBeNull();
    expect(secondMatch?.exact).toBe(true);
    expect(doc.slice(secondMatch!.start, secondMatch!.end)).toBe("alpha stability");
    expect(secondMatch!.start).toBeGreaterThan(doc.indexOf("Second section"));
  });

  it("matches across whitespace drift and minor casing changes", () => {
    const doc = "Inkade keeps   clean\nMarkdown for every report.";
    const match = matchHighlightAnchor(doc, {
      quote: "clean markdown for every",
      prefixContext: "keeps",
      suffixContext: "report.",
    });

    expect(match).not.toBeNull();
    expect(match?.exact).toBe(false);
    expect(doc.slice(match!.start, match!.end)).toBe("clean\nMarkdown for every");
  });

  it("returns null when quote cannot be anchored", () => {
    const match = matchHighlightAnchor("Completely different paragraph.", {
      quote: "Non-existent sentence",
    });
    expect(match).toBeNull();
  });

  it("resolves vertical collisions for right-rail marginalia cards without overlaps", () => {
    const laidOut = resolveMarginaliaCollisions(
      [
        { id: "c2", idealTop: 110, estimatedHeight: 90 },
        { id: "c1", idealTop: 100, estimatedHeight: 100 },
        { id: "c3", idealTop: 400, estimatedHeight: 80 },
      ],
      12,
    );

    expect(laidOut.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(laidOut[0]?.top).toBe(100);
    expect(laidOut[1]?.top).toBe(212); // 100 + 100 + 12
    expect(laidOut[2]?.top).toBe(400);
  });
});

function makeHighlight(
  id: string,
  overrides: Partial<DocumentHighlight> = {},
): DocumentHighlight {
  const now = "2026-11-26T00:00:00.000Z";
  return {
    id: asHighlightId(id),
    workspaceId: asWorkspaceId("ws_default"),
    documentId: asDocumentId("doc_1"),
    quote: "Quote",
    prefixContext: "",
    suffixContext: "",
    color: "amber",
    noteMarkdown: "Initial note",
    bindingId: null,
    status: "open",
    resolvedAt: null,
    resolvedByType: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBinding(
  id: string,
  status: AdeThreadBinding["status"],
  title: string,
): AdeThreadBinding {
  const now = "2026-11-26T00:00:00.000Z";
  return {
    id: asThreadBindingId(id),
    workspaceId: asWorkspaceId("ws_default"),
    documentId: asDocumentId("doc_1"),
    nodeId: null,
    selectionAnchor: null,
    adeKind: "codex",
    externalWorkspaceId: null,
    externalThreadId: `ext_${id}`,
    deepLink: null,
    title,
    status,
    lastSummary: null,
    unreadResult: false,
    lastSyncedAt: now,
    createdAt: now,
  };
}

function makeComment(id: string, sentToAgentAt: string | null = null): HighlightComment {
  return {
    id: asHighlightCommentId(id),
    workspaceId: asWorkspaceId("ws_default"),
    highlightId: asHighlightId("hlt_1"),
    documentId: asDocumentId("doc_1"),
    authorType: "human",
    authorId: "usr_1",
    authorName: "Euan",
    bodyMarkdown: "Follow up on this section",
    sentToAgentAt,
    wakeEventId: null,
    createdAt: "2026-11-26T00:00:00.000Z",
  };
}

describe("Phase 49 marginalia helpers", () => {
  it("filters highlights by status (open, resolved, all)", () => {
    const openHl = makeHighlight("hlt_open", { status: "open" });
    const resolvedHl = makeHighlight("hlt_done", {
      status: "resolved",
      resolvedAt: "2026-11-26T01:00:00.000Z",
      resolvedByType: "agent",
    });

    expect(filterMarginaliaHighlights([openHl, resolvedHl], "open")).toEqual([openHl]);
    expect(filterMarginaliaHighlights([openHl, resolvedHl], "resolved")).toEqual([resolvedHl]);
    expect(filterMarginaliaHighlights([openHl, resolvedHl], "all")).toHaveLength(2);
  });

  it("resolves highlight bindings preferring non-archived direct link then active fallback", () => {
    const archived = makeBinding("thr_arch", "archived", "Archived");
    const running = makeBinding("thr_run", "running", "Active Runner");
    const queued = makeBinding("thr_q", "queued", "Queued Worker");

    const directHl = makeHighlight("hlt_1", { bindingId: queued.id });
    expect(resolveHighlightBinding(directHl, [archived, running, queued])?.id).toBe(queued.id);

    const staleHl = makeHighlight("hlt_2", { bindingId: archived.id });
    expect(resolveHighlightBinding(staleHl, [archived, running])?.id).toBe(running.id);
    expect(resolveHighlightBinding(staleHl, [archived])).toBeNull();
  });

  it("estimates compact height for resolved cards and expanded height for threaded open cards", () => {
    const resolvedHl = makeHighlight("hlt_res", { status: "resolved" });
    const openHl = makeHighlight("hlt_open", { noteMarkdown: "Review equation" });
    const comments = [makeComment("cmt_1"), makeComment("cmt_2")];

    expect(estimateMarginaliaCardHeight(resolvedHl, comments)).toBe(76);
    expect(estimateMarginaliaCardHeight(openHl, comments)).toBe(124 + 44 + 2 * 46);
  });

  it("formats wake delivery receipt summaries for live receipts and persisted history", () => {
    const hl = makeHighlight("hlt_1");
    const binding = makeBinding("thr_1", "running", "Codex Reviewer");

    expect(
      formatThreadReceiptInfo({
        highlight: hl,
        comments: [],
        receipt: { deliveryTarget: "unowned" },
      }),
    ).toEqual({ kind: "unowned" });

    expect(
      formatThreadReceiptInfo({
        highlight: hl,
        comments: [],
        receipt: { deliveryTarget: "bound_session", wakeStatus: "pending" },
      }),
    ).toEqual({ kind: "queued" });

    expect(
      formatThreadReceiptInfo({
        highlight: hl,
        comments: [],
        receipt: { deliveryTarget: "bridge_session", wakeStatus: "claimed", agentLabel: "Claude Code" },
      }),
    ).toEqual({ kind: "woke", targetLabel: "Claude Code" });

    expect(
      formatThreadReceiptInfo({
        highlight: hl,
        comments: [makeComment("cmt_1", "2026-11-26T00:05:00.000Z")],
        bindings: [binding],
      }),
    ).toEqual({ kind: "woke", targetLabel: "Codex Reviewer" });

    expect(
      formatThreadReceiptInfo({
        highlight: hl,
        comments: [makeComment("cmt_1", "2026-11-26T00:05:00.000Z")],
        bindings: [],
      }),
    ).toEqual({ kind: "sent" });
  });

  it("renders inline mobile marginalia with single-column containment and long-token wrapping", () => {
    initInkadeI18n("en-US");
    const longTokenHl = makeHighlight("hlt_wrap", {
      quote: "super_long_identifier_without_spaces_1234567890_abcdefg",
      noteMarkdown: "Check `super_long_code_span_without_spaces_999999999` wrapping",
    });
    const overlayNode = React.createElement(MarginaliaOverlay, {
      highlights: [longTokenHl],
      anchorPositions: [],
      commentsByHighlightId: {
        [longTokenHl.id]: [
          {
            ...makeComment("cmt_wrap", "2026-11-26T00:10:00.000Z"),
            bodyMarkdown: "Long URL https://example.com/very/long/unbroken/path/segment/test",
          },
        ],
      },
      mode: "inline",
    });
    const html = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: overlayNode,
      }),
    );
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("min-w-0");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("break-all");
  });
});
