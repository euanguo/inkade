import {
  createId,
  DEFAULT_HOST_KIND,
  evaluateScopeAccess,
  ID_PREFIXES,
  InkadeError,
  type AdeThreadBinding,
  type AdeThreadStatus,
  type AgentPendingApproval,
  type AgentSteeringNote,
  type ApproveThreadBindingInput,
  type ClaimThreadBindingInput,
  type CreateThreadBindingInput,
  type DocumentId,
  type DocumentRecord,
  type HumanDecisionUrgency,
  type OutlineNodeId,
  type SteerThreadBindingInput,
  type ThreadBindingId,
  type UpdateThreadBindingInput,
} from "@inkade/core";
import type {
  DocumentRepo,
  ListThreadBindingsOptions,
  SpaceRepo,
  ThreadBindingRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import type { AuditService } from "./audit-service.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";
import type { WakeService } from "./wake-service.ts";

export interface ThreadBindingServiceRepos {
  readonly threadBindingRepo: ThreadBindingRepo;
  readonly documentRepo: DocumentRepo;
  readonly spaceRepo: SpaceRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
}

export class ThreadBindingService {
  constructor(
    private readonly repos: ThreadBindingServiceRepos,
    private readonly sseHub: SseHub,
    private readonly auditService?: AuditService,
    private readonly wakeService?: WakeService,
  ) {}

  async listBindings(
    principal: Principal,
    options?: ListThreadBindingsOptions,
  ): Promise<readonly AdeThreadBinding[]> {
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);

    if (options?.documentId) {
      const doc = await this.repos.documentRepo.getDocumentById(principal.workspaceId, options.documentId);
      if (!doc || doc.trashedAt !== null) {
        throw new InkadeError("NOT_FOUND", `Document "${options.documentId}" not found`);
      }
      assertScope(
        principal.scope,
        "read",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      );
    }

    const bindings = await this.repos.threadBindingRepo.listThreadBindings(principal.workspaceId, options);
    if (bindings.length === 0) return [];

    const docCache = new Map<DocumentId, DocumentRecord | null>();
    const uniqueDocIds = [...new Set(bindings.map((b) => b.documentId))];
    await Promise.all(
      uniqueDocIds.map(async (docId) => {
        const doc = await this.repos.documentRepo.getDocumentById(principal.workspaceId, docId);
        docCache.set(docId, doc);
      }),
    );

    return bindings.filter((binding) => {
      const doc = docCache.get(binding.documentId);
      if (!doc || doc.trashedAt !== null) return false;
      return evaluateScopeAccess(
        principal.scope,
        "read",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      ).allowed;
    });
  }

  async getBinding(
    principal: Principal,
    bindingId: ThreadBindingId,
    options?: { readonly consumeSteering?: boolean | undefined },
  ): Promise<AdeThreadBinding> {
    const binding = await this.repos.threadBindingRepo.getThreadBindingById(principal.workspaceId, bindingId);
    if (!binding) {
      throw new InkadeError("NOT_FOUND", `Thread binding "${bindingId}" not found`);
    }

    const [doc, allSpaces] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, binding.documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${binding.documentId}" not found`);
    }

    const consumeSteering = options?.consumeSteering === true;
    assertScope(
      principal.scope,
      consumeSteering ? "append" : "read",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    if (consumeSteering && binding.steeringQueue && binding.steeringQueue.some((n) => !n.deliveredAt)) {
      const now = new Date().toISOString();
      const nextQueue = binding.steeringQueue.map((note) =>
        note.deliveredAt === null ? { ...note, deliveredAt: now } : note,
      );
      const updated = await this.repos.threadBindingRepo.updateThreadBinding(principal.workspaceId, bindingId, {
        steeringQueue: nextQueue,
        lastSyncedAt: now,
      });
      this.sseHub.publish({
        type: "thread.binding.updated",
        workspaceId: principal.workspaceId,
        spaceId: doc.spaceId,
        documentId: doc.id,
        documentKind: doc.kind,
        tags: doc.tags,
        actorType: principal.actorType,
        payload: { binding: updated },
      });
      return updated;
    }

    return binding;
  }

  async upsertBinding(
    principal: Principal,
    input: CreateThreadBindingInput,
  ): Promise<AdeThreadBinding> {
    const [doc, allSpaces, existing] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, input.documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
      this.repos.threadBindingRepo.getThreadBindingByExternal(
        principal.workspaceId,
        input.adeKind ?? DEFAULT_HOST_KIND,
        input.externalThreadId,
      ),
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

    if (existing && existing.documentId !== input.documentId) {
      const previousDoc = await this.repos.documentRepo.getDocumentById(
        principal.workspaceId,
        existing.documentId,
      );
      if (previousDoc) {
        assertScope(
          principal.scope,
          "append",
          {
            spaceId: previousDoc.spaceId,
            kind: previousDoc.kind,
            tags: previousDoc.tags,
          },
          allSpaces,
        );
      }
    }

    const binding = await this.repos.threadBindingRepo.upsertThreadBinding(principal.workspaceId, input);
    this.sseHub.publish({
      type: existing ? "thread.binding.updated" : "thread.binding.created",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { binding },
    });
    return binding;
  }

  async updateBinding(
    principal: Principal,
    bindingId: ThreadBindingId,
    input: UpdateThreadBindingInput,
  ): Promise<AdeThreadBinding> {
    const binding = await this.repos.threadBindingRepo.getThreadBindingById(principal.workspaceId, bindingId);
    if (!binding) {
      throw new InkadeError("NOT_FOUND", `Thread binding "${bindingId}" not found`);
    }

    const [doc, allSpaces] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, binding.documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${binding.documentId}" not found`);
    }

    assertScope(
      principal.scope,
      "append",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    const normalizedInput: UpdateThreadBindingInput =
      input.status === undefined && input.pendingApproval && !input.pendingApproval.decision
        ? { ...input, status: "waiting_input" }
        : input;

    const updated = await this.repos.threadBindingRepo.updateThreadBinding(
      principal.workspaceId,
      bindingId,
      normalizedInput,
    );
    await this.auditService?.captureOrRecord(principal, {
      spaceId: doc.spaceId,
      documentId: doc.id,
      reversible: false,
      irreversibleReason: "Thread binding metadata update",
      fallbackAction: "thread.binding.update",
      fallbackResource: `thread-binding:${bindingId}`,
    });
    this.sseHub.publish({
      type: "thread.binding.updated",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { binding: updated },
    });
    return updated;
  }

  async approveBinding(
    principal: Principal,
    bindingId: ThreadBindingId,
    input: ApproveThreadBindingInput,
  ): Promise<AdeThreadBinding> {
    const binding = await this.repos.threadBindingRepo.getThreadBindingById(principal.workspaceId, bindingId);
    if (!binding) {
      throw new InkadeError("NOT_FOUND", `Thread binding "${bindingId}" not found`);
    }

    const [doc, allSpaces] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, binding.documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${binding.documentId}" not found`);
    }

    assertScope(
      principal.scope,
      "write",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    const now = new Date().toISOString();
    const nextPendingApproval: AgentPendingApproval = {
      id: binding.pendingApproval?.id ?? createId(ID_PREFIXES.approval),
      action: binding.pendingApproval?.action ?? binding.title,
      risk: binding.pendingApproval?.risk ?? "medium",
      ...(binding.pendingApproval?.requestKind !== undefined
        ? { requestKind: binding.pendingApproval.requestKind }
        : {}),
      ...(binding.pendingApproval?.question !== undefined
        ? { question: binding.pendingApproval.question }
        : {}),
      ...(binding.pendingApproval?.context !== undefined
        ? { context: binding.pendingApproval.context }
        : {}),
      ...(binding.pendingApproval?.options !== undefined
        ? { options: binding.pendingApproval.options }
        : {}),
      ...(binding.pendingApproval?.urgency !== undefined
        ? { urgency: binding.pendingApproval.urgency }
        : {}),
      ...(binding.pendingApproval?.diffPreview !== undefined
        ? { diffPreview: binding.pendingApproval.diffPreview }
        : {}),
      ...(binding.pendingApproval?.expiresAt !== undefined
        ? { expiresAt: binding.pendingApproval.expiresAt }
        : {}),
      decision: input.decision,
      decisionNote: input.note ?? null,
      decidedAt: now,
    };
    const nextStatus: AdeThreadStatus = input.decision === "denied" ? "failed" : "running";
    const isBlockingQuestion = binding.pendingApproval?.requestKind === "blocking_question";
    const wakeReason = isBlockingQuestion ? "blocking_reply" : "approval_decision";
    const wakeMessage = input.note?.trim()
      ? `${input.decision}: ${input.note.trim()}`
      : `Decision: ${input.decision}${input.alwaysAllow ? " (alwaysAllow)" : ""}`;

    await this.wakeService?.assertRateLimitAvailable(principal.workspaceId, {
      bindingId,
      documentId: doc.id,
    });

    const updated = await this.repos.threadBindingRepo.updateThreadBinding(principal.workspaceId, bindingId, {
      status: nextStatus,
      unreadResult: false,
      pendingApproval: nextPendingApproval,
      lastSyncedAt: now,
    });

    await this.auditService?.recordCapturedEvent(principal, {
      action: "thread.binding.approve",
      resource: `thread-binding:${bindingId}`,
      spaceId: doc.spaceId,
      documentId: doc.id,
      reversible: false,
      irreversibleReason: "Approval decision dispatched to agent binding",
      summary: `Approval ${input.decision} on "${binding.title}"${input.alwaysAllow ? " (alwaysAllow)" : ""}`,
    });

    this.sseHub.publish({
      type: "thread.binding.approved",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: {
        binding: updated,
        decision: input.decision,
        alwaysAllow: input.alwaysAllow ?? false,
      },
    });

    await this.wakeService?.enqueueWake(principal, {
      documentId: doc.id,
      bindingId: updated.id,
      reason: wakeReason,
      senderKind: principal.kind === "user" ? "owner" : "system",
      senderName: principal.kind === "user" ? "Owner" : principal.tokenName,
      nodeId: updated.nodeId,
      summary: `${isBlockingQuestion ? "Reply" : "Approval"} (${input.decision}): ${binding.title}`.slice(0, 120),
      messageText: wakeMessage,
    });

    return updated;
  }

  async steerBinding(
    principal: Principal,
    bindingId: ThreadBindingId,
    input: SteerThreadBindingInput,
  ): Promise<AdeThreadBinding> {
    const binding = await this.repos.threadBindingRepo.getThreadBindingById(principal.workspaceId, bindingId);
    if (!binding) {
      throw new InkadeError("NOT_FOUND", `Thread binding "${bindingId}" not found`);
    }

    const [doc, allSpaces] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, binding.documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${binding.documentId}" not found`);
    }

    assertScope(
      principal.scope,
      "append",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    await this.wakeService?.assertRateLimitAvailable(principal.workspaceId, {
      bindingId,
      documentId: doc.id,
    });

    const now = new Date().toISOString();
    const note: AgentSteeringNote = {
      id: createId(ID_PREFIXES.steeringNote),
      text: input.text,
      mode: input.mode,
      createdAt: now,
      deliveredAt: null,
    };
    const nextQueue = [...(binding.steeringQueue ?? []), note];

    const updated = await this.repos.threadBindingRepo.updateThreadBinding(principal.workspaceId, bindingId, {
      steeringQueue: nextQueue,
      lastSyncedAt: now,
    });

    await this.auditService?.recordCapturedEvent(principal, {
      action: "thread.binding.steer",
      resource: `thread-binding:${bindingId}`,
      spaceId: doc.spaceId,
      documentId: doc.id,
      reversible: false,
      irreversibleReason: "Steering note queued for external thread",
      summary: `Queued ${input.mode} steering note on "${binding.title}"`,
    });

    this.sseHub.publish({
      type: "thread.binding.steered",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { binding: updated, note },
    });

    await this.wakeService?.enqueueWake(principal, {
      documentId: doc.id,
      bindingId: updated.id,
      reason: "steering",
      senderKind: principal.kind === "user" ? "owner" : "system",
      senderName: principal.kind === "user" ? "Owner" : principal.tokenName,
      nodeId: updated.nodeId,
      summary: input.text.trim().slice(0, 120),
      messageText: input.text,
    });

    return updated;
  }

  async claimBinding(
    principal: Principal,
    bindingId: ThreadBindingId,
    input: ClaimThreadBindingInput,
  ): Promise<AdeThreadBinding> {
    const binding = await this.repos.threadBindingRepo.getThreadBindingById(principal.workspaceId, bindingId);
    if (!binding) {
      throw new InkadeError("NOT_FOUND", `Thread binding "${bindingId}" not found`);
    }

    const [doc, allSpaces] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, binding.documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${binding.documentId}" not found`);
    }

    assertScope(
      principal.scope,
      "append",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    const claimed = await this.repos.threadBindingRepo.claimThreadBinding(principal.workspaceId, bindingId, input);
    this.sseHub.publish({
      type: "thread.binding.claimed",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { binding: claimed },
    });
    await this.wakeService?.claimUnownedForBinding(principal, claimed);
    return claimed;
  }

  /**
   * Routes a true blocking ambiguity from an agent directly into Inbox Exceptions without
   * letting routine writes spam approval queues (rate-limited per active document/binding).
   */
  async requestHumanDecision(
    principal: Principal,
    input: {
      readonly documentId?: DocumentId | undefined;
      readonly bindingId?: ThreadBindingId | undefined;
      readonly nodeId?: OutlineNodeId | undefined;
      readonly question: string;
      readonly context?: string | undefined;
      readonly options?: readonly string[] | undefined;
      readonly urgency?: HumanDecisionUrgency | undefined;
    },
  ): Promise<{ readonly binding: AdeThreadBinding; readonly questionId: string }> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );

    let existingBinding: AdeThreadBinding | null = null;
    if (input.bindingId) {
      existingBinding = await this.repos.threadBindingRepo.getThreadBindingById(
        principal.workspaceId,
        input.bindingId,
      );
      if (!existingBinding) {
        throw new InkadeError("NOT_FOUND", `Thread binding "${input.bindingId}" not found`);
      }
    }

    const targetDocId = input.documentId ?? existingBinding?.documentId;
    if (!targetDocId) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "Either documentId or bindingId is required when requesting a human decision",
      );
    }

    const doc = await this.repos.documentRepo.getDocumentById(principal.workspaceId, targetDocId);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${targetDocId}" not found`);
    }

    assertScope(
      principal.scope,
      "append",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    // Anti-flood guard: cap excessive unresolved blocking questions per workspace
    const currentBindings = await this.repos.threadBindingRepo.listThreadBindings(
      principal.workspaceId,
    );
    const unresolvedCount = currentBindings.filter(
      (b) => b.status === "waiting_input" && b.pendingApproval && !b.pendingApproval.decision,
    ).length;
    if (!existingBinding) {
      const reusable = currentBindings.find(
        (b) =>
          b.documentId === doc.id &&
          b.status === "waiting_input" &&
          b.pendingApproval?.requestKind === "blocking_question" &&
          !b.pendingApproval.decision,
      );
      if (reusable) {
        existingBinding = reusable;
      } else if (unresolvedCount >= 20) {
        throw new InkadeError(
          "CONFLICT",
          "Too many unresolved human decision requests in Inbox Exceptions; resolve existing questions before opening new ones.",
        );
      }
    }

    const now = new Date().toISOString();
    const urgency: HumanDecisionUrgency = input.urgency ?? "normal";
    const questionId = createId(ID_PREFIXES.approval);
    const pendingApproval: AgentPendingApproval = {
      id: questionId,
      action: input.question,
      risk: urgency === "high" ? "high" : "medium",
      requestKind: "blocking_question",
      question: input.question,
      ...(input.context ? { context: input.context } : {}),
      ...(input.options && input.options.length > 0 ? { options: [...input.options] } : {}),
      urgency,
    };

    let binding: AdeThreadBinding;
    if (existingBinding) {
      binding = await this.repos.threadBindingRepo.updateThreadBinding(
        principal.workspaceId,
        existingBinding.id,
        {
          status: "waiting_input",
          unreadResult: true,
          lastSummary: input.question,
          pendingApproval,
          lastSyncedAt: now,
        },
      );
    } else {
      const threadSuffix = createId(ID_PREFIXES.agentStep);
      binding = await this.repos.threadBindingRepo.upsertThreadBinding(principal.workspaceId, {
        documentId: doc.id,
        nodeId: input.nodeId ?? null,
        adeKind: DEFAULT_HOST_KIND,
        externalThreadId: `decision_${threadSuffix}`,
        title: input.question.slice(0, 120),
        status: "waiting_input",
        lastSummary: input.question,
        unreadResult: true,
        pendingApproval,
      });
    }

    await this.auditService?.captureOrRecord(principal, {
      spaceId: doc.spaceId,
      documentId: doc.id,
      reversible: false,
      irreversibleReason: "Human decision request queued in Exceptions bucket",
      summary: `Requested human decision on "${doc.title}": ${input.question}`,
      fallbackAction: "request_human_decision",
      fallbackResource: `thread-binding:${binding.id}`,
    });

    this.sseHub.publish({
      type: "thread.binding.updated",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { binding },
    });

    return { binding, questionId };
  }

  async deleteBinding(principal: Principal, bindingId: ThreadBindingId): Promise<void> {
    const binding = await this.repos.threadBindingRepo.getThreadBindingById(principal.workspaceId, bindingId);
    if (!binding) {
      throw new InkadeError("NOT_FOUND", `Thread binding "${bindingId}" not found`);
    }

    const [doc, allSpaces] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, binding.documentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);
    if (!doc) {
      throw new InkadeError("NOT_FOUND", `Document "${binding.documentId}" not found`);
    }

    assertScope(
      principal.scope,
      "soft_delete",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    await this.repos.threadBindingRepo.deleteThreadBinding(principal.workspaceId, bindingId);
    this.sseHub.publish({
      type: "thread.binding.deleted",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { bindingId, documentId: doc.id },
    });
  }
}
