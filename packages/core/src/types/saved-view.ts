import { z } from "zod";
import { spaceIdSchema, type SavedViewId, type WorkspaceId } from "../ids.ts";
import {
  documentKindSchema,
  librarySortFieldSchema,
  libraryViewModeSchema,
  sortDirectionSchema,
} from "./common.ts";

export const SAVED_VIEW_DISPLAY_MODES = ["grid", "table", "board"] as const;
export type SavedViewDisplayMode = (typeof SAVED_VIEW_DISPLAY_MODES)[number];
export const savedViewDisplayModeSchema = z.enum(SAVED_VIEW_DISPLAY_MODES);

export const savedViewSortRuleSchema = z.object({
  field: z.string().trim().min(1).max(64),
  dir: sortDirectionSchema.default("desc"),
});
export type SavedViewSortRule = z.infer<typeof savedViewSortRuleSchema>;

export const savedViewFilterSchema = z.object({
  spaceId: spaceIdSchema.optional(),
  kind: documentKindSchema.optional(),
  tag: z.string().min(1).optional(),
  pinnedOnly: z.boolean().optional(),
  unreadOnly: z.boolean().optional(),
  query: z.string().optional(),
  viewMode: libraryViewModeSchema.optional(),
  sortBy: librarySortFieldSchema.optional(),
  sortDir: sortDirectionSchema.optional(),
  propertyFilter: z.record(z.string(), z.unknown()).optional(),
});
export type SavedViewFilter = z.infer<typeof savedViewFilterSchema>;

export interface SavedView {
  readonly id: SavedViewId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
  readonly filter: SavedViewFilter;
  readonly displayMode: SavedViewDisplayMode;
  readonly groupByField: string | null;
  readonly visibleColumns: readonly string[] | null;
  readonly columnWidths: Readonly<Record<string, number>> | null;
  readonly sortRules: readonly SavedViewSortRule[] | null;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const columnWidthsSchema = z.record(
  z.string().trim().min(1).max(64),
  z.number().int().min(48).max(960),
);

export const createSavedViewInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: z.string().trim().min(1).max(64).optional(),
  color: z.string().trim().min(1).max(32).optional(),
  filter: savedViewFilterSchema.default({}),
  displayMode: savedViewDisplayModeSchema.optional(),
  groupByField: z.string().trim().min(1).max(64).nullable().optional(),
  visibleColumns: z.array(z.string().trim().min(1).max(64)).max(60).nullable().optional(),
  columnWidths: columnWidthsSchema.nullable().optional(),
  sortRules: z.array(savedViewSortRuleSchema).max(5).nullable().optional(),
  sortOrder: z.number().int().default(0),
});
export type CreateSavedViewInput = z.input<typeof createSavedViewInputSchema>;
export type ParsedCreateSavedViewInput = z.infer<typeof createSavedViewInputSchema>;

export const updateSavedViewInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  icon: z.string().trim().min(1).max(64).nullable().optional(),
  color: z.string().trim().min(1).max(32).nullable().optional(),
  filter: savedViewFilterSchema.optional(),
  displayMode: savedViewDisplayModeSchema.optional(),
  groupByField: z.string().trim().min(1).max(64).nullable().optional(),
  visibleColumns: z.array(z.string().trim().min(1).max(64)).max(60).nullable().optional(),
  columnWidths: columnWidthsSchema.nullable().optional(),
  sortRules: z.array(savedViewSortRuleSchema).max(5).nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateSavedViewInput = z.infer<typeof updateSavedViewInputSchema>;
