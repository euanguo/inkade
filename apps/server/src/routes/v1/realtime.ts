import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  asDocumentId,
  embedShellEventInputSchema,
  InkadeError,
  type InkadeToHostMessage,
  updateViewerContextInputSchema,
} from "@inkade/core";
import type { TokenRuleRepo } from "@inkade/db";
import type { EmbedTicketManager } from "../../auth/embed-ticket.ts";
import { resolveCurrentPrincipalScope } from "../../auth/principal.ts";
import type { TokenScopeCache } from "../../cache/token-scope-cache.ts";
import type { SseHub } from "../../realtime/sse-hub.ts";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";

export interface RealtimeRouteDeps {
  readonly sseHub: SseHub;
  readonly tokenRuleRepo: TokenRuleRepo;
  readonly tokenScopeCache?: TokenScopeCache | undefined;
  readonly embedTickets?: EmbedTicketManager | undefined;
  readonly services: InkadeServices;
}

function extractBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx <= 0) return null;
  if (trimmed.slice(0, spaceIdx).toLowerCase() !== "bearer") return null;
  const token = trimmed.slice(spaceIdx + 1).trim();
  return token || null;
}

function extractDocumentIdFromInkadeMessage(message: InkadeToHostMessage): string | null {
  switch (message.type) {
    case "inkade.route_changed":
    case "inkade.place_changed":
    case "inkade.request.spawn_thread":
      return message.payload.documentId ?? null;
    case "inkade.request.open_thread":
      return message.payload.binding.documentId ?? null;
    default:
      return null;
  }
}

