import { describe, expect, test } from "bun:test";
import { computeRevisionDiff } from "./index.ts";

describe("computeRevisionDiff", () => {
  test("computes additions, deletions, hunks, and unifiedPatch", () => {
    const prev = "# Report\n\nLine 1\nLine 2\nLine 3\n";
    const next = "# Report\n\nLine 1\nLine 2 edited\nLine 3\nLine 4\n";

    const diff = computeRevisionDiff(prev, next, { filename: "report.md" });
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(1);
    expect(diff.hunks.length).toBe(1);
    expect(diff.unifiedPatch).toContain("-Line 2");
    expect(diff.unifiedPatch).toContain("+Line 2 edited");
    expect(diff.unifiedPatch).toContain("+Line 4");
  });
});
