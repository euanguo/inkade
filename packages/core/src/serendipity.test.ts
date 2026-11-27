import { describe, expect, it } from "bun:test";
import { asDocumentId } from "./ids.ts";
import {
  type SerendipityDocCandidate,
  pickDailySerendipityDocs,
} from "./serendipity.ts";

function makeDoc(
  id: string,
  overrides: Partial<SerendipityDocCandidate> = {},
): SerendipityDocCandidate {
  return {
    id: asDocumentId(id),
    title: `Doc ${id}`,
    kind: "article",
    tags: [],
    excerpt: "Sufficient body excerpt text for serendipity review matching cleanly.",
    contentText: "Sufficient body content text for serendipity review matching cleanly.",
    pinned: false,
    trashedAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
    dailyDate: null,
    ...overrides,
  };
}

describe("pickDailySerendipityDocs", () => {
  it("excludes trashed, today daily, and empty documents", () => {
    const docs = [
      makeDoc("trashed", { trashedAt: "2026-11-20T00:00:00.000Z" }),
      makeDoc("today", { kind: "outline", dailyDate: "2026-11-24" }),
      makeDoc("empty", { excerpt: "short", contentText: "tiny" }),
      makeDoc("excluded"),
      makeDoc("eligible", { pinned: true }),
    ];

    const picks = pickDailySerendipityDocs(docs, {
      dateKey: "2026-11-24",
      excludeIds: new Set(["excluded"]),
    });

    expect(picks.map((p) => p.doc.id)).toEqual([asDocumentId("eligible")]);
    expect(picks[0]?.reason).toBe("pinned");
  });

  it("produces deterministic results per dateKey and rotates on seedOffset", () => {
    const docs = Array.from({ length: 10 }, (_, idx) =>
      makeDoc(`doc-${idx}`, {
        updatedAt: idx % 2 === 0 ? "2026-10-01T00:00:00.000Z" : "2026-11-23T00:00:00.000Z",
        tags: idx % 3 === 0 ? ["research"] : [],
      }),
    );

    const firstA = pickDailySerendipityDocs(docs, { dateKey: "2026-11-24", limit: 3 });
    const firstB = pickDailySerendipityDocs(docs, { dateKey: "2026-11-24", limit: 3 });
    expect(firstA.map((p) => p.doc.id)).toEqual(firstB.map((p) => p.doc.id));

    const shuffled = pickDailySerendipityDocs(docs, {
      dateKey: "2026-11-24",
      seedOffset: 7,
      limit: 3,
    });
    expect(shuffled).toHaveLength(3);
    expect(shuffled.map((p) => p.doc.id)).not.toEqual(firstA.map((p) => p.doc.id));
  });
});
