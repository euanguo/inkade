import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyButton } from "./copy-button.tsx";
import { clampPaneWidth, ResizeHandle } from "./resize-handle.tsx";
import { computeOpticalFadeOpacities, ScrollArea } from "./scroll-area.tsx";
import { Spinner } from "./spinner.tsx";

describe("resize-handle", () => {
  it("clamps pane widths within [minWidth, maxWidth] and handles non-finite inputs", () => {
    expect(clampPaneWidth(252, 200, 360)).toBe(252);
    expect(clampPaneWidth(120, 200, 360)).toBe(200);
    expect(clampPaneWidth(500, 200, 360)).toBe(360);
    expect(clampPaneWidth(252.6, 200, 360)).toBe(253);
    expect(clampPaneWidth(Number.NaN, 200, 360)).toBe(200);
    expect(clampPaneWidth(Number.POSITIVE_INFINITY, 200, 360)).toBe(200);
    expect(clampPaneWidth(100, 300, 200)).toBe(300);
  });

  it("renders accessible separator attributes on ResizeHandle", () => {
    const html = renderToStaticMarkup(
      React.createElement(ResizeHandle, {
        orientation: "vertical",
        onResizeDelta: () => {},
        onReset: () => {},
        ariaLabel: "Resize sidebar",
        valueNow: 252,
        valueMin: 200,
        valueMax: 360,
      }),
    );

    expect(html).toContain("role=\"separator\"");
    expect(html).toContain("aria-orientation=\"vertical\"");
    expect(html).toContain("aria-label=\"Resize sidebar\"");
    expect(html).toContain("aria-valuenow=\"252\"");
    expect(html).toContain("aria-valuemin=\"200\"");
    expect(html).toContain("aria-valuemax=\"360\"");
    expect(html).toContain("tabindex=\"0\"");
    expect(html).toContain("cursor-col-resize");
    expect(html).toContain("data-slot=\"resize-handle-grip\"");
    expect(html).not.toContain("shadow-[0_0_");

    const horizontalHtml = renderToStaticMarkup(
      React.createElement(ResizeHandle, {
        orientation: "horizontal",
        onResizeDelta: () => {},
        ariaLabel: "Resize row",
      }),
    );
    expect(horizontalHtml).toContain("cursor-row-resize");
    expect(horizontalHtml).toContain("data-slot=\"resize-handle-grip\"");
  });

  it("exposes data-scroll-fade & opticalFade on ScrollArea, layered CopyButton, and essential-pulse Spinner", () => {
    const scrollHtml = renderToStaticMarkup(
      React.createElement(ScrollArea, { scrollFade: true }, "Content"),
    );
    expect(scrollHtml).toContain("data-scroll-fade=\"true\"");

    const opticalHtml = renderToStaticMarkup(
      React.createElement(ScrollArea, { opticalFade: true, opticalFadeTone: "sidebar" }, "Content"),
    );
    expect(opticalHtml).toContain("data-optical-fade=\"true\"");
    expect(opticalHtml).toContain("data-slot=\"scroll-area-optical-fade-top\"");
    expect(opticalHtml).toContain("data-slot=\"scroll-area-optical-fade-bottom\"");
    expect(opticalHtml).toContain("backdrop-blur-[1px]");
    expect(opticalHtml).toContain("backdrop-blur-[4px]");

    expect(
      computeOpticalFadeOpacities({ scrollTop: 0, scrollHeight: 500, clientHeight: 200 }),
    ).toEqual({ top: 0, bottom: 1 });
    expect(
      computeOpticalFadeOpacities({ scrollTop: 12, scrollHeight: 500, clientHeight: 200 }),
    ).toEqual({ top: 0.5, bottom: 1 });
    expect(
      computeOpticalFadeOpacities({ scrollTop: 288, scrollHeight: 500, clientHeight: 200 }),
    ).toEqual({ top: 1, bottom: 0.5 });

    const copyHtml = renderToStaticMarkup(
      React.createElement(CopyButton, {
        value: "ink_secret",
        label: "Copy token",
        showLabel: true,
      }),
    );
    expect(copyHtml).toContain("data-slot=\"copy-button\"");
    expect(copyHtml).toContain("data-slot=\"copy-button-icon-stack\"");
    expect(copyHtml).toContain("blur-[2px]");
    expect(copyHtml).toContain("aria-label=\"Copy token\"");
    expect(copyHtml).toContain("Copy token");

    const spinnerHtml = renderToStaticMarkup(React.createElement(Spinner));
    expect(spinnerHtml).toContain("data-motion-essential=\"pulse\"");
    expect(spinnerHtml).toContain("data-slot=\"spinner\"");
  });
});
