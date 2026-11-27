import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import {
  messageYjsSyncStep1,
  messageYjsSyncStep2,
  messageYjsUpdate,
  readSyncMessage,
  writeSyncStep1,
  writeSyncStep2,
  writeUpdate,
} from "y-protocols/sync";
import * as Y from "yjs";
import {
  asDocumentId,
  evaluateScopeAccess,
  isInkadeError,
  type DocumentId,
  type DocumentRecord,
  type TokenScope,
  type WorkspaceId,
} from "@inkade/core";
import type { DocumentRepo, SearchConfigRepo, SpaceRepo, TokenRuleRepo } from "@inkade/db";
import {
  resolveCurrentPrincipalScope,
  resolvePrincipalFromRequest,
  type PrincipalResolverDeps,
} from "../auth/principal.ts";
import type { TokenScopeCache } from "../cache/token-scope-cache.ts";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { ServerLogger } from "../logger.ts";
import type { Principal } from "../types.ts";

export const YJS_MSG_SYNC_STEP_1 = messageYjsSyncStep1;
export const YJS_MSG_SYNC_STEP_2 = messageYjsSyncStep2;
export const YJS_MSG_UPDATE = messageYjsUpdate;
export const YJS_MSG_AWARENESS = 3;
export const YJS_MSG_ERROR = 4;

const DEFAULT_PERSIST_DEBOUNCE_MS = 500;
const DEFAULT_PERSIST_MAX_WAIT_MS = 3_000;
const DB_BOOTSTRAP_ORIGIN = "db-bootstrap";
const PEER_CLOSE_ORIGIN = "peer-close";

export type YjsWsJsonMessage =
  | { readonly type: "sync-step-1"; readonly stateVectorBase64?: string | undefined }
  | { readonly type: "sync-step-2"; readonly updateBase64: string }
  | { readonly type: "update"; readonly updateBase64: string }
  | { readonly type: "error"; readonly code: string; readonly message: string };

export interface YjsPeerData {
  readonly peerId: string;
  readonly documentId: DocumentId;
  readonly principal: Principal;
  readonly sendBinary: (bytes: Uint8Array) => void;
  readonly sendText: (text: string) => void;
  readonly close: (code?: number, reason?: string) => void;
  readonly awarenessClientIds: Set<number>;
  prefersJson?: boolean;
}

export interface YjsRoom {
  readonly documentId: DocumentId;
  readonly workspaceId: WorkspaceId;
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly peers: Map<string, YjsPeerData>;
  dirty: boolean;
  destroyed: boolean;
  persistCount: number;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  maxWaitTimer: ReturnType<typeof setTimeout> | null;
}

export interface BunWebSocketUpgradeServer {
  upgrade(req: Request, options?: { data?: YjsWsSocketData }): boolean;
}

export interface YjsWebSocketSocket {
  readonly data: YjsWsSocketData;
  send(data: string | Uint8Array | ArrayBuffer): unknown;
  close(code?: number, reason?: string): void;
}

export interface YjsWsSocketData {
  readonly peerId: string;
  readonly documentId: DocumentId;
  readonly principal: Principal;
}

export interface YjsSyncHubDeps {
  readonly documentRepo: DocumentRepo;
  readonly searchConfigRepo: SearchConfigRepo;
  readonly spaceRepo: SpaceRepo;
  readonly tokenRuleRepo: TokenRuleRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
  readonly tokenScopeCache?: TokenScopeCache | undefined;
  readonly principalDeps: PrincipalResolverDeps;
  readonly logger?: ServerLogger | undefined;
  readonly persistDebounceMs?: number | undefined;
  readonly persistMaxWaitMs?: number | undefined;
}

export function encodeYjsSyncMessage(msgType: number, payload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, msgType);
  encoding.writeVarUint8Array(enc, payload);
  return encoding.toUint8Array(enc);
}

