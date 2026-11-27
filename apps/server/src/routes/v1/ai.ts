import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  aiRewriteStreamInputSchema,
  askRequestInputSchema,
  testEmbeddingInputSchema,
  updateAiSettingsInputSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";

export function registerAiRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/ai/settings", async (c) => {
    const settings = await services.aiRewrite.getSettings(c.get("principal"));
    return c.json({ settings });
  });

  router.put("/ai/settings", zValidate("json", updateAiSettingsInputSchema), async (c) => {
    const settings = await services.aiRewrite.updateSettings(
      c.get("principal"),
      c.req.valid("json"),
    );
    return c.json({ settings });
  });

  router.post("/ai/test-embedding", zValidate("json", testEmbeddingInputSchema), async (c) => {
    const result = await services.semanticSearch.testEmbeddingConnection(
      c.get("principal"),
      c.req.valid("json"),
    );
    return c.json(result);
  });

  router.post("/ai/rewrite/stream", zValidate("json", aiRewriteStreamInputSchema), async (c) => {
    const prepared = await services.aiRewrite.prepareRewrite(
      c.get("principal"),
      c.req.valid("json"),
    );

    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      const abortHandler = () => controller.abort();
      c.req.raw.signal.addEventListener("abort", abortHandler, { once: true });
      try {
        for await (const event of services.aiRewrite.streamPreparedRewrite(
          prepared,
          controller.signal,
        )) {
          if (controller.signal.aborted) {
            break;
          }
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : "AI stream error";
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ type: "error", message }),
          });
        }
      } finally {
        c.req.raw.signal.removeEventListener("abort", abortHandler);
      }
    });
  });

  router.post("/ask", zValidate("json", askRequestInputSchema), async (c) => {
    const prepared = await services.ask.prepareAsk(c.get("principal"), c.req.valid("json"));

    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      const abortHandler = () => controller.abort();
      c.req.raw.signal.addEventListener("abort", abortHandler, { once: true });
      try {
        for await (const event of services.ask.streamPreparedAsk(prepared, controller.signal)) {
          if (controller.signal.aborted) {
            break;
          }
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : "Ask stream error";
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ type: "error", message }),
          });
        }
      } finally {
        c.req.raw.signal.removeEventListener("abort", abortHandler);
      }
    });
  });
}
