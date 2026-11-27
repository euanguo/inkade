import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import {
  buildMermaidCacheKey,
  getCachedMermaidSvg,
  sanitizeMermaidSvg,
  setCachedMermaidSvg,
} from "./mermaid-theme.ts";

describe("sanitizeMermaidSvg", () => {
  test("preserves Mermaid SVG geometry and foreignObject labels while stripping XSS payloads", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const dirtySvg = `
      <svg id="inkade-m1" viewBox="0 0 200 100" onload="alert(0)" xmlns="http://www.w3.org/2000/svg">
        <style>.edgeLabel span { color: #18181b; }</style>
        <g>
          <foreignObject width="120" height="40">
            <div xmlns="http://www.w3.org/1999/xhtml">
              <span class="nodeLabel"><p>Architecture Flow</p></span>
              <img src="x" onerror="alert(1)" />
              <iframe src="https://evil.example.com"></iframe>
            </div>
          </foreignObject>
          <script>window.pwned = true;</script>
          <rect width="40" height="20" onclick="alert(2)" />
          <a xlink:href="javascript:alert(3)" href="javascript:alert(4)">
            <text>Click</text>
          </a>
          <animate attributeName="onbegin" to="alert(5)" />
        </g>
      </svg>
    `;

    const clean = sanitizeMermaidSvg(dirtySvg, dom.window);
    expect(clean).toContain("<svg");
    expect(clean).toContain("<foreignObject");
    expect(clean).toContain("Architecture Flow");
    expect(clean).toContain(".edgeLabel span");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("onload");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("<animate");

    // Fails closed when no DOM window is present
    expect(sanitizeMermaidSvg(dirtySvg)).toBe("");
  });
});

describe("mermaid SVG LRU cache", () => {
  test("keys by theme + chart and evicts oldest entry when exceeding 200 items", () => {
    const kLight = buildMermaidCacheKey("graph TD\nA-->B", "light");
    const kDark = buildMermaidCacheKey("graph TD\nA-->B", "dark");
    expect(kLight).not.toBe(kDark);

    const firstKey = buildMermaidCacheKey("graph TD\nLRU_0-->B", "light");
    setCachedMermaidSvg(firstKey, "<svg>0</svg>");
    expect(getCachedMermaidSvg(firstKey)).toBe("<svg>0</svg>");

    for (let i = 1; i <= 200; i += 1) {
      setCachedMermaidSvg(
        buildMermaidCacheKey(`graph TD\nLRU_${i}-->B`, "light"),
        `<svg>${i}</svg>`,
      );
    }

    expect(getCachedMermaidSvg(firstKey)).toBeUndefined();
    const lastKey = buildMermaidCacheKey("graph TD\nLRU_200-->B", "light");
    expect(getCachedMermaidSvg(lastKey)).toBe("<svg>200</svg>");
  });
});
