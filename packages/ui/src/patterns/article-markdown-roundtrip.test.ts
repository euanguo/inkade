import { describe, expect, it } from "bun:test";
import { splitMarkdownIntoSlides, stripLeadingDuplicateTitle } from "@inkade/core";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { InkadeCalloutExtension } from "../editor/extensions/callout.ts";
import { InkadeCodeBlockExtension } from "../editor/extensions/code-block.ts";
import { InkadeColumnExtension, InkadeColumnsExtension } from "../editor/extensions/columns.ts";
import { InkadeHighlightMark } from "../editor/extensions/highlight.ts";
import { InkadeImageExtension } from "../editor/extensions/image.ts";
import { InkadeInlineMathExtension, InkadeMathBlockExtension } from "../editor/extensions/math.ts";
import { InkadeSpeakerNoteExtension } from "../editor/extensions/speaker-note.ts";
import { InkadeToggleExtension } from "../editor/extensions/toggle.ts";
import { InkadeWikilinkExtension } from "../editor/extensions/wikilink.ts";
import {
  computeMentionDateCandidates,
  sanitizeSerializedMarkdown,
  scoreSlashCommand,
} from "../editor/markdown-utils.ts";
import { AdeThreadChipExtension } from "./ade-thread-chip-extension.tsx";
import { remarkInkadeHighlights } from "./remark-inkade-wikilinks.ts";

function createRoundtripManager(): MarkdownManager {
  return new MarkdownManager({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      InkadeImageExtension,
      InkadeCodeBlockExtension,
      InkadeCalloutExtension,
      InkadeToggleExtension,
      InkadeColumnsExtension,
      InkadeColumnExtension,
      InkadeMathBlockExtension,
      InkadeInlineMathExtension,
      InkadeSpeakerNoteExtension,
      AdeThreadChipExtension,
      InkadeWikilinkExtension,
      InkadeHighlightMark,
    ],
  });
}

