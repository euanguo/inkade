import type { Hono } from "hono";
import {
  awaySummaryQuerySchema,
  embedTicketExchangeInputSchema,
  InkadeError,
  workspaceGraphQuerySchema,
} from "@inkade/core";
import type { StorageDialect } from "@inkade/db";
import type { EmbedTicketManager } from "../../auth/embed-ticket.ts";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";
import { setupOwnerBodySchema } from "./schemas.ts";

export interface BootstrapRouteDeps {
  readonly dialect: StorageDialect;
  readonly services: InkadeServices;
  readonly embedTickets: EmbedTicketManager;
}

export async function servePublicSiteFeedResponse(
  services: Pick<InkadeServices, "publicSite">,
  slug: string,
  requestUrl: string,
): Promise<Response> {
  const reqUrl = new URL(requestUrl);
  const format = reqUrl.searchParams.get("format") === "atom" ? "atom" : "rss";
  const xml = await services.publicSite.generatePublicFeedXml(slug, {
    origin: reqUrl.origin,
    format,
  });
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type":
        format === "atom"
          ? "application/atom+xml; charset=utf-8"
          : "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}

export function registerPublicBootstrapRoutes(
  router: Hono<InkadeAppEnv>,
  deps: BootstrapRouteDeps,
): void {
  router.get("/health", async (c) => {
    try {
      await deps.services.bootstrap.checkDbHealth();
      return c.json({
        ok: true,
        service: "inkade-server",
        dialect: deps.dialect,
        timestamp: new Date().toISOString(),
      });
    } catch {
      return c.json(
        {
          ok: false,
          service: "inkade-server",
          dialect: deps.dialect,
          timestamp: new Date().toISOString(),
        },
        503,
      );
    }
  });

  router.get("/bootstrap", async (c) => {
    const status = await deps.services.bootstrap.getStatus();
    return c.json(status);
  });

  router.post("/bootstrap/setup", zValidate("json", setupOwnerBodySchema), async (c) => {
    return deps.services.bootstrap.setupOwner(c.req.valid("json"), c.req.raw.headers);
  });

  router.get("/public/shares/:token", async (c) => {
    const shared = await deps.services.share.getPublicShare(c.req.param("token"));
    return c.json(shared);
  });

  router.get("/public/sites/:slug", async (c) => {
    const payload = await deps.services.publicSite.getPublicSite(c.req.param("slug"));
    return c.json(payload);
  });

  router.get("/public/sites/:slug/docs/:docSlug", async (c) => {
    const payload = await deps.services.publicSite.getPublicSiteDocument(
      c.req.param("slug"),
      c.req.param("docSlug"),
    );
    return c.json(payload);
  });

  router.get("/public/sites/:slug/feed.xml", async (c) => {
    return servePublicSiteFeedResponse(deps.services, c.req.param("slug"), c.req.url);
  });

  router.post(
    "/auth/embed-ticket/exchange",
    zValidate("json", embedTicketExchangeInputSchema),
    async (c) => {
      const { ticket } = c.req.valid("json");
      const exchanged = await deps.embedTickets.exchangeTicket(ticket);
      if (!exchanged) {
        throw new InkadeError("UNAUTHORIZED", "Invalid or expired embed ticket");
      }
      return c.json(exchanged);
    },
  );
}

export function registerAuthenticatedWorkspaceRoutes(
  router: Hono<InkadeAppEnv>,
  deps: Pick<BootstrapRouteDeps, "services" | "embedTickets">,
): void {
  router.get("/whoami", async (c) => {
    const result = await deps.services.token.whoamiScope(c.get("principal"));
    return c.json(result);
  });

  router.post("/auth/embed-ticket", async (c) => {
    const ticket = await deps.embedTickets.issueTicket(c.get("principal"));
    return c.json(ticket, 201);
  });

  router.get("/workspace/summary", async (c) => {
    const summary = await deps.services.workspace.getSummary(c.get("principal"));
    return c.json(summary);
  });

  router.get("/workspace/away-summary", zValidate("query", awaySummaryQuerySchema), async (c) => {
    const summary = await deps.services.workspace.getAwaySummary(
      c.get("principal"),
      c.req.valid("query"),
    );
    return c.json(summary);
  });

  router.get("/workspace/storage-buckets", async (c) => {
    const buckets = await deps.services.workspace.getStorageBuckets(c.get("principal"));
    return c.json(buckets);
  });

  router.get("/workspace/graph", zValidate("query", workspaceGraphQuerySchema), async (c) => {
    const graph = await deps.services.workspace.getWorkspaceGraph(
      c.get("principal"),
      c.req.valid("query"),
    );
    return c.json(graph);
  });
}
