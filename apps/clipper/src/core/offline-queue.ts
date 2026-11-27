import {
  asWorkspaceId,
  todayLocalDateString,
  type DocumentId,
  type DocumentRecord,
  type WorkspaceId,
} from "@inkade/core";
import { isInkadeApiError, type InkadeClient } from "@inkade/sdk";
import {
  enqueueOfflineMutationWithCache,
  flushOfflineMutationQueue,
  type OfflineCacheBackend,
  type OfflineMutationPayload,
  type OfflineQueuedMutation,
} from "@inkade/sdk/offline";
import {
  generateNonce,
  loadOfflineQueueItems,
  saveOfflineQueueItems,
  type AppendDailyOfflinePayload,
  type ClipPageOfflinePayload,
  type ClipperOfflineQueueItem,
  type DispatchAdeOfflinePayload,
  type IngestUrlOfflinePayload,
  type SaveHighlightOfflinePayload,
} from "../shared/storage.ts";
import { getWebExt } from "../shared/webext.ts";
import {
  dispatchClipToAde,
  syncClipPage,
  syncHighlightToInkade,
} from "./sync.ts";

const MAX_OFFLINE_QUEUE_ITEMS = 100;
const CLIPPER_OFFLINE_WORKSPACE_ID: WorkspaceId = asWorkspaceId("wsp_clipper_offline");

export interface OfflineFlushResult {
  readonly synced: number;
  readonly remaining: number;
  readonly lastError?: string | undefined;
}

export type EnqueueOfflineActionInput = (
  | { readonly kind: "clip-page"; readonly payload: ClipPageOfflinePayload }
  | { readonly kind: "save-highlight"; readonly payload: SaveHighlightOfflinePayload }
  | { readonly kind: "append-daily"; readonly payload: AppendDailyOfflinePayload }
  | { readonly kind: "dispatch-ade"; readonly payload: DispatchAdeOfflinePayload }
  | { readonly kind: "ingest-url"; readonly payload: IngestUrlOfflinePayload }
) & {
  readonly label: string;
  readonly error?: unknown;
};

function buildDailyAppendMarkdown(payload: AppendDailyOfflinePayload): string {
  return payload.customMarkdown?.trim() || `- [[${payload.title}]] ([source](${payload.url})) #clip`;
}

function toSdkDailyAppendMutation(
  item: Extract<ClipperOfflineQueueItem, { readonly kind: "append-daily" }>,
): OfflineQueuedMutation {
  return {
    id: item.id,
    kind: "daily_append",
    workspaceId: CLIPPER_OFFLINE_WORKSPACE_ID,
    date: item.payload.date ?? todayLocalDateString(),
    input: {
      contentMarkdown: buildDailyAppendMarkdown(item.payload),
      authorType: "human",
    },
    queuedAt: item.createdAt,
    attempts: item.attempts,
  };
}

/**
 * `OfflineCacheBackend` implementation over `chrome.storage.local` (preserving `CLIPPER_OFFLINE_QUEUE_KEY`)
 * so `@inkade/sdk/offline` mutations (e.g. `daily_append`) share the unified Inkade offline contract.
 */
export class ChromeStorageOfflineBackend implements OfflineCacheBackend {
  private readonly docs = new Map<DocumentId, DocumentRecord>();
  private readonly pendingAppendMeta = new Map<
    string,
    {
      readonly label: string;
      readonly lastError?: string | undefined;
      readonly payload: AppendDailyOfflinePayload;
    }
  >();

  registerPendingAppendMeta(
    id: string,
    meta: {
      readonly label: string;
      readonly lastError?: string | undefined;
      readonly payload: AppendDailyOfflinePayload;
    },
  ): void {
    this.pendingAppendMeta.set(id, meta);
  }

  getDocument(documentId: DocumentId): Promise<DocumentRecord | null> {
    return Promise.resolve(this.docs.get(documentId) ?? null);
  }

  putDocument(document: DocumentRecord): Promise<void> {
    this.docs.set(document.id, document);
    return Promise.resolve();
  }

  listDocuments(): Promise<readonly DocumentRecord[]> {
    return Promise.resolve([...this.docs.values()]);
  }

  deleteDocument(documentId: DocumentId): Promise<void> {
    this.docs.delete(documentId);
    return Promise.resolve();
  }

  async listMutations(): Promise<readonly OfflineQueuedMutation[]> {
    const items = await loadOfflineQueueItems();
    const result: OfflineQueuedMutation[] = [];
    for (const item of items) {
      if (item.kind === "append-daily") {
        result.push(toSdkDailyAppendMutation(item));
      }
    }
    return result;
  }

