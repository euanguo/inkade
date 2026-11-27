import { describe, expect, test } from "bun:test";
import {
  buildHighlightContextFromText,
  clipperTemplateSchema,
  matchClipperTrigger,
  matchHighlightAnchor,
  normalizeClipUrl,
  parseClipperTemplateFromDocumentTemplate,
  serializeClipperTemplateToDocumentTemplate,
} from "./clipper.ts";

describe("@inkade/core clipper contracts", () => {
  test("normalizeClipUrl removes hash, trailing slash, tracking params, and sorts remaining query", () => {
    expect(
      normalizeClipUrl(
        "HTTPS://Example.COM:443/posts/hello/?utm_source=x&b=2&utm_medium=social&a=1#section",
      ),
    ).toBe("https://example.com/posts/hello?a=1&b=2");

    // Preserves WeChat article identity parameters while stripping tracking fields
    expect(
      normalizeClipUrl(
        "https://mp.weixin.qq.com/s?__biz=MzA1&mid=265&idx=1&sn=abc&chksm=123&scene=27#rd",
      ),
    ).toBe("https://mp.weixin.qq.com/s?__biz=MzA1&idx=1&mid=265&sn=abc");

    expect(normalizeClipUrl("http://localhost:80/docs/")).toBe("http://localhost/docs");
  });

  test("matchHighlightAnchor supports exact, disambiguated, whitespace-collapsed, and partial head matching", () => {
    const text =
      "First section: stable nodeId keeps bindings intact.\n\nSecond section: stable nodeId keeps bindings intact across updates.";

    const disambiguated = matchHighlightAnchor(text, {
      quote: "stable nodeId keeps bindings intact",
      prefixContext: "Second section: ",
      suffixContext: " across updates.",
    });
    expect(disambiguated?.exact).toBe(true);
    expect(text.slice(disambiguated!.start, disambiguated!.end)).toBe(
      "stable nodeId keeps bindings intact",
    );
    expect(disambiguated!.start).toBeGreaterThan(50);

    const fuzzy = matchHighlightAnchor("Hello   WORLD\nfrom   Inkade Clipper", {
      quote: "world from inkade",
    });
    expect(fuzzy).not.toBeNull();
    expect(fuzzy?.exact).toBe(false);
    expect("Hello   WORLD\nfrom   Inkade Clipper".slice(fuzzy!.start, fuzzy!.end)).toBe(
      "WORLD\nfrom   Inkade",
    );

    const partial = matchHighlightAnchor(
      "Prefix text: building resilient offline-first web clippers for engineers today.",
      {
        quote: "building resilient offline-first web clippers for everyone tomorrow",
      },
    );
    expect(partial).not.toBeNull();
    expect(partial?.exact).toBe(false);

    const ctx = buildHighlightContextFromText("Alpha beta gamma delta", "gamma", undefined, 6);
    expect(ctx).toEqual({
      quote: "gamma",
      prefixContext: " beta ",
      suffixContext: " delta",
    });

    const renderedDomText =
      "在双源隔离（dual-origin isolation）下，特殊字符 <script>alert('xss')</script> 与 高对比度高亮片段 保持稳定锚定，且 super_long_identifier_without_spaces 完整保留。";
    const mdFormattedQuote = matchHighlightAnchor(renderedDomText, {
      quote: "`<script>alert('xss')</script>` 与 ==高对比度高亮片段==",
      prefixContext: "（`dual-origin isolation`）下，特殊字符 ",
      suffixContext: " 保持稳定锚定",
    });
    expect(mdFormattedQuote).not.toBeNull();
    expect(renderedDomText.slice(mdFormattedQuote!.start, mdFormattedQuote!.end)).toBe(
      "<script>alert('xss')</script> 与 高对比度高亮片段",
    );

    const snakeCaseMatch = matchHighlightAnchor(renderedDomText, {
      quote: "super_long_identifier_without_spaces",
    });
    expect(snakeCaseMatch).not.toBeNull();
    expect(renderedDomText.slice(snakeCaseMatch!.start, snakeCaseMatch!.end)).toBe(
      "super_long_identifier_without_spaces",
    );

    const rawMarkdown =
      "Overview of `dual-origin isolation` with **zero cookie leakage** and [[Target Doc|Display Alias]].";
    const plainQuoteOnMd = matchHighlightAnchor(rawMarkdown, {
      quote: "dual-origin isolation with zero cookie leakage",
    });
    expect(plainQuoteOnMd).not.toBeNull();
    expect(rawMarkdown.slice(plainQuoteOnMd!.start, plainQuoteOnMd!.end)).toContain(
      "zero cookie leakage",
    );
  });

  test("clipperTemplateSchema validates and round-trips through DocumentTemplate cloud serialization", () => {
    const template = clipperTemplateSchema.parse({
      id: "tpl_gh_repo",
      name: "GitHub Repository",
      description: "Captures GitHub repo metadata and README",
      priority: 20,
      triggers: [
        { type: "url-prefix", pattern: "https://github.com/" },
        { type: "schema-type", pattern: "SoftwareSourceCode" },
      ],
      behavior: "create",
      titleTemplate: "{{title}} — GitHub",
      contentTemplate: "> {{url}}\n\n{{content}} <!-- custom -->",
      tagsTemplate: "github, repo",
      properties: [{ key: "domain", valueTemplate: "{{domain}}", type: "text" }],
      appendToDaily: true,
      dailyLineTemplate: "- Clipped [[{{title}}]]",
    });

    const docTemplate = serializeClipperTemplateToDocumentTemplate(template);
    expect(docTemplate.kind).toBe("clip");
    expect(docTemplate.name).toBe("[Clipper] GitHub Repository");

    const parsedBack = parseClipperTemplateFromDocumentTemplate({
      kind: docTemplate.kind,
      contentMarkdown: docTemplate.contentMarkdown,
    });
    expect(parsedBack).toEqual(template);

    expect(
      matchClipperTrigger(
        { type: "glob", pattern: "https://github.com/*/*" },
        { url: "https://github.com/oven-sh/bun" },
      ),
    ).toBe(true);
    expect(
      matchClipperTrigger(
        { type: "regex", pattern: "^https://(www\\.)?zhihu\\.com/question/" },
        { url: "https://www.zhihu.com/question/123456" },
      ),
    ).toBe(true);
    expect(
      matchClipperTrigger(
        { type: "schema-type", pattern: "ScholarlyArticle" },
        { url: "https://arxiv.org/abs/2401.00001", schemaTypes: ["ScholarlyArticle"] },
      ),
    ).toBe(true);
  });
});
