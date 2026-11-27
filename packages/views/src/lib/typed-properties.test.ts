import { describe, expect, test } from "bun:test";
import {
  asDocumentId,
  asSpaceId,
  asWorkspaceId,
  extractSourceDomain,
  savedViewFilterSchema,
  type DocumentRecord,
} from "@inkade/core";
import { detectEditorTrigger } from "@inkade/ui";
import {
  extractDisplayProperties,
  getDocumentExcerpt,
  getPropertyPresets,
  sortDocuments,
  stripMarkdownSyntax,
} from "./typed-properties.ts";

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: asDocumentId("doc_1"),
    workspaceId: asWorkspaceId("ws_1"),
    spaceId: asSpaceId("spc_research"),
    kind: "article",
    title: "Default Title",
    slug: "default-title",
    dailyDate: null,
    contentMarkdown: "",
    contentJson: null,
    contentText: "",
    excerpt: "",
    tags: [],
    sourceUrl: undefined,
    sourceMeta: null,
    properties: null,
    version: 1,
    pinned: false,
    unreadAgentUpdate: false,
    lastEditedByType: "human",
    trashedAt: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("typed-properties", () => {
  test("returns strongly typed presets per document kind using i18n keys", () => {
    const clipPresets = getPropertyPresets("clip");
    expect(clipPresets.map((p) => p.key)).toEqual([
      "sourceUrl",
      "author",
      "publishedAt",
      "readStatus",
    ]);
    expect(clipPresets.every((p) => p.labelKey.startsWith("library.props."))).toBe(true);
    expect(clipPresets[0]?.valueType).toBe("url");

    const articlePresets = getPropertyPresets("article");
    expect(articlePresets.map((p) => p.key)).toEqual([
      "status",
      "wordGoal",
      "audience",
      "reviewedAt",
    ]);
    expect(articlePresets[1]?.valueType).toBe("number");

    const outlinePresets = getPropertyPresets("outline");
    expect(outlinePresets.map((p) => p.key)).toEqual([
      "owner",
      "cadence",
      "reviewedAt",
    ]);
  });

  test("extracts typed properties, source domain, and custom fields safely", () => {
    const clipDoc = makeDoc({
      kind: "clip",
      sourceUrl: "https://www.anthropic.com/research/building-effective-agents?ref=nav",
      properties: {
        author: "Erik Schluntz",
        publishedAt: "2026-11-18T14:30:00.000Z",
        readStatus: "reading",
        rating: 5,
        inboxArchived: true,
        ignoredObj: { nested: true },
        ignoredEmpty: "   ",
      },
    });

    const extracted = extractDisplayProperties(clipDoc);
    expect(extracted.sourceDomain).toBe("anthropic.com");
    expect(extracted.sourceUrl).toBe(
      "https://www.anthropic.com/research/building-effective-agents?ref=nav",
    );
    expect(extracted.primaryStatus).toBe("reading");
    expect(extracted.presetEntries.map((e) => [e.key, e.displayValue])).toEqual([
      ["sourceUrl", "anthropic.com"],
      ["author", "Erik Schluntz"],
      ["publishedAt", "2026-11-18"],
      ["readStatus", "reading"],
    ]);
    expect(extracted.customEntries.map((e) => [e.key, e.displayValue])).toEqual([
      ["rating", "5"],
    ]);
  });

  test("handles malformed, null, or array properties without throwing", () => {
    const malformedDoc = makeDoc({
      kind: "article",
      sourceUrl: "not-a-valid-url",
      properties: ["broken", "array"] as unknown as Record<string, unknown>,
    });

    const extracted = extractDisplayProperties(malformedDoc);
    expect(extracted.sourceDomain).toBeNull();
    expect(extracted.sourceUrl).toBeNull();
    expect(extracted.presetEntries).toEqual([]);
    expect(extracted.customEntries).toEqual([]);
    expect(extracted.primaryStatus).toBeNull();

    expect(extractSourceDomain("javascript:alert(1)")).toBeNull();
    expect(extractSourceDomain("https://docs.inkade.dev/guide")).toBe("docs.inkade.dev");
  });

  test("sorts documents across all supported fields and directions", () => {
    const docA = asDocumentId("doc_a");
    const docB = asDocumentId("doc_b");
    const docC = asDocumentId("doc_c");
    const spcA = asSpaceId("spc_a");
    const spcB = asSpaceId("spc_b");
    const spcC = asSpaceId("spc_c");
    const a = makeDoc({
      id: docA,
      title: "Bravo Spec",
      kind: "outline",
      spaceId: spcB,
      pinned: false,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
    });
    const b = makeDoc({
      id: docB,
      title: "alpha notes",
      kind: "article",
      spaceId: spcA,
      pinned: true,
      createdAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-08T00:00:00.000Z",
    });
    const c = makeDoc({
      id: docC,
      title: "Charlie Clip",
      kind: "clip",
      spaceId: spcC,
      pinned: false,
      createdAt: "2026-11-03T00:00:00.000Z",
      updatedAt: "2026-11-12T00:00:00.000Z",
    });

    expect(sortDocuments([a, b, c], "updatedAt", "desc").map((d) => d.id)).toEqual([
      docC,
      docA,
      docB,
    ]);
    expect(
      sortDocuments([a, b, c], "updatedAt", "desc", { pinnedFirst: true }).map((d) => d.id),
    ).toEqual([docB, docC, docA]);
    expect(sortDocuments([a, b, c], "title", "asc").map((d) => d.id)).toEqual([
      docB,
      docA,
      docC,
    ]);
    expect(sortDocuments([a, b, c], "createdAt", "asc").map((d) => d.id)).toEqual([
      docA,
      docC,
      docB,
    ]);
    expect(sortDocuments([a, b, c], "kind", "asc").map((d) => d.id)).toEqual([
      docB,
      docC,
      docA,
    ]);

    const spaceMap = new Map([
      [spcA, "Zeta"],
      [spcB, "Alpha"],
      [spcC, "Middle"],
    ]);
    expect(
      sortDocuments([a, b, c], "space", "asc", { spaceNameById: spaceMap }).map((d) => d.id),
    ).toEqual([docA, docC, docB]);
  });

  test("strips markdown syntax cleanly for plain-text card previews", () => {
    const md = [
      "# Phase 16 Spec",
      "",
      "> [!NOTE]",
      "> Check [[Architecture Guide|Arch]] and ![thumb](https://img.test/a.png) with **bold** `code`.",
      "",
      "- [ ] Verify $RRF(d)$ scoring and [Docs](https://example.com)",
    ].join("\n");

    const plain = stripMarkdownSyntax(md);
    expect(plain).toBe(
      "Phase 16 Spec Check Arch and thumb with bold code. Verify RRF(d) scoring and Docs",
    );
    expect(stripMarkdownSyntax("Title [!NOTE] Clean body after callout")).toBe(
      "Title Clean body after callout",
    );

    const excerpt = getDocumentExcerpt(
      makeDoc({
        excerpt: "",
        contentText: "",
        contentMarkdown: md,
      }),
      42,
    );
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(42);
    expect(excerpt).not.toContain("[[");
    expect(excerpt).not.toContain("**");

    const dedupedFromHeading = getDocumentExcerpt(
      makeDoc({
        title: "Welcome to Inkade",
        excerpt: "",
        contentText: "",
        contentMarkdown: "# Welcome to Inkade\n\nOrganize notes, tasks and AI threads.",
      }),
    );
    expect(dedupedFromHeading).toBe("Organize notes, tasks and AI threads.");

    const dedupedFromExcerpt = getDocumentExcerpt(
      makeDoc({
        title: "Welcome to Inkade",
        excerpt: "Welcome to Inkade: Welcome to Inkade Organize cleanly.",
        contentText: "",
        contentMarkdown: "",
      }),
    );
    expect(dedupedFromExcerpt).toBe("Organize cleanly.");
  });

  test("validates SavedViewFilter multi-view fields backward-compatibly", () => {
    expect(savedViewFilterSchema.parse({})).toEqual({});
    expect(
      savedViewFilterSchema.parse({
        spaceId: "spc_research",
        kind: "clip",
        pinnedOnly: true,
      }),
    ).toEqual({
      spaceId: asSpaceId("spc_research"),
      kind: "clip",
      pinnedOnly: true,
    });
    expect(
      savedViewFilterSchema.parse({
        viewMode: "grid",
        sortBy: "title",
        sortDir: "asc",
      }),
    ).toEqual({
      viewMode: "grid",
      sortBy: "title",
      sortDir: "asc",
    });
    expect(
      savedViewFilterSchema.safeParse({
        viewMode: "kanban",
      }).success,
    ).toBe(false);
  });

  test("detectEditorTrigger detects @ mentions while ignoring email addresses", () => {
    expect(detectEditorTrigger("讨论 @设计规范", 10)).toEqual({
      kind: "mention",
      query: "设计规范",
      rangeFrom: 5,
      rangeTo: 10,
    });
    expect(detectEditorTrigger("@", 1)).toEqual({
      kind: "mention",
      query: "",
      rangeFrom: 0,
      rangeTo: 1,
    });
    expect(detectEditorTrigger("contact user@example.com", 24)).toBeNull();
    expect(detectEditorTrigger("[[Design", 8)?.kind).toBe("wikilink");
    expect(detectEditorTrigger("((Heading", 9)?.kind).toBe("blockref");
    expect(detectEditorTrigger("/callout", 8)?.kind).toBe("slash");
  });

  test("stripMarkdownSyntax and getDocumentExcerpt drop fenced code blocks cleanly", () => {
    const md = [
      "Core Architecture Overview",
      "",
      "```mermaid",
      "flowchart LR",
      "A[Core] --> B[DB]",
      "```",
      "",
      "After diagram text with **bold** and `inline`.",
    ].join("\n");

    const stripped = stripMarkdownSyntax(md);
    expect(stripped).toContain("Core Architecture Overview");
    expect(stripped).toContain("After diagram text with bold and inline.");
    expect(stripped).not.toContain("flowchart LR");
    expect(stripped).not.toContain("mermaid");

    const unclosed = "Intro paragraph\n\n```ts\nconst hidden = true;";
    expect(stripMarkdownSyntax(unclosed)).toBe("Intro paragraph");

    const excerpt = getDocumentExcerpt(
      makeDoc({
        excerpt: "```mermaid\ngraph TD\nA-->B\n``` Summary line",
      }),
      80,
    );
    expect(excerpt).toBe("Summary line");

    expect(stripMarkdownSyntax("> [!NOTE] Inkade separates core domain contracts.")).toBe(
      "Inkade separates core domain contracts.",
    );
    expect(stripMarkdownSyntax("[!WARNING] Unsaved buffer warning")).toBe(
      "Unsaved buffer warning",
    );
  });
});
