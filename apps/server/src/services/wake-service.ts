import { AsyncLocalStorage } from "node:async_hooks";
import {
  applyUnownedWakeTransferNotice,
  asDocumentId,
  createId,
  DEFAULT_HOST_KIND,
  evaluateScopeAccess,
  formatWakePromptText,
  ID_PREFIXES,
  InkadeError,
  normalizeHostKind,
  pickLeastTrustedWakeSender,
  type AckWakeEventInput,
  type AdeKind,
  type AdeThreadBinding,
  type BridgeSessionRecord,
  type DocumentId,
  type DocumentRecord,
  type HeartbeatBridgeSessionInput,
  type HighlightId,
  type ListBridgeSessionsInput,
  type OutlineNodeId,
  type PollWakeEventsInput,
  type ThreadBindingId,
  type WakeEnvelope,
  type WakeEventId,
  type WakeReason,
  type WakeSenderKind,
  type WakeSourcePayload,
  type WorkspaceId,
} from "@inkade/core";
import type {
  DocumentRepo,
  SpaceRepo,
  ThreadBindingRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export const WAKE_COALESCE_WINDOW_MS = 1_500;
export const WAKE_RATE_LIMIT_MAX_PER_MIN = 20;
export const WAKE_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_WAIT_TIMEOUT_MS = 25_000;
const MAX_WAIT_TIMEOUT_MS = 30_000;

export interface BridgeRequestContext {
  readonly host?: AdeKind | undefined;
  readonly sessionId?: string | undefined;
  readonly workspacePath?: string | undefined;
}

export interface WakeServiceRepos {
  readonly threadBindingRepo: ThreadBindingRepo;
  readonly documentRepo: DocumentRepo;
  readonly spaceRepo: SpaceRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
}

export interface EnqueueWakeInput {
  readonly documentId: DocumentId;
  readonly bindingId?: ThreadBindingId | null | undefined;
  readonly bridgeSessionId?: string | null | undefined;
  readonly targetAdeKind?: AdeKind | null | undefined;
  readonly targetExternalThreadId?: string | null | undefined;
  readonly targetWorkspacePath?: string | null | undefined;
  readonly nodeId?: OutlineNodeId | null | undefined;
  readonly highlightId?: HighlightId | null | undefined;
  readonly reason: WakeReason;
  readonly senderKind?: WakeSenderKind | undefined;
  readonly senderName?: string | undefined;
  readonly summary: string;
  readonly messageText: string;
}

const FEEDBACK_START_TAG = "<inkade_wake_feedback>\n";
const FEEDBACK_END_TAG = "\n</inkade_wake_feedback>";

function extractWakeFeedbackBody(formattedPromptText: string): string {
  const startIdx = formattedPromptText.indexOf(FEEDBACK_START_TAG);
  const endIdx = formattedPromptText.lastIndexOf(FEEDBACK_END_TAG);
  if (startIdx >= 0 && endIdx > startIdx) {
    return formattedPromptText
      .slice(startIdx + FEEDBACK_START_TAG.length, endIdx)
      .replace(/&lt;(\/?inkade_wake_feedback)(?=[\s>/])/gi, "<$1");
  }
  return formattedPromptText;
}

function readHeaderValue(
  headers: Headers | Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Readonly<Record<string, string | undefined>>;
  return record[name] ?? record[name.toLowerCase()];
}

export class WakeService {
  private readonly bridgeContextStorage = new AsyncLocalStorage<BridgeRequestContext | undefined>();
  private readonly recentDispatchMsByTarget = new Map<string, number[]>();
  private readonly workspaceWaiters = new Map<string, Set<() => void>>();

  constructor(
    private readonly repos: WakeServiceRepos,
    private readonly sseHub: SseHub,
  ) {}

  parseBridgeHeaders(
    headers: Headers | Readonly<Record<string, string | undefined>>,
  ): BridgeRequestContext | undefined {
    const rawHost = readHeaderValue(headers, "x-inkade-host")?.trim();
    const rawSessionId = readHeaderValue(headers, "x-inkade-session-id")?.trim();
    const rawWorkspacePath = readHeaderValue(headers, "x-inkade-workspace")?.trim();
    if (!rawHost && !rawSessionId && !rawWorkspacePath) {
      return undefined;
    }
    return {
      ...(rawHost ? { host: normalizeHostKind(rawHost) } : {}),
      ...(rawSessionId ? { sessionId: rawSessionId } : {}),
      ...(rawWorkspacePath ? { workspacePath: rawWorkspacePath } : {}),
    };
  }

  runWithBridgeContext<T>(
    context: BridgeRequestContext | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.bridgeContextStorage.run(context, fn);
  }

  getBridgeContext(): BridgeRequestContext | undefined {
    return this.bridgeContextStorage.getStore();
  }

  private rateLimitKey(
    workspaceId: WorkspaceId,
    bindingId: ThreadBindingId | string | null | undefined,
    documentId: DocumentId,
  ): string {
    return bindingId
      ? `${workspaceId}:bnd:${bindingId}`
      : `${workspaceId}:doc:${documentId}`;
  }

  private pruneAndCountMemoryDispatches(key: string, nowMs: number): number {
    const cutoff = nowMs - WAKE_RATE_LIMIT_WINDOW_MS;
    const entries = this.recentDispatchMsByTarget.get(key);
    if (!entries || entries.length === 0) return 0;
    const recent = entries.filter((ts) => ts >= cutoff);
    if (recent.length === 0) {
      this.recentDispatchMsByTarget.delete(key);
      return 0;
    }
    if (recent.length !== entries.length) {
      this.recentDispatchMsByTarget.set(key, recent);
    }
    return recent.length;
  }

  private recordMemoryDispatch(key: string, nowMs: number): void {
    const cutoff = nowMs - WAKE_RATE_LIMIT_WINDOW_MS;
    const existing = this.recentDispatchMsByTarget.get(key) ?? [];
    const recent = existing.filter((ts) => ts >= cutoff);
    recent.push(nowMs);
    this.recentDispatchMsByTarget.set(key, recent);
  }

  async assertRateLimitAvailable(
    workspaceId: WorkspaceId,
    target: {
      readonly bindingId?: ThreadBindingId | string | null | undefined;
      readonly documentId: DocumentId;
    },
    nowMs: number = Date.now(),
  ): Promise<void> {
    const key = this.rateLimitKey(workspaceId, target.bindingId, target.documentId);
    const memoryCount = this.pruneAndCountMemoryDispatches(key, nowMs);
    if (memoryCount >= WAKE_RATE_LIMIT_MAX_PER_MIN) {
      throw new InkadeError(
        "RATE_LIMITED",
        `Wake rate limit exceeded (max ${WAKE_RATE_LIMIT_MAX_PER_MIN} per minute). Please wait before sending again.`,
        { limit: WAKE_RATE_LIMIT_MAX_PER_MIN, windowMs: WAKE_RATE_LIMIT_WINDOW_MS },
      );
    }

    const sinceIso = new Date(nowMs - WAKE_RATE_LIMIT_WINDOW_MS).toISOString();
    const dbCount = await this.repos.threadBindingRepo.countRecentWakeEvents(workspaceId, {
      bindingId: target.bindingId ?? null,
      documentId: target.documentId,
      sinceIso,
    });
    if (Math.max(memoryCount, dbCount) >= WAKE_RATE_LIMIT_MAX_PER_MIN) {
      throw new InkadeError(
        "RATE_LIMITED",
        `Wake rate limit exceeded (max ${WAKE_RATE_LIMIT_MAX_PER_MIN} per minute). Please wait before sending again.`,
        { limit: WAKE_RATE_LIMIT_MAX_PER_MIN, windowMs: WAKE_RATE_LIMIT_WINDOW_MS },
      );
    }
  }

  private notifyWorkspaceWaiters(workspaceId: WorkspaceId): void {
    const waiters = this.workspaceWaiters.get(workspaceId);
    if (!waiters || waiters.size === 0) return;
    for (const notify of [...waiters]) {
      notify();
    }
  }

  private publishWakeEnqueued(
    doc: Pick<DocumentRecord, "id" | "spaceId" | "kind" | "tags">,
    principal: Pick<Principal, "workspaceId" | "actorType">,
    wake: WakeEnvelope,
  ): void {
    this.notifyWorkspaceWaiters(principal.workspaceId);
    this.sseHub.publish({
      type: "wake.enqueued",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { wake },
    });
  }

  async enqueueWake(principal: Principal, input: EnqueueWakeInput): Promise<WakeEnvelope> {
    const [doc, allSpaces] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, input.documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${input.documentId}" not found`);
    }

    assertScope(
      principal.scope,
      "append",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    let resolvedBinding: AdeThreadBinding | null = null;
    if (input.bindingId) {
      resolvedBinding = await this.repos.threadBindingRepo.getThreadBindingById(
        principal.workspaceId,
        input.bindingId,
      );
      if (!resolvedBinding) {
        throw new InkadeError("NOT_FOUND", `Thread binding "${input.bindingId}" not found`);
      }
      if (resolvedBinding.documentId !== doc.id) {
        throw new InkadeError(
          "VALIDATION_ERROR",
          `Thread binding "${input.bindingId}" does not belong to document "${doc.id}"`,
        );
      }
    }

    let resolvedBridgeSession: BridgeSessionRecord | null = null;
    if (input.bridgeSessionId && !resolvedBinding) {
      resolvedBridgeSession = await this.repos.threadBindingRepo.getBridgeSessionById(
        principal.workspaceId,
        input.bridgeSessionId,
      );
      if (!resolvedBridgeSession) {
        throw new InkadeError("NOT_FOUND", `Bridge session "${input.bridgeSessionId}" not found`);
      }
      resolvedBinding = await this.repos.threadBindingRepo.upsertThreadBinding(
        principal.workspaceId,
        {
          documentId: doc.id,
          nodeId: input.nodeId ?? null,
          adeKind: resolvedBridgeSession.adeKind,
          externalWorkspaceId: resolvedBridgeSession.workspacePath,
          externalThreadId: resolvedBridgeSession.externalThreadId,
          title: doc.title,
          status: "running",
          lastSummary: input.summary.slice(0, 120),
          unreadResult: false,
        },
      );
    }

    const effectiveBindingId = resolvedBinding?.id ?? null;
    const nowMs = Date.now();
    await this.assertRateLimitAvailable(
      principal.workspaceId,
      { bindingId: effectiveBindingId, documentId: doc.id },
      nowMs,
    );

    const targetAdeKind =
      input.targetAdeKind ??
      resolvedBinding?.adeKind ??
      resolvedBridgeSession?.adeKind ??
      null;
    const targetExternalThreadId =
      input.targetExternalThreadId ??
      resolvedBinding?.externalThreadId ??
      resolvedBridgeSession?.externalThreadId ??
      null;
    const targetWorkspacePath =
      input.targetWorkspacePath ??
      resolvedBridgeSession?.workspacePath ??
      resolvedBinding?.externalWorkspaceId ??
      null;

    // Never allow an API token principal to forge "owner" sender trust.
    let senderKind: WakeSenderKind =
      input.senderKind ?? (principal.kind === "user" ? "owner" : "system");
    if (principal.kind === "token" && senderKind === "owner") {
      senderKind = "system";
    }
    const senderName =
      input.senderName?.trim() ||
      (principal.kind === "user" ? "Owner" : principal.tokenName || "Agent");

    const wakeId = createId(ID_PREFIXES.wakeEvent);
    const createdAt = new Date(nowMs).toISOString();
    const summary = input.summary.trim().slice(0, 120) || `Wake (${input.reason})`;

    const formattedPromptText = formatWakePromptText({
      wakeId,
      reason: input.reason,
      senderKind,
      senderName,
      documentId: doc.id,
      documentTitle: doc.title,
      summary,
      messageText: input.messageText,
      createdAt,
    });

    const sourcePayload: WakeSourcePayload = {
      kind: "inkade.wake.v1",
      wakeId,
      reason: input.reason,
      senderKind,
      senderName,
      documentId: doc.id,
      documentTitle: doc.title,
      ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
      ...(input.highlightId !== undefined ? { highlightId: input.highlightId } : {}),
      ...(effectiveBindingId !== null ? { bindingId: effectiveBindingId } : {}),
      summary,
      createdAt,
    };

    const canCoalesce = input.reason === "comment_sent" || input.reason === "steering";
    const dedupeKey = canCoalesce
      ? `${effectiveBindingId ?? `doc:${doc.id}`}:${targetExternalThreadId ?? "unowned"}`
      : null;
    const coalesceSinceIso = canCoalesce
      ? new Date(nowMs - WAKE_COALESCE_WINDOW_MS).toISOString()
      : null;

    this.recordMemoryDispatch(
      this.rateLimitKey(principal.workspaceId, effectiveBindingId, doc.id),
      nowMs,
    );

    const { wake } = await this.repos.threadBindingRepo.enqueueOrCoalesceWakeEvent(
      principal.workspaceId,
      {
        id: wakeId,
        bindingId: effectiveBindingId,
        documentId: doc.id,
        targetAdeKind,
        targetExternalThreadId,
        targetWorkspacePath,
        senderKind,
        senderName,
        reason: input.reason,
        summary,
        formattedPromptText,
        sourcePayload,
        dedupeKey,
        coalesceSinceIso,
        createdAt,
        onCoalesce: (existing) => {
          const mergedSenderKind = pickLeastTrustedWakeSender(existing.senderKind, senderKind);
          const mergedSenderName =
            mergedSenderKind === senderKind && senderKind !== existing.senderKind
              ? senderName
              : existing.senderName === senderName
                ? senderName
                : `${existing.senderName}, ${senderName}`.slice(0, 80);
          const previousBody = extractWakeFeedbackBody(existing.formattedPromptText);
          const combinedMessageText = `${previousBody}\n\n${input.messageText.trim()}`.trim();
          const mergedSummary = summary;
          const mergedPromptText = formatWakePromptText({
            wakeId: existing.id,
            reason: input.reason,
            senderKind: mergedSenderKind,
            senderName: mergedSenderName,
            documentId: doc.id,
            documentTitle: doc.title,
            summary: mergedSummary,
            messageText: combinedMessageText,
            createdAt: existing.createdAt,
          });
          const mergedSourcePayload: WakeSourcePayload = {
            ...existing.sourcePayload,
            reason: input.reason,
            senderKind: mergedSenderKind,
            senderName: mergedSenderName,
            summary: mergedSummary,
          };
          return {
            senderKind: mergedSenderKind,
            senderName: mergedSenderName,
            summary: mergedSummary,
            formattedPromptText: mergedPromptText,
            sourcePayload: mergedSourcePayload,
          };
        },
      },
    );

    this.publishWakeEnqueued(doc, principal, wake);
    return wake;
  }

  async heartbeatBridgeSession(
    principal: Principal,
    input: HeartbeatBridgeSessionInput,
  ): Promise<{ readonly session: BridgeSessionRecord; readonly created: boolean }> {
    const result = await this.repos.threadBindingRepo.upsertBridgeSession(
      principal.workspaceId,
      input,
    );
    this.sseHub.publish({
      type: "bridge.session.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: {
        action: result.session.status === "offline" ? "offline" : "heartbeat",
        session: result.session,
      },
    });
    return result;
  }

  async listBridgeSessions(
    principal: Principal,
    options?: ListBridgeSessionsInput,
  ): Promise<readonly BridgeSessionRecord[]> {
    return this.repos.threadBindingRepo.listBridgeSessions(principal.workspaceId, options);
  }

  async pollWakeEvents(
    principal: Principal,
    input: PollWakeEventsInput = {},
  ): Promise<readonly WakeEnvelope[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );

    if (input.documentId) {
      const doc = await this.repos.documentRepo.getDocumentById(
        principal.workspaceId,
        input.documentId,
      );
      if (!doc || doc.trashedAt !== null) {
        throw new InkadeError("NOT_FOUND", `Document "${input.documentId}" not found`);
      }
      assertScope(
        principal.scope,
        "read",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      );
    }

    if (input.bindingId) {
      const binding = await this.repos.threadBindingRepo.getThreadBindingById(
        principal.workspaceId,
        input.bindingId,
      );
      if (!binding) {
        throw new InkadeError("NOT_FOUND", `Thread binding "${input.bindingId}" not found`);
      }
      const doc = await this.repos.documentRepo.getDocumentById(
        principal.workspaceId,
        binding.documentId,
      );
      if (!doc || doc.trashedAt !== null) {
        throw new InkadeError("NOT_FOUND", `Document "${binding.documentId}" not found`);
      }
      assertScope(
        principal.scope,
        "read",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      );
    }

    const ctx = this.getBridgeContext();
    const candidates = await this.repos.threadBindingRepo.listPendingWakeEvents(
      principal.workspaceId,
      {
        adeKind: input.adeKind ?? ctx?.host,
        externalThreadId: input.externalThreadId ?? ctx?.sessionId,
        workspacePath: input.workspacePath ?? ctx?.workspacePath,
        bindingId: input.bindingId,
        documentId: input.documentId,
        limit: input.limit ?? 50,
      },
    );

    if (candidates.length === 0) {
      return [];
    }

    const docCache = new Map<DocumentId, DocumentRecord | null>();
    const uniqueDocIds = [...new Set(candidates.map((w) => w.documentId))];
    await Promise.all(
      uniqueDocIds.map(async (docId) => {
        const doc = await this.repos.documentRepo.getDocumentById(principal.workspaceId, docId);
        docCache.set(docId, doc);
      }),
    );

    const authorizedIds: WakeEventId[] = [];
    for (const wake of candidates) {
      const doc = docCache.get(wake.documentId);
      if (!doc || doc.trashedAt !== null) continue;
      const access = evaluateScopeAccess(
        principal.scope,
        "read",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      );
      if (access.allowed) {
        authorizedIds.push(wake.id);
      }
    }

    if (authorizedIds.length === 0) {
      return [];
    }

    return this.repos.threadBindingRepo.claimPendingWakeEvents(
      principal.workspaceId,
      authorizedIds,
      { markDelivered: input.markDelivered },
    );
  }

  async waitWakeEvents(
    principal: Principal,
    input: PollWakeEventsInput = {},
    signal?: AbortSignal,
  ): Promise<readonly WakeEnvelope[]> {
    const immediate = await this.pollWakeEvents(principal, input);
    if (immediate.length > 0) {
      return immediate;
    }

    const timeoutMs = Math.min(
      Math.max(input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS, 0),
      MAX_WAIT_TIMEOUT_MS,
    );
    if (timeoutMs <= 0 || signal?.aborted) {
      return [];
    }

    const deadline = Date.now() + timeoutMs;
    while (!signal?.aborted) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }

      await new Promise<void>((resolve) => {
        let settled = false;
        const existingWaiterSet = this.workspaceWaiters.get(principal.workspaceId);
        const waiterSet = existingWaiterSet ?? new Set<() => void>();
        if (!existingWaiterSet) {
          this.workspaceWaiters.set(principal.workspaceId, waiterSet);
        }

        const cleanup = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          waiterSet.delete(onSignal);
          if (waiterSet.size === 0) {
            this.workspaceWaiters.delete(principal.workspaceId);
          }
          signal?.removeEventListener("abort", onSignal);
          resolve();
        };

        const onSignal = () => {
          cleanup();
        };

        const timer = setTimeout(cleanup, remaining);
        waiterSet.add(onSignal);
        signal?.addEventListener("abort", onSignal, { once: true });
      });

      if (signal?.aborted) {
        return [];
      }

      const polled = await this.pollWakeEvents(principal, input);
      if (polled.length > 0) {
        return polled;
      }
    }

    return [];
  }

  async ackWakeEvent(
    principal: Principal,
    wakeId: WakeEventId,
    input: AckWakeEventInput,
  ): Promise<WakeEnvelope> {
    const existing = await this.repos.threadBindingRepo.getWakeEventById(
      principal.workspaceId,
      wakeId,
    );
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `Wake event "${wakeId}" not found`);
    }

    const [doc, allSpaces] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, existing.documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${existing.documentId}" not found`);
    }

    assertScope(
      principal.scope,
      "read",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    const acked = await this.repos.threadBindingRepo.ackWakeEvent(
      principal.workspaceId,
      wakeId,
      input,
    );

    this.sseHub.publish({
      type: "wake.acked",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: {
        wakeId: acked.id,
        bindingId: acked.bindingId,
        documentId: acked.documentId,
        deliveryStatus: acked.deliveryStatus,
        ackedAt: acked.ackedAt,
      },
    });

    return acked;
  }

  async claimUnownedForBinding(
    principal: Principal,
    binding: AdeThreadBinding,
  ): Promise<readonly WakeEnvelope[]> {
    const hasUnowned = await this.repos.threadBindingRepo.hasPendingUnownedWakeEvents(
      principal.workspaceId,
      binding.documentId,
    );
    if (!hasUnowned) {
      return [];
    }

    const doc = await this.repos.documentRepo.getDocumentById(
      principal.workspaceId,
      binding.documentId,
    );
    if (!doc || doc.trashedAt !== null) {
      return [];
    }

    const now = new Date();
    const transferred = await this.repos.threadBindingRepo.claimUnownedWakeEvents(
      principal.workspaceId,
      {
        documentId: doc.id,
        bindingId: binding.id,
        adeKind: binding.adeKind,
        externalThreadId: binding.externalThreadId,
        workspacePath: binding.externalWorkspaceId,
        fallbackBindingTitle: doc.title,
        buildTransferPrompt: (wake) =>
          applyUnownedWakeTransferNotice(wake.formattedPromptText, wake.reason, wake.createdAt, now),
      },
    );

    for (const wake of transferred) {
      this.publishWakeEnqueued(doc, principal, wake);
    }
    return transferred;
  }

  async claimUnownedForDocumentWrite(
    principal: Principal,
    documentId: DocumentId,
  ): Promise<readonly WakeEnvelope[]> {
    const ctx = this.getBridgeContext();
    if (principal.kind !== "token" && !ctx?.sessionId) {
      return [];
    }

    const hasUnowned = await this.repos.threadBindingRepo.hasPendingUnownedWakeEvents(
      principal.workspaceId,
      documentId,
    );
    if (!hasUnowned) {
      return [];
    }

    const doc = await this.repos.documentRepo.getDocumentById(
      principal.workspaceId,
      documentId,
    );
    if (!doc || doc.trashedAt !== null) {
      return [];
    }

    const adeKind = ctx?.host ?? DEFAULT_HOST_KIND;
    const externalThreadId =
      ctx?.sessionId ??
      (principal.kind === "token" ? `token:${principal.tokenId}` : `user:${principal.userId}`);
    const now = new Date();

    const transferred = await this.repos.threadBindingRepo.claimUnownedWakeEvents(
      principal.workspaceId,
      {
        documentId: asDocumentId(doc.id),
        bindingId: null,
        adeKind,
        externalThreadId,
        workspacePath: ctx?.workspacePath ?? null,
        fallbackBindingTitle: doc.title,
        buildTransferPrompt: (wake) =>
          applyUnownedWakeTransferNotice(wake.formattedPromptText, wake.reason, wake.createdAt, now),
      },
    );

    for (const wake of transferred) {
      this.publishWakeEnqueued(doc, principal, wake);
    }
    return transferred;
  }
}
