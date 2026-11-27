import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getSpaceColorToken,
  isEmojiIcon,
  resolveSpaceIconComponent,
  SPACE_COLOR_NAMES,
  SPACE_COLOR_PALETTE,
  SPACE_ICON_NAMES,
  SPACE_ICON_REGISTRY,
  SpaceColorBadge,
  SpaceIcon,
  SpaceIconPicker,
} from "./space-icon.tsx";

describe("space-icon", () => {
  it("defines all 10 low-glare semantic palette entries with required token fields", () => {
    expect(SPACE_COLOR_NAMES).toHaveLength(10);
    for (const name of SPACE_COLOR_NAMES) {
      const token = SPACE_COLOR_PALETTE[name];
      expect(token.id).toBe(name);
      expect(token.iconText.length).toBeGreaterThan(0);
      expect(token.chipBg.length).toBeGreaterThan(0);
      expect(token.chipBorder.length).toBeGreaterThan(0);
      expect(token.dotBg.length).toBeGreaterThan(0);
    }
    expect(getSpaceColorToken("emerald").id).toBe("emerald");
    expect(getSpaceColorToken("nonexistent").id).toBe("slate");
    expect(getSpaceColorToken(undefined).id).toBe("slate");
  });

  it("provides 24 curated Lucide icons and falls back to Folder", () => {
    expect(SPACE_ICON_NAMES.length).toBeGreaterThanOrEqual(24);
    expect(SPACE_ICON_REGISTRY.CalendarDays).toBeDefined();
    expect(SPACE_ICON_REGISTRY.Inbox).toBeDefined();
    expect(resolveSpaceIconComponent("Rocket")).toBe(SPACE_ICON_REGISTRY.Rocket);
    expect(resolveSpaceIconComponent("UnknownIcon")).toBe(SPACE_ICON_REGISTRY.Folder);
  });

  it("detects leading non-ASCII emojis vs Lucide icon names", () => {
    expect(isEmojiIcon("🚀")).toBe(true);
    expect(isEmojiIcon("📚 Research")).toBe(true);
    expect(isEmojiIcon("⚡")).toBe(true);
    expect(isEmojiIcon("Rocket")).toBe(false);
    expect(isEmojiIcon("CalendarDays")).toBe(false);
    expect(isEmojiIcon("")).toBe(false);
    expect(isEmojiIcon(null)).toBe(false);
  });

  it("renders emoji, Lucide SVG, chip wrapper, SpaceColorBadge, and SpaceIconPicker", () => {
    const emojiHtml = renderToStaticMarkup(
      React.createElement(SpaceIcon, { icon: "🧪", color: "teal", withChip: true }),
    );
    expect(emojiHtml).toContain("data-slot=\"space-icon-chip\"");
    expect(emojiHtml).toContain("data-slot=\"space-icon-emoji\"");
    expect(emojiHtml).toContain("🧪");

    const svgHtml = renderToStaticMarkup(
      React.createElement(SpaceIcon, { icon: "BookOpen", color: "indigo", size: 20 }),
    );
    expect(svgHtml).toContain("data-slot=\"space-icon-svg\"");
    expect(svgHtml).toContain("text-indigo-600");

    const badgeHtml = renderToStaticMarkup(
      React.createElement(SpaceColorBadge, { color: "amber", size: "md" }),
    );
    expect(badgeHtml).toContain("data-color=\"amber\"");
    expect(badgeHtml).toContain("bg-amber-500");

    const pickerHtml = renderToStaticMarkup(
      React.createElement(SpaceIconPicker, {
        icon: "Rocket",
        color: "rose",
        onIconChange: () => {},
        onColorChange: () => {},
        iconLabel: "Icon",
        colorLabel: "Color",
      }),
    );
    expect(pickerHtml).toContain("data-color=\"rose\"");
    expect(pickerHtml).toContain("data-icon=\"Rocket\"");
    expect(pickerHtml).toContain("aria-pressed=\"true\"");
  });
});
