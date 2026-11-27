import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  asBridgeSessionId,
  asDocumentId,
  asThreadBindingId,
  asWakeEventId,
  asWorkspaceId,
  createId,
  ID_PREFIXES,
  InkadeError,
  jsonRecordSchema,
  normalizeHostKind,
  parseJsonWithSchema,
  wakeSourcePayloadSchema,
  type AckWakeEventInput,
  type BridgeSessionRecord,
  type BridgeSessionStatus,
  type HeartbeatBridgeSessionInput,
  type ListBridgeSessionsInput,
  type WakeDeliveryStatus,
  type WakeEnvelope,
  type WakeReason,
  type WakeSenderKind,
  type WakeSourcePayload,
} from "@inkade/core";
import {
  adeThreadBindings,
  bridgeSessions,
  threadWakeEvents,
} from "../../schema/sqlite.ts";
import type {
  ClaimUnownedWakeEventsInput,
  EnqueueWakeEventRepoInput,
  ListPendingWakeEventsOptions,
} from "../ports/thread-binding.port.ts";
import { nowIso, type SqliteRepoContext } from "./helpers.ts";

function buildFallbackSourcePayload(row: typeof threadWakeEvents.$inferSelect): WakeSourcePayload {
  return {
    kind: "inkade.wake.v1",
    wakeId: asWakeEventId(row.id),
    reason: row.reason as WakeReason,
    senderKind: row.senderKind as WakeSenderKind,
    senderName: row.senderName,
    documentId: asDocumentId(row.documentId),
    documentTitle: row.documentId,
    bindingId: row.bindingId ? asThreadBindingId(row.bindingId) : null,
    summary: row.summary,
    createdAt: row.createdAt,
  };
}

export function mapWakeEventRow(row: typeof threadWakeEvents.$inferSelect): WakeEnvelope {
  return {
    id: asWakeEventId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    bindingId: row.bindingId ? asThreadBindingId(row.bindingId) : null,
    documentId: asDocumentId(row.documentId),
    targetAdeKind: row.targetAdeKind ? normalizeHostKind(row.targetAdeKind) : null,
    targetExternalThreadId: row.targetExternalThreadId,
    targetWorkspacePath: row.targetWorkspacePath,
    senderKind: row.senderKind as WakeSenderKind,
    senderName: row.senderName,
    reason: row.reason as WakeReason,
    summary: row.summary,
    formattedPromptText: row.formattedPromptText,
    sourcePayload: parseJsonWithSchema(
      row.sourcePayloadJson,
      wakeSourcePayloadSchema,
      buildFallbackSourcePayload(row),
    ),
    deliveryStatus: row.deliveryStatus as WakeDeliveryStatus,
    attemptCount: row.attemptCount,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
    ackedAt: row.ackedAt,
  };
}

export function mapBridgeSessionRow(
  row: typeof bridgeSessions.$inferSelect,
): BridgeSessionRecord {
  return {
    id: asBridgeSessionId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    harnessName: row.harnessName,
    adeKind: normalizeHostKind(row.adeKind),
    externalThreadId: row.externalThreadId,
    workspacePath: row.workspacePath,
    pid: row.pid,
    capabilities: parseJsonWithSchema(row.capabilitiesJson, jsonRecordSchema, {}),
    status: (row.status as BridgeSessionStatus) || "online",
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  };
}

export function countRecentWakeEventsSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  filter: {
    readonly bindingId?: string | null | undefined;
    readonly documentId?: string | undefined;
    readonly sinceIso: string;
  },
): number {
  const conditions = [
    eq(threadWakeEvents.workspaceId, workspaceId),
    gte(threadWakeEvents.createdAt, filter.sinceIso),
  ];
  if (filter.bindingId) {
    conditions.push(eq(threadWakeEvents.bindingId, filter.bindingId));
  } else if (filter.documentId) {
    conditions.push(eq(threadWakeEvents.documentId, filter.documentId));
    conditions.push(isNull(threadWakeEvents.bindingId));
  }

  const row = ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(threadWakeEvents)
    .where(and(...conditions))
    .get();
  return Number(row?.count ?? 0);
}

export function enqueueOrCoalesceWakeEventSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  input: EnqueueWakeEventRepoInput,
): { readonly wake: WakeEnvelope; readonly coalesced: boolean } {
  return ctx.tx.runSyncAtomic(() => {
    const canCoalesce =
      Boolean(input.dedupeKey) &&
      Boolean(input.coalesceSinceIso) &&
      (input.reason === "comment_sent" || input.reason === "steering");

    if (canCoalesce && input.dedupeKey && input.coalesceSinceIso) {
      const existing = ctx.db
        .select()
        .from(threadWakeEvents)
        .where(
          and(
            eq(threadWakeEvents.workspaceId, workspaceId),
            eq(threadWakeEvents.dedupeKey, input.dedupeKey),
            eq(threadWakeEvents.deliveryStatus, "pending"),
            gte(threadWakeEvents.createdAt, input.coalesceSinceIso),
            inArray(threadWakeEvents.reason, ["comment_sent", "steering"]),
          ),
        )
        .orderBy(desc(threadWakeEvents.createdAt))
        .limit(1)
        .get();

      if (existing) {
        const mappedExisting = mapWakeEventRow(existing);
        const coalescedFields = input.onCoalesce
          ? input.onCoalesce(mappedExisting)
          : {
              senderKind: input.senderKind,
              senderName: input.senderName,
              summary: input.summary,
              formattedPromptText: input.formattedPromptText,
              sourcePayload: input.sourcePayload,
            };

        ctx.db
          .update(threadWakeEvents)
          .set({
            senderKind: coalescedFields.senderKind,
            senderName: coalescedFields.senderName,
            summary: coalescedFields.summary,
            formattedPromptText: coalescedFields.formattedPromptText,
            sourcePayloadJson: JSON.stringify(coalescedFields.sourcePayload),
          })
          .where(eq(threadWakeEvents.id, existing.id))
          .run();

        const refreshed = ctx.db
          .select()
          .from(threadWakeEvents)
          .where(eq(threadWakeEvents.id, existing.id))
          .get();
        if (!refreshed) {
          throw new InkadeError("INTERNAL_ERROR", "Failed to read coalesced wake event");
        }
        return { wake: mapWakeEventRow(refreshed), coalesced: true };
      }
    }

    const id = input.id ?? createId(ID_PREFIXES.wakeEvent);
    const createdAt = input.createdAt ?? nowIso();
    const normalizedPayload: WakeSourcePayload = {
      ...input.sourcePayload,
      wakeId: asWakeEventId(id),
      createdAt,
    };

    const row: typeof threadWakeEvents.$inferSelect = {
      id,
      workspaceId,
      bindingId: input.bindingId,
      documentId: input.documentId,
      targetAdeKind: input.targetAdeKind,
      targetExternalThreadId: input.targetExternalThreadId,
      targetWorkspacePath: input.targetWorkspacePath,
      senderKind: input.senderKind,
      senderName: input.senderName,
      reason: input.reason,
      summary: input.summary,
      formattedPromptText: input.formattedPromptText,
      sourcePayloadJson: JSON.stringify(normalizedPayload),
      deliveryStatus: "pending",
      dedupeKey: input.dedupeKey,
      attemptCount: 0,
      lastError: null,
      createdAt,
      deliveredAt: null,
      ackedAt: null,
    };
    ctx.db.insert(threadWakeEvents).values(row).run();
    return { wake: mapWakeEventRow(row), coalesced: false };
  });
}

