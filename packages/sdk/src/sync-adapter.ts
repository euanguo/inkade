import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { IndexeddbPersistence } from "y-indexeddb";
import * as ySyncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type {
  DocumentId,
  DocumentKind,
  DocumentRecord,
  SpaceId,
  SyncAdapter,
  WorkspaceId,
} from "@inkade/core";
import type { InkadeClient } from "./client.ts";
import {
  enqueueOfflineMutationWithCache,
  flushOfflineMutationQueue,
  MemoryOfflineCacheBackend,
  type FlushOfflineQueueResult,
  type OfflineCacheBackend,
  type OfflineMutationConflict,
  type OfflineMutationPayload,
  type OfflineQueuedMutation,
} from "./offline-queue.ts";

export const YJS_SYNC_MSG_STEP_1 = ySyncProtocol.messageYjsSyncStep1;
export const YJS_SYNC_MSG_STEP_2 = ySyncProtocol.messageYjsSyncStep2;
export const YJS_SYNC_MSG_UPDATE = ySyncProtocol.messageYjsUpdate;
export const YJS_SYNC_MSG_AWARENESS = 3;

interface InkadeOfflineDbSchema extends DBSchema {
  documents: {
    key: DocumentId;
    value: DocumentRecord;
  };
  mutations: {
    key: string;
    value: OfflineQueuedMutation;
  };
}

export class IndexedDbOfflineCacheBackend implements OfflineCacheBackend {
  private dbPromise: Promise<IDBPDatabase<InkadeOfflineDbSchema>> | null = null;

  constructor(private readonly dbName = "inkade-offline-cache") {}

  private openDb(): Promise<IDBPDatabase<InkadeOfflineDbSchema>> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = openDB<InkadeOfflineDbSchema>(this.dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("documents")) {
          db.createObjectStore("documents", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("mutations")) {
          db.createObjectStore("mutations", { keyPath: "id" });
        }
      },
    });
    return this.dbPromise;
  }

  async getDocument(documentId: DocumentId): Promise<DocumentRecord | null> {
    const db = await this.openDb();
    return (await db.get("documents", documentId)) ?? null;
  }

  async putDocument(document: DocumentRecord): Promise<void> {
    const db = await this.openDb();
    await db.put("documents", document);
  }

  async listDocuments(): Promise<readonly DocumentRecord[]> {
    const db = await this.openDb();
    return db.getAll("documents");
  }

  async deleteDocument(documentId: DocumentId): Promise<void> {
    const db = await this.openDb();
    await db.delete("documents", documentId);
  }

  async listMutations(): Promise<readonly OfflineQueuedMutation[]> {
    const db = await this.openDb();
    const res = await db.getAll("mutations");
    return res.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  async putMutation(mutation: OfflineQueuedMutation): Promise<void> {
    const db = await this.openDb();
    await db.put("mutations", mutation);
  }

  async deleteMutation(mutationId: string): Promise<void> {
    const db = await this.openDb();
    await db.delete("mutations", mutationId);
  }

  async clearMutations(): Promise<void> {
    const db = await this.openDb();
    await db.clear("mutations");
  }
}

export function createDefaultOfflineCacheBackend(dbName?: string): OfflineCacheBackend {
  if (typeof globalThis.indexedDB !== "undefined") {
    return new IndexedDbOfflineCacheBackend(dbName);
  }
  return new MemoryOfflineCacheBackend();
}

export class InkadeOfflineSyncAdapter implements SyncAdapter {
  readonly kind = "yjs-indexeddb" as const;
  private workspaceId: WorkspaceId | null = null;
  private mutationSeq = 0;

  constructor(private readonly backend: OfflineCacheBackend = createDefaultOfflineCacheBackend()) {}

  connect(workspaceId: WorkspaceId): Promise<void> {
    this.workspaceId = workspaceId;
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.workspaceId = null;
    return Promise.resolve();
  }

  get connectedWorkspaceId(): WorkspaceId | null {
    return this.workspaceId;
  }

  async cacheDocument(doc: DocumentRecord): Promise<void> {
    await this.backend.putDocument(doc);
  }

  async cacheDocuments(docs: readonly DocumentRecord[]): Promise<void> {
    for (const doc of docs) {
      await this.backend.putDocument(doc);
    }
  }

