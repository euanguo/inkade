import { describe, expect, test } from "bun:test";
import {
  asDocumentId,
  asSpaceId,
  asWorkspaceId,
  buildDocumentExportFrontmatter,
  evaluateViewQueryOnDocuments,
  extractInkadeViewBlocks,
  importMarkdownWithFrontmatter,
  parseInkadeViewBlock,
  parseMarkdownWithFrontmatter,
  propertyFieldDefinitionSchema,
  savedViewFilterSchema,
  serializeInkadeViewBlock,
  serializeMarkdownWithFrontmatter,
  validatePropertiesAgainstSchema,
  viewQueryRequestSchema,
  type DocumentSummary,
  type PropertyFieldDefinition,
} from "./index.ts";

const BOOK_FIELDS: readonly PropertyFieldDefinition[] = [
  propertyFieldDefinitionSchema.parse({
    key: "status",
    label: "Reading Status",
    type: "select",
    options: [
      { value: "unread", label: "Unread", color: "slate" },
      { value: "reading", label: "Reading", color: "blue" },
      { value: "done", label: "Done", color: "emerald" },
    ],
    requiredByAgent: true,
  }),
  propertyFieldDefinitionSchema.parse({
    key: "rating",
    label: "Rating",
    type: "number",
    numberFormat: "plain",
    numberUnit: "/5",
  }),
  propertyFieldDefinitionSchema.parse({
    key: "topics",
    label: "Topics",
    type: "multi_select",
    options: [
      { value: "systems", label: "Systems", color: "indigo" },
      { value: "ai", label: "AI", color: "violet" },
    ],
  }),
  propertyFieldDefinitionSchema.parse({
    key: "finishedAt",
    label: "Finished At",
    type: "date",
  }),
  propertyFieldDefinitionSchema.parse({
    key: "published",
    label: "Published",
    type: "checkbox",
  }),
  propertyFieldDefinitionSchema.parse({
    key: "sourceUrl",
    label: "Source URL",
    type: "url",
  }),
  propertyFieldDefinitionSchema.parse({
    key: "relatedDoc",
    label: "Related Note",
    type: "relation_doc",
  }),
];

