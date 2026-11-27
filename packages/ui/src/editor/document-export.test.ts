import { describe, expect, test } from "bun:test";
import {
  buildStandaloneDocumentHtml,
  renderExportMarkdownToHtml,
} from "./document-export.ts";

describe("Phase 33 — Standalone HTML Document Export", () => {
  test("renders Markdown headings, callouts, tasks, code fences and inline formats safely", () => {
    const html = renderExportMarkdownToHtml([
      "# Architecture <Review>",
      "",
      "> [!NOTE] Keep boundaries strict",
      "> Enforce server scope.",
      "",
      "- [x] Shipped AI proxy",
      "- [ ] Verify typography",
      "",
      "```ts",
      "const safe = '<script>alert(1)</script>';",
      "```",
    ].join("\n"));

    expect(html).toContain("<h1>Architecture &lt;Review&gt;</h1>");
    expect(html).toContain('class="inkade-callout" data-callout-type="note"');
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('type="checkbox" checked disabled');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  test("renders GFM tables, nested lists, highlights, wikilinks, and neutralizes raw HTML tags", () => {
    const html = renderExportMarkdownToHtml([
      "See [[Architecture Spec#Boundaries|Arch Spec]] and ==critical invariant==.",
      "",
      "| Layer | Rule |",
      "| --- | --- |",
      "| core | zero IO |",
      "",
      "- parent",
      "  - nested item",
      "",
      "Inline <script>evil()</script> stays literal.",
    ].join("\n"));

    expect(html).toContain('<span class="inkade-wikilink-pill">Arch Spec</span>');
    expect(html).toContain('<mark data-inkade-mark="true" data-color="amber">critical invariant</mark>');
    expect(html).toContain("<table>");
    expect(html).toContain("<td>zero IO</td>");
    expect(html).toContain("nested item");
    expect(html).not.toContain("<script>evil()</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("builds self-contained HTML preserving Sepia palette, typography, tags and pre-rendered body", () => {
    const fullHtml = buildStandaloneDocumentHtml({
      title: "Sepia Field Notes",
      paperMode: "sepia",
      theme: "light",
      font: "serif",
      fontSize: "lg",
      measure: "65ch",
      tags: ["design", "notes"],
      bodyHtml: '<div class="inkade-columns"><p>Left</p><p>Right</p></div>',
    });

    expect(fullHtml).toContain("<!DOCTYPE html>");
    expect(fullHtml).toContain('data-paper="sepia"');
    expect(fullHtml).toContain("--bg: #fbf8f1");
    expect(fullHtml).toContain("--measure: 65ch");
    expect(fullHtml).toContain("--font-size: 18px");
    expect(fullHtml).toContain("#design");
    expect(fullHtml).toContain('class="inkade-columns"');
  });
});
