import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  asApiTokenId,
  asAuditBatchId,
  asBriefingJobId,
  asBriefingRunId,
  asDocumentId,
  asThreadBindingId,
  asWorkspaceId,
  briefingCitationsArraySchema,
  briefingSourcesConfigSchema,
  briefingTargetConfigSchema,
  createId,
  DEFAULT_BRIEFING_SOURCES_CONFIG,
  DEFAULT_BRIEFING_TARGET_CONFIG,
  ID_PREFIXES,
  InkadeError,
  parseJsonWithSchema,
  type AgentBriefingJobRecord,
  type AgentBriefingRunRecord,
  type BriefingExecutionPath,
  type BriefingRunId,
  type BriefingRunStatus,
  type BriefingTriggerKind,
  type ParsedCreateBriefingJobInput,
  type UpdateBriefingJobInput,
} from "@inkade/core";
import {
  adeThreadBindings,
  agentBriefingJobs,
  agentBriefingRuns,
  apiTokens,
  documents,
  spaces,
} from "../../schema/sqlite.ts";
import type {
  CreateBriefingRunInput,
  ListBriefingRunsOptions,
  UpdateBriefingRunInput,
} from "../ports/thread-binding.port.ts";
import { nowIso, type SqliteRepoContext } from "./helpers.ts";

export function mapBriefingJobRow(
  row: typeof agentBriefingJobs.$inferSelect,
): AgentBriefingJobRecord {
  return {
    id: asBriefingJobId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    name: row.name,
    description: row.description,
    cronExpr: row.cronExpr,
    timezone: row.timezone,
    executionPath: (row.executionPath as BriefingExecutionPath) || "builtin_rag",
    bindingId: row.bindingId ? asThreadBindingId(row.bindingId) : null,
    tokenRuleId: row.tokenRuleId ? asApiTokenId(row.tokenRuleId) : null,
    promptTemplate: row.promptTemplate,
    sources: parseJsonWithSchema(
      row.sourcesJson,
      briefingSourcesConfigSchema,
      DEFAULT_BRIEFING_SOURCES_CONFIG,
    ),
    target: parseJsonWithSchema(
      row.targetJson,
      briefingTargetConfigSchema,
      DEFAULT_BRIEFING_TARGET_CONFIG,
    ),
    enabled: Boolean(row.enabled),
    lastRunAt: row.lastRunAt,
    lastStatus: (row.lastStatus as BriefingRunStatus | null) ?? null,
    nextRunAt: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapBriefingRunRow(
  row: typeof agentBriefingRuns.$inferSelect,
  jobName: string,
): AgentBriefingRunRecord {
  return {
    id: asBriefingRunId(row.id),
    jobId: asBriefingJobId(row.jobId),
    jobName,
    workspaceId: asWorkspaceId(row.workspaceId),
    triggerKind: (row.triggerKind as BriefingTriggerKind) || "schedule",
    status: row.status as BriefingRunStatus,
    batchId: row.batchId ? asAuditBatchId(row.batchId) : null,
    documentId: row.documentId ? asDocumentId(row.documentId) : null,
    summary: row.summary,
    citations: parseJsonWithSchema(row.citationsJson, briefingCitationsArraySchema, []),
    errorMessage: row.errorMessage,
    dismissedAt: row.dismissedAt,
    durationMs: row.durationMs,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function assertJobReferencesExistSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  refs: {
    readonly bindingId?: string | null | undefined;
    readonly tokenRuleId?: string | null | undefined;
    readonly targetSpaceId?: string | null | undefined;
  },
): void {
  if (refs.bindingId) {
    const binding = ctx.db
      .select({ id: adeThreadBindings.id })
      .from(adeThreadBindings)
      .where(
        and(
          eq(adeThreadBindings.workspaceId, workspaceId),
          eq(adeThreadBindings.id, refs.bindingId),
        ),
      )
      .get();
    if (!binding) {
      throw new InkadeError("NOT_FOUND", `Thread binding "${refs.bindingId}" not found`);
    }
  }
  if (refs.tokenRuleId) {
    const token = ctx.db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(and(eq(apiTokens.workspaceId, workspaceId), eq(apiTokens.id, refs.tokenRuleId)))
      .get();
    if (!token) {
      throw new InkadeError("NOT_FOUND", `API token "${refs.tokenRuleId}" not found`);
    }
  }
  if (refs.targetSpaceId) {
    const space = ctx.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, refs.targetSpaceId)))
      .get();
    if (!space) {
      throw new InkadeError("NOT_FOUND", `Space "${refs.targetSpaceId}" not found`);
    }
  }
}

