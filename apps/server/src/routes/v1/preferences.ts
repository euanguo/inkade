import type { Hono } from "hono";
import { userPreferencesPatchSchema } from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";

export function registerPreferencesRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/preferences", async (c) => {
    const record = await services.preferences.getPreferences(c.get("principal"));
    return c.json(record);
  });

  router.patch("/preferences", zValidate("json", userPreferencesPatchSchema), async (c) => {
    const record = await services.preferences.updatePreferences(
      c.get("principal"),
      c.req.valid("json"),
    );
    return c.json(record);
  });
}
