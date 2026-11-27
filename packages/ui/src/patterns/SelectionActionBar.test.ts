import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  computeSelectionAnchorRect,
  SelectionActionBar,
} from "./SelectionActionBar.tsx";

describe("SelectionActionBar", () => {
  it("anchors centered horizontally with edge clamping and supports above/below placement", () => {
    const below = computeSelectionAnchorRect(
      { left: 200, width: 100, top: 80, bottom: 120 },
      { top: 102, bottom: 120 },
      { left: 100, top: 40, width: 500, height: 600 },
      { placement: "below", offsetPx: 8 },
    );
    expect(below).toEqual({ x: 150, y: 88 });

    const aboveClamped = computeSelectionAnchorRect(
      { left: 95, width: 10, top: 80, bottom: 100 },
      { top: 80, bottom: 100 },
      { left: 100, top: 40, width: 500, height: 600 },
      { placement: "above", offsetPx: 10, minEdgePx: 16 },
    );
    expect(aboveClamped).toEqual({ x: 16, y: 30 });
  });

  it("renders morphing pill container and GridDisclosure drawer", () => {
    const html = renderToStaticMarkup(
      React.createElement(SelectionActionBar, {
        morphKey: "note",
        drawerOpen: true,
        drawer: React.createElement("form", null, "Note Drawer"),
        children: React.createElement("button", { type: "button" }, "Ask ADE"),
      }),
    );

    expect(html).toContain('data-slot="selection-action-bar"');
    expect(html).toContain('data-slot="selection-action-bar-pill"');
    expect(html).toContain("rounded-xl");
    expect(html).toContain("Ask ADE");
    expect(html).toContain('data-slot="grid-disclosure"');
    expect(html).toContain('data-open="true"');
    expect(html).toContain("Note Drawer");
  });

  it("supports explicit pill shape for reader selection bars", () => {
    const html = renderToStaticMarkup(
      React.createElement(SelectionActionBar, {
        morphKey: "reader",
        shape: "pill",
        children: React.createElement("button", { type: "button" }, "Highlight"),
      }),
    );
    expect(html).toContain("rounded-full px-1.5 py-1");
    expect(html).not.toContain("rounded-xl [&_button:not(.rounded-full)]:rounded-lg");
  });
});
