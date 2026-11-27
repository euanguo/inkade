import type { Hono } from "hono";
import { semanticSearchInputSchema } from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";
import { searchRouteQuerySchema } from "./schemas.ts";

export function registerSearchRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/search", zValidate("query", searchRouteQuerySchema), async (c) => {
    const hits = await services.search.search(c.get("principal"), c.req.valid("query"));
    return c.json({ hits });
  });

  router.post("/search/semantic", zValidate("json", semanticSearchInputSchema), async (c) => {
    const result = await services.semanticSearch.hybridSearch(
      c.get("principal"),
      c.req.valid("json"),
    );
    return c.json(result);
  });

  router.get("/search/index-status", async (c) => {
    const status = await services.semanticSearch.getIndexStatus(c.get("principal"));
    return c.json({ status });
  });

  router.post("/search/reindex", async (c) => {
    const result = await services.semanticSearch.reindexWorkspace(c.get("principal"));
    return c.json(result);
  });
}
