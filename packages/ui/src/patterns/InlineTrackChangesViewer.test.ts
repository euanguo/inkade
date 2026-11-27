import { describe, expect, it } from "bun:test";
import {
  buildInlineReviewModel,
  computeWordDiffTokens,
  reconstructMarkdownFromSuggestions,
} from "./track-changes/diff-model.ts";
import {
  applyHunkDecisionWithHistory,
  findNextReviewHunkIndex,
  type ReviewSessionState,
  undoLastHunkDecision,
} from "./track-changes/review-session.ts";

describe("InlineTrackChangesViewer helpers", () => {
  it("computes word-level inline diff tokens for English and CJK text", () => {
    const tokens = computeWordDiffTokens(
      "Inkade supports fast search.",
      "Inkade supports CJK FTS5 search.",
    );
    expect(tokens.some((t) => t.kind === "delete" && t.text.includes("fast"))).toBe(true);
    const insertedText = tokens
      .filter((t) => t.kind === "insert")
      .map((t) => t.text)
      .join("");
    expect(insertedText).toContain("CJK");
    expect(insertedText).toContain("FTS5");

    const cjkTokens = computeWordDiffTokens("旧版本摘要", "新版本摘要");
    expect(cjkTokens.some((t) => t.kind === "delete" && t.text === "旧")).toBe(true);
    expect(cjkTokens.some((t) => t.kind === "insert" && t.text === "新")).toBe(true);
    expect(cjkTokens.some((t) => t.kind === "equal" && t.text.includes("版本摘要"))).toBe(true);
  });

  it("splits markdown into unchanged segments and suggestion hunks", () => {
    const oldMd = ["# Title", "", "Paragraph one.", "", "Paragraph two."].join("\n");
    const newMd = ["# Title", "", "Paragraph one updated.", "", "Paragraph two.", "", "Added line."].join(
      "\n",
    );

    const model = buildInlineReviewModel(oldMd, newMd);
    expect(model.hunks).toHaveLength(2);
    expect(model.hunks[0]?.oldText).toBe("Paragraph one.");
    expect(model.hunks[0]?.newText).toBe("Paragraph one updated.");
    expect(model.hunks[1]?.oldText).toBe("");
    expect(model.hunks[1]?.newText.trim()).toBe("Added line.");
  });

  it("reconstructs exact markdown when accepting and rejecting hunks selectively", () => {
    const oldMd = ["# Title", "", "Keep or change A", "", "Keep or change B"].join("\n");
    const newMd = ["# Title", "", "Changed A", "", "Changed B"].join("\n");

    const model = buildInlineReviewModel(oldMd, newMd);
    expect(model.hunks).toHaveLength(2);

    const acceptedFirstRejectedSecond = reconstructMarkdownFromSuggestions(model.segments, {
      "hunk-1": "accepted",
      "hunk-2": "rejected",
    });
    expect(acceptedFirstRejectedSecond).toBe(
      ["# Title", "", "Changed A", "", "Keep or change B"].join("\n"),
    );

    const rejectedBoth = reconstructMarkdownFromSuggestions(model.segments, {
      "hunk-1": "rejected",
      "hunk-2": "rejected",
    });
    expect(rejectedBoth).toBe(oldMd);
  });

  it("keeps callout headers together with modified bodies and avoids cross-block delimiter stitching", () => {
    const oldMd = [
      "# Title",
      "",
      "> [!IMPORTANT]",
      "> Legacy note body.",
      "",
      "## Hybrid Search Model",
    ].join("\n");
    const newMd = [
      "# Title",
      "",
      "> [!IMPORTANT]",
      "> Updated note body.",
      "",
      "> [!TIP]",
      "> New callout block.",
      "",
      "## Hybrid Search Model (RRF)",
    ].join("\n");

    const model = buildInlineReviewModel(oldMd, newMd);
    expect(model.segments.some((s) => s.type === "unchanged" && s.text.endsWith("> [!IMPORTANT]"))).toBe(
      false,
    );
    const secondHunk = model.hunks[1];
    expect(secondHunk).toBeDefined();
    // Ensure `[!TIP]` block is not inserted between `##` and `Hybrid Search Model`
    const headingEqualToken = secondHunk?.tokens.find(
      (t) => t.kind === "equal" && t.text.includes("Hybrid Search Model"),
    );
    expect(headingEqualToken?.text).toContain("## Hybrid Search Model");

    expect(
      reconstructMarkdownFromSuggestions(
        model.segments,
        Object.fromEntries(model.hunks.map((h) => [h.id, "rejected" as const])),
      ),
    ).toBe(oldMd);
    expect(
      reconstructMarkdownFromSuggestions(
        model.segments,
        Object.fromEntries(model.hunks.map((h) => [h.id, "accepted" as const])),
      ),
    ).toBe(newMd);
  });

  it("aligns modified headings across blank lines even when a new callout block is inserted right above", () => {
    const oldMd = [
      "# 研究",
      "",
      "## 混合检索融合模型",
      "",
      "使用分词加 Bigram 实现精排：",
    ].join("\n");
    const newMd = [
      "# 研究",
      "",
      "> [!TIP]",
      "> 新增 ADR-009 提示。",
      "",
      "## 混合检索融合模型（Hybrid RRF）",
      "",
      "使用分词加 Bigram 配合向量实现精排（默认 k=60）：",
    ].join("\n");

    const model = buildInlineReviewModel(oldMd, newMd);
    const matchingHunk = model.hunks.find(
      (h) => h.oldText === "## 混合检索融合模型" && h.newText.includes("Hybrid RRF"),
    );
    expect(matchingHunk).toBeDefined();
    expect(matchingHunk?.tokens.some((tok) => tok.kind === "insert" && tok.text.includes("> [!TIP]"))).toBe(
      true,
    );
    expect(
      matchingHunk?.tokens.some(
        (tok) => tok.kind === "equal" && tok.text.includes("## 混合检索融合模型"),
      ),
    ).toBe(true);
    expect(
      reconstructMarkdownFromSuggestions(
        model.segments,
        Object.fromEntries(model.hunks.map((h) => [h.id, "rejected" as const])),
      ),
    ).toBe(oldMd);
    expect(
      reconstructMarkdownFromSuggestions(
        model.segments,
        Object.fromEntries(model.hunks.map((h) => [h.id, "accepted" as const])),
      ),
    ).toBe(newMd);
  });

  it("supports keyboard J/K navigation, Y/N decision advance, and Z undo across hunks", () => {
    const hunks = [{ id: "hunk-1" }, { id: "hunk-2" }, { id: "hunk-3" }] as const;
    let state: ReviewSessionState = {
      decisions: {},
      activeIndex: 0,
      history: [],
    };

    // J moves forward to hunk-2 (index 1); K moves back to hunk-1 (index 0)
    expect(findNextReviewHunkIndex(hunks, state.decisions, 0, 1)).toBe(1);
    expect(findNextReviewHunkIndex(hunks, state.decisions, 1, -1)).toBe(0);

    // Y accepts hunk-1 and advances to hunk-2
    state = applyHunkDecisionWithHistory(state, "hunk-1", 0, "accepted", hunks);
    expect(state.decisions["hunk-1"]).toBe("accepted");
    expect(state.activeIndex).toBe(1);

    // N rejects hunk-2 and advances to hunk-3
    state = applyHunkDecisionWithHistory(state, "hunk-2", 1, "rejected", hunks);
    expect(state.decisions["hunk-2"]).toBe("rejected");
    expect(state.activeIndex).toBe(2);

    // Z undoes hunk-2 decision and restores focus back to index 1
    state = undoLastHunkDecision(state);
    expect(state.decisions["hunk-2"]).toBeUndefined();
    expect(state.activeIndex).toBe(1);

    // Z undoes hunk-1 decision and restores focus back to index 0
    state = undoLastHunkDecision(state);
    expect(state.decisions["hunk-1"]).toBeUndefined();
    expect(state.activeIndex).toBe(0);
  });

  it("preserves single blank-line deletions/insertions and supports batch undo after acceptAll/rejectAll", () => {
    const oldBlank = "First line\n\nSecond line";
    const newCollapsed = "First line\nSecond line";

    const blankDelModel = buildInlineReviewModel(oldBlank, newCollapsed);
    expect(
      reconstructMarkdownFromSuggestions(blankDelModel.segments, { "hunk-1": "rejected" }),
    ).toBe(oldBlank);
    expect(
      reconstructMarkdownFromSuggestions(blankDelModel.segments, { "hunk-1": "accepted" }),
    ).toBe(newCollapsed);

    const blankInsModel = buildInlineReviewModel(newCollapsed, oldBlank);
    expect(
      reconstructMarkdownFromSuggestions(blankInsModel.segments, { "hunk-1": "rejected" }),
    ).toBe(newCollapsed);
    expect(
      reconstructMarkdownFromSuggestions(blankInsModel.segments, { "hunk-1": "accepted" }),
    ).toBe(oldBlank);

    const batchUndoState: ReviewSessionState = {
      decisions: { "hunk-1": "accepted", "hunk-2": "accepted" },
      activeIndex: 1,
      history: [
        {
          hunkId: "hunk-1",
          prevDecision: "rejected",
          prevIndex: 0,
          changes: [
            { hunkId: "hunk-1", prevDecision: "rejected" },
            { hunkId: "hunk-2", prevDecision: "pending" },
          ],
        },
      ],
    };
    const undone = undoLastHunkDecision(batchUndoState);
    expect(undone.decisions["hunk-1"]).toBe("rejected");
    expect(undone.decisions["hunk-2"]).toBeUndefined();
    expect(undone.activeIndex).toBe(0);
  });
});
