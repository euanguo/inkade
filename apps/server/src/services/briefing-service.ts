import {
  ADMIN_USER_SCOPE,
  asApiTokenId,
  asDocumentId,
  BRIEFING_PRESET_TEMPLATES,
  cleanDisplaySnippet,
  createId,
  evaluateScopeAccess,
  ID_PREFIXES,
  InkadeError,
  intersectTokenScopes,
  resolveAllowedSpaceIds,
  summarizeEffectiveScope,
  todayLocalDateString,
  type AgentBriefingJobRecord,
  type AgentBriefingRunRecord,
  type AgentStepItem,
  type AiProviderPreset,
  type AuditBatchId,
  type BriefingCitation,
  type BriefingJobId,
  type BriefingRunId,
  type BriefingTriggerKind,
  type CreateBriefingJobInput,
  type DocumentId,
  type DocumentRecord,
  type DocumentSummary,
  type ParsedCreateBriefingJobInput,
  type Space,
  type SpaceId,
  type TokenScope,
  type UpdateBriefingJobInput,
  type WorkspaceId,
  createBriefingJobInputSchema,
  updateBriefingJobInputSchema,
} from "@inkade/core";
import {
  DEFAULT_SPACE_IDS,
  type DocumentRepo,
  type ListBriefingRunsOptions,
  type OutlineRepo,
  type RevisionLinkRepo,
  type SearchConfigRepo,
  type SpaceRepo,
  type ThreadBindingRepo,
  type TokenRuleRepo,
} from "@inkade/db";
import { generateText } from "ai";
import { Cron } from "croner";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import {
  createChatLanguageModel,
  extractUpstreamErrorMessage,
  validateAiEndpointUrl,
} from "./ai-provider-factory.ts";
import type { AuditService } from "./audit-service.ts";
import { defaultDnsResolver, type DnsResolver, type FetchFn } from "./clipper-service.ts";
import type { ContextPackService } from "./context-pack-service.ts";
import type { DocumentService } from "./document-service.ts";
import type { OutlineService } from "./outline-service.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";
import type { SemanticSearchService } from "./semantic-search-service.ts";
import type { ThreadBindingService } from "./thread-binding-service.ts";

export interface BriefingLlmOverrideResult {
  readonly text: string;
}

export interface BriefingServiceTransport {
  readonly fetchFn?: FetchFn | undefined;
  readonly resolveDns?: DnsResolver | undefined;
  readonly allowLocalForTest?: boolean | undefined;
  readonly generateBriefingText?: ((params: {
    readonly job: AgentBriefingJobRecord;
    readonly prompt: string;
    readonly evidencePrompt: string;
    readonly settings: {
      readonly provider: AiProviderPreset;
      readonly baseUrl: string;
      readonly model: string;
      readonly apiKey: string;
      readonly temperature: number;
    };
  }) => Promise<BriefingLlmOverrideResult>) | undefined;
}

export interface BriefingServiceDeps {
  readonly threadBindingRepo: ThreadBindingRepo;
  readonly documentRepo: DocumentRepo;
  readonly outlineRepo: OutlineRepo;
  readonly spaceRepo: SpaceRepo;
  readonly tokenRuleRepo: TokenRuleRepo;
  readonly searchConfigRepo: SearchConfigRepo;
  readonly revisionLinkRepo: RevisionLinkRepo;
  readonly documentService: DocumentService;
  readonly outlineService: OutlineService;
  readonly contextPackService: ContextPackService;
  readonly semanticSearch: SemanticSearchService;
  readonly threadBindingService: ThreadBindingService;
  readonly auditService: AuditService;
  readonly sseHub: SseHub;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
  readonly logger?: {
    readonly warn?: (msg: string, meta?: unknown) => void;
    readonly error?: (msg: string, meta?: unknown) => void;
  } | undefined;
  readonly onDocumentChanged?: ((workspaceId: WorkspaceId, documentId: DocumentId) => void) | undefined;
}

export interface ListBriefingJobsResult {
  readonly jobs: readonly AgentBriefingJobRecord[];
  readonly presets: typeof BRIEFING_PRESET_TEMPLATES;
}

interface GatheredBriefingEvidence {
  readonly citations: readonly BriefingCitation[];
  readonly evidencePrompt: string;
  readonly openTasks: readonly {
    readonly title: string;
    readonly docId: DocumentId;
    readonly docTitle: string;
    readonly dueDate: string | null;
    readonly scheduledDate: string | null;
  }[];
  readonly contextPackSlugs: readonly string[];
  readonly allowedDocumentIds: readonly DocumentId[];
}

function validateScheduleConfig(cronExpr: string, timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new InkadeError("VALIDATION_ERROR", `Invalid IANA timezone "${timezone}"`);
  }

  let probe: Cron;
  try {
    probe = new Cron(cronExpr, { timezone, paused: true });
  } catch (err) {
    throw new InkadeError(
      "VALIDATION_ERROR",
      `Invalid cron expression "${cronExpr}": ${err instanceof Error ? err.message : "parse failed"}`,
    );
  }
  try {
    const nextRun = probe.nextRun();
    if (!nextRun) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        `Cron expression "${cronExpr}" produces no upcoming occurrences in timezone "${timezone}"`,
      );
    }
    return nextRun.toISOString();
  } finally {
    probe.stop();
  }
}

function computeNextRunAt(cronExpr: string, timezone: string, enabled: boolean): string | null {
  if (!enabled) return null;
  try {
    const probe = new Cron(cronExpr, { timezone, paused: true });
    try {
      return probe.nextRun()?.toISOString() ?? null;
    } finally {
      probe.stop();
    }
  } catch {
    return null;
  }
}

function enrichJobNextRun(job: AgentBriefingJobRecord): AgentBriefingJobRecord {
  return {
    ...job,
    nextRunAt: computeNextRunAt(job.cronExpr, job.timezone, job.enabled),
  };
}

function extractClipSourceMeta(doc: DocumentSummary): {
  readonly isRss: boolean;
  readonly feedId: string | null;
} {
  const meta = doc.sourceMeta;
  const feedId =
    meta && typeof meta.feedId === "string"
      ? meta.feedId
      : meta && typeof meta.rssFeedId === "string"
        ? meta.rssFeedId
        : null;
  const isRss = Boolean(feedId) || doc.tags.some((t) => t.toLowerCase() === "rss");
  return { isRss, feedId };
}

function renderTemplateTokens(template: string, job: AgentBriefingJobRecord): string {
  const dateStr = todayLocalDateString();
  return template
    .replaceAll("{{date}}", dateStr)
    .replaceAll("{{jobName}}", job.name);
}