export function listBriefingJobsSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
): AgentBriefingJobRecord[] {
  return ctx.db
    .select()
    .from(agentBriefingJobs)
    .where(eq(agentBriefingJobs.workspaceId, workspaceId))
    .orderBy(desc(agentBriefingJobs.createdAt), desc(sql`rowid`))
    .all()
    .map(mapBriefingJobRow);
}

export function listAllEnabledBriefingJobsSync(
  ctx: SqliteRepoContext,
): AgentBriefingJobRecord[] {
  return ctx.db
    .select()
    .from(agentBriefingJobs)
    .where(eq(agentBriefingJobs.enabled, true))
    .orderBy(desc(agentBriefingJobs.createdAt))
    .all()
    .map(mapBriefingJobRow);
}

export function getBriefingJobByIdSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  jobId: string,
): AgentBriefingJobRecord | null {
  const row = ctx.db
    .select()
    .from(agentBriefingJobs)
    .where(and(eq(agentBriefingJobs.workspaceId, workspaceId), eq(agentBriefingJobs.id, jobId)))
    .get();
  return row ? mapBriefingJobRow(row) : null;
}

export function createBriefingJobSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  input: ParsedCreateBriefingJobInput,
  options?: { readonly id?: string | undefined },
): AgentBriefingJobRecord {
  assertJobReferencesExistSync(ctx, workspaceId, {
    bindingId: input.bindingId,
    tokenRuleId: input.tokenRuleId,
    targetSpaceId: input.target.targetSpaceId,
  });

  const ts = nowIso();
  const row: typeof agentBriefingJobs.$inferSelect = {
    id: options?.id ?? createId(ID_PREFIXES.briefingJob),
    workspaceId,
    name: input.name,
    description: input.description ?? "",
    cronExpr: input.cronExpr,
    timezone: input.timezone ?? "UTC",
    executionPath: input.executionPath ?? "builtin_rag",
    bindingId: input.bindingId ?? null,
    tokenRuleId: input.tokenRuleId ?? null,
    targetSpaceId: input.target.targetSpaceId ?? null,
    promptTemplate: input.promptTemplate,
    sourcesJson: JSON.stringify(input.sources ?? DEFAULT_BRIEFING_SOURCES_CONFIG),
    targetJson: JSON.stringify(input.target ?? DEFAULT_BRIEFING_TARGET_CONFIG),
    enabled: input.enabled ?? true,
    lastRunAt: null,
    lastStatus: null,
    createdAt: ts,
    updatedAt: ts,
  };
  ctx.db.insert(agentBriefingJobs).values(row).run();
  return mapBriefingJobRow(row);
}

