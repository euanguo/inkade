import { Hono, type MiddlewareHandler } from "hono";
import {
  asDocumentId,
  embedCommandInputSchema,
  InkadeError,
  isInkadeError,
} from "@inkade/core";
import type { StorageDialect, TokenRuleRepo } from "@inkade/db";
import type { EmbedTicketManager } from "../auth/embed-ticket.ts";
import {
  resolvePrincipalFromRequest,
  type PrincipalResolverDeps,
} from "../auth/principal.ts";
import type { TokenScopeCache } from "../cache/token-scope-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { InkadeServices } from "../services/index.ts";
import type { InkadeAppEnv, Principal } from "../types.ts";
import { zValidate } from "./validation.ts";
import { registerAdminRoutes } from "./v1/admin.ts";
import { registerAiRoutes } from "./v1/ai.ts";
import { registerArtifactRoutes } from "./v1/artifacts.ts";
import { createRestAuditMiddleware } from "./v1/audit-middleware.ts";
import {
  registerAuthenticatedWorkspaceRoutes,
  registerPublicBootstrapRoutes,
} from "./v1/bootstrap.ts";
import { registerClipRoutes } from "./v1/clips.ts";
import { registerBriefingRoutes } from "./v1/briefings.ts";
import { registerContextPackRoutes } from "./v1/context-packs.ts";
import { registerDocumentRoutes } from "./v1/documents.ts";
import {
  registerIngestAndPdfRoutes,
  registerPublicIngestRoutes,
} from "./v1/ingest-pdf.ts";
import { registerOutlineRoutes } from "./v1/outline.ts";
import { registerPreferencesRoutes } from "./v1/preferences.ts";
import { registerRealtimeRoutes } from "./v1/realtime.ts";
import { registerSearchRoutes } from "./v1/search.ts";
import { registerSpaceRoutes } from "./v1/spaces.ts";
import { registerTaskRoutes } from "./v1/tasks.ts";
import { registerThreadRoutes } from "./v1/threads.ts";

export interface ApiV1RouterDeps {
  readonly dialect: StorageDialect;
  readonly tokenRuleRepo: TokenRuleRepo;
  readonly tokenScopeCache?: TokenScopeCache | undefined;
  readonly embedTickets: EmbedTicketManager;
  readonly sseHub: SseHub;
  readonly services: InkadeServices;
  readonly principalMiddleware: MiddlewareHandler<InkadeAppEnv>;
  readonly principalDeps?: PrincipalResolverDeps | undefined;
}