export function registerRealtimeRoutes(
  router: Hono<InkadeAppEnv>,
  deps: RealtimeRouteDeps,
): void {
  router.get("/viewer-context", async (c) => {
    const result = await deps.services.viewerContext.getContext(c.get("principal"));
    return c.json(result);
  });

  router.post(
    "/viewer-context",
    zValidate("json", updateViewerContextInputSchema),
    async (c) => {
      const result = await deps.services.viewerContext.updateContext(
        c.get("principal"),
        c.req.valid("json"),
      );
      return c.json(result);
    },
  );

  router.post(
    "/embed/shell-event",
    zValidate("json", embedShellEventInputSchema),
    async (c) => {
      const principal = c.get("principal");
      const body = c.req.valid("json");
      const bearer = extractBearerToken(c.req.header("authorization"));
      const bearerDetails =
        bearer?.startsWith("ink_emb_") && deps.embedTickets
          ? await deps.embedTickets.resolveSessionDetails(bearer)
          : null;

      let effectiveEmbedSessionId = bearerDetails?.embedSessionId ?? null;
      if (body.embedSessionId) {
        if (bearerDetails && bearerDetails.embedSessionId !== body.embedSessionId) {
          throw new InkadeError("FORBIDDEN", "Embed session mismatch for bearer session");
        }
        if (!bearerDetails && deps.embedTickets) {
          const bound = deps.embedTickets.resolveSessionById(body.embedSessionId);
          if (!bound) {
            throw new InkadeError("UNAUTHORIZED", "Invalid or expired embed session");
          }
          if (bound.principal.workspaceId !== principal.workspaceId) {
            throw new InkadeError("FORBIDDEN", "Embed session belongs to another workspace");
          }
          if (
            principal.kind === "token" &&
            (bound.principal.kind !== "token" || bound.principal.tokenId !== principal.tokenId)
          ) {
            throw new InkadeError("FORBIDDEN", "Embed session belongs to another token");
          }
          effectiveEmbedSessionId = bound.embedSessionId;
        } else {
          effectiveEmbedSessionId = effectiveEmbedSessionId ?? body.embedSessionId;
        }
      }

      const rawDocId = extractDocumentIdFromInkadeMessage(body.message);
      const doc = rawDocId
        ? await deps.services.document.getDocument(principal, asDocumentId(rawDocId))
        : null;

      const evt = deps.sseHub.publish({
        type: "embed.shell_event",
        workspaceId: principal.workspaceId,
        spaceId: doc?.spaceId ?? null,
        documentId: doc?.id,
        documentKind: doc?.kind,
        tags: doc?.tags,
        actorType: principal.actorType,
        payload: {
          direction: "inkade_to_host",
          embedSessionId: effectiveEmbedSessionId,
          targetTokenId: principal.kind === "token" ? principal.tokenId : null,
          targetUserId: principal.kind === "user" ? principal.userId : null,
          message: body.message,
        },
      });

      return c.json({
        ok: true,
        eventId: evt.eventId,
        seq: evt.seq,
        embedSessionId: effectiveEmbedSessionId,
      });
    },
  );

  router.get("/events", async (c) => {
    const principal = c.get("principal");
    const bearer = extractBearerToken(c.req.header("authorization"));
    const bearerDetails =
      bearer?.startsWith("ink_emb_") && deps.embedTickets
        ? await deps.embedTickets.resolveSessionDetails(bearer)
        : null;
    const subscriberIdentity = {
      tokenId: principal.kind === "token" ? principal.tokenId : null,
      userId: principal.kind === "user" ? principal.userId : null,
      embedSessionId: bearerDetails?.embedSessionId ?? null,
    };

    const lastEventIdRaw =
      c.req.header("last-event-id") ?? c.req.query("lastEventId") ?? undefined;
    const lastSeq =
      lastEventIdRaw !== undefined && /^\d+$/.test(lastEventIdRaw.trim())
        ? Number(lastEventIdRaw.trim())
        : null;

    const initialScope = await resolveCurrentPrincipalScope(
      principal,
      deps.tokenRuleRepo,
      deps.tokenScopeCache,
    );
    if (!initialScope) {
      throw new InkadeError("UNAUTHORIZED", "Token is no longer active");
    }

    return streamSSE(c, async (stream) => {
      let closed = false;
      const subscriberId = `sub_${crypto.randomUUID()}`;

      const cleanupFns: Array<() => void> = [];
      const cleanup = () => {
        if (closed) return;
        closed = true;
        for (const fn of cleanupFns) {
          fn();
        }
      };

      stream.onAbort(cleanup);
      c.req.raw.signal.addEventListener("abort", cleanup, { once: true });

      // Flush response headers immediately so fetch-based SSE clients open without waiting for the first domain event.
      await stream.writeln(": connected\n");

      if (lastSeq !== null) {
        const missed = deps.sseHub.getEventsSince(lastSeq, principal.workspaceId);
        const visibleMissed = await deps.sseHub.filterEventsForScope(
          missed,
          principal.workspaceId,
          initialScope,
          subscriberIdentity,
        );
        for (const evt of visibleMissed) {
          if (closed) break;
          await stream.writeSSE({
            id: String(evt.seq),
            event: evt.type,
            data: JSON.stringify(evt),
          });
        }
      }

      const unsubscribe = deps.sseHub.subscribe({
        id: subscriberId,
        workspaceId: principal.workspaceId,
        ...subscriberIdentity,
        resolveScope: () =>
          resolveCurrentPrincipalScope(principal, deps.tokenRuleRepo, deps.tokenScopeCache),
        send: async (envelope) => {
          if (closed) return;
          await stream.writeSSE({
            id: String(envelope.seq),
            event: envelope.type,
            data: JSON.stringify(envelope),
          });
        },
        onRevoked: () => {
          cleanup();
          void stream.close();
        },
      });
      cleanupFns.push(unsubscribe);

      const keepAliveTimer = setInterval(() => {
        if (closed) return;
        void stream.writeln(": keepalive\n").catch(() => {
          cleanup();
        });
      }, 20_000);
      if (typeof keepAliveTimer === "object" && "unref" in keepAliveTimer) {
        keepAliveTimer.unref();
      }
      cleanupFns.push(() => clearInterval(keepAliveTimer));

      await new Promise<void>((resolve) => {
        if (closed) {
          resolve();
          return;
        }
        cleanupFns.push(resolve);
      });
    });
  });
}