export function updateBriefingJobSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  jobId: string,
  input: UpdateBriefingJobInput & {
    readonly lastRunAt?: string | null | undefined;
    readonly lastStatus?: BriefingRunStatus | null | undefined;
  },
): AgentBriefingJobRecord {
  const current = ctx.db
    .select()
    .from(agentBriefingJobs)
    .where(and(eq(agentBriefingJobs.workspaceId, workspaceId), eq(agentBriefingJobs.id, jobId)))
    .get();
  if (!current) {
    throw new InkadeError("NOT_FOUND", `Briefing job "${jobId}" not found`);
  }

  const nextBindingId = input.bindingId !== undefined ? input.bindingId : current.bindingId;
  const nextTokenRuleId =
    input.tokenRuleId !== undefined ? input.tokenRuleId : current.tokenRuleId;
  const nextTarget =
    input.target !== undefined
      ? input.target
      : parseJsonWithSchema(
          current.targetJson,
          briefingTargetConfigSchema,
          DEFAULT_BRIEFING_TARGET_CONFIG,
        );

  assertJobReferencesExistSync(ctx, workspaceId, {
    bindingId: nextBindingId,
    tokenRuleId: nextTokenRuleId,
    targetSpaceId: nextTarget.targetSpaceId,
  });

  const ts = nowIso();
  ctx.db
    .update(agentBriefingJobs)
    .set({
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      cronExpr: input.cronExpr ?? current.cronExpr,
      timezone: input.timezone ?? current.timezone,
      executionPath: input.executionPath ?? current.executionPath,
      bindingId: nextBindingId,
      tokenRuleId: nextTokenRuleId,
      targetSpaceId: nextTarget.targetSpaceId ?? null,
      promptTemplate: input.promptTemplate ?? current.promptTemplate,
      sourcesJson:
        input.sources !== undefined ? JSON.stringify(input.sources) : current.sourcesJson,
      targetJson: input.target !== undefined ? JSON.stringify(nextTarget) : current.targetJson,
      enabled: input.enabled ?? current.enabled,
      lastRunAt: input.lastRunAt !== undefined ? input.lastRunAt : current.lastRunAt,
      lastStatus: input.lastStatus !== undefined ? input.lastStatus : current.lastStatus,
      updatedAt: ts,
    })
    .where(eq(agentBriefingJobs.id, jobId))
    .run();

  const updated = ctx.db
    .select()
    .from(agentBriefingJobs)
    .where(eq(agentBriefingJobs.id, jobId))
    .get();
  if (!updated) {
    throw new InkadeError("INTERNAL_ERROR", "Failed to read updated briefing job");
  }
  return mapBriefingJobRow(updated);
}

export function deleteBriefingJobSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  jobId: string,
): void {
  const existing = ctx.db
    .select({ id: agentBriefingJobs.id })
    .from(agentBriefingJobs)
    .where(and(eq(agentBriefingJobs.workspaceId, workspaceId), eq(agentBriefingJobs.id, jobId)))
    .get();
  if (!existing) {
    throw new InkadeError("NOT_FOUND", `Briefing job "${jobId}" not found`);
  }
  ctx.db.delete(agentBriefingJobs).where(eq(agentBriefingJobs.id, jobId)).run();
}

export function listBriefingRunsSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  options?: ListBriefingRunsOptions,
): AgentBriefingRunRecord[] {
  const conds = [eq(agentBriefingRuns.workspaceId, workspaceId)];
  if (options?.jobId) {
    conds.push(eq(agentBriefingRuns.jobId, options.jobId));
  }
  if (options?.status) {
    conds.push(eq(agentBriefingRuns.status, options.status));
  }
  if (options?.includeDismissed === false || options?.undismissedOnly === true) {
    conds.push(isNull(agentBriefingRuns.dismissedAt));
  }
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const rows = ctx.db
    .select({
      run: agentBriefingRuns,
      jobName: agentBriefingJobs.name,
    })
    .from(agentBriefingRuns)
    .innerJoin(agentBriefingJobs, eq(agentBriefingRuns.jobId, agentBriefingJobs.id))
    .where(and(...conds))
    .orderBy(desc(agentBriefingRuns.startedAt), desc(sql`agent_briefing_runs.rowid`))
    .limit(limit)
    .all();

  return rows.map((r) => mapBriefingRunRow(r.run, r.jobName));
}

export function getBriefingRunByIdSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  runId: BriefingRunId | string,
): AgentBriefingRunRecord | null {
  const row = ctx.db
    .select({
      run: agentBriefingRuns,
      jobName: agentBriefingJobs.name,
    })
    .from(agentBriefingRuns)
    .innerJoin(agentBriefingJobs, eq(agentBriefingRuns.jobId, agentBriefingJobs.id))
    .where(and(eq(agentBriefingRuns.workspaceId, workspaceId), eq(agentBriefingRuns.id, runId)))
    .get();
  return row ? mapBriefingRunRow(row.run, row.jobName) : null;
}

