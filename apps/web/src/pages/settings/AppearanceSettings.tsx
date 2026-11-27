import {
  ACCENT_PRESETS,
  type AccentPreset,
  MOTION_PROFILES,
  READER_FONT_FAMILIES,
  READER_MEASURES,
  type ReaderFontFamilyPref,
  type ReaderMeasurePref,
  SHELL_STYLES,
  type ShellStyle,
  SURFACE_THEMES,
  type SurfaceTheme,
  TYPESET_PRESETS,
} from "@inkade/core";
import { SUPPORTED_LOCALES, useInkadeLocale, useInkadeTranslation } from "@inkade/i18n";
import { useInkadeWorkspaceSummary, useReindexSearchMutation } from "@inkade/sdk/react";
import {
  useAccentPreset,
  useMotionProfile,
  usePaperMode,
  useReaderFont,
  useReaderMeasure,
  useShellStyle,
  useSurfaceTheme,
  useThemePreference,
  useTypesetPreset,
  useUserPreferences,
} from "@inkade/views/lib/preferences-store";
import {
  Badge,
  Button,
  cn,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
} from "@inkade/ui";
import {
  BookOpenTextIcon,
  CheckIcon,
  MonitorIcon,
  MoonIcon,
  RefreshCwIcon,
  SparklesIcon,
  SunIcon,
} from "lucide-react";
import type React from "react";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import { SettingRow, SettingsGroup, SettingsSectionHeader } from "./SettingRow.tsx";
import { runWithThemeRipple } from "../../lib/theme.ts";
import type { SettingsSectionId, SettingsTranslationKey } from "./types.ts";

const ACCENT_META: Readonly<
  Record<
    AccentPreset,
    {
      readonly labelKey: SettingsTranslationKey;
      readonly swatchBg: string;
      readonly ringClass: string;
    }
  >
> = {
  indigo: {
    labelKey: "settings.accentIndigo",
    swatchBg: "bg-[#4f46e5] dark:bg-[#818cf8]",
    ringClass: "border-foreground/35 bg-accent/45",
  },
  sage: {
    labelKey: "settings.accentSage",
    swatchBg: "bg-[#15803d] dark:bg-[#4ade80]",
    ringClass: "border-foreground/35 bg-accent/45",
  },
  terracotta: {
    labelKey: "settings.accentTerracotta",
    swatchBg: "bg-[#c2410c] dark:bg-[#fb923c]",
    ringClass: "border-foreground/35 bg-accent/45",
  },
  mono: {
    labelKey: "settings.accentMono",
    swatchBg: "bg-neutral-800 dark:bg-neutral-100",
    ringClass: "border-foreground/35 bg-accent/45",
  },
};

const SURFACE_PALETTE: Readonly<
  Record<
    SurfaceTheme,
    {
      readonly labelKey: SettingsTranslationKey;
      readonly groundBg: string;
      readonly cardBg: string;
      readonly borderCol: string;
      readonly inkStrong: string;
      readonly inkMuted: string;
      readonly isDark: boolean;
    }
  >
> = {
  light: {
    labelKey: "settings.surfaceLightLabel",
    groundBg: "bg-[#f2f2f2]",
    cardBg: "bg-[#ffffff]",
    borderCol: "border-black/14",
    inkStrong: "bg-black/26",
    inkMuted: "bg-black/12",
    isDark: false,
  },
  "light-dimmed": {
    labelKey: "settings.surfaceLightDimmedLabel",
    groundBg: "bg-[#edeae1]",
    cardBg: "bg-[#faf8f3]",
    borderCol: "border-[#d8d3c6]",
    inkStrong: "bg-[#2b251e]/28",
    inkMuted: "bg-[#2b251e]/14",
    isDark: false,
  },
  dark: {
    labelKey: "settings.surfaceDarkLabel",
    groundBg: "bg-[#090a0c]",
    cardBg: "bg-[#111214]",
    borderCol: "border-white/14",
    inkStrong: "bg-white/30",
    inkMuted: "bg-white/14",
    isDark: true,
  },
  "dark-dimmed": {
    labelKey: "settings.surfaceDarkDimmedLabel",
    groundBg: "bg-[#161a23]",
    cardBg: "bg-[#202634]",
    borderCol: "border-[#343d52]",
    inkStrong: "bg-slate-200/30",
    inkMuted: "bg-slate-200/14",
    isDark: true,
  },
};

