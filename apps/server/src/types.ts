import type { Database } from "bun:sqlite";
import type { ApiTokenId, TokenScope, UserId, WorkspaceId } from "@inkade/core";
import type { InkadeSqliteDb, SqliteDatabaseBundle } from "@inkade/db";
import type { DnsResolver, FetchFn } from "./services/clipper-service.ts";
import type { BriefingServiceTransport } from "./services/briefing-service.ts";
import type { EmbeddingFetchFn, EmbeddingProvider } from "./services/semantic-search-service.ts";

export type Principal =
  | {
      readonly kind: "token";
      readonly tokenId: ApiTokenId;
      readonly tokenName: string;
      readonly workspaceId: WorkspaceId;
      readonly scope: TokenScope;
      readonly actorType: "agent";
      readonly actorId: ApiTokenId;
    }
  | {
      readonly kind: "user";
      readonly userId: UserId;
      readonly workspaceId: WorkspaceId;
      readonly scope: TokenScope;
      readonly actorType: "human";
      readonly actorId: UserId;
    };

export interface AppVariables {
  principal: Principal;
  workspaceId: WorkspaceId;
}

export interface InkadeAppEnv {
  Variables: AppVariables;
}

export interface CreateInkadeAppOptions {
  readonly dbPath?: string | undefined;
  readonly dbBundle?: SqliteDatabaseBundle | undefined;
  readonly dataDir?: string | undefined;
  readonly localAutoAuth?: boolean | undefined;
  readonly allowSignup?: boolean | undefined;
  readonly authSecret?: string | undefined;
  readonly baseURL?: string | undefined;
  readonly trustedOrigins?: readonly string[] | undefined;
  readonly corsOrigins?: readonly string[] | undefined;
  readonly webDistDir?: string | undefined;
  readonly basePath?: string | undefined;
  readonly frameAncestors?: string | undefined;
  readonly defaultWorkspaceId?: WorkspaceId | undefined;
  readonly skipSeed?: boolean | undefined;
  readonly clipperResolveDns?: DnsResolver | undefined;
  readonly clipperFetch?: FetchFn | undefined;
  readonly calendarResolveDns?: DnsResolver | undefined;
  readonly calendarFetch?: FetchFn | undefined;
  readonly embeddingProvider?: EmbeddingProvider | undefined;
  readonly embeddingFetch?: EmbeddingFetchFn | undefined;
  readonly enableBriefingScheduler?: boolean | undefined;
  readonly briefingTransport?: BriefingServiceTransport | undefined;
  readonly appOrigin?: string | undefined;
  readonly sandboxOrigin?: string | undefined;
  readonly sandboxSameSite?: boolean | undefined;
  readonly sandboxAllowedNetworkOrigins?: readonly string[] | undefined;
}

export interface ServerStorageContext {
  readonly sqlite: Database;
  readonly db: InkadeSqliteDb;
}
