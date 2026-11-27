import { describe, expect, test } from "bun:test";
import { asDocumentId, asOutlineNodeId, asSpaceId } from "@inkade/core";
import { parseHTML } from "linkedom";
import { createInkadeClient, InkadeApiError, type FetchLike } from "@inkade/sdk";
import {
  DEFAULT_CLIPPER_SETTINGS,
  loadClipperSettings,
  parseTagsCsv,
  resolveWebAppDocUrl,
  saveClipperSettings,
} from "../shared/storage.ts";
import { buildAntiHotlinkDnrRules } from "./dnr-rules.ts";
import { mirrorImagesAndPatchDocument } from "./image-mirror.ts";
import {
  buildHighlightContextFromText,
  collectImageUrlsFromDocument,
  extractArticleFromDocument,
  extractArticleFromDocumentAsync,
  extractRegionFromElement,
  extractSelectionHighlightAnchor,
} from "@inkade/clipper-core/extractor";
import { htmlToInkadeMarkdown } from "@inkade/clipper-core/markdown";
import { cloneDocumentWithFlattenedShadowDom } from "@inkade/clipper-core/shadow-dom";
import {
  appendClipToDaily,
  dispatchClipToAde,
  inferClipImageFilename,
  saveImageClipToInkade,
  syncClipPage,
  syncHighlightToInkade,
  syncSelectionClipToInkade,
} from "./sync.ts";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("@inkade/clipper Phase C1 engine", () => {
  test("extracts clean Markdown, GFM tables, task lists, code languages, and metadata with defuddle/full", async () => {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <title>Local-First Architecture Notes | TechBlog</title>
    <meta name="author" content="Alice Zhang" />
    <meta name="description" content="How CRDTs and SQLite power fast note sync." />
    <script type="application/ld+json">{"@type": "TechArticle", "headline": "Local-First Architecture Notes"}</script>
  </head>
  <body>
    <header><nav><a href="/home">Home</a><a href="/pricing">Pricing</a></nav></header>
    <main>
      <article>
        <h1>Local-First Architecture Notes</h1>
        <p>Local-first apps keep <strong>responsive UI</strong> and <del>lag</del> sync cleanly across devices.</p>
        <h2>Comparison Matrix</h2>
        <table>
          <thead><tr><th>Engine</th><th>License</th></tr></thead>
          <tbody><tr><td>Defuddle</td><td>MIT</td></tr></tbody>
        </table>
        <pre><code class="language-ts">export const sync = () => true;</code></pre>
        <img src="/assets/diagram.png" alt="Architecture" />
        <img src="https://cdn.example.com/photo.webp" alt="Diagram" />
        <img src="data:image/png;base64,AAAA" alt="Inline pixel" />
      </article>
    </main>
    <script>console.log("tracking");</script>
  </body>
</html>`;

    const { document } = parseHTML(html);
    const extracted = await extractArticleFromDocumentAsync(
      document,
      "https://blog.example.com/posts/local-first",
    );

    expect(extracted.title).toContain("Local-First Architecture Notes");
    expect(extracted.meta.domain).toBe("blog.example.com");
    expect(extracted.meta.schemaTypes).toContain("TechArticle");
    expect(extracted.markdown).toContain("Local-first apps keep **responsive UI**");
    expect(extracted.markdown).toContain("| Engine | License |");
    expect(extracted.markdown).toContain("```ts");
    expect(extracted.markdown).toContain("export const sync = () => true;");
    expect(extracted.markdown).not.toContain('console.log("tracking")');
    expect(extracted.imageUrls).toContain("https://blog.example.com/assets/diagram.png");
    expect(extracted.imageUrls).toContain("https://cdn.example.com/photo.webp");
    expect(extracted.imageUrls.some((u) => u.startsWith("data:"))).toBe(false);

    const gfm = htmlToInkadeMarkdown(
      `<ul><li><input type="checkbox" checked /> Done task</li><li><del>old</del></li></ul>`,
    );
    expect(gfm).toContain("[x]");
    expect(gfm).toContain("~~old~~");

    // Shadow DOM flattening test (non-invasive to original DOM)
    const { document: shadowHostDoc } = parseHTML(
      `<html><body><my-article id="host"></my-article><div id="inkade-clipper-root">shadow ui</div></body></html>`,
    );
    const { document: shadowContentDoc } = parseHTML(
      `<article><h2>Inside Shadow Root</h2><p>Flattened shadow paragraph.</p></article>`,
    );
    const hostEl = shadowHostDoc.getElementById("host");
    expect(hostEl).not.toBeNull();
    if (hostEl) {
      Object.defineProperty(hostEl, "shadowRoot", {
        value: { childNodes: Array.from(shadowContentDoc.childNodes) },
        configurable: true,
      });
    }
    const flattened = cloneDocumentWithFlattenedShadowDom(shadowHostDoc);
    expect(flattened.body?.textContent).toContain("Inside Shadow Root");
    expect(flattened.body?.textContent).toContain("Flattened shadow paragraph.");
    expect(flattened.getElementById("inkade-clipper-root")).toBeNull();
  });

  test("extractRegionFromElement and W3C selection anchor work cleanly", () => {
    const { document } = parseHTML(`
      <html><head><title>Region Doc</title></head>
      <body>
        <aside>Sidebar Noise</aside>
        <section id="target">
          <h2>Core Protocol</h2>
          <p>Alpha beta gamma delta epsilon.</p>
          <img src="/diagram.png" />
        </section>
      </body></html>
    `);
    const target = document.getElementById("target") as unknown as Element;
    const region = extractRegionFromElement(target, "https://docs.example.com/spec");
    expect(region.title).toBe("Core Protocol");
    expect(region.markdown).toContain("Alpha beta gamma delta epsilon.");
    expect(region.markdown).not.toContain("Sidebar Noise");
    expect(region.imageUrls).toEqual(["https://docs.example.com/diagram.png"]);

    const anchor = buildHighlightContextFromText(
      "Before reading further, note that stable nodeId operations protect bindings.",
      "stable nodeId operations",
      undefined,
      16,
    );
    expect(anchor?.prefixContext).toBe("ther, note that ");

    const sel = extractSelectionHighlightAnchor(document, {
      pageUrl: "https://docs.example.com/spec",
      selection: { toString: () => "gamma", rangeCount: 0 } as unknown as Selection,
      contextLength: 10,
    });
    expect(sel?.quote).toBe("gamma");
    expect(sel?.prefixContext).toBe("lpha beta ");
  });

  test("collects lazy-loaded & srcset images and builds anti-hotlink DNR rules", () => {
    const { document } = parseHTML(`
      <div>
        <img data-original="https://img.example.com/hi.jpg" src="/thumb.jpg" />
        <img srcset="/small.png 320w, https://cdn.example.com/large.png 1280w" />
        <img src="javascript:void(0)" />
      </div>
    `);
    const urls = collectImageUrlsFromDocument(
      document,
      "https://docs.example.com/guide/",
    );
    expect(urls).toEqual([
      "https://img.example.com/hi.jpg",
      "https://cdn.example.com/large.png",
    ]);

    const rules = buildAntiHotlinkDnrRules();
    expect(rules.length).toBeGreaterThanOrEqual(6);
    expect(rules.some((r) => r.condition.requestDomains?.includes("qpic.cn"))).toBe(true);
    expect(parseTagsCsv(" #ai, reading，#ai ")).toEqual(["ai", "reading"]);
    expect(
      resolveWebAppDocUrl({ serverUrl: "http://127.0.0.1:4100", webAppUrl: "http://localhost:5173/" }, "doc_1"),
    ).toBe("http://localhost:5173/docs/doc_1");
  });

  test("mirrorImagesAndPatchDocument handles 409 VERSION_CONFLICT without overwriting user edits", async () => {
    const apiFetch: FetchLike = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/v1/attachments")) {
        return Promise.resolve(
          jsonResponse(
            {
              attachment: {
                id: "att_1",
                workspaceId: "ws_1",
                documentId: "doc_1",
                mimeType: "image/png",
                byteSize: 4,
                sha256: "abc",
                storageKey: "k",
                filename: "fig.png",
                createdAt: "2026-11-24T00:00:00.000Z",
              },
              downloadUrl: "/api/v1/attachments/att_1/download",
            },
            201,
          ),
        );
      }
      if (url.endsWith("/api/v1/documents/doc_1") && init?.method === "PATCH") {
        const bodyStr = typeof init.body === "string" ? init.body : "{}";
        const body = JSON.parse(bodyStr) as { expectedVersion?: number };
        expect(body.expectedVersion).toBe(1);
        return Promise.resolve(
          jsonResponse(
            { error: { code: "VERSION_CONFLICT", message: "Document edited concurrently" } },
            409,
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected API call: ${url}`));
    };

    const imageFetch: FetchLike = () =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );

    const client = createInkadeClient({
      baseUrl: "http://127.0.0.1:4100",
      token: "ink_test",
      fetch: apiFetch,
    });

    const res = await mirrorImagesAndPatchDocument(client, {
      documentId: asDocumentId("doc_1"),
      expectedVersion: 1,
      originalMarkdown: "![fig](https://cdn.example.com/fig.png)",
      imageUrls: ["https://cdn.example.com/fig.png"],
      fetchFn: imageFetch,
    });

    expect(res.mirroredImages).toBe(1);
    expect(res.conflictSkipped).toBe(true);
    expect(res.updatedMarkdown).toBe("![fig](https://cdn.example.com/fig.png)");
  });

  test("syncClipPage supports async mirror tracking, Daily append, lookup deduplication, image clip, selection clip, and ADE dispatch", async () => {
    const createdDoc = {
      id: "doc_clip123",
      workspaceId: "ws_1",
      spaceId: "spc_inbox",
      kind: "clip" as const,
      title: "Clipped Post",
      slug: "clipped-post",
      dailyDate: null,
      contentMarkdown: "Intro ![fig](https://cdn.example.com/fig.png)",
      contentJson: null,
      contentText: "Intro",
      excerpt: "Intro",
      tags: ["research"],
      sourceUrl: "https://example.com/post",
      sourceMeta: {},
      properties: null,
      version: 1,
      pinned: false,
      unreadAgentUpdate: false,
      lastEditedByType: "human" as const,
      trashedAt: null,
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
    };

    let dailyNodeCreated = false;
    let bindingCreated = false;
    const backgroundPromises: Promise<void>[] = [];

    const apiFetch: FetchLike = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";

      if (url.includes("/api/v1/clips/lookup") && method === "GET") {
        return Promise.resolve(
          jsonResponse({
            found: true,
            normalizedUrl: "https://example.com/post",
            document: createdDoc,
            highlights: [],
            threadBindings: [],
          }),
        );
      }
      if (url.endsWith("/api/v1/documents/daily/2026-11-24") && method === "GET") {
        return Promise.resolve(
          jsonResponse({
            document: { ...createdDoc, id: "doc_daily", kind: "outline" },
            nodes: [],
            created: false,
          }),
        );
      }
      if (url.endsWith("/api/v1/outline-nodes") && method === "POST") {
        dailyNodeCreated = true;
        return Promise.resolve(
          jsonResponse(
            {
              node: {
                id: "nod_1",
                documentId: "doc_daily",
                parentNodeId: null,
                orderKey: "a0",
                contentMarkdown: "[[Clipped Post]]",
                contentText: "Clipped Post",
                checked: null,
                collapsed: false,
                authorType: "human",
                authorId: null,
                sourceBindingId: null,
                createdAt: "2026-11-24T00:00:00.000Z",
                updatedAt: "2026-11-24T00:00:00.000Z",
                deletedAt: null,
              },
            },
            201,
          ),
        );
      }
      if (url.endsWith("/api/v1/documents") && method === "POST") {
        return Promise.resolve(jsonResponse({ document: createdDoc }, 201));
      }
      if (url.endsWith("/api/v1/attachments") && method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              attachment: {
                id: "att_img1",
                workspaceId: "ws_1",
                documentId: "doc_clip123",
                mimeType: "image/png",
                byteSize: 4,
                sha256: "def",
                storageKey: "img",
                filename: "fig.png",
                createdAt: "2026-11-24T00:00:00.000Z",
              },
              downloadUrl: "/api/v1/attachments/att_img1/download",
            },
            201,
          ),
        );
      }
      if (url.endsWith("/api/v1/documents/doc_clip123") && method === "PATCH") {
        return Promise.resolve(jsonResponse({ document: { ...createdDoc, version: 2 } }));
      }
      if (url.endsWith("/api/v1/documents/doc_clip123/highlights") && method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              highlight: {
                id: "hl_1",
                workspaceId: "ws_1",
                documentId: "doc_clip123",
                quote: "Important quote",
                prefixContext: "",
                suffixContext: "",
                color: "blue",
                noteMarkdown: "Investigate",
                bindingId: null,
                createdAt: "2026-11-24T00:00:00.000Z",
                updatedAt: "2026-11-24T00:00:00.000Z",
              },
            },
            201,
          ),
        );
      }
      if (url.endsWith("/api/v1/thread-bindings") && method === "POST") {
        bindingCreated = true;
        const bodyStr = typeof init?.body === "string" ? init.body : "{}";
        const body = JSON.parse(bodyStr) as { adeKind: string; status: string };
        expect(body.adeKind).toBe("bb");
        expect(body.status).toBe("queued");
        return Promise.resolve(
          jsonResponse(
            {
              binding: {
                id: "bnd_1",
                workspaceId: "ws_1",
                documentId: "doc_clip123",
                nodeId: "nod_1",
                selectionAnchor: { quote: "Important quote" },
                adeKind: "bb",
                externalWorkspaceId: null,
                externalThreadId: "thr_pending_123",
                deepLink: null,
                title: "Investigate",
                status: "queued",
                lastSummary: "Investigate",
                unreadResult: false,
                lastSyncedAt: "2026-11-24T00:00:00.000Z",
                createdAt: "2026-11-24T00:00:00.000Z",
              },
            },
            201,
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected API call: ${method} ${url}`));
    };

    const imageFetch: FetchLike = () =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );

    const client = createInkadeClient({
      baseUrl: "http://127.0.0.1:4100",
      token: "ink_test",
      fetch: apiFetch,
    });

    const asyncClip = await syncClipPage(client, {
      spaceId: asSpaceId("spc_inbox"),
      mirrorImages: true,
      asyncMirror: true,
      saveHtmlSnapshot: true,
      fetchFn: imageFetch,
      onBackgroundTasks: (p) => backgroundPromises.push(p),
      extracted: {
        url: "https://example.com/post",
        title: "Clipped Post",
        markdown: "Intro ![fig](https://cdn.example.com/fig.png)",
        excerpt: "Intro",
        htmlSnapshot: "<html><body>hi</body></html>",
        cleanHtml: "<p>hi</p>",
        imageUrls: ["https://cdn.example.com/fig.png"],
        meta: { domain: "example.com" },
        variables: {},
        extractor: "defuddle-full",
      },
    });
    expect(asyncClip.mirrorPending).toBe(true);
    await Promise.all(backgroundPromises);

    const dailyNode = await appendClipToDaily(client, {
      title: "Clipped Post",
      url: "https://example.com/post",
      documentId: "doc_clip123",
      date: "2026-11-24",
    });
    expect(dailyNode.id).toBe(asOutlineNodeId("nod_1"));
    expect(dailyNodeCreated).toBe(true);

    const hlRes = await syncHighlightToInkade(client, {
      url: "https://example.com/post",
      anchor: { quote: "Important quote" },
      color: "blue",
      noteMarkdown: "Investigate",
    });
    expect(hlRes.createdClip).toBe(false);

    const imgRes = await saveImageClipToInkade(client, {
      imageUrl: "https://cdn.example.com/fig.png",
      pageUrl: "https://example.com/post",
      spaceId: asSpaceId("spc_inbox"),
      fetchFn: imageFetch,
    });
    expect(imgRes.uploaded).toBe(true);

    const selDoc = await syncSelectionClipToInkade(client, {
      url: "https://example.com/post",
      title: "Selection Note",
      selectionMarkdown: "Highlighted insight",
      spaceId: asSpaceId("spc_inbox"),
    });
    expect(selDoc.id).toBe(asDocumentId("doc_clip123"));

    const dispatchRes = await dispatchClipToAde(client, {
      url: "https://example.com/post",
      spaceId: asSpaceId("spc_inbox"),
      adeKind: "bb",
      prompt: "Investigate",
      selectionAnchor: { quote: "Important quote" },
      appendToDaily: true,
    });
    expect(bindingCreated).toBe(true);
    expect(dispatchRes.binding.status).toBe("queued");

    expect(inferClipImageFilename("https://cdn.example.com/hero.webp", "image/webp", 0)).toBe(
      "hero.webp",
    );
    expect(extractArticleFromDocument).toBeFunction();
    expect(InkadeApiError).toBeDefined();
  });

  test("clipper settings default to open host 'any' and sanitize V4 surfaceTheme/accentPreset cleanly", async () => {
    expect(DEFAULT_CLIPPER_SETTINGS.defaultAdeKind).toBe("any");
    expect(DEFAULT_CLIPPER_SETTINGS.surfaceTheme).toBe("system");
    expect(DEFAULT_CLIPPER_SETTINGS.accentPreset).toBe("mono");

    const store = new Map<string, string>();
    const prevStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });

    try {
      const saved = await saveClipperSettings({
        defaultAdeKind: "Claude-Code",
        surfaceTheme: "dark-dimmed",
        accentPreset: "indigo",
      });
      expect(saved.defaultAdeKind).toBe("claude-code");
      expect(saved.surfaceTheme).toBe("dark-dimmed");
      expect(saved.accentPreset).toBe("indigo");

      // Legacy or corrupted appearance values fall back safely while preserving valid host slugs
      store.set(
        "inkade:clipper:settings",
        JSON.stringify({
          defaultAdeKind: "cursor",
          surfaceTheme: "unknown-theme",
          accentPreset: "neon-pink",
        }),
      );
      const loaded = await loadClipperSettings();
      expect(loaded.defaultAdeKind).toBe("cursor");
      expect(loaded.surfaceTheme).toBe("system");
      expect(loaded.accentPreset).toBe("mono");
    } finally {
      if (prevStorageDescriptor) {
        Object.defineProperty(globalThis, "localStorage", prevStorageDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  });
});
