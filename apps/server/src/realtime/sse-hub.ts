import {
  createId,
  evaluateScopeAccess,
  ID_PREFIXES,
  type ApiTokenId,
  type InkadeEvent,
  type InkadeEventType,
  type PublishableInkadeEvent,
  type Space,
  type TokenScope,
  type UserId,
  type WorkspaceId,
} from "@inkade/core";
import type { SpaceRepo } from "@inkade/db";
import type { TokenScopeCache } from "../cache/token-scope-cache.ts";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";

export type PublishEventInput<K extends InkadeEventType = InkadeEventType> =
  PublishableInkadeEvent<K>;

export interface PublishEventOptions {
  readonly transient?: boolean | undefined;
}

export interface SseSubscriberIdentity {
  readonly tokenId?: ApiTokenId | null | undefined;
  readonly userId?: UserId | null | undefined;
  readonly embedSessionId?: string | null | undefined;
}

export interface SseSubscriber extends SseSubscriberIdentity {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly resolveScope: () => Promise<TokenScope | null>;
  readonly send: (envelope: InkadeEvent) => Promise<void> | void;
  readonly onRevoked?: (() => void) | undefined;
}

const DEFAULT_MAX_BUFFER_SIZE = 500;

export function isEventVisibleToScope(
  envelope: InkadeEvent,
  scope: TokenScope,
  allSpaces: readonly Pick<Space, "id" | "parentId">[],
  subscriberIdentity?: SseSubscriberIdentity,
): boolean {
  if (envelope.type === "token.updated") {
    return scope.permission === "admin" && scope.spaceIds === "*";
  }

  if (envelope.type === "preferences.updated") {
    return true;
  }

  if (envelope.type === "embed.shell_event") {
    if (envelope.spaceId !== null) {
      const docAccess = evaluateScopeAccess(
        scope,
        "read",
        {
          spaceId: envelope.spaceId,
          kind: envelope.documentKind,
          tags: envelope.tags,
          resourceType: "document",
        },
        allSpaces,
      );
      if (!docAccess.allowed) {
        return false;
      }
    }
    if (
      envelope.payload.embedSessionId &&
      subscriberIdentity?.embedSessionId === envelope.payload.embedSessionId
    ) {
      return true;
    }
    if (
      envelope.payload.targetTokenId &&
      subscriberIdentity?.tokenId === envelope.payload.targetTokenId
    ) {
      return true;
    }
    if (
      envelope.payload.targetUserId &&
      subscriberIdentity?.userId === envelope.payload.targetUserId &&
      !subscriberIdentity.tokenId
    ) {
      return true;
    }
    return scope.permission === "admin" && scope.spaceIds === "*" && !subscriberIdentity?.tokenId;
  }

  if (envelope.spaceId === null) {
    return scope.permission === "admin" && scope.spaceIds === "*";
  }

  if (
    envelope.type === "space.created" ||
    envelope.type === "space.updated" ||
    envelope.type === "space.archived" ||
    envelope.type === "briefing.job.updated" ||
    envelope.type === "briefing.failed" ||
    envelope.type === "briefing.dismissed" ||
    envelope.type === "briefing.wakeup" ||
    (envelope.type === "briefing.succeeded" && !envelope.documentId) ||
    ((envelope.type === "agent.tool.started" || envelope.type === "agent.tool.finished") &&
      !envelope.documentId)
  ) {
    return evaluateScopeAccess(
      scope,
      "read",
      {
        spaceId: envelope.spaceId,
        resourceType: "space",
      },
      allSpaces,
    ).allowed;
  }

  return evaluateScopeAccess(
    scope,
    "read",
    {
      spaceId: envelope.spaceId,
      kind: envelope.documentKind,
      tags: envelope.tags,
      resourceType: "document",
    },
    allSpaces,
  ).allowed;
}

export interface SseHubDeps {
  readonly spaceRepo: SpaceRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
  readonly tokenScopeCache?: TokenScopeCache | undefined;
  readonly maxBufferSize?: number | undefined;
}

export class SseHub {
  private seq = 0;
  private readonly buffer: InkadeEvent[] = [];
  private readonly subscribers = new Map<string, SseSubscriber>();
  private readonly spaceRepo: SpaceRepo;
  private readonly spacesCache?: WorkspaceSpacesCache | undefined;
  private readonly tokenScopeCache?: TokenScopeCache | undefined;
  private readonly maxBufferSize: number;

  constructor(deps: SseHubDeps) {
    this.spaceRepo = deps.spaceRepo;
    this.spacesCache = deps.spacesCache;
    this.tokenScopeCache = deps.tokenScopeCache;
    this.maxBufferSize = deps.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
  }

  get currentSeq(): number {
    return this.seq;
  }

  subscribe(subscriber: SseSubscriber): () => void {
    this.subscribers.set(subscriber.id, subscriber);
    return () => {
      this.subscribers.delete(subscriber.id);
    };
  }

  getEventsSince(lastSeq: number, workspaceId: WorkspaceId): InkadeEvent[] {
    return this.buffer.filter((evt) => evt.workspaceId === workspaceId && evt.seq > lastSeq);
  }

  private async getSpaces(workspaceId: WorkspaceId): Promise<readonly Space[]> {
    if (this.spacesCache) {
      return this.spacesCache.getAll(workspaceId);
    }
    return this.spaceRepo.listSpaces(workspaceId, { includeArchived: true });
  }

  async filterEventsForScope(
    events: readonly InkadeEvent[],
    workspaceId: WorkspaceId,
    scope: TokenScope,
    subscriberIdentity?: SseSubscriberIdentity,
  ): Promise<InkadeEvent[]> {
    if (events.length === 0) return [];
    const spaces = await this.getSpaces(workspaceId);
    return events.filter((evt) => isEventVisibleToScope(evt, scope, spaces, subscriberIdentity));
  }

  publish<K extends InkadeEventType>(
    input: PublishableInkadeEvent<K>,
    options?: PublishEventOptions,
  ): InkadeEvent<K> {
    if (
      input.type === "space.created" ||
      input.type === "space.updated" ||
      input.type === "space.archived"
    ) {
      this.spacesCache?.invalidate(input.workspaceId);
    } else if (input.type === "token.updated") {
      this.tokenScopeCache?.invalidateWorkspace(input.workspaceId);
    }

    const transient = options?.transient === true;
    const envelope = {
      ...input,
      seq: transient ? this.seq : ++this.seq,
      eventId: createId(ID_PREFIXES.event),
      timestamp: new Date().toISOString(),
    } as unknown as InkadeEvent;

    if (!transient) {
      this.buffer.push(envelope);
      if (this.buffer.length > this.maxBufferSize) {
        this.buffer.shift();
      }
    }

    void this.dispatch(envelope);
    return envelope as InkadeEvent<K>;
  }

  private async dispatch(envelope: InkadeEvent): Promise<void> {
    const matchingSubscribers = [...this.subscribers.values()].filter(
      (sub) => sub.workspaceId === envelope.workspaceId,
    );
    if (matchingSubscribers.length === 0) return;

    const spaces = await this.getSpaces(envelope.workspaceId);

    await Promise.all(
      matchingSubscribers.map(async (sub) => {
        try {
          const currentScope = await sub.resolveScope();
          if (!currentScope) {
            this.subscribers.delete(sub.id);
            sub.onRevoked?.();
            return;
          }
          if (!isEventVisibleToScope(envelope, currentScope, spaces, sub)) {
            return;
          }
          await sub.send(envelope);
        } catch {
          this.subscribers.delete(sub.id);
        }
      }),
    );
  }
}
