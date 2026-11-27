import type { Hono } from "hono";
import {
  asBriefingJobId,
  asBriefingRunId,
  briefingRunStatusSchema,
  createBriefingJobInputSchema,
  InkadeError,
  runBriefingJobInputSchema,
  updateBriefingJobInputSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";

export function registerBriefingRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/briefings/jobs", async (c) => {
    const result = await services.briefing.listJobs(c.get("principal"));
    return c.json(result);
  });

  router.post("/briefings/jobs", zValidate("json", createBriefingJobInputSchema), async (c) => {
    const job = await services.briefing.createJob(c.get("principal"), c.req.valid("json"));
    return c.json({ job }, 201);
  });

  router.get("/briefings/jobs/:id", async (c) => {
    const job = await services.briefing.getJob(
      c.get("principal"),
      asBriefingJobId(c.req.param("id")),
    );
    return c.json({ job });
  });

  router.patch("/briefings/jobs/:id", zValidate("json", updateBriefingJobInputSchema), async (c) => {
    const job = await services.briefing.updateJob(
      c.get("principal"),
      asBriefingJobId(c.req.param("id")),
      c.req.valid("json"),
    );
    return c.json({ job });
  });

  router.delete("/briefings/jobs/:id", async (c) => {
    const id = asBriefingJobId(c.req.param("id"));
    await services.briefing.deleteJob(c.get("principal"), id);
    return c.json({ deleted: true, id });
  });

  router.post("/briefings/jobs/:id/run", async (c) => {
    const querySimulateError = c.req.query("simulateError")?.trim() || undefined;
    let bodySimulateError: string | undefined;

    const rawBody = await c.req.text();
    if (rawBody.trim().length > 0) {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBody);
      } catch {
        throw new InkadeError("VALIDATION_ERROR", "Invalid JSON body");
      }
      const parsed = runBriefingJobInputSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new InkadeError("VALIDATION_ERROR", "Request validation failed", {
          target: "json",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
            code: issue.code,
          })),
        });
      }
      bodySimulateError = parsed.data.simulateError;
    }

    const run = await services.briefing.runJobNow(
      c.get("principal"),
      asBriefingJobId(c.req.param("id")),
      {
        simulateError: querySimulateError ?? bodySimulateError,
        triggerKind: "manual",
      },
    );
    return c.json({ run });
  });

  router.get("/briefings/runs", async (c) => {
    const rawJobId = c.req.query("jobId")?.trim();
    const rawStatus = c.req.query("status")?.trim();
    const rawUndismissedOnly = c.req.query("undismissedOnly")?.trim();
    const rawLimit = c.req.query("limit")?.trim();
    const rawOffset = c.req.query("offset")?.trim();

    let status: ReturnType<typeof briefingRunStatusSchema.parse> | undefined;
    if (rawStatus) {
      const parsedStatus = briefingRunStatusSchema.safeParse(rawStatus);
      if (!parsedStatus.success) {
        throw new InkadeError("VALIDATION_ERROR", `Invalid briefing run status "${rawStatus}"`);
      }
      status = parsedStatus.data;
    }

    const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
    const parsedOffset = rawOffset ? Number.parseInt(rawOffset, 10) : undefined;

    const runs = await services.briefing.listRuns(c.get("principal"), {
      ...(rawJobId ? { jobId: asBriefingJobId(rawJobId) } : {}),
      ...(status ? { status } : {}),
      ...(rawUndismissedOnly === "true" || rawUndismissedOnly === "1"
        ? { includeDismissed: false }
        : {}),
      ...(parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? { limit: parsedLimit }
        : {}),
      ...(parsedOffset !== undefined && Number.isFinite(parsedOffset) && parsedOffset >= 0
        ? { offset: parsedOffset }
        : {}),
    });
    return c.json({ runs });
  });

  router.post("/briefings/runs/:runId/dismiss", async (c) => {
    const run = await services.briefing.dismissRun(
      c.get("principal"),
      asBriefingRunId(c.req.param("runId")),
    );
    return c.json({ run });
  });
}