  async putMutation(mutation: OfflineQueuedMutation): Promise<void> {
    if (mutation.kind !== "daily_append") return;
    const existing = await loadOfflineQueueItems();
    const existingItem = existing.find((entry) => entry.id === mutation.id);
    const meta = this.pendingAppendMeta.get(mutation.id);
    this.pendingAppendMeta.delete(mutation.id);

    const payload: AppendDailyOfflinePayload =
      meta?.payload ??
      (existingItem?.kind === "append-daily"
        ? existingItem.payload
        : {
            title: mutation.input.contentMarkdown,
            url: "",
            documentId: "",
            customMarkdown: mutation.input.contentMarkdown,
            date: mutation.date,
          });

    const nextItem: ClipperOfflineQueueItem = {
      id: mutation.id,
      kind: "append-daily",
      label: (meta?.label ?? existingItem?.label ?? payload.title).trim() || "append-daily",
      payload,
      createdAt: mutation.queuedAt,
      attempts: mutation.attempts,
      lastError: meta?.lastError ?? existingItem?.lastError,
    };

    const idx = existing.findIndex((entry) => entry.id === mutation.id);
    const updated =
      idx >= 0
        ? existing.map((entry, i) => (i === idx ? nextItem : entry))
        : [...existing, nextItem];
    await saveOfflineQueueItems(updated.slice(-MAX_OFFLINE_QUEUE_ITEMS));
  }

  async deleteMutation(mutationId: string): Promise<void> {
    const existing = await loadOfflineQueueItems();
    const next = existing.filter((entry) => entry.id !== mutationId);
    if (next.length !== existing.length) {
      await saveOfflineQueueItems(next);
    }
  }

  async clearMutations(): Promise<void> {
    const existing = await loadOfflineQueueItems();
    const remaining = existing.filter((entry) => entry.kind !== "append-daily");
    await saveOfflineQueueItems(remaining);
  }
}

const sharedOfflineBackend = new ChromeStorageOfflineBackend();

class SingleDailyMutationBackend implements OfflineCacheBackend {
  private readonly inner: OfflineCacheBackend;
  private mutation: OfflineQueuedMutation | null;

  constructor(inner: OfflineCacheBackend, item: Extract<ClipperOfflineQueueItem, { readonly kind: "append-daily" }>) {
    this.inner = inner;
    this.mutation = toSdkDailyAppendMutation(item);
  }

  getDocument(documentId: DocumentId): Promise<DocumentRecord | null> {
    return this.inner.getDocument(documentId);
  }

  putDocument(document: DocumentRecord): Promise<void> {
    return this.inner.putDocument(document);
  }

  listDocuments(): Promise<readonly DocumentRecord[]> {
    return this.inner.listDocuments();
  }

  deleteDocument(documentId: DocumentId): Promise<void> {
    return this.inner.deleteDocument(documentId);
  }

  listMutations(): Promise<readonly OfflineQueuedMutation[]> {
    return Promise.resolve(this.mutation ? [this.mutation] : []);
  }

  putMutation(mutation: OfflineQueuedMutation): Promise<void> {
    this.mutation = mutation;
    return Promise.resolve();
  }

  deleteMutation(mutationId: string): Promise<void> {
    if (this.mutation?.id === mutationId) {
      this.mutation = null;
    }
    return Promise.resolve();
  }

  clearMutations(): Promise<void> {
    this.mutation = null;
    return Promise.resolve();
  }
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (isInkadeApiError(error)) {
    return error.status >= 500 || error.status === 429 || error.status === 408 || error.status === 0;
  }
  if (error instanceof TypeError) {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|network request failed|fetch failed|econnrefused|enotfound|etimedout|timeout|offline/i.test(msg)) {
    return true;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }
  return false;
}

export async function updateOfflineBadge(count: number): Promise<void> {
  const ext = getWebExt();
  if (!ext?.action) return;
  try {
    if (count > 0) {
      await ext.action.setBadgeBackgroundColor({ color: "#d97706" });
      await ext.action.setBadgeText({ text: String(count) });
    } else {
      await ext.action.setBadgeText({ text: "" });
    }
  } catch {
    // ignore badge errors in headless/test environments
  }
}

function stringifyQueueError(err: unknown): string | undefined {
  if (err === undefined) return undefined;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return String(err);
  }
  try {
    return JSON.stringify(err) ?? "[unserializable error]";
  } catch {
    return "[unserializable error]";
  }
}