function ShellWireframeThumb({ style }: { readonly style: ShellStyle }): React.ReactElement {
  if (style === "inset") {
    return (
      <div className="flex h-16 w-full gap-1.5 overflow-hidden rounded-[calc(var(--radius-card)-0.25rem)] border border-border bg-[#f6f5f1] p-1.5 dark:bg-[#141820]">
        <div className="flex w-1/4 flex-col gap-1.5 px-1 py-1">
          <div className="h-1.5 w-3/4 rounded-full bg-foreground/20" />
          <div className="h-1.5 w-full rounded-full bg-primary/70" />
          <div className="h-1.5 w-2/3 rounded-full bg-foreground/12" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 rounded-sm border border-border bg-background p-2">
          <div className="h-1.5 w-2/5 rounded-full bg-foreground/20" />
          <div className="h-1.5 w-full rounded-full bg-foreground/10" />
          <div className="h-1.5 w-4/5 rounded-full bg-foreground/10" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-16 w-full overflow-hidden rounded-[calc(var(--radius-card)-0.25rem)] border border-border bg-background">
      <div className="flex w-1/3 flex-col gap-1.5 border-r border-border bg-sidebar p-2">
        <div className="h-1.5 w-3/4 rounded-full bg-foreground/20" />
        <div className="h-1.5 w-2/3 rounded-full bg-primary/70" />
        <div className="h-1.5 w-1/2 rounded-full bg-foreground/12" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="h-1.5 w-2/5 rounded-full bg-foreground/20" />
        <div className="h-1.5 w-full rounded-full bg-foreground/10" />
        <div className="h-1.5 w-4/5 rounded-full bg-foreground/10" />
      </div>
    </div>
  );
}

function SurfacePreviewThumb({ surface }: { readonly surface: SurfaceTheme }): React.ReactElement {
  const palette = SURFACE_PALETTE[surface];
  return (
    <div
      className={cn(
        "flex h-14 w-full gap-1 overflow-hidden rounded-[calc(var(--radius-card)-0.25rem)] border p-1.5",
        palette.borderCol,
        palette.groundBg,
      )}
    >
      <div className="flex w-1/4 flex-col gap-1 px-0.5 py-1">
        <div className={cn("h-1 w-4/5 rounded-full", palette.inkStrong)} />
        <div className={cn("h-1 w-full rounded-full", palette.inkStrong)} />
        <div className={cn("h-1 w-2/3 rounded-full", palette.inkMuted)} />
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col gap-1.5 rounded-sm border p-2",
          palette.borderCol,
          palette.cardBg,
        )}
      >
        <div className={cn("h-1.5 w-1/2 rounded-full", palette.inkStrong)} />
        <div className={cn("h-1 w-full rounded-full", palette.inkMuted)} />
        <div className={cn("h-1 w-3/4 rounded-full", palette.inkMuted)} />
      </div>
    </div>
  );
}

export interface AppearanceSettingsProps {
  readonly onNavigateSection?: ((section: SettingsSectionId) => void) | undefined;
}