export function decodeYjsSyncMessage(
  bytes: Uint8Array,
): { readonly msgType: number; readonly payload: Uint8Array } | null {
  try {
    const dec = decoding.createDecoder(bytes);
    const msgType = decoding.readVarUint(dec);
    const payload = decoding.readVarUint8Array(dec);
    return { msgType, payload };
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function base64ToBytes(base64: string): Uint8Array {
  const buf = Buffer.from(base64, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const SYNC_ROUTE_REGEX = /^\/api\/v1\/sync\/([^/]+)$/;

export function parseSyncRouteDocumentId(pathname: string): DocumentId | null {
  const match = SYNC_ROUTE_REGEX.exec(pathname);
  if (!match || !match[1]) return null;
  try {
    return asDocumentId(decodeURIComponent(match[1]));
  } catch {
    return asDocumentId(match[1]);
  }
}

export class YjsSyncHub {
  private readonly rooms = new Map<string, YjsRoom>();
  private readonly roomLoadPromises = new Map<string, Promise<YjsRoom>>();
  private readonly persistDebounceMs: number;
  private readonly persistMaxWaitMs: number;

  constructor(private readonly deps: YjsSyncHubDeps) {
    this.persistDebounceMs = deps.persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;
    this.persistMaxWaitMs = deps.persistMaxWaitMs ?? DEFAULT_PERSIST_MAX_WAIT_MS;
  }

  getRoom(workspaceId: WorkspaceId, documentId: DocumentId): YjsRoom | undefined {
    return this.rooms.get(`${workspaceId}:${documentId}`);
  }

  getActiveRoomCount(): number {
    return this.rooms.size;
  }

  private async getOrLoadRoom(workspaceId: WorkspaceId, documentId: DocumentId): Promise<YjsRoom> {
    const key = `${workspaceId}:${documentId}`;
    const existing = this.rooms.get(key);
    if (existing) return existing;

    const inflight = this.roomLoadPromises.get(key);
    if (inflight) return inflight;

    const loader = (async (): Promise<YjsRoom> => {
      const ydoc = new Y.Doc();
      const savedBase64 = await this.deps.searchConfigRepo.getDocumentYjsState(
        workspaceId,
        documentId,
      );
      if (savedBase64) {
        const bytes = base64ToBytes(savedBase64);
        if (bytes.byteLength > 0) {
          Y.applyUpdate(ydoc, bytes, DB_BOOTSTRAP_ORIGIN);
        }
      }

      const awareness = new Awareness(ydoc);
      awareness.setLocalState(null);

      const room: YjsRoom = {
        documentId,
        workspaceId,
        ydoc,
        awareness,
        peers: new Map(),
        dirty: false,
        destroyed: false,
        persistCount: 0,
        debounceTimer: null,
        maxWaitTimer: null,
      };

      ydoc.on("update", (update: Uint8Array, origin: unknown) => {
        if (room.destroyed || origin === DB_BOOTSTRAP_ORIGIN) return;
        this.schedulePersistRoom(room);
        this.broadcastUpdate(room, update, typeof origin === "string" ? origin : undefined);
      });

      awareness.on(
        "update",
        (
          changes: { added: number[]; updated: number[]; removed: number[] },
          origin: unknown,
        ) => {
          if (room.destroyed) return;
          const originPeerId = typeof origin === "string" ? origin : undefined;
          if (originPeerId && originPeerId !== PEER_CLOSE_ORIGIN) {
            const originPeer = room.peers.get(originPeerId);
            if (originPeer) {
              for (const id of changes.added) originPeer.awarenessClientIds.add(id);
              for (const id of changes.updated) originPeer.awarenessClientIds.add(id);
              for (const id of changes.removed) originPeer.awarenessClientIds.delete(id);
            }
          }
          const changedClients = [...changes.added, ...changes.updated, ...changes.removed];
          if (changedClients.length === 0) return;
          const awarenessBytes = encodeAwarenessUpdate(awareness, changedClients);
          const frame = encodeYjsSyncMessage(YJS_MSG_AWARENESS, awarenessBytes);
          for (const [peerId, peer] of room.peers) {
            if (peerId !== originPeerId) {
              peer.sendBinary(frame);
            }
          }
        },
      );

      this.rooms.set(key, room);
      return room;
    })();

    this.roomLoadPromises.set(key, loader);
    try {
      return await loader;
    } finally {
      this.roomLoadPromises.delete(key);
    }
  }

  private async authorizeDocumentAccess(
    principal: Principal,
    documentId: DocumentId,
    action: "read" | "write",
  ): Promise<{
    readonly allowed: boolean;
    readonly doc: DocumentRecord | null;
    readonly scope: TokenScope | null;
    readonly reason?: string | undefined;
  }> {
    const scope = await resolveCurrentPrincipalScope(
      principal,
      this.deps.tokenRuleRepo,
      this.deps.tokenScopeCache,
    );
    if (!scope) {
      return { allowed: false, doc: null, scope: null, reason: "Token is revoked or expired" };
    }

    const doc = await this.deps.documentRepo.getDocumentById(principal.workspaceId, documentId);
    if (!doc || doc.trashedAt !== null) {
      return { allowed: false, doc: null, scope, reason: `Document "${documentId}" not found` };
    }

    const allSpaces = this.deps.spacesCache
      ? await this.deps.spacesCache.getAll(principal.workspaceId)
      : await this.deps.spaceRepo.listSpaces(principal.workspaceId, { includeArchived: true });
    const decision = evaluateScopeAccess(
      scope,
      action,
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    return { allowed: decision.allowed, doc, scope, reason: decision.reason };
  }

  private clearRoomTimers(room: YjsRoom): void {
    if (room.debounceTimer !== null) {
      clearTimeout(room.debounceTimer);
      room.debounceTimer = null;
    }
    if (room.maxWaitTimer !== null) {
      clearTimeout(room.maxWaitTimer);
      room.maxWaitTimer = null;
    }
  }

  private schedulePersistRoom(room: YjsRoom): void {
    room.dirty = true;
    if (room.debounceTimer !== null) {
      clearTimeout(room.debounceTimer);
    }
    room.debounceTimer = setTimeout(() => {
      void this.flushRoom(room);
    }, this.persistDebounceMs);

    if (room.maxWaitTimer === null) {
      room.maxWaitTimer = setTimeout(() => {
        void this.flushRoom(room);
      }, this.persistMaxWaitMs);
    }
  }

  flushRoom(room: YjsRoom): Promise<void> {
    this.clearRoomTimers(room);
    if (!room.dirty || room.destroyed) {
      return Promise.resolve();
    }
    room.dirty = false;
    room.persistCount++;
    const state = Y.encodeStateAsUpdate(room.ydoc);
    const stateBase64 = bytesToBase64(state);
    // Triggers underlying SQLite write synchronously before Promise microtask settles.
    return this.deps.searchConfigRepo
      .upsertDocumentYjsState(room.workspaceId, room.documentId, stateBase64)
      .catch((err) => {
        room.dirty = true;
        this.deps.logger?.error({ err, documentId: room.documentId }, "Failed to persist Yjs room");
      });
  }

  private broadcastUpdate(room: YjsRoom, update: Uint8Array, originPeerId?: string): void {
    const enc = encoding.createEncoder();
    writeUpdate(enc, update);
    const binFrame = encoding.toUint8Array(enc);
    let jsonFrame: string | null = null;

    for (const [peerId, peer] of room.peers) {
      if (peerId === originPeerId) continue;
      if (peer.prefersJson) {
        jsonFrame ??= JSON.stringify({
          type: "update",
          updateBase64: bytesToBase64(update),
        } satisfies YjsWsJsonMessage);
        peer.sendText(jsonFrame);
      } else {
        peer.sendBinary(binFrame);
      }
    }
  }

  async handleHttpUpgrade(
    req: Request,
    server?: BunWebSocketUpgradeServer,
  ): Promise<Response | undefined> {
    const url = new URL(req.url);
    const documentId = parseSyncRouteDocumentId(url.pathname);
    if (!documentId) return undefined;

    const tokenParam = url.searchParams.get("token");
    const effectiveReq =
      tokenParam && !req.headers.has("authorization")
        ? new Request(req.url, {
            headers: (() => {
              const h = new Headers(req.headers);
              h.set("authorization", `Bearer ${tokenParam}`);
              return h;
            })(),
          })
        : req;

    let principal: Principal;
    try {
      principal = await resolvePrincipalFromRequest(effectiveReq, this.deps.principalDeps);
    } catch (error) {
      const msg = isInkadeError(error) ? error.message : "Unauthorized";
      return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: msg } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const authz = await this.authorizeDocumentAccess(principal, documentId, "read");
    if (!authz.doc) {
      return new Response(
        JSON.stringify({
          error: {
            code: authz.scope ? "NOT_FOUND" : "UNAUTHORIZED",
            message: authz.reason ?? "Document not found",
          },
        }),
        { status: authz.scope ? 404 : 401, headers: { "content-type": "application/json" } },
      );
    }
    if (!authz.allowed) {
      return new Response(
        JSON.stringify({
          error: { code: "FORBIDDEN", message: authz.reason ?? "Access denied" },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }

    if (!server) {
      return new Response(
        JSON.stringify({
          error: {
            code: "UPGRADE_REQUIRED",
            message: "WebSocket upgrade server is required for /api/v1/sync/:docId",
          },
        }),
        { status: 426, headers: { "content-type": "application/json" } },
      );
    }

    const peerId = `peer_${crypto.randomUUID()}`;
    const upgraded = server.upgrade(req, { data: { peerId, documentId, principal } });
    if (!upgraded) {
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return undefined;
  }

  async handlePeerOpen(peer: YjsPeerData): Promise<void> {
    const room = await this.getOrLoadRoom(peer.principal.workspaceId, peer.documentId);
    room.peers.set(peer.peerId, peer);

    const enc2 = encoding.createEncoder();
    writeSyncStep2(enc2, room.ydoc);
    peer.sendBinary(encoding.toUint8Array(enc2));

    const enc1 = encoding.createEncoder();
    writeSyncStep1(enc1, room.ydoc);
    peer.sendBinary(encoding.toUint8Array(enc1));

    const awarenessClients = Array.from(room.awareness.getStates().keys());
    if (awarenessClients.length > 0) {
      const awBytes = encodeAwarenessUpdate(room.awareness, awarenessClients);
      peer.sendBinary(encodeYjsSyncMessage(YJS_MSG_AWARENESS, awBytes));
    }
  }

  async handlePeerMessage(
    peer: YjsPeerData,
    rawMessage: string | Uint8Array | ArrayBuffer,
  ): Promise<void> {
    const room = await this.getOrLoadRoom(peer.principal.workspaceId, peer.documentId);

    if (typeof rawMessage === "string") {
      peer.prefersJson = true;
      let parsed: YjsWsJsonMessage | null = null;
      try {
        parsed = JSON.parse(rawMessage) as YjsWsJsonMessage;
      } catch {
        peer.sendText(
          JSON.stringify({
            type: "error",
            code: "VALIDATION_ERROR",
            message: "Invalid JSON sync message",
          } satisfies YjsWsJsonMessage),
        );
        return;
      }

      if (parsed.type === "sync-step-1") {
        const sv = parsed.stateVectorBase64 ? base64ToBytes(parsed.stateVectorBase64) : undefined;
        const diff = Y.encodeStateAsUpdate(room.ydoc, sv);
        peer.sendText(
          JSON.stringify({
            type: "sync-step-2",
            updateBase64: bytesToBase64(diff),
          } satisfies YjsWsJsonMessage),
        );
        return;
      }

      if (parsed.type === "update" || parsed.type === "sync-step-2") {
        if (!(await this.ensurePeerCanWrite(peer))) return;
        Y.applyUpdate(room.ydoc, base64ToBytes(parsed.updateBase64), peer.peerId);
      }
      return;
    }

    const bytes = rawMessage instanceof Uint8Array ? rawMessage : new Uint8Array(rawMessage);
    const decoded = decodeYjsSyncMessage(bytes);
    if (!decoded) {
      peer.sendText(
        JSON.stringify({
          type: "error",
          code: "VALIDATION_ERROR",
          message: "Malformed binary Yjs frame",
        } satisfies YjsWsJsonMessage),
      );
      return;
    }

    if (decoded.msgType === YJS_MSG_AWARENESS) {
      applyAwarenessUpdate(room.awareness, decoded.payload, peer.peerId);
      return;
    }

    if (decoded.msgType === YJS_MSG_SYNC_STEP_2 || decoded.msgType === YJS_MSG_UPDATE) {
      if (!(await this.ensurePeerCanWrite(peer))) return;
    }

    if (
      decoded.msgType === YJS_MSG_SYNC_STEP_1 ||
      decoded.msgType === YJS_MSG_SYNC_STEP_2 ||
      decoded.msgType === YJS_MSG_UPDATE
    ) {
      const replyEncoder = encoding.createEncoder();
      readSyncMessage(decoding.createDecoder(bytes), replyEncoder, room.ydoc, peer.peerId);
      if (encoding.length(replyEncoder) > 0) {
        peer.sendBinary(encoding.toUint8Array(replyEncoder));
      }
    }
  }

  private async ensurePeerCanWrite(peer: YjsPeerData): Promise<boolean> {
    const authz = await this.authorizeDocumentAccess(peer.principal, peer.documentId, "write");
    if (!authz.allowed) {
      peer.sendText(
        JSON.stringify({
          type: "error",
          code: authz.scope ? "FORBIDDEN" : "UNAUTHORIZED",
          message: authz.reason ?? "Write permission is required to mutate document",
        } satisfies YjsWsJsonMessage),
      );
      if (!authz.scope) {
        peer.close(4001, "Unauthorized");
      }
      return false;
    }
    return true;
  }

  private destroyRoom(key: string, room: YjsRoom): void {
    this.clearRoomTimers(room);
    if (!room.destroyed) {
      room.destroyed = true;
      room.awareness.destroy();
      room.ydoc.destroy();
    }
    this.rooms.delete(key);
  }

  handlePeerClose(peer: Pick<YjsPeerData, "peerId" | "documentId" | "principal">): void {
    const key = `${peer.principal.workspaceId}:${peer.documentId}`;
    const room = this.rooms.get(key);
    if (!room) return;

    const fullPeer = room.peers.get(peer.peerId);
    room.peers.delete(peer.peerId);
    if (fullPeer && fullPeer.awarenessClientIds.size > 0) {
      removeAwarenessStates(
        room.awareness,
        [...fullPeer.awarenessClientIds],
        PEER_CLOSE_ORIGIN,
      );
    }

    if (room.peers.size === 0) {
      void this.flushRoom(room);
      this.destroyRoom(key, room);
    }
  }

  flushAllRooms(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const room of this.rooms.values()) {
      pending.push(this.flushRoom(room));
    }
    return Promise.all(pending).then(() => undefined);
  }

  close(): void {
    for (const [key, room] of this.rooms.entries()) {
      void this.flushRoom(room);
      this.destroyRoom(key, room);
    }
  }

  async connectProgrammaticPeer(
    principal: Principal,
    documentId: DocumentId,
    handlers: {
      readonly onBinary: (bytes: Uint8Array) => void;
      readonly onText: (text: string) => void;
      readonly onClose?: ((code?: number, reason?: string) => void) | undefined;
    },
  ): Promise<{
    readonly peerId: string;
    send: (msg: string | Uint8Array) => Promise<void>;
    close: () => void;
  }> {
    const authz = await this.authorizeDocumentAccess(principal, documentId, "read");
    if (!authz.doc) throw new Error(authz.reason ?? "Document not found");
    if (!authz.allowed) throw new Error(authz.reason ?? "FORBIDDEN");

    const peerId = `peer_${crypto.randomUUID()}`;
    const peer: YjsPeerData = {
      peerId,
      documentId,
      principal,
      sendBinary: handlers.onBinary,
      sendText: handlers.onText,
      awarenessClientIds: new Set<number>(),
      close: (code, reason) => {
        this.handlePeerClose(peer);
        handlers.onClose?.(code, reason);
      },
    };
    await this.handlePeerOpen(peer);

    return {
      peerId,
      send: (msg) => this.handlePeerMessage(peer, msg),
      close: () => this.handlePeerClose(peer),
    };
  }

  createBunWebSocketHandlers() {
    const activePeers = new Map<string, YjsPeerData>();

    return {
      open: async (ws: YjsWebSocketSocket) => {
        const peer: YjsPeerData = {
          peerId: ws.data.peerId,
          documentId: ws.data.documentId,
          principal: ws.data.principal,
          awarenessClientIds: new Set<number>(),
          sendBinary: (bytes) => {
            ws.send(bytes);
          },
          sendText: (text) => {
            ws.send(text);
          },
          close: (code, reason) => {
            ws.close(code, reason);
          },
        };
        activePeers.set(ws.data.peerId, peer);
        await this.handlePeerOpen(peer);
      },
      message: async (ws: YjsWebSocketSocket, message: string | Uint8Array | ArrayBuffer) => {
        const peer = activePeers.get(ws.data.peerId);
        if (!peer) return;
        await this.handlePeerMessage(peer, message);
      },
      close: (ws: YjsWebSocketSocket) => {
        const peer = activePeers.get(ws.data.peerId);
        if (peer) {
          activePeers.delete(ws.data.peerId);
          this.handlePeerClose(peer);
        } else {
          this.handlePeerClose(ws.data);
        }
      },
    };
  }
}
