import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { InkadeApiError, type FetchLike, type InkadeClient } from "@inkade/sdk";
import { CLIPPER_OFFLINE_QUEUE_KEY, loadOfflineQueueItems } from "../shared/storage.ts";
import {
  generateAiSummaryAndTags,
  isAiProviderReady,
  resolveTemplateAiPrompts,
  runAiPrompt,
} from "./interpreter.ts";
import {
  clearOfflineQueue,
  enqueueOfflineAction,
  flushOfflineQueue,
  isRetryableNetworkError,
  removeOfflineQueueItem,
} from "./offline-queue.ts";
import type { ExtractedArticle } from "@inkade/clipper-core/extractor";
import { renderClipTemplate } from "@inkade/clipper-core/templates";
import { clipperTemplateSchema } from "@inkade/core";

const SAMPLE_ARTICLE: ExtractedArticle = {
  url: "https://example.com/post",
  title: "Designing Local-First Knowledge Tools",
  markdown: "# Designing Local-First Knowledge Tools\n\nCRDTs enable offline-first sync with predictable merges.",
  excerpt: "CRDTs enable offline-first sync",
  htmlSnapshot: "<article><h1>Designing Local-First Knowledge Tools</h1></article>",
  cleanHtml: "<article><h1>Designing Local-First Knowledge Tools</h1></article>",
  imageUrls: [],
  meta: {
    domain: "example.com",
    author: "Inkade Lab",
  },
  variables: {},
  extractor: "defuddle-full",
};

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

function readFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function readFetchBody(init?: RequestInit): string {
  return typeof init?.body === "string" ? init.body : "{}";
}

