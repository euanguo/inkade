import { describe, expect, test } from "bun:test";
import { clipperTemplateSchema, type ClipperTemplate } from "@inkade/core";
import { parseHTML } from "linkedom";
import {
  applyFilterPipeline,
  BUILTIN_CLIPPER_TEMPLATES,
  cloneDocumentWithFlattenedShadowDom,
  extractArticleFromDocument,
  extractArticleFromDocumentAsync,
  extractRegionFromElement,
  extractSelectionHighlightAnchor,
  htmlToInkadeMarkdown,
  matchTemplateForPage,
  pickBestSrcsetCandidate,
  renderClipTemplate,
  renderTemplateVariables,
} from "./index.ts";

function buildTestDocument(html: string): Document {
  return parseHTML(html).document;
}

describe("@inkade/clipper-core extraction & markdown", () => {
  test("extracts article metadata, favicon, og:image, schema.org, and clean markdown", () => {
    const doc = buildTestDocument(`<!doctype html>
<html>
  <head>
    <title>Test Article Title</title>
    <link rel="icon" href="/assets/favicon.png" />
    <meta property="og:image" content="/assets/cover.webp" />
    <meta name="description" content="A concise summary of the article." />
    <meta name="author" content="Ada Lovelace" />
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Article","headline":"Analytical Engine Notes"}
    </script>
  </head>
  <body>
    <article>
      <h1>Analytical Engine Notes</h1>
      <p class="kicker">Computing History</p>
      <p>The Analytical Engine weaves algebraic patterns just as the Jacquard loom weaves flowers and leaves.</p>
      <p>It supports conditional branching, loops, and symbolic manipulation across extensive memory tables.</p>
    </article>
  </body>
</html>`);

    const article = extractArticleFromDocument(doc, "https://example.com/posts/engine");
    expect(article.title).toContain("Analytical Engine");
    expect(article.meta.domain).toBe("example.com");
    expect(article.meta.favicon).toBe("https://example.com/assets/favicon.png");
    expect(article.meta.image).toBe("https://example.com/assets/cover.webp");
    expect(article.meta.schemaTypes).toContain("Article");
    expect(article.markdown).toContain("Jacquard loom");
  });

  test("flattens open shadow roots when cloning and strips #inkade-clipper-root", () => {
    const doc = buildTestDocument(`<!doctype html><html><body>
      <main id="host">Light fallback</main>
      <div id="inkade-clipper-root">Clipper UI chrome</div>
    </body></html>`);

    const host = doc.querySelector("#host") as Element & { shadowRoot?: ShadowRoot | null };
    const shadowFrag = doc.createDocumentFragment();
    const shadowP = doc.createElement("p");
    shadowP.textContent = "Inside Shadow DOM paragraph";
    shadowFrag.appendChild(shadowP);
    Object.defineProperty(host, "shadowRoot", {
      value: shadowFrag,
      configurable: true,
    });

    const cloned = cloneDocumentWithFlattenedShadowDom(doc);
    expect(cloned.body.textContent).toContain("Inside Shadow DOM paragraph");
    expect(cloned.body.textContent).not.toContain("Clipper UI chrome");
  });

  test("converts tables, code blocks, math, images, checkboxes, and strikethrough to clean GFM", () => {
    expect(pickBestSrcsetCandidate("/small.jpg 320w, /large.jpg 1280w")).toBe("/large.jpg");

    const md = htmlToInkadeMarkdown(`
      <h1>Heading</h1>
      <pre data-lang="ts"><code>const x = 1 + 2;</code></pre>
      <table>
        <tr><th>Name</th><th>Role</th></tr>
        <tr><td>Ada</td><td>Mathematician | Pioneer</td></tr>
      </table>
      <span class="katex"><annotation encoding="application/x-tex">E = mc^2</annotation></span>
      <p><del>old</del></p>
      <ul><li><input type="checkbox" checked /> Done task</li></ul>
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="spacer" />
      <img srcset="/img-400.png 400w, /img-1200.png 1200w" alt="Diagram [v1]" />
    `);

    expect(md).toContain("```ts\nconst x = 1 + 2;\n```");
    expect(md).toContain("| Name | Role |");
    expect(md).toContain("Mathematician \\| Pioneer");
    expect(md).toContain("$E = mc^2$");
    expect(md).toContain("~~old~~");
    expect(md).toContain("[x]");
    expect(md).not.toContain("spacer");
    expect(md).toContain("![Diagram \\[v1\\]](/img-1200.png)");
  });

  test("supports region extraction, async adapter override, and highlight anchor context", async () => {
    const doc = buildTestDocument(`<!doctype html><html><body>
      <section id="target"><h2>Region Title</h2><p>Intro before. First important sentence. Trailing context after.</p></section>
    </body></html>`);
    const target = doc.querySelector("#target")!;
    const region = extractRegionFromElement(target, "https://example.com/page");
    expect(region.extractor).toBe("region-picker");
    expect(region.markdown).toContain("Region Title");

    const asyncRes = await extractArticleFromDocumentAsync(doc, "https://example.com/custom", {
      adapterOverride: () =>
        Promise.resolve({
          id: "custom-test",
          title: "Adapter Title",
          markdown: "Adapter body text",
          author: "Grace Hopper",
        }),
    });
    expect(asyncRes.extractor).toBe("adapter:custom-test");
    expect(asyncRes.title).toBe("Adapter Title");
    expect(asyncRes.meta.author).toBe("Grace Hopper");

    const mockSelection = {
      rangeCount: 0,
      toString: () => "First important sentence.",
    } as unknown as Selection;
    const anchor = extractSelectionHighlightAnchor(doc, {
      pageUrl: "https://example.com/page",
      title: "Page Title",
      selection: mockSelection,
    });
    expect(anchor?.quote).toBe("First important sentence.");
    expect(anchor?.prefixContext).toContain("Intro before.");
    expect(anchor?.suffixContext).toContain("Trailing context");
  });
});

