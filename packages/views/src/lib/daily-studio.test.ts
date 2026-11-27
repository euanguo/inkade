import { describe, expect, test } from "bun:test";
import {
  asDocumentId,
  asOutlineNodeId,
  asSpaceId,
  asThreadBindingId,
  asWorkspaceId,
  type DocumentId,
  type DocumentRecord,
  type OutlineNode,
  type OutlineNodeId,
} from "@inkade/core";
import {
  buildClonedSubtreeBatchOps,
  computeDeferTargetDate,
  computeDocumentReadingStats,
  extractDocumentHeadings,
  filterDocumentsCreatedOnDate,
  getDailyReviewedAt,
  getIsoWeekDays,
  isPendingAdeStatus,
  withDailyReviewedAt,
} from "./daily-studio.ts";

function makeDoc(overrides: Partial<DocumentRecord> & { readonly id: DocumentId }): DocumentRecord {
  return {
    workspaceId: asWorkspaceId("wks_1"),
    spaceId: asSpaceId("spc_1"),
    kind: "article",
    title: overrides.id,
    slug: overrides.id,
    dailyDate: null,
    contentMarkdown: "",
    contentJson: null,
    contentText: "",
    excerpt: "",
    tags: [],
    version: 1,
    pinned: false,
    unreadAgentUpdate: false,
    lastEditedByType: "human",
    trashedAt: null,
    createdAt: "2026-11-24T04:00:00.000Z",
    updatedAt: "2026-11-24T04:00:00.000Z",
    ...overrides,
  };
}

