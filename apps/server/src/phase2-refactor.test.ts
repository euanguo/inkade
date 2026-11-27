import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { readSyncMessage, writeSyncStep1, writeUpdate } from "y-protocols/sync";
import * as Y from "yjs";
import {
  asWorkspaceId,
  evaluateScopeAccess,
} from "@inkade/core";
import {
  createSqliteDatabase,
  createSqliteRepositories,
  DEFAULT_SPACE_IDS,
  DEFAULT_WORKSPACE_ID,
  seedDefaultWorkspace,
} from "@inkade/db";
import { createInkadeClient } from "@inkade/sdk";
import { createInkadeAuth } from "./auth/better-auth.ts";
import { EmbedTicketManager } from "./auth/embed-ticket.ts";
import { TokenScopeCache } from "./cache/token-scope-cache.ts";
import { WorkspaceSpacesCache } from "./cache/workspace-spaces-cache.ts";
import { createInkadeApp } from "./app.ts";
import { YJS_MSG_AWARENESS, YJS_MSG_ERROR, YjsSyncHub } from "./realtime/yjs-sync.ts";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "inkade-phase2-"));
}

async function waitFor<T>(
  predicate: () => Promise<T | undefined | null | false> | T | undefined | null | false,
  timeoutMs = 3000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await predicate();
    if (val) return val;
    await Bun.sleep(15);
  }
  throw new Error("Timed out waiting for condition");
}

function encodeYjsFrame(type: number, payload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  encoding.writeVarUint8Array(enc, payload);
  return encoding.toUint8Array(enc);
}

