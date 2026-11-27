import type {
  AckWakeEventInput,
  AdeKind,
  AdeThreadBinding,
  AgentBriefingJobRecord,
  AgentBriefingRunRecord,
  AuditBatchId,
  BridgeSessionRecord,
  BriefingCitation,
  BriefingJobId,
  BriefingRunId,
  BriefingRunStatus,
  BriefingTriggerKind,
  ClaimThreadBindingInput,
  CreateThreadBindingInput,
  DocumentId,
  HeartbeatBridgeSessionInput,
  ListBridgeSessionsInput,
  OutlineNodeId,
  ParsedCreateBriefingJobInput,
  UpdateBriefingJobInput,
  UpdateThreadBindingInput,
  WakeEnvelope,
  WakeEventId,
  WakeReason,
  WakeSenderKind,
  WakeSourcePayload,
} from "@inkade/core";

export interface ListThreadBindingsOptions {
  readonly documentId?: DocumentId | undefined;
  readonly nodeId?: OutlineNodeId | undefined;
  readonly status?: AdeThreadBinding["status"] | undefined;
}

export interface ListBriefingRunsOptions {
  readonly jobId?: BriefingJobId | string | undefined;
  readonly status?: BriefingRunStatus | undefined;
  readonly includeDismissed?: boolean | undefined;
  readonly undismissedOnly?: boolean | undefined;
  readonly limit?: number | undefined;
}

export interface CreateBriefingRunInput {
  readonly id?: BriefingRunId | string | undefined;
  readonly jobId: BriefingJobId | string;
  readonly triggerKind: BriefingTriggerKind;
  readonly status: BriefingRunStatus;
  readonly batchId?: AuditBatchId | string | null | undefined;
  readonly documentId?: DocumentId | string | null | undefined;
  readonly summary?: string | null | undefined;
  readonly citations?: readonly BriefingCitation[] | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly durationMs?: number | null | undefined;
  readonly startedAt?: string | undefined;
  readonly finishedAt?: string | null | undefined;
}

export interface UpdateBriefingRunInput {
  readonly status?: BriefingRunStatus | undefined;
  readonly batchId?: AuditBatchId | string | null | undefined;
  readonly documentId?: DocumentId | string | null | undefined;
  readonly summary?: string | null | undefined;
  readonly citations?: readonly BriefingCitation[] | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly dismissedAt?: string | null | undefined;
  readonly durationMs?: number | null | undefined;
  readonly finishedAt?: string | null | undefined;
}

export interface CoalescedWakeFields {
  readonly senderKind: WakeSenderKind;
  readonly senderName: string;
  readonly summary: string;
  readonly formattedPromptText: string;
  readonly sourcePayload: WakeSourcePayload;
}

export interface EnqueueWakeEventRepoInput {
  readonly id?: WakeEventId | undefined;
  readonly bindingId: string | null;
  readonly documentId: string;
  readonly targetAdeKind: AdeKind | null;
  readonly targetExternalThreadId: string | null;
  readonly targetWorkspacePath: string | null;
  readonly senderKind: WakeSenderKind;
  readonly senderName: string;
  readonly reason: WakeReason;
  readonly summary: string;
  readonly formattedPromptText: string;
  readonly sourcePayload: WakeSourcePayload;
  readonly dedupeKey: string | null;
  readonly coalesceSinceIso?: string | null | undefined;
  readonly createdAt?: string | undefined;
  readonly onCoalesce?: ((existing: WakeEnvelope) => CoalescedWakeFields) | undefined;
}

export interface ListPendingWakeEventsOptions {
  readonly adeKind?: string | undefined;
  readonly externalThreadId?: string | undefined;
  readonly workspacePath?: string | undefined;
  readonly bindingId?: string | undefined;
  readonly documentId?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ClaimUnownedWakeEventsInput {
  readonly documentId: string;
  readonly bindingId: string | null;
  readonly adeKind: string;
  readonly externalThreadId: string;
  readonly workspacePath?: string | null | undefined;
  readonly fallbackBindingTitle?: string | undefined;
  readonly buildTransferPrompt: (wake: WakeEnvelope) => string;
}

export interface ThreadBindingRepo {
  listThreadBindings(
    workspaceId: string,
    options?: ListThreadBindingsOptions,
  ): Promise<readonly AdeThreadBinding[]>;
  getThreadBindingById(
    workspaceId: string,
    bindingId: string,
  ): Promise<AdeThreadBinding | null>;
  getThreadBindingByExternal(
    workspaceId: string,
    adeKind: string,
    externalThreadId: string,
  ): Promise<AdeThreadBinding | null>;
  upsertThreadBinding(
    workspaceId: string,
    input: CreateThreadBindingInput,
    options?: { readonly id?: string | undefined },
  ): Promise<AdeThreadBinding>;
  updateThreadBinding(
    workspaceId: string,
    bindingId: string,
    input: UpdateThreadBindingInput,
  ): Promise<AdeThreadBinding>;
  claimThreadBinding(
    workspaceId: string,
    bindingId: string,
    input: ClaimThreadBindingInput,
  ): Promise<AdeThreadBinding>;
  deleteThreadBinding(workspaceId: string, bindingId: string): Promise<void>;