export function createApiV1Router(deps: ApiV1RouterDeps): Hono<InkadeAppEnv> {
  const router = new Hono<InkadeAppEnv>();
  const { services } = deps;

  registerPublicBootstrapRoutes(router, {
    dialect: deps.dialect,
    services,
    embedTickets: deps.embedTickets,
  });
  registerPublicIngestRoutes(router, services);

  router.post(
    "/embed/command",
    zValidate("json", embedCommandInputSchema),
    async (c) => {
      const body = c.req.valid("json");
      const authHeader = c.req.header("authorization");
      let authPrincipal: Principal | null = null;

      if (deps.principalDeps) {
        if (authHeader) {
          authPrincipal = await resolvePrincipalFromRequest(c.req.raw, deps.principalDeps);
        } else {
          try {
            authPrincipal = await resolvePrincipalFromRequest(c.req.raw, deps.principalDeps);
          } catch (err) {
            if (!(isInkadeError(err) && err.code === "UNAUTHORIZED")) {
              throw err;
            }
          }
        }
      } else if (authHeader) {
        const spaceIdx = authHeader.trim().indexOf(" ");
        const bearer = spaceIdx > 0 ? authHeader.trim().slice(spaceIdx + 1).trim() : "";
        if (bearer.startsWith("ink_emb_")) {
          authPrincipal = await deps.embedTickets.resolveSessionToken(bearer);
        }
        if (!authPrincipal) {
          throw new InkadeError("UNAUTHORIZED", "Invalid authorization header");
        }
      }

      let resolvedEmbedSessionId: string | null = null;
      let effectivePrincipal: Principal | null = authPrincipal;

      if (body.embedSessionId) {
        const session = deps.embedTickets.resolveSessionById(body.embedSessionId);
        if (!session) {
          throw new InkadeError("UNAUTHORIZED", "Invalid or expired embed session");
        }
        if (authPrincipal) {
          if (session.principal.workspaceId !== authPrincipal.workspaceId) {
            throw new InkadeError("FORBIDDEN", "Embed session belongs to another workspace");
          }
          if (
            authPrincipal.kind === "token" &&
            (session.principal.kind !== "token" ||
              session.principal.tokenId !== authPrincipal.tokenId)
          ) {
            throw new InkadeError("FORBIDDEN", "Embed session belongs to another token");
          }
        } else {
          effectivePrincipal = session.principal;
        }
        resolvedEmbedSessionId = session.embedSessionId;
      } else if (authPrincipal && authHeader) {
        const spaceIdx = authHeader.trim().indexOf(" ");
        const bearer = spaceIdx > 0 ? authHeader.trim().slice(spaceIdx + 1).trim() : "";
        if (bearer.startsWith("ink_emb_")) {
          const details = await deps.embedTickets.resolveSessionDetails(bearer);
          resolvedEmbedSessionId = details?.embedSessionId ?? null;
        }
      }

      if (!effectivePrincipal) {
        throw new InkadeError(
          "UNAUTHORIZED",
          "Authentication or valid embedSessionId is required",
        );
      }

      const rawDocId =
        body.message.type === "host.goto_anchor" ? body.message.payload.documentId : null;
      const doc = rawDocId
        ? await services.document.getDocument(effectivePrincipal, asDocumentId(rawDocId))
        : null;

      const evt = deps.sseHub.publish({
        type: "embed.shell_event",
        workspaceId: effectivePrincipal.workspaceId,
        spaceId: doc?.spaceId ?? null,
        documentId: doc?.id,
        documentKind: doc?.kind,
        tags: doc?.tags,
        actorType: effectivePrincipal.actorType,
        payload: {
          direction: "host_to_inkade",
          embedSessionId: resolvedEmbedSessionId,
          targetTokenId:
            effectivePrincipal.kind === "token" ? effectivePrincipal.tokenId : null,
          targetUserId:
            effectivePrincipal.kind === "user" ? effectivePrincipal.userId : null,
          message: body.message,
        },
      });

      return c.json({
        ok: true,
        eventId: evt.eventId,
        seq: evt.seq,
        embedSessionId: resolvedEmbedSessionId,
      });
    },
  );

  router.use("*", deps.principalMiddleware);
  router.use("*", (c, next) => {
    const bridgeContext = services.wake.parseBridgeHeaders(c.req.raw.headers);
    return services.wake.runWithBridgeContext(bridgeContext, next);
  });
  router.use("*", createRestAuditMiddleware(services.audit));

  registerAuthenticatedWorkspaceRoutes(router, {
    services,
    embedTickets: deps.embedTickets,
  });
  registerSpaceRoutes(router, services);
  registerDocumentRoutes(router, services);
  registerTaskRoutes(router, services);
  registerOutlineRoutes(router, services);
  registerThreadRoutes(router, services);
  registerClipRoutes(router, services);
  registerSearchRoutes(router, services);
  registerAdminRoutes(router, services);
  registerAiRoutes(router, services);
  registerArtifactRoutes(router, services);
  registerContextPackRoutes(router, services);
  registerBriefingRoutes(router, services);
  registerPreferencesRoutes(router, services);
  registerIngestAndPdfRoutes(router, services);
  registerRealtimeRoutes(router, {
    sseHub: deps.sseHub,
    tokenRuleRepo: deps.tokenRuleRepo,
    tokenScopeCache: deps.tokenScopeCache,
    embedTickets: deps.embedTickets,
    services,
  });

  return router;
}
