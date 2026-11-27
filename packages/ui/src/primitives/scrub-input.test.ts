import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clampScrubValue, ScrubInput } from "./scrub-input.tsx";

describe("scrub-input", () => {
  it("snaps to step and clamps within [min, max]", () => {
    expect(clampScrubValue(Number.NaN, 10, 100, 1)).toBe(10);
    expect(clampScrubValue(2, 10, 100, 1)).toBe(10);
    expect(clampScrubValue(150, 10, 100, 1)).toBe(100);
    expect(clampScrubValue(23, 0, 100, 5)).toBe(25);
    expect(clampScrubValue(1.24, 0, 10, 0.1)).toBe(1.2);
  });

  it("renders slider handle, numeric field, suffix, and modified state", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScrubInput, {
        label: "W",
        ariaLabel: "Sidebar width",
        value: 276,
        min: 220,
        max: 380,
        step: 2,
        suffix: "px",
        modified: true,
        onChange: () => {},
      }),
    );

    expect(html).toContain('data-slot="scrub-input"');
    expect(html).toContain('data-modified="true"');
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-label="Sidebar width"');
    expect(html).toContain('aria-valuemin="220"');
    expect(html).toContain('aria-valuemax="380"');
    expect(html).toContain('aria-valuenow="276"');
    expect(html).toContain('value="276"');
    expect(html).toContain("px");
  });
});