export function listPendingWakeEventsSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  options?: ListPendingWakeEventsOptions,
): readonly WakeEnvelope[] {
  const conditions = [
    eq(threadWakeEvents.workspaceId, workspaceId),
    eq(threadWakeEvents.deliveryStatus, "pending"),
  ];
  if (options?.bindingId) {
    conditions.push(eq(threadWakeEvents.bindingId, options.bindingId));
  }
  if (options?.documentId) {
    conditions.push(eq(threadWakeEvents.documentId, options.documentId));
  }
  if (options?.externalThreadId) {
    conditions.push(eq(threadWakeEvents.targetExternalThreadId, options.externalThreadId));
  }
  if (options?.adeKind && options.adeKind !== "any") {
    const cond = or(
      eq(threadWakeEvents.targetAdeKind, options.adeKind),
      eq(threadWakeEvents.targetAdeKind, "any"),
      isNull(threadWakeEvents.targetAdeKind),
    );
    if (cond) {
      conditions.push(cond);
    }
  }
  if (options?.workspacePath) {
    const cond = or(
      eq(threadWakeEvents.targetWorkspacePath, options.workspacePath),
      isNull(threadWakeEvents.targetWorkspacePath),
    );
    if (cond) {
      conditions.push(cond);
    }
  }

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const rows = ctx.db
    .select()
    .from(threadWakeEvents)
    .where(and(...conditions))
    .orderBy(asc(threadWakeEvents.createdAt))
    .limit(limit)
    .all();

  return rows.map(mapWakeEventRow);
}

export function claimPendingWakeEventsSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  wakeIds: readonly string[],
  options?: { readonly markDelivered?: boolean | undefined },
): readonly WakeEnvelope[] {
  if (wakeIds.length === 0) return [];
  const markDelivered = options?.markDelivered !== false;

  return ctx.tx.runSyncAtomic(() => {
    const pendingRows = ctx.db
      .select()
      .from(threadWakeEvents)
      .where(
        and(
          eq(threadWakeEvents.workspaceId, workspaceId),
          inArray(threadWakeEvents.id, [...wakeIds]),
          eq(threadWakeEvents.deliveryStatus, "pending"),
        ),
      )
      .orderBy(asc(threadWakeEvents.createdAt))
      .all();

    if (pendingRows.length === 0) {
      return [];
    }

    if (!markDelivered) {
      return pendingRows.map(mapWakeEventRow);
    }

    const ts = nowIso();
    const claimedIds = pendingRows.map((row) => row.id);
    ctx.db
      .update(threadWakeEvents)
      .set({
        deliveryStatus: "delivered",
        deliveredAt: ts,
        attemptCount: sql`${threadWakeEvents.attemptCount} + 1`,
      })
      .where(
        and(
          eq(threadWakeEvents.workspaceId, workspaceId),
          inArray(threadWakeEvents.id, claimedIds),
          eq(threadWakeEvents.deliveryStatus, "pending"),
        ),
      )
      .run();

    const refreshed = ctx.db
      .select()
      .from(threadWakeEvents)
      .where(
        and(
          eq(threadWakeEvents.workspaceId, workspaceId),
          inArray(threadWakeEvents.id, claimedIds),
        ),
      )
      .orderBy(asc(threadWakeEvents.createdAt))
      .all();

    return refreshed.map(mapWakeEventRow);
  });
}

export function getWakeEventByIdSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  wakeId: string,
): WakeEnvelope | null {
  const row = ctx.db
    .select()
    .from(threadWakeEvents)
    .where(
      and(
        eq(threadWakeEvents.workspaceId, workspaceId),
        eq(threadWakeEvents.id, wakeId),
      ),
    )
    .get();
  return row ? mapWakeEventRow(row) : null;
}

