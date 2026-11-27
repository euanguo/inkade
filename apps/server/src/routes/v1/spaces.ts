import type { Hono } from "hono";
import {
  asPublicSiteId,
  asSavedViewId,
  asSpaceId,
  asTemplateId,
  applyDocumentTemplateInputSchema,
  createDocumentTemplateInputSchema,
  createPublicSiteInputSchema,
  createSavedViewInputSchema,
  createSpaceInputSchema,
  updateDocumentTemplateInputSchema,
  updatePublicSiteInputSchema,
  updateSavedViewInputSchema,
  updateSpaceInputSchema,
  upsertSpacePropertySchemaInputSchema,
  viewQueryRequestSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";
import {
  listSpacesQuerySchema,
  listTemplatesQuerySchema,
  spaceSchemaQuerySchema,
} from "./schemas.ts";

export function registerSpaceRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/spaces", zValidate("query", listSpacesQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const items = await services.space.listSpaces(c.get("principal"), {
      includeArchived: query.includeArchived,
    });
    return c.json({ spaces: items });
  });

  router.get("/spaces/schemas", async (c) => {
    const schemas = await services.space.listSpaceSchemas(c.get("principal"));
    return c.json({ schemas });
  });

  router.post("/spaces", zValidate("json", createSpaceInputSchema), async (c) => {
    const space = await services.space.createSpace(c.get("principal"), c.req.valid("json"));
    return c.json({ space }, 201);
  });

  router.get("/spaces/:id", async (c) => {
    const space = await services.space.getSpace(c.get("principal"), asSpaceId(c.req.param("id")));
    return c.json({ space });
  });

  router.get("/spaces/:id/schema", zValidate("query", spaceSchemaQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const schema = await services.space.getSpaceSchema(
      c.get("principal"),
      asSpaceId(c.req.param("id")),
      { templateId: query.templateId },
    );
    return c.json({ schema });
  });

  router.put(
    "/spaces/:id/schema",
    zValidate("json", upsertSpacePropertySchemaInputSchema),
    async (c) => {
      const schema = await services.space.upsertSpaceSchema(
        c.get("principal"),
        asSpaceId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ schema });
    },
  );

  router.patch("/spaces/:id", zValidate("json", updateSpaceInputSchema), async (c) => {
    const space = await services.space.updateSpace(
      c.get("principal"),
      asSpaceId(c.req.param("id")),
      c.req.valid("json"),
    );
    return c.json({ space });
  });

  router.post("/spaces/:id/archive", async (c) => {
    const space = await services.space.archiveSpace(
      c.get("principal"),
      asSpaceId(c.req.param("id")),
    );
    return c.json({ space });
  });

  router.get("/templates", zValidate("query", listTemplatesQuerySchema), async (c) => {
    const templates = await services.template.listTemplates(
      c.get("principal"),
      c.req.valid("query").kind,
    );
    return c.json({ templates });
  });

  router.post("/templates", zValidate("json", createDocumentTemplateInputSchema), async (c) => {
    const template = await services.template.createTemplate(
      c.get("principal"),
      c.req.valid("json"),
    );
    return c.json({ template }, 201);
  });

  router.patch(
    "/templates/:id",
    zValidate("json", updateDocumentTemplateInputSchema),
    async (c) => {
      const template = await services.template.updateTemplate(
        c.get("principal"),
        asTemplateId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ template });
    },
  );

  router.delete("/templates/:id", async (c) => {
    const id = asTemplateId(c.req.param("id"));
    await services.template.deleteTemplate(c.get("principal"), id);
    return c.json({ deleted: true, id });
  });

  router.post(
    "/templates/:id/apply",
    zValidate("json", applyDocumentTemplateInputSchema),
    async (c) => {
      const result = await services.template.applyTemplate(
        c.get("principal"),
        asTemplateId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json(result, 201);
    },
  );

  router.get("/saved-views", async (c) => {
    const savedViews = await services.savedView.listViews(c.get("principal"));
    return c.json({ savedViews });
  });

  router.post("/saved-views", zValidate("json", createSavedViewInputSchema), async (c) => {
    const savedView = await services.savedView.createView(c.get("principal"), c.req.valid("json"));
    return c.json({ savedView }, 201);
  });

  router.patch("/saved-views/:id", zValidate("json", updateSavedViewInputSchema), async (c) => {
    const savedView = await services.savedView.updateView(
      c.get("principal"),
      asSavedViewId(c.req.param("id")),
      c.req.valid("json"),
    );
    return c.json({ savedView });
  });

  router.delete("/saved-views/:id", async (c) => {
    const id = asSavedViewId(c.req.param("id"));
    await services.savedView.deleteView(c.get("principal"), id);
    return c.json({ deleted: true, id });
  });

  router.post("/views/query", zValidate("json", viewQueryRequestSchema), async (c) => {
    const result = await services.viewQuery.queryView(c.get("principal"), c.req.valid("json"));
    return c.json(result);
  });

  router.get("/public-sites", async (c) => {
    const sites = await services.publicSite.listPublicSites(c.get("principal"));
    return c.json({ sites });
  });

  router.post("/public-sites", zValidate("json", createPublicSiteInputSchema), async (c) => {
    const site = await services.publicSite.createPublicSite(
      c.get("principal"),
      c.req.valid("json"),
    );
    return c.json({ site }, 201);
  });

  router.patch("/public-sites/:id", zValidate("json", updatePublicSiteInputSchema), async (c) => {
    const site = await services.publicSite.updatePublicSite(
      c.get("principal"),
      asPublicSiteId(c.req.param("id")),
      c.req.valid("json"),
    );
    return c.json({ site });
  });

  router.delete("/public-sites/:id", async (c) => {
    const id = asPublicSiteId(c.req.param("id"));
    await services.publicSite.deletePublicSite(c.get("principal"), id);
    return c.json({ deleted: true, id });
  });

  router.get("/public-sites/:id/export.zip", async (c) => {
    const origin = new URL(c.req.url).origin;
    const { filename, bytes } = await services.publicSite.exportPublicSiteZip(
      c.get("principal"),
      asPublicSiteId(c.req.param("id")),
      { origin },
    );
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      },
    });
  });
}