export function AppearanceSettings({
  onNavigateSection,
}: AppearanceSettingsProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { locale, setLocale } = useInkadeLocale();
  const { preference, effectiveTheme, setPreference } = useThemePreference();
  const { shellStyle, setShellStyle } = useShellStyle();
  const { surfaceTheme, setSurfaceTheme } = useSurfaceTheme();
  const { accent, setAccent } = useAccentPreset();
  const { paper, setPaper } = usePaperMode();
  const { readerFont, setReaderFont } = useReaderFont();
  const { readerMeasure, setReaderMeasure } = useReaderMeasure();
  const { preferences, updatePreferences } = useUserPreferences();
  const { typesetPreset, setTypesetPreset } = useTypesetPreset();
  const { motionProfile, setMotionProfile } = useMotionProfile();

  const summaryQuery = useInkadeWorkspaceSummary();

  const reindexMutation = useReindexSearchMutation({
    onSuccess: (res) => {
      showSuccessToast(
        t("settings.ragReindexSuccessToast"),
        t("settings.ragReindexResultBanner", {
          indexed: res.indexedCount,
          skipped: res.skippedCount,
          provider: res.provider,
          model: res.model,
        }),
      );
    },
    onError: (err) => showErrorToast(t("settings.ragReindexFailedToast"), err),
  });

  const activeDocCount = (summaryQuery.data?.spaces ?? []).reduce(
    (sum, s) => sum + s.activeCount,
    0,
  );

  const fontLabels: Readonly<Record<ReaderFontFamilyPref, string>> = {
    sans: t("settings.readerFontSans"),
    serif: t("settings.readerFontSerif"),
    mono: t("settings.readerFontMono"),
  };

  const measureLabels: Readonly<Record<ReaderMeasurePref, string>> = {
    "65ch": t("settings.measure65ch"),
    "72ch": t("settings.measure72ch"),
    "88ch": t("settings.measure88ch"),
    full: t("settings.measureFull"),
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        description={t("settings.sectionAppearanceDesc")}
        title={t("settings.sectionAppearanceLabel")}
      />

      {/* Shell Style & 4-Tier Surface Theme */}
      <SettingsGroup>
        <SettingRow
          description={t("settings.appearanceShellDesc")}
          layout="vertical"
          title={t("settings.appearanceShellTitle")}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup">
            {SHELL_STYLES.map((style) => {
              const selected = shellStyle === style;
              const labelKey =
                style === "inset" ? "settings.shellInsetLabel" : "settings.shellFlushLabel";
              const descKey =
                style === "inset" ? "settings.shellInsetDesc" : "settings.shellFlushDesc";
              return (
                <button
                  aria-checked={selected}
                  className={cn(
                    "group flex cursor-pointer flex-col gap-2.5 rounded-lg border p-2.5 text-left transition-[border-color,background-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
                    selected
                      ? "border-foreground/35 bg-accent/45"
                      : "border-border bg-background/50 hover:border-foreground/20 hover:bg-accent/40",
                  )}
                  key={style}
                  onClick={() => setShellStyle(style)}
                  role="radio"
                  type="button"
                >
                  <ShellWireframeThumb style={style} />
                  <div className="flex items-start justify-between gap-2 px-0.5">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">{t(labelKey)}</div>
                      <div className="text-[11px] text-muted-foreground">{t(descKey)}</div>
                    </div>
                    {selected ? (
                      <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <CheckIcon className="size-2.5" />
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow
          description={t("settings.appearanceSurfaceDesc")}
          layout="vertical"
          title={t("settings.appearanceSurfaceTitle")}
        >
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="radiogroup">
            {SURFACE_THEMES.map((surface) => {
              const selected = surfaceTheme === surface;
              const palette = SURFACE_PALETTE[surface];
              const Icon = palette.isDark ? MoonIcon : SunIcon;
              return (
                <button
                  aria-checked={selected}
                  className={cn(
                    "group flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-left transition-[border-color,background-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
                    selected
                      ? "border-foreground/35 bg-accent/45"
                      : "border-border bg-background/50 hover:border-foreground/20 hover:bg-accent/40",
                  )}
                  key={surface}
                  onClick={(event) =>
                    runWithThemeRipple(() => setSurfaceTheme(surface), event, { motionProfile })
                  }
                  role="radio"
                  type="button"
                >
                  <SurfacePreviewThumb surface={surface} />
                  <div className="flex items-center justify-between gap-1.5 px-0.5">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                      <Icon className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{t(palette.labelKey)}</span>
                    </span>
                    {selected ? (
                      <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <CheckIcon className="size-2.5" />
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow
          badge={
            preference === "system" ? (
              <Badge size="sm" variant="secondary">
                <MonitorIcon className="size-3" />
                {t("settings.themeSystem")}
              </Badge>
            ) : undefined
          }
          description={t("settings.followSystemDesc")}
          title={t("settings.followSystemTitle")}
        >
          <Switch
            aria-label={t("settings.followSystemTitle")}
            checked={preference === "system"}
            onCheckedChange={(checked) => setPreference(checked ? "system" : effectiveTheme)}
          />
        </SettingRow>

        {/* Brand Accent Swatches */}
        <SettingRow
          description={t("settings.appearanceAccentDesc")}
          layout="vertical"
          title={t("settings.appearanceAccentTitle")}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
            {ACCENT_PRESETS.map((preset) => {
              const meta = ACCENT_META[preset];
              const selected = accent === preset;
              return (
                <button
                  aria-checked={selected}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-1.5 rounded-lg border px-2.5 py-2 text-left transition-[border-color,background-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
                    selected
                      ? meta.ringClass
                      : "border-border bg-background/50 hover:border-foreground/20 hover:bg-accent/40",
                  )}
                  key={preset}
                  onClick={() => setAccent(preset)}
                  role="radio"
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn("size-3.5 shrink-0 rounded-full", meta.swatchBg)}
                    />
                    <span className="truncate text-xs font-medium text-foreground">
                      {t(meta.labelKey)}
                    </span>
                  </span>
                  {selected ? (
                    <CheckIcon className="size-3.5 shrink-0 text-primary" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </SettingRow>
      </SettingsGroup>

      {/* Warm Paper / Sepia, Reader Typography & Language */}
      <SettingsGroup>
        <SettingRow
          description={t("settings.appearancePaperDesc")}
          layout="vertical"
          title={t("settings.appearancePaperTitle")}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BookOpenTextIcon className="size-3.5" />
              <span>
                {paper === "sepia"
                  ? t("settings.paperSepiaLabel")
                  : t("settings.paperDefaultLabel")}
              </span>
            </div>
            <Switch
              aria-label={t("settings.appearancePaperTitle")}
              checked={paper === "sepia"}
              onCheckedChange={(checked) => setPaper(checked ? "sepia" : "default")}
            />
          </div>
          <div
            className={cn(
              "rounded-xl border px-4 py-3 text-xs leading-relaxed transition-colors duration-150",
              paper === "sepia"
                ? "inkade-paper-sepia border-[var(--paper-sepia-border)]"
                : "border-border bg-background text-foreground",
            )}
            data-paper={paper}
          >
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider opacity-70">
              {t("settings.paperPreviewTitle")}
            </div>
            <p className="m-0">{t("settings.paperPreviewSample")}</p>
          </div>
        </SettingRow>

        <SettingRow
          description={t("settings.appearanceReaderFontDesc")}
          title={t("settings.appearanceReaderFontTitle")}
        >
          <SegmentedControl size="sm">
            {READER_FONT_FAMILIES.map((font) => (
              <SegmentedControlItem
                data-checked={readerFont === font ? "" : undefined}
                key={font}
                onClick={() => setReaderFont(font)}
              >
                {fontLabels[font]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </SettingRow>

        <SettingRow
          description={t("settings.appearanceReaderMeasureDesc")}
          title={t("settings.appearanceReaderMeasureTitle")}
        >
          <SegmentedControl size="sm">
            {READER_MEASURES.map((measure) => (
              <SegmentedControlItem
                data-checked={readerMeasure === measure ? "" : undefined}
                key={measure}
                onClick={() => {
                  setReaderMeasure(measure);
                  updatePreferences({ reader: { measure } });
                }}
              >
                {measureLabels[measure]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </SettingRow>

        <SettingRow
          description={t("settings.workspaceWidthDesc")}
          title={t("settings.workspaceWidthTitle")}
        >
          <SegmentedControl size="sm">
            <SegmentedControlItem
              data-checked={preferences.layout.workspaceCanvasWidth === "fluid" ? "" : undefined}
              onClick={() => updatePreferences({ layout: { workspaceCanvasWidth: "fluid" } })}
            >
              {t("settings.workspaceWidthFluid")}
            </SegmentedControlItem>
            <SegmentedControlItem
              data-checked={preferences.layout.workspaceCanvasWidth === "centered" ? "" : undefined}
              onClick={() => updatePreferences({ layout: { workspaceCanvasWidth: "centered" } })}
            >
              {t("settings.workspaceWidthCentered")}
            </SegmentedControlItem>
          </SegmentedControl>
        </SettingRow>

        <SettingRow
          badge={
            <Badge size="sm" variant="secondary">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
              {t("settings.appearanceSmoothStreamBadge")}
            </Badge>
          }
          description={t("settings.appearanceStreamRhythmDesc")}
          layout="vertical"
          title={t("settings.appearanceStreamRhythmTitle")}
        >
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t("settings.appearanceTypesetLabel")}
              </span>
              <SegmentedControl size="sm">
                {TYPESET_PRESETS.map((preset) => {
                  const label =
                    preset === "compact"
                      ? t("settings.typesetCompact")
                      : preset === "relaxed"
                        ? t("settings.typesetRelaxed")
                        : `${t("settings.typesetStandard")} · ${t("settings.appearanceTypesetStandardNote")}`;
                  return (
                    <SegmentedControlItem
                      data-checked={typesetPreset === preset ? "" : undefined}
                      data-typeset-option={preset}
                      key={preset}
                      onClick={() => setTypesetPreset(preset)}
                    >
                      {label}
                    </SegmentedControlItem>
                  );
                })}
              </SegmentedControl>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t("settings.appearanceMotionProfileLabel")}
              </span>
              <SegmentedControl size="sm">
                {MOTION_PROFILES.map((profile) => (
                  <SegmentedControlItem
                    data-checked={motionProfile === profile ? "" : undefined}
                    data-motion-option={profile}
                    key={profile}
                    onClick={() => setMotionProfile(profile)}
                  >
                    {profile === "comfort"
                      ? t("settings.motionComfort")
                      : t("settings.motionReducedPulse")}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>
          </div>
        </SettingRow>

        <SettingRow
          description={t("settings.appearanceLanguageDesc")}
          title={t("settings.appearanceLanguageTitle")}
        >
          <SegmentedControl size="sm">
            {SUPPORTED_LOCALES.map((loc) => (
              <SegmentedControlItem
                data-checked={locale === loc ? "" : undefined}
                key={loc}
                onClick={() => void setLocale(loc)}
              >
                {loc === "zh-CN" ? t("settings.localeZhCn") : t("settings.localeEnUs")}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </SettingRow>

        <SettingRow
          description={t("tabs.enableDesc")}
          title={t("tabs.enableLabel")}
        >
          <Switch
            aria-label={t("tabs.enableLabel")}
            checked={preferences.layout.enableWorkspaceTabs}
            onCheckedChange={(checked) =>
              updatePreferences({ layout: { enableWorkspaceTabs: checked } })
            }
          />
        </SettingRow>
      </SettingsGroup>

      {/* Compact Hybrid RAG Status Summary Card */}
      <SettingsGroup>
        <SettingRow
          badge={
            <Badge size="sm" variant="secondary">
              <SparklesIcon className="size-3 text-primary" />
              {t("settings.ragStatusReady")}
            </Badge>
          }
          description={t("settings.ragSummaryDesc", { count: activeDocCount })}
          title={t("settings.ragSummaryTitle")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button
              loading={reindexMutation.isPending}
              onClick={() => reindexMutation.mutate()}
              size="xs"
              variant="outline"
            >
              <RefreshCwIcon className={reindexMutation.isPending ? "animate-spin" : undefined} />
              <span>{t("settings.ragReindexAction")}</span>
            </Button>
            {onNavigateSection ? (
              <Button
                onClick={() => onNavigateSection("rag")}
                size="xs"
                variant="secondary"
              >
                {t("settings.ragSummaryAction")}
              </Button>
            ) : null}
          </div>
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
