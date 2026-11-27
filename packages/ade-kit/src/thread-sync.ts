import type {
  AdeThreadBinding,
  AdeThreadStatus,
  AgentPendingApproval,
  AgentSteeringNote,
  AgentStepItem,
  SteeringNoteId,
  ThreadBindingId,
  UpdateThreadBindingInput,
} from "@inkade/core";

export type HostThreadLifecycleStatus = AdeThreadStatus;

export interface HostThreadTransition {
  readonly status: HostThreadLifecycleStatus;
  readonly title?: string | null | undefined;
  readonly summary?: string | null | undefined;
  readonly deepLink?: string | null | undefined;
  readonly unreadResult?: boolean | undefined;
  readonly progressSteps?: readonly AgentStepItem[] | undefined;
  readonly pendingApproval?: AgentPendingApproval | null | undefined;
}

export interface HostThreadSnapshot {
  readonly externalThreadId: string;
  readonly status: HostThreadLifecycleStatus;
  readonly title?: string | null | undefined;
  readonly summary?: string | null | undefined;
  readonly deepLink?: string | null | undefined;
  readonly progressSteps?: readonly AgentStepItem[] | undefined;
  readonly pendingApproval?: AgentPendingApproval | null | undefined;
}

export interface ThreadBindingStore {
  updateThreadBinding(
    bindingId: ThreadBindingId,
    input: UpdateThreadBindingInput,
  ): Promise<AdeThreadBinding>;
}

export interface ThreadSyncCoordinatorOptions {
  readonly debounceMs?: number | undefined;
  readonly maxSummaryLength?: number | undefined;
  readonly now?: (() => string) | undefined;
  readonly onSynced?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onError?: ((error: unknown, bindingId: ThreadBindingId) => void) | undefined;
}

export interface ReconcileResult {
  readonly updated: readonly AdeThreadBinding[];
  readonly skipped: number;
  readonly missing: readonly ThreadBindingId[];
}

interface SyncedSnapshot {
  status: AdeThreadStatus;
  lastSummary: string | null;
  title: string;
  deepLink: string | null;
  unreadResult: boolean;
  progressStepsJson: string | undefined;
  pendingApprovalJson: string | undefined;
}

interface PendingEntry {
  desired: SyncedSnapshot;
  patch: UpdateThreadBindingInput;
  timer: ReturnType<typeof setTimeout> | null;
  resolvers: Array<(binding: AdeThreadBinding | null) => void>;
  rejecters: Array<(error: unknown) => void>;
}

const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_MAX_SUMMARY_LENGTH = 240;

/**
 * Normalizes whitespace and truncates an assistant reply into a concise single-line summary.
 */
export function truncateAssistantSummary(
  text: string | null | undefined,
  maxLength = DEFAULT_MAX_SUMMARY_LENGTH,
): string | null {
  if (typeof text !== "string") return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length <= maxLength) return collapsed;
  if (maxLength <= 1) return collapsed.slice(0, Math.max(0, maxLength));
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

function shouldMarkUnreadForStatus(status: AdeThreadStatus): boolean {
  return status === "completed" || status === "waiting_input" || status === "failed";
}

function snapshotFromBinding(binding: AdeThreadBinding): SyncedSnapshot {
  return {
    status: binding.status,
    lastSummary: binding.lastSummary,
    title: binding.title,
    deepLink: binding.deepLink,
    unreadResult: binding.unreadResult,
    progressStepsJson:
      binding.progressSteps !== undefined ? JSON.stringify(binding.progressSteps) : undefined,
    pendingApprovalJson:
      binding.pendingApproval !== undefined ? JSON.stringify(binding.pendingApproval) : undefined,
  };
}

