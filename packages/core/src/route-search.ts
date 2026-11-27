import { z } from "zod";
import { asId, type BrandedId, ID_PREFIXES, type IdPrefix } from "./ids.ts";
import {
  dailyKanbanGroupBySchema,
  dailyViewModeSchema,
  librarySortBySchema,
  normalizeLegacyInboxTab,
  tasksBoardGroupBySchema,
  tasksGroupFilterSchema,
  tasksStatusFilterSchema,
  tasksViewModeSchema,
  threadsViewModeSchema,
  type InboxTabPref,
} from "./preferences.ts";
import { taskPrioritySchema } from "./tasks.ts";
import { documentKindSchema, libraryViewModeSchema, sortDirectionSchema } from "./types/common.ts";
import { taskSourceEngineSchema } from "./types/outline.ts";

const optionalStringParam = z
  .unknown()
  .transform((val): string | undefined => (typeof val === "string" ? val : undefined));

const optionalBooleanParam = z.unknown().transform((val): boolean | undefined => {
  if (val === true || val === "true" || val === "1") return true;
  if (val === false || val === "false" || val === "0") return false;
  return undefined;
});

function optionalEnumParam<T extends string>(schema: z.ZodType<T>) {
  return z.unknown().transform((val): T | undefined => {
    if (typeof val !== "string") return undefined;
    const res = schema.safeParse(val);
    return res.success ? res.data : undefined;
  });
}

function optionalBrandedIdParam<P extends IdPrefix>(prefix: P) {
  return z.unknown().transform((val): BrandedId<P> | undefined => {
    if (typeof val !== "string" || val.trim().length === 0) return undefined;
    return asId(prefix, val);
  });
}

export const dailySearchSchema = z.object({
  nodeId: optionalBrandedIdParam(ID_PREFIXES.outlineNode).optional(),
  view: optionalEnumParam(dailyViewModeSchema).optional(),
  kanbanGroup: optionalEnumParam(dailyKanbanGroupBySchema).optional(),
});
export type DailySearchParams = z.infer<typeof dailySearchSchema>;

export const tasksSearchSchema = z.object({
  view: optionalEnumParam(tasksViewModeSchema).optional(),
  boardGroup: optionalEnumParam(tasksBoardGroupBySchema).optional(),
  group: optionalEnumParam(tasksGroupFilterSchema).optional(),
  status: optionalEnumParam(tasksStatusFilterSchema).optional(),
  priority: optionalEnumParam(taskPrioritySchema).optional(),
  engine: optionalEnumParam(taskSourceEngineSchema).optional(),
  space: optionalBrandedIdParam(ID_PREFIXES.space).optional(),
  tag: optionalStringParam.optional(),
  q: optionalStringParam.optional(),
});
export type TasksSearchParams = z.infer<typeof tasksSearchSchema>;

const optionalInboxTabParam = z
  .unknown()
  .transform((val): InboxTabPref | undefined => normalizeLegacyInboxTab(val));

export const inboxSearchSchema = z.object({
  title: optionalStringParam.optional(),
  text: optionalStringParam.optional(),
  url: optionalStringParam.optional(),
  tab: optionalInboxTabParam.optional(),
  q: optionalStringParam.optional(),
  item: optionalStringParam.optional(),
});
export type InboxSearchParams = z.infer<typeof inboxSearchSchema>;

export const librarySearchSchema = z.object({
  tag: optionalStringParam.optional(),
  spaceId: optionalBrandedIdParam(ID_PREFIXES.space).optional(),
  kind: optionalEnumParam(documentKindSchema).optional(),
  pinnedOnly: optionalBooleanParam.optional(),
  unreadOnly: optionalBooleanParam.optional(),
  viewId: optionalBrandedIdParam(ID_PREFIXES.savedView).optional(),
  view: optionalEnumParam(libraryViewModeSchema).optional(),
  sort: optionalEnumParam(librarySortBySchema).optional(),
  dir: optionalEnumParam(sortDirectionSchema).optional(),
  q: optionalStringParam.optional(),
  doc: optionalBrandedIdParam(ID_PREFIXES.document).optional(),
});
export type LibrarySearchParams = z.infer<typeof librarySearchSchema>;

export const threadsSearchSchema = z.object({
  mode: optionalEnumParam(threadsViewModeSchema).optional(),
  host: optionalStringParam.optional(),
  q: optionalStringParam.optional(),
});
export type ThreadsSearchParams = z.infer<typeof threadsSearchSchema>;

export const settingsSearchSchema = z.object({
  section: optionalStringParam.optional(),
});
export type SettingsSearchParams = z.infer<typeof settingsSearchSchema>;

export const clipperPairSearchSchema = z.object({
  nonce: optionalStringParam.optional(),
  serverUrl: optionalStringParam.optional(),
});
export type ClipperPairSearchParams = z.infer<typeof clipperPairSearchSchema>;

const optionalPositiveIntParam = z.unknown().transform((val): number | undefined => {
  if (typeof val === "number" && Number.isInteger(val) && val > 0) return val;
  if (typeof val === "string" && /^\d+$/.test(val.trim())) {
    const parsed = Number.parseInt(val.trim(), 10);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
});

export const docDetailSearchSchema = z.object({
  nodeId: optionalBrandedIdParam(ID_PREFIXES.outlineNode).optional(),
  heading: optionalStringParam.optional(),
  highlight: optionalBrandedIdParam(ID_PREFIXES.highlight).optional(),
  page: optionalPositiveIntParam.optional(),
  annotation: optionalStringParam.optional(),
});
export type DocDetailSearchParams = z.infer<typeof docDetailSearchSchema>;
