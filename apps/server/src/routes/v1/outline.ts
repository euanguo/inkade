import type { Hono } from "hono";
import {
  asDocumentId,
  asOutlineNodeId,
  batchOutlineNodesInputSchema,
  createMirrorNodeInputSchema,
  createOutlineNodeInputSchema,
  moveOutlineNodeInputSchema,
  updateOutlineNodeInputSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";
import {
  promoteOutlineNodeBodySchema,
  rolloverOutlineNodesBodySchema,
} from "./schemas.ts";

export function registerOutlineRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/documents/:id/nodes", async (c) => {
    const nodes = await services.outline.listNodes(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ nodes });
  });

  router.post("/outline-nodes", zValidate("json", createOutlineNodeInputSchema), async (c) => {
    const node = await services.outline.createNode(c.get("principal"), c.req.valid("json"));
    return c.json({ node }, 201);
  });

  router.post("/outline-nodes/batch", zValidate("json", batchOutlineNodesInputSchema), async (c) => {
    const result = await services.outline.batchMutate(c.get("principal"), c.req.valid("json"));
    return c.json(result);
  });

  router.post(
    "/outline-nodes/rollover",
    zValidate("json", rolloverOutlineNodesBodySchema),
    async (c) => {
      const { fromDocumentId, toDocumentId } = c.req.valid("json");
      const nodes = await services.outline.rolloverUncheckedNodes(
        c.get("principal"),
        fromDocumentId,
        toDocumentId,
      );
      return c.json({ nodes });
    },
  );

  router.get("/outline-nodes/search", async (c) => {
    const q = c.req.query("q") ?? "";
    const rawLimit = Number.parseInt(c.req.query("limit") ?? "20", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;
    const matches = await services.outline.searchWorkspaceNodes(c.get("principal"), q, limit);
    return c.json({ matches });
  });

  router.post(
    "/outline-nodes/:id/mirror",
    zValidate("json", createMirrorNodeInputSchema),
    async (c) => {
      const result = await services.outline.createMirrorNode(
        c.get("principal"),
        asOutlineNodeId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json(result, 201);
    },
  );

  router.patch("/outline-nodes/:id", zValidate("json", updateOutlineNodeInputSchema), async (c) => {
    const result = await services.outline.updateNodeWithResult(
      c.get("principal"),
      asOutlineNodeId(c.req.param("id")),
      c.req.valid("json"),
    );
    return c.json(result);
  });

  router.delete("/outline-nodes/:id", async (c) => {
    const deleted = await services.outline.softDeleteNode(
      c.get("principal"),
      asOutlineNodeId(c.req.param("id")),
    );
    return c.json({ deleted });
  });

  router.post(
    "/outline-nodes/:id/move",
    zValidate("json", moveOutlineNodeInputSchema),
    async (c) => {
      const node = await services.outline.moveNode(
        c.get("principal"),
        asOutlineNodeId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ node });
    },
  );

  router.post(
    "/outline-nodes/:id/promote",
    zValidate("json", promoteOutlineNodeBodySchema),
    async (c) => {
      const result = await services.document.promoteOutlineSubtreeToArticle(
        c.get("principal"),
        asOutlineNodeId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json(result, 201);
    },
  );
}
