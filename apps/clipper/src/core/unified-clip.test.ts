import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { asSpaceId, clipperTemplateSchema } from "@inkade/core";
import { createInkadeClient, type FetchLike } from "@inkade/sdk";
import {
  clearPendingPairingSession,
  clearPopupDraft,
  loadPendingPairingSession,
  loadPopupDraft,
  savePendingPairingSession,
  savePopupDraft,
} from "../shared/storage.ts";
import type { ExtractedArticle } from "@inkade/clipper-core/extractor";
import { AI_PROVIDER_PRESETS, testAiProviderConnection } from "./interpreter.ts";
import { enqueueOfflineAction, retryOfflineQueueItem } from "./offline-queue.ts";
import { probeLocalInkadeServers } from "./sync.ts";
import { executeUnifiedClip } from "./unified-clip.ts";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createMemoryStorageArea() {
  const store: Record<string, unknown> = {};
  return {
    get(keys?: string | readonly string[] | null) {
      if (!keys) return Promise.resolve({ ...store });
      const list: readonly string[] = typeof keys === "string" ? [keys] : keys;
      const out: Record<string, unknown> = {};
      for (const k of list) {
        if (k in store) out[k] = store[k];
      }
      return Promise.resolve(out);
    },
    set(items: Record<string, unknown>) {
      Object.assign(store, items);
      return Promise.resolve();
    },
    remove(keys: string | readonly string[]) {
      const list: readonly string[] = typeof keys === "string" ? [keys] : keys;
      for (const k of list) delete store[k];
      return Promise.resolve();
    },
  };
}

const SAMPLE_ARTICLE: ExtractedArticle = {
  url: "https://github.com/inkade/inkade",
  title: "Inkade Knowledge Engine",
  markdown: "# Inkade\n\nBody text",
  excerpt: "Body text",
  htmlSnapshot: "<article><h1>Inkade</h1></article>",
  cleanHtml: "<article><h1>Inkade</h1></article>",
  imageUrls: [],
  meta: {
    domain: "github.com",
  },
  variables: {},
  extractor: "defuddle-full",
};

