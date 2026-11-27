import { describe, expect, it } from "bun:test";
import {
  enUS,
  getInkadeLocale,
  initInkadeI18n,
  setInkadeLocale,
  t,
  zhCN,
} from "./index.ts";

function flattenKeys(obj: object, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(obj) as [string, unknown][]) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.set(fullKey, value);
    } else if (value && typeof value === "object") {
      for (const [nestedKey, nestedVal] of flattenKeys(value, fullKey)) {
        out.set(nestedKey, nestedVal);
      }
    }
  }
  return out;
}

function extractPlaceholders(value: string): string[] {
  const matches = value.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/^\{\{\s*|\s*\}\}$/g, "")))].sort();
}

describe("@inkade/i18n", () => {
  it("keeps zh-CN and en-US keys and interpolation variables 100% symmetric", () => {
    const zh = flattenKeys(zhCN);
    const en = flattenKeys(enUS);

    expect([...zh.keys()].sort()).toEqual([...en.keys()].sort());

    for (const [key, zhVal] of zh.entries()) {
      const enVal = en.get(key);
      expect(zhVal.trim().length).toBeGreaterThan(0);
      expect(enVal?.trim().length ?? 0).toBeGreaterThan(0);
      expect(extractPlaceholders(zhVal)).toEqual(extractPlaceholders(enVal ?? ""));
    }
  });

  it("switches locales cleanly and interpolates variables", () => {
    initInkadeI18n("zh-CN");
    expect(getInkadeLocale()).toBe("zh-CN");
    expect(t("outline.rolloverBanner", { count: 3 })).toContain("3");

    setInkadeLocale("en-US");
    expect(getInkadeLocale()).toBe("en-US");
    expect(t("outline.rolloverBanner", { count: 3 })).toContain("3 unfinished");

    setInkadeLocale("zh-CN");
  });
});
