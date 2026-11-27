import { describe, expect, test } from "bun:test";
import {
  asApiTokenId,
  createBriefingJobInputSchema,
  ID_PREFIXES,
  isPrefixedId,
} from "@inkade/core";
import {
  createSqliteDatabase,
  createSqliteRepositories,
  DEFAULT_SPACE_IDS,
  seedDefaultWorkspace,
} from "./index.ts";

describe("Phase 46 Agent Briefings schema & ThreadBindingRepo briefing methods", () => {
  test("creates, lists, updates, runs, dismisses, and deletes agent_briefing_jobs & agent_briefing_runs", async () => {
    const { sqlite, db } = createSqliteDatabase(":memory:");
    try {
      const repos = createSqliteRepositories(sqlite, db);
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-26" });

      const token = await repos.tokenRule.createApiToken(workspace.id, {
        name: "briefing-scoped-token",
        tokenHash: "sha256_briefing_test_1",
        tokenPrefix: "tok_brf",
        scope: {
          permission: "write",
          spaceIds: [DEFAULT_SPACE_IDS.research],
          includeDescendants: true,
          denyHardDelete: true,
        },
      });

      const parsed = createBriefingJobInputSchema.parse({
        name: "Morning Research Briefing",
        cronExpr: "30 7 * * *",
        timezone: "Asia/Shanghai",
        executionPath: "builtin_rag",
        tokenRuleId: asApiTokenId(token.id),
        promptTemplate: "Summarize recent clips and open tasks.",
        target: {
          mode: "space_article",
          targetSpaceId: DEFAULT_SPACE_IDS.research,
          titleTemplate: "Morning Briefing · {{date}}",
          tags: ["briefing"],
        },
      });

      const job = await repos.threadBinding.createBriefingJob(workspace.id, parsed);
      expect(isPrefixedId(ID_PREFIXES.briefingJob, job.id)).toBe(true);
      expect(job.tokenRuleId).toBe(token.id);
      expect(job.target.targetSpaceId).toBe(DEFAULT_SPACE_IDS.research);

      const enabledList = await repos.threadBinding.listAllEnabledBriefingJobs();
      expect(enabledList.some((j) => j.id === job.id)).toBe(true);

      const runFailed = await repos.threadBinding.createBriefingRun(workspace.id, {
        jobId: job.id,
        triggerKind: "manual",
        status: "failed",
        errorMessage: "Provider timeout",
        durationMs: 25,
        finishedAt: new Date().toISOString(),
      });
      expect(isPrefixedId(ID_PREFIXES.briefingRun, runFailed.id)).toBe(true);
      expect(runFailed.dismissedAt).toBeNull();

      const dismissed = await repos.threadBinding.dismissBriefingRun(workspace.id, runFailed.id);
      expect(dismissed.dismissedAt).not.toBeNull();

      const activeFailed = await repos.threadBinding.listBriefingRuns(workspace.id, {
        status: "failed",
        includeDismissed: false,
      });
      expect(activeFailed).toHaveLength(0);

      await repos.threadBinding.deleteBriefingJob(workspace.id, job.id);
      expect(await repos.threadBinding.getBriefingJobById(workspace.id, job.id)).toBeNull();
    } finally {
      sqlite.close();
    }
  });
});
