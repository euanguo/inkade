import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { asDocumentId, asSpaceId, type ScopeEffectiveSummary } from "@inkade/core";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentComposerPanel,
  type ComposerDocumentOption,
  detectComposerTrigger,
  formatScopeBadgeSummary,
  removeLastMentionOnBackspace,
} from "./AgentComposerPanel.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});
afterAll(() => {
  initInkadeI18n("zh-CN");
});

const DOCS: ComposerDocumentOption[] = [
  { id: asDocumentId("doc_1"), title: "Architecture Spec", kind: "article", spaceId: asSpaceId("spc_research") },
  { id: asDocumentId("doc_2"), title: "Daily 2026-11-24", kind: "outline", spaceId: asSpaceId("spc_daily") },
];

describe("AgentComposerPanel", () => {
  it("detects @ and / triggers accurately before cursor position", () => {
    expect(detectComposerTrigger("Check @arch", 11)).toEqual({
      type: "@",
      query: "arch",
      startIndex: 6,
    });
    expect(detectComposerTrigger("/rev", 4)).toEqual({
      type: "/",
      query: "rev",
      startIndex: 0,
    });
    expect(detectComposerTrigger("email@domain.com", 16)).toBeNull();
  });

  it("removes the last atomic @DocTitle pill on Backspace at cursor 0", () => {
    const unchanged = removeLastMentionOnBackspace(3, 3, DOCS);
    expect(unchanged.removed).toBeNull();
    expect(unchanged.nextMentionedDocs).toHaveLength(2);

    const removed = removeLastMentionOnBackspace(0, 0, DOCS);
    expect(removed.removed?.id).toBe(asDocumentId("doc_2"));
    expect(removed.nextMentionedDocs.map((d) => d.id)).toEqual([asDocumentId("doc_1")]);

    const empty = removeLastMentionOnBackspace(0, 0, []);
    expect(empty.removed).toBeNull();
  });

  it("formats read-only scope summary badge clearly", () => {
    const summary: ScopeEffectiveSummary = {
      permission: "write",
      allowedSpaceIds: [asSpaceId("spc_research")],
      includeDescendants: true,
      tagAllowlist: null,
      allowedKinds: null,
      denyHardDelete: true,
    };

    const text = formatScopeBadgeSummary(
      summary,
      [{ id: asSpaceId("spc_research"), name: "Research" }],
      {
        allSpaces: "All Spaces",
        spacesCount: (n) => `${n} spaces`,
        noHardDelete: "No hard delete",
        fallback: "Scoped",
      },
    );
    expect(text).toBe("Research · No hard delete");
  });

  it("renders recessed 34px bar, @ mention pills, Track Changes toggle, and Dispatch CTA", () => {
    const html = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(AgentComposerPanel, {
          documents: DOCS,
          initialMentionedDocs: [DOCS[0]!],
          scopeSummary: {
            permission: "write",
            allowedSpaceIds: [asSpaceId("spc_research")],
            includeDescendants: true,
            tagAllowlist: null,
            allowedKinds: null,
            denyHardDelete: true,
          },
          spaces: [{ id: asSpaceId("spc_research"), name: "Research" }],
          onSubmit: () => {},
        }),
      }),
    );

    expect(html).toContain('data-slot="agent-composer-panel"');
    expect(html).toContain('data-slot="composer-attachment-bar"');
    expect(html).toContain("h-[34px]");
    expect(html).toContain("Scope: Research · No hard delete");
    expect(html).toContain("Architecture Spec");
    expect(html).toContain("Track Changes: On");
    expect(html).toContain("Dispatch Thread");
  });
});
