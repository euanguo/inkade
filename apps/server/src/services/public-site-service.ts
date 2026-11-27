import { Feed } from "feed";
import {
  asSpaceId,
  assertGovernanceAllowed,
  evaluateViewQueryOnDocuments,
  extractArtifactBlocks,
  extractInkadeViewBlocks,
  InkadeError,
  INTERNAL_HIDDEN_PROPERTY_KEYS,
  isSystemInternalDocument,
  parseMarkdownWithFrontmatter,
  publicSiteSlugSchema,
  renderOutlineNodesToMarkdown,
  replaceInkadeArtifactFencesWithFallback,
  slugifyTitle,
  type CreatePublicSiteInput,
  type DocumentId,
  type DocumentRecord,
  type DocumentSummary,
  type InkadeViewSpec,
  type OutlineNode,
  type PropertyFieldDefinition,
  type PublicSite,
  type PublicSiteBacklinkRef,
  type PublicSiteDocDetail,
  type PublicSiteDocSummary,
  type PublicSiteDocumentPayload,
  type PublicSiteId,
  type PublicSiteMeta,
  type PublicSitePayload,
  type PublicSiteSpaceInfo,
  type SavedViewFilter,
  type Space,
  type SpaceId,
  type UpdatePublicSiteInput,
  type ViewQueryResponse,
  type WorkspaceId,
} from "@inkade/core";
import type {
  AttachmentRepo,
  DocumentRepo,
  OutlineRepo,
  RevisionLinkRepo,
  SpaceRepo,
  WorkspaceRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import { buildStaticGardenZip, renderGardenMarkdownToHtml } from "./garden-export.ts";
import { assertAdminPrincipal, getAllWorkspaceSpaces } from "./scope-guard.ts";

export interface PublicSiteServiceRepos {
  readonly spaceRepo: SpaceRepo;
  readonly workspaceRepo: WorkspaceRepo;
  readonly documentRepo: DocumentRepo;
  readonly outlineRepo: OutlineRepo;
  readonly revisionLinkRepo: RevisionLinkRepo;
  readonly attachmentRepo?: AttachmentRepo | undefined;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
}

function collectSpaceSubtreeIds(rootId: SpaceId, allSpaces: readonly Space[]): Set<SpaceId> {
  const childrenByParent = new Map<SpaceId, SpaceId[]>();
  for (const space of allSpaces) {
    if (space.archivedAt !== null || !space.parentId) continue;
    const list = childrenByParent.get(space.parentId) ?? [];
    list.push(space.id);
    childrenByParent.set(space.parentId, list);
  }
  const result = new Set<SpaceId>([rootId]);
  const queue: SpaceId[] = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const childId of childrenByParent.get(current) ?? []) {
      if (result.has(childId)) continue;
      result.add(childId);
      queue.push(childId);
    }
  }
  return result;
}

function sanitizeExposedFieldKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (!key || key.startsWith("_") || INTERNAL_HIDDEN_PROPERTY_KEYS.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    clean.push(key);
  }
  return clean;
}

function sanitizeProperties(
  rawProps: Readonly<Record<string, unknown>> | null | undefined,
  allowedFieldSet: ReadonlySet<string>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (!rawProps) return safe;
  for (const [key, value] of Object.entries(rawProps)) {
    if (!allowedFieldSet.has(key)) continue;
    if (INTERNAL_HIDDEN_PROPERTY_KEYS.has(key) || key.startsWith("_")) continue;
    safe[key] = value;
  }
  return safe;
}

function toPublicMeta(site: PublicSite): PublicSiteMeta {
  return {
    id: site.id,
    slug: site.slug,
    title: site.title,
    subtitle: site.subtitle,
    sourceType: site.sourceType,
    sourceId: site.sourceId,
    exposedFields: sanitizeExposedFieldKeys(site.exposedFields),
    enableRss: site.enableRss,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
}

function matchesSavedViewFilter(
  doc: DocumentRecord,
  filter: SavedViewFilter,
  allSpaces: readonly Space[],
  allSchemaFields: readonly PropertyFieldDefinition[],
): boolean {
  const { contentMarkdown: _m, contentJson: _j, contentText: _t, ...summaryBase } = doc;
  const matchingSpaceIds = filter.spaceId
    ? collectSpaceSubtreeIds(filter.spaceId, allSpaces)
    : null;
  const evaluated = evaluateViewQueryOnDocuments(
    [summaryBase],
    allSchemaFields,
    {
      spaceId: filter.spaceId,
      kind: filter.kind,
      tag: filter.tag,
      pinnedOnly: filter.pinnedOnly,
      unreadOnly: filter.unreadOnly,
      query: filter.query,
      filter: filter.propertyFilter,
      limit: 1,
      offset: 0,
    },
    { matchingSpaceIds },
  );
  if (evaluated.totalCount > 0) return true;
  if (filter.query && filter.query.trim()) {
    const q = filter.query.trim().toLowerCase();
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.excerpt.toLowerCase().includes(q) ||
      doc.contentText.toLowerCase().includes(q)
    );
  }
  return false;
}

