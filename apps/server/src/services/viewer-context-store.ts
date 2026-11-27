import {
  evaluateScopeAccess,
  InkadeError,
  type GetViewerContextResult,
  type ParsedUpdateViewerContextInput,
  type ViewerContextSnapshot,
  type WorkspaceId,
} from "@inkade/core";
import type { DocumentRepo, SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export const DEFAULT_VIEWER_CONTEXT_TTL_MS = 30_000;
export const DEFAULT_MAX_VIEWER_CONTEXT_ENTRIES = 1_000;

interface StoredViewerContextEntry {
  readonly snapshot: ViewerContextSnapshot;
  readonly expiresAtMs: number;
}

export interface ViewerContextStoreDeps {
  readonly documentRepo: DocumentRepo;
  readonly spaceRepo: SpaceRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
  readonly ttlMs?: number | undefined;
  readonly maxEntries?: number | undefined;
  readonly now?: (() => number) | undefined;
}

/**
 * Bounded, ephemeral in-memory store for the active human reading focus.
 * Strictly enforces TokenScope visibility without persisting transient view state.
 */
export class ViewerContextStore {
  private readonly entries = new Map<WorkspaceId, StoredViewerContextEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(private readonly deps: ViewerContextStoreDeps) {
    this.ttlMs = Math.max(100, deps.ttlMs ?? DEFAULT_VIEWER_CONTEXT_TTL_MS);
    this.maxEntries = Math.max(1, deps.maxEntries ?? DEFAULT_MAX_VIEWER_CONTEXT_ENTRIES);
    this.now = deps.now ?? (() => Date.now());
  }

  private pruneExpired(nowMs: number): void {
    for (const [workspaceId, entry] of this.entries) {
      if (entry.expiresAtMs <= nowMs) {
        this.entries.delete(workspaceId);
      }
    }
  }

  private enforceCapacity(): void {
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async updateContext(
    principal: Principal,
    input: ParsedUpdateViewerContextInput,
  ): Promise<{ readonly cleared: boolean; readonly context: ViewerContextSnapshot | null }> {
    const nowMs = this.now();
    this.pruneExpired(nowMs);

    if (input.documentId === null) {
      this.entries.delete(principal.workspaceId);
      return { cleared: true, context: null };
    }

    const [doc, allSpaces] = await Promise.all([
      this.deps.documentRepo.getDocumentById(principal.workspaceId, input.documentId),
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${input.documentId}" not found`);
    }

    assertScope(
      principal.scope,
      "read",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    this.entries.delete(principal.workspaceId);
    this.enforceCapacity();

    const snapshot: ViewerContextSnapshot = {
      workspaceId: principal.workspaceId,
      userId: principal.kind === "user" ? principal.userId : null,
      documentId: doc.id,
      documentTitle: doc.title,
      viewMode: input.viewMode,
      headingSlug: input.headingSlug ?? null,
      activeNodeId: input.activeNodeId ?? null,
      selectedQuote: input.selectedQuote ?? null,
      selectedHighlightId: input.selectedHighlightId ?? null,
      updatedAt: new Date(nowMs).toISOString(),
    };

    this.entries.set(principal.workspaceId, {
      snapshot,
      expiresAtMs: nowMs + this.ttlMs,
    });

    return { cleared: false, context: snapshot };
  }

  async getContext(principal: Principal): Promise<GetViewerContextResult> {
    const nowMs = this.now();
    this.pruneExpired(nowMs);

    const entry = this.entries.get(principal.workspaceId);
    if (!entry || entry.expiresAtMs <= nowMs) {
      this.entries.delete(principal.workspaceId);
      return { visible: false, reason: "unavailable" };
    }

    const [doc, allSpaces] = await Promise.all([
      this.deps.documentRepo.getDocumentById(principal.workspaceId, entry.snapshot.documentId),
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      this.entries.delete(principal.workspaceId);
      return { visible: false, reason: "unavailable" };
    }

    const decision = evaluateScopeAccess(
      principal.scope,
      "read",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );
    if (!decision.allowed) {
      // Never leak documentId, documentTitle, headingSlug, or selectedQuote across scope boundaries.
      return { visible: false, reason: "out_of_scope" };
    }

    return {
      visible: true,
      context: {
        ...entry.snapshot,
        documentTitle: doc.title,
      },
    };
  }
}