export function createBriefingRunSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  input: CreateBriefingRunInput,
): AgentBriefingRunRecord {
  const job = ctx.db
    .select({ id: agentBriefingJobs.id, name: agentBriefingJobs.name })
    .from(agentBriefingJobs)
    .where(
      and(eq(agentBriefingJobs.workspaceId, workspaceId), eq(agentBriefingJobs.id, input.jobId)),
    )
    .get();
  if (!job) {
    throw new InkadeError("NOT_FOUND", `Briefing job "${input.jobId}" not found`);
  }

  let docId: string | null = input.documentId ?? null;
  if (docId) {
    const doc = ctx.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, docId)))
      .get();
    if (!doc) docId = null;
  }

  const ts = input.startedAt ?? nowIso();
  const row: typeof agentBriefingRuns.$inferSelect = {
    id: input.id ?? createId(ID_PREFIXES.briefingRun),
    jobId: job.id,
    workspaceId,
    triggerKind: input.triggerKind,
    status: input.status,
    batchId: input.batchId ?? null,
    documentId: docId,
    summary: input.summary ?? null,
    citationsJson: JSON.stringify(input.citations ?? []),
    errorMessage: input.errorMessage ?? null,
    dismissedAt: null,
    durationMs: input.durationMs ?? null,
    startedAt: ts,
    finishedAt: input.finishedAt ?? null,
  };
  ctx.db.insert(agentBriefingRuns).values(row).run();
  return mapBriefingRunRow(row, job.name);
}

export function updateBriefingRunSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  runId: BriefingRunId | string,
  patch: UpdateBriefingRunInput,
): AgentBriefingRunRecord {
  const current = ctx.db
    .select({
      run: agentBriefingRuns,
      jobName: agentBriefingJobs.name,
    })
    .from(agentBriefingRuns)
    .innerJoin(agentBriefingJobs, eq(agentBriefingRuns.jobId, agentBriefingJobs.id))
    .where(and(eq(agentBriefingRuns.workspaceId, workspaceId), eq(agentBriefingRuns.id, runId)))
    .get();
  if (!current) {
    throw new InkadeError("NOT_FOUND", `Briefing run "${runId}" not found`);
  }

  ctx.db
    .update(agentBriefingRuns)
    .set({
      status: patch.status ?? current.run.status,
      batchId: patch.batchId !== undefined ? patch.batchId : current.run.batchId,
      documentId: patch.documentId !== undefined ? patch.documentId : current.run.documentId,
      summary: patch.summary !== undefined ? patch.summary : current.run.summary,
      citationsJson:
        patch.citations !== undefined ? JSON.stringify(patch.citations) : current.run.citationsJson,
      errorMessage:
        patch.errorMessage !== undefined ? patch.errorMessage : current.run.errorMessage,
      dismissedAt:
        patch.dismissedAt !== undefined ? patch.dismissedAt : current.run.dismissedAt,
      durationMs: patch.durationMs !== undefined ? patch.durationMs : current.run.durationMs,
      finishedAt: patch.finishedAt !== undefined ? patch.finishedAt : current.run.finishedAt,
    })
    .where(eq(agentBriefingRuns.id, runId))
    .run();

  const updated = ctx.db
    .select({
      run: agentBriefingRuns,
      jobName: agentBriefingJobs.name,
    })
    .from(agentBriefingRuns)
    .innerJoin(agentBriefingJobs, eq(agentBriefingRuns.jobId, agentBriefingJobs.id))
    .where(eq(agentBriefingRuns.id, runId))
    .get();
  if (!updated) {
    throw new InkadeError("INTERNAL_ERROR", "Failed to read updated briefing run");
  }
  return mapBriefingRunRow(updated.run, updated.jobName);
}

export function dismissBriefingRunSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  runId: BriefingRunId | string,
): AgentBriefingRunRecord {
  return updateBriefingRunSync(ctx, workspaceId, runId, {
    dismissedAt: nowIso(),
  });
}
