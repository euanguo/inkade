import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  asDocumentId,
  asEventId,
  asSpaceId,
  asWorkspaceId,
  type DocumentRecord,
  type InkadeEvent,
} from "@inkade/core";
import {
  InkadeApiError,
  InkadeClient,
  inkadeQueryKeys,
  subscribeInkadeEvents,
  type FetchLike,
} from "./index.ts";
import {
  enqueueOfflineMutationWithCache,
  flushOfflineMutationQueue,
  MemoryOfflineCacheBackend,
  type OfflineMutationConflict,
} from "./offline.ts";

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const now = "2026-11-24T00:00:00.000Z";
  return {
    id: asDocumentId("doc_mobile_1"),
    workspaceId: asWorkspaceId("ws_default"),
    spaceId: asSpaceId("spc_inbox"),
    kind: "clip",
    title: "Mobile Offline Test",
    slug: "mobile-offline-test",
    dailyDate: null,
    contentMarkdown: "# Offline",
    contentJson: null,
    contentText: "Offline",
    excerpt: "Offline",
    tags: ["mobile"],
    version: 1,
    pinned: false,
    unreadAgentUpdate: false,
    lastEditedByType: "human",
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("packages/sdk root & offline entrypoints", () => {
  test("root and offline entrypoints load without indexedDB or yjs globals and expose query keys & client", () => {
    expect(typeof globalThis.indexedDB).toBe("undefined");
    expect(inkadeQueryKeys.dailyOutline("2026-11-24")).toEqual([
      "inkade",
      "daily",
      "2026-11-24",
    ]);
    const client = new InkadeClient({ baseUrl: "http://127.0.0.1:4100" });
    expect(client.documents).toBeDefined();
    expect(client.ai).toBeDefined();
    expect(client.search).toBeDefined();
  });

  test("root entrypoint bundle excludes yjs, y-indexeddb, zod, and DOM APIs", async () => {
    const entrypoint = resolve(import.meta.dir, "index.ts");
    const result = await Bun.build({
      entrypoints: [entrypoint],
      target: "bun",
    });
    expect(result.success).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
    const code = await result.outputs[0]!.text();
    expect(code).not.toContain("y-indexeddb");
    expect(code).not.toContain("IndexeddbPersistence");
    expect(code).not.toContain("Y.Doc");
    expect(code).not.toContain("encodeStateVector");
    expect(code).not.toContain("document.createElement");
    expect(code).not.toContain("window.postMessage");
    expect(code).not.toContain("indexedDB");
    expect(code).not.toContain("toJSONSchema");
  });

  test("subscribeInkadeEvents parses split CRLF chunks, updates lastEventId, and honors retry:", async () => {
    const encoder = new TextEncoder();
    const evt1: InkadeEvent<"space.created"> = {
      seq: 7,
      eventId: asEventId("evt_7"),
      workspaceId: asWorkspaceId("ws_default"),
      spaceId: asSpaceId("spc_new"),
      actorType: "human",
      timestamp: "2026-11-24T00:00:00.000Z",
      type: "space.created",
      payload: {
        space: {
          id: asSpaceId("spc_new"),
          workspaceId: asWorkspaceId("ws_default"),
          parentId: null,
          slug: "split-chunk-space",
          name: "Split Chunk Space",
          icon: "folder",
          sortOrder: 0,
          archivedAt: null,
          createdAt: "2026-11-24T00:00:00.000Z",
          updatedAt: "2026-11-24T00:00:00.000Z",
        },
      },
    };
    const rawSse = `id: 7\r\nretry: 50\r\ndata: ${JSON.stringify(evt1)}\r\n\r\n`;
    const crSplitIndex = rawSse.indexOf("\r\n") + 1; // split right between \r and \n!
    const chunks = [rawSse.slice(0, crSplitIndex), rawSse.slice(crSplitIndex)];

    let callCount = 0;
    const seenHeaders: Array<string | null> = [];
    const reconnectDelays: number[] = [];
    const receivedEvents: InkadeEvent[] = [];

    const fakeFetch: FetchLike = (_input, init) => {
      callCount += 1;
      const headers = new Headers(init?.headers);
      seenHeaders.push(headers.get("last-event-id"));
      if (callCount === 1) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const slice of chunks) {
              controller.enqueue(encoder.encode(slice));
            }
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }
      return Promise.reject(new InkadeApiError(403, "FORBIDDEN", "stop reconnect"));
    };

    const sub = subscribeInkadeEvents(
      {
        baseUrl: "http://127.0.0.1:4100",
        fetch: fakeFetch,
        initialRetryDelayMs: 500,
        maxRetryDelayMs: 5000,
      },
      {
        onEvent: (event) => receivedEvents.push(event),
        onReconnect: (_attempt, delayMs) => reconnectDelays.push(delayMs),
      },
    );

    await new Promise((r) => setTimeout(r, 150));
    sub.unsubscribe();

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]?.seq).toBe(7);
    expect(sub.lastEventId).toBe("7");
    expect(reconnectDelays[0]).toBe(50);
    expect(seenHeaders[1]).toBe("7");
  });

  test("flushes offline queue and reconciles 409 conflicts without indexedDB", async () => {
    const backend = new MemoryOfflineCacheBackend();
    await backend.putDocument(makeDoc({ id: asDocumentId("doc_1"), version: 1 }));

    await enqueueOfflineMutationWithCache(
      backend,
      {
        kind: "update_document",
        workspaceId: asWorkspaceId("ws_default"),
        documentId: asDocumentId("doc_1"),
        input: { contentMarkdown: "Offline edit", expectedVersion: 1 },
      },
      "mut_1",
    );
    await enqueueOfflineMutationWithCache(
      backend,
      {
        kind: "create_document",
        workspaceId: asWorkspaceId("ws_default"),
        clientTempId: "tmp_2",
        input: {
          spaceId: asSpaceId("spc_inbox"),
          kind: "clip",
          title: "Captured Offline",
          contentMarkdown: "Thought",
        },
      },
      "mut_2",
    );

    const serverLatest = makeDoc({
      id: asDocumentId("doc_1"),
      version: 4,
      contentMarkdown: "Server latest",
    });
    const fakeFetch: FetchLike = (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/api/v1/documents/doc_1") && method === "PATCH") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "VERSION_CONFLICT", message: "Stale version" },
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/documents/doc_1") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify({ document: serverLatest }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/api/v1/documents") && method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              document: makeDoc({
                id: asDocumentId("doc_created_2"),
                title: "Captured Offline",
              }),
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    };

    const conflicts: OfflineMutationConflict[] = [];
    const client = new InkadeClient({ baseUrl: "http://127.0.0.1:4100", fetch: fakeFetch });
    const result = await flushOfflineMutationQueue(backend, client, {
      onConflict: (c) => conflicts.push(c),
    });

    expect(result.conflicts).toHaveLength(1);
    expect(conflicts[0]?.serverDocument?.version).toBe(4);
    expect(result.applied).toEqual(["mut_2"]);
    expect(result.remaining).toBe(0);
    expect((await backend.getDocument(asDocumentId("doc_1")))?.version).toBe(4);
    expect((await backend.getDocument(asDocumentId("doc_created_2")))?.title).toBe("Captured Offline");
    expect(InkadeApiError).toBeDefined();
  });

  test("queues and replays daily_append offline mutations via daily outline API", async () => {
    const backend = new MemoryOfflineCacheBackend();
    await enqueueOfflineMutationWithCache(
      backend,
      {
        kind: "daily_append",
        workspaceId: asWorkspaceId("ws_default"),
        date: "2026-11-24",
        input: {
          contentMarkdown: "Queued offline daily thought",
          checked: null,
          authorType: "human",
        },
      },
      "mut_daily_1",
    );

    const createdPayloads: Array<Record<string, unknown>> = [];
    const dailyDoc = makeDoc({
      id: asDocumentId("doc_daily_2026_11_24"),
      spaceId: asSpaceId("spc_daily"),
      kind: "outline",
      title: "Daily · 2026-11-24",
      dailyDate: "2026-11-24",
    });

    const fakeFetch: FetchLike = (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/api/v1/documents/daily/2026-11-24") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify({ document: dailyDoc, nodes: [], bindings: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/api/v1/outline-nodes") && method === "POST") {
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        createdPayloads.push(body);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              node: {
                id: "nod_daily_1",
                documentId: dailyDoc.id,
                parentNodeId: null,
                sortOrder: 0,
                contentMarkdown: body.contentMarkdown,
                checked: null,
                collapsed: false,
                authorType: "human",
                createdAt: "2026-11-24T00:00:00.000Z",
                updatedAt: "2026-11-24T00:00:00.000Z",
              },
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    };

    const client = new InkadeClient({ baseUrl: "http://127.0.0.1:4100", fetch: fakeFetch });
    const result = await flushOfflineMutationQueue(backend, client);

    expect(result.applied).toEqual(["mut_daily_1"]);
    expect(result.remaining).toBe(0);
    expect(createdPayloads).toHaveLength(1);
    expect(createdPayloads[0]).toMatchObject({
      documentId: "doc_daily_2026_11_24",
      contentMarkdown: "Queued offline daily thought",
      authorType: "human",
    });
    expect((await backend.getDocument(asDocumentId("doc_daily_2026_11_24")))?.dailyDate).toBe(
      "2026-11-24",
    );
  });
});
