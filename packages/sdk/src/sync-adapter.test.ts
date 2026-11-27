import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
  asDocumentId,
  asSpaceId,
  asWorkspaceId,
  type DocumentRecord,
} from "@inkade/core";
import { InkadeClient } from "./client.ts";
import { InkadeApiError } from "./errors.ts";
import { MemoryOfflineCacheBackend, type OfflineMutationConflict } from "./offline.ts";
import {
  InkadeOfflineSyncAdapter,
  YJS_SYNC_MSG_STEP_1,
  YJS_SYNC_MSG_STEP_2,
  YJS_SYNC_MSG_UPDATE,
  YjsDocumentSyncClient,
} from "./sync-adapter.ts";

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const now = "2026-11-24T00:00:00.000Z";
  return {
    id: asDocumentId("doc_test_1"),
    workspaceId: asWorkspaceId("ws_default"),
    spaceId: asSpaceId("spc_research"),
    kind: "article",
    title: "Local First Architecture",
    slug: "local-first-architecture",
    dailyDate: null,
    contentMarkdown: "# Local First",
    contentJson: null,
    contentText: "Local First",
    excerpt: "Local First",
    tags: ["local-first"],
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

describe("packages/sdk SyncAdapter & YjsDocumentSyncClient", () => {
  test("Offline cache stores documents and replays queued creates/updates with 409 conflict handling", async () => {
    const adapter = new InkadeOfflineSyncAdapter(new MemoryOfflineCacheBackend());
    await adapter.connect(asWorkspaceId("ws_default"));
    expect(adapter.kind).toBe("yjs-indexeddb");
    expect(adapter.connectedWorkspaceId).toBe(asWorkspaceId("ws_default"));

    const doc1 = makeDoc({ id: asDocumentId("doc_1"), title: "Doc 1", version: 2 });
    const doc2 = makeDoc({ id: asDocumentId("doc_2"), title: "Doc 2", version: 1 });
    await adapter.cacheDocuments([doc1, doc2]);
    expect((await adapter.listCachedDocuments({ spaceId: asSpaceId("spc_research") })).length).toBe(2);

    // Enqueue: (1) update doc1 with stale version (will 409), (2) create new doc, (3) update doc2
    await adapter.enqueueMutation({
      kind: "update_document",
      workspaceId: asWorkspaceId("ws_default"),
      documentId: asDocumentId("doc_1"),
      input: { contentMarkdown: "Offline stale edit", expectedVersion: 1 },
    });
    // Optimistic cache update applied immediately
    expect((await adapter.getCachedDocument(asDocumentId("doc_1")))?.contentMarkdown).toBe(
      "Offline stale edit",
    );

    await adapter.enqueueMutation({
      kind: "create_document",
      workspaceId: asWorkspaceId("ws_default"),
      clientTempId: "tmp_new",
      input: {
        spaceId: asSpaceId("spc_research"),
        kind: "article",
        title: "Offline Created Note",
        contentMarkdown: "Created while offline",
        tags: ["offline"],
      },
    });
    await adapter.enqueueMutation({
      kind: "update_document",
      workspaceId: asWorkspaceId("ws_default"),
      documentId: asDocumentId("doc_2"),
      input: { contentMarkdown: "Updated doc 2 offline", expectedVersion: 1 },
    });

    expect((await adapter.listQueuedMutations()).length).toBe(3);

    const serverDoc1Latest = makeDoc({
      id: asDocumentId("doc_1"),
      title: "Doc 1",
      contentMarkdown: "Server newer edit",
      version: 3,
    });

    const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/v1/documents/doc_1") && method === "PATCH") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "VERSION_CONFLICT",
                message: "Version mismatch",
                details: { expectedVersion: 1, actualVersion: 3 },
              },
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          ),
        );
      }

      if (url.endsWith("/api/v1/documents/doc_1") && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify({ document: serverDoc1Latest }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/api/v1/documents") && method === "POST") {
        const created = makeDoc({
          id: asDocumentId("doc_created_server"),
          title: "Offline Created Note",
          contentMarkdown: "Created while offline",
          tags: ["offline"],
        });
        return Promise.resolve(
          new Response(JSON.stringify({ document: created }), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/api/v1/documents/doc_2") && method === "PATCH") {
        const updated = makeDoc({
          id: asDocumentId("doc_2"),
          title: "Doc 2",
          contentMarkdown: "Updated doc 2 offline",
          version: 2,
        });
        return Promise.resolve(
          new Response(JSON.stringify({ document: updated }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }) as typeof fetch;

    const client = new InkadeClient({ baseUrl: "http://127.0.0.1:9999", fetch: fakeFetch });
    const observedConflicts: OfflineMutationConflict[] = [];
    const flushResult = await adapter.flushOfflineQueue(client, {
      onConflict: (c) => observedConflicts.push(c),
    });

    expect(flushResult.conflicts).toHaveLength(1);
    expect(observedConflicts).toHaveLength(1);
    expect(flushResult.conflicts[0]?.status).toBe(409);
    expect(flushResult.conflicts[0]?.serverDocument?.version).toBe(3);
    expect(flushResult.applied).toHaveLength(2);
    expect(flushResult.remaining).toBe(0);

    // Cache should now hold serverDoc1Latest and newly created doc
    expect((await adapter.getCachedDocument(asDocumentId("doc_1")))?.version).toBe(3);
    expect((await adapter.getCachedDocument(asDocumentId("doc_created_server")))?.title).toBe(
      "Offline Created Note",
    );
    expect((await adapter.getCachedDocument(asDocumentId("doc_2")))?.version).toBe(2);

    await adapter.disconnect();
    expect(adapter.connectedWorkspaceId).toBeNull();
  });

  test("Retryable 5xx error stops offline queue flush and increments attempts", async () => {
    const adapter = new InkadeOfflineSyncAdapter(new MemoryOfflineCacheBackend());
    await adapter.enqueueMutation({
      kind: "update_document",
      workspaceId: asWorkspaceId("ws_default"),
      documentId: asDocumentId("doc_1"),
      input: { title: "Retry me" },
    });

    const failingClient = new InkadeClient({
      baseUrl: "http://127.0.0.1:9999",
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Busy" } }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
        ),
    });

    const res = await adapter.flushOfflineQueue(failingClient);
    expect(res.applied).toHaveLength(0);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]?.retryable).toBe(true);
    expect(res.remaining).toBe(1);
    const queued = await adapter.listQueuedMutations();
    expect(queued[0]?.attempts).toBe(1);
    expect(InkadeApiError).toBeDefined();
  });

  test("Two YjsDocumentSyncClient docs merge offline concurrent edits over paired WebSocket transport", async () => {
    const encoding = await import("lib0/encoding");
    const decoding = await import("lib0/decoding");
    const encodeVarUint8Frame = (type: number, payload: Uint8Array): Uint8Array => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, type);
      encoding.writeVarUint8Array(enc, payload);
      return encoding.toUint8Array(enc);
    };
    const decodeVarUint8Frame = (bytes: Uint8Array): { msgType: number; payload: Uint8Array } | null => {
      try {
        const dec = decoding.createDecoder(bytes);
        return {
          msgType: decoding.readVarUint(dec),
          payload: decoding.readVarUint8Array(dec),
        };
      } catch {
        return null;
      }
    };

    // In-memory WebSocket relay simulating `/api/v1/sync/:docId` room for two clients
    const serverDoc = new Y.Doc();
    type Listener = (evt: { data?: unknown; code?: number }) => void;
    const peers = new Set<FakeWebSocket>();

    class FakeWebSocket {
      binaryType = "arraybuffer";
      readyState = 0;
      private readonly listeners = new Map<string, Set<Listener>>();

      constructor(_url: string) {
        peers.add(this);
        queueMicrotask(() => {
          this.readyState = 1;
          this.emit("open", {});
          // Server sends initial SyncStep2 + SyncStep1
          const state = Y.encodeStateAsUpdate(serverDoc);
          const sv = Y.encodeStateVector(serverDoc);
          this.emit("message", { data: encodeVarUint8Frame(YJS_SYNC_MSG_STEP_2, state).buffer });
          this.emit("message", { data: encodeVarUint8Frame(YJS_SYNC_MSG_STEP_1, sv).buffer });
        });
      }

      addEventListener(type: string, cb: Listener): void {
        const set = this.listeners.get(type) ?? new Set<Listener>();
        set.add(cb);
        this.listeners.set(type, set);
      }

      send(data: Uint8Array): void {
        const frame = decodeVarUint8Frame(data);
        if (!frame) return;
        if (frame.msgType === YJS_SYNC_MSG_STEP_1) {
          const diff = Y.encodeStateAsUpdate(serverDoc, frame.payload);
          this.emit("message", { data: encodeVarUint8Frame(YJS_SYNC_MSG_STEP_2, diff).buffer });
        } else if (
          frame.msgType === YJS_SYNC_MSG_STEP_2 ||
          frame.msgType === YJS_SYNC_MSG_UPDATE
        ) {
          Y.applyUpdate(serverDoc, frame.payload, this);
          const relay = encodeVarUint8Frame(YJS_SYNC_MSG_UPDATE, frame.payload).buffer;
          for (const other of peers) {
            if (other !== this && other.readyState === 1) {
              other.emit("message", { data: relay });
            }
          }
        }
      }

      close(): void {
        this.readyState = 3;
        peers.delete(this);
        this.emit("close", { code: 1000 });
      }

      private emit(type: string, evt: { data?: unknown; code?: number }): void {
        for (const cb of this.listeners.get(type) ?? []) {
          cb(evt);
        }
      }
    }

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.getText("markdown").insert(0, "Alpha ");
    docB.getText("markdown").insert(0, "Beta ");

    const clientA = new YjsDocumentSyncClient({
      docId: asDocumentId("doc_crdt_1"),
      baseUrl: "http://127.0.0.1:9999",
      ydoc: docA,
      enableIndexedDb: false,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const clientB = new YjsDocumentSyncClient({
      docId: asDocumentId("doc_crdt_1"),
      baseUrl: "http://127.0.0.1:9999",
      ydoc: docB,
      enableIndexedDb: false,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });

    await clientA.connect();
    await clientB.connect();
    await Bun.sleep(30);

    // Concurrent online edit after both joined
    docA.getText("markdown").insert(docA.getText("markdown").length, "Gamma");
    await Bun.sleep(30);

    const textA = docA.getText("markdown").toJSON();
    const textB = docB.getText("markdown").toJSON();
    expect(textA).toBe(textB);
    expect(textA).toContain("Alpha");
    expect(textA).toContain("Beta");
    expect(textA).toContain("Gamma");
    expect(clientA.getStatus()).toBe("connected");

    await clientA.disconnect();
    await clientB.disconnect();
    expect(clientA.getStatus()).toBe("disconnected");
  });
});