export async function enqueueOfflineAction(
  input: EnqueueOfflineActionInput,
): Promise<ClipperOfflineQueueItem> {
  const id = `oq_${generateNonce()}`;
  const label = input.label.trim() || input.kind;
  const lastError = stringifyQueueError(input.error);

  if (input.kind === "append-daily") {
    sharedOfflineBackend.registerPendingAppendMeta(id, {
      label,
      lastError,
      payload: input.payload,
    });
    const sdkPayload: OfflineMutationPayload = {
      kind: "daily_append",
      workspaceId: CLIPPER_OFFLINE_WORKSPACE_ID,
      date: input.payload.date ?? todayLocalDateString(),
      input: {
        contentMarkdown: buildDailyAppendMarkdown(input.payload),
        authorType: "human",
      },
    };
    const queued = await enqueueOfflineMutationWithCache(sharedOfflineBackend, sdkPayload, id);
    const items = await loadOfflineQueueItems();
    await updateOfflineBadge(items.length);
    const stored = items.find((item) => item.id === queued.id);
    if (stored) return stored;
    return {
      id: queued.id,
      kind: "append-daily",
      label,
      payload: input.payload,
      createdAt: queued.queuedAt,
      attempts: queued.attempts,
      lastError,
    };
  }

  const existing = await loadOfflineQueueItems();
  const base = {
    id,
    label,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError,
  };
  let entry: ClipperOfflineQueueItem;
  switch (input.kind) {
    case "clip-page":
      entry = { ...base, kind: "clip-page", payload: input.payload };
      break;
    case "save-highlight":
      entry = { ...base, kind: "save-highlight", payload: input.payload };
      break;
    case "dispatch-ade":
      entry = { ...base, kind: "dispatch-ade", payload: input.payload };
      break;
    case "ingest-url":
      entry = { ...base, kind: "ingest-url", payload: input.payload };
      break;
  }

  const next = [...existing, entry].slice(-MAX_OFFLINE_QUEUE_ITEMS);
  await saveOfflineQueueItems(next);
  await updateOfflineBadge(next.length);
  return entry;
}

export async function removeOfflineQueueItem(id: string): Promise<ClipperOfflineQueueItem[]> {
  const existing = await loadOfflineQueueItems();
  const next = existing.filter((item) => item.id !== id);
  await saveOfflineQueueItems(next);
  await updateOfflineBadge(next.length);
  return next;
}

export async function clearOfflineQueue(): Promise<void> {
  await saveOfflineQueueItems([]);
  await updateOfflineBadge(0);
}

export async function retryOfflineQueueItem(
  client: InkadeClient,
  id: string,
): Promise<{ readonly synced: boolean; readonly remaining: number; readonly error?: string | undefined }> {
  const items = await loadOfflineQueueItems();
  const target = items.find((item) => item.id === id);
  if (!target) {
    return { synced: false, remaining: items.length };
  }

  try {
    await executeOfflineQueueItem(client, target);
    const next = items.filter((item) => item.id !== id);
    await saveOfflineQueueItems(next);
    await updateOfflineBadge(next.length);
    return { synced: true, remaining: next.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const next = items.map((item) =>
      item.id === id ? { ...item, attempts: item.attempts + 1, lastError: msg } : item,
    );
    await saveOfflineQueueItems(next);
    await updateOfflineBadge(next.length);
    return { synced: false, remaining: next.length, error: msg };
  }
}

async function executeDailyAppendViaSdk(
  client: InkadeClient,
  item: Extract<ClipperOfflineQueueItem, { readonly kind: "append-daily" }>,
): Promise<void> {
  const singleBackend = new SingleDailyMutationBackend(sharedOfflineBackend, item);
  const res = await flushOfflineMutationQueue(singleBackend, client);
  if (res.applied.includes(item.id)) {
    return;
  }
  const failure = res.failed[0];
  if (failure) {
    throw failure.error instanceof Error
      ? failure.error
      : new Error(stringifyQueueError(failure.error) ?? "Failed to replay daily append");
  }
  const conflict = res.conflicts[0];
  if (conflict) {
    throw new Error(conflict.message);
  }
}

async function executeOfflineQueueItem(
  client: InkadeClient,
  item: ClipperOfflineQueueItem,
): Promise<void> {
  switch (item.kind) {
    case "clip-page":
      await syncClipPage(client, item.payload);
      return;
    case "save-highlight":
      await syncHighlightToInkade(client, item.payload);
      return;
    case "append-daily":
      await executeDailyAppendViaSdk(client, item);
      return;
    case "dispatch-ade":
      await dispatchClipToAde(client, item.payload);
      return;
    case "ingest-url": {
      const { tags, ...rest } = item.payload;
      await client.clips.ingestUrl({
        ...rest,
        ...(tags ? { tags: [...tags] } : {}),
      });
      return;
    }
  }
}

export async function flushOfflineQueue(client: InkadeClient): Promise<OfflineFlushResult> {
  const items = await loadOfflineQueueItems();
  if (items.length === 0) {
    await updateOfflineBadge(0);
    return { synced: 0, remaining: 0 };
  }

  let synced = 0;
  let lastError: string | undefined;
  const remaining: ClipperOfflineQueueItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    try {
      await executeOfflineQueueItem(client, item);
      synced += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      remaining.push({
        ...item,
        attempts: item.attempts + 1,
        lastError: msg,
      });
      if (isRetryableNetworkError(err)) {
        for (let j = i + 1; j < items.length; j++) {
          remaining.push(items[j]!);
        }
        break;
      }
    }
  }

  await saveOfflineQueueItems(remaining);
  await updateOfflineBadge(remaining.length);
  return {
    synced,
    remaining: remaining.length,
    ...(lastError ? { lastError } : {}),
  };
}
