import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeVisibleTagCount, TagList } from "./tag-list.tsx";

describe("tag-list", () => {
  it("fits tags within available width and collapses overflow while reserving +N width", () => {
    expect(computeVisibleTagCount([], 200, 28)).toBe(0);
    expect(computeVisibleTagCount([60, 60, 60], 0, 28)).toBe(3);
    // 60 + 4 + 60 = 124 (all 2 fit without +N), 3rd item would need 124 + 4 + 60 = 188;
    // with only 170px, item #2 + gap + overflow(28) = 124 + 4 + 28 = 156 <= 170 -> 2 visible
    expect(computeVisibleTagCount([60, 60, 60], 170, 28, 4, 1)).toBe(2);
    // Always shows at least minVisible
    expect(computeVisibleTagCount([120, 80], 100, 28, 4, 1)).toBe(1);
  });

  it("renders fallback when empty and respects custom overflow formatter", () => {
    const emptyHtml = renderToStaticMarkup(
      React.createElement(TagList, {
        tags: [],
        emptyFallback: React.createElement("span", null, "No tags"),
      }),
    );
    expect(emptyHtml).toContain("No tags");

    const overflowHtml = renderToStaticMarkup(
      React.createElement(TagList, {
        tags: ["alpha", "beta", "gamma", "delta"],
        maxFallbackVisible: 2,
        formatOverflow: (count) => `${count} more`,
      }),
    );

    expect(overflowHtml).toContain('data-slot="tag-list"');
    expect(overflowHtml).toContain('data-slot="tag-list-overflow"');
    expect(overflowHtml).toContain(">alpha<");
    expect(overflowHtml).toContain(">beta<");
    expect(overflowHtml).toContain("2 more");
  });

  it("renders secondary overflow badge parity and makes single remaining tag shrinkable so +N is never clipped", () => {
    const singleOverflowHtml = renderToStaticMarkup(
      React.createElement(TagList, {
        tags: ["very-long-design-system-tag", "second-tag"],
        maxFallbackVisible: 1,
      }),
    );

    expect(singleOverflowHtml).toContain('data-slot="tag-list-overflow"');
    expect(singleOverflowHtml).toContain("bg-muted/65");
    expect(singleOverflowHtml).not.toContain("border-input");

    const tagPillMatches = [
      ...singleOverflowHtml.matchAll(/class="([^"]+)"[^>]*data-slot="tag-pill"/g),
    ];
    expect(tagPillMatches.length).toBeGreaterThanOrEqual(2);
    const livePillClass = tagPillMatches.at(-1)?.[1] ?? "";
    expect(livePillClass).toContain("min-w-0");
    expect(livePillClass.split(/\s+/)).toContain("shrink");
    expect(livePillClass.split(/\s+/)).not.toContain("shrink-0");

    const overflowMatch = singleOverflowHtml.match(
      /class="([^"]+)"[^>]*data-slot="tag-list-overflow"/,
    );
    expect(overflowMatch).toBeTruthy();
    expect(overflowMatch?.[1]?.split(/\s+/)).toContain("shrink-0");
  });
});
