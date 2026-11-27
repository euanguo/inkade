import {
  applyFilterPipeline,
  BUILTIN_CLIPPER_TEMPLATES,
  matchTemplateForPage,
  renderClipTemplate,
} from "@inkade/clipper-core/templates";
import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import {
  asTemplateId,
  asWorkspaceId,
  clipperTemplateSchema,
  type DocumentTemplate,
} from "@inkade/core";
import { createInkadeClient, type FetchLike } from "@inkade/sdk";
import { pullTemplatesFromInkade, pushTemplatesToInkade } from "./cloud-sync.ts";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("@inkade/clipper declarative templates & filters", () => {
  test("applyFilterPipeline covers all core string, markdown, list, and date filters", () => {
    expect(applyFilterPipeline("  hello inkade  ", ["trim", "upper"])).toBe("HELLO INKADE");
    expect(applyFilterPipeline("hello world", ["capitalize", 'replace:"world":"clipper"'])).toBe(
      "Hello clipper",
    );
    expect(applyFilterPipeline("0123456789", ["slice:0:5"])).toBe("01234");
    expect(applyFilterPipeline("a long sentence here", ["truncate:10"])).toBe("a long se…");
    expect(applyFilterPipeline("<p>clean <b>html</b></p>", ["strip_tags"])).toBe("clean html");
    expect(applyFilterPipeline("<p>Hello <strong>World</strong></p>", ["markdown"])).toBe(
      "Hello **World**",
    );
    expect(applyFilterPipeline("line 1\nline 2", ["blockquote"])).toBe("> line 1\n> line 2");
    expect(applyFilterPipeline("Watch out", ['callout:"WARNING"'])).toBe(
      "> [!WARNING]\n> Watch out",
    );
    expect(applyFilterPipeline("Architecture Spec", ["wikilink"])).toBe("[[Architecture Spec]]");
    expect(applyFilterPipeline("Hello World 2026!", ["slug"])).toBe("hello-world-2026");
    expect(applyFilterPipeline("a b", ["encode_uri"])).toBe("a%20b");
    expect(applyFilterPipeline("a, b, a, c", ['split:","', "unique", 'join:"|"'])).toBe(
      "a|b|c",
    );
    expect(applyFilterPipeline(["first", "mid", "last"], ["first"])).toBe("first");
    expect(applyFilterPipeline(["first", "mid", "last"], ["last"])).toBe("last");
    expect(applyFilterPipeline(["a", "b"], ["length"])).toBe("2");
    expect(applyFilterPipeline(["x", "y"], ['map:"- {{item}}"', 'join:"\\n"'])).toBe("- x\n- y");
    expect(applyFilterPipeline("", ['default:"Fallback"'])).toBe("Fallback");
    expect(applyFilterPipeline({ k: 1 }, ["json"])).toContain('"k": 1');
    expect(applyFilterPipeline("2026-11-24T08:30:00Z", ['date:"YYYY/MM/DD"'])).toBe(
      "2026/11/24",
    );
  });

  test("matchTemplateForPage matches builtin presets by trigger specificity and priority", () => {
    expect(BUILTIN_CLIPPER_TEMPLATES.length).toBe(6);

    const ghMatch = matchTemplateForPage(BUILTIN_CLIPPER_TEMPLATES, {
      url: "https://github.com/oven-sh/bun",
    });
    expect(ghMatch.autoMatched).toBe(true);
    expect(ghMatch.template?.id).toBe("tpl_github_repo");

    const ytMatch = matchTemplateForPage(BUILTIN_CLIPPER_TEMPLATES, {
      url: "https://www.youtube.com/watch?v=123",
    });
    expect(ytMatch.autoMatched).toBe(true);
    expect(ytMatch.template?.id).toBe("tpl_video_notes");

    const schemaMatch = matchTemplateForPage(BUILTIN_CLIPPER_TEMPLATES, {
      url: "https://custom-journal.org/paper/42",
      schemaTypes: ["ScholarlyArticle"],
    });
    expect(schemaMatch.autoMatched).toBe(true);
    expect(schemaMatch.template?.id).toBe("tpl_tech_paper");

    const fallback = matchTemplateForPage(BUILTIN_CLIPPER_TEMPLATES, {
      url: "https://random-blog.example.com/post",
    });
    expect(fallback.autoMatched).toBe(false);
    expect(fallback.template?.id).toBe("tpl_default_article");
  });

  test("renderClipTemplate compiles if/else/for, selector:/meta:/schema:, typed properties, and AI prompts", () => {
    const { document } = parseHTML(`
      <html>
        <head>
          <meta name="category" content="Engineering" />
        </head>
        <body>
          <span class="topic-tag">typescript</span>
          <span class="topic-tag">local-first</span>
          <span class="star-count">4200</span>
        </body>
      </html>
    `);

    const customTpl = clipperTemplateSchema.parse({
      id: "tpl_custom_test",
      name: "Custom Test",
      triggers: [],
      titleTemplate: "{{title | trim}}",
      tagsTemplate: "{{meta:category}}, {{selector:.topic-tag | join:\",\"}}",
      contentTemplate: `{% if author %}By {{author}}{% else %}Unknown{% endif %}\n\n{{"Summarize in 3 bullets"}}\n\n{% for h in highlightList %}- {{h}}\n{% endfor %}\n{{schema:publisher.name}}`,
      properties: [
        { key: "stars", valueTemplate: "{{selector:.star-count}}", type: "number" },
        { key: "featured", valueTemplate: "true", type: "boolean" },
        { key: "topics", valueTemplate: "{{selector:.topic-tag | join:\",\"}}", type: "list" },
      ],
      appendToDaily: true,
      dailyLineTemplate: "- Read [[{{title}}]]",
    });

    const plan = renderClipTemplate(customTpl, {
      doc: document,
      article: {
        url: "https://example.com/repo",
        title: "  Inkade Engine  ",
        markdown: "Main body",
        excerpt: "Summary",
        htmlSnapshot: "",
        cleanHtml: "",
        imageUrls: [],
        meta: {
          domain: "example.com",
          author: "Alice",
          schemaOrgData: { publisher: { name: "Inkade Press" } },
        },
        variables: {},
        extractor: "defuddle-full",
      },
      highlights: [
        { quote: "Point one", color: "amber" },
        { quote: "Point two", color: "blue" },
      ],
    });

    expect(plan.title).toBe("Inkade Engine");
    expect(plan.tags).toEqual(["Engineering", "typescript", "local-first"]);
    expect(plan.contentMarkdown).toContain("By Alice");
    expect(plan.contentMarkdown).toContain("- Point one");
    expect(plan.contentMarkdown).toContain("- Point two");
    expect(plan.contentMarkdown).toContain("Inkade Press");
    expect(plan.pendingPrompts).toEqual([
      { placeholder: "<!--inkade-ai-prompt:0-->", prompt: "Summarize in 3 bullets" },
    ]);
    expect(plan.properties).toEqual({
      stars: 4200,
      featured: true,
      topics: ["typescript", "local-first"],
    });
    expect(plan.dailyLine).toBe("- Read [[Inkade Engine]]");
  });

  test("pushTemplatesToInkade and pullTemplatesFromInkade round-trip ClipperTemplates through /api/v1/templates", async () => {
    const cloudStore: DocumentTemplate[] = [];
    const tplFetch: FetchLike = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";

      if (url.includes("/api/v1/templates") && method === "GET") {
        return Promise.resolve(jsonResponse({ templates: cloudStore }));
      }
      if (url.endsWith("/api/v1/templates") && method === "POST") {
        const bodyStr = typeof init?.body === "string" ? init.body : "{}";
        const body = JSON.parse(bodyStr) as {
          name: string;
          kind: "clip";
          description: string;
          contentMarkdown: string;
          isDefaultDaily: boolean;
        };
        const created: DocumentTemplate = {
          id: asTemplateId(`tpl_srv_${cloudStore.length + 1}`),
          workspaceId: asWorkspaceId("ws_1"),
          name: body.name,
          kind: body.kind,
          description: body.description,
          contentMarkdown: body.contentMarkdown,
          isDefaultDaily: body.isDefaultDaily,
          createdAt: "2026-11-24T00:00:00.000Z",
          updatedAt: "2026-11-24T00:00:00.000Z",
        };
        cloudStore.push(created);
        return Promise.resolve(jsonResponse({ template: created }, 201));
      }
      if (url.includes("/api/v1/templates/") && method === "PATCH") {
        const id = url.split("/").pop()!;
        const bodyStr = typeof init?.body === "string" ? init.body : "{}";
        const patch = JSON.parse(bodyStr) as Partial<DocumentTemplate>;
        const idx = cloudStore.findIndex((t) => t.id === id);
        cloudStore[idx] = { ...cloudStore[idx]!, ...patch };
        return Promise.resolve(jsonResponse({ template: cloudStore[idx] }));
      }
      return Promise.reject(new Error(`Unexpected call: ${method} ${url}`));
    };

    const client = createInkadeClient({
      baseUrl: "http://127.0.0.1:4100",
      token: "ink_test",
      fetch: tplFetch,
    });

    const pushed = await pushTemplatesToInkade(client, [BUILTIN_CLIPPER_TEMPLATES[2]!]);
    expect(pushed).toBe(1);
    expect(cloudStore).toHaveLength(1);

    // Push again updates existing record instead of duplicating
    const pushedAgain = await pushTemplatesToInkade(client, [BUILTIN_CLIPPER_TEMPLATES[2]!]);
    expect(pushedAgain).toBe(1);
    expect(cloudStore).toHaveLength(1);

    const pulled = await pullTemplatesFromInkade(client, []);
    expect(pulled).toHaveLength(1);
    expect(pulled[0]?.id).toBe("tpl_github_repo");
  });
});
