import { describe, expect, test } from "bun:test";
import { setInkadeLocale } from "@inkade/i18n";
import { formatDailyHeading, getRelativeDailyBadge, shiftDailyDate } from "@inkade/views/lib/dates";
import { buildAdeDispatchPrompt, buildMcpConfigSnippet } from "@inkade/views/lib/mcp-snippet";
import { isImeEvent } from "@inkade/views/lib/shortcuts";

describe("apps/web helpers", () => {
  test("buildMcpConfigSnippet produces valid Streamable HTTP config JSON", () => {
    const raw = buildMcpConfigSnippet({
      baseUrl: "http://localhost:3456/",
      token: "ink_secret_123",
    });
    const parsed = JSON.parse(raw) as {
      mcpServers: {
        inkade: {
          type: string;
          url: string;
          headers: { Authorization: string };
        };
      };
    };
    expect(parsed.mcpServers.inkade.type).toBe("http");
    expect(parsed.mcpServers.inkade.url).toBe("http://localhost:3456/mcp");
    expect(parsed.mcpServers.inkade.headers.Authorization).toBe("Bearer ink_secret_123");
  });

  test("buildAdeDispatchPrompt includes node, section, excerpt, and task", () => {
    const prompt = buildAdeDispatchPrompt({
      adeKind: "bb",
      documentTitle: "Daily · 2026-11-24",
      documentId: "doc_123",
      nodeId: "nod_456",
      selectionAnchor: { quote: "FTS5 ranking", headingSlug: "search" },
      excerpt: "Investigate BM25 weights",
      instruction: "Compare alternatives",
    });
    expect(prompt).toContain("[Inkade Context · BB]");
    expect(prompt).toContain("Outline Node: nod_456");
    expect(prompt).toContain("Section: #search");
    expect(prompt).toContain("> Investigate BM25 weights");
    expect(prompt).toContain("Compare alternatives");
  });

  test("date helpers shift calendar days and compute locale-aware relative badges", () => {
    expect(shiftDailyDate("2026-11-24", -1)).toBe("2026-11-23");
    expect(shiftDailyDate("2026-11-24", 1)).toBe("2026-11-25");

    setInkadeLocale("zh-CN");
    expect(getRelativeDailyBadge("2026-11-24", "2026-11-24")).toBe("今天");
    expect(getRelativeDailyBadge("2026-11-23", "2026-11-24")).toBe("昨天");
    expect(getRelativeDailyBadge("2026-11-25", "2026-11-24")).toBe("明天");
    expect(getRelativeDailyBadge("2026-11-20", "2026-11-24")).toBeNull();
    expect(formatDailyHeading("2026-11-24", "zh-CN")).toContain("2026 年 11 月 24 日");

    setInkadeLocale("en-US");
    expect(getRelativeDailyBadge("2026-11-24", "2026-11-24")).toBe("Today");
    expect(getRelativeDailyBadge("2026-11-23", "2026-11-24")).toBe("Yesterday");
    expect(getRelativeDailyBadge("2026-11-25", "2026-11-24")).toBe("Tomorrow");
    expect(formatDailyHeading("2026-11-24", "en-US")).toContain("2026");

    setInkadeLocale("zh-CN");
  });

  test("isImeEvent detects composition and keyCode 229", () => {
    expect(isImeEvent({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isImeEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeEvent({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
