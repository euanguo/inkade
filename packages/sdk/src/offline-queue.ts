import type {
  BatchOutlineNodesRequestInput,
  CreateDocumentInput,
  DocumentId,
  DocumentRecord,
  UpdateDocumentInput,
  WorkspaceId,
} from "@inkade/core";
import type { InkadeClient } from "./client.ts";
import { InkadeApiError } from "./errors.ts";

export type OfflineMutationPayload =
  | {
      readonly kind: "create_document";
      readonly workspaceId: WorkspaceId;
      readonly clientTempId?: string | undefined;
      readonly input: CreateDocumentInput;
    }
  | {
      readonly kind: "update_document";
      readonly workspaceId: WorkspaceId;
      readonly documentId: DocumentId;
      readonly input: UpdateDocumentInput;
    }
  | {
      readonly kind: "batch_outline";
      readonly workspaceId: WorkspaceId;
      readonly documentId: DocumentId;
      readonly input: BatchOutlineNodesRequestInput;
    }
  | {
      readonly kind: "daily_append";
      readonly workspaceId: WorkspaceId;
      readonly date: string;
      readonly input: {
        readonly contentMarkdown: string;
        readonly checked?: boolean | null | undefined;
        readonly authorType?: "human" | "agent" | undefined;
      };
    };

export type OfflineQueuedMutation = OfflineMutationPayload & {
  readonly id: string;
  readonly queuedAt: string;
  readonly attempts: number;
};

export interface OfflineMutationConflict {
  readonly mutation: OfflineQueuedMutation;
  readonly status: 409;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown> | undefined;
  readonly serverDocument?: DocumentRecord | null | undefined;
}

export interface OfflineMutationFailure {
  readonly mutation: OfflineQueuedMutation;
  readonly error: unknown;
  readonly retryable: boolean;
}

export interface FlushOfflineQueueResult {
  readonly applied: readonly string[];
  readonly conflicts: readonly OfflineMutationConflict[];
  readonly failed: readonly OfflineMutationFailure[];
  readonly remaining: number;
}

export interface OfflineCacheBackend {
  getDocument(documentId: DocumentId): Promise<DocumentRecord | null>;
  putDocument(document: DocumentRecord): Promise<void>;
  listDocuments(): Promise<readonly DocumentRecord[]>;
  deleteDocument(documentId: DocumentId): Promise<void>;
  listMutations(): Promise<readonly OfflineQueuedMutation[]>;
  putMutation(mutation: OfflineQueuedMutation): Promise<void>;
  deleteMutation(mutationId: string): Promise<void>;
  clearMutations(): Promise<void>;
}

export class MemoryOfflineCacheBackend implements OfflineCacheBackend {
  private readonly docs = new Map<DocumentId, DocumentRecord>();
  private readonly mutations = new Map<string, OfflineQueuedMutation>();

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

  listMutations(): Promise<readonly OfflineQueuedMutation[]> {
    return Promise.resolve(
      [...this.mutations.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)),
    );
  }

  putMutation(mutation: OfflineQueuedMutation): Promise<void> {
    this.mutations.set(mutation.id, mutation);
    return Promise.resolve();
  }

  deleteMutation(mutationId: string): Promise<void> {
    this.mutations.delete(mutationId);
    return Promise.resolve();
  }

  clearMutations(): Promise<void> {
    this.mutations.clear();
    return Promise.resolve();
  }
}

export async function enqueueOfflineMutationWithCache(
  backend: OfflineCacheBackend,
  payload: OfflineMutationPayload,
  mutationId: string,
): Promise<OfflineQueuedMutation> {
  const mutation: OfflineQueuedMutation = {
    ...payload,
    id: mutationId,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  await backend.putMutation(mutation);

  if (payload.kind === "update_document") {
    const cached = await backend.getDocument(payload.documentId);
    if (cached) {
      await backend.putDocument({
        ...cached,
        ...(payload.input.title !== undefined ? { title: payload.input.title } : {}),
        ...(payload.input.contentMarkdown !== undefined
          ? { contentMarkdown: payload.input.contentMarkdown }
          : {}),
        ...(payload.input.tags !== undefined ? { tags: payload.input.tags } : {}),
        ...(payload.input.pinned !== undefined ? { pinned: payload.input.pinned } : {}),
        updatedAt: mutation.queuedAt,
      });
    }
  }

  return mutation;
}

/**
 * Replays queued offline mutations in FIFO order against `InkadeClient`, reconciling 409 conflicts
 * and halting on retryable 5xx/network errors while pruning invalid 4xx requests.
 */
export async function flushOfflineMutationQueue(
  backend: OfflineCacheBackend,
  client: InkadeClient,
  options?: {
    readonly onConflict?: ((conflict: OfflineMutationConflict) => void) | undefined;
  },
): Promise<FlushOfflineQueueResult> {
  const queue = await backend.listMutations();
  const applied: string[] = [];
  const conflicts: OfflineMutationConflict[] = [];
  const failed: OfflineMutationFailure[] = [];

  for (const mutation of queue) {
    try {
      if (mutation.kind === "create_document") {
        const created = await client.documents.create(mutation.input);
        await backend.putDocument(created);
      } else if (mutation.kind === "update_document") {
        const updated = await client.documents.update(mutation.documentId, mutation.input);
        await backend.putDocument(updated);
      } else if (mutation.kind === "batch_outline") {
        await client.outlineNodes.batch({
          ...mutation.input,
          documentId: mutation.input.documentId ?? mutation.documentId,
        });
      } else if (mutation.kind === "daily_append") {
        const daily = await client.documents.getDaily(mutation.date);
        await client.outlineNodes.create({
          documentId: daily.document.id,
          parentNodeId: null,
          contentMarkdown: mutation.input.contentMarkdown,
          checked: mutation.input.checked ?? null,
          authorType: mutation.input.authorType ?? "human",
        });
        await backend.putDocument(daily.document);
      }
      await backend.deleteMutation(mutation.id);
      applied.push(mutation.id);
    } catch (error) {
      if (error instanceof InkadeApiError && error.status === 409) {
        let serverDocument: DocumentRecord | null = null;
        if (mutation.kind === "update_document" || mutation.kind === "batch_outline") {
          serverDocument = await client.documents.get(mutation.documentId).catch(() => null);
          if (serverDocument) {
            await backend.putDocument(serverDocument);
          }
        }
        const conflict: OfflineMutationConflict = {
          mutation,
          status: 409,
          code: error.code,
          message: error.message,
          details: error.details,
          serverDocument,
        };
        conflicts.push(conflict);
        options?.onConflict?.(conflict);
        await backend.deleteMutation(mutation.id);
        continue;
      }

      const isNonRetryable4xx =
        error instanceof InkadeApiError && error.status >= 400 && error.status < 500;
      if (isNonRetryable4xx) {
        failed.push({ mutation, error, retryable: false });
        await backend.deleteMutation(mutation.id);
        continue;
      }

      await backend.putMutation({
        ...mutation,
        attempts: mutation.attempts + 1,
      });
      failed.push({ mutation, error, retryable: true });
      break;
    }
  }

  const remaining = (await backend.listMutations()).length;
  return { applied, conflicts, failed, remaining };
}