function computePatch(
  baseline: SyncedSnapshot,
  transition: HostThreadTransition,
  maxSummaryLength: number,
  now: () => string,
): { next: SyncedSnapshot; patch: UpdateThreadBindingInput } | null {
  const nextSummary =
    transition.summary !== undefined
      ? truncateAssistantSummary(transition.summary, maxSummaryLength)
      : baseline.lastSummary;

  const trimmedTitle =
    typeof transition.title === "string" && transition.title.trim().length > 0
      ? transition.title.trim().slice(0, 300)
      : baseline.title;

  const nextDeepLink =
    transition.deepLink !== undefined ? transition.deepLink : baseline.deepLink;

  const nextUnread =
    transition.unreadResult !== undefined
      ? transition.unreadResult
      : transition.status !== baseline.status && shouldMarkUnreadForStatus(transition.status)
        ? true
        : baseline.unreadResult;

  const nextProgressStepsJson =
    transition.progressSteps !== undefined
      ? JSON.stringify(transition.progressSteps)
      : baseline.progressStepsJson;

  const nextPendingApprovalJson =
    transition.pendingApproval !== undefined
      ? JSON.stringify(transition.pendingApproval)
      : baseline.pendingApprovalJson;

  const patchFields: {
    status?: AdeThreadStatus;
    lastSummary?: string | null;
    title?: string;
    deepLink?: string | null;
    unreadResult?: boolean;
    progressSteps?: UpdateThreadBindingInput["progressSteps"];
    pendingApproval?: AgentPendingApproval | null;
  } = {};

  if (transition.status !== baseline.status) {
    patchFields.status = transition.status;
  }
  if (nextSummary !== baseline.lastSummary) {
    patchFields.lastSummary = nextSummary;
  }
  if (trimmedTitle !== baseline.title) {
    patchFields.title = trimmedTitle;
  }
  if (nextDeepLink !== baseline.deepLink) {
    patchFields.deepLink = nextDeepLink;
  }
  if (nextUnread !== baseline.unreadResult) {
    patchFields.unreadResult = nextUnread;
  }
  if (
    transition.progressSteps !== undefined &&
    nextProgressStepsJson !== baseline.progressStepsJson
  ) {
    patchFields.progressSteps = transition.progressSteps.map((step) => ({
      id: step.id,
      label: step.label,
      status: step.status,
      ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
      ...(step.sources !== undefined
        ? { sources: step.sources.map((src) => ({ ...src })) }
        : {}),
    }));
  }
  if (
    transition.pendingApproval !== undefined &&
    nextPendingApprovalJson !== baseline.pendingApprovalJson
  ) {
    patchFields.pendingApproval = transition.pendingApproval;
  }

  if (Object.keys(patchFields).length === 0) {
    return null;
  }

  const next: SyncedSnapshot = {
    status: transition.status,
    lastSummary: nextSummary,
    title: trimmedTitle,
    deepLink: nextDeepLink,
    unreadResult: nextUnread,
    progressStepsJson: nextProgressStepsJson,
    pendingApprovalJson: nextPendingApprovalJson,
  };

  return {
    next,
    patch: {
      ...patchFields,
      lastSyncedAt: now(),
    },
  };
}

/**
 * Coordinates debounced, idempotent synchronization of ADE thread lifecycle transitions
 * into Inkade `AdeThreadBinding` records, plus startup reconciliation.
 */
export class ThreadSyncCoordinator {
  private readonly store: ThreadBindingStore;
  private readonly debounceMs: number;
  private readonly maxSummaryLength: number;
  private readonly now: () => string;
  private readonly onSynced: ((binding: AdeThreadBinding) => void) | undefined;
  private readonly onError: ((error: unknown, bindingId: ThreadBindingId) => void) | undefined;

  private readonly lastSyncedByBinding = new Map<ThreadBindingId, SyncedSnapshot>();
  private readonly pendingByBinding = new Map<ThreadBindingId, PendingEntry>();
  private disposed = false;

  constructor(store: ThreadBindingStore, options: ThreadSyncCoordinatorOptions = {}) {
    this.store = store;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxSummaryLength = options.maxSummaryLength ?? DEFAULT_MAX_SUMMARY_LENGTH;
    this.now = options.now ?? (() => new Date().toISOString());
    this.onSynced = options.onSynced;
    this.onError = options.onError;
  }

  private getBaseline(binding: AdeThreadBinding): SyncedSnapshot {
    const pending = this.pendingByBinding.get(binding.id);
    if (pending) return pending.desired;
    return this.lastSyncedByBinding.get(binding.id) ?? snapshotFromBinding(binding);
  }

