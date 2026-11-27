import { AsyncLocalStorage } from "node:async_hooks";
import {
  asAuditBatchId,
  createId,
  deriveQuietGovernanceSummary,
  ID_PREFIXES,
  isPrefixedId,
  type AuditBatchDigestSummary,
  type AuditBatchId,
  type AuditDecision,
  type AuditLogRecord,
  type AuditTransport,
  type DiffPreview,
  type DocumentId,
  type ExecutionMode,
  type RevisionId,
  type SpaceId,
  type WorkspaceId,
} from "@inkade/core";
import type { AuditRepo, CreateAuditLogInput, ListAuditLogsOptions, SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";
import { assertAdminPrincipal, getAllWorkspaceSpaces } from "./scope-guard.ts";

export interface AuditCaptureState {
  readonly transport: AuditTransport;
  batchId?: AuditBatchId | null | undefined;
  executionMode?: ExecutionMode | undefined;
  spaceId?: SpaceId | null | undefined;
  documentId?: DocumentId | null | undefined;
  beforeRevisionId?: RevisionId | null | undefined;
  afterRevisionId?: RevisionId | null | undefined;
  diffPreview?: DiffPreview | null | undefined;
  reversible?: boolean | undefined;
  irreversibleReason?: string | null | undefined;
  summary?: string | null | undefined;
  action?: string | undefined;
  resource?: string | undefined;
  recorded?: boolean | undefined;
  suppressed?: boolean | undefined;
}

export interface AuditCapturePayload {
  readonly batchId?: AuditBatchId | null | undefined;
  readonly executionMode?: ExecutionMode | undefined;
  readonly spaceId?: SpaceId | null | undefined;
  readonly documentId?: DocumentId | null | undefined;
  readonly beforeRevisionId?: RevisionId | null | undefined;
  readonly afterRevisionId?: RevisionId | null | undefined;
  readonly diffPreview?: DiffPreview | null | undefined;
  readonly reversible?: boolean | undefined;
  readonly irreversibleReason?: string | null | undefined;
  readonly summary?: string | null | undefined;
  readonly action?: string | undefined;
  readonly resource?: string | undefined;
}

export interface BatchContextValue {
  readonly batchId?: AuditBatchId | null | undefined;
  readonly executionMode?: ExecutionMode | undefined;
}

export class AuditService {
  private readonly captureStorage = new AsyncLocalStorage<AuditCaptureState>();
  private readonly batchContextStorage = new AsyncLocalStorage<BatchContextValue>();

  constructor(
    private readonly auditRepo: AuditRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spacesCache?: WorkspaceSpacesCache,
  ) {}

  resolveRequestBatchHeader(rawHeader?: string | null): AuditBatchId | undefined {
    const trimmed = rawHeader?.trim();
    if (!trimmed) return undefined;
    if (isPrefixedId(ID_PREFIXES.auditBatch, trimmed)) {
      return trimmed;
    }
    const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    return sanitized ? asAuditBatchId(`bat_${sanitized}`) : undefined;
  }

  runWithBatchContext<T>(context: BatchContextValue, fn: () => Promise<T>): Promise<T> {
    return this.batchContextStorage.run(context, fn);
  }

  getActiveBatchContext(): BatchContextValue | undefined {
    return this.batchContextStorage.getStore();
  }

  ensureActiveBatchContext(principal: Principal): {
    readonly batchId: AuditBatchId | null;
    readonly executionMode: ExecutionMode;
  } {
    const active = this.captureStorage.getStore();
    const batchStore = this.batchContextStorage.getStore();
    const executionMode: ExecutionMode =
      active?.executionMode ??
      batchStore?.executionMode ??
      (principal.kind === "token"
        ? deriveQuietGovernanceSummary(principal.scope).mode
        : "autonomous");

    let batchId: AuditBatchId | null =
      active?.batchId !== undefined
        ? active.batchId
        : batchStore?.batchId !== undefined
          ? batchStore.batchId
          : null;

    if (!batchId && principal.kind === "token") {
      batchId = createId(ID_PREFIXES.auditBatch);
    }
    if (active) {
      if (active.batchId === undefined) active.batchId = batchId;
      if (active.executionMode === undefined) active.executionMode = executionMode;
    }
    return { batchId: active?.batchId ?? batchId, executionMode };
  }

  runWithAuditCapture<T>(
    transport: AuditTransport,
    fn: (state: AuditCaptureState) => Promise<T>,
    options?: {
      readonly principal?: Principal | undefined;
      readonly batchId?: AuditBatchId | null | undefined;
      readonly executionMode?: ExecutionMode | undefined;
    },
  ): Promise<T> {
    const batchStore = this.batchContextStorage.getStore();
    const principal = options?.principal;
    const defaultMode: ExecutionMode | undefined =
      options?.executionMode ??
      batchStore?.executionMode ??
      (principal
        ? principal.kind === "token"
          ? deriveQuietGovernanceSummary(principal.scope).mode
          : "autonomous"
        : undefined);
    const defaultBatchId =
      options?.batchId !== undefined
        ? options.batchId
        : batchStore?.batchId !== undefined
          ? batchStore.batchId
          : principal?.kind === "token"
            ? createId(ID_PREFIXES.auditBatch)
            : undefined;

    const state: AuditCaptureState = {
      transport,
      ...(defaultBatchId !== undefined ? { batchId: defaultBatchId } : {}),
      ...(defaultMode !== undefined ? { executionMode: defaultMode } : {}),
    };
    return this.captureStorage.run(state, () => fn(state));
  }

  getActiveAuditCapture(): AuditCaptureState | undefined {
    return this.captureStorage.getStore();
  }

  /**
   * Suppresses downstream `captureOrRecord` side effects inside nested service calls
   * (used by rollback workflows so they record a single dedicated `audit.rollback` entry).
   */
  async runSuppressed<T>(fn: () => Promise<T>): Promise<T> {
    const active = this.captureStorage.getStore();
    if (!active) {
      return fn();
    }
    const previousSuppressed = active.suppressed;
    active.suppressed = true;
    try {
      return await fn();
    } finally {
      active.suppressed = previousSuppressed;
    }
  }

  async captureOrRecord(
    principal: Principal,
    data: AuditCapturePayload & {
      readonly fallbackAction: string;
      readonly fallbackResource: string;
    },
  ): Promise<void> {
    const { batchId: fallbackBatchId, executionMode: fallbackMode } =
      this.ensureActiveBatchContext(principal);
    const active = this.captureStorage.getStore();
    if (active) {
      if (active.suppressed) return;
      if (data.batchId !== undefined) active.batchId = data.batchId;
      if (data.executionMode !== undefined) active.executionMode = data.executionMode;
      if (data.spaceId !== undefined) active.spaceId = data.spaceId;
      if (data.documentId !== undefined) active.documentId = data.documentId;
      if (data.beforeRevisionId !== undefined) active.beforeRevisionId = data.beforeRevisionId;
      if (data.afterRevisionId !== undefined) active.afterRevisionId = data.afterRevisionId;
      if (data.diffPreview !== undefined) active.diffPreview = data.diffPreview;
      if (data.reversible !== undefined) active.reversible = data.reversible;
      if (data.irreversibleReason !== undefined) {
        active.irreversibleReason = data.irreversibleReason;
      }
      if (data.summary !== undefined) active.summary = data.summary;
      return;
    }

    await this.recordPrincipalEvent(principal, {
      transport: "system",
      action: data.action ?? data.fallbackAction,
      resource: data.resource ?? data.fallbackResource,
      spaceId: data.spaceId ?? null,
      documentId: data.documentId ?? null,
      decision: "allowed",
      summary: data.summary ?? null,
      beforeRevisionId: data.beforeRevisionId ?? null,
      afterRevisionId: data.afterRevisionId ?? null,
      diffPreview: data.diffPreview ?? null,
      reversible: data.reversible ?? false,
      irreversibleReason: data.irreversibleReason ?? null,
      batchId: data.batchId !== undefined ? data.batchId : fallbackBatchId,
      executionMode: data.executionMode ?? fallbackMode,
    }).catch(() => {});
  }

  /**
   * Records a dedicated audit event (using the active transport if inside REST/MCP) and marks
   * the active request capture as already recorded to avoid duplicate middleware rows.
   */
  async recordCapturedEvent(
    principal: Principal,
    input: Omit<
      CreateAuditLogInput,
      "principalKind" | "tokenId" | "tokenName" | "transport" | "decision"
    > & {
      readonly decision?: AuditDecision | undefined;
    },
  ): Promise<AuditLogRecord> {
    const { batchId, executionMode } = this.ensureActiveBatchContext(principal);
    const active = this.captureStorage.getStore();
    const transport = active?.transport ?? "system";
    if (active) {
      active.recorded = true;
    }
    return this.recordPrincipalEvent(principal, {
      ...input,
      transport,
      decision: input.decision ?? "allowed",
      batchId: input.batchId !== undefined ? input.batchId : batchId,
      executionMode: input.executionMode ?? executionMode,
    });
  }

  async record(workspaceId: WorkspaceId, input: CreateAuditLogInput): Promise<AuditLogRecord> {
    return this.auditRepo.createAuditLog(workspaceId, input);
  }

  async recordPrincipalEvent(
    principal: Principal,
    input: Omit<CreateAuditLogInput, "principalKind" | "tokenId" | "tokenName">,
  ): Promise<AuditLogRecord> {
    const active = this.captureStorage.getStore();
    const batchStore = this.batchContextStorage.getStore();
    const resolvedBatchId =
      input.batchId !== undefined
        ? input.batchId
        : (active?.batchId ?? batchStore?.batchId ?? null);
    const resolvedMode: ExecutionMode =
      input.executionMode ??
      active?.executionMode ??
      batchStore?.executionMode ??
      (principal.kind === "token"
        ? deriveQuietGovernanceSummary(principal.scope).mode
        : "autonomous");

    return this.auditRepo.createAuditLog(principal.workspaceId, {
      principalKind: principal.kind,
      tokenId: principal.kind === "token" ? principal.tokenId : null,
      tokenName: principal.kind === "token" ? principal.tokenName : null,
      ...input,
      batchId: resolvedBatchId,
      executionMode: resolvedMode,
    });
  }

  async listLogs(
    principal: Principal,
    query?: ListAuditLogsOptions,
  ): Promise<readonly AuditLogRecord[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    return this.auditRepo.listAuditLogs(principal.workspaceId, query);
  }

  async listBatchSummaries(
    principal: Principal,
    limit = 20,
  ): Promise<readonly AuditBatchDigestSummary[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    const recent = await this.auditRepo.listAuditLogs(principal.workspaceId, {
      decision: "allowed",
      limit: 500,
      offset: 0,
    });

    interface MutableGroup {
      readonly batchId: AuditBatchId;
      executionMode: ExecutionMode;
      readonly tokenId: AuditBatchDigestSummary["tokenId"];
      readonly tokenName: AuditBatchDigestSummary["tokenName"];
      createdAt: string;
      updatedAt: string;
      readonly documentIds: Set<DocumentId>;
      mutationCount: number;
      reversible: boolean;
      reversedCount: number;
      readonly summaries: string[];
    }

    const groups = new Map<string, MutableGroup>();
    for (const entry of recent) {
      if (!entry.batchId) continue;
      if (entry.action === "audit.rollback" || entry.action === "audit.batch_rollback") continue;
      if (!entry.documentId && !entry.reversible) continue;
      let grp = groups.get(entry.batchId);
      if (!grp) {
        grp = {
          batchId: entry.batchId,
          executionMode: entry.executionMode ?? "autonomous",
          tokenId: entry.tokenId,
          tokenName: entry.tokenName,
          createdAt: entry.createdAt,
          updatedAt: entry.createdAt,
          documentIds: new Set<DocumentId>(),
          mutationCount: 0,
          reversible: false,
          reversedCount: 0,
          summaries: [],
        };
        groups.set(entry.batchId, grp);
      }
      if (entry.createdAt < grp.createdAt) grp.createdAt = entry.createdAt;
      if (entry.createdAt > grp.updatedAt) grp.updatedAt = entry.createdAt;
      if (entry.documentId) grp.documentIds.add(entry.documentId);
      grp.mutationCount += 1;
      if (entry.reversible && !entry.reversedByAuditId) grp.reversible = true;
      if (entry.reversedByAuditId) grp.reversedCount += 1;
      if (entry.summary && grp.summaries.length < 3 && !grp.summaries.includes(entry.summary)) {
        grp.summaries.push(entry.summary);
      }
    }

    return [...groups.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map((grp) => ({
        batchId: grp.batchId,
        executionMode: grp.executionMode,
        tokenId: grp.tokenId,
        tokenName: grp.tokenName,
        createdAt: grp.createdAt,
        updatedAt: grp.updatedAt,
        documentIds: [...grp.documentIds],
        mutationCount: grp.mutationCount,
        reversible: grp.reversible,
        reversed: grp.mutationCount > 0 && grp.reversedCount >= grp.mutationCount,
        summary: grp.summaries.join(" · ") || `${grp.mutationCount} mutations`,
      }));
  }
}
