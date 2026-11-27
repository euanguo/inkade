import type { ApiTokenRecord } from "@inkade/core";
import type { ApiTokenWithHash, TokenRuleRepo } from "@inkade/db";

interface CachedEntry<T> {
  readonly value: T;
  readonly expiresAtMs: number;
}

const DEFAULT_TTL_MS = 3_000;
const DEFAULT_MAX_ENTRIES = 500;
const LAST_USED_TOUCH_INTERVAL_MS = 30_000;

/**
 * Bounded short-TTL cache for active API token scope lookups.
 * Immediately invalidated on token updates or revocations so hot-reloads remain instantaneous.
 */
export class TokenScopeCache {
  private readonly byHash = new Map<string, CachedEntry<ApiTokenWithHash | null>>();
  private readonly byId = new Map<string, CachedEntry<ApiTokenRecord | null>>();
  private readonly lastTouchedAtMs = new Map<string, number>();

  constructor(
    private readonly tokenRuleRepo: TokenRuleRepo,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {}

  private setBounded<T>(map: Map<string, CachedEntry<T>>, key: string, value: T): void {
    if (map.size >= this.maxEntries && !map.has(key)) {
      const oldestKey = map.keys().next().value;
      if (oldestKey !== undefined) {
        map.delete(oldestKey);
      }
    }
    map.set(key, {
      value,
      expiresAtMs: Date.now() + this.ttlMs,
    });
  }

  private getFresh<T>(map: Map<string, CachedEntry<T>>, key: string): { readonly hit: true; readonly value: T } | { readonly hit: false } {
    const entry = map.get(key);
    if (!entry) return { hit: false };
    if (entry.expiresAtMs <= Date.now()) {
      map.delete(key);
      return { hit: false };
    }
    return { hit: true, value: entry.value };
  }

  async findByHash(tokenHash: string): Promise<ApiTokenWithHash | null> {
    const cached = this.getFresh(this.byHash, tokenHash);
    if (cached.hit) {
      return cached.value;
    }
    const found = await this.tokenRuleRepo.findApiTokenByHash(tokenHash);
    this.setBounded(this.byHash, tokenHash, found);
    if (found) {
      this.setBounded(
        this.byId,
        `${found.token.workspaceId}:${found.token.id}`,
        found.token,
      );
    }
    return found;
  }

  async getById(workspaceId: string, tokenId: string): Promise<ApiTokenRecord | null> {
    const key = `${workspaceId}:${tokenId}`;
    const cached = this.getFresh(this.byId, key);
    if (cached.hit) {
      return cached.value;
    }
    const loaded = await this.tokenRuleRepo.getApiTokenById(workspaceId, tokenId);
    this.setBounded(this.byId, key, loaded);
    return loaded;
  }

  shouldTouchLastUsed(tokenId: string): boolean {
    const now = Date.now();
    const prev = this.lastTouchedAtMs.get(tokenId) ?? 0;
    if (now - prev < LAST_USED_TOUCH_INTERVAL_MS) {
      return false;
    }
    this.lastTouchedAtMs.set(tokenId, now);
    return true;
  }

  invalidateToken(tokenId: string, workspaceId?: string): void {
    if (workspaceId) {
      this.byId.delete(`${workspaceId}:${tokenId}`);
    } else {
      for (const key of this.byId.keys()) {
        if (key.endsWith(`:${tokenId}`)) {
          this.byId.delete(key);
        }
      }
    }
    for (const [hash, entry] of this.byHash.entries()) {
      if (entry.value?.token.id === tokenId) {
        this.byHash.delete(hash);
      }
    }
  }

  invalidateWorkspace(workspaceId: string): void {
    for (const key of this.byId.keys()) {
      if (key.startsWith(`${workspaceId}:`)) {
        this.byId.delete(key);
      }
    }
    for (const [hash, entry] of this.byHash.entries()) {
      if (entry.value?.token.workspaceId === workspaceId) {
        this.byHash.delete(hash);
      }
    }
  }
}
