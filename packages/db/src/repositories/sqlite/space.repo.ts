import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  createId,
  ID_PREFIXES,
  InkadeError,
  slugifyTitle,
  type CreateSpaceInput,
  type PublicSite,
  type PublicSiteId,
  type ShareLink,
  type ShareLinkId,
  type Space,
  type SpacePropertySchema,
  type TemplateId,
  type UpdatePublicSiteInput,
  type UpdateSpaceInput,
} from "@inkade/core";
import {
  documents,
  documentTemplates,
  publicSites,
  shareLinks,
  spacePropertySchemas,
  spaces,
} from "../../schema/sqlite.ts";
import type {
  CreatePublicSiteRecordInput,
  CreateShareLinkRecordInput,
  ListSpacesOptions,
  SpaceRepo,
  UpsertSpacePropertySchemaRecordInput,
} from "../ports/space.port.ts";
import { nowIso, syncToPromise, type SqliteRepoContext } from "./helpers.ts";
import {
  mapPublicSiteRow,
  mapShareLinkRow,
  mapSpacePropertySchemaRow,
  mapSpaceRow,
} from "./mappers.ts";

export class SqliteSpaceRepo implements SpaceRepo {
  constructor(private readonly ctx: SqliteRepoContext) {}

  private assertNoSpaceCycleSync(
    workspaceId: string,
    spaceId: string,
    newParentId: string | null,
  ): void {
    if (newParentId === null) return;
    if (newParentId === spaceId) {
      throw new InkadeError("INVALID_PARENT_CYCLE", "A space cannot be its own parent");
    }

    const allRows = this.ctx.db
      .select({ id: spaces.id, parentId: spaces.parentId })
      .from(spaces)
      .where(eq(spaces.workspaceId, workspaceId))
      .all();

    const parentMap = new Map<string, string | null>(allRows.map((r) => [r.id, r.parentId]));
    if (!parentMap.has(newParentId)) {
      throw new InkadeError("NOT_FOUND", `Parent space "${newParentId}" not found`);
    }

    const visited = new Set<string>([spaceId]);
    let cursor: string | null = newParentId;
    while (cursor !== null) {
      if (visited.has(cursor)) {
        throw new InkadeError(
          "INVALID_PARENT_CYCLE",
          `Setting parent "${newParentId}" creates a cycle under space "${spaceId}"`,
        );
      }
      visited.add(cursor);
      cursor = parentMap.get(cursor) ?? null;
    }
  }

  listSpaces(workspaceId: string, options?: ListSpacesOptions): Promise<readonly Space[]> {
    return syncToPromise(() => {
      const conditions = [eq(spaces.workspaceId, workspaceId)];
      if (!options?.includeArchived) {
        conditions.push(isNull(spaces.archivedAt));
      }
      const rows = this.ctx.db
        .select()
        .from(spaces)
        .where(and(...conditions))
        .orderBy(asc(spaces.sortOrder), asc(spaces.createdAt))
        .all();
      return rows.map(mapSpaceRow);
    });
  }

