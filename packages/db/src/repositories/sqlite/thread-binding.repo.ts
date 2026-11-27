import { and, desc, eq } from "drizzle-orm";
import {
  createId,
  DEFAULT_HOST_KIND,
  ID_PREFIXES,
  InkadeError,
  type AckWakeEventInput,
  type AdeThreadBinding,
  type AgentBriefingJobRecord,
  type AgentBriefingRunRecord,
  type BridgeSessionRecord,
  type BriefingJobId,
  type BriefingRunId,
  type BriefingRunStatus,
  type ClaimThreadBindingInput,
  type CreateThreadBindingInput,
  type HeartbeatBridgeSessionInput,
  type ListBridgeSessionsInput,
  type ParsedCreateBriefingJobInput,
  type UpdateBriefingJobInput,
  type UpdateThreadBindingInput,
  type WakeEnvelope,
} from "@inkade/core";
import { adeThreadBindings, documents, outlineNodes } from "../../schema/sqlite.ts";
import type {
  ClaimUnownedWakeEventsInput,
  CreateBriefingRunInput,
  EnqueueWakeEventRepoInput,
  ListBriefingRunsOptions,
  ListPendingWakeEventsOptions,
  ListThreadBindingsOptions,
  ThreadBindingRepo,
  UpdateBriefingRunInput,
} from "../ports/thread-binding.port.ts";
import {
  createBriefingJobSync,
  createBriefingRunSync,
  deleteBriefingJobSync,
  dismissBriefingRunSync,
  getBriefingJobByIdSync,
  getBriefingRunByIdSync,
  listAllEnabledBriefingJobsSync,
  listBriefingJobsSync,
  listBriefingRunsSync,
  updateBriefingJobSync,
  updateBriefingRunSync,
} from "./briefing-helpers.ts";
import { nowIso, syncToPromise, type SqliteRepoContext } from "./helpers.ts";
import { mapThreadBindingRow } from "./mappers.ts";
import {
  ackWakeEventSync,
  claimPendingWakeEventsSync,
  claimUnownedWakeEventsSync,
  countRecentWakeEventsSync,
  enqueueOrCoalesceWakeEventSync,
  getBridgeSessionByIdSync,
  getWakeEventByIdSync,
  hasPendingUnownedWakeEventsSync,
  listBridgeSessionsSync,
  listPendingWakeEventsSync,
  upsertBridgeSessionSync,
} from "./wake-helpers.ts";

export class SqliteThreadBindingRepo implements ThreadBindingRepo {
  constructor(private readonly ctx: SqliteRepoContext) {}

  listThreadBindings(
    workspaceId: string,
    options?: ListThreadBindingsOptions,
  ): Promise<readonly AdeThreadBinding[]> {
    return syncToPromise(() => {
      const conditions = [eq(adeThreadBindings.workspaceId, workspaceId)];
      if (options?.documentId) {
        conditions.push(eq(adeThreadBindings.documentId, options.documentId));
      }
      if (options?.nodeId) {
        conditions.push(eq(adeThreadBindings.nodeId, options.nodeId));
      }
      if (options?.status) {
        conditions.push(eq(adeThreadBindings.status, options.status));
      }
      const rows = this.ctx.db
        .select()
        .from(adeThreadBindings)
        .where(and(...conditions))
        .orderBy(desc(adeThreadBindings.lastSyncedAt))
        .all();
      return rows.map(mapThreadBindingRow);
    });
  }