  getCachedDocument(documentId: DocumentId): Promise<DocumentRecord | null> {
    return this.backend.getDocument(documentId);
  }

  async listCachedDocuments(filter?: {
    readonly workspaceId?: WorkspaceId | undefined;
    readonly spaceId?: SpaceId | undefined;
    readonly kind?: DocumentKind | undefined;
  }): Promise<readonly DocumentRecord[]> {
    const docs = await this.backend.listDocuments();
    return docs.filter((doc) => {
      if (filter?.workspaceId && doc.workspaceId !== filter.workspaceId) return false;
      if (filter?.spaceId && doc.spaceId !== filter.spaceId) return false;
      if (filter?.kind && doc.kind !== filter.kind) return false;
      return true;
    });
  }

  removeCachedDocument(documentId: DocumentId): Promise<void> {
    return this.backend.deleteDocument(documentId);
  }

  enqueueMutation(payload: OfflineMutationPayload): Promise<OfflineQueuedMutation> {
    return enqueueOfflineMutationWithCache(
      this.backend,
      payload,
      `mut_${Date.now()}_${++this.mutationSeq}`,
    );
  }

  listQueuedMutations(): Promise<readonly OfflineQueuedMutation[]> {
    return this.backend.listMutations();
  }

  clearQueuedMutations(): Promise<void> {
    return this.backend.clearMutations();
  }

  flushOfflineQueue(
    client: InkadeClient,
    options?: {
      readonly onConflict?: ((conflict: OfflineMutationConflict) => void) | undefined;
    },
  ): Promise<FlushOfflineQueueResult> {
    return flushOfflineMutationQueue(this.backend, client, options);
  }
}

export type YjsSyncConnectionStatus = "disconnected" | "connecting" | "connected" | "offline";

export interface YjsDocumentSyncClientOptions {
  readonly docId: DocumentId;
  readonly baseUrl?: string | undefined;
  readonly token?: string | undefined;
  readonly ydoc?: Y.Doc | undefined;
  readonly enableIndexedDb?: boolean | undefined;
  readonly indexedDbPrefix?: string | undefined;
  readonly WebSocketImpl?: typeof WebSocket | undefined;
  readonly initialRetryDelayMs?: number | undefined;
  readonly maxRetryDelayMs?: number | undefined;
  readonly onSync?: (() => void) | undefined;
  readonly onError?: ((err: { readonly code: string; readonly message: string }) => void) | undefined;
}

const REMOTE_YJS_ORIGIN = "inkade-yjs-remote";

