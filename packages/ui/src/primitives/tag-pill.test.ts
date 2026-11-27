import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AdePlatformBadge,
  DocumentKindIcon,
  getTagColor,
  getTagIconName,
  normalizeTagName,
  TagPill,
} from "./tag-pill.tsx";

describe("tag-pill", () => {
  it("normalizes tags and deterministically hashes unknown tags", () => {
    expect(normalizeTagName("  #Architecture ")).toBe("architecture");

    const colorA1 = getTagColor("distributed-systems");
    const colorA2 = getTagColor("#Distributed-Systems");
    expect(colorA1).toBe(colorA2);

    const colorB = getTagColor("sqlite-fts5");
    expect(typeof colorB).toBe("string");
  });

  it("matches Bear-style semantic TagCons case-insensitively and across nested paths", () => {
    expect(getTagIconName("research")).toBe("Microscope");
    expect(getTagIconName("research/sqlite")).toBe("Microscope");
    expect(getTagIconName("paper-notes")).toBe("BookOpen");
    expect(getTagIconName("bug")).toBe("Bug");
    expect(getTagIconName("fix/race-condition")).toBe("Bug");
    expect(getTagIconName("idea")).toBe("Lightbulb");
    expect(getTagIconName("meeting")).toBe("Calendar");
    expect(getTagIconName("code")).toBe("Code2");
    expect(getTagIconName("dev/frontend")).toBe("Code2");
    expect(getTagIconName("arch")).toBe("Code2");
    expect(getTagIconName("book")).toBe("Book");
    expect(getTagIconName("reading")).toBe("Book");
    expect(getTagIconName("todo")).toBe("CheckSquare");
    expect(getTagIconName("task")).toBe("CheckSquare");
    expect(getTagIconName("ai")).toBe("Sparkles");
    expect(getTagIconName("agent")).toBe("Sparkles");
    expect(getTagIconName("mcp")).toBe("Sparkles");
    expect(getTagIconName("completely-custom-tag")).toBe("Hash");
  });

  it("renders TagPill as span or interactive button with count and active state", () => {
    const staticHtml = renderToStaticMarkup(
      React.createElement(TagPill, { tag: "#research", count: 7 }),
    );
    expect(staticHtml.startsWith("<span")).toBe(true);
    expect(staticHtml).toContain('data-tone="neutral"');
    expect(staticHtml).toContain("data-tag-icon=\"Microscope\"");
    expect(staticHtml).toContain("research");
    expect(staticHtml).toContain("7");

    const tintedHtml = renderToStaticMarkup(
      React.createElement(TagPill, { tag: "#research", tone: "tinted", count: 3 }),
    );
    expect(tintedHtml).toContain('data-tone="tinted"');
    expect(tintedHtml).toContain("bg-emerald-500/10");

    const btnHtml = renderToStaticMarkup(
      React.createElement(TagPill, {
        tag: "bug",
        active: true,
        onClick: () => {},
      }),
    );
    expect(btnHtml.startsWith("<button")).toBe(true);
    expect(btnHtml).toContain("aria-pressed=\"true\"");
    expect(btnHtml).toContain("data-tag-icon=\"Bug\"");
  });

  it("renders DocumentKindIcon and AdePlatformBadge with semantic tints", () => {
    const outlineHtml = renderToStaticMarkup(
      React.createElement(DocumentKindIcon, { kind: "outline" }),
    );
    expect(outlineHtml).toContain("data-kind=\"outline\"");
    expect(outlineHtml).toContain("text-indigo-600");

    const clipHtml = renderToStaticMarkup(
      React.createElement(DocumentKindIcon, { kind: "clip" }),
    );
    expect(clipHtml).toContain("data-kind=\"clip\"");
    expect(clipHtml).toContain("text-teal-600");

    const bbHtml = renderToStaticMarkup(
      React.createElement(AdePlatformBadge, { kind: "bb", label: "BB" }),
    );
    expect(bbHtml).toContain("data-ade-kind=\"bb\"");
    expect(bbHtml).toContain("text-blue-700");
    expect(bbHtml).toContain("BB");

    const paseoHtml = renderToStaticMarkup(
      React.createElement(AdePlatformBadge, { kind: "paseo" }),
    );
    expect(paseoHtml).toContain("data-ade-kind=\"paseo\"");
    expect(paseoHtml).toContain("Paseo");

    const cursorHtml = renderToStaticMarkup(
      React.createElement(AdePlatformBadge, { kind: "cursor" }),
    );
    expect(cursorHtml).toContain("data-ade-kind=\"cursor\"");
    expect(cursorHtml).toContain("Cursor");

    const anyHtml = renderToStaticMarkup(
      React.createElement(AdePlatformBadge, { kind: "any" }),
    );
    expect(anyHtml).toContain("data-ade-kind=\"any\"");
    expect(anyHtml).toContain("text-slate-700");
  });
});