export function ackWakeEventSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  wakeId: string,
  input: AckWakeEventInput,
): WakeEnvelope {
  return ctx.tx.runSyncAtomic(() => {
    const current = ctx.db
      .select()
      .from(threadWakeEvents)
      .where(
        and(
          eq(threadWakeEvents.workspaceId, workspaceId),
          eq(threadWakeEvents.id, wakeId),
        ),
      )
      .get();
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Wake event "${wakeId}" not found`);
    }

    const status = input.status ?? "acked";
    const ts = nowIso();
    ctx.db
      .update(threadWakeEvents)
      .set({
        deliveryStatus: status,
        ackedAt: status === "acked" ? ts : current.ackedAt,
        lastError: status === "failed" ? (input.error ?? "Delivery failed") : null,
      })
      .where(eq(threadWakeEvents.id, wakeId))
      .run();

    const refreshed = ctx.db
      .select()
      .from(threadWakeEvents)
      .where(eq(threadWakeEvents.id, wakeId))
      .get();
    if (!refreshed) {
      throw new InkadeError("INTERNAL_ERROR", "Failed to read acknowledged wake event");
    }
    return mapWakeEventRow(refreshed);
  });
}

export function hasPendingUnownedWakeEventsSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  documentId: string,
): boolean {
  const row = ctx.db
    .select({ id: threadWakeEvents.id })
    .from(threadWakeEvents)
    .where(
      and(
        eq(threadWakeEvents.workspaceId, workspaceId),
        eq(threadWakeEvents.documentId, documentId),
        isNull(threadWakeEvents.bindingId),
        eq(threadWakeEvents.deliveryStatus, "pending"),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

export function claimUnownedWakeEventsSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  input: ClaimUnownedWakeEventsInput,
): readonly WakeEnvelope[] {
  return ctx.tx.runSyncAtomic(() => {
    const pendingRows = ctx.db
      .select()
      .from(threadWakeEvents)
      .where(
        and(
          eq(threadWakeEvents.workspaceId, workspaceId),
          eq(threadWakeEvents.documentId, input.documentId),
          isNull(threadWakeEvents.bindingId),
          eq(threadWakeEvents.deliveryStatus, "pending"),
        ),
      )
      .orderBy(asc(threadWakeEvents.createdAt))
      .all();

    if (pendingRows.length === 0) {
      return [];
    }

    let resolvedBindingId = input.bindingId;
    if (!resolvedBindingId) {
      const existingBinding = ctx.db
        .select({ id: adeThreadBindings.id })
        .from(adeThreadBindings)
        .where(
          and(
            eq(adeThreadBindings.workspaceId, workspaceId),
            eq(adeThreadBindings.adeKind, input.adeKind),
            eq(adeThreadBindings.externalThreadId, input.externalThreadId),
          ),
        )
        .get();
      if (existingBinding) {
        resolvedBindingId = existingBinding.id;
      } else {
        const ts = nowIso();
        const newBindingId = createId(ID_PREFIXES.threadBinding);
        ctx.db
          .insert(adeThreadBindings)
          .values({
            id: newBindingId,
            workspaceId,
            documentId: input.documentId,
            nodeId: null,
            selectionAnchorJson: null,
            adeKind: input.adeKind,
            externalWorkspaceId: input.workspacePath ?? null,
            externalThreadId: input.externalThreadId,
            deepLink: null,
            title: input.fallbackBindingTitle ?? "Agent Session",
            status: "running",
            lastSummary: "Claimed unowned wake request",
            unreadResult: false,
            lastSyncedAt: ts,
            createdAt: ts,
            runningSince: ts,
            parentBindingId: null,
            progressStepsJson: null,
            pendingApprovalJson: null,
            steeringQueueJson: null,
          })
          .run();
        resolvedBindingId = newBindingId;
      }
    }

    const transferredIds: string[] = [];
    for (const row of pendingRows) {
      const mapped = mapWakeEventRow(row);
      const nextPrompt = input.buildTransferPrompt(mapped);
      const nextSourcePayload: WakeSourcePayload = {
        ...mapped.sourcePayload,
        bindingId: asThreadBindingId(resolvedBindingId),
      };
      ctx.db
        .update(threadWakeEvents)
        .set({
          bindingId: resolvedBindingId,
          targetAdeKind: input.adeKind,
          targetExternalThreadId: input.externalThreadId,
          targetWorkspacePath: input.workspacePath ?? row.targetWorkspacePath,
          formattedPromptText: nextPrompt,
          sourcePayloadJson: JSON.stringify(nextSourcePayload),
        })
        .where(eq(threadWakeEvents.id, row.id))
        .run();
      transferredIds.push(row.id);
    }

    const refreshed = ctx.db
      .select()
      .from(threadWakeEvents)
      .where(inArray(threadWakeEvents.id, transferredIds))
      .orderBy(asc(threadWakeEvents.createdAt))
      .all();

    return refreshed.map(mapWakeEventRow);
  });
}

export function upsertBridgeSessionSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  input: HeartbeatBridgeSessionInput,
): { readonly session: BridgeSessionRecord; readonly created: boolean } {
  return ctx.tx.runSyncAtomic(() => {
    const ts = nowIso();
    const existing = ctx.db
      .select()
      .from(bridgeSessions)
      .where(
        and(
          eq(bridgeSessions.workspaceId, workspaceId),
          eq(bridgeSessions.harnessName, input.harnessName),
          eq(bridgeSessions.externalThreadId, input.externalThreadId),
        ),
      )
      .get();

    if (existing) {
      ctx.db
        .update(bridgeSessions)
        .set({
          adeKind: input.adeKind,
          workspacePath:
            input.workspacePath !== undefined ? input.workspacePath : existing.workspacePath,
          pid: input.pid !== undefined ? input.pid : existing.pid,
          capabilitiesJson:
            input.capabilities !== undefined
              ? JSON.stringify(input.capabilities)
              : existing.capabilitiesJson,
          status: input.status ?? "online",
          lastSeenAt: ts,
        })
        .where(eq(bridgeSessions.id, existing.id))
        .run();

      const refreshed = ctx.db
        .select()
        .from(bridgeSessions)
        .where(eq(bridgeSessions.id, existing.id))
        .get();
      if (!refreshed) {
        throw new InkadeError("INTERNAL_ERROR", "Failed to read updated bridge session");
      }
      return { session: mapBridgeSessionRow(refreshed), created: false };
    }

    const row: typeof bridgeSessions.$inferSelect = {
      id: createId(ID_PREFIXES.bridgeSession),
      workspaceId,
      harnessName: input.harnessName,
      adeKind: input.adeKind,
      externalThreadId: input.externalThreadId,
      workspacePath: input.workspacePath ?? null,
      pid: input.pid ?? null,
      capabilitiesJson: JSON.stringify(input.capabilities ?? {}),
      status: input.status ?? "online",
      lastSeenAt: ts,
      createdAt: ts,
    };
    ctx.db.insert(bridgeSessions).values(row).run();
    return { session: mapBridgeSessionRow(row), created: true };
  });
}

export function getBridgeSessionByIdSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  sessionId: string,
): BridgeSessionRecord | null {
  const row = ctx.db
    .select()
    .from(bridgeSessions)
    .where(
      and(
        eq(bridgeSessions.workspaceId, workspaceId),
        eq(bridgeSessions.id, sessionId),
      ),
    )
    .get();
  return row ? mapBridgeSessionRow(row) : null;
}

export function listBridgeSessionsSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  options?: ListBridgeSessionsInput,
): readonly BridgeSessionRecord[] {
  const conditions = [eq(bridgeSessions.workspaceId, workspaceId)];
  if (options?.status) {
    conditions.push(eq(bridgeSessions.status, options.status));
  } else if (options?.includeOffline === false) {
    conditions.push(eq(bridgeSessions.status, "online"));
  }
  if (options?.harnessName) {
    conditions.push(eq(bridgeSessions.harnessName, options.harnessName));
  }
  if (options?.adeKind) {
    conditions.push(eq(bridgeSessions.adeKind, options.adeKind));
  }

  const rows = ctx.db
    .select()
    .from(bridgeSessions)
    .where(and(...conditions))
    .orderBy(desc(bridgeSessions.lastSeenAt))
    .all();

  return rows.map(mapBridgeSessionRow);
}
