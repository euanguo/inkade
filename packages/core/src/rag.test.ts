import { describe, expect, test } from "bun:test";
import {
  computeLocalTextEmbedding,
  computeRrfFusion,
  cosineSimilarity,
  hashTextForEmbedding,
} from "./rag.ts";

describe("packages/core rag utilities", () => {
  test("cosineSimilarity handles identical, orthogonal, mismatched, and zero vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  test("computeLocalTextEmbedding is deterministic, normalized, and captures CJK & Latin overlap", () => {
    const v1 = computeLocalTextEmbedding("Inkade 语义检索与向量融合 RRF", 128);
    const v1Repeat = computeLocalTextEmbedding("Inkade 语义检索与向量融合 RRF", 128);
    const vRelated = computeLocalTextEmbedding("语义检索 RRF 算法与 Inkade 文档", 128);
    const vUnrelated = computeLocalTextEmbedding("香蕉苹果橘子超市购物清单", 128);

    expect(v1).toHaveLength(128);
    expect(v1).toEqual(v1Repeat);

    const norm = Math.sqrt(v1.reduce((acc, x) => acc + x * x, 0));
    expect(norm).toBeCloseTo(1, 4);

    const simRelated = cosineSimilarity(v1, vRelated);
    const simUnrelated = cosineSimilarity(v1, vUnrelated);
    expect(simRelated).toBeGreaterThan(simUnrelated);
    expect(simRelated).toBeGreaterThan(0.3);

    expect(computeLocalTextEmbedding("   ", 64).every((n) => n === 0)).toBe(true);
    expect(hashTextForEmbedding("abc")).toBe(hashTextForEmbedding("abc"));
    expect(hashTextForEmbedding("abc")).not.toBe(hashTextForEmbedding("abd"));
  });

  test("computeRrfFusion merges multiple ranked lists with k=60", () => {
    const ftsHits = [
      { key: "doc_a", item: { title: "Doc A" } },
      { key: "doc_b", item: { title: "Doc B" } },
      { key: "doc_c", item: { title: "Doc C" } },
    ];
    const vecHits = [
      { key: "doc_b", item: { title: "Doc B" } },
      { key: "doc_d", item: { title: "Doc D" } },
      { key: "doc_a", item: { title: "Doc A" } },
    ];

    const fused = computeRrfFusion([ftsHits, vecHits], { k: 60 });
    expect(fused.map((f) => f.key)).toEqual(["doc_b", "doc_a", "doc_d", "doc_c"]);

    const docB = fused.find((f) => f.key === "doc_b");
    expect(docB?.score).toBeCloseTo(1 / 62 + 1 / 61, 8);
    expect(docB?.ranks).toEqual([2, 1]);

    const docA = fused.find((f) => f.key === "doc_a");
    expect(docA?.score).toBeCloseTo(1 / 61 + 1 / 63, 8);
    expect(docA?.ranks).toEqual([1, 3]);
  });
});
