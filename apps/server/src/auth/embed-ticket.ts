import { sha256Hex } from "./tokens.ts";
import type { Principal } from "../types.ts";

export const DEFAULT_EMBED_TICKET_TTL_MS = 60_000;
export const DEFAULT_EMBED_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const DEFAULT_MAX_EMBED_TICKETS = 10_000;
export const DEFAULT_MAX_EMBED_SESSIONS = 10_000;
const PRUNE_THROTTLE_MS = 60_000;

interface TicketEntry {
  readonly principal: Principal;
  readonly expiresAtMs: number;
  readonly embedSessionId: string;
}

interface SessionEntry {
  readonly principal: Principal;
  readonly expiresAtMs: number;
  readonly embedSessionId: string;
}

interface SessionRegistryEntry {
  readonly state: "issued" | "active";
  readonly principal: Principal;
  readonly expiresAtMs: number;
  readonly ticketHash?: string | undefined;
  readonly sessionHash?: string | undefined;
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function enforceCapacity<T>(map: Map<string, T>, maxEntries: number): void {
  while (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

export interface EmbedTicketManagerOptions {
  readonly ticketTtlMs?: number | undefined;
  readonly sessionTtlMs?: number | undefined;
  readonly maxTickets?: number | undefined;
  readonly maxSessions?: number | undefined;
}

/**
 * In-memory manager for single-use 60s embed tickets and short-lived embed bearer sessions.
 * Both tickets and issued session tokens preserve the exact issuing Principal and AgentScope.
 */
export class EmbedTicketManager {
  private readonly tickets = new Map<string, TicketEntry>();
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly sessionsById = new Map<string, SessionRegistryEntry>();
  private readonly ticketTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly maxTickets: number;
  private readonly maxSessions: number;
  private lastPrunedAtMs = 0;

  constructor(options: EmbedTicketManagerOptions = {}) {
    this.ticketTtlMs = options.ticketTtlMs ?? DEFAULT_EMBED_TICKET_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_EMBED_SESSION_TTL_MS;
    this.maxTickets = Math.max(1, options.maxTickets ?? DEFAULT_MAX_EMBED_TICKETS);
    this.maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_EMBED_SESSIONS);
  }

  get activeTicketCount(): number {
    return this.tickets.size;
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  private pruneExpired(nowMs: number): void {
    this.lastPrunedAtMs = nowMs;
    for (const [hash, entry] of this.tickets) {
      if (entry.expiresAtMs <= nowMs) {
        this.tickets.delete(hash);
        const reg = this.sessionsById.get(entry.embedSessionId);
        if (reg?.state === "issued") {
          this.sessionsById.delete(entry.embedSessionId);
        }
      }
    }
    for (const [hash, entry] of this.sessions) {
      if (entry.expiresAtMs <= nowMs) {
        this.sessions.delete(hash);
        this.sessionsById.delete(entry.embedSessionId);
      }
    }
    for (const [id, reg] of this.sessionsById) {
      if (reg.expiresAtMs <= nowMs) {
        this.sessionsById.delete(id);
      }
    }
  }

  async issueTicket(principal: Principal): Promise<{
    readonly ticket: string;
    readonly expiresAt: string;
    readonly ttlSeconds: number;
    readonly embedSessionId: string;
  }> {
    const nowMs = Date.now();
    this.pruneExpired(nowMs);
    while (this.tickets.size >= this.maxTickets) {
      const oldestKey = this.tickets.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = this.tickets.get(oldestKey);
      this.tickets.delete(oldestKey);
      if (evicted) {
        const reg = this.sessionsById.get(evicted.embedSessionId);
        if (reg?.state === "issued") {
          this.sessionsById.delete(evicted.embedSessionId);
        }
      }
    }
    const ticket = `etk_${randomBase64Url(24)}`;
    const embedSessionId = `esid_${randomBase64Url(18)}`;
    const hash = await sha256Hex(ticket);
    const expiresAtMs = nowMs + this.ticketTtlMs;
    this.tickets.set(hash, {
      principal,
      expiresAtMs,
      embedSessionId,
    });
    this.sessionsById.set(embedSessionId, {
      state: "issued",
      principal,
      expiresAtMs,
      ticketHash: hash,
    });
    return {
      ticket,
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttlSeconds: Math.max(1, Math.round(this.ticketTtlMs / 1000)),
      embedSessionId,
    };
  }

  async exchangeTicket(ticket: string): Promise<{
    readonly accessToken: string;
    readonly expiresAt: string;
    readonly expiresInSeconds: number;
    readonly embedSessionId: string;
  } | null> {
    const trimmed = ticket.trim();
    if (!trimmed.startsWith("etk_")) {
      return null;
    }
    const nowMs = Date.now();
    this.pruneExpired(nowMs);
    const hash = await sha256Hex(trimmed);
    const entry = this.tickets.get(hash);
    // Delete immediately before validating TTL so every ticket is strictly single-use.
    this.tickets.delete(hash);
    if (!entry || entry.expiresAtMs <= nowMs) {
      if (entry) {
        this.sessionsById.delete(entry.embedSessionId);
      }
      return null;
    }

    while (this.sessions.size >= this.maxSessions) {
      const oldestKey = this.sessions.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = this.sessions.get(oldestKey);
      this.sessions.delete(oldestKey);
      if (evicted) {
        this.sessionsById.delete(evicted.embedSessionId);
      }
    }
    enforceCapacity(this.sessionsById, this.maxSessions + this.maxTickets);

    const accessToken = `ink_emb_${randomBase64Url(24)}`;
    const sessionHash = await sha256Hex(accessToken);
    const expiresAtMs = nowMs + this.sessionTtlMs;
    this.sessions.set(sessionHash, {
      principal: entry.principal,
      expiresAtMs,
      embedSessionId: entry.embedSessionId,
    });
    this.sessionsById.set(entry.embedSessionId, {
      state: "active",
      principal: entry.principal,
      expiresAtMs,
      sessionHash,
    });
    return {
      accessToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresInSeconds: Math.max(1, Math.round(this.sessionTtlMs / 1000)),
      embedSessionId: entry.embedSessionId,
    };
  }

  async resolveSessionDetails(
    rawToken: string,
  ): Promise<{ readonly principal: Principal; readonly embedSessionId: string } | null> {
    if (!rawToken.startsWith("ink_emb_")) {
      return null;
    }
    const nowMs = Date.now();
    if (nowMs - this.lastPrunedAtMs >= PRUNE_THROTTLE_MS) {
      this.pruneExpired(nowMs);
    }
    const hash = await sha256Hex(rawToken);
    const session = this.sessions.get(hash);
    if (!session) {
      return null;
    }
    if (session.expiresAtMs <= nowMs) {
      this.sessions.delete(hash);
      this.sessionsById.delete(session.embedSessionId);
      return null;
    }
    // Refresh insertion order for LRU eviction under sustained load.
    this.sessions.delete(hash);
    this.sessions.set(hash, session);
    return { principal: session.principal, embedSessionId: session.embedSessionId };
  }

  async resolveSessionToken(rawToken: string): Promise<Principal | null> {
    const details = await this.resolveSessionDetails(rawToken);
    return details?.principal ?? null;
  }

  resolveSessionById(embedSessionId: string): {
    readonly embedSessionId: string;
    readonly principal: Principal;
    readonly state: "issued" | "active";
  } | null {
    const trimmed = embedSessionId.trim();
    if (!trimmed.startsWith("esid_")) {
      return null;
    }
    const nowMs = Date.now();
    if (nowMs - this.lastPrunedAtMs >= PRUNE_THROTTLE_MS) {
      this.pruneExpired(nowMs);
    }
    const entry = this.sessionsById.get(trimmed);
    if (!entry) {
      return null;
    }
    if (entry.expiresAtMs <= nowMs) {
      this.sessionsById.delete(trimmed);
      if (entry.ticketHash) {
        this.tickets.delete(entry.ticketHash);
      }
      if (entry.sessionHash) {
        this.sessions.delete(entry.sessionHash);
      }
      return null;
    }
    return {
      embedSessionId: trimmed,
      principal: entry.principal,
      state: entry.state,
    };
  }
}
