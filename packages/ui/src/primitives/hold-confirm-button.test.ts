import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  advanceHoldProgress,
  ALMOST_READY_THRESHOLD,
  DEFAULT_HOLD_DURATION_MS,
  HoldConfirmButton,
} from "./hold-confirm-button.tsx";

describe("hold-confirm-button", () => {
  it("advances linear fill and smoothly drains back on early release", () => {
    expect(DEFAULT_HOLD_DURATION_MS).toBe(1500);
    expect(ALMOST_READY_THRESHOLD).toBe(0.85);

    const half = advanceHoldProgress(0, 750, 1500, "fill");
    expect(half).toBeCloseTo(0.5, 5);

    const almost = advanceHoldProgress(half, 600, 1500, "fill");
    expect(almost).toBeCloseTo(0.9, 5);
    expect(almost >= ALMOST_READY_THRESHOLD).toBe(true);

    const full = advanceHoldProgress(almost, 500, 1500, "fill");
    expect(full).toBe(1);

    const drained = advanceHoldProgress(0.6, 150, 1500, "drain");
    expect(drained).toBeLessThan(0.6);
    expect(drained).toBeGreaterThan(0);

    const drainedZero = advanceHoldProgress(0.1, 1000, 1500, "drain");
    expect(drainedZero).toBe(0);
  });

  it("renders restrained resting surface, 2px bottom rail, and accessible hold attributes", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        HoldConfirmButton,
        {
          onConfirm: () => {},
          holdDurationMs: 1500,
          size: "sm",
          "aria-label": "Delete token permanently",
        },
        "Delete permanently",
      ),
    );

    expect(html).toContain('data-slot="hold-confirm-button"');
    expect(html).toContain('data-slot="hold-confirm-progress"');
    expect(html).toContain('aria-label="Delete token permanently"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain("h-[2px]");
    expect(html).toContain("border-destructive/35");
    expect(html).toContain("Delete permanently");
    expect(html).not.toContain('data-almost-ready="true"');
  });
});