  /**
   * Queues (or immediately dispatches when `debounceMs <= 0`) an idempotent update
   * for a single `AdeThreadBinding` based on a host thread transition.
   */
  recordTransition(
    binding: AdeThreadBinding,
    transition: HostThreadTransition,
  ): Promise<AdeThreadBinding | null> {
    if (this.disposed) {
      return Promise.resolve(null);
    }

    const baseline = this.getBaseline(binding);
    const computed = computePatch(baseline, transition, this.maxSummaryLength, this.now);
    if (!computed) {
      this.lastSyncedByBinding.set(binding.id, baseline);
      return Promise.resolve(null);
    }

    if (this.debounceMs <= 0) {
      this.clearPendingTimer(binding.id);
      return this.dispatchPatch(binding.id, computed.next, computed.patch);
    }

    return new Promise<AdeThreadBinding | null>((resolve, reject) => {
      const existing = this.pendingByBinding.get(binding.id);
      if (existing) {
        if (existing.timer !== null) {
          clearTimeout(existing.timer);
        }
        const mergedPatch: UpdateThreadBindingInput = {
          ...existing.patch,
          ...computed.patch,
        };
        existing.desired = computed.next;
        existing.patch = mergedPatch;
        existing.resolvers.push(resolve);
        existing.rejecters.push(reject);
        existing.timer = setTimeout(() => {
          void this.flushBinding(binding.id);
        }, this.debounceMs);
        return;
      }

      const entry: PendingEntry = {
        desired: computed.next,
        patch: computed.patch,
        timer: setTimeout(() => {
          void this.flushBinding(binding.id);
        }, this.debounceMs),
        resolvers: [resolve],
        rejecters: [reject],
      };
      this.pendingByBinding.set(binding.id, entry);
    });
  }

  private clearPendingTimer(bindingId: ThreadBindingId): void {
    const existing = this.pendingByBinding.get(bindingId);
    if (!existing) return;
    if (existing.timer !== null) {
      clearTimeout(existing.timer);
      existing.timer = null;
    }
    this.pendingByBinding.delete(bindingId);
    for (const resolve of existing.resolvers) {
      resolve(null);
    }
  }

  private async dispatchPatch(
    bindingId: ThreadBindingId,
    desired: SyncedSnapshot,
    patch: UpdateThreadBindingInput,
  ): Promise<AdeThreadBinding> {
    const updated = await this.store.updateThreadBinding(bindingId, patch);
    this.lastSyncedByBinding.set(bindingId, snapshotFromBinding(updated));
    // Preserve desired snapshot fields in case server echoes normalized values.
    const confirmed = this.lastSyncedByBinding.get(bindingId);
    if (!confirmed) {
      this.lastSyncedByBinding.set(bindingId, desired);
    }
    this.onSynced?.(updated);
    return updated;
  }

  private async flushBinding(bindingId: ThreadBindingId): Promise<AdeThreadBinding | null> {
    const entry = this.pendingByBinding.get(bindingId);
    if (!entry) return null;

    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }
    this.pendingByBinding.delete(bindingId);

    try {
      const updated = await this.dispatchPatch(bindingId, entry.desired, entry.patch);
      for (const resolve of entry.resolvers) {
        resolve(updated);
      }
      return updated;
    } catch (error) {
      this.onError?.(error, bindingId);
      for (const reject of entry.rejecters) {
        reject(error);
      }
      return null;
    }
  }

  /**
   * Flushes all (or a specific) pending debounced transitions immediately.
   */
  async flush(bindingId?: ThreadBindingId): Promise<void> {
    if (bindingId !== undefined) {
      await this.flushBinding(bindingId);
      return;
    }
    const ids = [...this.pendingByBinding.keys()];
    await Promise.all(ids.map((id) => this.flushBinding(id)));
  }

  /**
   * Reconciles existing Inkade thread bindings against live host ADE thread snapshots,
   * catching lifecycle changes missed while the adapter was offline or restarted.
   */
  async reconcile(
    bindings: readonly AdeThreadBinding[],
    hostThreadSnapshots:
      | readonly HostThreadSnapshot[]
      | ReadonlyMap<string, HostThreadSnapshot>,
  ): Promise<ReconcileResult> {
    const snapshotMap: ReadonlyMap<string, HostThreadSnapshot> = Array.isArray(hostThreadSnapshots)
      ? new Map(
          (hostThreadSnapshots as readonly HostThreadSnapshot[]).map((s) => [
            s.externalThreadId,
            s,
          ] as const),
        )
      : (hostThreadSnapshots as ReadonlyMap<string, HostThreadSnapshot>);

    const updated: AdeThreadBinding[] = [];
    const missing: ThreadBindingId[] = [];
    let skipped = 0;

    for (const binding of bindings) {
      const snapshot = snapshotMap.get(binding.externalThreadId);
      if (!snapshot) {
        missing.push(binding.id);
        continue;
      }

      this.clearPendingTimer(binding.id);
      const baseline = snapshotFromBinding(binding);
      const transition: HostThreadTransition = {
        status: snapshot.status,
        ...(snapshot.title !== undefined ? { title: snapshot.title } : {}),
        ...(snapshot.summary !== undefined ? { summary: snapshot.summary } : {}),
        ...(snapshot.deepLink !== undefined ? { deepLink: snapshot.deepLink } : {}),
        ...(snapshot.progressSteps !== undefined
          ? { progressSteps: snapshot.progressSteps }
          : {}),
        ...(snapshot.pendingApproval !== undefined
          ? { pendingApproval: snapshot.pendingApproval }
          : {}),
      };
      const computed = computePatch(baseline, transition, this.maxSummaryLength, this.now);
      if (!computed) {
        this.lastSyncedByBinding.set(binding.id, baseline);
        skipped++;
        continue;
      }

      const result = await this.dispatchPatch(binding.id, computed.next, computed.patch);
      updated.push(result);
    }

    return { updated, skipped, missing };
  }

  /**
   * Cancels pending debounce timers and releases coordinator state.
   */
  dispose(): void {
    this.disposed = true;
    for (const [bindingId] of this.pendingByBinding) {
      this.clearPendingTimer(bindingId);
    }
    this.lastSyncedByBinding.clear();
  }
}

