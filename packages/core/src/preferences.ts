import { z } from "zod";
import { libraryViewModeSchema, sortDirectionSchema } from "./types/index.ts";

export const WORKSPACE_CANVAS_WIDTHS = ["fluid", "centered"] as const;
export const workspaceCanvasWidthSchema = z.enum(WORKSPACE_CANVAS_WIDTHS);
export type WorkspaceCanvasWidth = (typeof WORKSPACE_CANVAS_WIDTHS)[number];

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export const themePreferenceSchema = z.enum(THEME_PREFERENCES);
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const ACCENT_PRESETS = ["indigo", "sage", "terracotta", "mono"] as const;
export const accentPresetSchema = z.enum(ACCENT_PRESETS);
export type AccentPreset = (typeof ACCENT_PRESETS)[number];

export const SHELL_STYLES = ["inset", "flush"] as const;
export const shellStyleSchema = z.enum(SHELL_STYLES);
export type ShellStyle = (typeof SHELL_STYLES)[number];

export const SURFACE_THEMES = ["light", "light-dimmed", "dark", "dark-dimmed"] as const;
export const surfaceThemeSchema = z.enum(SURFACE_THEMES);
export type SurfaceTheme = (typeof SURFACE_THEMES)[number];

export const TYPESET_PRESETS = ["compact", "standard", "relaxed"] as const;
export const typesetPresetSchema = z.enum(TYPESET_PRESETS);
export type TypesetPreset = (typeof TYPESET_PRESETS)[number];

export const MOTION_PROFILES = ["comfort", "reduced-pulse"] as const;
export const motionProfileSchema = z.enum(MOTION_PROFILES);
export type MotionProfile = (typeof MOTION_PROFILES)[number];

export const READER_FONT_FAMILIES = ["sans", "serif", "mono"] as const;
export const readerFontFamilySchema = z.enum(READER_FONT_FAMILIES);
export type ReaderFontFamilyPref = (typeof READER_FONT_FAMILIES)[number];

export const READER_FONT_SIZES = ["sm", "base", "lg"] as const;
export const readerFontSizeSchema = z.enum(READER_FONT_SIZES);
export type ReaderFontSizePref = (typeof READER_FONT_SIZES)[number];

export const READER_MEASURES = ["65ch", "72ch", "88ch", "full"] as const;
export const readerMeasureSchema = z.enum(READER_MEASURES);
export type ReaderMeasurePref = (typeof READER_MEASURES)[number];

export const READER_PAPER_MODES = ["default", "sepia"] as const;
export const readerPaperModeSchema = z.enum(READER_PAPER_MODES);
export type ReaderPaperModePref = (typeof READER_PAPER_MODES)[number];

export const UI_DENSITIES = ["comfortable", "compact"] as const;
export const uiDensitySchema = z.enum(UI_DENSITIES);
export type UiDensity = (typeof UI_DENSITIES)[number];

