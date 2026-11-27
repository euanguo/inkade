import type { Hono } from "hono";
import {
  asDocumentArtifactId,
  asDocumentId,
  createDocumentArtifactInputSchema,
  submitArtifactCommentInputSchema,
  updateDocumentArtifactInputSchema,
  validateDocumentArtifactInputSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";

function resolveServerOriginFromRequest(req: Request, forwardedHost?: string, forwardedProto?: string): string {
  const reqUrl = new URL(req.url);
  if (forwardedHost) {
    const proto = forwardedProto?.trim() || reqUrl.protocol.replace(":", "");
    return `${proto}://${forwardedHost.trim()}`;
  }
  return reqUrl.origin;
}

function extractClientOriginFromHeaders(originHeader?: string, refererHeader?: string): string | undefined {
  const direct = originHeader?.trim();
  if (direct && direct !== "null") {
    return direct;
  }
  const ref = refererHeader?.trim();
  if (!ref) return undefined;
  try {
    const parsed = new URL(ref);
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function registerArtifactRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/documents/:id/artifacts", async (c) => {
    const artifacts = await services.artifact.listArtifacts(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ artifacts });
  });

  router.post(
    "/documents/:id/artifacts",
    zValidate("json", createDocumentArtifactInputSchema),
    async (c) => {
      const result = await services.artifact.createArtifact(
        c.get("principal"),
        asDocumentId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json(result, 201);
    },
  );

  router.get("/artifacts/runtime-config", (c) => {
    return c.json(services.artifact.getRuntimeConfigStatus());
  });

  router.post(
    "/artifacts/validate",
    zValidate("json", validateDocumentArtifactInputSchema),
    (c) => {
      const result = services.artifact.validateArtifact(c.req.valid("json"));
      return c.json(result);
    },
  );

  router.get("/artifacts/:id", async (c) => {
    const artifact = await services.artifact.getArtifact(
      c.get("principal"),
      asDocumentArtifactId(c.req.param("id")),
    );
    return c.json({ artifact });
  });

  router.patch(
    "/artifacts/:id",
    zValidate("json", updateDocumentArtifactInputSchema),
    async (c) => {
      const result = await services.artifact.updateArtifact(
        c.get("principal"),
        asDocumentArtifactId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json(result);
    },
  );

  router.delete("/artifacts/:id", async (c) => {
    const result = await services.artifact.deleteArtifact(
      c.get("principal"),
      asDocumentArtifactId(c.req.param("id")),
    );
    return c.json(result);
  });

  router.post("/artifacts/:id/sandbox-ticket", async (c) => {
    const serverOrigin = resolveServerOriginFromRequest(
      c.req.raw,
      c.req.header("x-forwarded-host") ?? c.req.header("host"),
      c.req.header("x-forwarded-proto"),
    );
    const clientOrigin = extractClientOriginFromHeaders(
      c.req.header("origin"),
      c.req.header("referer"),
    );
    const ticket = await services.artifact.issueSandboxTicket(
      c.get("principal"),
      asDocumentArtifactId(c.req.param("id")),
      { serverOrigin, clientOrigin },
    );
    return c.json(ticket, 201);
  });

  router.post(
    "/artifacts/:id/comments",
    zValidate("json", submitArtifactCommentInputSchema),
    async (c) => {
      const result = await services.artifact.submitArtifactComment(
        c.get("principal"),
        asDocumentArtifactId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json(result, 201);
    },
  );
}
