import { describe, expect, test } from "bun:test";
import { asDocumentId, asSpaceId } from "@inkade/core";
import {
  buildNestedTagTree,
  extractDetectedUrl,
  matchesDocumentSuperFilters,
  parseNaturalDateQuery,
  parseSuperCommandQuery,
  tagMatchesFilter,
} from "./super-command-parser.ts";

describe("super-command-parser", () => {
  test("parses structured #tag, space:, kind:, is:unread, and @waiting tokens", () => {
    const parsed = parseSuperCommandQuery(
      '#research/fts5 space:"Core Eng" kind:article is:unread @waiting sqlite ranking',
      "2026-11-24",
    );

    expect(parsed.tags).toEqual(["research/fts5"]);
    expect(parsed.spaceQuery).toBe("Core Eng");
    expect(parsed.kind).toBe("article");
    expect(parsed.unreadOnly).toBe(true);
    expect(parsed.waitingOnly).toBe(true);
    expect(parsed.textQuery).toBe("sqlite ranking");
    expect(parsed.naturalDate).toBeNull();
    expect(parsed.hasStructuredFilters).toBe(true);
  });

  test("deduplicates repeated #tags and ignores invalid kind values", () => {
    const parsed = parseSuperCommandQuery("#AI #ai kind:unknown #eng/ui hello", "2026-11-24");
    expect(parsed.tags).toEqual(["AI", "eng/ui"]);
    expect(parsed.kind).toBeNull();
    expect(parsed.textQuery).toBe("kind:unknown hello");
  });

  test("parses natural dates in English, Chinese, and explicit YYYY-MM-DD", () => {
    expect(parseNaturalDateQuery("today", "2026-11-24")).toEqual({
      date: "2026-11-24",
      kind: "today",
    });
    expect(parseNaturalDateQuery("今天", "2026-11-24")).toEqual({
      date: "2026-11-24",
      kind: "today",
    });
    expect(parseNaturalDateQuery("yesterday", "2026-11-24")).toEqual({
      date: "2026-11-23",
      kind: "yesterday",
    });
    expect(parseNaturalDateQuery("昨天", "2026-11-24")).toEqual({
      date: "2026-11-23",
      kind: "yesterday",
    });
    expect(parseNaturalDateQuery("tomorrow", "2026-11-24")).toEqual({
      date: "2026-11-25",
      kind: "tomorrow",
    });
    expect(parseNaturalDateQuery("明天", "2026-11-24")).toEqual({
      date: "2026-11-25",
      kind: "tomorrow",
    });
    expect(parseNaturalDateQuery("2026-11-30", "2026-11-24")).toEqual({
      date: "2026-11-30",
      kind: "explicit",
    });
    expect(parseNaturalDateQuery("2026-02-31", "2026-11-24")).toBeNull();
  });

  test("filters documents using combined structured tokens and nested tag prefix matching", () => {
    const spcResearch = asSpaceId("spc_research");
    const spcInbox = asSpaceId("spc_inbox");
    const docId1 = asDocumentId("doc_1");
    const docId2 = asDocumentId("doc_2");
    const ctx = {
      spaceNameById: new Map([
        [spcResearch, "Research"],
        [spcInbox, "Inbox"],
      ]),
      spaceSlugById: new Map([
        [spcResearch, "research"],
        [spcInbox, "inbox"],
      ]),
      waitingDocIds: new Set([docId1]),
    };

    const doc1 = {
      id: docId1,
      title: "SQLite FTS5 Bigram Notes",
      excerpt: "CJK tokenization details",
      kind: "article" as const,
      spaceId: spcResearch,
      tags: ["eng/search/fts5"],
      unreadAgentUpdate: true,
    };

    const doc2 = {
      id: docId2,
      title: "Random Web Clip",
      excerpt: "Something else",
      kind: "clip" as const,
      spaceId: spcInbox,
      tags: ["reading"],
      unreadAgentUpdate: false,
    };

    const parsed = parseSuperCommandQuery("#eng/search space:research kind:article is:unread @waiting bigram");
    expect(matchesDocumentSuperFilters(doc1, parsed, ctx)).toBe(true);
    expect(matchesDocumentSuperFilters(doc2, parsed, ctx)).toBe(false);
    expect(tagMatchesFilter("eng/search/fts5", "eng")).toBe(true);
    expect(tagMatchesFilter("english", "eng")).toBe(false);
  });

  test("builds Bear-style collapsible nested #a/b/c tag tree with aggregated counts", () => {
    const tree = buildNestedTagTree([
      { tag: "eng/frontend/react", count: 3 },
      { tag: "eng/backend", count: 2 },
      { tag: "eng", count: 1 },
      { tag: "research/ai", count: 4 },
      { tag: "#notes/", count: 2 },
    ]);

    expect(tree.map((n) => n.segment)).toEqual(["eng", "research", "notes"]);
    const eng = tree[0]!;
    expect(eng.fullPath).toBe("eng");
    expect(eng.directCount).toBe(1);
    expect(eng.totalCount).toBe(6);
    expect(eng.children.map((c) => `${c.segment}:${c.totalCount}`)).toEqual([
      "frontend:3",
      "backend:2",
    ]);
    expect(eng.children[0]!.children[0]!.fullPath).toBe("eng/frontend/react");
  });

  test("extracts valid http/https URLs from sourceUrl or pasted text", () => {
    expect(extractDetectedUrl("https://linear.app/now", "")).toBe("https://linear.app/now");
    expect(extractDetectedUrl("", "Read this: https://example.com/posts/abc?ref=1.")).toBe(
      "https://example.com/posts/abc?ref=1",
    );
    expect(extractDetectedUrl("", "Just a plain note without links")).toBeNull();
  });
});
