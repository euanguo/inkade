import { describe, expect, test } from "bun:test";
import { buildFtsMatchQuery, rewriteWikilinksTitle, tokenizeForSearch } from "./index.ts";

describe("CJK search tokenization and query builder", () => {
  test("indexes Chinese unigrams, bigrams, and segmented words alongside Latin words", () => {
    const tokens = tokenizeForSearch("知识库架构设计 RAG Pipeline v2");
    expect(tokens).toContain("知");
    expect(tokens).toContain("识");
    expect(tokens).toContain("知识");
    expect(tokens).toContain("识库");
    expect(tokens).toContain("架构");
    expect(tokens).toContain("rag");
    expect(tokens).toContain("pipeline");
    expect(tokens).toContain("v2");
  });

  test("builds FTS5 MATCH queries for 1/2/3+ char CJK, mixed CJK+Latin, and English prefixes", () => {
    expect(buildFtsMatchQuery("知")).toBe('"知"');
    expect(buildFtsMatchQuery("知识")).toBe('"知识"');
    expect(buildFtsMatchQuery("知识库")).toBe('"知识" "识库"');
    expect(buildFtsMatchQuery("知识库检索")).toBe('"知识" "识库" "库检" "检索"');
    expect(buildFtsMatchQuery("RAG检索")).toBe('"rag"* "检索"');
    expect(buildFtsMatchQuery('C++ "foo-bar"')).toBe('"c"* "foo"* "bar"*');
    expect(buildFtsMatchQuery("   ")).toBeNull();
  });

  test("rewriteWikilinksTitle updates prose wikilinks while ignoring code blocks", () => {
    const input = [
      "# Notes",
      "",
      "Check [[Old Title]] and [[Old Title#overview|Overview Alias]] and [[old-title]].",
      "",
      "```md",
      "Keep [[Old Title]] inside code untouched.",
      "```",
      "",
      "Inline `[[Old Title]]` stays untouched.",
    ].join("\n");

    const res = rewriteWikilinksTitle(input, "Old Title", "old-title", "New Title");
    expect(res.changed).toBe(true);
    expect(res.markdown).toContain("Check [[New Title]] and [[New Title#overview|Overview Alias]] and [[New Title]].");
    expect(res.markdown).toContain("Keep [[Old Title]] inside code untouched.");
    expect(res.markdown).toContain("Inline `[[Old Title]]` stays untouched.");
  });
});
