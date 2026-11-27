import { describe, expect, test } from "bun:test";
import { chunkDocumentContent } from "./chunking.ts";
import { asDocumentId, asOutlineNodeId } from "./ids.ts";
import {
  buildOutlineBlockDeepLink,
  buildPdfCitationUri,
  parseOutlineBlockDeepLink,
  parsePdfCitationUri,
  stripNotionUuidSuffix,
} from "./types/ingest-pdf.ts";
import { parseObsidianWikiLinks, rewriteObsidianWikiLinks } from "./wikilink-ast.ts";

describe("Phase 44 Core AST & Ingest Utilities", () => {
  test("parseObsidianWikiLinks and rewriteObsidianWikiLinks skip code blocks and inline code", () => {
    const md = [
      "See [[Old Note#Architecture|Core Design]] and ![[diagram.png]].",
      "",
      "Inline code `[[Should Stay Untouched]]` remains untouched.",
      "",
      "```markdown",
      "[[Also Untouched Inside Fence]]",
      "![[ignored.png]]",
      "```",
    ].join("\n");

    const parsed = parseObsidianWikiLinks(md);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      isEmbed: false,
      target: "Old Note",
      anchor: "Architecture",
      alias: "Core Design",
    });
    expect(parsed[1]).toMatchObject({
      isEmbed: true,
      target: "diagram.png",
    });

    const rewritten = rewriteObsidianWikiLinks(md, (link) => {
      if (link.isEmbed) return "![diagram.png](/api/v1/attachments/att_1/download)";
      if (link.target === "Old Note") {
        return `[[Renamed Note#${link.anchor}|${link.alias}]]`;
      }
      return null;
    });

    expect(rewritten.rewrittenCount).toBe(2);
    expect(rewritten.markdown).toContain("[[Renamed Note#Architecture|Core Design]]");
    expect(rewritten.markdown).toContain("![diagram.png](/api/v1/attachments/att_1/download)");
    expect(rewritten.markdown).toContain("`[[Should Stay Untouched]]`");
    expect(rewritten.markdown).toContain("[[Also Untouched Inside Fence]]");
  });

  test("stripNotionUuidSuffix strips 32-hex trailing IDs while preserving normal names", () => {
    expect(stripNotionUuidSuffix("System Architecture a1b2c3d4e5f6789012345678901234ef")).toBe(
      "System Architecture",
    );
    expect(stripNotionUuidSuffix("Q4 OKRs 2026")).toBe("Q4 OKRs 2026");
  });

  test("PDF citation URI and Outline block deep link roundtrip cleanly", () => {
    const docId = asDocumentId("doc_pdf123");
    const uri = buildPdfCitationUri(docId, 4, [
      { x: 0.1234, y: 0.5678, width: 0.4, height: 0.05 },
    ]);
    expect(uri).toBe("inkade://pdf/doc_pdf123#page=4&rect=0.1234,0.5678,0.4,0.05");
    expect(parsePdfCitationUri(uri)).toEqual({
      docId,
      page: 4,
      rect: { x: 0.1234, y: 0.5678, width: 0.4, height: 0.05 },
    });

    const nodeId = asOutlineNodeId("nod_xyz");
    const blockLink = buildOutlineBlockDeepLink(docId, nodeId);
    expect(blockLink).toBe("inkade://doc/doc_pdf123#node=nod_xyz");
    expect(parseOutlineBlockDeepLink(blockLink)).toEqual({ docId, nodeId });
  });

  test("chunkDocumentContent retains PDF extracted page sections alongside outline notes", () => {
    const docId = asDocumentId("doc_study");
    const chunks = chunkDocumentContent({
      docId,
      title: "Research Paper",
      kind: "outline",
      contentMarkdown: "",
      contentText: "",
      tags: ["paper"],
      outlineNodes: [
        {
          id: asOutlineNodeId("nod_1"),
          documentId: docId,
          parentNodeId: null,
          orderKey: "a0",
          contentMarkdown: "My companion summary note",
          contentText: "My companion summary note",
          noteMarkdown: "",
          noteText: "",
          checked: null,
          collapsed: false,
          authorType: "human",
          authorId: null,
          sourceBindingId: null,
          mirrorOfNodeId: null,
          rolledOverToDocId: null,
          deletedAt: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      pdfPages: [
        { page: 1, text: "Attention Is All You Need introduces the Transformer architecture." },
        { page: 2, text: "Multi-head self-attention allows attending to different subspaces." },
      ],
    });

    expect(chunks.some((c) => c.headingPath === "Page 1" && c.contentText.includes("Transformer"))).toBe(
      true,
    );
    expect(
      chunks.some((c) => c.headingPath === "Page 2" && c.contentText.includes("Multi-head")),
    ).toBe(true);
    expect(chunks.some((c) => c.contentText.includes("My companion summary note"))).toBe(true);
  });
});
