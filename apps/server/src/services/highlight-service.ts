import {
  InkadeError,
  type AdeThreadBinding,
  type CreateDocumentHighlightInput,
  type DocumentHighlight,
  type DocumentId,
  type DocumentRecord,
  type HighlightComment,
  type HighlightCommentAuthorType,
  type HighlightCommentThread,
  type HighlightId,
  type HighlightStatus,
  type HighlightWakeDeliveryTarget,
  type ParsedCreateHighlightCommentInput,
  type ParsedSendHighlightToAgentInput,
  type SendHighlightToAgentResult,
  type Space,
  type UpdateDocumentHighlightInput,
  type WakeSenderKind,
} from "@inkade/core";
import type { DocumentRepo, RevisionLinkRepo, SpaceRepo, ThreadBindingRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";
import type { WakeService } from "./wake-service.ts";

export class HighlightService {
  constructor(
    private readonly revisionLinkRepo: RevisionLinkRepo,
    private readonly documentRepo: DocumentRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly sseHub: SseHub,
    private readonly spacesCache?: WorkspaceSpacesCache,
    private readonly wakeService?: WakeService,
    private readonly threadBindingRepo?: ThreadBindingRepo,
  ) {}

  private async loadAuthorizedHighlightDoc(
    principal: Principal,
    highlightId: HighlightId,
    action: "read" | "append" | "write" | "soft_delete",
  ): Promise<{
    readonly highlight: DocumentHighlight;
    readonly doc: DocumentRecord;
    readonly allSpaces: readonly Space[];
  }> {
    const existing = await this.revisionLinkRepo.getDocumentHighlightById(
      principal.workspaceId,
      highlightId,
    );
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `Highlight "${highlightId}" not found`);
    }

    const [doc, allSpaces] = await Promise.all([
      this.documentRepo.getDocumentById(principal.workspaceId, existing.documentId),
      getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || (action !== "soft_delete" && doc.trashedAt !== null)) {
      throw new InkadeError("NOT_FOUND", `Document "${existing.documentId}" not found`);
    }
    assertScope(
      principal.scope,
      action,
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    return { highlight: existing, doc, allSpaces };
  }

  async listHighlights(
    principal: Principal,
    documentId: DocumentId,
  ): Promise<readonly DocumentHighlight[]> {
    const [doc, allSpaces] = await Promise.all([
      this.documentRepo.getDocumentById(principal.workspaceId, documentId),
      getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    assertScope(
      principal.scope,
      "read",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );
    return this.revisionLinkRepo.listDocumentHighlights(principal.workspaceId, documentId);
  }

  async createHighlight(
    principal: Principal,
    documentId: DocumentId,
    input: CreateDocumentHighlightInput,
  ): Promise<DocumentHighlight> {
    const [doc, allSpaces] = await Promise.all([
      this.documentRepo.getDocumentById(principal.workspaceId, documentId),
      getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    assertScope(
      principal.scope,
      "append",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    const highlight = await this.revisionLinkRepo.createDocumentHighlight(
      principal.workspaceId,
      documentId,
      input,
    );

    this.sseHub.publish({
      type: "highlight.created",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { highlight },
    });

    return highlight;
  }

  async updateHighlight(
    principal: Principal,
    highlightId: HighlightId,
    input: UpdateDocumentHighlightInput,
  ): Promise<DocumentHighlight> {
    const existing = await this.revisionLinkRepo.getDocumentHighlightById(
      principal.workspaceId,
      highlightId,
    );
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `Highlight "${highlightId}" not found`);
    }

    const [doc, allSpaces] = await Promise.all([
      this.documentRepo.getDocumentById(principal.workspaceId, existing.documentId),
      getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${existing.documentId}" not found`);
    }
    assertScope(
      principal.scope,
      "write",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    const updated = await this.revisionLinkRepo.updateDocumentHighlight(
      principal.workspaceId,
      highlightId,
      input,
    );

    this.sseHub.publish({
      type: "highlight.updated",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { highlight: updated },
    });

    return updated;
  }

  async deleteHighlight(principal: Principal, highlightId: HighlightId): Promise<void> {
    const existing = await this.revisionLinkRepo.getDocumentHighlightById(
      principal.workspaceId,
      highlightId,
    );
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `Highlight "${highlightId}" not found`);
    }

    const [doc, allSpaces] = await Promise.all([
      this.documentRepo.getDocumentById(principal.workspaceId, existing.documentId),
      getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
    ]);
    if (!doc) {
      throw new InkadeError("NOT_FOUND", `Document "${existing.documentId}" not found`);
    }
    assertScope(
      principal.scope,
      "soft_delete",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    await this.revisionLinkRepo.deleteDocumentHighlight(principal.workspaceId, highlightId);

    this.sseHub.publish({
      type: "highlight.deleted",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { highlightId, documentId: doc.id },
    });
  }

  async listCommentThreads(
    principal: Principal,
    documentId: DocumentId,
    status: HighlightStatus | "all" = "all",
  ): Promise<readonly HighlightCommentThread[]> {
    const highlights = await this.listHighlights(principal, documentId);
    const filteredHighlights =
      status === "all" ? highlights : highlights.filter((hl) => hl.status === status);
    if (filteredHighlights.length === 0) {
      return [];
    }

    const allComments = await this.revisionLinkRepo.listDocumentHighlightComments(
      principal.workspaceId,
      documentId,
    );
    const commentsByHighlight = new Map<HighlightId, HighlightComment[]>();
    for (const comment of allComments) {
      const list = commentsByHighlight.get(comment.highlightId);
      if (list) {
        list.push(comment);
      } else {
        commentsByHighlight.set(comment.highlightId, [comment]);
      }
    }

    return filteredHighlights.map((highlight) => ({
      highlight,
      comments: commentsByHighlight.get(highlight.id) ?? [],
    }));
  }

  async listComments(
    principal: Principal,
    highlightId: HighlightId,
  ): Promise<HighlightCommentThread> {
    const { highlight } = await this.loadAuthorizedHighlightDoc(principal, highlightId, "read");
    const comments = await this.revisionLinkRepo.listHighlightComments(
      principal.workspaceId,
      highlightId,
    );
    return { highlight, comments };
  }

  async addComment(
    principal: Principal,
    highlightId: HighlightId,
    input: ParsedCreateHighlightCommentInput,
  ): Promise<{ readonly highlight: DocumentHighlight; readonly comment: HighlightComment }> {
    const { doc } = await this.loadAuthorizedHighlightDoc(principal, highlightId, "append");

    let authorType: HighlightCommentAuthorType;
    let authorId: string | null;
    let authorName: string;

    if (input.authorType === "collaborator") {
      authorType = "collaborator";
      authorId = principal.actorId;
      authorName = input.authorName?.trim() || "Collaborator";
    } else if (principal.kind === "token") {
      authorType = "agent";
      authorId = principal.tokenId;
      authorName = principal.tokenName || "Agent";
    } else if (input.authorType === "agent") {
      authorType = "agent";
      authorId = principal.userId;
      authorName = input.authorName?.trim() || "Agent";
    } else {
      authorType = "human";
      authorId = principal.userId;
      authorName = input.authorName?.trim() || "Owner";
    }

    const comment = await this.revisionLinkRepo.createHighlightComment(principal.workspaceId, {
      highlightId,
      documentId: doc.id,
      authorType,
      authorId,
      authorName,
      bodyMarkdown: input.bodyMarkdown,
    });

    let refreshed =
      (await this.revisionLinkRepo.getDocumentHighlightById(principal.workspaceId, highlightId)) ??
      (await this.loadAuthorizedHighlightDoc(principal, highlightId, "read")).highlight;

    this.sseHub.publish({
      type: "highlight.comment.created",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { highlight: refreshed, comment },
    });

    if (input.resolve === true) {
      refreshed = await this.setHighlightResolution(principal, highlightId, true);
    }

    return { highlight: refreshed, comment };
  }

  private async setHighlightResolution(
    principal: Principal,
    highlightId: HighlightId,
    resolved: boolean,
  ): Promise<DocumentHighlight> {
    const { doc } = await this.loadAuthorizedHighlightDoc(principal, highlightId, "append");
    const updated = await this.revisionLinkRepo.updateHighlightStatus(
      principal.workspaceId,
      highlightId,
      resolved
        ? {
            status: "resolved",
            resolvedAt: new Date().toISOString(),
            resolvedByType: principal.actorType,
          }
        : {
            status: "open",
            resolvedAt: null,
            resolvedByType: null,
          },
    );

    this.sseHub.publish({
      type: "highlight.resolved",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { highlight: updated, resolved },
    });

    return updated;
  }

  resolveHighlight(principal: Principal, highlightId: HighlightId): Promise<DocumentHighlight> {
    return this.setHighlightResolution(principal, highlightId, true);
  }

  reopenHighlight(principal: Principal, highlightId: HighlightId): Promise<DocumentHighlight> {
    return this.setHighlightResolution(principal, highlightId, false);
  }

  async replyFromAgent(
    principal: Principal,
    input: {
      readonly highlightId: HighlightId;
      readonly bodyMarkdown: string;
      readonly resolve?: boolean | undefined;
    },
  ): Promise<{ readonly highlight: DocumentHighlight; readonly comment: HighlightComment }> {
    return this.addComment(principal, input.highlightId, {
      bodyMarkdown: input.bodyMarkdown,
      authorType: "agent",
      authorName: principal.kind === "token" ? principal.tokenName || "Agent" : "Agent",
      ...(input.resolve !== undefined ? { resolve: input.resolve } : {}),
    });
  }

  async sendHighlightToAgent(
    principal: Principal,
    highlightId: HighlightId,
    input: ParsedSendHighlightToAgentInput = {},
  ): Promise<SendHighlightToAgentResult> {
    if (!this.wakeService) {
      throw new InkadeError("INTERNAL_ERROR", "WakeService is unavailable");
    }

    const { highlight: existing, doc } = await this.loadAuthorizedHighlightDoc(
      principal,
      highlightId,
      "append",
    );

    if (input.bodyMarkdown) {
      const commentAuthorType: HighlightCommentAuthorType =
        principal.kind === "token"
          ? "agent"
          : input.senderType === "collaborator"
            ? "collaborator"
            : "human";
      await this.addComment(principal, highlightId, {
        bodyMarkdown: input.bodyMarkdown,
        authorType: commentAuthorType,
        ...(input.senderName ? { authorName: input.senderName } : {}),
      });
    }

    const comments = await this.revisionLinkRepo.listHighlightComments(
      principal.workspaceId,
      highlightId,
    );

    let targetBindingId = input.bindingId ?? null;
    let deliveryTarget: HighlightWakeDeliveryTarget = "unowned";

    if (targetBindingId) {
      deliveryTarget = "bound_session";
    } else if (input.bridgeSessionId) {
      deliveryTarget = "bridge_session";
    } else if (existing.bindingId && this.threadBindingRepo) {
      const existingBinding = await this.threadBindingRepo.getThreadBindingById(
        principal.workspaceId,
        existing.bindingId,
      );
      if (
        existingBinding &&
        existingBinding.documentId === doc.id &&
        existingBinding.status !== "archived"
      ) {
        targetBindingId = existingBinding.id;
        deliveryTarget = "bound_session";
      }
    } else if (this.threadBindingRepo) {
      const docBindings = await this.threadBindingRepo.listThreadBindings(principal.workspaceId, {
        documentId: doc.id,
      });
      const pickByStatus = (status: AdeThreadBinding["status"]) =>
        docBindings.find((b) => b.status === status);
      const preferred =
        pickByStatus("running") ?? pickByStatus("waiting_input") ?? pickByStatus("queued");
      if (preferred) {
        targetBindingId = preferred.id;
        deliveryTarget = "bound_session";
      }
    }

    const unsentComments = comments.filter((c) => c.sentToAgentAt === null);
    const commentsForPrompt = unsentComments.length > 0 ? unsentComments : comments;

    const hasCollaboratorComment = commentsForPrompt.some(
      (c) => c.authorType === "collaborator",
    );
    const senderKind: WakeSenderKind =
      input.senderType === "collaborator" || hasCollaboratorComment
        ? "collaborator"
        : principal.kind === "user"
          ? "owner"
          : "system";

    const senderName =
      input.senderName?.trim() ||
      (senderKind === "collaborator"
        ? commentsForPrompt.find((c) => c.authorType === "collaborator")?.authorName ||
          "Collaborator"
        : principal.kind === "user"
          ? "Owner"
          : principal.tokenName || "Agent");

    const threadLines = commentsForPrompt.map(
      (c) => `- [${c.authorType}:${c.authorName}] ${c.bodyMarkdown}`,
    );
    const defaultMessageParts = [
      `Highlight (${existing.id}) quote: "${existing.quote}"`,
      ...(existing.noteMarkdown.trim() ? [`Highlight note: ${existing.noteMarkdown.trim()}`] : []),
      ...(threadLines.length > 0 ? ["Thread comments:", ...threadLines] : []),
    ];
    const messageText = input.promptOverride ?? defaultMessageParts.join("\n\n");
    const summarySource =
      commentsForPrompt.at(-1)?.bodyMarkdown ||
      existing.noteMarkdown ||
      existing.quote;
    const summary = `Comment: ${summarySource.replace(/\s+/g, " ").trim()}`.slice(0, 120);

    const wakeEvent = await this.wakeService.enqueueWake(principal, {
      documentId: doc.id,
      bindingId: targetBindingId,
      bridgeSessionId: targetBindingId ? null : (input.bridgeSessionId ?? null),
      highlightId: existing.id,
      reason: deliveryTarget === "unowned" ? "unowned_request" : "comment_sent",
      senderKind,
      senderName,
      summary,
      messageText,
    });

    if (unsentComments.length > 0) {
      await this.revisionLinkRepo.markHighlightCommentsSentToAgent(
        principal.workspaceId,
        unsentComments.map((c) => c.id),
        wakeEvent.id,
        wakeEvent.createdAt,
      );
    }

    if (wakeEvent.bindingId && existing.bindingId !== wakeEvent.bindingId) {
      const bound = await this.revisionLinkRepo.updateDocumentHighlight(
        principal.workspaceId,
        existing.id,
        { bindingId: wakeEvent.bindingId },
      );
      this.sseHub.publish({
        type: "highlight.updated",
        workspaceId: principal.workspaceId,
        spaceId: doc.spaceId,
        documentId: doc.id,
        documentKind: doc.kind,
        tags: doc.tags,
        actorType: principal.actorType,
        payload: { highlight: bound },
      });
    }

    const [refreshedHighlight, updatedComments] = await Promise.all([
      this.revisionLinkRepo.getDocumentHighlightById(principal.workspaceId, highlightId),
      this.revisionLinkRepo.listHighlightComments(principal.workspaceId, highlightId),
    ]);

    return {
      highlight: refreshedHighlight ?? existing,
      comments: updatedComments,
      wakeEvent,
      deliveryTarget,
    };
  }
}