describe("ArticleEditor Markdown roundtrip extensions", () => {
  it("preserves GFM callouts, display math, inline math, and wikilinks without spurious backslash escaping", () => {
    const manager = createRoundtripManager();

    const input = [
      "# Inkade Dual Engine",
      "",
      "> [!IMPORTANT]",
      "> Preserve **stable** `nodeId` integrity.",
      "",
      "Hybrid RRF formula:",
      "",
      "$$",
      "RRF(d) = \\sum_{r \\in R} \\frac{1}{60 + r(d)}",
      "$$",
      "",
      "Inline metric is $BM25_{zh} + \\cos(\\theta)$ and links to [[Welcome to Inkade]].",
    ].join("\n");

    const json = manager.parse(input);
    const roundtripped = manager.serialize(json);

    expect(roundtripped).toContain("> [!IMPORTANT]");
    expect(roundtripped).not.toContain("\\[!IMPORTANT\\]");
    expect(roundtripped).toContain("RRF(d) = \\sum_{r \\in R} \\frac{1}{60 + r(d)}");
    expect(roundtripped).not.toContain("\\\\sum");
    expect(roundtripped).not.toContain("\\_{r");
    expect(roundtripped).toContain("$BM25_{zh} + \\cos(\\theta)$");
    expect(roundtripped).toContain("[[Welcome to Inkade]]");
    expect(roundtripped).not.toContain("\\[\\[Welcome to Inkade\\]\\]");
  });

  it("preserves Toggle <details>, 2-Columns, Highlights, AdeThreadChip, Images, Code/Mermaid, and Tables losslessly", () => {
    const manager = createRoundtripManager();

    const input = [
      "<details>",
      "<summary>Architecture Notes</summary>",
      "",
      "Collapsed body with ==amber highlight== and <mark data-inkade-mark=\"true\" data-color=\"emerald\">emerald highlight</mark>.",
      "",
      "</details>",
      "",
      "<!-- inkade:columns -->",
      "",
      "Left column summary",
      "",
      "<!-- inkade:col -->",
      "",
      "Right column metrics",
      "",
      "<!-- /inkade:columns -->",
      "",
      "Track progress via [[ade:bind_42:bb|Refactor Editor]] and [[Design Doc]].",
      "",
      "![Architecture Diagram](https://example.com/arch.png)",
      "",
      "```mermaid",
      "flowchart LR",
      "  A[Input] --> B[Output]",
      "```",
      "",
      "| Engine | License |",
      "| --- | --- |",
      "| Tiptap v3 | MIT |",
    ].join("\n");

    const parsed1 = manager.parse(input);
    const out1 = manager.serialize(parsed1);

    // Ensure semantic node types actually parsed (not degraded to plain paragraphs)
    const serializedJson = JSON.stringify(parsed1);
    expect(serializedJson).toContain('"type":"inkadeToggle"');
    expect(serializedJson).toContain('"type":"inkadeColumns"');
    expect(serializedJson).toContain('"type":"adeThreadChip"');
    expect(serializedJson).toContain('"type":"inkadeWikilink"');
    expect(serializedJson).toContain('"type":"inkadeHighlight"');
    expect(serializedJson).toContain('"type":"image"');
    expect(serializedJson).toContain('"type":"codeBlock"');
    expect(serializedJson).toContain('"type":"table"');

    // Second pass stability (idempotent roundtrip)
    const parsed2 = manager.parse(out1);
    const out2 = manager.serialize(parsed2);

    expect(out1).toContain("<summary>Architecture Notes</summary>");
    expect(out1).toContain("==amber highlight==");
    expect(out1).toContain('<mark data-inkade-mark="true" data-color="emerald">emerald highlight</mark>');
    expect(out1).toContain("<!-- inkade:columns -->");
    expect(out1).toContain("<!-- inkade:col -->");
    expect(out1).toContain("[[ade:bind_42:bb|Refactor Editor]]");
    expect(out1).toContain("[[Design Doc]]");
    expect(out1).toContain("![Architecture Diagram](https://example.com/arch.png)");
    expect(out1).toContain("```mermaid");
    expect(out1).toMatch(/\|\s*Engine\s*\|\s*License\s*\|/);
    expect(out2).toBe(out1);
  });

  it("strips matching leading duplicate H1 title while preserving non-matching headings", () => {
    expect(stripLeadingDuplicateTitle("# Hello World\n\nBody text", "Hello World")).toBe("Body text");
    expect(stripLeadingDuplicateTitle("\n\n# hello world \n\nBody text", "Hello World")).toBe(
      "Body text",
    );
    expect(stripLeadingDuplicateTitle("# Different Heading\n\nBody text", "Hello World")).toBe(
      "# Different Heading\n\nBody text",
    );
  });

  it("parses :::columns fenced syntax alias into canonical two-column Markdown", () => {
    const manager = createRoundtripManager();
    const fenced = [
      ":::columns",
      ":::column",
      "Left pane content.",
      ":::",
      ":::column",
      "Right pane content.",
      ":::",
      ":::",
      "",
    ].join("\n");
    const serialized = manager.serialize(manager.parse(fenced));
    expect(serialized).toContain("<!-- inkade:columns -->");
    expect(serialized).toContain("Left pane content.");
    expect(serialized).toContain("<!-- inkade:col -->");
    expect(serialized).toContain("Right pane content.");
    expect(serialized).toContain("<!-- /inkade:columns -->");
  });

  it("preserves custom callout titles, multi-paragraph containers, and nested <details> toggles", () => {
    const manager = createRoundtripManager();
    const input = [
      "> [!TIP] Performance Tuning",
      "> First callout paragraph.",
      ">",
      "> Second callout paragraph.",
      "",
      "<details open>",
      "<summary>Outer Section</summary>",
      "",
      "Outer paragraph.",
      "",
      "<details>",
      "<summary>Inner Nested Details</summary>",
      "",
      "Inner body content.",
      "",
      "</details>",
      "",
      "</details>",
    ].join("\n");

    const parsed1 = manager.parse(input);
    const out1 = manager.serialize(parsed1);
    expect(out1).toContain("> [!TIP] Performance Tuning");
    expect(out1).toContain("First callout paragraph.");
    expect(out1).toContain("Second callout paragraph.");
    expect(out1).toContain("<summary>Outer Section</summary>");
    expect(out1).toContain("<summary>Inner Nested Details</summary>");
    expect(out1).toContain("Inner body content.");

    const out2 = manager.serialize(manager.parse(out1));
    expect(out2).toBe(out1);
  });

  it("preserves custom image widthPreset/align, escaped alt brackets, currency non-math, highlight bounds, and wikilink aliases", () => {
    const manager = createRoundtripManager();
    const input = [
      "<!-- inkade:image width=md align=left -->",
      "![Diagram [v2]](https://example.com/arch-v2.png)",
      "",
      "The license costs $5 to $10 per seat while inline math is $x^2 + y^2$.",
      "",
      "Keep == spaced == untouched, highlight ==focused phrase== cleanly, and link [[Target Doc|Display Alias]].",
    ].join("\n");

    const parsed = manager.parse(input);
    const jsonStr = JSON.stringify(parsed);
    const out = manager.serialize(parsed);

    expect(jsonStr).toContain('"widthPreset":"md"');
    expect(jsonStr).toContain('"align":"left"');
    expect(jsonStr).toContain('"alt":"Diagram [v2]"');
    expect(out).toContain("<!-- inkade:image width=md align=left -->");
    expect(out).toContain("![Diagram \\[v2\\]](https://example.com/arch-v2.png)");
    expect(out).toContain("$5 to $10");
    expect(out).toContain("$x^2 + y^2$");
    expect(out).not.toContain('"latex":"5 to "');
    expect(jsonStr).not.toContain('"marks":[{"type":"inkadeHighlight"}],"text":" spaced "');
    expect(out).toContain("== spaced ==");
    expect(out).toContain("==focused phrase==");
    expect(out).toContain("[[Target Doc|Display Alias]]");
    expect(manager.serialize(manager.parse(out))).toBe(out);
  });

  it("renders ==highlight== syntax cleanly via remarkInkadeHighlights while keeping spaced delimiters untouched", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Markdown,
        { remarkPlugins: [remarkGfm, remarkInkadeHighlights] },
        "这是 ==源码高亮语法== 示例，保留 == spaced == 原样。",
      ),
    );
    expect(html).toContain('<mark data-inkade-mark="true" data-color="amber">源码高亮语法</mark>');
    expect(html).toContain("== spaced ==");
  });

  it("unescapes &amp; in serialized headings/prose/links without corrupting code blocks or inline code", () => {
    const manager = createRoundtripManager();
    const rawInput = [
      "# R&D Architecture",
      "",
      "Support Q&A in prose and [docs](https://example.com/?a=1&b=2).",
      "",
      "Inline code keeps `x &amp; y` verbatim.",
      "",
      "```ts",
      "const raw = \"a &amp; b\";",
      "```",
    ].join("\n");

    const serialized = sanitizeSerializedMarkdown(manager.serialize(manager.parse(rawInput)));
    expect(serialized).toContain("# R&D Architecture");
    expect(serialized).toContain("Support Q&A in prose");
    expect(serialized).toContain("`x &amp; y`");
    expect(serialized).toContain('const raw = "a &amp; b";');
    expect(serialized).not.toContain("# R&amp;D");
    expect(serialized).not.toContain("Support Q&amp;A");
  });

  it("ranks slash commands so /col resolves Multi-Column ahead of Toggle collapse keyword", () => {
    const toggleCandidate = {
      id: "toggle",
      label: "Toggle 折叠块",
      description: "可展开/收起的折叠内容块",
      keywords: "toggle collapse details fold accordion",
    };
    const columnsCandidate = {
      id: "columns",
      label: "Multi-Column 双栏布局",
      description: "并排两栏内容排版",
      keywords: "columns layout grid split 2col",
    };
    expect(scoreSlashCommand(columnsCandidate, "col")).toBeGreaterThan(
      scoreSlashCommand(toggleCandidate, "col"),
    );
  });

  it("generates dynamic today, tomorrow, and next-Monday date candidates", () => {
    const friday = new Date(2026, 10, 27); // 2026-11-27 (Friday)
    const dates = computeMentionDateCandidates(friday);
    expect(dates.map((d) => [d.id, d.isoDate])).toEqual([
      ["date-today", "2026-11-27"],
      ["date-tomorrow", "2026-11-28"],
      ["date-next-monday", "2026-11-30"],
    ]);
  });

  it("preserves single-line and multi-line <!-- notes: ... --> speaker notes across TipTap parse/serialize roundtrips", () => {
    const manager = createRoundtripManager();
    const deck = [
      "# Executive Report",
      "",
      "Cover lead paragraph.",
      "",
      "<!-- notes: Open with key metrics and benchmark latency. -->",
      "",
      "---",
      "",
      "## Architecture Deep Dive",
      "",
      "Detail body.",
      "",
      "<!-- notes:",
      "Walk through dual-origin sandbox isolation.",
      "Emphasize zero cookie forwarding.",
      "-->",
      "",
      "```markdown",
      "<!-- notes: inside code fence should stay prose/code -->",
      "```",
    ].join("\n");

    const parsed = manager.parse(deck);
    const roundtripped = manager.serialize(parsed);

    expect(roundtripped).toContain("<!-- notes: Open with key metrics and benchmark latency. -->");
    expect(roundtripped).toContain("Walk through dual-origin sandbox isolation.");
    expect(roundtripped).toContain("Emphasize zero cookie forwarding.");
    expect(roundtripped).toContain("<!-- notes: inside code fence should stay prose/code -->");

    const slides = splitMarkdownIntoSlides(roundtripped, "Executive Report");
    expect(slides.slides).toHaveLength(2);
    expect(slides.slides[0]?.speakerNotes).toBe("Open with key metrics and benchmark latency.");
    expect(slides.slides[1]?.speakerNotes).toContain("Walk through dual-origin sandbox isolation.");
    expect(slides.slides[1]?.speakerNotes).not.toContain("inside code fence");
  });

  it("preserves longer backtick fences when serializing nested ``` code block examples", () => {
    const manager = createRoundtripManager();
    const docMd = [
      "Nested fence example:",
      "",
      "````markdown",
      "```inkade-pending",
      "id: nested_pending",
      "```",
      "",
      "```inkade-artifact",
      "id: nested_art",
      "title: Nested Demo",
      "```",
      "````",
    ].join("\n");

    const parsed = manager.parse(docMd);
    const serialized = manager.serialize(parsed);
    expect(serialized).toContain("````markdown");
    expect(serialized.trimEnd().endsWith("````")).toBe(true);

    const reparsed = manager.parse(`${serialized}\n`);
    const codeBlocks = (reparsed.content ?? []).filter((n) => n.type === "codeBlock");
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]?.attrs?.language).toBe("markdown");
  });
});
