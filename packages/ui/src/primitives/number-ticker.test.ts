import { describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatTickerValue,
  interpolateTickerValue,
  NumberTicker,
} from "./number-ticker.tsx";

describe("number-ticker", () => {
  it("interpolates with cubic ease-out and decimal precision", () => {
    expect(interpolateTickerValue(0, 100, 0, 0)).toBe(0);
    expect(interpolateTickerValue(0, 100, 1, 0)).toBe(100);

    const mid = interpolateTickerValue(0, 100, 0.5, 0);
    expect(mid).toBe(88);

    const decimalMid = interpolateTickerValue(10, 20, 0.5, 2);
    expect(decimalMid).toBe(18.75);
  });

  it("formats values with prefix, suffix, and fixed decimals", () => {
    expect(formatTickerValue(1280, { locale: "en-US" })).toBe("1,280");
    expect(
      formatTickerValue(87.4, { decimals: 1, locale: "en-US", prefix: "$", suffix: "%" }),
    ).toBe("$87.4%");
    expect(formatTickerValue(Number.NaN)).toBe("0");
  });

  it("renders tabular-nums and aria-live=polite markup without 0-9 digit stack leakage", () => {
    const html = renderToStaticMarkup(
      React.createElement(NumberTicker, {
        value: 2048,
        locale: "en-US",
        suffix: " docs",
      }),
    );

    expect(html).toContain('data-slot="number-ticker"');
    expect(html).toContain('data-value="2048"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("tabular-nums");
    expect(html).toContain("2,048 docs");
    expect(html).not.toContain("0123456789");
  });

  it("never leaks stacked digits into light DOM textContent in odometer mode", async () => {
    const dom = new JSDOM("<!doctype html><body><div id='root'></div></body>");
    const prevGlobals = {
      window: globalThis.window,
      document: globalThis.document,
      HTMLElement: globalThis.HTMLElement,
      customElements: globalThis.customElements,
    };
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      customElements: dom.window.customElements,
    });
    try {
      const container = dom.window.document.getElementById("root");
      if (!container) throw new Error("Missing root container");
      const root = createRoot(container);
      flushSync(() => {
        root.render(
          React.createElement(NumberTicker, {
            value: 4,
            mode: "odometer",
          }),
        );
      });
      expect(container.textContent ?? "").not.toContain("0123456789");
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      Object.assign(globalThis, prevGlobals);
      dom.window.close();
    }
  });
});