function makeOutlineNode(overrides: Partial<OutlineNode> & { readonly id: OutlineNodeId }): OutlineNode {
  return {
    documentId: asDocumentId("doc_daily"),
    parentNodeId: null,
    orderKey: "a0",
    contentMarkdown: overrides.id,
    contentText: overrides.id,
    noteMarkdown: "",
    noteText: "",
    checked: null,
    collapsed: false,
    authorType: "human",
    authorId: null,
    sourceBindingId: null,
    mirrorOfNodeId: null,
    rolledOverToDocId: null,
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("daily-studio helpers", () => {
  test("getIsoWeekDays computes Mon-Sun ribbon across mid-week, month rollover, and year rollover", () => {
    // 2026-11-24 is Tuesday -> Mon 2026-11-23 .. Sun 2026-11-29
    const midWeek = getIsoWeekDays("2026-11-24", "2026-11-24", "en-US");
    expect(midWeek).toHaveLength(7);
    expect(midWeek.map((d) => d.date)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(midWeek[0]?.weekdayShort).toBe("Mon");
    expect(midWeek[6]?.weekdayShort).toBe("Sun");
    expect(midWeek[1]?.isSelected).toBe(true);
    expect(midWeek[1]?.isToday).toBe(true);
    expect(midWeek[0]?.isSelected).toBe(false);

    // Month rollover: 2026-12-01 (Tuesday) -> starts Mon 2026-11-30
    const monthRoll = getIsoWeekDays("2026-12-01", "2026-11-24", "zh-CN");
    expect(monthRoll[0]?.date).toBe("2026-11-30");
    expect(monthRoll[1]?.date).toBe("2026-12-01");
    expect(monthRoll[6]?.date).toBe("2026-12-06");
    expect(monthRoll[0]?.dayOfMonth).toBe(30);
    expect(monthRoll[1]?.dayOfMonth).toBe(1);

    // Year rollover: 2025-01-01 (Wednesday) -> Mon 2024-12-30 .. Sun 2025-01-05
    const yearRoll = getIsoWeekDays("2025-01-01", "2025-01-01", "en-US");
    expect(yearRoll[0]?.date).toBe("2024-12-30");
    expect(yearRoll[2]?.date).toBe("2025-01-01");
    expect(yearRoll[6]?.date).toBe("2025-01-05");
  });

  test("computeDeferTargetDate computes tomorrow and next Monday from Mon, Fri, and Sun", () => {
    // Monday 2026-11-23
    expect(computeDeferTargetDate("2026-11-23", "tomorrow")).toBe("2026-11-24");
    expect(computeDeferTargetDate("2026-11-23", "next_monday")).toBe("2026-11-30");

    // Friday 2026-11-27
    expect(computeDeferTargetDate("2026-11-27", "tomorrow")).toBe("2026-11-28");
    expect(computeDeferTargetDate("2026-11-27", "next_monday")).toBe("2026-11-30");

    // Sunday 2026-11-29 -> tomorrow & next Monday are both 2026-11-30
    expect(computeDeferTargetDate("2026-11-29", "tomorrow")).toBe("2026-11-30");
    expect(computeDeferTargetDate("2026-11-29", "next_monday")).toBe("2026-11-30");

    // Year boundary rollover: 2026-12-31 (Thu)
    expect(computeDeferTargetDate("2026-12-31", "tomorrow")).toBe("2027-01-01");
    expect(computeDeferTargetDate("2026-12-31", "next_monday")).toBe("2027-01-04");
  });

  test("reviewedAt property helpers preserve unrelated document properties", () => {
    const initial = { customStatus: "active", priority: 2 };
    const reviewed = withDailyReviewedAt(initial, "2026-11-24T10:00:00.000Z");
    expect(reviewed).toEqual({
      customStatus: "active",
      priority: 2,
      reviewedAt: "2026-11-24T10:00:00.000Z",
    });
    expect(getDailyReviewedAt({ properties: reviewed })).toBe("2026-11-24T10:00:00.000Z");

    const cleared = withDailyReviewedAt(reviewed, null);
    expect(cleared).toEqual({
      customStatus: "active",
      priority: 2,
      reviewedAt: null,
    });
    expect(getDailyReviewedAt({ properties: cleared })).toBeNull();
  });

  test("filterDocumentsCreatedOnDate matches local date and excludes daily/trashed docs", () => {
    const targetDay = new Date(2026, 10, 24, 9, 30, 0);
    const prevDay = new Date(2026, 10, 23, 22, 0, 0);
    const docs: DocumentRecord[] = [
      makeDoc({ id: asDocumentId("doc_daily"), kind: "outline", dailyDate: "2026-11-24", createdAt: targetDay.toISOString() }),
      makeDoc({ id: asDocumentId("doc_art"), kind: "article", createdAt: targetDay.toISOString() }),
      makeDoc({ id: asDocumentId("doc_clip"), kind: "clip", createdAt: new Date(2026, 10, 24, 15, 0, 0).toISOString() }),
      makeDoc({ id: asDocumentId("doc_trashed"), kind: "article", trashedAt: targetDay.toISOString(), createdAt: targetDay.toISOString() }),
      makeDoc({ id: asDocumentId("doc_prev"), kind: "article", createdAt: prevDay.toISOString() }),
    ];

    const filtered = filterDocumentsCreatedOnDate(docs, "2026-11-24", asDocumentId("doc_daily"));
    expect(filtered.map((d) => d.id)).toEqual([
      asDocumentId("doc_clip"),
      asDocumentId("doc_art"),
    ]);
  });

  test("extractDocumentHeadings extracts H1-H3 slugs and strips duplicate leading H1 title", () => {
    const md = [
      "# Research Overview",
      "",
      "## Architecture Details",
      "",
      "### Concurrency Control",
      "",
      "#### Deep Detail Ignored",
      "",
      "## Summary",
    ].join("\n");

    const headings = extractDocumentHeadings(md, "Research Overview", 3);
    expect(headings.map((h) => ({ depth: h.depth, text: h.text, slug: h.slug }))).toEqual([
      { depth: 2, text: "Architecture Details", slug: "architecture-details" },
      { depth: 3, text: "Concurrency Control", slug: "concurrency-control" },
      { depth: 2, text: "Summary", slug: "summary" },
    ]);
  });

  test("computeDocumentReadingStats counts mixed CJK and English words and minutes", () => {
    expect(computeDocumentReadingStats("")).toEqual({
      wordCount: 0,
      charCount: 0,
      minutes: 0,
    });

    const sample = "# Title\n\n你好世界 hello world\n\n```ts\nconst ignored = 1;\n```";
    const stats = computeDocumentReadingStats(sample);
    // Title (1) + 你好世界 (4 CJK) + hello world (2) = 7 words
    expect(stats.wordCount).toBe(7);
    expect(stats.charCount).toBeGreaterThan(10);
    expect(stats.minutes).toBe(1);

    const longText = "word ".repeat(520);
    expect(computeDocumentReadingStats(longText).minutes).toBe(2);
  });

  test("buildClonedSubtreeBatchOps clones subtree hierarchy in order", () => {
    const rootId = asOutlineNodeId("n1");
    const root = makeOutlineNode({
      id: rootId,
      contentMarkdown: "Task 1",
      noteMarkdown: "Context note",
      checked: false,
      sourceBindingId: asThreadBindingId("bnd_keep_on_source_only"),
    });
    const child = makeOutlineNode({
      id: asOutlineNodeId("n1_1"),
      parentNodeId: rootId,
      orderKey: "a0",
      contentMarkdown: "Subtask",
      checked: false,
    });
    const deletedChild = makeOutlineNode({
      id: asOutlineNodeId("n1_2"),
      parentNodeId: rootId,
      orderKey: "a1",
      deletedAt: "2026-11-24T01:00:00.000Z",
    });

    const ops = buildClonedSubtreeBatchOps([root, child, deletedChild], root);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      op: "create",
      tempId: "defer_1",
      parentNodeId: null,
      contentMarkdown: "Task 1",
      noteMarkdown: "Context note",
      checked: false,
    });
    expect(ops[1]).toMatchObject({
      op: "create",
      tempId: "defer_2",
      parentNodeId: "defer_1",
      contentMarkdown: "Subtask",
      checked: false,
    });
    expect(isPendingAdeStatus("waiting_input")).toBe(true);
    expect(isPendingAdeStatus("failed")).toBe(true);
    expect(isPendingAdeStatus("completed")).toBe(false);
  });
});