  listBriefingJobs(workspaceId: string): Promise<readonly AgentBriefingJobRecord[]>;
  listAllEnabledBriefingJobs(): Promise<readonly AgentBriefingJobRecord[]>;
  getBriefingJobById(
    workspaceId: string,
    jobId: BriefingJobId | string,
  ): Promise<AgentBriefingJobRecord | null>;
  createBriefingJob(
    workspaceId: string,
    input: ParsedCreateBriefingJobInput,
    options?: { readonly id?: string | undefined },
  ): Promise<AgentBriefingJobRecord>;
  updateBriefingJob(
    workspaceId: string,
    jobId: BriefingJobId | string,
    input: UpdateBriefingJobInput & {
      readonly lastRunAt?: string | null | undefined;
      readonly lastStatus?: BriefingRunStatus | null | undefined;
    },
  ): Promise<AgentBriefingJobRecord>;
  deleteBriefingJob(workspaceId: string, jobId: BriefingJobId | string): Promise<void>;

  listBriefingRuns(
    workspaceId: string,
    options?: ListBriefingRunsOptions,
  ): Promise<readonly AgentBriefingRunRecord[]>;
  getBriefingRunById(
    workspaceId: string,
    runId: BriefingRunId | string,
  ): Promise<AgentBriefingRunRecord | null>;
  createBriefingRun(
    workspaceId: string,
    input: CreateBriefingRunInput,
  ): Promise<AgentBriefingRunRecord>;
  updateBriefingRun(
    workspaceId: string,
    runId: BriefingRunId | string,
    patch: UpdateBriefingRunInput,
  ): Promise<AgentBriefingRunRecord>;
  dismissBriefingRun(
    workspaceId: string,
    runId: BriefingRunId | string,
  ): Promise<AgentBriefingRunRecord>;

  countRecentWakeEvents(
    workspaceId: string,
    filter: {
      readonly bindingId?: string | null | undefined;
      readonly documentId?: string | undefined;
      readonly sinceIso: string;
    },
  ): Promise<number>;
  enqueueOrCoalesceWakeEvent(
    workspaceId: string,
    input: EnqueueWakeEventRepoInput,
  ): Promise<{ readonly wake: WakeEnvelope; readonly coalesced: boolean }>;
  listPendingWakeEvents(
    workspaceId: string,
    options?: ListPendingWakeEventsOptions,
  ): Promise<readonly WakeEnvelope[]>;
  claimPendingWakeEvents(
    workspaceId: string,
    wakeIds: readonly string[],
    options?: { readonly markDelivered?: boolean | undefined },
  ): Promise<readonly WakeEnvelope[]>;
  getWakeEventById(workspaceId: string, wakeId: string): Promise<WakeEnvelope | null>;
  ackWakeEvent(
    workspaceId: string,
    wakeId: string,
    input: AckWakeEventInput,
  ): Promise<WakeEnvelope>;
  hasPendingUnownedWakeEvents(workspaceId: string, documentId: string): Promise<boolean>;
  claimUnownedWakeEvents(
    workspaceId: string,
    input: ClaimUnownedWakeEventsInput,
  ): Promise<readonly WakeEnvelope[]>;
  upsertBridgeSession(
    workspaceId: string,
    input: HeartbeatBridgeSessionInput,
  ): Promise<{ readonly session: BridgeSessionRecord; readonly created: boolean }>;
  getBridgeSessionById(
    workspaceId: string,
    sessionId: string,
  ): Promise<BridgeSessionRecord | null>;
  listBridgeSessions(
    workspaceId: string,
    options?: ListBridgeSessionsInput,
  ): Promise<readonly BridgeSessionRecord[]>;
}