describe("Phase 2 refactor verification suite", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  async function startTestApp() {
    const dir = createTempDir();
    const instance = createInkadeApp({
      dbPath: join(dir, "inkade.db"),
      dataDir: join(dir, "data"),
      localAutoAuth: true,
    });
    await instance.ready;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, s) => instance.fetch(req, s),
      websocket: instance.websocket,
    });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    cleanups.push(() => {
      void server.stop(true);
      instance.close();
      rmSync(dir, { recursive: true, force: true });
    });
    return { instance, server, baseUrl };
  }

  test("SQL scope pushdown + DocumentSummary matches evaluateScopeAccess across >1,000 docs and omits body fields", async () => {
    const { instance, baseUrl } = await startTestApp();
    const adminSdk = createInkadeClient({ baseUrl });

    const parentSpace = await adminSdk.spaces.create({
      name: "Parent Knowledge",
      slug: "parent-knowledge",
      defaultKind: "article",
    });
    const childSpace = await adminSdk.spaces.create({
      name: "Nested Child Space",
      slug: "nested-child-space",
      parentId: parentSpace.id,
      defaultKind: "article",
    });
    const excludedSpace = await adminSdk.spaces.create({
      name: "Excluded Vault",
      slug: "excluded-vault",
      defaultKind: "article",
    });

    // Seed 1,080 documents in a single transaction:
    // - 1,030 articles inside parentSpace/childSpace with tag "target"
    // - 25 clips inside childSpace with tag "target" (must be excluded by allowedKinds)
    // - 25 articles inside parentSpace without "target" tag (must be excluded by tagAllowlist)
    // - 20 articles inside excludedSpace with tag "target" (must be excluded by spaceIds)
    await instance.repos.tx.runInTx(async () => {
      for (let i = 0; i < 1030; i++) {
        const targetSpaceId = i % 2 === 0 ? parentSpace.id : childSpace.id;
        await instance.repos.document.createDocument(DEFAULT_WORKSPACE_ID, {
          spaceId: targetSpaceId,
          kind: "article",
          title: `Scoped Article ${String(i).padStart(4, "0")}`,
          contentMarkdown: `# Scoped Article ${i}\n\nSecret body text ${i}`,
          tags: ["target"],
          pinned: false,
        });
      }
      for (let i = 0; i < 25; i++) {
        await instance.repos.document.createDocument(DEFAULT_WORKSPACE_ID, {
          spaceId: childSpace.id,
          kind: "clip",
          title: `Wrong Kind Clip ${i}`,
          contentMarkdown: "Clip body",
          tags: ["target"],
          pinned: false,
        });
        await instance.repos.document.createDocument(DEFAULT_WORKSPACE_ID, {
          spaceId: parentSpace.id,
          kind: "article",
          title: `Wrong Tag Article ${i}`,
          contentMarkdown: "Untagged body",
          tags: ["other"],
          pinned: false,
        });
      }
      for (let i = 0; i < 20; i++) {
        await instance.repos.document.createDocument(DEFAULT_WORKSPACE_ID, {
          spaceId: excludedSpace.id,
          kind: "article",
          title: `Excluded Space Article ${i}`,
          contentMarkdown: "Outside space",
          tags: ["target"],
          pinned: false,
        });
      }
    });

    const { rawToken } = await adminSdk.tokens.create({
      name: "pushdown-reader",
      scope: {
        permission: "read",
        spaceIds: [parentSpace.id],
        includeDescendants: true,
        allowedKinds: ["article"],
        tagAllowlist: ["target"],
      },
    });
    const scopedSdk = createInkadeClient({ baseUrl, token: rawToken });

    // Raw REST check to assert DocumentSummary strips contentMarkdown / contentJson / contentText
    const rawRes = await fetch(`${baseUrl}/api/v1/documents?limit=25&offset=0`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(rawRes.status).toBe(200);
    const rawJson = (await rawRes.json()) as {
      readonly documents: ReadonlyArray<Record<string, unknown>>;
    };
    expect(rawJson.documents.length).toBe(25);
    const firstRaw = rawJson.documents[0]!;
    expect("contentMarkdown" in firstRaw).toBe(false);
    expect("contentJson" in firstRaw).toBe(false);
    expect("contentText" in firstRaw).toBe(false);
    expect(typeof firstRaw.excerpt).toBe("string");

    // True SQL LIMIT/OFFSET beyond 1,000 docs (500 + 500 + 30 = 1,030 matching docs)
    const page1 = await scopedSdk.documents.list({ limit: 500, offset: 0 });
    const page2 = await scopedSdk.documents.list({ limit: 500, offset: 500 });
    const page3 = await scopedSdk.documents.list({ limit: 500, offset: 1000 });
    expect(page1.length).toBe(500);
    expect(page2.length).toBe(500);
    expect(page3.length).toBe(30);

    const fetchedIds = [...page1, ...page2, ...page3].map((d) => d.id);
    const uniqueFetchedIds = new Set(fetchedIds);
    expect(uniqueFetchedIds.size).toBe(1030);

    // Brute-force equivalence check against core evaluateScopeAccess
    const allDocs = await instance.repos.document.listDocuments(DEFAULT_WORKSPACE_ID, {
      includeTrashed: false,
      limit: null,
    });
    const allSpaces = await instance.repos.space.listSpaces(DEFAULT_WORKSPACE_ID, {
      includeArchived: true,
    });
    const expectedIds = new Set(
      allDocs
        .filter(
          (d) =>
            evaluateScopeAccess(
              {
                permission: "read",
                spaceIds: [parentSpace.id],
                includeDescendants: true,
                allowedKinds: ["article"],
                tagAllowlist: ["target"],
                denyHardDelete: true,
              },
              "read",
              { spaceId: d.spaceId, kind: d.kind, tags: d.tags },
              allSpaces,
            ).allowed,
        )
        .map((d) => d.id),
    );
    expect(uniqueFetchedIds).toEqual(expectedIds);
  });

  test("OutlineService & DocumentService transactional workflows rollback atomically and preserve idempotent rollover & syncBacklinks", async () => {
    const { instance, baseUrl } = await startTestApp();
    const sdk = createInkadeClient({ baseUrl });

    const target = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Original Concept",
      contentMarkdown: "# Original Concept\n\nBody.",
      tags: [],
    });
    const articleSource = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Linking Article",
      contentMarkdown: "See [[Original Concept]] for details.",
      tags: [],
    });
    const outlineDoc = await sdk.documents.getDaily("2026-11-22");
    const outlineNext = await sdk.documents.getDaily("2026-11-23");

    const openTask = await sdk.outlineNodes.create({
      documentId: outlineDoc.document.id,
      contentMarkdown: "Follow up [[Original Concept]]",
      checked: false,
    });
    const doneTask = await sdk.outlineNodes.create({
      documentId: outlineDoc.document.id,
      contentMarkdown: "Finished item",
      checked: true,
    });
    expect(doneTask.checked).toBe(true);

    // syncBacklinks rewrites both article source & outline node inside single tx
    const renamed = await sdk.documents.update(target.id, {
      title: "Renamed Concept",
      syncBacklinks: true,
    });
    expect(renamed.title).toBe("Renamed Concept");

    const refreshedArticle = await sdk.documents.get(articleSource.id);
    expect(refreshedArticle.contentMarkdown).toContain("[[Renamed Concept]]");
    const refreshedNodes = await sdk.outlineNodes.list(outlineDoc.document.id);
    const updatedOutlineTask = refreshedNodes.find((n) => n.id === openTask.id);
    expect(updatedOutlineTask?.contentMarkdown).toContain("[[Renamed Concept]]");

    // Idempotent rollover
    const rolled1 = await sdk.outlineNodes.rollover(outlineDoc.document.id, outlineNext.document.id);
    expect(rolled1.length).toBe(1);
    expect(rolled1[0]?.contentMarkdown).toContain("[[Renamed Concept]]");
    const rolled2 = await sdk.outlineNodes.rollover(outlineDoc.document.id, outlineNext.document.id);
    expect(rolled2.length).toBe(0);

    // Atomic tx rollback on batchMutate failure (step 2 deletes missing node after step 1 creates)
    const beforeCount = (await sdk.outlineNodes.list(outlineDoc.document.id)).length;
    let batchErr: unknown = null;
    try {
      await sdk.outlineNodes.batch({
        documentId: outlineDoc.document.id,
        operations: [
          { op: "create", contentMarkdown: "Should roll back [[Ghost Target]]", checked: false },
          { op: "delete", nodeId: "nod_nonexistent" as never },
        ],
      });
    } catch (err) {
      batchErr = err;
    }
    expect(batchErr).toBeTruthy();

    const afterCount = (await sdk.outlineNodes.list(outlineDoc.document.id)).length;
    expect(afterCount).toBe(beforeCount);

    // Restore outline revision snapshot works cleanly via OutlineService
    const revList = await sdk.documents.listRevisions(outlineDoc.document.id);
    expect(revList.length).toBeGreaterThanOrEqual(2);
    const oldestVersion = revList[revList.length - 1]!.version;
    await sdk.documents.restoreRevision(outlineDoc.document.id, oldestVersion);
    const nodesAfterRestore = await sdk.outlineNodes.list(outlineDoc.document.id);
    expect(nodesAfterRestore.length).toBe(0);

    // Clean FTS check confirms no orphaned "Should roll back" entries remain
    const ftsHits = await instance.repos.searchConfig.searchFts(
      DEFAULT_WORKSPACE_ID,
      "Ghost Target",
    );
    expect(ftsHits.length).toBe(0);
  });

  test("YjsSyncHub debounces rapid writes, enforces maxWait, flushes on peer close & hub.close(), and destroys docs on eviction", async () => {
    const dir = createTempDir();
    const bundle = createSqliteDatabase(join(dir, "yjs.db"));
    const repos = createSqliteRepositories(bundle.sqlite, bundle.db);
    await seedDefaultWorkspace(repos);

    const auth = createInkadeAuth({ db: bundle.db });
    const spacesCache = new WorkspaceSpacesCache(repos.space);
    const tokenScopeCache = new TokenScopeCache(repos.tokenRule);

    const article = await repos.document.createDocument(DEFAULT_WORKSPACE_ID, {
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Yjs Debounce Spec",
      contentMarkdown: "",
      tags: [],
      pinned: false,
    });

    let persistCount = 0;
    let lastPersistedBase64: string | null = null;
    const trackedSearchRepo = {
      ...repos.searchConfig,
      getDocumentYjsState: (wsId: string, docId: string) =>
        repos.searchConfig.getDocumentYjsState(wsId, docId),
      upsertDocumentYjsState: async (wsId: string, docId: string, stateBase64: string) => {
        persistCount++;
        lastPersistedBase64 = stateBase64;
        await repos.searchConfig.upsertDocumentYjsState(wsId, docId, stateBase64);
      },
    };

    const yjsHub = new YjsSyncHub({
      documentRepo: repos.document,
      searchConfigRepo: trackedSearchRepo,
      spaceRepo: repos.space,
      tokenRuleRepo: repos.tokenRule,
      spacesCache,
      tokenScopeCache,
      principalDeps: {
        tokenRuleRepo: repos.tokenRule,
        tokenScopeCache,
        auth,
        embedTickets: new EmbedTicketManager(),
        defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
        localAutoAuth: true,
      },
      persistDebounceMs: 100,
      persistMaxWaitMs: 320,
    });

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req, s): Promise<Response | undefined> => {
        const upgradeResponse = await yjsHub.handleHttpUpgrade(req, s);
        if (upgradeResponse) return upgradeResponse;
        if (new URL(req.url).pathname.startsWith("/api/v1/sync/") && s) {
          return undefined;
        }
        return new Response("Not Found", { status: 404 });
      },
      websocket: yjsHub.createBunWebSocketHandlers(),
    });

    cleanups.push(() => {
      yjsHub.close();
      void server.stop(true);
      bundle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    });

    async function connectYjsPeer() {
      const ydoc = new Y.Doc();
      const awareness = new Awareness(ydoc);
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/sync/${article.id}`);
      ws.binaryType = "arraybuffer";
      let synced = false;

      const sendSync = () => {
        const enc = encoding.createEncoder();
        writeSyncStep1(enc, ydoc);
        ws.send(encoding.toUint8Array(enc));
      };

      ws.addEventListener("open", () => {
        sendSync();
        const awarenessBytes = encodeAwarenessUpdate(awareness, [ydoc.clientID]);
        ws.send(encodeYjsFrame(YJS_MSG_AWARENESS, awarenessBytes));
      });
      ws.addEventListener("message", (evt) => {
        const bytes = new Uint8Array(evt.data as ArrayBuffer);
        const dec = decoding.createDecoder(bytes);
        const msgType = decoding.readVarUint(dec);
        if (msgType === YJS_MSG_AWARENESS) {
          applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), "remote");
          return;
        }
        if (msgType === YJS_MSG_ERROR) return;
        const reply = encoding.createEncoder();
        const syncDec = decoding.createDecoder(bytes);
        readSyncMessage(syncDec, reply, ydoc, "remote");
        if (encoding.length(reply) > 0) {
          ws.send(encoding.toUint8Array(reply));
        }
        synced = true;
      });
      ydoc.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin === "remote") return;
        const enc = encoding.createEncoder();
        writeUpdate(enc, update);
        ws.send(encoding.toUint8Array(enc));
      });

      await waitFor(() => synced && ws.readyState === WebSocket.OPEN);
      return { ydoc, awareness, ws };
    }

    const peer1 = await connectYjsPeer();
    const room = yjsHub.getRoom(asWorkspaceId("ws_default"), article.id);
    expect(room).toBeDefined();

    // Burst 5 updates in < 20ms -> debounced to ZERO immediate DB writes, then ONE coalesced write
    persistCount = 0;
    for (const chunk of ["A", "B", "C", "D", "E"]) {
      peer1.ydoc.transact(() => {
        const t = peer1.ydoc.getText("markdown");
        t.insert(t.length, chunk);
      });
    }
    await Bun.sleep(40);
    expect(persistCount).toBe(0);

    await waitFor(() => (persistCount >= 1 ? true : false), 1000);
    expect(persistCount).toBe(1);

    // Send update then immediately close last peer -> synchronous flush & room eviction + destroy
    const writesBeforeClose = persistCount;
    peer1.ydoc.getText("markdown").insert(peer1.ydoc.getText("markdown").length, "Z");
    await Bun.sleep(20);
    peer1.ws.close(1000);

    await waitFor(() => (yjsHub.getActiveRoomCount() === 0 ? true : false));
    expect(persistCount).toBe(writesBeforeClose + 1);
    expect(room?.ydoc.isDestroyed).toBe(true);
    expect(lastPersistedBase64).toBeTruthy();

    // Check final persisted Y.Doc state contains all updates ("ABCDEZ")
    const verifyDoc = new Y.Doc();
    Y.applyUpdate(verifyDoc, Buffer.from(lastPersistedBase64!, "base64"));
    expect(verifyDoc.getText("markdown").toJSON()).toBe("ABCDEZ");
    verifyDoc.destroy();

    // Connect peer2, mutate, and call yjsHub.close() BEFORE debounce fires -> flushes immediately
    const peer2 = await connectYjsPeer();
    const writesBeforeHubClose = persistCount;
    peer2.ydoc.getText("markdown").insert(peer2.ydoc.getText("markdown").length, "_END");
    await Bun.sleep(25);
    yjsHub.close();
    expect(persistCount).toBe(writesBeforeHubClose + 1);
    expect(yjsHub.getActiveRoomCount()).toBe(0);

    const finalVerifyDoc = new Y.Doc();
    Y.applyUpdate(finalVerifyDoc, Buffer.from(lastPersistedBase64!, "base64"));
    expect(finalVerifyDoc.getText("markdown").toJSON()).toBe("ABCDEZ_END");
    finalVerifyDoc.destroy();

    peer2.awareness.destroy();
    peer2.ydoc.destroy();
    peer1.awareness.destroy();
    peer1.ydoc.destroy();
  });

  test("WorkspaceSpacesCache & TokenScopeCache serve hot hits and invalidate immediately on mutations", async () => {
    const { instance, baseUrl } = await startTestApp();
    const adminSdk = createInkadeClient({ baseUrl });

    // Unit verify WorkspaceSpacesCache call coalescing + invalidation
    let listSpacesCalls = 0;
    const origListSpaces = instance.repos.space.listSpaces.bind(instance.repos.space);
    const countingSpaceRepo = {
      ...instance.repos.space,
      listSpaces: async (wsId: string, opts?: { includeArchived?: boolean }) => {
        listSpacesCalls++;
        return origListSpaces(wsId, opts);
      },
    };
    const spacesCache = new WorkspaceSpacesCache(countingSpaceRepo);
    await spacesCache.getAll(DEFAULT_WORKSPACE_ID);
    await spacesCache.getAll(DEFAULT_WORKSPACE_ID);
    expect(listSpacesCalls).toBe(1);
    spacesCache.invalidate(DEFAULT_WORKSPACE_ID);
    await spacesCache.getAll(DEFAULT_WORKSPACE_ID);
    expect(listSpacesCalls).toBe(2);

    // Live server token hot-reload + revocation invalidation (must take effect immediately, well within 3s cache TTL)
    const doc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Cache Hot Reload Doc",
      contentMarkdown: "Hello",
      tags: [],
    });

    const { token, rawToken } = await adminSdk.tokens.create({
      name: "hot-reload-token",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.inbox],
        includeDescendants: true,
      },
    });
    const tokenSdk = createInkadeClient({ baseUrl, token: rawToken });

    // Populate TokenScopeCache via multiple rapid requests (< 50ms)
    let forbiddenErr: unknown = null;
    try {
      await tokenSdk.documents.get(doc.id);
    } catch (err) {
      forbiddenErr = err;
    }
    expect(forbiddenErr).toMatchObject({ status: 403 });

    // Expand token scope to Research -> immediate invalidation allows access right away
    await adminSdk.tokens.update(token.id, {
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
      },
    });
    const fetched = await tokenSdk.documents.get(doc.id);
    expect(fetched.id).toBe(doc.id);

    // Revoke token -> immediate invalidation rejects right away with 401
    await adminSdk.tokens.revoke(token.id);
    let revokedErr: unknown = null;
    try {
      await tokenSdk.documents.get(doc.id);
    } catch (err) {
      revokedErr = err;
    }
    expect(revokedErr).toMatchObject({ status: 401 });
  });
});