describe("@inkade/clipper UX V2 unified pipeline, pairing & helpers", () => {
  let prevChrome: unknown;

  beforeEach(() => {
    const g = globalThis as unknown as { chrome?: unknown };
    prevChrome = g.chrome;
    g.chrome = {
      storage: {
        local: createMemoryStorageArea(),
        sync: createMemoryStorageArea(),
        session: createMemoryStorageArea(),
      },
      action: {
        async setBadgeText() {},
        async setBadgeBackgroundColor() {},
      },
    };
  });

  afterEach(() => {
    const g = globalThis as unknown as { chrome?: unknown };
    if (prevChrome === undefined) delete g.chrome;
    else g.chrome = prevChrome;
  });

  test("executeUnifiedClip handles dedupe + tag preservation, metadata-only update, and daily-only templates", async () => {
    const existingDoc = {
      id: "doc_existing",
      workspaceId: "ws_1",
      spaceId: "spc_inbox",
      kind: "clip" as const,
      title: "Inkade Knowledge Engine",
      slug: "inkade",
      dailyDate: null,
      contentMarkdown: "Custom edited notes in Inkade",
      contentJson: null,
      contentText: "Custom edited notes in Inkade",
      excerpt: "Custom",
      tags: ["existing-tag"],
      sourceUrl: SAMPLE_ARTICLE.url,
      sourceMeta: {},
      properties: null,
      version: 2,
      pinned: false,
      unreadAgentUpdate: false,
      lastEditedByType: "human" as const,
      trashedAt: null,
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
    };

    const patches: Array<Record<string, unknown>> = [];
    const createdDailyNodes: string[] = [];

    const apiFetch: FetchLike = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";
      if (url.includes("/api/v1/clips/lookup") && method === "GET") {
        return Promise.resolve(
          jsonResponse({
            found: true,
            normalizedUrl: SAMPLE_ARTICLE.url,
            document: existingDoc,
            highlights: [],
            threadBindings: [],
          }),
        );
      }
      if (url.endsWith("/api/v1/documents/doc_existing") && method === "PATCH") {
        const bodyStr = typeof init?.body === "string" ? init.body : "{}";
        const body = JSON.parse(bodyStr) as Record<string, unknown>;
        patches.push(body);
        return Promise.resolve(jsonResponse({ document: { ...existingDoc, ...body, version: 3 } }));
      }
      if (url.includes("/api/v1/documents/daily/") && method === "GET") {
        return Promise.resolve(
          jsonResponse({
            document: { ...existingDoc, id: "doc_daily", kind: "outline" },
            nodes: [],
            created: false,
          }),
        );
      }
      if (url.endsWith("/api/v1/outline-nodes") && method === "POST") {
        const bodyStr = typeof init?.body === "string" ? init.body : "{}";
        const body = JSON.parse(bodyStr) as { contentMarkdown: string };
        createdDailyNodes.push(body.contentMarkdown);
        return Promise.resolve(
          jsonResponse(
            {
              node: {
                id: "nod_1",
                documentId: "doc_daily",
                parentNodeId: null,
                orderKey: "a0",
                contentMarkdown: body.contentMarkdown,
                contentText: body.contentMarkdown,
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
      return Promise.reject(new Error(`Unexpected API request: ${method} ${url}`));
    };

    const client = createInkadeClient({
      baseUrl: "http://127.0.0.1:4100",
      token: "ink_test",
      fetch: apiFetch,
    });

    const githubTpl = clipperTemplateSchema.parse({
      id: "tpl_gh",
      name: "GitHub",
      triggers: [{ type: "glob", pattern: "https://github.com/*/*" }],
      behavior: "create",
      titleTemplate: "{{title}}",
      tagsTemplate: "github",
      contentTemplate: "{{content}}",
      mirrorImages: false,
      saveHtmlSnapshot: false,
    });

    // 1. Metadata-only update skips overwriting contentMarkdown while merging existing tags
    const metaUpdate = await executeUnifiedClip(client, {
      extracted: SAMPLE_ARTICLE,
      dedupeByUrl: true,
      preserveExistingTags: true,
      updateMetadataOnly: true,
      templates: [githubTpl],
      tags: ["user-tag"],
      title: "Updated Metadata Title",
      spaceId: asSpaceId("spc_research"),
    });
    expect(metaUpdate.updatedExisting).toBe(true);
    expect(patches[0]?.title).toBe("Updated Metadata Title");
    expect(patches[0]?.spaceId).toBe("spc_research");
    expect(patches[0]?.contentMarkdown).toBeUndefined();
    expect(patches[0]?.tags).toEqual(["existing-tag", "user-tag", "github"]);

    // 2. Daily-only template posts directly to Daily outline without document PATCH
    const dailyTpl = clipperTemplateSchema.parse({
      id: "tpl_daily",
      name: "Daily Only",
      triggers: [],
      behavior: "daily-only",
      titleTemplate: "{{title}}",
      contentTemplate: "{{content}}",
      dailyLineTemplate: "- Starred [{{title}}]({{url}})",
    });

    const dailyRes = await executeUnifiedClip(client, {
      extracted: SAMPLE_ARTICLE,
      templates: [dailyTpl],
      templateIdOverride: "tpl_daily",
    });
    expect(dailyRes.dailyOnly).toBe(true);
    expect(createdDailyNodes).toEqual(["- Starred [Inkade Knowledge Engine](https://github.com/inkade/inkade)"]);
  });

  test("probeLocalInkadeServers, testAiProviderConnection, retryOfflineQueueItem, pairing session, and draft storage work", async () => {
    const probed = await probeLocalInkadeServers(
      (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith("http://127.0.0.1:3456/api/v1/health")) {
          return Promise.resolve(jsonResponse({ ok: true, service: "inkade-server", dialect: "sqlite" }));
        }
        return Promise.reject(new TypeError("ECONNREFUSED"));
      },
      ["http://127.0.0.1:4100", "http://127.0.0.1:3456"],
    );
    expect(probed?.serverUrl).toBe("http://127.0.0.1:3456");

    expect(AI_PROVIDER_PRESETS.anthropic.baseUrl).toBe("https://api.anthropic.com");
    const aiCheck = await testAiProviderConnection(
      {
        enabled: true,
        kind: "openai-compatible",
        baseUrl: AI_PROVIDER_PRESETS["openai-compatible"].baseUrl,
        model: AI_PROVIDER_PRESETS["openai-compatible"].model,
        apiKey: "sk-test",
      },
      () => Promise.resolve(jsonResponse({ choices: [{ message: { content: "OK" } }] })),
    );
    expect(aiCheck.ok).toBe(true);

    // Offline item individual retry
    const queued = await enqueueOfflineAction({
      kind: "ingest-url",
      label: "Retry Item",
      payload: { url: "https://example.com/retry", tags: [] },
    });
    const retryRes = await retryOfflineQueueItem(
      createInkadeClient({
        baseUrl: "http://127.0.0.1:4100",
        token: "ink_test",
        fetch: () => Promise.resolve(jsonResponse({ document: { id: "doc_1" }, mirroredImages: 0 })),
      }),
      queued.id,
    );
    expect(retryRes.synced).toBe(true);
    expect(retryRes.remaining).toBe(0);

    // Pending pairing session validates TTL and clears cleanly
    await savePendingPairingSession({
      nonce: "nonce_abc",
      expectedOrigin: "http://localhost:5173",
      createdAt: Date.now(),
    });
    expect((await loadPendingPairingSession())?.nonce).toBe("nonce_abc");
    await clearPendingPairingSession();
    expect(await loadPendingPairingSession()).toBeNull();

    // Popup draft round-trip matches URL
    await savePopupDraft({
      url: "https://example.com/a",
      title: "Draft Title",
      tagsCsv: "tag1, tag2",
      spaceId: asSpaceId("spc_1"),
      highlightNote: "Margin note",
      aiSummary: "- Bullet",
    });
    expect((await loadPopupDraft("https://example.com/a"))?.title).toBe("Draft Title");
    expect(await loadPopupDraft("https://example.com/other")).toBeNull();
    await clearPopupDraft();
    expect(await loadPopupDraft("https://example.com/a")).toBeNull();
  });
});
