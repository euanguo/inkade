import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeGlideRect, GlideHighlight } from "./glide-highlight.tsx";

describe("glide-highlight", () => {
  it("computes scroll-adjusted coordinates relative to container", () => {
    const rect = computeGlideRect(
      { top: 140, left: 60, width: 180, height: 32 },
      { top: 100, left: 20 },
      24,
      8,
    );

    expect(rect).toEqual({
      top: 64,
      left: 48,
      width: 180,
      height: 32,
    });
  });

  it("supports horizontal inset clamping to full container width minus insets", () => {
    const rect = computeGlideRect(
      { top: 130, left: 50, width: 120, height: 28 },
      { top: 100, left: 20 },
      0,
      0,
      8,
      240,
    );

    expect(rect).toEqual({
      top: 30,
      left: 8,
      width: 224,
      height: 28,
    });
  });

  it("normalizes scaled popup geometry back to unscaled coordinate space", () => {
    const scaleX = 0.97;
    const scaleY = 0.97;
    const rect = computeGlideRect(
      {
        top: 100 + 4 * scaleY,
        left: 20 + 4 * scaleX,
        width: 192 * scaleX,
        height: 28 * scaleY,
      },
      { top: 100, left: 20 },
      0,
      0,
      undefined,
      undefined,
      scaleX,
      scaleY,
    );

    expect(rect.top).toBeCloseTo(4, 6);
    expect(rect.left).toBeCloseTo(4, 6);
    expect(rect.width).toBeCloseTo(192, 6);
    expect(rect.height).toBeCloseTo(28, 6);
  });

  it("renders hidden glide plane and preserves child items on initial SSR", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        GlideHighlight,
        { mode: "pointer" },
        React.createElement("button", { type: "button", "data-glide-item": "" }, "Inbox"),
        React.createElement("button", { type: "button", "data-glide-item": "" }, "Daily"),
      ),
    );

    expect(html).toContain('data-slot="glide-highlight"');
    expect(html).toContain('data-glide-visible="false"');
    expect(html).toContain('data-slot="glide-highlight-plane"');
    expect(html).toContain("Inbox");
    expect(html).toContain("Daily");
  });
});