  getThreadBindingById(
    workspaceId: string,
    bindingId: string,
  ): Promise<AdeThreadBinding | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(adeThreadBindings)
        .where(
          and(
            eq(adeThreadBindings.workspaceId, workspaceId),
            eq(adeThreadBindings.id, bindingId),
          ),
        )
        .get();
      return row ? mapThreadBindingRow(row) : null;
    });
  }

  getThreadBindingByExternal(
    workspaceId: string,
    adeKind: string,
    externalThreadId: string,
  ): Promise<AdeThreadBinding | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(adeThreadBindings)
        .where(
          and(
            eq(adeThreadBindings.workspaceId, workspaceId),
            eq(adeThreadBindings.adeKind, adeKind),
            eq(adeThreadBindings.externalThreadId, externalThreadId),
          ),
        )
        .get();
      return row ? mapThreadBindingRow(row) : null;
    });
  }

  upsertThreadBinding(
    workspaceId: string,
    input: CreateThreadBindingInput,
    options?: { readonly id?: string | undefined },
  ): Promise<AdeThreadBinding> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const doc = this.ctx.db
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, input.documentId)))
          .get();
        if (!doc) {
          throw new InkadeError("NOT_FOUND", `Document "${input.documentId}" not found`);
        }

        const nodeId = input.nodeId ?? null;
        const adeKind = input.adeKind ?? DEFAULT_HOST_KIND;

        if (nodeId !== null) {
          const node = this.ctx.db
            .select({ id: outlineNodes.id })
            .from(outlineNodes)
            .where(
              and(eq(outlineNodes.documentId, input.documentId), eq(outlineNodes.id, nodeId)),
            )
            .get();
          if (!node) {
            throw new InkadeError("NOT_FOUND", `Outline node "${nodeId}" not found`);
          }
        }

        const existing = this.ctx.db
          .select()
          .from(adeThreadBindings)
          .where(
            and(
              eq(adeThreadBindings.workspaceId, workspaceId),
              eq(adeThreadBindings.adeKind, adeKind),
              eq(adeThreadBindings.externalThreadId, input.externalThreadId),
            ),
          )
          .get();

        const ts = nowIso();
        if (existing) {
          const nextStatus = input.status ?? existing.status;
          const nextRunningSince =
            nextStatus === "running"
              ? input.runningSince !== undefined
                ? (input.runningSince ?? ts)
                : existing.status === "running"
                  ? (existing.runningSince ?? ts)
                  : ts
              : null;

          this.ctx.db
            .update(adeThreadBindings)
            .set({
              documentId: input.documentId,
              nodeId,
              selectionAnchorJson:
                input.selectionAnchor !== undefined
                  ? input.selectionAnchor
                    ? JSON.stringify(input.selectionAnchor)
                    : null
                  : existing.selectionAnchorJson,
              externalWorkspaceId:
                input.externalWorkspaceId !== undefined
                  ? input.externalWorkspaceId
                  : existing.externalWorkspaceId,
              deepLink: input.deepLink !== undefined ? input.deepLink : existing.deepLink,
              title: input.title,
              status: nextStatus,
              runningSince: nextRunningSince,
              lastSummary:
                input.lastSummary !== undefined ? input.lastSummary : existing.lastSummary,
              unreadResult: input.unreadResult ?? existing.unreadResult,
              lastSyncedAt: ts,
              parentBindingId:
                input.parentBindingId !== undefined
                  ? input.parentBindingId
                  : existing.parentBindingId,
              progressStepsJson:
                input.progressSteps !== undefined
                  ? JSON.stringify(input.progressSteps)
                  : existing.progressStepsJson,
              pendingApprovalJson:
                input.pendingApproval !== undefined
                  ? input.pendingApproval
                    ? JSON.stringify(input.pendingApproval)
                    : null
                  : existing.pendingApprovalJson,
              steeringQueueJson:
                input.steeringQueue !== undefined
                  ? JSON.stringify(input.steeringQueue)
                  : existing.steeringQueueJson,
            })
            .where(eq(adeThreadBindings.id, existing.id))
            .run();

          const refreshed = this.ctx.db
            .select()
            .from(adeThreadBindings)
            .where(eq(adeThreadBindings.id, existing.id))
            .get();
          if (!refreshed) {
            throw new InkadeError("INTERNAL_ERROR", "Failed to read updated thread binding");
          }
          return mapThreadBindingRow(refreshed);
        }

        const bindingId = options?.id ?? createId(ID_PREFIXES.threadBinding);
        const initialStatus = input.status ?? "queued";
        const row: typeof adeThreadBindings.$inferSelect = {
          id: bindingId,
          workspaceId,
          documentId: input.documentId,
          nodeId,
          selectionAnchorJson: input.selectionAnchor ? JSON.stringify(input.selectionAnchor) : null,
          adeKind,
          externalWorkspaceId: input.externalWorkspaceId ?? null,
          externalThreadId: input.externalThreadId,
          deepLink: input.deepLink ?? null,
          title: input.title,
          status: initialStatus,
          lastSummary: input.lastSummary ?? null,
          unreadResult: input.unreadResult ?? false,
          lastSyncedAt: ts,
          createdAt: ts,
          runningSince: initialStatus === "running" ? (input.runningSince ?? ts) : null,
          parentBindingId: input.parentBindingId ?? null,
          progressStepsJson: input.progressSteps ? JSON.stringify(input.progressSteps) : null,
          pendingApprovalJson: input.pendingApproval ? JSON.stringify(input.pendingApproval) : null,
          steeringQueueJson: input.steeringQueue ? JSON.stringify(input.steeringQueue) : null,
        };
        this.ctx.db.insert(adeThreadBindings).values(row).run();
        return mapThreadBindingRow(row);
      }),
    );
  }

  updateThreadBinding(
    workspaceId: string,
    bindingId: string,
    input: UpdateThreadBindingInput,
  ): Promise<AdeThreadBinding> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select()
        .from(adeThreadBindings)
        .where(
          and(
            eq(adeThreadBindings.workspaceId, workspaceId),
            eq(adeThreadBindings.id, bindingId),
          ),
        )
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `Thread binding "${bindingId}" not found`);
      }

      const ts = input.lastSyncedAt ?? nowIso();
      const nextStatus = input.status ?? current.status;
      const nextRunningSince =
        nextStatus === "running"
          ? input.runningSince !== undefined
            ? (input.runningSince ?? ts)
            : current.status === "running"
              ? (current.runningSince ?? ts)
              : ts
          : null;

      this.ctx.db
        .update(adeThreadBindings)
        .set({
          title: input.title ?? current.title,
          status: nextStatus,
          runningSince: nextRunningSince,
          deepLink: input.deepLink !== undefined ? input.deepLink : current.deepLink,
          lastSummary: input.lastSummary !== undefined ? input.lastSummary : current.lastSummary,
          unreadResult: input.unreadResult ?? current.unreadResult,
          lastSyncedAt: ts,
          parentBindingId:
            input.parentBindingId !== undefined ? input.parentBindingId : current.parentBindingId,
          progressStepsJson:
            input.progressSteps !== undefined
              ? JSON.stringify(input.progressSteps)
              : current.progressStepsJson,
          pendingApprovalJson:
            input.pendingApproval !== undefined
              ? input.pendingApproval
                ? JSON.stringify(input.pendingApproval)
                : null
              : current.pendingApprovalJson,
          steeringQueueJson:
            input.steeringQueue !== undefined
              ? JSON.stringify(input.steeringQueue)
              : current.steeringQueueJson,
        })
        .where(eq(adeThreadBindings.id, bindingId))
        .run();

      const updated = this.ctx.db
        .select()
        .from(adeThreadBindings)
        .where(eq(adeThreadBindings.id, bindingId))
        .get();
      if (!updated) {
        throw new InkadeError("INTERNAL_ERROR", "Failed to read updated thread binding");
      }
      return mapThreadBindingRow(updated);
    });
  }

  claimThreadBinding(
    workspaceId: string,
    bindingId: string,
    input: ClaimThreadBindingInput,
  ): Promise<AdeThreadBinding> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const current = this.ctx.db
          .select()
          .from(adeThreadBindings)
          .where(
            and(
              eq(adeThreadBindings.workspaceId, workspaceId),
              eq(adeThreadBindings.id, bindingId),
            ),
          )
          .get();
        if (!current) {
          throw new InkadeError("NOT_FOUND", `Thread binding "${bindingId}" not found`);
        }

        if (!current.externalThreadId.startsWith("thr_pending_")) {
          throw new InkadeError(
            "CONFLICT",
            `Thread binding "${bindingId}" has already been claimed (${current.externalThreadId})`,
          );
        }

        const targetAdeKind = input.adeKind ?? current.adeKind;
        const duplicate = this.ctx.db
          .select({ id: adeThreadBindings.id })
          .from(adeThreadBindings)
          .where(
            and(
              eq(adeThreadBindings.workspaceId, workspaceId),
              eq(adeThreadBindings.adeKind, targetAdeKind),
              eq(adeThreadBindings.externalThreadId, input.externalThreadId),
            ),
          )
          .get();
        if (duplicate && duplicate.id !== bindingId) {
          throw new InkadeError(
            "CONFLICT",
            `External thread "${input.externalThreadId}" is already bound`,
          );
        }

        const ts = nowIso();
        const targetStatus = input.status ?? "running";
        const result = this.ctx.sqlite
          .query(
            `UPDATE ade_thread_bindings
             SET ade_kind = ?,
                 external_thread_id = ?,
                 external_workspace_id = COALESCE(?, external_workspace_id),
                 deep_link = COALESCE(?, deep_link),
                 status = COALESCE(?, status),
                 last_summary = COALESCE(?, last_summary),
                 last_synced_at = ?,
                 running_since = CASE
                   WHEN COALESCE(?, status) = 'running' THEN COALESCE(running_since, ?)
                   ELSE NULL
                 END
             WHERE id = ? AND workspace_id = ? AND external_thread_id LIKE 'thr_pending_%'`,
          )
          .run(
            targetAdeKind,
            input.externalThreadId,
            input.externalWorkspaceId ?? null,
            input.deepLink ?? null,
            targetStatus,
            input.lastSummary ?? null,
            ts,
            targetStatus,
            ts,
            bindingId,
            workspaceId,
          );

        if (result.changes !== 1) {
          throw new InkadeError(
            "CONFLICT",
            `Thread binding "${bindingId}" was claimed concurrently`,
          );
        }

        const updated = this.ctx.db
          .select()
          .from(adeThreadBindings)
          .where(eq(adeThreadBindings.id, bindingId))
          .get();
        if (!updated) {
          throw new InkadeError("INTERNAL_ERROR", "Failed to read claimed thread binding");
        }
        return mapThreadBindingRow(updated);
      }),
    );
  }

  deleteThreadBinding(workspaceId: string, bindingId: string): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: adeThreadBindings.id })
        .from(adeThreadBindings)
        .where(
          and(
            eq(adeThreadBindings.workspaceId, workspaceId),
            eq(adeThreadBindings.id, bindingId),
          ),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Thread binding "${bindingId}" not found`);
      }
      this.ctx.db.delete(adeThreadBindings).where(eq(adeThreadBindings.id, bindingId)).run();
    });
  }

  listBriefingJobs(workspaceId: string): Promise<readonly AgentBriefingJobRecord[]> {
    return syncToPromise(() => listBriefingJobsSync(this.ctx, workspaceId));
  }

  listAllEnabledBriefingJobs(): Promise<readonly AgentBriefingJobRecord[]> {
    return syncToPromise(() => listAllEnabledBriefingJobsSync(this.ctx));
  }

  getBriefingJobById(
    workspaceId: string,
    jobId: BriefingJobId | string,
  ): Promise<AgentBriefingJobRecord | null> {
    return syncToPromise(() => getBriefingJobByIdSync(this.ctx, workspaceId, jobId));
  }

  createBriefingJob(
    workspaceId: string,
    input: ParsedCreateBriefingJobInput,
    options?: { readonly id?: string | undefined },
  ): Promise<AgentBriefingJobRecord> {
    return syncToPromise(() => createBriefingJobSync(this.ctx, workspaceId, input, options));
  }

  updateBriefingJob(
    workspaceId: string,
    jobId: BriefingJobId | string,
    input: UpdateBriefingJobInput & {
      readonly lastRunAt?: string | null | undefined;
      readonly lastStatus?: BriefingRunStatus | null | undefined;
    },
  ): Promise<AgentBriefingJobRecord> {
    return syncToPromise(() => updateBriefingJobSync(this.ctx, workspaceId, jobId, input));
  }

  deleteBriefingJob(workspaceId: string, jobId: BriefingJobId | string): Promise<void> {
    return syncToPromise(() => deleteBriefingJobSync(this.ctx, workspaceId, jobId));
  }

  listBriefingRuns(
    workspaceId: string,
    options?: ListBriefingRunsOptions,
  ): Promise<readonly AgentBriefingRunRecord[]> {
    return syncToPromise(() => listBriefingRunsSync(this.ctx, workspaceId, options));
  }

  getBriefingRunById(
    workspaceId: string,
    runId: BriefingRunId | string,
  ): Promise<AgentBriefingRunRecord | null> {
    return syncToPromise(() => getBriefingRunByIdSync(this.ctx, workspaceId, runId));
  }

  createBriefingRun(
    workspaceId: string,
    input: CreateBriefingRunInput,
  ): Promise<AgentBriefingRunRecord> {
    return syncToPromise(() => createBriefingRunSync(this.ctx, workspaceId, input));
  }

  updateBriefingRun(
    workspaceId: string,
    runId: BriefingRunId | string,
    patch: UpdateBriefingRunInput,
  ): Promise<AgentBriefingRunRecord> {
    return syncToPromise(() => updateBriefingRunSync(this.ctx, workspaceId, runId, patch));
  }

  dismissBriefingRun(
    workspaceId: string,
    runId: BriefingRunId | string,
  ): Promise<AgentBriefingRunRecord> {
    return syncToPromise(() => dismissBriefingRunSync(this.ctx, workspaceId, runId));
  }

  countRecentWakeEvents(
    workspaceId: string,
    filter: {
      readonly bindingId?: string | null | undefined;
      readonly documentId?: string | undefined;
      readonly sinceIso: string;
    },
  ): Promise<number> {
    return syncToPromise(() => countRecentWakeEventsSync(this.ctx, workspaceId, filter));
  }

  enqueueOrCoalesceWakeEvent(
    workspaceId: string,
    input: EnqueueWakeEventRepoInput,
  ): Promise<{ readonly wake: WakeEnvelope; readonly coalesced: boolean }> {
    return syncToPromise(() => enqueueOrCoalesceWakeEventSync(this.ctx, workspaceId, input));
  }

  listPendingWakeEvents(
    workspaceId: string,
    options?: ListPendingWakeEventsOptions,
  ): Promise<readonly WakeEnvelope[]> {
    return syncToPromise(() => listPendingWakeEventsSync(this.ctx, workspaceId, options));
  }

  claimPendingWakeEvents(
    workspaceId: string,
    wakeIds: readonly string[],
    options?: { readonly markDelivered?: boolean | undefined },
  ): Promise<readonly WakeEnvelope[]> {
    return syncToPromise(() => claimPendingWakeEventsSync(this.ctx, workspaceId, wakeIds, options));
  }

  getWakeEventById(workspaceId: string, wakeId: string): Promise<WakeEnvelope | null> {
    return syncToPromise(() => getWakeEventByIdSync(this.ctx, workspaceId, wakeId));
  }

  ackWakeEvent(
    workspaceId: string,
    wakeId: string,
    input: AckWakeEventInput,
  ): Promise<WakeEnvelope> {
    return syncToPromise(() => ackWakeEventSync(this.ctx, workspaceId, wakeId, input));
  }

  hasPendingUnownedWakeEvents(workspaceId: string, documentId: string): Promise<boolean> {
    return syncToPromise(() => hasPendingUnownedWakeEventsSync(this.ctx, workspaceId, documentId));
  }

  claimUnownedWakeEvents(
    workspaceId: string,
    input: ClaimUnownedWakeEventsInput,
  ): Promise<readonly WakeEnvelope[]> {
    return syncToPromise(() => claimUnownedWakeEventsSync(this.ctx, workspaceId, input));
  }

  upsertBridgeSession(
    workspaceId: string,
    input: HeartbeatBridgeSessionInput,
  ): Promise<{ readonly session: BridgeSessionRecord; readonly created: boolean }> {
    return syncToPromise(() => upsertBridgeSessionSync(this.ctx, workspaceId, input));
  }

  getBridgeSessionById(
    workspaceId: string,
    sessionId: string,
  ): Promise<BridgeSessionRecord | null> {
    return syncToPromise(() => getBridgeSessionByIdSync(this.ctx, workspaceId, sessionId));
  }

  listBridgeSessions(
    workspaceId: string,
    options?: ListBridgeSessionsInput,
  ): Promise<readonly BridgeSessionRecord[]> {
    return syncToPromise(() => listBridgeSessionsSync(this.ctx, workspaceId, options));
  }
}
