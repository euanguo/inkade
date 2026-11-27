import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { asDocumentId, asOutlineNodeId } from "@inkade/core";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CitedAnswerCard,
  extractCitationsFromSummary,
  splitHighlightedExcerpt,
} from "./CitedAnswerCard.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});
afterAll(() => {
  initInkadeI18n("zh-CN");
});

describe("CitedAnswerCard", () => {
  it("highlights matching keywords in excerpt without raw HTML injection", () => {
    const segments = splitHighlightedExcerpt(
      "SQLite FTS5 powers fast lexical search.",
      ["FTS5", "search"],
    );
    expect(segments.some((s) => s.highlighted && s.text === "FTS5")).toBe(true);
    expect(segments.some((s) => s.highlighted && s.text === "search")).toBe(true);
    expect(segments.some((s) => !s.highlighted && s.text.includes("SQLite"))).toBe(true);
  });

  it("extracts deduplicated wikilink citations from agent summary text", () => {
    const citations = extractCitationsFromSummary(
      "Updated summary referencing [[Architecture Spec]] and [[Architecture Spec|Arch]] plus [[Missing Doc]].",
      [
        {
          id: asDocumentId("doc_arch"),
          title: "Architecture Spec",
          slug: "architecture-spec",
          kind: "article",
          excerpt: "Core dual-engine outline and markdown model.",
          contentText: "Core dual-engine outline and markdown model.",
        },
      ],
    );

    expect(citations).toHaveLength(2);
    expect(citations[0]?.documentId).toBe(asDocumentId("doc_arch"));
    expect(citations[0]?.documentTitle).toBe("Architecture Spec");
    expect(citations[1]?.documentTitle).toBe("Missing Doc");
  });

  it("renders inline marker and 1px neutral excerpt card with zero colored left borders", () => {
    const html = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(CitedAnswerCard, {
          answer: "Verified against source specification",
          citations: [
            {
              id: "c1",
              index: 1,
              documentId: asDocumentId("doc_arch"),
              documentTitle: "Architecture Spec",
              excerpt: "Dual-engine outline nodes preserve stable IDs across edits.",
              highlightTerms: ["stable IDs"],
            },
          ],
          onOpenSource: () => {},
        }),
      }),
    );

    expect(html).toContain('data-slot="cited-answer-card"');
    expect(html).toContain('data-slot="cited-source-excerpt"');
    expect(html).toContain("Architecture Spec");
    expect(html).toContain("Open Source");
    expect(html).toContain("<mark");
    expect(html).toContain("stable IDs");
    expect(html).not.toContain("border-l-");
    expect(html).not.toContain("border-left");
  });

  it("renders interactive inline [1] tokens and heading/nodeId anchors", () => {
    const html = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(CitedAnswerCard, {
          answer: "Hybrid RAG uses Float32 vectors [1].",
          citations: [
            {
              id: "c1",
              index: 1,
              documentId: asDocumentId("doc_arch"),
              documentTitle: "Hybrid Spec",
              headingPath: "Storage > Vectors",
              nodeId: asOutlineNodeId("nod_vec_1"),
              excerpt: "Vectors persist as Float32 BLOBs.",
            },
          ],
          defaultExpandedIndex: 0,
        }),
      }),
    );

    expect(html).toContain("Jump to citation [1]: Hybrid Spec");
    expect(html).toContain("Section · Storage &gt; Vectors");
    expect(html).toContain("Node #nod_vec_1");
  });
});
