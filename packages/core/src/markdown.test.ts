import { describe, expect, test } from "bun:test";
import {
  buildScaffoldMarkdown,
  extractExcerpt,
  extractInlineTags,
  extractPendingBlocks,
  extractToc,
  extractWikilinks,
  InkadeError,
  isValidDailyDate,
  markdownToPlainText,
  parseInkadePendingPayload,
  patchMarkdownSection,
  replacePendingBlock,
  slugifyTitle,
} from "./index.ts";

const SAMPLE_DOC = `# Inkade Research Report

Introductory paragraph with [[Core Architecture|core doc]] and #research/agents.

\`\`\`markdown
# Fake Heading Inside Code Block
This [[IgnoredLink]] and #ignored-tag should never be parsed.
\`\`\`

## Findings

Initial finding body with \`[[InlineCodeIgnored]]\`.

### Benchmarks

| Engine | License |
| --- | --- |
| Hono | MIT |

## Conclusion

Final notes referencing [[BB Plugin#Thread Sync]].
`;

describe("markdown AST utilities", () => {
  test("extractToc ignores fenced code headings and tracks hierarchical paths", () => {
    const toc = extractToc(SAMPLE_DOC);
    expect(toc.map((t) => ({ depth: t.depth, text: t.text, path: t.path }))).toEqual([
      { depth: 1, text: "Inkade Research Report", path: ["Inkade Research Report"] },
      { depth: 2, text: "Findings", path: ["Inkade Research Report", "Findings"] },
      {
        depth: 3,
        text: "Benchmarks",
        path: ["Inkade Research Report", "Findings", "Benchmarks"],
      },
      { depth: 2, text: "Conclusion", path: ["Inkade Research Report", "Conclusion"] },
    ]);
  });

  test("patchMarkdownSection surgically updates target section while keeping other sections untouched", () => {
    const replaced = patchMarkdownSection(
      SAMPLE_DOC,
      "Findings > Benchmarks",
      "replace",
      "Updated benchmark result: **1.2ms** latency.",
    );

    expect(replaced).toContain("### Benchmarks\n\nUpdated benchmark result: **1.2ms** latency.");
    expect(replaced).toContain("# Fake Heading Inside Code Block");
    expect(replaced).toContain("## Conclusion\n\nFinal notes referencing [[BB Plugin#Thread Sync]].");
    expect(replaced).not.toContain("| Hono | MIT |");

    const appended = patchMarkdownSection(
      SAMPLE_DOC,
      "Conclusion",
      "append",
      "Appended follow-up note.",
    );
    expect(appended).toContain(
      "Final notes referencing [[BB Plugin#Thread Sync]].\n\nAppended follow-up note.",
    );

    const prepended = patchMarkdownSection(
      SAMPLE_DOC,
      "Conclusion",
      "prepend",
      "TL;DR first.",
    );
    expect(prepended).toContain(
      "## Conclusion\n\nTL;DR first.\n\nFinal notes referencing [[BB Plugin#Thread Sync]].",
    );
  });

  test("patchMarkdownSection supports createIfMissing and throws SECTION_NOT_FOUND otherwise", () => {
    expect(() =>
      patchMarkdownSection(SAMPLE_DOC, "Nonexistent", "replace", "hello"),
    ).toThrow(InkadeError);

    const created = patchMarkdownSection(
      SAMPLE_DOC,
      ["Findings", "Next Steps"],
      "replace",
      "- Ship Phase 1",
      { createIfMissing: true },
    );
    expect(created).toContain("### Next Steps\n\n- Ship Phase 1");
    expect(created).toContain("## Conclusion");
  });

  test("extractWikilinks and extractInlineTags ignore code blocks and inline code", () => {
    const links = extractWikilinks(SAMPLE_DOC);
    expect(links.map((l) => ({ target: l.targetSlugOrTitle, anchor: l.anchorText, alias: l.alias }))).toEqual([
      { target: "Core Architecture", anchor: null, alias: "core doc" },
      { target: "BB Plugin", anchor: "Thread Sync", alias: null },
    ]);

    const tags = extractInlineTags(
      "Read https://example.com#section and #project/inkade plus #技术调研 inside prose.\n\n`#code-tag`",
    );
    expect(tags).toEqual(["project/inkade", "技术调研"]);
  });

  test("markdownToPlainText, extractExcerpt, slugifyTitle, and isValidDailyDate", () => {
    const plain = markdownToPlainText(
      "# Title\n\nSee [[Target Note|Alias]] and **bold**.\n\n- Item A\n- Item B\n\n| Col1 | Col2 |\n| --- | --- |\n| V1 | V2 |",
    );
    expect(plain).toBe("Title See Alias and bold. Item A Item B Col1 Col2 V1 V2");
    expect(extractExcerpt("Word ".repeat(80), 40).endsWith("…")).toBe(true);

    const viewMd = [
      "# Release Tracking",
      "",
      "```inkade-view",
      "mode: table",
      "spaceId: spc_research",
      "```",
      "",
      "Real prose referencing [[Orama Search Architecture]] and `inkade://pdf/doc_1#page=2&rect=1,2,3,4`.",
    ].join("\n");
    const viewExcerpt = extractExcerpt(viewMd, 95);
    expect(viewExcerpt).not.toContain("mode: table");
    expect(viewExcerpt).not.toContain("inkade://pdf");
    expect(viewExcerpt).not.toMatch(/\[\[[^\]]*$/);

    const calloutExcerpt = extractExcerpt("> [!NOTE]\n> Inkade keeps core logic neutral.", 80);
    expect(calloutExcerpt).toBe("Inkade keeps core logic neutral.");

    expect(slugifyTitle("Inkade Architecture v1")).toBe("inkade-architecture-v1");

    expect(isValidDailyDate("2026-11-24")).toBe(true);
    expect(isValidDailyDate("2026-02-30")).toBe(false);
    expect(isValidDailyDate("2026-13-01")).toBe(false);
    expect(isValidDailyDate("not-a-date")).toBe(false);
  });

  test("Phase 50: buildScaffoldMarkdown, extractPendingBlocks, and replacePendingBlock preserve AST integrity and reject deleted blocks", () => {
    const scaffold = buildScaffoldMarkdown({
      title: "Phase 50 Architecture Report",
      introMarkdown: "Initial framing summary.",
      bindingId: "bnd_01JXYZ99ABCD",
      sections: [
        {
          heading: "Executive Summary",
          initialMarkdown: "Already written upfront.",
        },
        {
          heading: "1. System Architecture",
          pendingId: "sec_arch_flow",
          pendingLabel: "Analyzing 10-port layering & SSE bus...",
        },
        {
          heading: "2. Benchmarks",
          level: 3,
          pendingLabel: "Step 2: Measure throughput & latency",
        },
        {
          heading: "2. Benchmarks",
          level: 3,
        },
      ],
    });

    expect(scaffold).toContain("# Phase 50 Architecture Report");
    expect(scaffold).toContain("Initial framing summary.");
    expect(scaffold).toContain("## Executive Summary\n\nAlready written upfront.");
    expect(scaffold).toContain("### 2. Benchmarks");

    const extracted = extractPendingBlocks(scaffold);
    expect(extracted).toHaveLength(3);
    expect(extracted[0]).toMatchObject({
      id: "sec_arch_flow",
      label: "Analyzing 10-port layering & SSE bus...",
      bindingId: "bnd_01JXYZ99ABCD",
      status: "generating",
    });
    expect(extracted[1]?.id).toBe("sec_2_benchmarks");
    expect(extracted[1]?.label).toBe("Step 2: Measure throughput & latency");
    expect(extracted[2]?.id).toBe("sec_2_benchmarks_2");

    // Extract ignores fake inkade-pending fences nested inside an outer code block
    const withFakeNestedFence = [
      scaffold,
      "",
      "````markdown",
      "```inkade-pending",
      "id: sec_fake_nested",
      "label: Should never be extracted or replaced",
      "status: generating",
      "```",
      "````",
      "",
    ].join("\n");

    const blocksWithNested = extractPendingBlocks(withFakeNestedFence);
    expect(blocksWithNested.map((b) => b.id)).toEqual([
      "sec_arch_flow",
      "sec_2_benchmarks",
      "sec_2_benchmarks_2",
    ]);

    // Replacing fake nested block ID must fail with PENDING_BLOCK_NOT_FOUND
    expect(replacePendingBlock(withFakeNestedFence, "sec_fake_nested", "Hacked")).toEqual({
      ok: false,
      reason: "PENDING_BLOCK_NOT_FOUND",
    });

    // Replace real pending block byte-for-byte cleanly while leaving fake nested fence untouched
    const replaced = replacePendingBlock(
      withFakeNestedFence,
      "sec_arch_flow",
      "Inkade maintains 10 narrow DB ports with SQL-level Scope Pushdown.",
    );
    expect(replaced.ok).toBe(true);
    if (replaced.ok) {
      expect(replaced.markdown).toContain(
        "## 1. System Architecture\n\nInkade maintains 10 narrow DB ports with SQL-level Scope Pushdown.",
      );
      expect(replaced.markdown).toContain("id: sec_fake_nested");
      expect(replaced.markdown).toContain("id: sec_2_benchmarks");
      expect(extractPendingBlocks(replaced.markdown).map((b) => b.id)).toEqual([
        "sec_2_benchmarks",
        "sec_2_benchmarks_2",
      ]);

      // Second attempt on already-replaced / human-deleted pending block returns PENDING_BLOCK_NOT_FOUND
      expect(replacePendingBlock(replaced.markdown, "sec_arch_flow", "Overwrite attempt")).toEqual({
        ok: false,
        reason: "PENDING_BLOCK_NOT_FOUND",
      });
    }

    // Empty replacement removes block cleanly without leaving excessive blank lines
    const removed = replacePendingBlock(scaffold, "sec_arch_flow", "");
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.markdown).not.toContain("sec_arch_flow");
      expect(removed.markdown).not.toContain("\n\n\n");
    }

    // Fallback parsing handles unquoted colon-space in label gracefully
    const fallbackParsed = parseInkadePendingPayload(
      "id: sec_colons\nlabel: Phase 1: Deep Dive: Core AST\nstatus: queued",
    );
    expect(fallbackParsed).toEqual({
      id: "sec_colons",
      label: "Phase 1: Deep Dive: Core AST",
      status: "queued",
    });
  });
});
