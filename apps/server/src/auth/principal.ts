import type { MiddlewareHandler } from "hono";
import {
  ADMIN_USER_SCOPE,
  asUserId,
  InkadeError,
  type TokenScope,
  type WorkspaceId,
} from "@inkade/core";
import type { TokenRuleRepo } from "@inkade/db";
import type { TokenScopeCache } from "../cache/token-scope-cache.ts";
import type { InkadeAppEnv, Principal } from "../types.ts";
import type { InkadeAuth } from "./better-auth.ts";
import type { EmbedTicketManager } from "./embed-ticket.ts";
import { sha256Hex } from "./tokens.ts";

export interface PrincipalResolverDeps {
  readonly tokenRuleRepo: TokenRuleRepo;
  readonly tokenScopeCache?: TokenScopeCache | undefined;
  readonly auth: InkadeAuth;
  readonly embedTickets?: EmbedTicketManager | undefined;
  readonly defaultWorkspaceId: WorkspaceId;
  readonly localAutoAuth: boolean;
}

function parseBearerHeader(authorization: string | null): string | null {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  if (!trimmed) return null;
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx <= 0) {
    throw new InkadeError("UNAUTHORIZED", "Malformed Authorization header");
  }
  const scheme = trimmed.slice(0, spaceIdx).toLowerCase();
  const credential = trimmed.slice(spaceIdx + 1).trim();
  if (scheme !== "bearer" || !credential) {
    throw new InkadeError("UNAUTHORIZED", "Authorization header must use Bearer scheme");
  }
  return credential;
}

/**
 * Resolves the authenticated Principal using short-TTL invalidated TokenScopeCache + TokenRuleRepo.
 */
export async function resolvePrincipalFromRequest(
  req: Request,
  deps: PrincipalResolverDeps,
): Promise<Principal> {
  const bearerToken = parseBearerHeader(req.headers.get("authorization"));

  if (bearerToken !== null) {
    if (bearerToken.startsWith("ink_emb_")) {
      const embedPrincipal = deps.embedTickets
        ? await deps.embedTickets.resolveSessionToken(bearerToken)
        : null;
      if (!embedPrincipal) {
        throw new InkadeError("UNAUTHORIZED", "Invalid or expired embed session token");
      }
      if (embedPrincipal.kind === "token") {
        const latest = deps.tokenScopeCache
          ? await deps.tokenScopeCache.getById(embedPrincipal.workspaceId, embedPrincipal.tokenId)
          : await deps.tokenRuleRepo.getApiTokenById(
              embedPrincipal.workspaceId,
              embedPrincipal.tokenId,
            );
        if (
          !latest ||
          latest.revokedAt !== null ||
          (latest.expiresAt !== null && Date.parse(latest.expiresAt) <= Date.now())
        ) {
          throw new InkadeError("UNAUTHORIZED", "Underlying API token is no longer active");
        }
        return {
          ...embedPrincipal,
          scope: latest.scope,
        };
      }
      return embedPrincipal;
    }

    const tokenHash = await sha256Hex(bearerToken);
    const found = deps.tokenScopeCache
      ? await deps.tokenScopeCache.findByHash(tokenHash)
      : await deps.tokenRuleRepo.findApiTokenByHash(tokenHash);
    if (!found) {
      throw new InkadeError("UNAUTHORIZED", "Invalid API token");
    }
    const { token } = found;
    if (token.revokedAt !== null) {
      throw new InkadeError("UNAUTHORIZED", "API token has been revoked");
    }
    if (token.expiresAt !== null && Date.parse(token.expiresAt) <= Date.now()) {
      throw new InkadeError("UNAUTHORIZED", "API token has expired");
    }

    if (!deps.tokenScopeCache || deps.tokenScopeCache.shouldTouchLastUsed(token.id)) {
      void deps.tokenRuleRepo.touchApiTokenLastUsed(token.id).catch(() => {});
    }

    return {
      kind: "token",
      tokenId: token.id,
      tokenName: token.name,
      workspaceId: token.workspaceId,
      scope: token.scope,
      actorType: "agent",
      actorId: token.id,
    };
  }

  const sessionResult = await deps.auth.api.getSession({ headers: req.headers });
  if (sessionResult?.user) {
    const userId = asUserId(sessionResult.user.id);
    return {
      kind: "user",
      userId,
      workspaceId: deps.defaultWorkspaceId,
      scope: ADMIN_USER_SCOPE,
      actorType: "human",
      actorId: userId,
    };
  }

  if (deps.localAutoAuth) {
    const ownerId = asUserId("usr_local_owner");
    return {
      kind: "user",
      userId: ownerId,
      workspaceId: deps.defaultWorkspaceId,
      scope: ADMIN_USER_SCOPE,
      actorType: "human",
      actorId: ownerId,
    };
  }

  throw new InkadeError("UNAUTHORIZED", "Authentication required");
}

/**
 * Re-evaluates the current scope for a long-lived subscriber (e.g. SSE) so hot scope edits
 * and token revocations apply immediately to subsequent events.
 */
export async function resolveCurrentPrincipalScope(
  principal: Principal,
  tokenRuleRepo: TokenRuleRepo,
  tokenScopeCache?: TokenScopeCache,
): Promise<TokenScope | null> {
  if (principal.kind === "user") {
    return ADMIN_USER_SCOPE;
  }

  const latest = tokenScopeCache
    ? await tokenScopeCache.getById(principal.workspaceId, principal.tokenId)
    : await tokenRuleRepo.getApiTokenById(principal.workspaceId, principal.tokenId);
  if (!latest) return null;
  if (latest.revokedAt !== null) return null;
  if (latest.expiresAt !== null && Date.parse(latest.expiresAt) <= Date.now()) {
    return null;
  }
  return latest.scope;
}

export function createPrincipalMiddleware(
  deps: PrincipalResolverDeps,
): MiddlewareHandler<InkadeAppEnv> {
  return async (c, next) => {
    const principal = await resolvePrincipalFromRequest(c.req.raw, deps);
    c.set("principal", principal);
    c.set("workspaceId", principal.workspaceId);
    await next();
  };
}