interface ResolvedGardenContext {
  readonly site: PublicSite;
  readonly meta: PublicSiteMeta;
  readonly spaces: readonly PublicSiteSpaceInfo[];
  readonly schemaFields: readonly PropertyFieldDefinition[];
  readonly visibleDocs: readonly DocumentRecord[];
  readonly visibleSummaries: readonly PublicSiteDocSummary[];
  readonly sanitizedSummaryDocs: readonly DocumentSummary[];
}

export class PublicSiteService {
  constructor(
    private readonly repos: PublicSiteServiceRepos,
    private readonly _sseHub: SseHub,
  ) {}

  private normalizeSlugOrGenerate(rawSlug: string | undefined, fallbackTitle: string): string {
    const candidate = rawSlug?.trim() || slugifyTitle(fallbackTitle);
    const parsed = publicSiteSlugSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? `Invalid public site slug "${candidate}"`,
      );
    }
    return parsed.data;
  }

  private async validateSourceTarget(
    workspaceId: WorkspaceId,
    sourceType: PublicSite["sourceType"],
    sourceId: string,
    allSpaces: readonly Space[],
  ): Promise<void> {
    if (sourceType === "space") {
      const target = allSpaces.find((s) => s.id === sourceId && s.archivedAt === null);
      if (!target) {
        throw new InkadeError("NOT_FOUND", `Space "${sourceId}" not found`);
      }
      return;
    }
    const view = await this.repos.workspaceRepo.getSavedViewById(workspaceId, sourceId);
    if (!view) {
      throw new InkadeError("NOT_FOUND", `Saved view "${sourceId}" not found`);
    }
  }

  async listPublicSites(principal: Principal): Promise<readonly PublicSite[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    return this.repos.spaceRepo.listPublicSites(principal.workspaceId);
  }

  async createPublicSite(
    principal: Principal,
    input: CreatePublicSiteInput,
  ): Promise<PublicSite> {
    assertGovernanceAllowed(principal.kind, principal.scope, "public_site.create");
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    await this.validateSourceTarget(principal.workspaceId, input.sourceType, input.sourceId, allSpaces);

    const slug = this.normalizeSlugOrGenerate(input.slug, input.title);
    const exposedFields = sanitizeExposedFieldKeys(input.exposedFields ?? []);
    const created = await this.repos.spaceRepo.createPublicSite(principal.workspaceId, {
      ...input,
      slug,
      exposedFields,
    });
    return created;
  }

  async updatePublicSite(
    principal: Principal,
    siteId: PublicSiteId,
    input: UpdatePublicSiteInput,
  ): Promise<PublicSite> {
    assertGovernanceAllowed(principal.kind, principal.scope, "public_site.update");
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const current = await this.repos.spaceRepo.getPublicSiteById(principal.workspaceId, siteId);
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Public site "${siteId}" not found`);
    }

    const nextSourceType = input.sourceType ?? current.sourceType;
    const nextSourceId = input.sourceId ?? current.sourceId;
    if (input.sourceType !== undefined || input.sourceId !== undefined) {
      await this.validateSourceTarget(principal.workspaceId, nextSourceType, nextSourceId, allSpaces);
    }

    const nextSlug =
      input.slug !== undefined ? this.normalizeSlugOrGenerate(input.slug, input.title ?? current.title) : undefined;
    const nextExposedFields =
      input.exposedFields !== undefined ? sanitizeExposedFieldKeys(input.exposedFields) : undefined;

    return this.repos.spaceRepo.updatePublicSite(principal.workspaceId, siteId, {
      ...input,
      ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
      ...(nextExposedFields !== undefined ? { exposedFields: nextExposedFields } : {}),
    });
  }

  async deletePublicSite(principal: Principal, siteId: PublicSiteId): Promise<void> {
    assertGovernanceAllowed(principal.kind, principal.scope, "public_site.delete");
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    await this.repos.spaceRepo.deletePublicSite(principal.workspaceId, siteId);
  }

  private async resolveGardenContext(
    site: PublicSite,
  ): Promise<ResolvedGardenContext> {
    const meta = toPublicMeta(site);
    const allowedFieldSet = new Set(meta.exposedFields);

    const [allSpaces, schemas, workspaceDocs] = await Promise.all([
      this.repos.spaceRepo.listSpaces(site.workspaceId, { includeArchived: false }),
      this.repos.spaceRepo.listSpacePropertySchemas(site.workspaceId),
      this.repos.documentRepo.listDocuments(site.workspaceId, {
        includeTrashed: false,
        limit: null,
      }),
    ]);

    const activeSpaces = allSpaces.filter((s) => s.archivedAt === null);
    const schemaBySpaceId = new Map<SpaceId, readonly PropertyFieldDefinition[]>();
    const allSchemaFieldMap = new Map<string, PropertyFieldDefinition>();
    for (const schema of schemas) {
      if (schema.spaceId) {
        schemaBySpaceId.set(schema.spaceId, schema.fields);
        for (const field of schema.fields) {
          allSchemaFieldMap.set(field.key, field);
        }
      }
    }

    let matchingDocs: DocumentRecord[] = [];
    if (site.sourceType === "space") {
      const targetSpaceExists = activeSpaces.some((s) => s.id === site.sourceId);
      if (targetSpaceExists) {
        const spaceIds = collectSpaceSubtreeIds(asSpaceId(site.sourceId), activeSpaces);
        matchingDocs = workspaceDocs.filter(
          (doc) =>
            doc.trashedAt === null &&
            !isSystemInternalDocument(doc) &&
            spaceIds.has(doc.spaceId),
        );
      }
    } else {
      const savedView = await this.repos.workspaceRepo.getSavedViewById(
        site.workspaceId,
        site.sourceId,
      );
      if (savedView) {
        const allSchemaFields = schemas.flatMap((s) => s.fields);
        matchingDocs = workspaceDocs.filter(
          (doc) =>
            doc.trashedAt === null &&
            !isSystemInternalDocument(doc) &&
            matchesSavedViewFilter(doc, savedView.filter, activeSpaces, allSchemaFields),
        );
      }
    }

    matchingDocs.sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title),
    );

    const visibleSpaceIds = new Set(matchingDocs.map((d) => d.spaceId));
    if (site.sourceType === "space") {
      for (const sid of collectSpaceSubtreeIds(asSpaceId(site.sourceId), activeSpaces)) {
        visibleSpaceIds.add(sid);
      }
    }
    const exposedSpaces: PublicSiteSpaceInfo[] = activeSpaces
      .filter((space) => visibleSpaceIds.has(space.id))
      .map((space) => ({
        id: space.id,
        parentId: space.parentId && visibleSpaceIds.has(space.parentId) ? space.parentId : null,
        name: space.name,
        slug: space.slug,
      }));

    const seenSchemaKeys = new Set<string>();
    const schemaFields: PropertyFieldDefinition[] = [];
    for (const spaceId of visibleSpaceIds) {
      for (const field of schemaBySpaceId.get(spaceId) ?? []) {
        if (!allowedFieldSet.has(field.key) || seenSchemaKeys.has(field.key)) continue;
        seenSchemaKeys.add(field.key);
        schemaFields.push(field);
      }
    }

    const sanitizedSummaryDocs: DocumentSummary[] = [];
    const visibleSummaries: PublicSiteDocSummary[] = matchingDocs.map((doc) => {
      const safeProps = sanitizeProperties(doc.properties, allowedFieldSet);
      const { contentMarkdown: _m, contentJson: _j, contentText: _t, ...summaryBase } = doc;
      sanitizedSummaryDocs.push({
        ...summaryBase,
        properties: safeProps,
        pinned: false,
        unreadAgentUpdate: false,
      });
      return {
        id: doc.id,
        spaceId: doc.spaceId,
        kind: doc.kind,
        slug: doc.slug,
        title: doc.title,
        tags: doc.tags,
        excerpt: doc.excerpt,
        sourceUrl: doc.sourceUrl,
        properties: safeProps,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    });

    return {
      site,
      meta,
      spaces: exposedSpaces,
      schemaFields,
      visibleDocs: matchingDocs,
      visibleSummaries,
      sanitizedSummaryDocs,
    };
  }

  private async sanitizePublicArtifactMarkdown(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
    markdown: string,
  ): Promise<string> {
    if (extractArtifactBlocks(markdown).length === 0) {
      return markdown;
    }
    const summaries = this.repos.attachmentRepo
      ? await this.repos.attachmentRepo.listDocumentArtifactsByDocument(workspaceId, documentId)
      : [];
    const artifactsById = new Map(
      summaries.map((item) => [
        item.id,
        { title: item.title, fallbackMarkdown: item.fallbackMarkdown },
      ]),
    );
    return replaceInkadeArtifactFencesWithFallback(markdown, artifactsById);
  }

  private async resolveDocDetail(
    ctx: ResolvedGardenContext,
    doc: DocumentRecord,
  ): Promise<{
    readonly detail: PublicSiteDocDetail;
    readonly outlineNodes?: readonly OutlineNode[] | undefined;
  }> {
    const visibleById = new Map(ctx.visibleSummaries.map((d) => [d.id, d]));
    const allowedFieldSet = new Set(ctx.meta.exposedFields);
    const { bodyMarkdown: rawBodyMarkdown } = parseMarkdownWithFrontmatter(doc.contentMarkdown);
    const bodyMarkdown = await this.sanitizePublicArtifactMarkdown(
      ctx.site.workspaceId,
      doc.id,
      rawBodyMarkdown,
    );

    const [outlineNodes, rawBacklinks] = await Promise.all([
      doc.kind === "outline"
        ? this.repos.outlineRepo.listOutlineNodes(doc.id)
        : Promise.resolve(undefined),
      this.repos.revisionLinkRepo.listBacklinks(ctx.site.workspaceId, doc.id),
    ]);

    const backlinkSeen = new Set<DocumentId>();
    const backlinks: PublicSiteBacklinkRef[] = [];
    for (const link of rawBacklinks) {
      const src = visibleById.get(link.sourceDocumentId);
      if (!src || src.id === doc.id || backlinkSeen.has(src.id)) continue;
      backlinkSeen.add(src.id);
      backlinks.push({
        id: src.id,
        slug: src.slug,
        title: src.title,
        excerpt: src.excerpt,
      });
    }

    const extracted = extractInkadeViewBlocks(bodyMarkdown);
    const validBlocks = extracted.filter(
      (b): b is {
        readonly raw: string;
        readonly parsed: { readonly ok: true; readonly spec: InkadeViewSpec };
      } => b.parsed.ok,
    );

    let embeddedViews: Record<string, ViewQueryResponse> | undefined;
    if (validBlocks.length > 0) {
      embeddedViews = {};
      for (const block of validBlocks) {
        const snapshot = evaluateViewQueryOnDocuments(
          ctx.sanitizedSummaryDocs,
          ctx.schemaFields,
          block.parsed.spec,
        );
        embeddedViews[block.raw] = snapshot;
        const trimmed = block.raw.trim();
        if (trimmed !== block.raw) {
          embeddedViews[trimmed] = snapshot;
        }
      }
    }

    const detail: PublicSiteDocDetail = {
      id: doc.id,
      spaceId: doc.spaceId,
      kind: doc.kind,
      slug: doc.slug,
      title: doc.title,
      tags: doc.tags,
      excerpt: doc.excerpt,
      sourceUrl: doc.sourceUrl,
      properties: sanitizeProperties(doc.properties, allowedFieldSet),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      contentMarkdown: bodyMarkdown,
      ...(outlineNodes ? { outlineNodes } : {}),
      backlinks,
      ...(embeddedViews ? { embeddedViews } : {}),
    };

    return { detail, outlineNodes };
  }

  private async requireEnabledSiteBySlug(slug: string): Promise<PublicSite> {
    const site = await this.repos.spaceRepo.getPublicSiteBySlug(slug);
    if (!site || !site.enabled) {
      throw new InkadeError("NOT_FOUND", `Public garden "${slug}" not found`);
    }
    return site;
  }

  async getPublicSite(slug: string): Promise<PublicSitePayload> {
    const site = await this.requireEnabledSiteBySlug(slug);
    const ctx = await this.resolveGardenContext(site);
    const firstDoc = ctx.visibleDocs[0];
    const resolvedFirst = firstDoc ? await this.resolveDocDetail(ctx, firstDoc) : undefined;

    return {
      site: ctx.meta,
      spaces: ctx.spaces,
      schemaFields: ctx.schemaFields,
      documents: ctx.visibleSummaries,
      ...(resolvedFirst ? { activeDocument: resolvedFirst.detail } : {}),
    };
  }

  async getPublicSiteDocument(slug: string, docSlug: string): Promise<PublicSiteDocumentPayload> {
    const site = await this.requireEnabledSiteBySlug(slug);
    const ctx = await this.resolveGardenContext(site);
    const doc = ctx.visibleDocs.find(
      (candidate) => candidate.slug === docSlug || candidate.id === docSlug,
    );
    if (!doc) {
      throw new InkadeError(
        "NOT_FOUND",
        `Document "${docSlug}" not found in public garden "${slug}"`,
      );
    }

    const { detail } = await this.resolveDocDetail(ctx, doc);
    return {
      site: ctx.meta,
      spaces: ctx.spaces,
      schemaFields: ctx.schemaFields,
      documents: ctx.visibleSummaries,
      document: detail,
    };
  }

  private async buildFeedXmlFromContext(
    ctx: ResolvedGardenContext,
    origin: string,
    format: "rss" | "atom" = "rss",
  ): Promise<string> {
    const cleanOrigin = origin.replace(/\/+$/, "");
    const siteUrl = `${cleanOrigin}/site/${ctx.meta.slug}`;
    const latestUpdated = ctx.visibleDocs[0]?.updatedAt ?? ctx.meta.updatedAt;

    const feed = new Feed({
      id: siteUrl,
      title: ctx.meta.title,
      description: ctx.meta.subtitle || ctx.meta.title,
      link: siteUrl,
      updated: new Date(latestUpdated),
      generator: "Inkade Digital Garden",
      copyright: "",
      feedLinks: {
        rss: `${cleanOrigin}/api/v1/public/sites/${ctx.meta.slug}/feed.xml`,
        atom: `${cleanOrigin}/api/v1/public/sites/${ctx.meta.slug}/feed.xml?format=atom`,
      },
    });

    for (const doc of ctx.visibleDocs.slice(0, 40)) {
      const docUrl = `${siteUrl}/${encodeURIComponent(doc.slug)}`;
      const { bodyMarkdown } = parseMarkdownWithFrontmatter(doc.contentMarkdown);
      const rawMdSource =
        doc.kind === "outline"
          ? renderOutlineNodesToMarkdown(await this.repos.outlineRepo.listOutlineNodes(doc.id))
          : bodyMarkdown;
      const mdSource = await this.sanitizePublicArtifactMarkdown(
        ctx.site.workspaceId,
        doc.id,
        rawMdSource,
      );
      const htmlContent = await renderGardenMarkdownToHtml(mdSource, {
        allDocs: ctx.visibleSummaries,
      });

      feed.addItem({
        title: doc.title,
        id: docUrl,
        link: docUrl,
        date: new Date(doc.updatedAt),
        published: new Date(doc.createdAt),
        description: doc.excerpt,
        content: htmlContent,
        category: doc.tags.map((tag) => ({ name: tag })),
      });
    }

    return format === "atom" ? feed.atom1() : feed.rss2();
  }

  async generatePublicFeedXml(
    slug: string,
    options?: { readonly origin?: string | undefined; readonly format?: "rss" | "atom" | undefined },
  ): Promise<string> {
    const site = await this.requireEnabledSiteBySlug(slug);
    if (!site.enableRss) {
      throw new InkadeError("NOT_FOUND", `RSS feed is disabled for "${slug}"`);
    }
    const ctx = await this.resolveGardenContext(site);
    return this.buildFeedXmlFromContext(
      ctx,
      options?.origin ?? "https://garden.invalid",
      options?.format ?? "rss",
    );
  }

  async exportPublicSiteZip(
    principal: Principal,
    siteId: PublicSiteId,
    options?: { readonly origin?: string | undefined },
  ): Promise<{ readonly filename: string; readonly bytes: Uint8Array }> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const site = await this.repos.spaceRepo.getPublicSiteById(principal.workspaceId, siteId);
    if (!site) {
      throw new InkadeError("NOT_FOUND", `Public site "${siteId}" not found`);
    }

    const ctx = await this.resolveGardenContext(site);
    const docsWithDetails = await Promise.all(
      ctx.visibleDocs.map((doc) => this.resolveDocDetail(ctx, doc)),
    );
    const feedXml = site.enableRss
      ? await this.buildFeedXmlFromContext(ctx, options?.origin ?? "https://garden.invalid", "rss")
      : undefined;

    return buildStaticGardenZip({
      site: ctx.meta,
      spaces: ctx.spaces,
      schemaFields: ctx.schemaFields,
      docs: docsWithDetails,
      feedXml,
    });
  }
}
