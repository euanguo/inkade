import {
  asContextPackId,
  assembleContextPack,
  evaluateScopeAccess,
  InkadeError,
  isSystemInternalDocument,
  resolveAllowedSpaceIds,
  slugifyContextPackName,
  summarizeEffectiveScope,
  type AssembleContextPackCandidate,
  type ConnectPingStatus,
  type ContextPack,
  type ContextPackId,
  type CreateContextPackInput,
  type DocumentRecord,
  type RenderedContextPack,
  type UpdateContextPackInput,
  INKADE_MCP_TOOL_NAMES,
} from "@inkade/core";
import type {
  AuditRepo,
  DocumentRepo,
  OutlineRepo,
  SearchConfigRepo,
  SpaceRepo,
  TokenRuleRepo,
  WorkspaceRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import type { AuditService } from "./audit-service.ts";
import { assertAdminPrincipal, getAllWorkspaceSpaces } from "./scope-guard.ts";
import type { ViewQueryService } from "./view-query-service.ts";

export class ContextPackService {
  constructor(
    private readonly deps: {
      readonly searchConfigRepo: SearchConfigRepo;
      readonly documentRepo: DocumentRepo;
      readonly outlineRepo: OutlineRepo;
      readonly spaceRepo: SpaceRepo;
      readonly workspaceRepo: WorkspaceRepo;
      readonly tokenRuleRepo: TokenRuleRepo;
      readonly auditRepo: AuditRepo;
      readonly viewQuery: ViewQueryService;
      readonly spacesCache?: WorkspaceSpacesCache | undefined;
    },
    private readonly sseHub: SseHub,
    private readonly audit?: AuditService,
  ) {}

  async listPacks(principal: Principal): Promise<readonly ContextPack[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    const packs = await this.deps.searchConfigRepo.listContextPacks(principal.workspaceId);

    // Filter space-pinned packs out if caller has zero overlapping access on explicitly targeted spaces
    return packs.filter((pack) => {
      const targetSpaces = pack.rules.spaceIds;
      if (!targetSpaces || targetSpaces.length === 0) return true;
      return targetSpaces.some(
        (spaceId) =>
          evaluateScopeAccess(principal.scope, "read", { spaceId, resourceType: "space" }, allSpaces)
            .allowed,
      );
    });
  }

  async createPack(
    principal: Principal,
    input: CreateContextPackInput,
  ): Promise<ContextPack> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const slug = (input.slug?.trim() || slugifyContextPackName(input.name)).toLowerCase();
    const created = await this.deps.searchConfigRepo.createContextPack(principal.workspaceId, {
      ...input,
      slug,
    });

    this.sseHub.publish({
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      type: "context_pack.updated",
      payload: {
        action: "created",
        packId: created.id,
        slug: created.slug,
      },
    });
    return created;
  }

  async updatePack(
    principal: Principal,
    packId: ContextPackId | string,
    input: UpdateContextPackInput,
  ): Promise<ContextPack> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const updated = await this.deps.searchConfigRepo.updateContextPack(
      principal.workspaceId,
      asContextPackId(packId),
      input,
    );
    this.sseHub.publish({
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      type: "context_pack.updated",
      payload: {
        action: "updated",
        packId: updated.id,
        slug: updated.slug,
      },
    });
    return updated;
  }

  async deletePack(principal: Principal, packId: ContextPackId | string): Promise<void> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const cleanId = asContextPackId(packId);
    await this.deps.searchConfigRepo.deleteContextPack(principal.workspaceId, cleanId);
    this.sseHub.publish({
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      type: "context_pack.updated",
      payload: {
        action: "deleted",
        packId: cleanId,
      },
    });
  }

  private async buildCandidateBody(doc: DocumentRecord): Promise<string> {
    if (doc.kind === "outline") {
      const nodes = await this.deps.outlineRepo.listOutlineNodes(doc.id);
      const active = nodes.filter((n) => n.deletedAt === null);
      if (active.length > 0) {
        const lines = active.map((n) => {
          const check = n.checked === true ? "[x] " : n.checked === false ? "[ ] " : "";
          const text = (n.contentText || n.contentMarkdown).trim();
          const note = (n.noteText || n.noteMarkdown || "").trim();
          return note ? `- ${check}${text}\n  ${note}` : `- ${check}${text}`;
        });
        return lines.join("\n");
      }
    }
    return (doc.contentMarkdown || doc.contentText || "").trim();
  }

  async renderPackBySlug(
    principal: Principal,
    slug: string,
    maxTokensOverride?: number,
  ): Promise<RenderedContextPack> {
    const pack = await this.deps.searchConfigRepo.getContextPackBySlug(
      principal.workspaceId,
      slug.trim().toLowerCase(),
    );
    if (!pack) {
      throw new InkadeError("NOT_FOUND", `Context pack "${slug}" not found`);
    }

    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );

    const allowedSpaces = resolveAllowedSpaceIds(principal.scope, allSpaces);
    let candidateSpaceIds: string[] | undefined;

    if (pack.rules.spaceIds && pack.rules.spaceIds.length > 0) {
      // Expand descendant spaces for pack rule spaces when token permits descendants
      const packSpaceSet = new Set<string>(pack.rules.spaceIds);
      const childrenByParent = new Map<string, string[]>();
      for (const s of allSpaces) {
        if (!s.parentId) continue;
        const arr = childrenByParent.get(s.parentId) ?? [];
        arr.push(s.id);
        childrenByParent.set(s.parentId, arr);
      }
      const q = [...packSpaceSet];
      while (q.length > 0) {
        const cur = q.pop();
        if (!cur) continue;
        for (const child of childrenByParent.get(cur) ?? []) {
          if (!packSpaceSet.has(child)) {
            packSpaceSet.add(child);
            q.push(child);
          }
        }
      }
      const intersection =
        allowedSpaces === "*"
          ? [...packSpaceSet]
          : [...packSpaceSet].filter((id) => allowedSpaces.has(id as never));
      candidateSpaceIds = intersection;
    } else if (allowedSpaces !== "*") {
      candidateSpaceIds = [...allowedSpaces];
    }

    let savedViewDocIds: Set<string> | null = null;
    if (pack.rules.savedViewId) {
      const view = await this.deps.workspaceRepo.getSavedViewById(
        principal.workspaceId,
        pack.rules.savedViewId,
      );
      if (view) {
        const viewRes = await this.deps.viewQuery.queryView(principal, {
          ...(view.filter.spaceId ? { spaceId: view.filter.spaceId } : {}),
          ...(view.filter.kind ? { kind: view.filter.kind } : {}),
          ...(view.filter.tag ? { tag: view.filter.tag } : {}),
          ...(view.filter.pinnedOnly !== undefined ? { pinnedOnly: view.filter.pinnedOnly } : {}),
          ...(view.filter.unreadOnly !== undefined ? { unreadOnly: view.filter.unreadOnly } : {}),
          ...(view.filter.query ? { query: view.filter.query } : {}),
          ...(view.filter.propertyFilter ? { propertyFilter: view.filter.propertyFilter } : {}),
          limit: 500,
          offset: 0,
        });
        savedViewDocIds = new Set(viewRes.documents.map((d) => d.id));
      } else {
        savedViewDocIds = new Set();
      }
    }

    const docs =
      candidateSpaceIds && candidateSpaceIds.length === 0
        ? []
        : await this.deps.documentRepo.listDocuments(principal.workspaceId, {
            spaceIds: candidateSpaceIds as never,
            allowedKinds: principal.scope.allowedKinds,
            tagAllowlist: principal.scope.tagAllowlist,
            includeTrashed: false,
            includeSystem: pack.rules.excludeSystem === false,
            limit: null,
          });

    const cutoffIso =
      pack.rules.recentDays && pack.rules.recentDays > 0
        ? new Date(Date.now() - pack.rules.recentDays * 86_400_000).toISOString()
        : null;
    const pinnedSet = new Set(pack.rules.pinnedDocIds ?? []);
    const ruleTags = pack.rules.tags ?? [];
    const ruleKinds = pack.rules.allowedKinds;

    const authorizedCandidates: AssembleContextPackCandidate[] = [];
    for (const doc of docs) {
      if (doc.trashedAt !== null) continue;
      if (pack.rules.excludeSystem !== false && isSystemInternalDocument(doc)) continue;
      if (
        !evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        ).allowed
      ) {
        continue;
      }

      const isExplicitlyPinned = pinnedSet.has(doc.id);
      if (!isExplicitlyPinned) {
        if (savedViewDocIds !== null && !savedViewDocIds.has(doc.id)) {
          continue;
        }
        if (ruleKinds && ruleKinds.length > 0 && !ruleKinds.includes(doc.kind)) {
          continue;
        }
        if (ruleTags.length > 0 && !ruleTags.some((t) => doc.tags.includes(t))) {
          continue;
        }
        if (cutoffIso && doc.updatedAt < cutoffIso) {
          continue;
        }
      }

      const bodyText = await this.buildCandidateBody(doc);
      authorizedCandidates.push({
        doc,
        bodyText,
        explicitPinned: isExplicitlyPinned,
      });
    }

    // Also evaluate explicitly pinnedDocIds in case they live outside recentDays/savedView (still strictly enforced by TokenScope!)
    for (const pinnedId of pinnedSet) {
      if (authorizedCandidates.some((c) => c.doc.id === pinnedId)) continue;
      const doc = await this.deps.documentRepo.getDocumentById(principal.workspaceId, pinnedId);
      if (!doc || doc.trashedAt !== null) continue;
      if (pack.rules.excludeSystem !== false && isSystemInternalDocument(doc)) continue;
      if (
        !evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        ).allowed
      ) {
        continue;
      }
      const bodyText = await this.buildCandidateBody(doc);
      authorizedCandidates.push({
        doc,
        bodyText,
        explicitPinned: true,
      });
    }

    const rendered = assembleContextPack({
      pack,
      candidates: authorizedCandidates,
      maxTokensOverride,
    });

    if (principal.kind === "token" && this.audit) {
      await this.audit
        .recordCapturedEvent(principal, {
          action: "read_context_pack",
          resource: `context_pack:${pack.slug}`,
          spaceId: null,
          documentId: null,
          decision: "allowed",
          summary: `Context pack "${pack.slug}" (${rendered.totalTokens}/${rendered.budgetTokens} tokens, ${rendered.items.length} docs)`,
          beforeRevisionId: null,
          afterRevisionId: null,
          diffPreview: null,
          reversible: false,
          irreversibleReason: null,
        })
        .catch(() => {});
    }

    return rendered;
  }

  async getConnectStatus(
    principal: Principal,
    requestOrigin: string,
  ): Promise<ConnectPingStatus & { readonly scopeSummary: ReturnType<typeof summarizeEffectiveScope> }> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    const scopeSummary = summarizeEffectiveScope(principal.scope, allSpaces);
    const packs = await this.listPacks(principal);

    let activeTokensCount = 0;
    let recentMcpCalls: ConnectPingStatus["recentMcpCalls"] = [];

    const isAdmin = evaluateScopeAccess(
      principal.scope,
      "admin",
      { spaceId: "*", resourceType: "space" },
      allSpaces,
    ).allowed;

    if (isAdmin) {
      const tokens = await this.deps.tokenRuleRepo.listApiTokens(principal.workspaceId);
      activeTokensCount = tokens.filter((t) => t.revokedAt === null).length;

      const logs = await this.deps.auditRepo.listAuditLogs(principal.workspaceId, {
        transport: "mcp",
        limit: 12,
        offset: 0,
      });
      recentMcpCalls = logs.map((l) => ({
        id: l.id,
        action: l.action,
        resource: l.resource,
        decision: l.decision,
        tokenName: l.tokenName,
        createdAt: l.createdAt,
      }));
    } else if (principal.kind === "token") {
      activeTokensCount = 1;
    }

    const cleanOrigin = requestOrigin.replace(/\/+$/, "");
    return {
      ok: true,
      serverVersion: "0.1.0",
      mcpEndpoint: `${cleanOrigin}/mcp`,
      totalTools: INKADE_MCP_TOOL_NAMES.length,
      principalKind: principal.kind,
      activeTokensCount,
      contextPacksCount: packs.length,
      recentMcpCalls,
      scopeSummary,
    };
  }
}
