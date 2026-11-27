import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Hono } from "hono";
import {
  asContextPackId,
  createContextPackInputSchema,
  InkadeError,
  updateContextPackInputSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";

export function registerContextPackRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/context-packs", async (c) => {
    const packs = await services.contextPack.listPacks(c.get("principal"));
    return c.json({ packs });
  });

  router.post("/context-packs", zValidate("json", createContextPackInputSchema), async (c) => {
    const pack = await services.contextPack.createPack(c.get("principal"), c.req.valid("json"));
    return c.json({ pack }, 201);
  });

  router.get("/context-packs/:slug", async (c) => {
    const rawMax = c.req.query("maxTokens");
    const parsedMax = rawMax ? Number.parseInt(rawMax, 10) : undefined;
    const maxTokens =
      parsedMax !== undefined && Number.isFinite(parsedMax) && parsedMax > 0
        ? parsedMax
        : undefined;

    const rendered = await services.contextPack.renderPackBySlug(
      c.get("principal"),
      c.req.param("slug"),
      maxTokens,
    );
    return c.json(rendered);
  });

  router.patch(
    "/context-packs/:id",
    zValidate("json", updateContextPackInputSchema),
    async (c) => {
      const pack = await services.contextPack.updatePack(
        c.get("principal"),
        asContextPackId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ pack });
    },
  );

  router.delete("/context-packs/:id", async (c) => {
    const id = asContextPackId(c.req.param("id"));
    await services.contextPack.deletePack(c.get("principal"), id);
    return c.json({ deleted: true, id });
  });

  router.get("/connect/status", async (c) => {
    const url = new URL(c.req.url);
    const forwardedProto = c.req.header("x-forwarded-proto");
    const forwardedHost = c.req.header("x-forwarded-host") ?? c.req.header("host");
    const origin = forwardedHost
      ? `${forwardedProto || url.protocol.replace(":", "")}://${forwardedHost}`
      : url.origin;
    const status = await services.contextPack.getConnectStatus(c.get("principal"), origin);
    return c.json(status);
  });

  router.get("/connect/plugins/archive", async () => {
    const configuredPath = process.env.INKADE_PLUGINS_ZIP_PATH?.trim();
    const candidatePaths = [
      ...(configuredPath ? [resolve(configuredPath)] : []),
      resolve(import.meta.dir, "../../../../../dist/ade-plugins/inkade-ade-plugins.zip"),
      resolve(process.cwd(), "dist/ade-plugins/inkade-ade-plugins.zip"),
    ];
    const archivePath = candidatePaths.find((candidate) => existsSync(candidate));
    if (!archivePath) {
      throw new InkadeError(
        "NOT_FOUND",
        "ADE plugin bundle archive not built yet. Run `bun run build:plugins` first.",
      );
    }
    const bytes = await readFile(archivePath);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="inkade-ade-plugins.zip"',
        "cache-control": "no-cache",
      },
    });
  });
}