function isChineseBriefingContext(
  job: Pick<AgentBriefingJobRecord, "name" | "description" | "promptTemplate">,
  evidence?: Pick<GatheredBriefingEvidence, "citations" | "openTasks">,
): boolean {
  const cjkRe = /[\u4e00-\u9fff]/;
  if (cjkRe.test(job.name) || cjkRe.test(job.description) || cjkRe.test(job.promptTemplate)) {
    return true;
  }
  if (evidence?.citations.some((c) => cjkRe.test(c.title) || cjkRe.test(c.excerpt))) {
    return true;
  }
  if (evidence?.openTasks.some((t) => cjkRe.test(t.title))) {
    return true;
  }
  return false;
}

function buildOfflineBriefingMarkdown(
  job: AgentBriefingJobRecord,
  evidence: GatheredBriefingEvidence,
): string {
  const isZh = isChineseBriefingContext(job, evidence);
  const dateStr = todayLocalDateString();
  const sections: string[] = [];

  sections.push(
    isZh
      ? `**${job.name}**（${dateStr}）自动简报 · 基于本地授权知识库检索生成。`
      : `Automated synthesis for **${job.name}** (${dateStr}) — generated in grounded local-RAG mode.`,
  );

  if (evidence.citations.length === 0) {
    sections.push(
      isZh
        ? "当前授权范围内未匹配到符合条件的近期剪藏、RSS 订阅、Context Pack 或待办事项。"
        : "No matching clips, RSS items, context pack notes, or open tasks were found inside your authorized scope for this run.",
    );
  } else {
    const sourceLines = evidence.citations.map((cite) => {
      const urlSuffix = cite.url ? ` (${cite.url})` : "";
      const cleanExcerpt = cleanDisplaySnippet(cite.excerpt, {
        title: cite.title,
        maxLength: 180,
      });
      const bodyPart = cleanExcerpt ? `${isZh ? "：" : ": "}${cleanExcerpt}` : "";
      return `- [${cite.index}] **${cite.title}**${urlSuffix}${bodyPart}`;
    });
    sections.push(
      `${isZh ? "### 核心摘录与来源" : "### Highlights & Sources"}\n${sourceLines.join("\n")}`,
    );
  }

  // Render referenced open tasks as read-only bullets (never `- [ ]` checkboxes) so
  // synthesized briefing notes never re-index duplicate tasks into /tasks.
  if (evidence.openTasks.length > 0) {
    const firstCiteIndex = evidence.citations[0]?.index;
    const taskLines = evidence.openTasks.slice(0, 6).map((task) => {
      const docCite = evidence.citations.find((c) => c.docId === task.docId)?.index ?? firstCiteIndex;
      const citeTag = docCite ? ` [${docCite}]` : "";
      const dueTag = task.dueDate
        ? isZh
          ? `（截止 ${task.dueDate}）`
          : ` (due ${task.dueDate})`
        : task.scheduledDate
          ? isZh
            ? `（排期 ${task.scheduledDate}）`
            : ` (${task.scheduledDate})`
          : "";
      const prefix = isZh ? "**待办**：" : "**Task**: ";
      return `- ${prefix}${task.title}${dueTag}${citeTag}`;
    });
    sections.push(
      `${isZh ? "### 关注待办" : "### Open Tasks Watchlist"}\n${taskLines.join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

function appendReferencesFooter(
  markdownBody: string,
  citations: readonly BriefingCitation[],
  isZh = false,
): string {
  if (citations.length === 0) return markdownBody.trim();
  const refs = citations
    .map((cite) => `- [${cite.index}] [${cite.title}](inkade://doc/${cite.docId})${cite.url ? ` · ${cite.url}` : ""}`)
    .join("\n");
  if (/^##\s+(Citations|References|参考引用|引用来源)/m.test(markdownBody)) {
    return markdownBody.trim();
  }
  const heading = isZh ? "## 参考引用" : "## Citations";
  return `${markdownBody.trim()}\n\n${heading}\n${refs}`;
}

function parseMarkdownLinesToOutlineNodes(
  sectionHeading: string,
  markdown: string,
  batchId: AuditBatchId,
  citations: readonly BriefingCitation[],
): Array<{
  readonly op: "create";
  readonly tempId?: string | undefined;
  readonly parentNodeId: string | null;
  readonly contentMarkdown: string;
  readonly checked?: boolean | null | undefined;
  readonly authorType: "agent";
}> {
  const ops: Array<{
    readonly op: "create";
    readonly tempId?: string | undefined;
    readonly parentNodeId: string | null;
    readonly contentMarkdown: string;
    readonly checked?: boolean | null | undefined;
    readonly authorType: "agent";
  }> = [];

  const rootTempId = "brf_sec_root";
  const normalizedHeading = sectionHeading.trim().startsWith("#")
    ? sectionHeading.trim()
    : `## ${sectionHeading.trim()}`;

  ops.push({
    op: "create",
    tempId: rootTempId,
    parentNodeId: null,
    contentMarkdown: normalizedHeading,
    authorType: "agent",
  });

  const rawLines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of rawLines) {
    const todoUnchecked = line.match(/^[-*]\s+\[\s\]\s+(.*)$/);
    if (todoUnchecked) {
      ops.push({
        op: "create",
        parentNodeId: rootTempId,
        contentMarkdown: todoUnchecked[1]!.trim(),
        checked: false,
        authorType: "agent",
      });
      continue;
    }
    const todoChecked = line.match(/^[-*]\s+\[[xX]\]\s+(.*)$/);
    if (todoChecked) {
      ops.push({
        op: "create",
        parentNodeId: rootTempId,
        contentMarkdown: todoChecked[1]!.trim(),
        checked: true,
        authorType: "agent",
      });
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      ops.push({
        op: "create",
        parentNodeId: rootTempId,
        contentMarkdown: bulletMatch[1]!.trim(),
        authorType: "agent",
      });
      continue;
    }
    ops.push({
      op: "create",
      parentNodeId: rootTempId,
      contentMarkdown: line,
      authorType: "agent",
    });
  }

  if (citations.length > 0) {
    const refsSummary = citations
      .slice(0, 8)
      .map((c) => `[${c.index}] [[${c.title}]]`)
      .join(" · ");
    ops.push({
      op: "create",
      parentNodeId: rootTempId,
      contentMarkdown: `Sources (${batchId}): ${refsSummary}`,
      authorType: "agent",
    });
  }

  return ops;
}

export class BriefingService {
  private fetchFn: FetchFn;
  private resolveDns: DnsResolver;
  private allowLocalForTest: boolean;
  private generateBriefingText?: BriefingServiceTransport["generateBriefingText"];
  private readonly activeCronJobs = new Map<string, Cron>();
  private schedulerEnabled = false;

  constructor(
    private readonly deps: BriefingServiceDeps,
    transport?: BriefingServiceTransport,
  ) {
    this.fetchFn = transport?.fetchFn ?? ((input, init) => fetch(input, init));
    this.resolveDns = transport?.resolveDns ?? defaultDnsResolver;
    this.allowLocalForTest = transport?.allowLocalForTest ?? false;
    this.generateBriefingText = transport?.generateBriefingText;
  }

  setTestTransport(transport: BriefingServiceTransport): void {
    if (transport.fetchFn !== undefined) this.fetchFn = transport.fetchFn;
    if (transport.resolveDns !== undefined) this.resolveDns = transport.resolveDns;
    if (transport.allowLocalForTest !== undefined) {
      this.allowLocalForTest = transport.allowLocalForTest;
    }
    if ("generateBriefingText" in transport) {
      this.generateBriefingText = transport.generateBriefingText;
    }
  }

  async startScheduler(): Promise<void> {
    this.schedulerEnabled = true;
    await this.syncScheduler();
  }

  stopScheduler(): void {
    this.schedulerEnabled = false;
    for (const cron of this.activeCronJobs.values()) {
      cron.stop();
    }
    this.activeCronJobs.clear();
  }

  async syncScheduler(): Promise<void> {
    for (const cron of this.activeCronJobs.values()) {
      cron.stop();
    }
    this.activeCronJobs.clear();

    if (!this.schedulerEnabled) {
      return;
    }

    const jobs = await this.deps.threadBindingRepo.listAllEnabledBriefingJobs();
    for (const job of jobs) {
      this.scheduleSingleJob(job);
    }
  }

  private scheduleSingleJob(job: AgentBriefingJobRecord): void {
    const existing = this.activeCronJobs.get(job.id);
    if (existing) {
      existing.stop();
      this.activeCronJobs.delete(job.id);
    }
    if (!this.schedulerEnabled || !job.enabled) {
      return;
    }
    try {
      const cron = new Cron(
        job.cronExpr,
        { timezone: job.timezone, protect: true, unref: true },
        () => {
          void this.executeScheduledJob(job.workspaceId, job.id);
        },
      );
      this.activeCronJobs.set(job.id, cron);
    } catch (err) {
      this.deps.logger?.warn?.("Failed to register briefing cron schedule", {
        jobId: job.id,
        cronExpr: job.cronExpr,
        timezone: job.timezone,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private resolveTargetSpaceId(
    job: Pick<AgentBriefingJobRecord, "target">,
    allSpaces: readonly Space[],
  ): SpaceId {
    if (job.target.targetSpaceId) {
      return job.target.targetSpaceId;
    }
    if (job.target.mode === "daily_section") {
      return (
        allSpaces.find((s) => s.id === DEFAULT_SPACE_IDS.daily && s.archivedAt === null)?.id ??
        allSpaces.find((s) => s.archivedAt === null)?.id ??
        DEFAULT_SPACE_IDS.daily
      );
    }
    return (
      allSpaces.find((s) => s.id === DEFAULT_SPACE_IDS.research && s.archivedAt === null)?.id ??
      allSpaces.find((s) => s.id === DEFAULT_SPACE_IDS.inbox && s.archivedAt === null)?.id ??
      allSpaces.find((s) => s.archivedAt === null)?.id ??
      DEFAULT_SPACE_IDS.research
    );
  }

  async listJobs(principal: Principal): Promise<ListBriefingJobsResult> {
    const [jobs, allSpaces] = await Promise.all([
      this.deps.threadBindingRepo.listBriefingJobs(principal.workspaceId),
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
    ]);

    const visibleJobs = jobs
      .filter((job) => {
        if (principal.scope.spaceIds === "*") return true;
        const spaceId = this.resolveTargetSpaceId(job, allSpaces);
        return evaluateScopeAccess(principal.scope, "read", { spaceId, resourceType: "space" }, allSpaces)
          .allowed;
      })
      .map(enrichJobNextRun);

    return {
      jobs: visibleJobs,
      presets: BRIEFING_PRESET_TEMPLATES,
    };
  }

  async getJob(
    principal: Principal,
    jobId: BriefingJobId,
  ): Promise<AgentBriefingJobRecord> {
    const [job, allSpaces] = await Promise.all([
      this.deps.threadBindingRepo.getBriefingJobById(principal.workspaceId, jobId),
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
    ]);
    if (!job) {
      throw new InkadeError("NOT_FOUND", `Briefing job "${jobId}" not found`);
    }
    const targetSpaceId = this.resolveTargetSpaceId(job, allSpaces);
    assertScope(
      principal.scope,
      "read",
      { spaceId: targetSpaceId, resourceType: "space" },
      allSpaces,
    );
    return enrichJobNextRun(job);
  }

  async createJob(
    principal: Principal,
    rawInput: CreateBriefingJobInput,
  ): Promise<AgentBriefingJobRecord> {
    const input: ParsedCreateBriefingJobInput = createBriefingJobInputSchema.parse(rawInput);
    validateScheduleConfig(input.cronExpr, input.timezone);

    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    const targetSpaceId = this.resolveTargetSpaceId({ target: input.target }, allSpaces);
    const requiredPerm = input.target.mode === "daily_section" ? "append" : "write";
    assertScope(
      principal.scope,
      requiredPerm,
      { spaceId: targetSpaceId, resourceType: "space" },
      allSpaces,
    );

    if (input.executionPath === "external_ade" && input.bindingId) {
      const binding = await this.deps.threadBindingRepo.getThreadBindingById(
        principal.workspaceId,
        input.bindingId,
      );
      if (!binding) {
        throw new InkadeError("VALIDATION_ERROR", `Thread binding "${input.bindingId}" not found`);
      }
    }

    const created = await this.deps.threadBindingRepo.createBriefingJob(
      principal.workspaceId,
      input,
    );
    const enriched = enrichJobNextRun(created);
    this.scheduleSingleJob(enriched);

    this.deps.sseHub.publish({
      type: "briefing.job.updated",
      workspaceId: principal.workspaceId,
      spaceId: targetSpaceId,
      actorType: principal.actorType,
      payload: {
        action: "created",
        jobId: enriched.id,
      },
    });

    return enriched;
  }

  async updateJob(
    principal: Principal,
    jobId: BriefingJobId,
    rawInput: UpdateBriefingJobInput,
  ): Promise<AgentBriefingJobRecord> {
    const input = updateBriefingJobInputSchema.parse(rawInput);
    const [existing, allSpaces] = await Promise.all([
      this.deps.threadBindingRepo.getBriefingJobById(principal.workspaceId, jobId),
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
    ]);
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `Briefing job "${jobId}" not found`);
    }

    const oldSpaceId = this.resolveTargetSpaceId(existing, allSpaces);
    assertScope(
      principal.scope,
      existing.target.mode === "daily_section" ? "append" : "write",
      { spaceId: oldSpaceId, resourceType: "space" },
      allSpaces,
    );

    const nextTarget = input.target ?? existing.target;
    const nextSpaceId = this.resolveTargetSpaceId({ target: nextTarget }, allSpaces);
    assertScope(
      principal.scope,
      nextTarget.mode === "daily_section" ? "append" : "write",
      { spaceId: nextSpaceId, resourceType: "space" },
      allSpaces,
    );

    validateScheduleConfig(input.cronExpr ?? existing.cronExpr, input.timezone ?? existing.timezone);

    const updated = await this.deps.threadBindingRepo.updateBriefingJob(
      principal.workspaceId,
      jobId,
      input,
    );
    const enriched = enrichJobNextRun(updated);
    this.scheduleSingleJob(enriched);

    this.deps.sseHub.publish({
      type: "briefing.job.updated",
      workspaceId: principal.workspaceId,
      spaceId: nextSpaceId,
      actorType: principal.actorType,
      payload: {
        action: "updated",
        jobId: enriched.id,
      },
    });

    return enriched;
  }

  async deleteJob(principal: Principal, jobId: BriefingJobId): Promise<void> {
    const [existing, allSpaces] = await Promise.all([
      this.deps.threadBindingRepo.getBriefingJobById(principal.workspaceId, jobId),
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
    ]);
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `Briefing job "${jobId}" not found`);
    }
    const targetSpaceId = this.resolveTargetSpaceId(existing, allSpaces);
    assertScope(
      principal.scope,
      "write",
      { spaceId: targetSpaceId, resourceType: "space" },
      allSpaces,
    );

    await this.deps.threadBindingRepo.deleteBriefingJob(principal.workspaceId, jobId);
    const liveCron = this.activeCronJobs.get(jobId);
    if (liveCron) {
      liveCron.stop();
      this.activeCronJobs.delete(jobId);
    }

    this.deps.sseHub.publish({
      type: "briefing.job.updated",
      workspaceId: principal.workspaceId,
      spaceId: targetSpaceId,
      actorType: principal.actorType,
      payload: {
        action: "deleted",
        jobId,
      },
    });
  }

  async listRuns(
    principal: Principal,
    options?: ListBriefingRunsOptions,
  ): Promise<readonly AgentBriefingRunRecord[]> {
    const [runs, jobs, allSpaces] = await Promise.all([
      this.deps.threadBindingRepo.listBriefingRuns(principal.workspaceId, options),
      this.deps.threadBindingRepo.listBriefingJobs(principal.workspaceId),
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
    ]);

    if (principal.scope.spaceIds === "*") {
      return runs;
    }

    const jobById = new Map(jobs.map((j) => [j.id, j]));
    return runs.filter((run) => {
      const job = jobById.get(run.jobId);
      if (!job) return true;
      const spaceId = this.resolveTargetSpaceId(job, allSpaces);
      return evaluateScopeAccess(principal.scope, "read", { spaceId, resourceType: "space" }, allSpaces)
        .allowed;
    });
  }

  async dismissRun(
    principal: Principal,
    runId: BriefingRunId,
  ): Promise<AgentBriefingRunRecord> {
    const [existing, allSpaces] = await Promise.all([
      this.deps.threadBindingRepo.getBriefingRunById(principal.workspaceId, runId),
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
    ]);
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `Briefing run "${runId}" not found`);
    }

    const job = await this.deps.threadBindingRepo.getBriefingJobById(
      principal.workspaceId,
      existing.jobId,
    );
    const spaceId = job ? this.resolveTargetSpaceId(job, allSpaces) : DEFAULT_SPACE_IDS.inbox;
    assertScope(principal.scope, "append", { spaceId, resourceType: "space" }, allSpaces);

    const updated = await this.deps.threadBindingRepo.dismissBriefingRun(
      principal.workspaceId,
      runId,
    );

    this.deps.sseHub.publish({
      type: "briefing.dismissed",
      workspaceId: principal.workspaceId,
      spaceId,
      actorType: principal.actorType,
      payload: {
        runId: updated.id,
        jobId: updated.jobId,
      },
    });

    return updated;
  }

  async runJobNow(
    principal: Principal,
    jobId: BriefingJobId,
    options?: {
      readonly simulateError?: string | undefined;
      readonly triggerKind?: BriefingTriggerKind | undefined;
    },
  ): Promise<AgentBriefingRunRecord> {
    const [job, allSpaces] = await Promise.all([
      this.deps.threadBindingRepo.getBriefingJobById(principal.workspaceId, jobId),
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
    ]);
    if (!job) {
      throw new InkadeError("NOT_FOUND", `Briefing job "${jobId}" not found`);
    }

    const targetSpaceId = this.resolveTargetSpaceId(job, allSpaces);
    const requiredTargetPerm =
      job.executionPath === "external_ade"
        ? "append"
        : job.target.mode === "daily_section"
          ? "append"
          : "write";
    assertScope(
      principal.scope,
      requiredTargetPerm,
      { spaceId: targetSpaceId, resourceType: "space" },
      allSpaces,
    );

    return this.executeJob(principal, job, allSpaces, targetSpaceId, {
      triggerKind: options?.triggerKind ?? "manual",
      simulateError: options?.simulateError,
    });
  }

  private async executeScheduledJob(
    workspaceId: WorkspaceId,
    jobId: BriefingJobId,
  ): Promise<void> {
    try {
      const [job, allSpaces] = await Promise.all([
        this.deps.threadBindingRepo.getBriefingJobById(workspaceId, jobId),
        getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, workspaceId),
      ]);
      if (!job || !job.enabled) {
        return;
      }

      const targetSpaceId = this.resolveTargetSpaceId(job, allSpaces);
      const tokenId = job.tokenRuleId ?? asApiTokenId("tok_briefing_scheduler");
      const scheduledPrincipal: Principal = {
        kind: "token",
        tokenId,
        tokenName: `briefing:${job.name}`,
        workspaceId,
        scope: ADMIN_USER_SCOPE,
        actorType: "agent",
        actorId: tokenId,
      };

      await this.executeJob(scheduledPrincipal, job, allSpaces, targetSpaceId, {
        triggerKind: "schedule",
      });
    } catch (err) {
      this.deps.logger?.error?.("Scheduled briefing execution failed", {
        workspaceId,
        jobId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async resolveExecutionScope(
    principal: Principal,
    job: AgentBriefingJobRecord,
    allSpaces: readonly Space[],
  ): Promise<{ readonly effectiveScope: TokenScope; readonly tokenPolicyError: string | null }> {
    let baseIntersected = intersectTokenScopes(principal.scope, principal.scope, allSpaces, {
      forceDenyHardDelete: true,
    });

    if (!job.tokenRuleId) {
      return { effectiveScope: baseIntersected, tokenPolicyError: null };
    }

    const tokenRecord = await this.deps.tokenRuleRepo.getApiTokenById(
      principal.workspaceId,
      job.tokenRuleId,
    );
    if (
      !tokenRecord ||
      tokenRecord.revokedAt !== null ||
      (tokenRecord.expiresAt !== null && Date.parse(tokenRecord.expiresAt) <= Date.now())
    ) {
      return {
        effectiveScope: baseIntersected,
        tokenPolicyError: "Assigned briefing API token policy is missing, revoked, or expired",
      };
    }

    baseIntersected = intersectTokenScopes(baseIntersected, tokenRecord.scope, allSpaces, {
      forceDenyHardDelete: true,
    });
    return { effectiveScope: baseIntersected, tokenPolicyError: null };
  }

  private async executeJob(
    callerPrincipal: Principal,
    job: AgentBriefingJobRecord,
    allSpaces: readonly Space[],
    targetSpaceId: SpaceId,
    options: {
      readonly triggerKind: BriefingTriggerKind;
      readonly simulateError?: string | undefined;
    },
  ): Promise<AgentBriefingRunRecord> {
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const batchId = createId(ID_PREFIXES.auditBatch);

    const { effectiveScope, tokenPolicyError } = await this.resolveExecutionScope(
      callerPrincipal,
      job,
      allSpaces,
    );

    const executionPrincipal: Principal =
      callerPrincipal.kind === "token"
        ? { ...callerPrincipal, scope: effectiveScope, actorType: "agent" }
        : { ...callerPrincipal, scope: effectiveScope };

    // Validate effective scope against the target BEFORE executing or creating anything.
    const requiredTargetPerm =
      job.executionPath === "external_ade"
        ? "append"
        : job.target.mode === "daily_section"
          ? "append"
          : "write";
    assertScope(
      effectiveScope,
      requiredTargetPerm,
      {
        spaceId: targetSpaceId,
        kind: job.target.mode === "daily_section" ? "outline" : "article",
        tags: job.target.tags,
        resourceType: "space",
      },
      allSpaces,
    );

    const run = await this.deps.threadBindingRepo.createBriefingRun(callerPrincipal.workspaceId, {
      jobId: job.id,
      triggerKind: options.triggerKind,
      status: job.executionPath === "external_ade" ? "dispatched" : "succeeded",
      batchId,
      startedAt,
    });

    const recordFailedRun = async (rawMessage: string): Promise<AgentBriefingRunRecord> => {
      const finishedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - startedMs);
      const errorMessage = rawMessage.trim() || "Briefing execution failed";

      const failedRun = await this.deps.threadBindingRepo.updateBriefingRun(
        callerPrincipal.workspaceId,
        run.id,
        {
          status: "failed",
          errorMessage,
          durationMs,
          finishedAt,
        },
      );
      await this.deps.threadBindingRepo.updateBriefingJob(callerPrincipal.workspaceId, job.id, {
        lastRunAt: finishedAt,
        lastStatus: "failed",
      });

      const activeCapture = this.deps.auditService.getActiveAuditCapture();
      if (activeCapture) {
        activeCapture.action = "briefing.run.failed";
        activeCapture.resource = `briefing-job:${job.id}`;
        activeCapture.spaceId = targetSpaceId;
        activeCapture.batchId = batchId;
        activeCapture.executionMode = "autonomous";
        activeCapture.summary = `Briefing "${job.name}" failed: ${errorMessage}`;
        activeCapture.reversible = false;
      }

      this.deps.sseHub.publish({
        type: "briefing.failed",
        workspaceId: callerPrincipal.workspaceId,
        spaceId: targetSpaceId,
        actorType: executionPrincipal.actorType,
        payload: { run: failedRun },
      });
      this.deps.sseHub.publish({
        type: "briefing.job.updated",
        workspaceId: callerPrincipal.workspaceId,
        spaceId: targetSpaceId,
        actorType: executionPrincipal.actorType,
        payload: { action: "updated", jobId: job.id },
      });

      return failedRun;
    };

    if (options.simulateError) {
      return recordFailedRun(options.simulateError);
    }
    if (tokenPolicyError) {
      return recordFailedRun(tokenPolicyError);
    }

    try {
      const evidence = await this.gatherEvidence(executionPrincipal, job, allSpaces);

      if (job.executionPath === "external_ade") {
        return await this.dispatchExternalWakeup(
          executionPrincipal,
          job,
          run,
          batchId,
          targetSpaceId,
          allSpaces,
          evidence,
          options.triggerKind,
          startedMs,
        );
      }

      return await this.runBuiltinRagBriefing(
        executionPrincipal,
        job,
        run,
        batchId,
        targetSpaceId,
        allSpaces,
        evidence,
        startedMs,
      );
    } catch (err) {
      return recordFailedRun(extractUpstreamErrorMessage(err, "Briefing execution failed"));
    }
  }

  private async gatherEvidence(
    principal: Principal,
    job: AgentBriefingJobRecord,
    allSpaces: readonly Space[],
  ): Promise<GatheredBriefingEvidence> {
    const workspaceId = principal.workspaceId;
    const scopeAllowedSpaces = resolveAllowedSpaceIds(principal.scope, allSpaces);

    let effectiveSourceSpaces: SpaceId[] | undefined;
    if (job.sources.spaceIds === "*") {
      effectiveSourceSpaces = scopeAllowedSpaces === "*" ? undefined : [...scopeAllowedSpaces];
    } else if (scopeAllowedSpaces === "*") {
      effectiveSourceSpaces = [...job.sources.spaceIds];
    } else {
      const allowedSet = new Set(scopeAllowedSpaces);
      effectiveSourceSpaces = job.sources.spaceIds.filter((id) => allowedSet.has(id));
    }

    if (effectiveSourceSpaces && effectiveSourceSpaces.length === 0) {
      return {
        citations: [],
        evidencePrompt: "",
        openTasks: [],
        contextPackSlugs: [],
        allowedDocumentIds: [],
      };
    }

    const citationList: BriefingCitation[] = [];
    const seenDocIds = new Set<DocumentId>();
    const contextPackSlugs: string[] = [];
    const excerptByDocId = new Map<DocumentId, string>();
    const openTasks: Array<{
      readonly title: string;
      readonly docId: DocumentId;
      readonly docTitle: string;
      readonly dueDate: string | null;
      readonly scheduledDate: string | null;
    }> = [];

    const pushCitation = (params: {
      readonly docId: DocumentId;
      readonly title: string;
      readonly kind: DocumentRecord["kind"];
      readonly spaceId: SpaceId;
      readonly excerpt: string;
      readonly url?: string | undefined;
    }): void => {
      if (seenDocIds.has(params.docId)) return;
      seenDocIds.add(params.docId);
      const cleanExcerpt = cleanDisplaySnippet(params.excerpt, {
        title: params.title,
        maxLength: 280,
      });
      citationList.push({
        index: citationList.length + 1,
        docId: params.docId,
        title: params.title,
        kind: params.kind,
        spaceId: params.spaceId,
        excerpt: cleanExcerpt,
        ...(params.url ? { url: params.url } : {}),
      });
      excerptByDocId.set(params.docId, cleanExcerpt || params.title);
    };

    // 1. Clips & RSS ingested documents
    if (job.sources.includeClipsLastDays > 0 || job.sources.includeRssFeeds) {
      const clipSummaries = await this.deps.documentRepo.listDocumentSummaries(workspaceId, {
        spaceIds: effectiveSourceSpaces,
        kind: "clip",
        allowedKinds: principal.scope.allowedKinds,
        tagAllowlist: principal.scope.tagAllowlist,
        limit: Math.max(20, job.sources.maxItemsPerSource * 3),
      });

      const cutoffMs =
        Date.now() - Math.max(1, job.sources.includeClipsLastDays) * 86_400_000;
      let clipCount = 0;
      let rssCount = 0;

      for (const summary of clipSummaries) {
        const { isRss } = extractClipSourceMeta(summary);
        const createdMs = Date.parse(summary.createdAt);
        const withinWindow =
          job.sources.includeClipsLastDays > 0 &&
          (!Number.isFinite(createdMs) || createdMs >= cutoffMs);

        if (isRss && job.sources.includeRssFeeds && rssCount < job.sources.maxItemsPerSource) {
          pushCitation({
            docId: summary.id,
            title: summary.title,
            kind: summary.kind,
            spaceId: summary.spaceId,
            excerpt: summary.excerpt || summary.title,
            url: summary.sourceUrl,
          });
          rssCount += 1;
          continue;
        }

        if (!isRss && withinWindow && clipCount < job.sources.maxItemsPerSource) {
          pushCitation({
            docId: summary.id,
            title: summary.title,
            kind: summary.kind,
            spaceId: summary.spaceId,
            excerpt: summary.excerpt || summary.title,
            url: summary.sourceUrl,
          });
          clipCount += 1;
        }
      }

      // Include RSS feed titles if configured and clips are sparse
      if (job.sources.includeRssFeeds && rssCount === 0) {
        const feeds = await this.deps.searchConfigRepo.listRssFeeds(workspaceId);
        const scopedFeedIds = new Set(effectiveSourceSpaces ?? []);
        for (const feed of feeds) {
          if (
            feed.enabled &&
            (!effectiveSourceSpaces || scopedFeedIds.has(feed.targetSpaceId))
          ) {
            // Feeds themselves do not have docIds; clip summaries already capture synced feed articles
            void feed;
          }
        }
      }
    }

    // 2. Context packs
    for (const packId of job.sources.contextPackIds) {
      const pack = await this.deps.searchConfigRepo.getContextPackById(workspaceId, packId);
      if (!pack) continue;
      try {
        const rendered = await this.deps.contextPackService.renderPackBySlug(principal, pack.slug);
        contextPackSlugs.push(pack.slug);
        for (const item of rendered.items.slice(0, job.sources.maxItemsPerSource)) {
          pushCitation({
            docId: item.docId,
            title: item.title,
            kind: item.kind,
            spaceId: item.spaceId,
            excerpt: item.content,
          });
        }
      } catch (err) {
        if (err instanceof InkadeError && err.code === "FORBIDDEN") {
          continue;
        }
        throw err;
      }
    }

    // 3. Open tasks
    if (job.sources.includeTasks) {
      const taskRows = await this.deps.outlineRepo.listDocumentTasks(workspaceId, {
        status: "open",
        spaceIds: effectiveSourceSpaces,
        allowedKinds: principal.scope.allowedKinds,
        tagAllowlist: principal.scope.tagAllowlist,
        limit: job.sources.maxItemsPerSource,
      });

      const taskDocCache = new Map<DocumentId, SpaceId>();
      for (const row of taskRows) {
        openTasks.push({
          title: row.task.title,
          docId: row.task.docId,
          docTitle: row.documentTitle,
          dueDate: row.task.dueDate,
          scheduledDate: row.task.scheduledDate,
        });
        let docSpaceId = taskDocCache.get(row.task.docId);
        if (!docSpaceId) {
          const doc = await this.deps.documentRepo.getDocumentById(workspaceId, row.task.docId);
          docSpaceId = doc?.spaceId ?? row.task.spaceId;
          taskDocCache.set(row.task.docId, docSpaceId);
        }
        const isZhTask = /[\u4e00-\u9fff]/.test(job.name + row.task.title);
        pushCitation({
          docId: row.task.docId,
          title: row.documentTitle,
          kind: row.documentKind,
          spaceId: docSpaceId,
          excerpt: isZhTask
            ? `未完待办：${row.task.title}${row.task.dueDate ? `（截止 ${row.task.dueDate}）` : ""}`
            : `Open task: ${row.task.title}${row.task.dueDate ? ` (due ${row.task.dueDate})` : ""}`,
        });
      }
    }

    // 4. Scoped hybrid search across workspace chunks for prompt grounding
    const renderedQuery = renderTemplateTokens(job.promptTemplate, job).slice(0, 300);
    const searchHits = await this.deps.semanticSearch.searchChunks(principal, {
      q: renderedQuery || job.name,
      mode: "hybrid",
      spaceId: effectiveSourceSpaces && effectiveSourceSpaces.length === 1 ? effectiveSourceSpaces[0] : undefined,
      limit: job.sources.maxItemsPerSource,
    });
    const allowedSourceSpaceSet = effectiveSourceSpaces ? new Set(effectiveSourceSpaces) : null;
    for (const hit of searchHits) {
      if (allowedSourceSpaceSet && !allowedSourceSpaceSet.has(hit.spaceId)) {
        continue;
      }
      pushCitation({
        docId: asDocumentId(hit.docId),
        title: hit.title,
        kind: hit.kind,
        spaceId: hit.spaceId,
        excerpt: hit.snippet || hit.contentText,
      });
    }

    // Collect full scoped document list for external_ade handoff awareness
    const scopedDocs = await this.deps.documentRepo.listDocumentSummaries(workspaceId, {
      spaceIds: effectiveSourceSpaces,
      allowedKinds: principal.scope.allowedKinds,
      tagAllowlist: principal.scope.tagAllowlist,
      limit: 100,
    });

    const allowedDocumentIds = [
      ...new Set([...citationList.map((c) => c.docId), ...scopedDocs.map((d) => d.id)]),
    ];

    const evidenceBlocks = citationList.map((cite) => {
      const urlPart = cite.url ? `\nURL: ${cite.url}` : "";
      return `[${cite.index}] Title: ${cite.title} (docId: ${cite.docId}, kind: ${cite.kind})${urlPart}\nExcerpt: ${cite.excerpt}`;
    });
    const taskBlock =
      openTasks.length > 0
        ? `\n\nOpen Tasks:\n${openTasks
            .map(
              (t) =>
                `- ${t.title} (from ${t.docTitle}${t.dueDate ? `, due ${t.dueDate}` : t.scheduledDate ? `, scheduled ${t.scheduledDate}` : ""})`,
            )
            .join("\n")}`
        : "";

    const evidencePrompt = `${evidenceBlocks.join("\n\n")}${taskBlock}`.trim();

    return {
      citations: citationList,
      evidencePrompt,
      openTasks,
      contextPackSlugs,
      allowedDocumentIds,
    };
  }

  private async synthesizeMarkdown(
    workspaceId: WorkspaceId,
    job: AgentBriefingJobRecord,
    evidence: GatheredBriefingEvidence,
  ): Promise<string> {
    const settings = await this.deps.searchConfigRepo.getAiSettingsSecret(workspaceId);
    const hasConfiguredLlm =
      Boolean(this.generateBriefingText) ||
      (settings.enabled &&
        Boolean(settings.model.trim()) &&
        Boolean(settings.baseUrl.trim()) &&
        (settings.provider === "ollama" || Boolean(settings.apiKey.trim())));

    const renderedPrompt = renderTemplateTokens(job.promptTemplate, job);

    if (!hasConfiguredLlm) {
      return buildOfflineBriefingMarkdown(job, evidence);
    }

    if (this.generateBriefingText) {
      const result = await this.generateBriefingText({
        job,
        prompt: renderedPrompt,
        evidencePrompt: evidence.evidencePrompt,
        settings: {
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey: settings.apiKey,
          temperature: settings.temperature,
        },
      });
      return result.text.trim() || buildOfflineBriefingMarkdown(job, evidence);
    }

    const validatedBaseUrl = await validateAiEndpointUrl(settings.baseUrl, {
      allowPrivateLoopback: settings.provider === "ollama",
      resolveDns: this.resolveDns,
      allowLocalForTest: this.allowLocalForTest,
    });

    const model = createChatLanguageModel({
      provider: settings.provider,
      baseUrl: validatedBaseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
      fetchFn: this.fetchFn,
    });

    const systemPrompt = [
      "You are Inkade's scheduled briefing agent. Write concise, factual Markdown grounded strictly in the provided evidence.",
      "Cite sources inline using [1], [2], etc. Do not invent facts or links not present in the evidence.",
    ].join("\n");

    const userPrompt = [
      `Briefing Job: ${job.name}`,
      `Date: ${todayLocalDateString()}`,
      `Instruction: ${renderedPrompt}`,
      "",
      "Grounded Evidence:",
      evidence.evidencePrompt || "(No evidence items available in authorized scope.)",
    ].join("\n");

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: settings.temperature,
    });

    const text = result.text.trim();
    if (!text) {
      throw new Error("AI provider returned an empty briefing response");
    }
    return text;
  }

  private async runBuiltinRagBriefing(
    principal: Principal,
    job: AgentBriefingJobRecord,
    run: AgentBriefingRunRecord,
    batchId: AuditBatchId,
    targetSpaceId: SpaceId,
    allSpaces: readonly Space[],
    evidence: GatheredBriefingEvidence,
    startedMs: number,
  ): Promise<AgentBriefingRunRecord> {
    const workspaceId = principal.workspaceId;
    const rawMarkdown = await this.synthesizeMarkdown(workspaceId, job, evidence);

    let targetDocumentId: DocumentId;
    let targetDocumentSpaceId: SpaceId = targetSpaceId;
    let targetDocumentKind: DocumentRecord["kind"] = "outline";
    let targetDocumentTags: readonly string[] = [];

    if (job.target.mode === "daily_section") {
      const dateStr = todayLocalDateString();
      const runWithSuppressedAudit = async <T>(fn: () => Promise<T>): Promise<T> =>
        this.deps.auditService.getActiveAuditCapture()
          ? this.deps.auditService.runSuppressed(fn)
          : this.deps.auditService.runWithAuditCapture("rest", (state) => {
              state.suppressed = true;
              return fn();
            });

      const daily = await runWithSuppressedAudit(() =>
        this.deps.outlineService.getOrCreateDailyOutline(principal, dateStr),
      );
      assertScope(
        principal.scope,
        "append",
        {
          spaceId: daily.document.spaceId,
          kind: daily.document.kind,
          tags: daily.document.tags,
        },
        allSpaces,
      );

      const beforeRev = await this.deps.revisionLinkRepo.getLatestRevision(daily.document.id);
      const sectionTitle = renderTemplateTokens(job.target.sectionHeading, job);
      const ops = parseMarkdownLinesToOutlineNodes(
        sectionTitle,
        rawMarkdown,
        batchId,
        evidence.citations,
      );

      await runWithSuppressedAudit(() =>
        this.deps.auditService.runWithBatchContext(
          { batchId, executionMode: "autonomous" },
          async () =>
            this.deps.outlineService.batchMutate(principal, {
              documentId: daily.document.id,
              operations: ops,
            }),
        ),
      );

      await this.deps.documentRepo.setDocumentUnreadAgentUpdate(workspaceId, daily.document.id, true);
      const refreshedDoc = await this.deps.documentRepo.getDocumentById(
        workspaceId,
        daily.document.id,
      );
      if (refreshedDoc) {
        this.deps.sseHub.publish({
          type: "document.updated",
          workspaceId,
          spaceId: refreshedDoc.spaceId,
          documentId: refreshedDoc.id,
          documentKind: refreshedDoc.kind,
          tags: refreshedDoc.tags,
          actorType: principal.actorType,
          payload: { document: refreshedDoc },
        });
      }
      this.deps.onDocumentChanged?.(workspaceId, daily.document.id);

      const afterRev = await this.deps.revisionLinkRepo.getLatestRevision(daily.document.id);
      await this.deps.auditService.recordPrincipalEvent(principal, {
        transport: "rest",
        action: "briefing.daily_section.append",
        resource: `document:${daily.document.id}`,
        spaceId: daily.document.spaceId,
        documentId: daily.document.id,
        decision: "allowed",
        beforeRevisionId: beforeRev?.id ?? null,
        afterRevisionId: afterRev?.id ?? null,
        summary: `Briefing "${job.name}" wrote section to "${daily.document.title}" (${evidence.citations.length} citations)`,
        reversible: Boolean(beforeRev),
        batchId,
        executionMode: "autonomous",
      });

      const activeCapture = this.deps.auditService.getActiveAuditCapture();
      if (activeCapture) {
        activeCapture.recorded = true;
      }

      targetDocumentId = daily.document.id;
      targetDocumentSpaceId = daily.document.spaceId;
      targetDocumentKind = daily.document.kind;
      targetDocumentTags = daily.document.tags;
    } else {
      assertScope(
        principal.scope,
        "write",
        {
          spaceId: targetSpaceId,
          kind: "article",
          tags: job.target.tags,
        },
        allSpaces,
      );

      const title = renderTemplateTokens(job.target.titleTemplate, job);
      const fullMarkdown = appendReferencesFooter(
        rawMarkdown,
        evidence.citations,
        isChineseBriefingContext(job, evidence),
      );
      const tags = [...new Set(["briefing", ...job.target.tags])];

      const createDoc = async () =>
        this.deps.documentService.createDocument(principal, {
          spaceId: targetSpaceId,
          kind: "article",
          title,
          contentMarkdown: fullMarkdown,
          tags,
        });

      const createdDoc = await (this.deps.auditService.getActiveAuditCapture()
        ? this.deps.auditService.runSuppressed(createDoc)
        : this.deps.auditService.runWithAuditCapture("rest", async (state) => {
            state.suppressed = true;
            return createDoc();
          }));

      await this.deps.documentRepo.setDocumentUnreadAgentUpdate(workspaceId, createdDoc.id, true);
      const refreshedDoc = await this.deps.documentRepo.getDocumentById(workspaceId, createdDoc.id);
      if (refreshedDoc) {
        this.deps.sseHub.publish({
          type: "document.updated",
          workspaceId,
          spaceId: refreshedDoc.spaceId,
          documentId: refreshedDoc.id,
          documentKind: refreshedDoc.kind,
          tags: refreshedDoc.tags,
          actorType: principal.actorType,
          payload: { document: refreshedDoc },
        });
      }
      this.deps.onDocumentChanged?.(workspaceId, createdDoc.id);

      const afterRev = await this.deps.revisionLinkRepo.getRevision(
        createdDoc.id,
        createdDoc.version,
      );
      await this.deps.auditService.recordPrincipalEvent(principal, {
        transport: "rest",
        action: "briefing.document.create",
        resource: `document:${createdDoc.id}`,
        spaceId: createdDoc.spaceId,
        documentId: createdDoc.id,
        decision: "allowed",
        beforeRevisionId: null,
        afterRevisionId: afterRev?.id ?? null,
        summary: `Briefing "${job.name}" created "${createdDoc.title}" (${evidence.citations.length} citations)`,
        reversible: true,
        batchId,
        executionMode: "autonomous",
      });

      const activeCapture = this.deps.auditService.getActiveAuditCapture();
      if (activeCapture) {
        activeCapture.recorded = true;
      }

      targetDocumentId = createdDoc.id;
      targetDocumentSpaceId = createdDoc.spaceId;
      targetDocumentKind = createdDoc.kind;
      targetDocumentTags = createdDoc.tags;
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.now() - startedMs);
    const summaryText = `Briefing "${job.name}" completed (${evidence.citations.length} citations)`;

    const completedRun = await this.deps.threadBindingRepo.updateBriefingRun(workspaceId, run.id, {
      status: "succeeded",
      batchId,
      documentId: targetDocumentId,
      summary: summaryText,
      citations: evidence.citations,
      durationMs,
      finishedAt,
    });
    await this.deps.threadBindingRepo.updateBriefingJob(workspaceId, job.id, {
      lastRunAt: finishedAt,
      lastStatus: "succeeded",
    });

    this.deps.sseHub.publish({
      type: "briefing.succeeded",
      workspaceId,
      spaceId: targetDocumentSpaceId,
      documentId: targetDocumentId,
      documentKind: targetDocumentKind,
      tags: targetDocumentTags,
      actorType: principal.actorType,
      payload: { run: completedRun },
    });
    this.deps.sseHub.publish({
      type: "briefing.job.updated",
      workspaceId,
      spaceId: targetDocumentSpaceId,
      actorType: principal.actorType,
      payload: { action: "updated", jobId: job.id },
    });

    return completedRun;
  }

  private async dispatchExternalWakeup(
    principal: Principal,
    job: AgentBriefingJobRecord,
    run: AgentBriefingRunRecord,
    batchId: AuditBatchId,
    targetSpaceId: SpaceId,
    allSpaces: readonly Space[],
    evidence: GatheredBriefingEvidence,
    triggerKind: BriefingTriggerKind,
    startedMs: number,
  ): Promise<AgentBriefingRunRecord> {
    const workspaceId = principal.workspaceId;
    let eventSpaceId = targetSpaceId;

    if (job.bindingId) {
      const binding = await this.deps.threadBindingRepo.getThreadBindingById(
        workspaceId,
        job.bindingId,
      );
      if (binding) {
        const bindingDoc = await this.deps.documentRepo.getDocumentById(
          workspaceId,
          binding.documentId,
        );
        if (bindingDoc) {
          eventSpaceId = bindingDoc.spaceId;
        }
        const nextStep: AgentStepItem = {
          id: createId(ID_PREFIXES.agentStep),
          label: `Briefing wakeup: ${job.name} (${triggerKind}, batch ${batchId})`,
          status: "running",
        };
        const updatedSteps = [...(binding.progressSteps ?? []).slice(-99), nextStep];
        await this.deps.threadBindingService.updateBinding(principal, binding.id, {
          progressSteps: updatedSteps,
        });
      }
    }

    const renderedPrompt = renderTemplateTokens(job.promptTemplate, job);
    const finishedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.now() - startedMs);
    const summaryText = `Dispatched ADE wakeup for "${job.name}" (${evidence.allowedDocumentIds.length} scoped docs)`;

    const completedRun = await this.deps.threadBindingRepo.updateBriefingRun(workspaceId, run.id, {
      status: "dispatched",
      batchId,
      summary: summaryText,
      citations: evidence.citations,
      durationMs,
      finishedAt,
    });
    await this.deps.threadBindingRepo.updateBriefingJob(workspaceId, job.id, {
      lastRunAt: finishedAt,
      lastStatus: "dispatched",
    });

    await this.deps.auditService.recordPrincipalEvent(principal, {
      transport: "rest",
      action: "briefing.wakeup",
      resource: `briefing-job:${job.id}`,
      spaceId: eventSpaceId,
      decision: "allowed",
      summary: summaryText,
      reversible: false,
      irreversibleReason: "External ADE wakeup signal dispatch",
      batchId,
      executionMode: "autonomous",
    });

    const activeCapture = this.deps.auditService.getActiveAuditCapture();
    if (activeCapture) {
      activeCapture.recorded = true;
    }

    this.deps.sseHub.publish({
      type: "briefing.wakeup",
      workspaceId,
      spaceId: eventSpaceId,
      actorType: principal.actorType,
      payload: {
        runId: completedRun.id,
        jobId: job.id,
        jobName: job.name,
        batchId,
        bindingId: job.bindingId,
        prompt: renderedPrompt,
        allowedDocumentIds: evidence.allowedDocumentIds,
        contextPackSlugs: evidence.contextPackSlugs,
        target: job.target,
        scopeSummary: summarizeEffectiveScope(principal.scope, allSpaces),
      },
    });
    this.deps.sseHub.publish({
      type: "briefing.job.updated",
      workspaceId,
      spaceId: eventSpaceId,
      actorType: principal.actorType,
      payload: { action: "updated", jobId: job.id },
    });

    return completedRun;
  }
}
