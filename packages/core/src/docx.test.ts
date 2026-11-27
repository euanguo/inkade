import { describe, expect, test } from "bun:test";
import {
  InkadeError,
  markdownToDocxFiles,
  parseDocxPackageFiles,
  splitMarkdownIntoSlides,
  stripMarkdownSpeakerNotes,
} from "./index.ts";

// Minimal valid 1x1 PNG (68 bytes)
const TINY_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
  0x44, 0x52, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x06, 0x08, 0x06, 0x00, 0x00,
  0x00, 0x8e, 0xd4, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78,
  0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("Phase 54 Core: OOXML DOCX codec & Markdown slide splitter", () => {
  test("markdownToDocxFiles produces valid OOXML package and round-trips faithfully via parseDocxPackageFiles", () => {
    const sourceMd = [
      "# Enterprise Architecture & Q4 Report",
      "",
      "Intro with **bold**, *italic*, ~~deprecated~~, `inlineCode`, and [Inkade Docs](https://inkade.dev).",
      "",
      "<!-- notes: Private presenter note that must not appear in DOCX -->",
      "",
      "## Key Findings",
      "",
      "- Unordered bullet one",
      "  - Nested bullet level two",
      "1. Ordered step one",
      "2. Ordered step two",
      "- [x] Task completed",
      "- [ ] Task pending",
      "",
      "> Architectural note: Scope enforcement runs at SQL boundary.",
      "",
      "```ts",
      "export function verifyScope(id: string): boolean {",
      "  return id.startsWith('spc_');",
      "}",
      "```",
      "",
      "| Component | Status | Owner |",
      "| :--- | :---: | ---: |",
      "| Core Codec | Ready | Inkade |",
      "| UI Modal | Ready | Frontend |",
      "",
      "![Architecture Diagram](/api/v1/attachments/att_arch_1/download)",
      "",
      "```inkade-pending",
      "id: sec_benchmark",
      "label: Running performance benchmark...",
      "status: generating",
      "```",
      "",
      "```inkade-view",
      "mode: table",
      "spaceId: spc_research",
      "columns:",
      "  - title",
      "  - status",
      "```",
      "",
      "```inkade-artifact",
      "title: Revenue Calculator",
      "kind: interactive_chart",
      "fallbackMarkdown: |",
      "  Fallback summary row: ARR +42% YoY.",
      "```",
    ].join("\n");

    const pkg = markdownToDocxFiles({
      title: "Enterprise Architecture & Q4 Report",
      markdown: sourceMd,
      media: [
        {
          url: "/api/v1/attachments/att_arch_1/download",
          bytes: TINY_PNG_BYTES,
          mimeType: "image/png",
          filename: "arch-diagram.png",
        },
      ],
    });

    expect(pkg.mediaCount).toBe(1);
    expect(pkg.hyperlinkCount).toBe(1);
    expect(pkg.files["[Content_Types].xml"]).toBeDefined();
    expect(pkg.files["_rels/.rels"]).toBeDefined();
    expect(pkg.files["word/document.xml"]).toBeDefined();
    expect(pkg.files["word/styles.xml"]).toBeDefined();
    expect(pkg.files["word/numbering.xml"]).toBeDefined();
    expect(pkg.files["word/_rels/document.xml.rels"]).toBeDefined();
    expect(pkg.files["word/media/image1.png"]).toBeDefined();

    const docXml = new TextDecoder().decode(pkg.files["word/document.xml"]);
    expect(docXml).not.toContain("Private presenter note");
    expect(docXml).toContain("Enterprise Architecture &amp; Q4 Report");
    expect(docXml).toContain("[Pending Section]");
    expect(docXml).toContain("[Inkade Live View]");
    expect(docXml).toContain("[Interactive Artifact] Revenue Calculator");
    expect(docXml).toContain("Fallback summary row: ARR +42% YoY.");
    expect(docXml).toContain('cx="76200" cy="57150"'); // 8px * 9525, 6px * 9525

    // Direct OOXML package map round-trip
    const parsed = parseDocxPackageFiles(pkg.files, { filename: "q4-report.docx" });

    expect(parsed.title).toBe("Enterprise Architecture & Q4 Report");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.bytes).toEqual(TINY_PNG_BYTES);

    expect(parsed.markdown).toContain("# Enterprise Architecture & Q4 Report");
    expect(parsed.markdown).toContain("## Key Findings");
    expect(parsed.markdown).toContain("**bold**");
    expect(parsed.markdown).toContain("*italic*");
    expect(parsed.markdown).toContain("~~deprecated~~");
    expect(parsed.markdown).toContain("`inlineCode`");
    expect(parsed.markdown).toContain("[Inkade Docs](https://inkade.dev)");
    expect(parsed.markdown).toContain("- Unordered bullet one");
    expect(parsed.markdown).toContain("  - Nested bullet level two");
    expect(parsed.markdown).toContain("1. Ordered step one");
    expect(parsed.markdown).toContain("- [x] Task completed");
    expect(parsed.markdown).toContain("- [ ] Task pending");
    expect(parsed.markdown).toContain("> Architectural note: Scope enforcement runs at SQL boundary.");
    expect(parsed.markdown).toContain("```ts\nexport function verifyScope");
    expect(parsed.markdown).toContain("| Component | Status | Owner |");
    expect(parsed.markdown).toContain("| Core Codec | Ready | Inkade |");
    expect(parsed.markdown).toContain(`![Architecture Diagram](${parsed.images[0]!.placeholderUrl})`);
    expect(parsed.markdown).not.toContain("Private presenter note");
  });

  test("parseDocxPackageFiles supports Chinese Word heading styles, merged split runs & guards invalid archives", () => {
    const encoder = new TextEncoder();
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:style w:type="paragraph" w:styleId="a3">
          <w:name w:val="标题 1"/>
        </w:style>
        <w:style w:type="paragraph" w:styleId="a4">
          <w:name w:val="标题 2"/>
        </w:style>
      </w:styles>`;
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="a3"/></w:pPr><w:r><w:t>年度调研报告</w:t></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="a4"/></w:pPr><w:r><w:t>核心结论</w:t></w:r></w:p>
          <w:p>
            <w:r><w:rPr><w:b/></w:rPr><w:t>关键</w:t></w:r>
            <w:r><w:rPr><w:b/></w:rPr><w:t>指标</w:t></w:r>
            <w:r><w:t xml:space="preserve"> 同比提升 42%</w:t></w:r>
          </w:p>
        </w:body>
      </w:document>`;

    const parsed = parseDocxPackageFiles(
      {
        "word/styles.xml": encoder.encode(stylesXml),
        "word/document.xml": encoder.encode(docXml),
      },
      { filename: "report.docx" },
    );

    expect(parsed.title).toBe("年度调研报告");
    expect(parsed.markdown).toContain("# 年度调研报告");
    expect(parsed.markdown).toContain("## 核心结论");
    expect(parsed.markdown).toContain("**关键指标** 同比提升 42%");

    expect(() => parseDocxPackageFiles({}, { filename: "empty.docx" })).toThrow(InkadeError);
  });

  test("splitMarkdownIntoSlides splits by thematicBreak, ignores code blocks & frontmatter, and extracts speaker notes", () => {
    const mdWithBreaks = [
      "---",
      "title: Ignored Frontmatter Title",
      "tags: [research]",
      "---",
      "# Opening Slide",
      "",
      "Overview of the architecture.",
      "",
      "<!-- notes: Welcome everyone to the briefing. -->",
      "",
      "---",
      "",
      "## Code Sample Slide",
      "",
      "```yaml",
      "---",
      "<!-- notes: Fake note inside code fence must remain visible -->",
      "key: value",
      "```",
      "",
      "<!-- notes:",
      "  Line 1 of multiline note",
      "  Line 2 of multiline note",
      "-->",
      "",
      "---",
      "",
      "## Closing",
      "",
      "Thank you!",
    ].join("\n");

    const result = splitMarkdownIntoSlides(mdWithBreaks, "Deck Title");
    expect(result.slides).toHaveLength(3);

    expect(result.slides[0]).toMatchObject({
      index: 0,
      title: "Opening Slide",
      speakerNotes: "Welcome everyone to the briefing.",
    });
    expect(result.slides[0]?.markdown).toContain("# Opening Slide");
    expect(result.slides[0]?.markdown).not.toContain("Welcome everyone");
    expect(result.slides[0]?.markdown).not.toContain("Ignored Frontmatter Title");

    expect(result.slides[1]).toMatchObject({
      index: 1,
      title: "Code Sample Slide",
      speakerNotes: "Line 1 of multiline note\nLine 2 of multiline note",
    });
    expect(result.slides[1]?.markdown).toContain("---\n<!-- notes: Fake note inside code fence must remain visible -->");

    expect(result.slides[2]).toMatchObject({
      index: 2,
      title: "Closing",
      speakerNotes: "",
    });
  });

  test("splitMarkdownIntoSlides falls back to ## headings with a cover slide when no --- exists", () => {
    const mdWithH2 = [
      "Executive intro paragraph.",
      "",
      "<!-- notes: Cover presenter talking point -->",
      "",
      "## Market Analysis",
      "",
      "TAM expanded 3x.",
      "",
      "## Next Steps",
      "",
      "Ship Phase 54.",
    ].join("\n");

    const result = splitMarkdownIntoSlides(mdWithH2, "2026 Strategy Review");
    expect(result.slides).toHaveLength(3);
    expect(result.slides[0]?.title).toBe("2026 Strategy Review");
    expect(result.slides[0]?.markdown).toContain("# 2026 Strategy Review");
    expect(result.slides[0]?.markdown).toContain("Executive intro paragraph.");
    expect(result.slides[0]?.speakerNotes).toBe("Cover presenter talking point");
    expect(result.slides[1]?.title).toBe("Market Analysis");
    expect(result.slides[1]?.markdown).toContain("## Market Analysis");
    expect(result.slides[2]?.title).toBe("Next Steps");
  });

  test("stripMarkdownSpeakerNotes removes HTML note comments while preserving code blocks", () => {
    const raw = [
      "# Public Heading",
      "",
      "<!-- notes: Secret speaker comment -->",
      "",
      "Visible paragraph.",
      "",
      "```html",
      "<!-- notes: Keep inside code block -->",
      "```",
    ].join("\n");

    const stripped = stripMarkdownSpeakerNotes(raw);
    expect(stripped).toContain("# Public Heading");
    expect(stripped).toContain("Visible paragraph.");
    expect(stripped).toContain("<!-- notes: Keep inside code block -->");
    expect(stripped).not.toContain("Secret speaker comment");
  });

  test("preserves fenced code languages across consecutive blocks, bare fences & complex inline formatting", () => {
    const complexMd = [
      "第一段：**Quiet-Complex 极端句** `<script>alert('xss')</script>` **& \"双引号\" 与 $10-$20 区间**。",
      "",
      "```",
      "plain untagged snippet",
      "```",
      "",
      "````markdown",
      "```inkade-pending",
      "id: nested_demo",
      "```",
      "````",
      "",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "",
      "```typescript",
      "export const checksum: number = 42;",
      "```",
    ].join("\n");

    const pkg = markdownToDocxFiles({
      title: "Complex DOCX Fidelity Test",
      markdown: complexMd,
    });
    const stylesXml = new TextDecoder().decode(pkg.files["word/styles.xml"]);
    expect(stylesXml).toContain('w:styleId="InkadeCode_typescript"');
    expect(stylesXml).toContain('w:name w:val="Code (typescript)"');

    const parsed = parseDocxPackageFiles(pkg.files, { filename: "complex.docx" });
    expect(parsed.title).toBe("Complex DOCX Fidelity Test");
    expect(parsed.markdown).toContain("`\nplain untagged snippet\n```".slice(1));
    expect(parsed.markdown).toContain("````markdown\n```inkade-pending\nid: nested_demo\n```\n````");
    expect(parsed.markdown).toContain("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(parsed.markdown).toContain("```typescript\nexport const checksum: number = 42;\n```");
    expect(parsed.markdown).toContain("`<script>alert('xss')</script>`");
    expect(parsed.markdown).toContain("**Quiet-Complex 极端句**");
  });
});