describe("@inkade/clipper-core LiquidJS template engine & filters", () => {
  test("evaluates colon and Liquid filters accurately", () => {
    expect(applyFilterPipeline("  hello world  ", ["trim", "title", 'replace:" ":""'])).toBe(
      "HelloWorld",
    );
    expect(applyFilterPipeline("Line 1\nLine 2", ['callout:"tip"'])).toBe("> [!TIP]\n> Line 1\n> Line 2");
    expect(applyFilterPipeline("Inkade Note", ["wikilink"])).toBe("[[Inkade Note]]");
    expect(applyFilterPipeline("a, b, a, c", ["split:','", "unique", "join:' | '"])).toBe("a | b | c");
    expect(applyFilterPipeline("2026-05-09T14:05:06Z", ['date:"YYYY-MM-DD"'])).toBe("2026-05-09");
    expect(applyFilterPipeline("Hello World!", ["slug"])).toBe("hello-world");
    expect(applyFilterPipeline("", ['default:"Fallback"'])).toBe("Fallback");
  });

  test("renders variables, dynamic selectors, control flow, and conditional AI prompts via LiquidJS", () => {
    const doc = buildTestDocument(`<!doctype html>
<html>
  <head>
    <meta name="description" content="Dynamic meta desc" />
    <script type="application/ld+json">
      {"@type":"TechArticle","headline":"Liquid Engine Design"}
    </script>
  </head>
  <body>
    <span class="kicker">Architecture</span>
    <div class="box"><strong>Bold</strong> detail</div>
  </body>
</html>`);

    const article = extractArticleFromDocument(doc, "https://docs.inkade.dev/guide");
    const template: ClipperTemplate = clipperTemplateSchema.parse({
      id: "tpl-custom",
      name: "Custom Liquid Template",
      description: "Liquid test template",
      enabled: true,
      priority: 10,
      triggers: [],
      behavior: "create",
      titleTemplate: "{{ title }} — {{ domain }}",
      contentTemplate: [
        "Kicker: {{ selector:.kicker }}",
        "Meta: {{ meta:description }}",
        "Schema: {{ schema:@TechArticle.headline }}",
        "Box: {{ selectorHtml:.box | markdown }}",
        '{% if !author %}No Author Prompt: {{"Extract implicit author"}}{% endif %}',
        '{% if highlightList %}{% for h in highlightList %}- {{ h }}\n{% endfor %}{% endif %}',
        '{% unless selection %}Full capture: {{"Summarize key takeaways"}}{% endunless %}',
        "ProtoCheck: {{ article.constructor.name }}",
      ].join("\n"),
      tagsTemplate: "{{ selector:.kicker | lower }}, tech",
      properties: [
        { key: "wordCount", type: "number", valueTemplate: "420" },
        { key: "reviewed", type: "boolean", valueTemplate: "true" },
        { key: "topics", type: "list", valueTemplate: "liquid, clipper" },
      ],
      appendToDaily: true,
      dailyLineTemplate: "- [{{ title }}]({{ url }})",
      mirrorImages: false,
      saveHtmlSnapshot: false,
    });

    const plan = renderClipTemplate(template, {
      article: {
        ...article,
        title: "LiquidJS Upgrade",
        meta: { ...article.meta, author: "" },
      },
      doc,
      highlights: [{ quote: "Highlight One", color: "yellow" }],
      now: new Date("2026-11-25T10:30:00.000Z"),
    });

    expect(plan.title).toBe("LiquidJS Upgrade — docs.inkade.dev");
    expect(plan.contentMarkdown).toContain("Kicker: Architecture");
    expect(plan.contentMarkdown).toContain("Meta: Dynamic meta desc");
    expect(plan.contentMarkdown).toContain("Schema: Liquid Engine Design");
    expect(plan.contentMarkdown).toContain("Box: **Bold** detail");
    expect(plan.contentMarkdown).toContain("- Highlight One");
    expect(plan.contentMarkdown).toContain("ProtoCheck:");
    expect(plan.contentMarkdown).not.toContain("Function");
    expect(plan.pendingPrompts).toHaveLength(2);
    expect(plan.pendingPrompts[0]?.prompt).toBe("Extract implicit author");
    expect(plan.pendingPrompts[1]?.prompt).toBe("Summarize key takeaways");
    expect(plan.tags).toEqual(["architecture", "tech"]);
    expect(plan.properties).toEqual({
      wordCount: 420,
      reviewed: true,
      topics: ["liquid", "clipper"],
    });
    expect(plan.dailyLine).toBe("- [LiquidJS Upgrade — docs.inkade.dev](https://docs.inkade.dev/guide)");
  });

  test("renderTemplateVariables handles server daily-note variables via LiquidJS", () => {
    const out = renderTemplateVariables("# {{ date }}\n\nWelcome on {{ weekday }}!", {
      date: "2026-11-25",
      weekday: "Wednesday",
    });
    expect(out).toBe("# 2026-11-25\n\nWelcome on Wednesday!");
  });

  test("matches built-in templates and prefers higher-specificity regex/url triggers", () => {
    expect(BUILTIN_CLIPPER_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    const matched = matchTemplateForPage(BUILTIN_CLIPPER_TEMPLATES, {
      url: "https://github.com/org/repo",
    });
    expect(matched.autoMatched).toBe(true);
    expect(matched.template?.id).toBe("tpl_github_repo");
  });
});
