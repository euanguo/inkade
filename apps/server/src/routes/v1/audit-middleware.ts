import type { MiddlewareHandler } from "hono";
import { isInkadeError } from "@inkade/core";
import type { AuditService } from "../../services/audit-service.ts";
import type { InkadeAppEnv } from "../../types.ts";

/**
 * Wraps REST API mutations and access-control failures in request-scoped audit capture.
 */
export function createRestAuditMiddleware(
  auditService: AuditService,
): MiddlewareHandler<InkadeAppEnv> {
  return async (c, next) => {
    const path = c.req.path;
    if (path.endsWith("/events") || path.endsWith("/viewer-context")) {
      await next();
      return;
    }

    const headerBatchId = auditService.resolveRequestBatchHeader(c.req.header("x-inkade-batch-id"));
    await auditService.runWithAuditCapture(
      "rest",
      async (capture) => {
        await next();

        const principal = c.get("principal");
        if (!principal) return;
        const batchMeta = auditService.ensureActiveBatchContext(principal);

        const method = c.req.method.toUpperCase();
        const isMutation = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
        const err = c.error;

        if (err) {
          const denied =
            isInkadeError(err) &&
            (err.code === "FORBIDDEN" || err.code === "HARD_DELETE_BLOCKED");
          if (denied) {
            await auditService
              .recordPrincipalEvent(principal, {
                transport: "rest",
                action: `${method} ${path}`,
                resource: path,
                spaceId: capture.spaceId ?? null,
                documentId: capture.documentId ?? null,
                decision: "denied",
                reason: err.message,
                summary: `${err.code}: ${err.message}`,
                reversible: false,
                irreversibleReason: "Access denied",
                batchId: capture.batchId ?? batchMeta.batchId,
                executionMode: capture.executionMode ?? batchMeta.executionMode,
              })
              .catch(() => {});
          }
          return;
        }

        if (!capture.recorded && isMutation && c.res.status < 400) {
          await auditService
            .recordPrincipalEvent(principal, {
              transport: "rest",
              action: capture.action ?? `${method} ${path}`,
              resource: capture.resource ?? path,
              spaceId: capture.spaceId ?? null,
              documentId: capture.documentId ?? null,
              decision: "allowed",
              summary: capture.summary ?? `${method} ${path} -> ${c.res.status}`,
              beforeRevisionId: capture.beforeRevisionId ?? null,
              afterRevisionId: capture.afterRevisionId ?? null,
              diffPreview: capture.diffPreview ?? null,
              reversible: capture.reversible ?? false,
              irreversibleReason: capture.irreversibleReason ?? null,
              batchId: capture.batchId ?? batchMeta.batchId,
              executionMode: capture.executionMode ?? batchMeta.executionMode,
            })
            .catch(() => {});
        }
      },
      { batchId: headerBatchId },
    );
  };
}
