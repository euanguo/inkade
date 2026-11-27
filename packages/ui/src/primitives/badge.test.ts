import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge, badgeVariants } from "./badge.tsx";

describe("badge", () => {
  it("uses unified rounded-md radius and smooth height steps across sm, default, and lg", () => {
    const smHtml = renderToStaticMarkup(
      React.createElement(Badge, { size: "sm" }, "Admin"),
    );
    const defaultHtml = renderToStaticMarkup(
      React.createElement(Badge, null, "Workspace"),
    );
    const lgHtml = renderToStaticMarkup(
      React.createElement(Badge, { size: "lg" }, "Featured"),
    );

    expect(smHtml).toContain("rounded-md");
    expect(smHtml).toContain("h-5");
    expect(smHtml).toContain("px-1.5");
    expect(smHtml).toContain("text-xs");

    expect(defaultHtml).toContain("rounded-md");
    expect(defaultHtml).toContain("h-5.5");
    expect(defaultHtml).toContain("px-2");
    expect(defaultHtml).toContain("text-xs");

    expect(lgHtml).toContain("rounded-md");
    expect(lgHtml).toContain("h-6");
    expect(lgHtml).toContain("px-2.5");
    expect(lgHtml).toContain("text-xs");
  });

  it("renders soft single-stroke bordered semantics without legacy ring halo", () => {
    const variants = [
      "default",
      "secondary",
      "outline",
      "info",
      "success",
      "warning",
      "error",
      "destructive",
    ] as const;

    for (const variant of variants) {
      const classes = badgeVariants({ variant });
      expect(classes).toContain("border");
      expect(classes).toContain("rounded-md");
      expect(classes).not.toContain("ring-offset-1");
      expect(classes).not.toContain("ring-2");
    }

    expect(badgeVariants({ variant: "info" })).not.toBe(
      badgeVariants({ variant: "warning" }),
    );
  });
});
