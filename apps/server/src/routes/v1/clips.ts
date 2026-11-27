import type { Hono } from "hono";
import { clipLookupQuerySchema, ingestClipUrlInputSchema } from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";

export function registerClipRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/clips/lookup", zValidate("query", clipLookupQuerySchema), async (c) => {
    const { url } = c.req.valid("query");
    const result = await services.clipper.lookupByUrl(c.get("principal"), url);
    return c.json(result);
  });

  router.post("/clips/ingest-url", zValidate("json", ingestClipUrlInputSchema), async (c) => {
    const result = await services.clipper.ingestUrl(c.get("principal"), c.req.valid("json"));
    return c.json(result, 201);
  });
}
