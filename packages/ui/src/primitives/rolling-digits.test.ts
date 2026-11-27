import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NumberTicker, parseRollingValue, RollingDigits } from "./number-ticker.tsx";

describe("RollingDigits & NumberTicker odometer", () => {
  it("parses formatted numeric strings and leaves multi-part tokens plain", () => {
    expect(parseRollingValue("42%")).toEqual({
      prefix: "",
      number: 42,
      decimals: 0,
      useGrouping: false,
      suffix: "%",
    });
    expect(parseRollingValue("$1,280.50")).toEqual({
      prefix: "$",
      number: 1280.5,
      decimals: 2,
      useGrouping: true,
      suffix: "",
    });
    expect(parseRollingValue("04:12")).toBeNull();
  });

  it("renders NumberFlow shadow-isolated digits for RollingDigits without 0-9 DOM pollution", () => {
    const html = renderToStaticMarkup(
      React.createElement(RollingDigits, { value: "42%" }),
    );

    expect(html).toContain('data-slot="rolling-digits"');
    expect(html).toContain('data-value="42%"');
    expect(html).toContain("tabular-nums");
    expect(html).toContain("42%");
    expect(html).not.toContain("0123456789");
  });

  it("renders odometer mode in NumberTicker with clean formatted output", () => {
    const html = renderToStaticMarkup(
      React.createElement(NumberTicker, {
        value: 18,
        mode: "odometer",
        suffix: "items",
      }),
    );

    expect(html).toContain('data-mode="odometer"');
    expect(html).toContain('data-value="18"');
    expect(html).toContain("18items");
    expect(html).not.toContain("0123456789");
  });
});