describe("@inkade/clipper Phase C4 interpreter & offline queue", () => {
  let prevChrome: unknown;
  let badgeState: { text: string; color: string };

  beforeEach(() => {
    const g = globalThis as unknown as { chrome?: unknown; browser?: unknown };
    prevChrome = g.chrome;
    badgeState = { text: "", color: "" };
    const localArea = createMemoryStorageArea();
    const syncArea = createMemoryStorageArea();
    g.chrome = {
      storage: { local: localArea, sync: syncArea },
      action: {
        setBadgeText(details: { text: string }) {
          badgeState.text = details.text;
          return Promise.resolve();
        },
        setBadgeBackgroundColor(details: { color: string }) {
          badgeState.color = details.color;
          return Promise.resolve();
        },
      },
    };
  });

  afterEach(() => {
    const g = globalThis as unknown as { chrome?: unknown };
    if (prevChrome === undefined) {
      delete g.chrome;
    } else {
      g.chrome = prevChrome;
    }
  });

  test("runAiPrompt supports OpenAI-compatible, Anthropic, and Gemini BYOK endpoints", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];

    const openaiFetch: FetchLike = (input, init) => {
      seen.push({
        url: readFetchUrl(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(readFetchBody(init)),
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "- Point A\n- Point B" } }] }),
          { status: 200 },
        ),
      );
    };
    const openaiOut = await runAiPrompt(
      {
        enabled: true,
        kind: "openai-compatible",
        baseUrl: "https://api.example.ai/v1/",
        model: "gpt-4o-mini",
        apiKey: "sk-test-openai",
      },
      { prompt: "Summarize", article: SAMPLE_ARTICLE, fetchFn: openaiFetch },
    );
    expect(openaiOut).toBe("- Point A\n- Point B");
    expect(seen[0]?.url).toBe("https://api.example.ai/v1/chat/completions");
    expect(seen[0]?.headers.authorization).toBe("Bearer sk-test-openai");

    const anthropicFetch: FetchLike = (input, init) => {
      seen.push({
        url: readFetchUrl(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(readFetchBody(init)),
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "Claude summary" }] }),
          { status: 200 },
        ),
      );
    };
    const claudeOut = await runAiPrompt(
      {
        enabled: true,
        kind: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-3-5-sonnet",
        apiKey: "ak-test",
      },
      { prompt: "Key points", article: SAMPLE_ARTICLE, fetchFn: anthropicFetch },
    );
    expect(claudeOut).toBe("Claude summary");
    expect(seen[1]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[1]?.headers["x-api-key"]).toBe("ak-test");

    const geminiFetch: FetchLike = (input, init) => {
      seen.push({
        url: readFetchUrl(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(readFetchBody(init)),
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Gemini insights" }] } }] }),
          { status: 200 },
        ),
      );
    };
    const geminiOut = await runAiPrompt(
      {
        enabled: true,
        kind: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.0-flash",
        apiKey: "gm-key",
      },
      { prompt: "Insights", article: SAMPLE_ARTICLE, fetchFn: geminiFetch },
    );
    expect(geminiOut).toBe("Gemini insights");
    expect(seen[2]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=gm-key",
    );
  });

  test("resolveTemplateAiPrompts replaces prompt placeholders and generateAiSummaryAndTags parses JSON", async () => {
    const tpl = clipperTemplateSchema.parse({
      id: "tpl_ai",
      name: "AI Note",
      triggers: [],
      titleTemplate: "{{title}}",
      tagsTemplate: "clip",
      contentTemplate: `## Summary\n{{"Summarize in 2 bullets"}}\n\n{{content}}`,
    });
    const plan = renderClipTemplate(tpl, { article: SAMPLE_ARTICLE });
    expect(plan.pendingPrompts).toHaveLength(1);

    const stripped = await resolveTemplateAiPrompts(
      { enabled: false, kind: "openai-compatible", baseUrl: "", model: "gpt-4o-mini", apiKey: "" },
      SAMPLE_ARTICLE,
      plan,
    );
    expect(stripped.pendingPrompts).toHaveLength(0);
    expect(stripped.contentMarkdown).not.toContain("<!--inkade-ai-prompt");

    const resolved = await resolveTemplateAiPrompts(
      {
        enabled: true,
        kind: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-key",
      },
      SAMPLE_ARTICLE,
      plan,
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: "- Insight 1\n- Insight 2" } }] }),
            { status: 200 },
          ),
        ),
    );
    expect(resolved.contentMarkdown).toContain("- Insight 1\n- Insight 2");
    expect(resolved.contentMarkdown).not.toContain("<!--inkade-ai-prompt");

    expect(
      isAiProviderReady({
        enabled: true,
        kind: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-key",
      }),
    ).toBe(true);

    const enriched = await generateAiSummaryAndTags(
      {
        enabled: true,
        kind: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-key",
      },
      SAMPLE_ARTICLE,
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '```json\n{"summary":"- CRDT summary","tags":["#local-first","crdt"]}\n```',
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
    );
    expect(enriched.summary).toBe("- CRDT summary");
    expect(enriched.tags).toEqual(["local-first", "crdt"]);
  });

  test("offline queue classifies retryable errors, enqueues FIFO items, updates badge, and flushes cleanly", async () => {
    expect(isRetryableNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableNetworkError(new InkadeApiError(503, "SERVICE_UNAVAILABLE", "down"))).toBe(true);
    expect(isRetryableNetworkError(new InkadeApiError(403, "SCOPE_FORBIDDEN", "denied"))).toBe(false);

    const item1 = await enqueueOfflineAction({
      kind: "ingest-url",
      label: "First offline URL",
      payload: { url: "https://example.com/1", tags: [] },
      error: new TypeError("Failed to fetch"),
    });
    const item2 = await enqueueOfflineAction({
      kind: "append-daily",
      label: "Second daily link",
      payload: {
        title: "Doc Two",
        url: "https://example.com/2",
        documentId: "doc_2",
        date: "2026-11-24",
      },
    });
    expect(badgeState.text).toBe("2");
    expect(await loadOfflineQueueItems()).toHaveLength(2);
    expect(CLIPPER_OFFLINE_QUEUE_KEY).toBe("inkade:clipper:offline-queue");

    let dailyFailOnce = true;
    const called: string[] = [];
    const mockClient = {
      clips: {
        ingestUrl(input: { url: string }) {
          called.push(`ingest:${input.url}`);
          return Promise.resolve({ document: { id: "doc_1" } });
        },
      },
      documents: {
        getDaily(date: string) {
          called.push(`daily:${date}`);
          if (dailyFailOnce) {
            dailyFailOnce = false;
            return Promise.reject(new TypeError("Failed to fetch"));
          }
          return Promise.resolve({ document: { id: "doc_daily" } });
        },
      },
      outlineNodes: {
        create(input: { documentId: string; contentMarkdown: string }) {
          called.push(`outline:${input.documentId}`);
          return Promise.resolve({ id: "node_1", ...input });
        },
      },
    } as unknown as InkadeClient;

    const firstFlush = await flushOfflineQueue(mockClient);
    expect(firstFlush.synced).toBe(1);
    expect(firstFlush.remaining).toBe(1);
    expect(badgeState.text).toBe("1");

    const remainingBeforeRetry = await loadOfflineQueueItems();
    expect(remainingBeforeRetry[0]?.id).toBe(item2.id);
    expect(remainingBeforeRetry[0]?.attempts).toBe(1);

    const secondFlush = await flushOfflineQueue(mockClient);
    expect(secondFlush.synced).toBe(1);
    expect(secondFlush.remaining).toBe(0);
    expect(badgeState.text).toBe("");
    expect(called).toContain("outline:doc_daily");

    const item3 = await enqueueOfflineAction({
      kind: "ingest-url",
      label: "Remove me",
      payload: { url: "https://example.com/3" },
    });
    expect(item1.id).not.toBe(item3.id);
    await removeOfflineQueueItem(item3.id);
    expect(await loadOfflineQueueItems()).toHaveLength(0);

    await enqueueOfflineAction({ kind: "ingest-url", label: "Clear me", payload: { url: "https://a.com" } });
    await clearOfflineQueue();
    expect(await loadOfflineQueueItems()).toHaveLength(0);
  });
});