function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  ySyncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  ySyncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function toWebSocketSyncUrl(baseUrl: string, docId: DocumentId, token?: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const wsBase = cleanBase.startsWith("https://")
    ? `wss://${cleanBase.slice("https://".length)}`
    : cleanBase.startsWith("http://")
      ? `ws://${cleanBase.slice("http://".length)}`
      : cleanBase;
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${wsBase}/api/v1/sync/${encodeURIComponent(docId)}${qs}`;
}

export class YjsDocumentSyncClient {
  readonly docId: DocumentId;
  readonly ydoc: Y.Doc;
  private readonly baseUrl: string | undefined;
  private readonly token: string | undefined;
  private readonly enableIndexedDb: boolean;
  private readonly indexedDbPrefix: string;
  private readonly WebSocketImpl: typeof WebSocket | undefined;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly onSyncCallback: (() => void) | undefined;
  private readonly onErrorCallback:
    | ((err: { readonly code: string; readonly message: string }) => void)
    | undefined;

  private status: YjsSyncConnectionStatus = "disconnected";
  private syncedState = false;
  private closed = false;
  private attempt = 0;
  private ws: WebSocket | null = null;
  private idbPersistence: IndexeddbPersistence | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly statusListeners = new Set<(status: YjsSyncConnectionStatus) => void>();

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE_YJS_ORIGIN) return;
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(encodeSyncUpdate(update));
    }
  };

  constructor(options: YjsDocumentSyncClientOptions) {
    this.docId = options.docId;
    this.ydoc = options.ydoc ?? new Y.Doc();
    this.baseUrl = options.baseUrl;
    this.token = options.token;
    this.enableIndexedDb = options.enableIndexedDb ?? true;
    this.indexedDbPrefix = options.indexedDbPrefix ?? "inkade-yjs:";
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 250;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 10_000;
    this.onSyncCallback = options.onSync;
    this.onErrorCallback = options.onError;

    this.ydoc.on("update", this.handleDocUpdate);
  }

  get synced(): boolean {
    return this.syncedState;
  }

  getStatus(): YjsSyncConnectionStatus {
    return this.status;
  }

  subscribeStatus(listener: (status: YjsSyncConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(next: YjsSyncConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const listener of this.statusListeners) {
      listener(next);
    }
  }

  async connect(): Promise<void> {
    this.closed = false;

    if (this.enableIndexedDb && typeof globalThis.indexedDB !== "undefined" && !this.idbPersistence) {
      this.idbPersistence = new IndexeddbPersistence(
        `${this.indexedDbPrefix}${this.docId}`,
        this.ydoc,
      );
      await this.idbPersistence.whenSynced;
    }

    if (!this.baseUrl || !this.WebSocketImpl) {
      this.setStatus("offline");
      return;
    }

    await this.openSocket();
  }

  private openSocket(): Promise<void> {
    if (this.closed || !this.baseUrl || !this.WebSocketImpl) {
      return Promise.resolve();
    }

    const url = toWebSocketSyncUrl(this.baseUrl, this.docId, this.token);
    this.setStatus("connecting");

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      const socket = new this.WebSocketImpl!(url);
      socket.binaryType = "arraybuffer";
      this.ws = socket;

      socket.addEventListener("open", () => {
        if (this.closed) {
          socket.close();
          finish();
          return;
        }
        this.attempt = 0;
        this.setStatus("connected");
        // Send SyncStep1 so server replies with missing updates and reconciles offline edits.
        socket.send(encodeSyncStep1(this.ydoc));
        finish();
      });

      socket.addEventListener("message", (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (typeof data === "string") {
          try {
            const parsed = JSON.parse(data) as {
              type?: string;
              code?: string;
              message?: string;
            };
            if (parsed.type === "error") {
              this.onErrorCallback?.({
                code: parsed.code ?? "SYNC_ERROR",
                message: parsed.message ?? "Yjs sync error",
              });
            }
          } catch {
            // ignore non-json text
          }
          return;
        }

        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : data instanceof Uint8Array
              ? data
              : null;
        if (!bytes) return;

        try {
          const decoder = decoding.createDecoder(bytes);
          const msgType = decoding.peekVarUint(decoder);
          if (msgType === YJS_SYNC_MSG_AWARENESS) {
            return;
          }
          const replyEncoder = encoding.createEncoder();
          const handledType = ySyncProtocol.readSyncMessage(
            decoder,
            replyEncoder,
            this.ydoc,
            REMOTE_YJS_ORIGIN,
          );
          if (encoding.length(replyEncoder) > 0) {
            socket.send(encoding.toUint8Array(replyEncoder));
          }
          if (
            (handledType === YJS_SYNC_MSG_STEP_2 || handledType === YJS_SYNC_MSG_UPDATE) &&
            !this.syncedState
          ) {
            this.syncedState = true;
            this.onSyncCallback?.();
          }
        } catch {
          // ignore malformed sync frame
        }
      });

      socket.addEventListener("error", () => {
        if (!this.closed) {
          this.setStatus("offline");
        }
        finish();
      });

      socket.addEventListener("close", (evt) => {
        if (this.ws === socket) {
          this.ws = null;
        }
        finish();
        if (this.closed) {
          this.setStatus("disconnected");
          return;
        }
        this.setStatus("offline");
        if (evt.code === 4001 || evt.code === 4003) {
          return;
        }
        const delay = Math.min(this.initialRetryDelayMs * 2 ** this.attempt, this.maxRetryDelayMs);
        this.attempt++;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          void this.openSocket();
        }, delay);
      });
    });
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ydoc.off("update", this.handleDocUpdate);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    if (this.idbPersistence) {
      await this.idbPersistence.destroy();
      this.idbPersistence = null;
    }
    this.setStatus("disconnected");
  }
}
