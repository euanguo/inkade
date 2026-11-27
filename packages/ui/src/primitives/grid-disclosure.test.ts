import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GridDisclosure } from "./grid-disclosure.tsx";

describe("grid-disclosure", () => {
  it("renders 0fr collapsed state with inert and aria-hidden when closed", () => {
    const html = renderToStaticMarkup(
      React.createElement(GridDisclosure, {
        open: false,
        children: React.createElement("div", null, "Hidden body"),
      }),
    );

    expect(html).toContain('data-slot="grid-disclosure"');
    expect(html).toContain('data-open="false"');
    expect(html).toContain("grid-template-rows:0fr");
    expect(html).toContain("opacity:0");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("inert");
    expect(html).toContain("Hidden body");
  });

  it("renders 1fr expanded state without inert when open", () => {
    const html = renderToStaticMarkup(
      React.createElement(GridDisclosure, {
        open: true,
        children: React.createElement("div", null, "Expanded body"),
      }),
    );

    expect(html).toContain('data-open="true"');
    expect(html).toContain("grid-template-rows:1fr");
    expect(html).toContain("opacity:1");
    expect(html).not.toContain('aria-hidden="true"');
    expect(html).not.toContain("inert");
    expect(html).toContain("Expanded body");
  });
});
