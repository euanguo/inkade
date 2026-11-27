import type { Hono } from "hono";
import {
  ackWakeEventInputSchema,
  approveThreadBindingInputSchema,
  asThreadBindingId,
  asWakeEventId,
  claimThreadBindingInputSchema,
  createThreadBindingInputSchema,
  heartbeatBridgeSessionInputSchema,
  INKADE_TOOL_DEFINITIONS_BY_NAME,
  pollWakeEventsInputSchema,
  steerThreadBindingInputSchema,
  updateThreadBindingInputSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";
import {
  listBridgeSessionsQuerySchema,
  listThreadBindingsQuerySchema,
  waitWakeEventsQuerySchema,
} from "./schemas.ts";

export function registerThreadRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/thread-bindings", zValidate("query", listThreadBindingsQuerySchema), async (c) => {
    const bindings = await services.threadBinding.listBindings(
      c.get("principal"),
      c.req.valid("query"),
    );
    return c.json({ bindings });
  });

  router.get("/thread-bindings/:id", async (c) => {
    const rawConsume = c.req.query("consumeSteering");
    const consumeSteering = rawConsume === "1" || rawConsume === "true";
    const binding = await services.threadBinding.getBinding(
      c.get("principal"),
      asThreadBindingId(c.req.param("id")),
      { consumeSteering },
    );
    return c.json({ binding });
  });

  router.post(
    "/thread-bindings",
    zValidate("json", createThreadBindingInputSchema),
    async (c) => {
      const binding = await services.threadBinding.upsertBinding(
        c.get("principal"),
        c.req.valid("json"),
      );
      return c.json({ binding }, 201);
    },
  );

  router.patch(
    "/thread-bindings/:id",
    zValidate("json", updateThreadBindingInputSchema),
    async (c) => {
      const binding = await services.threadBinding.updateBinding(
        c.get("principal"),
        asThreadBindingId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ binding });
    },
  );

  router.delete("/thread-bindings/:id", async (c) => {
    const id = asThreadBindingId(c.req.param("id"));
    await services.threadBinding.deleteBinding(c.get("principal"), id);
    return c.json({ deleted: true, id });
  });

  router.post(
    "/thread-bindings/request-decision",
    zValidate("json", INKADE_TOOL_DEFINITIONS_BY_NAME.request_human_decision.inputSchema),
    async (c) => {
      const result = await services.threadBinding.requestHumanDecision(
        c.get("principal"),
        c.req.valid("json"),
      );
      return c.json(result, 201);
    },
  );

  router.post(
    "/thread-bindings/:id/claim",
    zValidate("json", claimThreadBindingInputSchema),
    async (c) => {
      const binding = await services.threadBinding.claimBinding(
        c.get("principal"),
        asThreadBindingId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ binding });
    },
  );

  router.post(
    "/thread-bindings/:id/approve",
    zValidate("json", approveThreadBindingInputSchema),
    async (c) => {
      const binding = await services.threadBinding.approveBinding(
        c.get("principal"),
        asThreadBindingId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ binding });
    },
  );

  router.post(
    "/thread-bindings/:id/steer",
    zValidate("json", steerThreadBindingInputSchema),
    async (c) => {
      const binding = await services.threadBinding.steerBinding(
        c.get("principal"),
        asThreadBindingId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ binding });
    },
  );

  router.post(
    "/wake/sessions/heartbeat",
    zValidate("json", heartbeatBridgeSessionInputSchema),
    async (c) => {
      const result = await services.wake.heartbeatBridgeSession(
        c.get("principal"),
        c.req.valid("json"),
      );
      return c.json({ session: result.session }, result.created ? 201 : 200);
    },
  );

  router.get(
    "/wake/sessions",
    zValidate("query", listBridgeSessionsQuerySchema),
    async (c) => {
      const sessions = await services.wake.listBridgeSessions(
        c.get("principal"),
        c.req.valid("query"),
      );
      return c.json({ sessions });
    },
  );

  router.post(
    "/wake/poll",
    zValidate("json", pollWakeEventsInputSchema),
    async (c) => {
      const wakes = await services.wake.pollWakeEvents(
        c.get("principal"),
        c.req.valid("json"),
      );
      return c.json({ wakes });
    },
  );

  router.get(
    "/wake/wait",
    zValidate("query", waitWakeEventsQuerySchema),
    async (c) => {
      const wakes = await services.wake.waitWakeEvents(
        c.get("principal"),
        c.req.valid("query"),
        c.req.raw.signal,
      );
      return c.json({ wakes });
    },
  );

  router.post(
    "/wake/:id/ack",
    zValidate("json", ackWakeEventInputSchema),
    async (c) => {
      const wake = await services.wake.ackWakeEvent(
        c.get("principal"),
        asWakeEventId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ wake });
    },
  );
}
