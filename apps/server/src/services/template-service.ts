import { renderTemplateVariables } from "@inkade/clipper-core/templates";
import {
  formatUtcIsoDate,
  InkadeError,
  type ApiTokenId,
  type ApplyDocumentTemplateInput,
  type CreateDocumentTemplateInput,
  type DocumentId,
  type DocumentKind,
  type DocumentRecord,
  type DocumentTemplate,
  type OutlineBatchOperation,
  type OutlineNode,
  type TemplateId,
  type UpdateDocumentTemplateInput,
  type UserId,
} from "@inkade/core";
import {
  DEFAULT_SPACE_IDS,
  type DocumentRepo,
  type OutlineRepo,
  type SpaceRepo,
  type WorkspaceRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import type { AuditService } from "./audit-service.ts";
import type { DocumentService } from "./document-service.ts";
import type { OutlineService } from "./outline-service.ts";
import { assertAdminPrincipal, assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export interface TemplateServiceRepos {
  readonly workspaceRepo: WorkspaceRepo;
  readonly documentRepo: DocumentRepo;
  readonly outlineRepo: OutlineRepo;
  readonly spaceRepo: SpaceRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export { renderTemplateVariables };

export function parseMarkdownListToOutlineOps(
  documentId: DocumentId,
  markdown: string,
  actorType: "human" | "agent",
  actorId: UserId | ApiTokenId,
): OutlineBatchOperation[] {
  const lines = markdown.split(/\r?\n/);
  const ops: OutlineBatchOperation[] = [];
  const stack: Array<{ indent: number; tempId: string }> = [];
  let seq = 0;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const match = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/.exec(rawLine);
    const indent = match ? (match[1]?.length ?? 0) : 0;
    let body = (match ? match[2] : rawLine.trim()) ?? "";
    let checked: boolean | null = null;

    const todoMatch = /^\[([ xX])\]\s+(.*)$/.exec(body);
    if (todoMatch) {
      checked = todoMatch[1]?.toLowerCase() === "x";
      body = todoMatch[2] ?? "";
    }

    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
      stack.pop();
    }

    const tempId = `tpl_nod_${++seq}`;
    const parentNodeId = stack.length > 0 ? (stack[stack.length - 1]?.tempId ?? null) : null;
    ops.push({
      op: "create",
      tempId,
      documentId,
      parentNodeId,
      contentMarkdown: body,
      checked,
      collapsed: false,
      authorType: actorType,
      authorId: actorId,
    });
    stack.push({ indent, tempId });
  }

  return ops;
}

export class TemplateService {
  constructor(
    private readonly repos: TemplateServiceRepos,
    private readonly sseHub: SseHub,
    private readonly documentService: DocumentService,
    private readonly outlineService: OutlineService,
    private readonly auditService?: AuditService,
  ) {}

  async listTemplates(
    principal: Principal,
    kind?: DocumentKind,
  ): Promise<readonly DocumentTemplate[]> {
    return this.repos.workspaceRepo.listDocumentTemplates(principal.workspaceId, kind);
  }

  async createTemplate(
    principal: Principal,
    input: CreateDocumentTemplateInput,
  ): Promise<DocumentTemplate> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    const template = await this.repos.workspaceRepo.createDocumentTemplate(
      principal.workspaceId,
      input,
    );
    this.sseHub.publish({
      type: "template.created",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { template },
    });
    return template;
  }

  async updateTemplate(
    principal: Principal,
    templateId: TemplateId,
    input: UpdateDocumentTemplateInput,
  ): Promise<DocumentTemplate> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    const template = await this.repos.workspaceRepo.updateDocumentTemplate(
      principal.workspaceId,
      templateId,
      input,
    );
    this.sseHub.publish({
      type: "template.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { template },
    });
    return template;
  }

  async deleteTemplate(principal: Principal, templateId: TemplateId): Promise<void> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    await this.repos.workspaceRepo.deleteDocumentTemplate(principal.workspaceId, templateId);
    this.sseHub.publish({
      type: "template.deleted",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { templateId },
    });
  }

  async applyTemplate(
    principal: Principal,
    templateId: TemplateId,
    input: ApplyDocumentTemplateInput,
  ): Promise<{ readonly document: DocumentRecord; readonly nodes?: readonly OutlineNode[] | undefined }> {
    const template = await this.repos.workspaceRepo.getDocumentTemplateById(
      principal.workspaceId,
      templateId,
    );
    if (!template) {
      throw new InkadeError("NOT_FOUND", `Document template "${templateId}" not found`);
    }

    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const defaultSpaceId =
      template.kind === "outline"
        ? DEFAULT_SPACE_IDS.daily
        : template.kind === "clip"
          ? DEFAULT_SPACE_IDS.inbox
          : DEFAULT_SPACE_IDS.research;

    const targetSpaceId =
      input.spaceId ??
      allSpaces.find((s) => s.id === defaultSpaceId && s.archivedAt === null)?.id ??
      allSpaces.find((s) => s.defaultKind === template.kind && s.archivedAt === null)?.id ??
      allSpaces.find((s) => s.archivedAt === null)?.id;

    if (!targetSpaceId) {
      throw new InkadeError("NOT_FOUND", "No target space available for template");
    }

    const targetSpace = allSpaces.find((s) => s.id === targetSpaceId);
    if (!targetSpace) {
      throw new InkadeError("NOT_FOUND", `Space "${targetSpaceId}" not found`);
    }

    const tags = input.tags ?? [];
    assertScope(
      principal.scope,
      "write",
      { spaceId: targetSpaceId, kind: template.kind, tags },
      allSpaces,
    );

    const dateStr = input.dailyDate ?? formatUtcIsoDate(new Date());
    const parsedDate = new Date(`${dateStr}T00:00:00Z`);
    const weekday = WEEKDAY_NAMES[parsedDate.getUTCDay()] ?? "Monday";
    const resolvedTitle =
      input.title ??
      (template.kind === "outline" && input.dailyDate
        ? `Daily · ${input.dailyDate}`
        : `${template.name} · ${dateStr}`);

    const renderedMarkdown = renderTemplateVariables(template.contentMarkdown, {
      date: dateStr,
      weekday,
      space: targetSpace.name,
      title: resolvedTitle,
      ...(input.variables ?? {}),
    });

    if (template.kind === "outline") {
      const doc = input.dailyDate
        ? (
            await this.repos.documentRepo.getOrCreateDailyOutline(
              principal.workspaceId,
              targetSpaceId,
              input.dailyDate,
              resolvedTitle,
            )
          ).document
        : await this.documentService.createDocument(principal, {
            spaceId: targetSpaceId,
            kind: "outline",
            title: resolvedTitle,
            contentMarkdown: "",
            tags,
            pinned: false,
          });

      const ops = parseMarkdownListToOutlineOps(
        doc.id,
        renderedMarkdown,
        principal.actorType === "agent" ? "agent" : "human",
        principal.actorId,
      );
      let nodes: readonly OutlineNode[] = await this.repos.outlineRepo.listOutlineNodes(doc.id);
      if (ops.length > 0) {
        const mutate = () =>
          this.outlineService.batchMutate(principal, {
            documentId: doc.id,
            operations: ops,
          });
        const batchRes = this.auditService ? await this.auditService.runSuppressed(mutate) : await mutate();
        nodes = batchRes.nodes;
      }
      return { document: doc, nodes };
    }

    const document = await this.documentService.createDocument(principal, {
      spaceId: targetSpaceId,
      kind: template.kind,
      title: resolvedTitle,
      contentMarkdown: renderedMarkdown,
      tags,
      pinned: false,
    });
    return { document };
  }
}