describe("Phase 42: property schema, frontmatter YAML & inkade-view engine", () => {
  test("losslessly parses and serializes YAML Frontmatter while preserving comments and key order", () => {
    const initialMd = `---
# Keep this comment
title: "Designing Data-Intensive Applications"
status: reading
rating: 4.5
tags:
  - systems
  - books
---

# Notes

Great chapter on consensus.
`;

    const parsed = parseMarkdownWithFrontmatter(initialMd);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.frontmatter.status).toBe("reading");
    expect(parsed.frontmatter.rating).toBe(4.5);
    expect(parsed.bodyMarkdown.trimStart()).toStartWith("# Notes");

    const serialized = serializeMarkdownWithFrontmatter({
      bodyMarkdown: parsed.bodyMarkdown,
      existingMarkdown: initialMd,
      frontmatter: {
        ...parsed.frontmatter,
        rating: 5,
        finishedAt: "2026-11-25",
      },
      keyOrder: ["title", "status", "rating", "finishedAt", "tags"],
    });

    expect(serialized).toContain("# Keep this comment");
    expect(serialized).toContain("rating: 5");
    expect(serialized).toContain("finishedAt: 2026-11-25");
    expect(serialized).toContain("# Notes");

    const imported = importMarkdownWithFrontmatter(serialized);
    expect(imported.title).toBe("Designing Data-Intensive Applications");
    expect(imported.tags).toEqual(["systems", "books"]);
    expect(imported.properties).toEqual({
      status: "reading",
      rating: 5,
      finishedAt: "2026-11-25",
    });
  });

  test("round-trips export frontmatter with schema fields and skips internal system keys", () => {
    const { frontmatter, keyOrder } = buildDocumentExportFrontmatter(
      {
        id: asDocumentId("doc_book1"),
        title: "Staff Engineer",
        kind: "article",
        slug: "staff-engineer",
        dailyDate: null,
        tags: ["leadership"],
        sourceUrl: "https://staffeng.com",
        properties: {
          rating: 5,
          status: "done",
          customNote: "Must reread",
          inboxArchived: true,
          systemRole: "ignored",
        },
        version: 3,
        createdAt: "2026-11-01T10:00:00.000Z",
        updatedAt: "2026-11-25T10:00:00.000Z",
      },
      "research/reading",
      BOOK_FIELDS,
    );

    const md = serializeMarkdownWithFrontmatter({
      bodyMarkdown: "Summary notes.",
      frontmatter,
      keyOrder,
    });
    expect(md).not.toContain("inboxArchived");
    expect(md).not.toContain("systemRole");

    const statusIdx = md.indexOf("status:");
    const ratingIdx = md.indexOf("rating:");
    const customIdx = md.indexOf("customNote:");
    expect(statusIdx).toBeGreaterThan(-1);
    expect(ratingIdx).toBeGreaterThan(statusIdx);
    expect(customIdx).toBeGreaterThan(ratingIdx);

    const reimported = importMarkdownWithFrontmatter(md);
    expect(reimported.title).toBe("Staff Engineer");
    expect(reimported.sourceUrl).toBe("https://staffeng.com");
    expect(reimported.properties).toEqual({
      status: "done",
      rating: 5,
      customNote: "Must reread",
    });
  });

  test("validates and coerces 8 field types against schema with agent hints", () => {
    const validRes = validatePropertiesAgainstSchema(
      {
        status: "Reading",
        rating: "4.8",
        topics: "systems, ai",
        finishedAt: "2026-11-25",
        published: "true",
        sourceUrl: "https://example.com/paper",
        relatedDoc: "doc_ref_1",
        extraFreeField: "preserved",
      },
      BOOK_FIELDS,
    );

    expect(validRes.valid).toBe(true);
    expect(validRes.errors).toEqual([]);
    expect(validRes.missingRequired).toEqual([]);
    expect(validRes.normalizedProperties).toEqual({
      status: "reading",
      rating: 4.8,
      topics: ["systems", "ai"],
      finishedAt: "2026-11-25",
      published: true,
      sourceUrl: "https://example.com/paper",
      relatedDoc: "doc_ref_1",
      extraFreeField: "preserved",
    });

    const invalidRes = validatePropertiesAgainstSchema(
      {
        rating: "not-a-number",
        sourceUrl: "not-a-url",
        finishedAt: "invalid-date",
      },
      BOOK_FIELDS,
    );
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.missingRequired).toEqual(["status"]);
    expect(invalidRes.errors.map((e) => e.key).sort()).toEqual([
      "finishedAt",
      "rating",
      "sourceUrl",
    ]);
  });

  test("parses, serializes, and evaluates ```inkade-view``` live query blocks", () => {
    const md = `# Reading Hub

\`\`\`inkade-view
mode: table
spaceId: spc_reading
filter: { status: "reading" }
columns: [title, rating, sourceUrl, updatedAt]
sort: { field: rating, dir: desc }
limit: 12
\`\`\`
`;
    const extracted = extractInkadeViewBlocks(md);
    expect(extracted).toHaveLength(1);
    const first = extracted[0]!;
    expect(first.parsed.ok).toBe(true);
    if (!first.parsed.ok) return;
    expect(first.parsed.spec.mode).toBe("table");
    expect(first.parsed.spec.spaceId).toBe(asSpaceId("spc_reading"));
    expect(first.parsed.spec.filter).toEqual({ status: "reading" });
    expect(first.parsed.spec.limit).toBe(12);

    const roundTripped = serializeInkadeViewBlock(first.parsed.spec);
    const reparsed = parseInkadeViewBlock(roundTripped);
    expect(reparsed.ok).toBe(true);

    const docs: DocumentSummary[] = [
      {
        id: asDocumentId("doc_1"),
        workspaceId: asWorkspaceId("ws_default"),
        spaceId: asSpaceId("spc_reading"),
        kind: "article",
        title: "Book A",
        slug: "book-a",
        dailyDate: null,
        excerpt: "Notes A",
        tags: ["eng"],
        properties: { status: "reading", rating: 4 },
        version: 1,
        pinned: false,
        unreadAgentUpdate: false,
        lastEditedByType: "human",
        trashedAt: null,
        createdAt: "2026-11-20T00:00:00.000Z",
        updatedAt: "2026-11-22T00:00:00.000Z",
      },
      {
        id: asDocumentId("doc_2"),
        workspaceId: asWorkspaceId("ws_default"),
        spaceId: asSpaceId("spc_reading"),
        kind: "article",
        title: "Book B",
        slug: "book-b",
        dailyDate: null,
        excerpt: "Notes B",
        tags: ["eng"],
        properties: { status: "reading", rating: 5 },
        version: 1,
        pinned: false,
        unreadAgentUpdate: false,
        lastEditedByType: "human",
        trashedAt: null,
        createdAt: "2026-11-21T00:00:00.000Z",
        updatedAt: "2026-11-23T00:00:00.000Z",
      },
      {
        id: asDocumentId("doc_3"),
        workspaceId: asWorkspaceId("ws_default"),
        spaceId: asSpaceId("spc_reading"),
        kind: "article",
        title: "Book C",
        slug: "book-c",
        dailyDate: null,
        excerpt: "Notes C",
        tags: [],
        properties: { status: "done", rating: 3 },
        version: 1,
        pinned: false,
        unreadAgentUpdate: false,
        lastEditedByType: "human",
        trashedAt: null,
        createdAt: "2026-11-21T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
      },
    ];

    const queryResult = evaluateViewQueryOnDocuments(
      docs,
      BOOK_FIELDS,
      viewQueryRequestSchema.parse(first.parsed.spec),
    );
    expect(queryResult.totalCount).toBe(2);
    expect(queryResult.documents.map((d) => d.id)).toEqual([
      asDocumentId("doc_2"),
      asDocumentId("doc_1"),
    ]);
    expect(queryResult.numericAggregates).toEqual([
      { field: "rating", count: 2, sum: 9, avg: 4.5 },
    ]);
  });

  test("SavedViewFilter accepts board mode while still rejecting legacy kanban string", () => {
    expect(savedViewFilterSchema.parse({ viewMode: "board" }).viewMode).toBe("board");
    expect(savedViewFilterSchema.safeParse({ viewMode: "kanban" }).success).toBe(false);
  });
});
