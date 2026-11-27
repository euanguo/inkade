import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asAgentStepId,
  buildUnifiedInboxEntries,
  countUnifiedInboxBadge,
  todayLocalDateString,
  type InkadeEvent,
} from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, InkadeApiError } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";
import type { BriefingServiceTransport } from "./services/briefing-service.ts";

interface Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
}

const activeHarnesses: Harness[] = [];

async function startBriefingTestServer(options?: {
  readonly enableBriefingScheduler?: boolean | undefined;
  readonly briefingTransport?: BriefingServiceTransport | undefined;
}): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase46-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase46-suite-32bytes",
    enableBriefingScheduler: options?.enableBriefingScheduler ?? false,
    briefingTransport: options?.briefingTransport,
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    fetch: instance.fetch,
    websocket: instance.websocket,
  });
  const harness: Harness = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    instance,
    server,
  };
  activeHarnesses.push(harness);
  return harness;
}

afterEach(async () => {
  while (activeHarnesses.length > 0) {
    const h = activeHarnesses.pop()!;
    await h.server.stop(true);
    h.instance.close();
  }
});

async function collectSseEvents(
  url: string,
  headers: Record<string, string>,
  predicate: (event: InkadeEvent) => boolean,
  timeoutMs = 3000,
): Promise<{ readonly events: InkadeEvent[]; readonly stop: () => void }> {
  const abortController = new AbortController();
  const events: InkadeEvent[] = [];

  const response = await fetch(url, {
    headers: { Accept: "text/event-stream", ...headers },
    signal: abortController.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed SSE connect: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const loop = (async () => {
    try {
      while (!abortController.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIdx = buffer.indexOf("\n\n");
        while (sepIdx !== -1) {
          const frame = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          for (const line of frame.split("\n")) {
            if (line.startsWith("data:")) {
              const raw = line.slice(5).trim();
              if (!raw) continue;
              try {
                const parsed = JSON.parse(raw) as InkadeEvent;
                events.push(parsed);
                if (predicate(parsed)) {
                  abortController.abort();
                }
              } catch {
                // ignore keepalive comments
              }
            }
          }
          sepIdx = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // aborted cleanly
    }
  })();

  const stop = () => {
    abortController.abort();
  };

  setTimeout(() => {
    abortController.abort();
  }, timeoutMs).unref?.();

  void loop;
  return { events, stop };
}

describe("Phase 46: Scheduled Agent Briefings", () => {
  test("validates Cron expressions and IANA timezones and computes nextRunAt across presets", async () => {
    const { baseUrl } = await startBriefingTestServer();
    const sdk = createInkadeClient({ baseUrl });

    const initial = await sdk.briefings.listJobs();
    expect(initial.jobs).toHaveLength(0);
    expect(initial.presets.map((p) => p.id)).toEqual(["morning_clips_rss", "weekly_review"]);

    let badCronErr: unknown = null;
    try {
      await sdk.briefings.createJob({
        name: "Bad Cron",
        cronExpr: "not-a-cron",
        timezone: "UTC",
        promptTemplate: "Summarize",
      });
    } catch (err) {
      badCronErr = err;
    }
    expect(badCronErr).toBeInstanceOf(InkadeApiError);

    let badTzErr: unknown = null;
    try {
      await sdk.briefings.createJob({
        name: "Bad Timezone",
        cronExpr: "30 7 * * *",
        timezone: "Invalid/Mars_City",
        promptTemplate: "Summarize",
      });
    } catch (err) {
      badTzErr = err;
    }
    expect(badTzErr).toBeInstanceOf(InkadeApiError);

    const morningPreset = initial.presets.find((p) => p.id === "morning_clips_rss")!;
    const created = await sdk.briefings.createJob({
      name: "Morning Clips & RSS",
      cronExpr: morningPreset.cronExpr,
      timezone: "Asia/Shanghai",
      executionPath: morningPreset.executionPath,
      promptTemplate: morningPreset.promptTemplate,
      sources: morningPreset.sources,
      target: morningPreset.target,
      enabled: true,
    });

    expect(created.id.startsWith("brj_")).toBe(true);
    expect(created.nextRunAt).toBeTruthy();
    expect(Number.isFinite(Date.parse(created.nextRunAt!))).toBe(true);
    expect(created.enabled).toBe(true);

    const paused = await sdk.briefings.updateJob(created.id, { enabled: false });
    expect(paused.enabled).toBe(false);
    expect(paused.nextRunAt).toBeNull();

    const resumed = await sdk.briefings.updateJob(created.id, { enabled: true });
    expect(resumed.enabled).toBe(true);
    expect(resumed.nextRunAt).toBeTruthy();

    await sdk.briefings.deleteJob(created.id);
    const afterDelete = await sdk.briefings.listJobs();
    expect(afterDelete.jobs).toHaveLength(0);
  });

  test("builtin_rag writes silent cited briefings into Daily Outline & Space Articles without blocking approvals and supports full batchId rollback", async () => {
    const { baseUrl } = await startBriefingTestServer();
    const sdk = createInkadeClient({ baseUrl });

    // Create Work space that the job's token policy CANNOT access
    const secretWorkSpace = await sdk.spaces.create({
      name: "Confidential Work",
      defaultKind: "article",
    });

    const inboxClip = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Browser Rendering Internals Clip",
      contentMarkdown: "Frame pipelining improves web smoothness and INP latency.",
      sourceUrl: "https://example.com/rendering",
      tags: ["web", "perf"],
    });
    const rssClip = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "SQLite WAL Concurrency Digest",
      contentMarkdown: "WAL mode permits concurrent readers alongside single writer commits.",
      sourceUrl: "https://example.com/sqlite-wal",
      tags: ["rss", "sqlite"],
      sourceMeta: { feedId: "rss_test_feed" },
    });
    const researchNote = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Q4 Architecture Priorities",
      contentMarkdown: "- [ ] Ship scheduled briefings pipeline with zero approval popups\nKey focus on observability.",
      tags: ["architecture"],
    });
    const secretWorkDoc = await sdk.documents.create({
      spaceId: secretWorkSpace.id,
      kind: "article",
      title: "Executive Compensation Secret",
      contentMarkdown: "Confidential salary tables and bonus formulas.",
      tags: ["secret"],
    });

    await sdk.search.reindex();

    // Token rule scoped ONLY to Inbox, Daily, Research (excludes secretWorkSpace!)
    const scopedPolicy = await sdk.tokens.create({
      name: "briefing-scoped-policy",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.inbox, DEFAULT_SPACE_IDS.daily, DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: false, // server must still force denyHardDelete=true at runtime
      },
    });

    // 1. Daily outline section job (offline fallback deterministic RAG path -> zero LLM key)
    const dailyJob = await sdk.briefings.createJob({
      name: "Morning Daily Synthesis",
      cronExpr: "30 7 * * *",
      timezone: "UTC",
      executionPath: "builtin_rag",
      tokenRuleId: scopedPolicy.token.id,
      promptTemplate: "Summarize browser rendering, SQLite WAL, and open tasks with citations.",
      sources: {
        spaceIds: "*",
        includeClipsLastDays: 2,
        includeRssFeeds: true,
        includeTasks: true,
        contextPackIds: [],
        maxItemsPerSource: 10,
      },
      target: {
        mode: "daily_section",
        sectionHeading: "## Morning Agent Digest",
        targetSpaceId: null,
        titleTemplate: "Morning · {{date}}",
        tags: ["briefing"],
      },
      enabled: true,
    });

    const dailyRun = await sdk.briefings.runJobNow(dailyJob.id);
    expect(dailyRun.status).toBe("succeeded");
    expect(dailyRun.batchId).toBeTruthy();
    expect(dailyRun.documentId).toBeTruthy();
    expect(dailyRun.citations.length).toBeGreaterThanOrEqual(2);
    // Restricted Work space doc MUST NEVER leak into citations
    expect(dailyRun.citations.some((c) => c.docId === secretWorkDoc.id)).toBe(false);
    expect(
      dailyRun.citations.some((c) => c.docId === inboxClip.id || c.docId === rssClip.id),
    ).toBe(true);

    // Zero blocking approvals emitted
    const bindings = await sdk.threadBindings.list({});
    expect(bindings.some((b) => b.status === "waiting_input")).toBe(false);

    // Written into Today's Daily Outline with [1]/[2] citations and unreadAgentUpdate=true
    const today = todayLocalDateString();
    const daily = await sdk.documents.getDaily(today);
    expect(daily.document.id).toBe(dailyRun.documentId!);
    expect(daily.document.unreadAgentUpdate).toBe(true);
    const combinedNodesText = daily.nodes.map((n) => n.contentMarkdown).join("\n");
    expect(combinedNodesText).toContain("Morning Agent Digest");
    expect(combinedNodesText).toContain("[1]");

    // Surfaces in Unified Inbox Digest with batch attribution
    const allDocs = await sdk.documents.list({ limit: 100 });
    const inboxEntries = buildUnifiedInboxEntries({
      docs: allDocs,
      bindings: [],
      briefingRuns: [dailyRun],
      inboxSpaceId: DEFAULT_SPACE_IDS.inbox,
      docLatestBatchMap: {
        [dailyRun.documentId!]: {
          batchId: dailyRun.batchId!,
          summary: dailyRun.summary!,
          createdAt: dailyRun.finishedAt!,
        },
      },
    });
    const digestEntry = inboxEntries.active.find(
      (entry) => entry.kind === "digest" && entry.doc.id === dailyRun.documentId,
    );
    expect(digestEntry).toBeDefined();
    expect(digestEntry?.kind === "digest" ? digestEntry.batchId : null).toBe(dailyRun.batchId);

    // Undo Batch rewinds Daily outline completely back before briefing nodes
    const dailyRollback = await sdk.auditLogs.rollbackBatch(dailyRun.batchId!, { force: true });
    expect(dailyRollback.rolledBackCount).toBeGreaterThanOrEqual(1);
    const dailyAfterRollback = await sdk.documents.getDaily(today);
    const nodesTextAfterRollback = dailyAfterRollback.nodes.map((n) => n.contentMarkdown).join("\n");
    expect(nodesTextAfterRollback).not.toContain("Morning Agent Digest");

    // 2. Space article job -> creates standalone article and rolls back cleanly by deleting it
    const articleJob = await sdk.briefings.createJob({
      name: "Weekly Research Synthesis",
      cronExpr: "0 17 * * 5",
      timezone: "UTC",
      executionPath: "builtin_rag",
      tokenRuleId: scopedPolicy.token.id,
      promptTemplate: "Compile weekly synthesis about rendering [1] and priorities [2].",
      target: {
        mode: "space_article",
        sectionHeading: "## Weekly",
        targetSpaceId: DEFAULT_SPACE_IDS.research,
        titleTemplate: "Weekly Synthesis · {{date}}",
        tags: ["briefing", "weekly"],
      },
      enabled: true,
    });

    const articleRun = await sdk.briefings.runJobNow(articleJob.id);
    expect(articleRun.status).toBe("succeeded");
    expect(articleRun.documentId).toBeTruthy();
    expect(articleRun.batchId).toBeTruthy();
    expect(researchNote.id).toBeTruthy();

    const createdArticle = await sdk.documents.get(articleRun.documentId!);
    expect(createdArticle.spaceId).toBe(DEFAULT_SPACE_IDS.research);
    expect(createdArticle.unreadAgentUpdate).toBe(true);
    expect(createdArticle.contentMarkdown).toContain("[1]");
    expect(createdArticle.contentMarkdown).toContain("## Citations");

    // Full batch rollback hard-deletes the briefing-created article cleanly
    const articleRollback = await sdk.auditLogs.rollbackBatch(articleRun.batchId!, { force: true });
    expect(articleRollback.rolledBackCount).toBe(1);
    expect(articleRollback.deletedDocumentIds).toContain(createdArticle.id);
    let deletedArticleErr: unknown = null;
    try {
      await sdk.documents.get(createdArticle.id);
    } catch (err) {
      deletedArticleErr = err;
    }
    expect(deletedArticleErr).toBeInstanceOf(InkadeApiError);
  });

  test("handles AI provider failures & simulateError by routing failed runs to Inbox Exceptions and supporting dismissRun", async () => {
    let shouldFailLlm = true;
    const { baseUrl } = await startBriefingTestServer({
      briefingTransport: {
        generateBriefingText: () => {
          if (shouldFailLlm) {
            return Promise.reject(
              new Error("Upstream LLM gateway returned 503 Service Unavailable"),
            );
          }
          return Promise.resolve({ text: "Recovered briefing [1] generated after retry." });
        },
      },
    });
    const sdk = createInkadeClient({ baseUrl });

    await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Sample Clip For Recovery",
      contentMarkdown: "Important note content for citation [1].",
    });

    const job = await sdk.briefings.createJob({
      name: "AI Synthesis Monitor",
      cronExpr: "0 8 * * *",
      timezone: "UTC",
      executionPath: "builtin_rag",
      promptTemplate: "Synthesize updates cleanly.",
      target: {
        mode: "daily_section",
        sectionHeading: "## AI Monitor",
      },
      enabled: true,
    });

    // 1. simulateError explicitly creates a failed run
    const simFailedRun = await sdk.briefings.runJobNow(job.id, {
      simulateError: "Simulated timeout during RSS fetch",
    });
    expect(simFailedRun.status).toBe("failed");
    expect(simFailedRun.errorMessage).toContain("Simulated timeout");

    // 2. Enabled LLM provider failure also creates a failed run (instead of silently hiding)
    const llmFailedRun = await sdk.briefings.runJobNow(job.id);
    expect(llmFailedRun.status).toBe("failed");
    expect(llmFailedRun.errorMessage).toContain("503 Service Unavailable");

    const updatedJob = await sdk.briefings.getJob(job.id);
    expect(updatedJob.lastStatus).toBe("failed");

    const runs = await sdk.briefings.listRuns({ jobId: job.id, undismissedOnly: true });
    expect(runs.filter((r) => r.status === "failed")).toHaveLength(2);

    // Inbox Exceptions surfaces both failed briefing runs and badge counts them
    const inboxBuild = buildUnifiedInboxEntries({
      docs: [],
      bindings: [],
      briefingRuns: runs,
      inboxSpaceId: DEFAULT_SPACE_IDS.inbox,
    });
    expect(inboxBuild.counts.exceptions).toBe(2);
    expect(inboxBuild.active.filter((i) => i.kind === "briefing_failed")).toHaveLength(2);
    expect(
      countUnifiedInboxBadge({
        docs: [],
        bindings: [],
        briefingRuns: runs,
        inboxSpaceId: DEFAULT_SPACE_IDS.inbox,
      }),
    ).toBe(2);

    // Dismissing one clears it from Exceptions & badge
    const dismissed = await sdk.briefings.dismissRun(simFailedRun.id);
    expect(dismissed.dismissedAt).toBeTruthy();

    const remainingRuns = await sdk.briefings.listRuns({ jobId: job.id });
    expect(
      countUnifiedInboxBadge({
        docs: [],
        bindings: [],
        briefingRuns: remainingRuns,
        inboxSpaceId: DEFAULT_SPACE_IDS.inbox,
      }),
    ).toBe(1);

    // Dismiss second & retry when LLM recovers
    await sdk.briefings.dismissRun(llmFailedRun.id);
    shouldFailLlm = false;
    const recoveredRun = await sdk.briefings.runJobNow(job.id);
    expect(recoveredRun.status).toBe("succeeded");
  });

  test("external_ade emits briefing.wakeup SSE with batchId, updates ThreadBinding steps, and enforces TokenScope", async () => {
    const { baseUrl } = await startBriefingTestServer();
    const sdk = createInkadeClient({ baseUrl });

    const targetDoc = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "ADE Research Coordinator",
      contentMarkdown: "# Coordinator\n\nTarget canvas.",
    });

    const secretSpace = await sdk.spaces.create({
      name: "Private Vault",
      defaultKind: "article",
    });
    const secretDoc = await sdk.documents.create({
      spaceId: secretSpace.id,
      kind: "article",
      title: "Vault Secret",
      contentMarkdown: "Vault key material",
    });

    const pack = await sdk.contextPacks.create({
      name: "Inbox Focus",
      description: "Inbox recent docs",
      maxTokens: 2000,
      rules: {
        spaceIds: [DEFAULT_SPACE_IDS.inbox],
        recentDays: 7,
      },
    });

    const binding = await sdk.threadBindings.upsert({
      documentId: targetDoc.id,
      adeKind: "bb",
      externalThreadId: "thr_briefing_wakeup_test",
      title: "Nightly Researcher",
      status: "queued",
      progressSteps: [{ id: asAgentStepId("stp_init"), label: "Ready", status: "completed" }],
    });

    const readOnlyToken = await sdk.tokens.create({
      name: "read-only-token",
      scope: {
        permission: "read",
        spaceIds: "*",
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const readOnlySdk = createInkadeClient({ baseUrl, token: readOnlyToken.rawToken });

    // Read-only tokens cannot create or trigger briefings
    let createDeniedErr: unknown = null;
    try {
      await readOnlySdk.briefings.createJob({
        name: "Unauthorized Create",
        cronExpr: "0 9 * * *",
        timezone: "UTC",
        promptTemplate: "Should fail",
      });
    } catch (err) {
      createDeniedErr = err;
    }
    expect(createDeniedErr).toBeInstanceOf(InkadeApiError);
    expect((createDeniedErr as InkadeApiError).status).toBe(403);

    const agentScopedPolicy = await sdk.tokens.create({
      name: "ade-briefing-agent",
      scope: {
        permission: "append",
        spaceIds: [DEFAULT_SPACE_IDS.inbox, DEFAULT_SPACE_IDS.daily],
        includeDescendants: true,
        denyHardDelete: false,
      },
    });

    const wakeupJob = await sdk.briefings.createJob({
      name: "External ADE Nightly Ping",
      cronExpr: "0 22 * * *",
      timezone: "UTC",
      executionPath: "external_ade",
      bindingId: binding.id,
      tokenRuleId: agentScopedPolicy.token.id,
      promptTemplate: "Wake external ADE to synthesize inbox findings.",
      sources: {
        spaceIds: "*",
        includeClipsLastDays: 7,
        includeRssFeeds: true,
        includeTasks: true,
        contextPackIds: [pack.id],
        maxItemsPerSource: 10,
      },
      target: {
        mode: "daily_section",
        sectionHeading: "## ADE Nightly",
      },
      enabled: true,
    });

    // Cannot run external_ade using read-only caller token
    let runDeniedErr: unknown = null;
    try {
      await readOnlySdk.briefings.runJobNow(wakeupJob.id);
    } catch (err) {
      runDeniedErr = err;
    }
    expect(runDeniedErr).toBeInstanceOf(InkadeApiError);
    expect((runDeniedErr as InkadeApiError).status).toBe(403);

    // Listen to SSE with the scoped agent token and verify briefing.wakeup arrives
    const sse = await collectSseEvents(
      `${baseUrl}/api/v1/events`,
      { Authorization: `Bearer ${agentScopedPolicy.rawToken}` },
      (evt) => evt.type === "briefing.wakeup",
    );

    const run = await sdk.briefings.runJobNow(wakeupJob.id);
    expect(run.status).toBe("dispatched");
    expect(run.batchId).toBeTruthy();

    // Wait briefly for SSE delivery
    const deadline = Date.now() + 1500;
    while (
      !sse.events.some((e) => e.type === "briefing.wakeup") &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 25));
    }
    sse.stop();

    const wakeupEvent = sse.events.find(
      (e): e is InkadeEvent<"briefing.wakeup"> => e.type === "briefing.wakeup",
    );
    expect(wakeupEvent).toBeDefined();
    expect(wakeupEvent?.payload.jobId).toBe(wakeupJob.id);
    expect(wakeupEvent?.payload.batchId).toBe(run.batchId!);
    expect(wakeupEvent?.payload.bindingId).toBe(binding.id);
    expect(wakeupEvent?.payload.contextPackSlugs).toContain(pack.slug);
    expect(wakeupEvent?.payload.allowedDocumentIds).toContain(targetDoc.id);
    expect(wakeupEvent?.payload.allowedDocumentIds).not.toContain(secretDoc.id);
    // TokenScope intersection MUST enforce denyHardDelete=true on wakeup scopeSummary
    expect(wakeupEvent?.payload.scopeSummary.denyHardDelete).toBe(true);
    expect(wakeupEvent?.payload.scopeSummary.allowedSpaceIds).not.toContain(secretSpace.id);

    const refreshedBinding = await sdk.threadBindings.get(binding.id);
    expect(
      refreshedBinding.progressSteps?.some((step) =>
        step.label.includes("Briefing wakeup: External ADE Nightly Ping"),
      ),
    ).toBe(true);
  });

  test("localizes Chinese offline briefings and omits markdown checkboxes under watchlist so /tasks has zero phantom duplicates", async () => {
    const { baseUrl } = await startBriefingTestServer();
    const sdk = createInkadeClient({ baseUrl });

    await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "索引性能基线观察",
      contentMarkdown:
        "- [ ] 校验本地 RSS 与日历同步策略\nSQLite WAL 模式在并发读取下保持稳定延迟。",
      tags: ["research", "sqlite"],
    });
    await sdk.search.reindex();

    const tasksBefore = await sdk.tasks.list({});
    const scopedPolicy = await sdk.tokens.create({
      name: "zh-briefing-policy",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.inbox, DEFAULT_SPACE_IDS.daily, DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    const zhJob = await sdk.briefings.createJob({
      name: "每日中文研究简报",
      cronExpr: "0 8 * * *",
      timezone: "Asia/Shanghai",
      executionPath: "builtin_rag",
      tokenRuleId: scopedPolicy.token.id,
      promptTemplate: "汇总近期研究笔记、SQLite WAL 表现与关注待办并附上引用。",
      sources: {
        spaceIds: "*",
        includeClipsLastDays: 7,
        includeRssFeeds: true,
        includeTasks: true,
        contextPackIds: [],
        maxItemsPerSource: 10,
      },
      target: {
        mode: "space_article",
        sectionHeading: "## 研究简报",
        targetSpaceId: DEFAULT_SPACE_IDS.research,
        titleTemplate: "中文研究简报 · {{date}}",
        tags: ["briefing"],
      },
      enabled: true,
    });

    const zhRun = await sdk.briefings.runJobNow(zhJob.id);
    expect(zhRun.status).toBe("succeeded");
    expect(zhRun.documentId).toBeTruthy();

    const createdDoc = await sdk.documents.get(zhRun.documentId!);
    expect(createdDoc.contentMarkdown).toContain("每日中文研究简报");
    expect(createdDoc.contentMarkdown).toContain("### 核心摘录与来源");
    expect(createdDoc.contentMarkdown).toContain("### 关注待办");
    expect(createdDoc.contentMarkdown).toContain("## 参考引用");
    expect(createdDoc.contentMarkdown).not.toContain("- [ ]");
    expect(createdDoc.contentMarkdown).not.toContain("- [x]");

    const tasksAfter = await sdk.tasks.list({});
    expect(tasksAfter.length).toBe(tasksBefore.length);
  });
});