/**
 * Extracts undelivered steering notes from a binding queue, prioritizing `interrupt` notes
 * before `queued` notes while preserving chronological order within each priority tier.
 */
export function getPendingSteeringNotes(
  binding: Pick<AdeThreadBinding, "steeringQueue">,
): readonly AgentSteeringNote[] {
  const queue = binding.steeringQueue ?? [];
  const pending = queue.filter((note) => note.deliveredAt == null);
  return [...pending].sort((a, b) => {
    if (a.mode !== b.mode) {
      return a.mode === "interrupt" ? -1 : 1;
    }
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
      return ta - tb;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Formats pending human steering notes for injection into a live ADE thread turn.
 */
export function formatSteeringPromptAppendix(notes: readonly AgentSteeringNote[]): string {
  if (notes.length === 0) return "";
  const lines = ["## Human Steering Notes"];
  for (const note of notes) {
    const tag = note.mode === "interrupt" ? "[INTERRUPT]" : "[QUEUED]";
    lines.push(`- ${tag} (${note.createdAt}): ${note.text}`);
  }
  return lines.join("\n");
}

/**
 * Marks the specified steering note IDs as delivered on the server binding record.
 */
export async function markSteeringNotesDelivered(
  store: ThreadBindingStore,
  binding: Pick<AdeThreadBinding, "id" | "steeringQueue">,
  noteIds: readonly SteeringNoteId[],
  deliveredAt = new Date().toISOString(),
): Promise<AdeThreadBinding | null> {
  if (noteIds.length === 0) return null;
  const targetSet = new Set(noteIds);
  const currentQueue = binding.steeringQueue ?? [];
  let changed = false;

  const nextQueue = currentQueue.map((note) => {
    if (targetSet.has(note.id) && note.deliveredAt == null) {
      changed = true;
      return { ...note, deliveredAt };
    }
    return note;
  });

  if (!changed) return null;
  return store.updateThreadBinding(binding.id, {
    steeringQueue: nextQueue,
    lastSyncedAt: deliveredAt,
  });
}

/**
 * Delivers all pending steering notes on a binding via `deliver` and marks them delivered.
 */
export async function deliverPendingSteeringNotes(
  store: ThreadBindingStore,
  binding: Pick<AdeThreadBinding, "id" | "steeringQueue">,
  deliver: (notes: readonly AgentSteeringNote[], formattedPrompt: string) => Promise<void>,
  options: { readonly now?: (() => string) | undefined } = {},
): Promise<{
  readonly delivered: readonly AgentSteeringNote[];
  readonly binding: AdeThreadBinding | null;
}> {
  const pending = getPendingSteeringNotes(binding);
  if (pending.length === 0) {
    return { delivered: [], binding: null };
  }

  const prompt = formatSteeringPromptAppendix(pending);
  await deliver(pending, prompt);
  const ts = options.now ? options.now() : new Date().toISOString();
  const updated = await markSteeringNotesDelivered(
    store,
    binding,
    pending.map((n) => n.id),
    ts,
  );
  return { delivered: pending, binding: updated };
}
