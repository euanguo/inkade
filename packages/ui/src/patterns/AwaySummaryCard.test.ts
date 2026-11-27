import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { asDocumentId, asSpaceId, asThreadBindingId, type AwaySummaryResponse } from "@inkade/core";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AwaySummaryCard,
  formatAwayElapsedParts,
  sortAwaySummaryItems,
} from "./AwaySummaryCard.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});
afterAll(() => {
  initInkadeI18n("zh-CN");
});

function makeSummary(overrides: Partial<AwaySummaryResponse> = {}): AwaySummaryResponse {
  return {
    since: "2026-11-24T04:00:00.000Z",
    generatedAt: "2026-11-24T06:18:00.000Z",
    elapsedMs: 2 * 3600_000 + 18 * 60_000,
    totalCount: 4,
    counts: {
      needsDecision: 1,
      failed: 1,
      completed: 1,
      unreadDocuments: 1,
    },
    items: [
      {
        id: "doc:doc_1",
        category: "unread_document",
        documentId: asDocumentId("doc_1"),
        documentTitle: "Research Spec",
        documentKind: "article",
        spaceId: asSpaceId("spc_research"),
        bindingId: null,
        title: "Research Spec",
        summary: "Updated sections",
        updatedAt: "2026-11-24T06:10:00.000Z",
      },
      {
        id: "binding:b_done",
        category: "completed",
        documentId: asDocumentId("doc_2"),
        documentTitle: "Daily 2026-11-24",
        documentKind: "outline",
        spaceId: asSpaceId("spc_daily"),
        bindingId: asThreadBindingId("b_done"),
        title: "Synthesize meeting notes",
        summary: "Done",
        status: "completed",
        updatedAt: "2026-11-24T06:15:00.000Z",
      },
      {
        id: "binding:b_fail",
        category: "failed",
        documentId: asDocumentId("doc_3"),
        documentTitle: "API Notes",
        documentKind: "article",
        spaceId: asSpaceId("spc_research"),
        bindingId: asThreadBindingId("b_fail"),
        title: "Sync external schema",
        summary: "Timeout",
        status: "failed",
        updatedAt: "2026-11-24T06:16:00.000Z",
      },
      {
        id: "binding:b_wait",
        category: "needs_decision",
        documentId: asDocumentId("doc_4"),
        documentTitle: "Roadmap",
        documentKind: "article",
        spaceId: asSpaceId("spc_projects"),
        bindingId: asThreadBindingId("b_wait"),
        title: "Approve section rewrite",
        summary: "Waiting approval",
        status: "waiting_input",
        updatedAt: "2026-11-24T06:12:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("AwaySummaryCard", () => {
  it("sorts away items strictly by priority: needs_decision -> failed -> completed -> unread_document", () => {
    const summary = makeSummary();
    const sorted = sortAwaySummaryItems(summary.items);
    expect(sorted.map((i) => i.category)).toEqual([
      "needs_decision",
      "failed",
      "completed",
      "unread_document",
    ]);
  });

  it("formats elapsed milliseconds into clamped hours and minutes", () => {
    expect(formatAwayElapsedParts(2 * 3600_000 + 18 * 60_000)).toEqual({
      hours: 2,
      minutes: 18,
    });
    expect(formatAwayElapsedParts(-5000)).toEqual({ hours: 0, minutes: 0 });
  });

  it("returns empty markup when summary is null or has zero items", () => {
    const emptyHtml = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(AwaySummaryCard, {
          summary: makeSummary({ items: [], totalCount: 0 }),
        }),
      }),
    );
    expect(emptyHtml).toBe("");
  });

  it("renders unified tray card with ordered rows, elapsed label, and collapsed hairline bar", () => {
    const expandedHtml = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(AwaySummaryCard, { summary: makeSummary() }),
      }),
    );
    expect(expandedHtml).toContain('data-slot="away-summary-card"');
    expect(expandedHtml).toContain('data-collapsed="false"');
    expect(expandedHtml).toContain("Away 2h 18m");
    expect(expandedHtml).toContain("Go to Approve");
    expect(expandedHtml).toContain("Retry");
    expect(expandedHtml).toContain("Review Diff");
    expect(expandedHtml).not.toContain("border-l-");

    const waitPos = expandedHtml.indexOf('data-away-category="needs_decision"');
    const failPos = expandedHtml.indexOf('data-away-category="failed"');
    const donePos = expandedHtml.indexOf('data-away-category="completed"');
    const unreadPos = expandedHtml.indexOf('data-away-category="unread_document"');
    expect(waitPos).toBeLessThan(failPos);
    expect(failPos).toBeLessThan(donePos);
    expect(donePos).toBeLessThan(unreadPos);

    const collapsedHtml = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(AwaySummaryCard, {
          summary: makeSummary(),
          defaultCollapsed: true,
        }),
      }),
    );
    expect(collapsedHtml).toContain('data-collapsed="true"');
    expect(collapsedHtml).toContain('data-slot="away-summary-collapsed-bar"');
    expect(collapsedHtml).toContain("Re-expand");
  });
});
