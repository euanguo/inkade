import type { Hono } from "hono";
import {
  asApiTokenId,
  asAuditBatchId,
  asAuditLogId,
  asProjectRuleId,
  batchRollbackInputSchema,
  createApiTokenInputSchema,
  listAuditLogsQuerySchema,
  projectScopeRuleInputSchema,
  updateApiTokenInputSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";

export function registerAdminRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/tokens", async (c) => {
    const tokens = await services.token.listTokens(c.get("principal"));
    return c.json({ tokens });
  });

  router.post("/tokens", zValidate("json", createApiTokenInputSchema), async (c) => {
    const created = await services.token.createToken(c.get("principal"), c.req.valid("json"));
    return c.json(created, 201);
  });

  router.patch("/tokens/:id", zValidate("json", updateApiTokenInputSchema), async (c) => {
    const token = await services.token.updateToken(
      c.get("principal"),
      asApiTokenId(c.req.param("id")),
      c.req.valid("json"),
    );
    return c.json({ token });
  });

  router.post("/tokens/:id/revoke", async (c) => {
    const token = await services.token.revokeToken(
      c.get("principal"),
      asApiTokenId(c.req.param("id")),
    );
    return c.json({ token });
  });

  router.get("/scope-rules", async (c) => {
    const rules = await services.scopeRule.listRules(c.get("principal"));
    return c.json({ rules });
  });

  router.post("/scope-rules", zValidate("json", projectScopeRuleInputSchema), async (c) => {
    const rule = await services.scopeRule.createRule(c.get("principal"), c.req.valid("json"));
    return c.json({ rule }, 201);
  });

  router.patch(
    "/scope-rules/:id",
    zValidate("json", projectScopeRuleInputSchema.partial()),
    async (c) => {
      const rule = await services.scopeRule.updateRule(
        c.get("principal"),
        asProjectRuleId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ rule });
    },
  );

  router.delete("/scope-rules/:id", async (c) => {
    const id = asProjectRuleId(c.req.param("id"));
    await services.scopeRule.deleteRule(c.get("principal"), id);
    return c.json({ deleted: true, id });
  });

  router.get("/audit-logs", zValidate("query", listAuditLogsQuerySchema), async (c) => {
    const auditLogs = await services.audit.listLogs(c.get("principal"), c.req.valid("query"));
    return c.json({ auditLogs });
  });

  router.post("/audit-logs/:id/rollback", async (c) => {
    const result = await services.auditRollback.rollback(
      c.get("principal"),
      asAuditLogId(c.req.param("id")),
    );
    return c.json(result);
  });

  router.get("/audit-batches", async (c) => {
    const rawLimit = Number(c.req.query("limit") ?? 20);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
    const batches = await services.audit.listBatchSummaries(c.get("principal"), limit);
    return c.json({ batches });
  });

  router.post("/audit/batches/:batchId/rollback", async (c) => {
    let rawBody: unknown = {};
    try {
      const text = await c.req.text();
      if (text.trim().length > 0) {
        rawBody = JSON.parse(text);
      }
    } catch {
      rawBody = {};
    }
    const parsed = batchRollbackInputSchema.parse(rawBody);
    const result = await services.auditRollback.rollbackBatch(
      c.get("principal"),
      asAuditBatchId(c.req.param("batchId")),
      parsed,
    );
    return c.json(result);
  });
}
