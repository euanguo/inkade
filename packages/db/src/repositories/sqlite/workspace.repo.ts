import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  createId,
  ID_PREFIXES,
  InkadeError,
  type CreateDocumentTemplateInput,
  type CreateSavedViewInput,
  type DocumentKind,
  type DocumentTemplate,
  type SavedView,
  type SavedViewId,
  type TemplateId,
  type UpdateDocumentTemplateInput,
  type UpdateSavedViewInput,
  type UserId,
  type Workspace,
} from "@inkade/core";
import { users } from "../../schema/auth-sqlite.ts";
import { documentTemplates, savedViews, workspaces } from "../../schema/sqlite.ts";
import type { CreateWorkspaceInput, WorkspaceRepo } from "../ports/workspace.port.ts";
import { nowIso, syncToPromise, type SqliteRepoContext } from "./helpers.ts";
import { mapSavedViewRow, mapTemplateRow, mapWorkspaceRow } from "./mappers.ts";

export class SqliteWorkspaceRepo implements WorkspaceRepo {
  constructor(private readonly ctx: SqliteRepoContext) {}

  getWorkspaceById(workspaceId: string): Promise<Workspace | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .get();
      return row ? mapWorkspaceRow(row) : null;
    });
  }

  getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
    return syncToPromise(() => {
      const row = this.ctx.db.select().from(workspaces).where(eq(workspaces.slug, slug)).get();
      return row ? mapWorkspaceRow(row) : null;
    });
  }

  ensureWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.slug, input.slug))
        .get();
      if (existing) {
        return mapWorkspaceRow(existing);
      }

      const ts = nowIso();
      const row = {
        id: input.id ?? createId(ID_PREFIXES.workspace),
        slug: input.slug,
        name: input.name,
        ownerUserId: input.ownerUserId,
        createdAt: ts,
        updatedAt: ts,
      };
      this.ctx.db.insert(workspaces).values(row).run();
      return mapWorkspaceRow(row);
    });
  }

  hasRegisteredUsers(): Promise<boolean> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .get();
      return (row?.count ?? 0) > 0;
    });
  }

  claimWorkspaceOwnerIfUnset(
    workspaceId: string,
    ownerUserId: UserId | string,
  ): Promise<Workspace> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const current = this.ctx.db
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .get();
        if (!current) {
          throw new InkadeError("NOT_FOUND", `Workspace "${workspaceId}" not found`);
        }
        if (current.ownerUserId === "usr_default" || current.ownerUserId === "") {
          const ts = nowIso();
          this.ctx.db
            .update(workspaces)
            .set({ ownerUserId, updatedAt: ts })
            .where(eq(workspaces.id, workspaceId))
            .run();
          return mapWorkspaceRow({ ...current, ownerUserId, updatedAt: ts });
        }
        return mapWorkspaceRow(current);
      }),
    );
  }

  listDocumentTemplates(
    workspaceId: string,
    kind?: DocumentKind,
  ): Promise<readonly DocumentTemplate[]> {
    return syncToPromise(() => {
      const conditions = [eq(documentTemplates.workspaceId, workspaceId)];
      if (kind) {
        conditions.push(eq(documentTemplates.kind, kind));
      }
      const rows = this.ctx.db
        .select()
        .from(documentTemplates)
        .where(and(...conditions))
        .orderBy(desc(documentTemplates.isDefaultDaily), asc(documentTemplates.name))
        .all();
      return rows.map(mapTemplateRow);
    });
  }

  getDocumentTemplateById(
    workspaceId: string,
    templateId: TemplateId | string,
  ): Promise<DocumentTemplate | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documentTemplates)
        .where(
          and(
            eq(documentTemplates.workspaceId, workspaceId),
            eq(documentTemplates.id, templateId),
          ),
        )
        .get();
      return row ? mapTemplateRow(row) : null;
    });
  }

  getDefaultDailyTemplate(workspaceId: string): Promise<DocumentTemplate | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documentTemplates)
        .where(
          and(
            eq(documentTemplates.workspaceId, workspaceId),
            eq(documentTemplates.kind, "outline"),
            eq(documentTemplates.isDefaultDaily, true),
          ),
        )
        .get();
      return row ? mapTemplateRow(row) : null;
    });
  }

  createDocumentTemplate(
    workspaceId: string,
    input: CreateDocumentTemplateInput,
    options?: { readonly id?: string | undefined },
  ): Promise<DocumentTemplate> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const ts = nowIso();
        if (input.isDefaultDaily && input.kind === "outline") {
          this.ctx.db
            .update(documentTemplates)
            .set({ isDefaultDaily: false, updatedAt: ts })
            .where(eq(documentTemplates.workspaceId, workspaceId))
            .run();
        }
        const id = options?.id ?? createId(ID_PREFIXES.template);
        const row: typeof documentTemplates.$inferSelect = {
          id,
          workspaceId,
          name: input.name,
          kind: input.kind,
          description: input.description ?? "",
          contentMarkdown: input.contentMarkdown ?? "",
          isDefaultDaily: Boolean(input.isDefaultDaily),
          createdAt: ts,
          updatedAt: ts,
        };
        this.ctx.db.insert(documentTemplates).values(row).run();
        return mapTemplateRow(row);
      }),
    );
  }

  updateDocumentTemplate(
    workspaceId: string,
    templateId: TemplateId | string,
    input: UpdateDocumentTemplateInput,
  ): Promise<DocumentTemplate> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const current = this.ctx.db
          .select()
          .from(documentTemplates)
          .where(
            and(
              eq(documentTemplates.workspaceId, workspaceId),
              eq(documentTemplates.id, templateId),
            ),
          )
          .get();
        if (!current) {
          throw new InkadeError("NOT_FOUND", `Document template "${templateId}" not found`);
        }

        const ts = nowIso();
        const nextKind = input.kind ?? current.kind;
        const nextDefault = input.isDefaultDaily ?? current.isDefaultDaily;
        if (nextDefault && nextKind === "outline") {
          this.ctx.db
            .update(documentTemplates)
            .set({ isDefaultDaily: false, updatedAt: ts })
            .where(eq(documentTemplates.workspaceId, workspaceId))
            .run();
        }

        this.ctx.db
          .update(documentTemplates)
          .set({
            name: input.name ?? current.name,
            kind: nextKind,
            description: input.description ?? current.description,
            contentMarkdown: input.contentMarkdown ?? current.contentMarkdown,
            isDefaultDaily: nextDefault,
            updatedAt: ts,
          })
          .where(eq(documentTemplates.id, templateId))
          .run();

        const updated = this.ctx.db
          .select()
          .from(documentTemplates)
          .where(eq(documentTemplates.id, templateId))
          .get();
        if (!updated) {
          throw new InkadeError("INTERNAL_ERROR", "Failed to read updated template");
        }
        return mapTemplateRow(updated);
      }),
    );
  }

  deleteDocumentTemplate(workspaceId: string, templateId: TemplateId | string): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: documentTemplates.id })
        .from(documentTemplates)
        .where(
          and(
            eq(documentTemplates.workspaceId, workspaceId),
            eq(documentTemplates.id, templateId),
          ),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Document template "${templateId}" not found`);
      }
      this.ctx.db.delete(documentTemplates).where(eq(documentTemplates.id, templateId)).run();
    });
  }

  listSavedViews(workspaceId: string): Promise<readonly SavedView[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(savedViews)
        .where(eq(savedViews.workspaceId, workspaceId))
        .orderBy(asc(savedViews.sortOrder), asc(savedViews.createdAt))
        .all();
      return rows.map(mapSavedViewRow);
    });
  }

  getSavedViewById(
    workspaceId: string,
    viewId: SavedViewId | string,
  ): Promise<SavedView | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(savedViews)
        .where(and(eq(savedViews.workspaceId, workspaceId), eq(savedViews.id, viewId)))
        .get();
      return row ? mapSavedViewRow(row) : null;
    });
  }

  createSavedView(
    workspaceId: string,
    input: CreateSavedViewInput,
    options?: { readonly id?: string | undefined },
  ): Promise<SavedView> {
    return syncToPromise(() => {
      const id = options?.id ?? createId(ID_PREFIXES.savedView);
      const ts = nowIso();
      const derivedDisplayMode =
        input.displayMode ??
        (input.filter?.viewMode === "table" || input.filter?.viewMode === "board"
          ? input.filter.viewMode
          : "grid");
      const row: typeof savedViews.$inferSelect = {
        id,
        workspaceId,
        name: input.name,
        icon: input.icon ?? null,
        color: input.color ?? null,
        filterJson: JSON.stringify(input.filter ?? {}),
        displayMode: derivedDisplayMode,
        groupByField: input.groupByField ?? null,
        visibleColumnsJson:
          input.visibleColumns !== undefined && input.visibleColumns !== null
            ? JSON.stringify(input.visibleColumns)
            : null,
        columnWidthsJson:
          input.columnWidths !== undefined && input.columnWidths !== null
            ? JSON.stringify(input.columnWidths)
            : null,
        sortRulesJson:
          input.sortRules !== undefined && input.sortRules !== null
            ? JSON.stringify(input.sortRules)
            : null,
        sortOrder: input.sortOrder ?? 0,
        createdAt: ts,
        updatedAt: ts,
      };
      this.ctx.db.insert(savedViews).values(row).run();
      return mapSavedViewRow(row);
    });
  }

  updateSavedView(
    workspaceId: string,
    viewId: SavedViewId | string,
    input: UpdateSavedViewInput,
  ): Promise<SavedView> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select()
        .from(savedViews)
        .where(and(eq(savedViews.workspaceId, workspaceId), eq(savedViews.id, viewId)))
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `Saved view "${viewId}" not found`);
      }
      const ts = nowIso();
      this.ctx.db
        .update(savedViews)
        .set({
          name: input.name ?? current.name,
          icon: input.icon !== undefined ? input.icon : current.icon,
          color: input.color !== undefined ? input.color : current.color,
          filterJson: input.filter ? JSON.stringify(input.filter) : current.filterJson,
          displayMode: input.displayMode ?? current.displayMode,
          groupByField:
            input.groupByField !== undefined ? input.groupByField : current.groupByField,
          visibleColumnsJson:
            input.visibleColumns !== undefined
              ? input.visibleColumns === null
                ? null
                : JSON.stringify(input.visibleColumns)
              : current.visibleColumnsJson,
          columnWidthsJson:
            input.columnWidths !== undefined
              ? input.columnWidths === null
                ? null
                : JSON.stringify(input.columnWidths)
              : current.columnWidthsJson,
          sortRulesJson:
            input.sortRules !== undefined
              ? input.sortRules === null
                ? null
                : JSON.stringify(input.sortRules)
              : current.sortRulesJson,
          sortOrder: input.sortOrder ?? current.sortOrder,
          updatedAt: ts,
        })
        .where(eq(savedViews.id, viewId))
        .run();

      const updated = this.ctx.db
        .select()
        .from(savedViews)
        .where(eq(savedViews.id, viewId))
        .get();
      if (!updated) {
        throw new InkadeError("INTERNAL_ERROR", "Failed to read updated saved view");
      }
      return mapSavedViewRow(updated);
    });
  }

  deleteSavedView(workspaceId: string, viewId: SavedViewId | string): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(and(eq(savedViews.workspaceId, workspaceId), eq(savedViews.id, viewId)))
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Saved view "${viewId}" not found`);
      }
      this.ctx.db.delete(savedViews).where(eq(savedViews.id, viewId)).run();
    });
  }
}