  getSpaceById(workspaceId: string, spaceId: string): Promise<Space | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(spaces)
        .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, spaceId)))
        .get();
      return row ? mapSpaceRow(row) : null;
    });
  }

  getSpaceBySlug(workspaceId: string, slug: string): Promise<Space | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(spaces)
        .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.slug, slug)))
        .get();
      return row ? mapSpaceRow(row) : null;
    });
  }

  createSpace(
    workspaceId: string,
    input: CreateSpaceInput,
    options?: { readonly id?: string | undefined },
  ): Promise<Space> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const parentId = input.parentId ?? null;
        if (parentId !== null) {
          const parent = this.ctx.db
            .select({ id: spaces.id })
            .from(spaces)
            .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, parentId)))
            .get();
          if (!parent) {
            throw new InkadeError("NOT_FOUND", `Parent space "${parentId}" not found`);
          }
        }

        const ts = nowIso();
        const baseSlug = slugifyTitle(input.slug ?? input.name);
        let slug = baseSlug;
        let counter = 2;
        while (
          this.ctx.db
            .select({ id: spaces.id })
            .from(spaces)
            .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.slug, slug)))
            .get()
        ) {
          slug = `${baseSlug}-${counter}`;
          counter++;
        }

        const row: typeof spaces.$inferSelect = {
          id: options?.id ?? createId(ID_PREFIXES.space),
          workspaceId,
          parentId,
          slug,
          name: input.name,
          icon: input.icon ?? null,
          color: input.color ?? null,
          defaultKind: input.defaultKind ?? null,
          sortOrder: input.sortOrder ?? 0,
          archivedAt: null,
          createdAt: ts,
          updatedAt: ts,
        };
        this.ctx.db.insert(spaces).values(row).run();
        return mapSpaceRow(row);
      }),
    );
  }

  updateSpace(workspaceId: string, spaceId: string, input: UpdateSpaceInput): Promise<Space> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const current = this.ctx.db
          .select()
          .from(spaces)
          .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, spaceId)))
          .get();
        if (!current) {
          throw new InkadeError("NOT_FOUND", `Space "${spaceId}" not found`);
        }

        if (input.parentId !== undefined) {
          this.assertNoSpaceCycleSync(workspaceId, spaceId, input.parentId);
        }

        if (input.slug !== undefined && input.slug !== current.slug) {
          const conflict = this.ctx.db
            .select({ id: spaces.id })
            .from(spaces)
            .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.slug, input.slug)))
            .get();
          if (conflict && conflict.id !== spaceId) {
            throw new InkadeError("CONFLICT", `Space slug "${input.slug}" already exists`);
          }
        }

        const updated: typeof spaces.$inferSelect = {
          ...current,
          parentId: input.parentId !== undefined ? input.parentId : current.parentId,
          name: input.name ?? current.name,
          slug: input.slug ?? current.slug,
          icon: input.icon !== undefined ? input.icon : current.icon,
          color: input.color !== undefined ? input.color : current.color,
          defaultKind: input.defaultKind !== undefined ? input.defaultKind : current.defaultKind,
          sortOrder: input.sortOrder ?? current.sortOrder,
          updatedAt: nowIso(),
        };

        this.ctx.db
          .update(spaces)
          .set({
            parentId: updated.parentId,
            name: updated.name,
            slug: updated.slug,
            icon: updated.icon,
            color: updated.color,
            defaultKind: updated.defaultKind,
            sortOrder: updated.sortOrder,
            updatedAt: updated.updatedAt,
          })
          .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, spaceId)))
          .run();

        return mapSpaceRow(updated);
      }),
    );
  }

  archiveSpace(workspaceId: string, spaceId: string): Promise<Space> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select()
        .from(spaces)
        .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, spaceId)))
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `Space "${spaceId}" not found`);
      }
      const ts = nowIso();
      this.ctx.db
        .update(spaces)
        .set({ archivedAt: ts, updatedAt: ts })
        .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, spaceId)))
        .run();
      return mapSpaceRow({ ...current, archivedAt: ts, updatedAt: ts });
    });
  }

  deleteSpaceIfEmpty(workspaceId: string, spaceId: string): Promise<boolean> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: spaces.id })
        .from(spaces)
        .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, spaceId)))
        .get();
      if (!existing) return false;
      const hasDocs = this.ctx.db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.spaceId, spaceId)))
        .get();
      if (hasDocs) return false;
      this.ctx.db
        .delete(spaces)
        .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, spaceId)))
        .run();
      return true;
    });
  }

  listShareLinks(workspaceId: string, documentId?: string): Promise<readonly ShareLink[]> {
    return syncToPromise(() => {
      const conditions = [eq(shareLinks.workspaceId, workspaceId)];
      if (documentId) {
        conditions.push(eq(shareLinks.documentId, documentId));
      }
      const rows = this.ctx.db
        .select()
        .from(shareLinks)
        .where(and(...conditions))
        .orderBy(desc(shareLinks.createdAt))
        .all();
      return rows.map(mapShareLinkRow);
    });
  }

  getShareLinkById(
    workspaceId: string,
    shareLinkId: ShareLinkId | string,
  ): Promise<ShareLink | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(shareLinks)
        .where(and(eq(shareLinks.workspaceId, workspaceId), eq(shareLinks.id, shareLinkId)))
        .get();
      return row ? mapShareLinkRow(row) : null;
    });
  }

  getShareLinkByToken(token: string): Promise<ShareLink | null> {
    return syncToPromise(() => {
      const row = this.ctx.db.select().from(shareLinks).where(eq(shareLinks.token, token)).get();
      return row ? mapShareLinkRow(row) : null;
    });
  }

  createShareLink(
    workspaceId: string,
    input: CreateShareLinkRecordInput,
    options?: { readonly id?: string | undefined },
  ): Promise<ShareLink> {
    return syncToPromise(() => {
      const doc = this.ctx.db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, input.documentId)))
        .get();
      if (!doc) {
        throw new InkadeError("NOT_FOUND", `Document "${input.documentId}" not found`);
      }

      const id = options?.id ?? createId(ID_PREFIXES.shareLink);
      const ts = nowIso();
      const row: typeof shareLinks.$inferSelect = {
        id,
        workspaceId,
        documentId: input.documentId,
        token: input.token,
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
        createdAt: ts,
      };
      this.ctx.db.insert(shareLinks).values(row).run();
      return mapShareLinkRow(row);
    });
  }

  revokeShareLink(workspaceId: string, shareLinkId: ShareLinkId | string): Promise<ShareLink> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select()
        .from(shareLinks)
        .where(and(eq(shareLinks.workspaceId, workspaceId), eq(shareLinks.id, shareLinkId)))
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `Share link "${shareLinkId}" not found`);
      }
      const ts = current.revokedAt ?? nowIso();
      this.ctx.db
        .update(shareLinks)
        .set({ revokedAt: ts })
        .where(eq(shareLinks.id, shareLinkId))
        .run();
      return mapShareLinkRow({ ...current, revokedAt: ts });
    });
  }

  listActiveShareLinksByWorkspace(workspaceId: string): Promise<readonly ShareLink[]> {
    return syncToPromise(() => {
      const ts = nowIso();
      const rows = this.ctx.db
        .select()
        .from(shareLinks)
        .where(and(eq(shareLinks.workspaceId, workspaceId), isNull(shareLinks.revokedAt)))
        .orderBy(desc(shareLinks.createdAt))
        .all();
      return rows
        .filter((row) => row.expiresAt === null || row.expiresAt > ts)
        .map(mapShareLinkRow);
    });
  }

  listSpacePropertySchemas(workspaceId: string): Promise<readonly SpacePropertySchema[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(spacePropertySchemas)
        .where(eq(spacePropertySchemas.workspaceId, workspaceId))
        .orderBy(desc(spacePropertySchemas.updatedAt))
        .all();
      return rows.map(mapSpacePropertySchemaRow);
    });
  }

  getSpacePropertySchema(
    workspaceId: string,
    target: {
      readonly spaceId?: string | null | undefined;
      readonly templateId?: TemplateId | string | null | undefined;
    },
  ): Promise<SpacePropertySchema | null> {
    return syncToPromise(() => {
      const hasSpace = Boolean(target.spaceId);
      const hasTemplate = Boolean(target.templateId);
      if (hasSpace === hasTemplate) {
        throw new InkadeError(
          "VALIDATION_ERROR",
          "Specify either spaceId or templateId to resolve a property schema",
        );
      }
      const row = hasSpace
        ? this.ctx.db
            .select()
            .from(spacePropertySchemas)
            .where(
              and(
                eq(spacePropertySchemas.workspaceId, workspaceId),
                eq(spacePropertySchemas.spaceId, target.spaceId!),
              ),
            )
            .get()
        : this.ctx.db
            .select()
            .from(spacePropertySchemas)
            .where(
              and(
                eq(spacePropertySchemas.workspaceId, workspaceId),
                eq(spacePropertySchemas.templateId, target.templateId!),
              ),
            )
            .get();
      return row ? mapSpacePropertySchemaRow(row) : null;
    });
  }

  upsertSpacePropertySchema(
    workspaceId: string,
    input: UpsertSpacePropertySchemaRecordInput,
    options?: { readonly id?: string | undefined },
  ): Promise<SpacePropertySchema> {
    return syncToPromise(() => {
      const hasSpace = Boolean(input.spaceId);
      const hasTemplate = Boolean(input.templateId);
      if (hasSpace === hasTemplate) {
        throw new InkadeError(
          "VALIDATION_ERROR",
          "Specify either spaceId or templateId when saving a property schema",
        );
      }

      if (hasSpace) {
        const space = this.ctx.db
          .select({ id: spaces.id })
          .from(spaces)
          .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, input.spaceId!)))
          .get();
        if (!space) {
          throw new InkadeError("NOT_FOUND", `Space "${input.spaceId}" not found`);
        }
      } else {
        const template = this.ctx.db
          .select({ id: documentTemplates.id })
          .from(documentTemplates)
          .where(
            and(
              eq(documentTemplates.workspaceId, workspaceId),
              eq(documentTemplates.id, input.templateId!),
            ),
          )
          .get();
        if (!template) {
          throw new InkadeError("NOT_FOUND", `Template "${input.templateId}" not found`);
        }
      }

      const existing = hasSpace
        ? this.ctx.db
            .select()
            .from(spacePropertySchemas)
            .where(
              and(
                eq(spacePropertySchemas.workspaceId, workspaceId),
                eq(spacePropertySchemas.spaceId, input.spaceId!),
              ),
            )
            .get()
        : this.ctx.db
            .select()
            .from(spacePropertySchemas)
            .where(
              and(
                eq(spacePropertySchemas.workspaceId, workspaceId),
                eq(spacePropertySchemas.templateId, input.templateId!),
              ),
            )
            .get();

      const ts = nowIso();
      const fieldsJson = JSON.stringify(input.fields);
      if (existing) {
        this.ctx.db
          .update(spacePropertySchemas)
          .set({ fieldsJson, updatedAt: ts })
          .where(eq(spacePropertySchemas.id, existing.id))
          .run();
        return mapSpacePropertySchemaRow({ ...existing, fieldsJson, updatedAt: ts });
      }

      const row: typeof spacePropertySchemas.$inferSelect = {
        id: options?.id ?? createId(ID_PREFIXES.spacePropertySchema),
        workspaceId,
        spaceId: input.spaceId ?? null,
        templateId: input.templateId ?? null,
        fieldsJson,
        updatedAt: ts,
      };
      this.ctx.db.insert(spacePropertySchemas).values(row).run();
      return mapSpacePropertySchemaRow(row);
    });
  }

  listPublicSites(workspaceId: string): Promise<readonly PublicSite[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(publicSites)
        .where(eq(publicSites.workspaceId, workspaceId))
        .orderBy(desc(publicSites.updatedAt), asc(publicSites.title))
        .all();
      return rows.map(mapPublicSiteRow);
    });
  }

  getPublicSiteById(
    workspaceId: string,
    siteId: PublicSiteId | string,
  ): Promise<PublicSite | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(publicSites)
        .where(and(eq(publicSites.workspaceId, workspaceId), eq(publicSites.id, siteId)))
        .get();
      return row ? mapPublicSiteRow(row) : null;
    });
  }

  getPublicSiteBySlug(slug: string): Promise<PublicSite | null> {
    return syncToPromise(() => {
      const normalizedSlug = slugifyTitle(slug) || slug.trim().toLowerCase();
      const row = this.ctx.db
        .select()
        .from(publicSites)
        .where(eq(publicSites.slug, normalizedSlug))
        .get();
      return row ? mapPublicSiteRow(row) : null;
    });
  }

  createPublicSite(
    workspaceId: string,
    input: CreatePublicSiteRecordInput,
    options?: { readonly id?: string | undefined },
  ): Promise<PublicSite> {
    return syncToPromise(() => {
      const existingBySlug = this.ctx.db
        .select({ id: publicSites.id })
        .from(publicSites)
        .where(eq(publicSites.slug, input.slug))
        .get();
      if (existingBySlug) {
        throw new InkadeError("CONFLICT", `Public site slug "${input.slug}" is already taken`);
      }
      const ts = nowIso();
      const row: typeof publicSites.$inferSelect = {
        id: options?.id ?? createId(ID_PREFIXES.publicSite),
        workspaceId,
        slug: input.slug,
        title: input.title,
        subtitle: input.subtitle ?? "",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        exposedFieldsJson: JSON.stringify(input.exposedFields ?? []),
        enableRss: input.enableRss ?? true,
        enabled: input.enabled ?? true,
        createdAt: ts,
        updatedAt: ts,
      };
      this.ctx.db.insert(publicSites).values(row).run();
      return mapPublicSiteRow(row);
    });
  }

  updatePublicSite(
    workspaceId: string,
    siteId: PublicSiteId | string,
    input: UpdatePublicSiteInput,
  ): Promise<PublicSite> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select()
        .from(publicSites)
        .where(and(eq(publicSites.workspaceId, workspaceId), eq(publicSites.id, siteId)))
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `Public site "${siteId}" not found`);
      }

      const nextSlug = input.slug ?? current.slug;
      if (nextSlug !== current.slug) {
        const conflict = this.ctx.db
          .select({ id: publicSites.id })
          .from(publicSites)
          .where(eq(publicSites.slug, nextSlug))
          .get();
        if (conflict && conflict.id !== current.id) {
          throw new InkadeError("CONFLICT", `Public site slug "${nextSlug}" is already taken`);
        }
      }

      const ts = nowIso();
      const updatedRow: typeof publicSites.$inferSelect = {
        ...current,
        slug: nextSlug,
        title: input.title ?? current.title,
        subtitle: input.subtitle ?? current.subtitle,
        sourceType: input.sourceType ?? current.sourceType,
        sourceId: input.sourceId ?? current.sourceId,
        exposedFieldsJson:
          input.exposedFields !== undefined
            ? JSON.stringify(input.exposedFields)
            : current.exposedFieldsJson,
        enableRss: input.enableRss !== undefined ? input.enableRss : current.enableRss,
        enabled: input.enabled !== undefined ? input.enabled : current.enabled,
        updatedAt: ts,
      };

      this.ctx.db
        .update(publicSites)
        .set({
          slug: updatedRow.slug,
          title: updatedRow.title,
          subtitle: updatedRow.subtitle,
          sourceType: updatedRow.sourceType,
          sourceId: updatedRow.sourceId,
          exposedFieldsJson: updatedRow.exposedFieldsJson,
          enableRss: updatedRow.enableRss,
          enabled: updatedRow.enabled,
          updatedAt: updatedRow.updatedAt,
        })
        .where(and(eq(publicSites.workspaceId, workspaceId), eq(publicSites.id, siteId)))
        .run();

      return mapPublicSiteRow(updatedRow);
    });
  }

  deletePublicSite(workspaceId: string, siteId: PublicSiteId | string): Promise<void> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select({ id: publicSites.id })
        .from(publicSites)
        .where(and(eq(publicSites.workspaceId, workspaceId), eq(publicSites.id, siteId)))
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `Public site "${siteId}" not found`);
      }
      this.ctx.db
        .delete(publicSites)
        .where(and(eq(publicSites.workspaceId, workspaceId), eq(publicSites.id, siteId)))
        .run();
    });
  }
}