export interface ReaderTypographyPrefs {
  readonly fontFamily: ReaderFontFamilyPref;
  readonly fontSize: ReaderFontSizePref;
  readonly measure: ReaderMeasurePref;
  readonly paper: ReaderPaperModePref;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function isAccentPreset(value: unknown): value is AccentPreset {
  return value === "indigo" || value === "sage" || value === "terracotta" || value === "mono";
}

export function isShellStyle(value: unknown): value is ShellStyle {
  return value === "inset" || value === "flush";
}

export function isSurfaceTheme(value: unknown): value is SurfaceTheme {
  return (
    value === "light" ||
    value === "light-dimmed" ||
    value === "dark" ||
    value === "dark-dimmed"
  );
}

export function isTypesetPreset(value: unknown): value is TypesetPreset {
  return value === "compact" || value === "standard" || value === "relaxed";
}

export function isMotionProfile(value: unknown): value is MotionProfile {
  return value === "comfort" || value === "reduced-pulse";
}

export function isReaderFontFamily(value: unknown): value is ReaderFontFamilyPref {
  return value === "sans" || value === "serif" || value === "mono";
}

export function isReaderFontSize(value: unknown): value is ReaderFontSizePref {
  return value === "sm" || value === "base" || value === "lg";
}

export function isReaderMeasure(value: unknown): value is ReaderMeasurePref {
  return value === "65ch" || value === "72ch" || value === "88ch" || value === "full";
}

export function isReaderPaperMode(value: unknown): value is ReaderPaperModePref {
  return value === "default" || value === "sepia";
}

export const PREFERRED_LIGHT_SURFACES = ["light", "light-dimmed"] as const;
export const preferredLightSurfaceSchema = z.enum(PREFERRED_LIGHT_SURFACES);
export type PreferredLightSurface = (typeof PREFERRED_LIGHT_SURFACES)[number];

export const PREFERRED_DARK_SURFACES = ["dark", "dark-dimmed"] as const;
export const preferredDarkSurfaceSchema = z.enum(PREFERRED_DARK_SURFACES);
export type PreferredDarkSurface = (typeof PREFERRED_DARK_SURFACES)[number];

export interface AppearancePreferences {
  readonly themePreference: ThemePreference;
  readonly surfaceTheme: SurfaceTheme;
  readonly preferredLightSurface: PreferredLightSurface;
  readonly preferredDarkSurface: PreferredDarkSurface;
  readonly shellStyle: ShellStyle;
  readonly accentPreset: AccentPreset;
  readonly typesetPreset: TypesetPreset;
  readonly motionProfile: MotionProfile;
  readonly hoverPeek: boolean;
  readonly yjsOfflineEnabled: boolean;
}

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = Object.freeze({
  themePreference: "system",
  surfaceTheme: "light",
  preferredLightSurface: "light",
  preferredDarkSurface: "dark",
  shellStyle: "inset",
  accentPreset: "mono",
  typesetPreset: "standard",
  motionProfile: "comfort",
  hoverPeek: true,
  yjsOfflineEnabled: true,
});

export function cloneDefaultAppearancePreferences(): AppearancePreferences {
  return { ...DEFAULT_APPEARANCE_PREFERENCES };
}

export function isDarkSurfaceTheme(surface: SurfaceTheme): boolean {
  return surface === "dark" || surface === "dark-dimmed";
}

export function resolveEffectiveTheme(
  pref: ThemePreference,
  systemIsDark = false,
): "light" | "dark" {
  if (pref === "light" || pref === "dark") return pref;
  return systemIsDark ? "dark" : "light";
}

export function resolveEffectiveSurfaceTheme(
  pref: ThemePreference,
  storedSurface: SurfaceTheme,
  options?: {
    readonly preferredLight?: PreferredLightSurface | undefined;
    readonly preferredDark?: PreferredDarkSurface | undefined;
    readonly systemIsDark?: boolean | undefined;
  },
): SurfaceTheme {
  const effective = resolveEffectiveTheme(pref, options?.systemIsDark ?? false);
  if (effective === "dark") {
    if (isDarkSurfaceTheme(storedSurface)) return storedSurface;
    return options?.preferredDark ?? "dark";
  }
  if (!isDarkSurfaceTheme(storedSurface)) return storedSurface;
  return options?.preferredLight ?? "light";
}

export function resolveToggledSurfaceTheme(
  currentSurface: SurfaceTheme,
  options?: {
    readonly preferredLight?: PreferredLightSurface | undefined;
    readonly preferredDark?: PreferredDarkSurface | undefined;
  },
): SurfaceTheme {
  return isDarkSurfaceTheme(currentSurface)
    ? (options?.preferredLight ?? "light")
    : (options?.preferredDark ?? "dark");
}

export const tasksViewModeSchema = z.enum(["list", "board", "agenda"]);
export type TasksViewMode = z.infer<typeof tasksViewModeSchema>;

export const tasksBoardGroupBySchema = z.enum(["schedule", "priority"]);
export type TasksBoardGroupBy = z.infer<typeof tasksBoardGroupBySchema>;

export const tasksGroupFilterSchema = z.enum(["all", "today", "overdue", "anytime", "ade"]);
export type TasksGroupFilter = z.infer<typeof tasksGroupFilterSchema>;

export const tasksStatusFilterSchema = z.enum(["all", "open", "done"]);
export type TasksStatusFilter = z.infer<typeof tasksStatusFilterSchema>;

export const tasksQuickAddPresetSchema = z.enum(["today", "tonight", "tomorrow", "anytime"]);
export type TasksQuickAddPreset = z.infer<typeof tasksQuickAddPresetSchema>;

export const dailyViewModeSchema = z.enum(["outline", "kanban", "tasks"]);
export type DailyViewMode = z.infer<typeof dailyViewModeSchema>;

export const dailyKanbanGroupBySchema = z.enum(["status", "priority", "branch"]);
export type DailyKanbanGroupBy = z.infer<typeof dailyKanbanGroupBySchema>;

export const librarySortBySchema = z.enum(["updatedAt", "createdAt", "title", "kind", "space"]);
export type LibrarySortByPref = z.infer<typeof librarySortBySchema>;

export const threadsViewModeSchema = z.enum(["status", "conflicts"]);
export type ThreadsViewMode = z.infer<typeof threadsViewModeSchema>;

export const INBOX_TABS = ["exceptions", "digest", "clips", "snoozed"] as const;
export const inboxTabSchema = z.enum(INBOX_TABS);
export type InboxTabPref = z.infer<typeof inboxTabSchema>;

/** Maps legacy 6-tab Inbox values cleanly onto the Quiet Autonomy 4-bucket tabs. */
export function normalizeLegacyInboxTab(value: unknown): InboxTabPref | undefined {
  if (typeof value !== "string") return undefined;
  const direct = inboxTabSchema.safeParse(value);
  if (direct.success) return direct.data;
  if (value === "approvals" || value === "alerts") return "exceptions";
  if (value === "reviews" || value === "all") return "digest";
  return undefined;
}

export const sidebarModeSchema = z.enum(["tree", "doc"]);
export type SidebarModePref = z.infer<typeof sidebarModeSchema>;

const libraryDisplayOptionsBaseShape = {
  showExcerpt: z.boolean(),
  showTags: z.boolean(),
  showAdeBadge: z.boolean(),
  showProperties: z.boolean(),
  showEmptyDailies: z.boolean(),
  density: uiDensitySchema,
};

export const libraryDisplayOptionsPrefSchema = z.object({
  showExcerpt: libraryDisplayOptionsBaseShape.showExcerpt.default(true),
  showTags: libraryDisplayOptionsBaseShape.showTags.default(true),
  showAdeBadge: libraryDisplayOptionsBaseShape.showAdeBadge.default(true),
  showProperties: libraryDisplayOptionsBaseShape.showProperties.default(true),
  showEmptyDailies: libraryDisplayOptionsBaseShape.showEmptyDailies.default(false),
  density: libraryDisplayOptionsBaseShape.density.default("comfortable"),
});

const tasksPreferencesBaseShape = {
  viewMode: tasksViewModeSchema,
  boardGroupBy: tasksBoardGroupBySchema,
  groupFilter: tasksGroupFilterSchema,
  statusFilter: tasksStatusFilterSchema,
  quickAddPreset: tasksQuickAddPresetSchema,
  showCompletedInAll: z.boolean(),
};

export const tasksPreferencesSchema = z.object({
  viewMode: tasksPreferencesBaseShape.viewMode.default("list"),
  boardGroupBy: tasksPreferencesBaseShape.boardGroupBy.default("schedule"),
  groupFilter: tasksPreferencesBaseShape.groupFilter.default("all"),
  statusFilter: tasksPreferencesBaseShape.statusFilter.default("open"),
  quickAddPreset: tasksPreferencesBaseShape.quickAddPreset.default("today"),
  showCompletedInAll: tasksPreferencesBaseShape.showCompletedInAll.default(false),
});

const dailyPreferencesBaseShape = {
  viewMode: dailyViewModeSchema,
  kanbanGroupBy: dailyKanbanGroupBySchema,
  focusRailOpen: z.boolean(),
  streamMode: z.boolean(),
  todosExpanded: z.boolean(),
};

export const dailyPreferencesSchema = z.object({
  viewMode: dailyPreferencesBaseShape.viewMode.default("outline"),
  kanbanGroupBy: dailyPreferencesBaseShape.kanbanGroupBy.default("status"),
  focusRailOpen: dailyPreferencesBaseShape.focusRailOpen.default(false),
  streamMode: dailyPreferencesBaseShape.streamMode.default(false),
  todosExpanded: dailyPreferencesBaseShape.todosExpanded.default(false),
});

export const libraryPreferencesSchema = z.object({
  viewMode: libraryViewModeSchema.default("list"),
  sortBy: librarySortBySchema.default("updatedAt"),
  sortDir: sortDirectionSchema.default("desc"),
  displayOptions: libraryDisplayOptionsPrefSchema.default(() => ({
    showExcerpt: true,
    showTags: true,
    showAdeBadge: true,
    showProperties: true,
    showEmptyDailies: false,
    density: "comfortable" as const,
  })),
});

const threadsPreferencesBaseShape = {
  viewMode: threadsViewModeSchema,
  hostFilter: z.string().trim().min(1).max(64),
};

export const threadsPreferencesSchema = z.object({
  viewMode: threadsPreferencesBaseShape.viewMode.default("status"),
  hostFilter: threadsPreferencesBaseShape.hostFilter.default("all"),
});

const inboxPreferencesBaseShape = {
  defaultTab: z.preprocess((val) => normalizeLegacyInboxTab(val) ?? val, inboxTabSchema),
};

export const inboxPreferencesSchema = z.object({
  defaultTab: inboxTabSchema.default("exceptions"),
});

const layoutPreferencesBaseShape = {
  workspaceCanvasWidth: workspaceCanvasWidthSchema,
  sidebarMode: sidebarModeSchema,
  showFormatBar: z.boolean(),
  enableWorkspaceTabs: z.boolean(),
};

export const layoutPreferencesSchema = z.object({
  workspaceCanvasWidth: layoutPreferencesBaseShape.workspaceCanvasWidth.default("fluid"),
  sidebarMode: layoutPreferencesBaseShape.sidebarMode.default("tree"),
  showFormatBar: layoutPreferencesBaseShape.showFormatBar.default(false),
  enableWorkspaceTabs: layoutPreferencesBaseShape.enableWorkspaceTabs.default(false),
});

const readerPreferencesBaseShape = {
  fontFamily: readerFontFamilySchema,
  fontSize: readerFontSizeSchema,
  measure: readerMeasureSchema,
  paper: readerPaperModeSchema,
};

export const readerPreferencesSchema = z.object({
  fontFamily: readerPreferencesBaseShape.fontFamily.default("sans"),
  fontSize: readerPreferencesBaseShape.fontSize.default("base"),
  measure: readerPreferencesBaseShape.measure.default("72ch"),
  paper: readerPreferencesBaseShape.paper.default("default"),
});

export const userPreferencesSchema = z.object({
  tasks: tasksPreferencesSchema.default(() => tasksPreferencesSchema.parse({})),
  daily: dailyPreferencesSchema.default(() => dailyPreferencesSchema.parse({})),
  library: libraryPreferencesSchema.default(() => libraryPreferencesSchema.parse({})),
  threads: threadsPreferencesSchema.default(() => threadsPreferencesSchema.parse({})),
  inbox: inboxPreferencesSchema.default(() => inboxPreferencesSchema.parse({})),
  layout: layoutPreferencesSchema.default(() => layoutPreferencesSchema.parse({})),
  reader: readerPreferencesSchema.default(() => readerPreferencesSchema.parse({})),
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const userPreferencesPatchSchema = z.object({
  tasks: z.object(tasksPreferencesBaseShape).partial().optional(),
  daily: z.object(dailyPreferencesBaseShape).partial().optional(),
  library: z
    .object({
      viewMode: libraryViewModeSchema.optional(),
      sortBy: librarySortBySchema.optional(),
      sortDir: sortDirectionSchema.optional(),
      displayOptions: z.object(libraryDisplayOptionsBaseShape).partial().optional(),
    })
    .optional(),
  threads: z.object(threadsPreferencesBaseShape).partial().optional(),
  inbox: z.object(inboxPreferencesBaseShape).partial().optional(),
  layout: z.object(layoutPreferencesBaseShape).partial().optional(),
  reader: z.object(readerPreferencesBaseShape).partial().optional(),
});

export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>;

export const userPreferencesRecordSchema = z.object({
  preferences: userPreferencesSchema,
  updatedAt: z.string().nullable(),
});

export type UserPreferencesRecord = z.infer<typeof userPreferencesRecordSchema>;

export const DEFAULT_USER_PREFERENCES: UserPreferences = Object.freeze({
  tasks: {
    viewMode: "list",
    boardGroupBy: "schedule",
    groupFilter: "all",
    statusFilter: "open",
    quickAddPreset: "today",
    showCompletedInAll: false,
  },
  daily: {
    viewMode: "outline",
    kanbanGroupBy: "status",
    focusRailOpen: false,
    streamMode: false,
    todosExpanded: false,
  },
  library: {
    viewMode: "list",
    sortBy: "updatedAt",
    sortDir: "desc",
    displayOptions: {
      showExcerpt: true,
      showTags: true,
      showAdeBadge: true,
      showProperties: true,
      showEmptyDailies: false,
      density: "comfortable",
    },
  },
  threads: {
    viewMode: "status",
    hostFilter: "all",
  },
  inbox: {
    defaultTab: "exceptions",
  },
  layout: {
    workspaceCanvasWidth: "fluid",
    sidebarMode: "tree",
    showFormatBar: false,
    enableWorkspaceTabs: false,
  },
  reader: {
    fontFamily: "sans",
    fontSize: "base",
    measure: "72ch",
    paper: "default",
  },
});

export function cloneDefaultUserPreferences(): UserPreferences {
  return {
    tasks: { ...DEFAULT_USER_PREFERENCES.tasks },
    daily: { ...DEFAULT_USER_PREFERENCES.daily },
    library: {
      ...DEFAULT_USER_PREFERENCES.library,
      displayOptions: { ...DEFAULT_USER_PREFERENCES.library.displayOptions },
    },
    threads: { ...DEFAULT_USER_PREFERENCES.threads },
    inbox: { ...DEFAULT_USER_PREFERENCES.inbox },
    layout: { ...DEFAULT_USER_PREFERENCES.layout },
    reader: { ...DEFAULT_USER_PREFERENCES.reader },
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripInvalidFields(
  input: Record<string, unknown>,
  shape: Record<string, z.ZodTypeAny>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, validator] of Object.entries(shape)) {
    if (input[key] === undefined) continue;
    const res = validator.safeParse(input[key]);
    if (res.success) {
      out[key] = res.data;
    }
  }
  return out;
}

/**
 * Fault-tolerant parser for persisted JSON blobs: preserves valid fields while falling back to
 * defaults per-field on corrupted or outdated schemas.
 */
export function parseUserPreferences(raw: unknown): UserPreferences {
  const base = cloneDefaultUserPreferences();
  if (!isPlainRecord(raw)) {
    return base;
  }

  const parsedPatch = userPreferencesPatchSchema.safeParse({
    tasks: isPlainRecord(raw.tasks)
      ? stripInvalidFields(raw.tasks, tasksPreferencesSchema.shape)
      : undefined,
    daily: isPlainRecord(raw.daily)
      ? stripInvalidFields(raw.daily, dailyPreferencesSchema.shape)
      : undefined,
    library: isPlainRecord(raw.library)
      ? {
          ...stripInvalidFields(raw.library, {
            viewMode: libraryViewModeSchema,
            sortBy: librarySortBySchema,
            sortDir: sortDirectionSchema,
          }),
          displayOptions: isPlainRecord(raw.library.displayOptions)
            ? stripInvalidFields(
                raw.library.displayOptions,
                libraryDisplayOptionsPrefSchema.shape,
              )
            : undefined,
        }
      : undefined,
    threads: isPlainRecord(raw.threads)
      ? stripInvalidFields(raw.threads, threadsPreferencesSchema.shape)
      : undefined,
    inbox: isPlainRecord(raw.inbox)
      ? stripInvalidFields(
          raw.inbox.defaultTab !== undefined
            ? { ...raw.inbox, defaultTab: normalizeLegacyInboxTab(raw.inbox.defaultTab) }
            : raw.inbox,
          inboxPreferencesSchema.shape,
        )
      : undefined,
    layout: isPlainRecord(raw.layout)
      ? stripInvalidFields(raw.layout, layoutPreferencesSchema.shape)
      : undefined,
    reader: isPlainRecord(raw.reader)
      ? stripInvalidFields(raw.reader, readerPreferencesSchema.shape)
      : undefined,
  });

  if (!parsedPatch.success) {
    return base;
  }
  return mergeUserPreferences(base, parsedPatch.data);
}

function mergeDefined<T extends Record<string, unknown>>(
  base: T,
  patch: { readonly [K in keyof T]?: T[K] | undefined } | undefined,
): T {
  if (!patch) return { ...base };
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

export function mergeUserPreferences(
  base: UserPreferences,
  patch: UserPreferencesPatch,
): UserPreferences {
  return {
    tasks: mergeDefined(base.tasks, patch.tasks),
    daily: mergeDefined(base.daily, patch.daily),
    library: {
      viewMode: patch.library?.viewMode ?? base.library.viewMode,
      sortBy: patch.library?.sortBy ?? base.library.sortBy,
      sortDir: patch.library?.sortDir ?? base.library.sortDir,
      displayOptions: mergeDefined(base.library.displayOptions, patch.library?.displayOptions),
    },
    threads: mergeDefined(base.threads, patch.threads),
    inbox: mergeDefined(base.inbox, patch.inbox),
    layout: mergeDefined(base.layout, patch.layout),
    reader: mergeDefined(base.reader, patch.reader),
  };
}
