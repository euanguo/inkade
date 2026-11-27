import type { Space } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Card,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
} from "@inkade/ui/primitives";
import type { ClipperSettings } from "../../shared/storage.ts";
import { HostKindPicker } from "../HostKindPicker.tsx";
import { TagChipsInput, type TagSuggestionItem } from "../TagChipsInput.tsx";
import { SpaceSelectField } from "../shared/SpaceSelectField.tsx";
import { getHighlightColorLabel } from "../shared/clipper-ui-helpers.ts";
import type { OptionsCaptureState } from "./useOptionsController.ts";

export interface OptionsCaptureSectionProps {
  readonly capture: OptionsCaptureState;
  readonly spaces: readonly Space[];
  readonly tagSuggestions: readonly TagSuggestionItem[];
  readonly onUpdatePatch: (
    capturePatch: Partial<OptionsCaptureState>,
    settingsPatch: Partial<ClipperSettings>,
  ) => void;
}

export function OptionsCaptureSection({
  capture,
  spaces,
  tagSuggestions,
  onUpdatePatch,
}: OptionsCaptureSectionProps) {
  const { t } = useInkadeTranslation();

  const localeLabel =
    capture.selectedLocale === "en-US" ? t("clipper.languageEn") : t("clipper.languageZh");
  const clipModeLabel =
    capture.clipMode === "server-ingest"
      ? t("clipper.clipModeServerIngest")
      : t("clipper.clipModeClientDom");
  const highlightColorLabel = getHighlightColorLabel(t, capture.highlightColor);
  const surfaceThemeLabel =
    capture.surfaceTheme === "light"
      ? t("clipper.surfaceLight")
      : capture.surfaceTheme === "light-dimmed"
        ? t("clipper.surfaceLightDimmed")
        : capture.surfaceTheme === "dark"
          ? t("clipper.surfaceDark")
          : capture.surfaceTheme === "dark-dimmed"
            ? t("clipper.surfaceDarkDimmed")
            : t("clipper.surfaceSystem");
  const accentPresetLabel =
    capture.accentPreset === "indigo"
      ? t("clipper.accentIndigo")
      : capture.accentPreset === "sage"
        ? t("clipper.accentSage")
        : capture.accentPreset === "terracotta"
          ? t("clipper.accentTerracotta")
          : t("clipper.accentMono");
  const readerThemeLabel =
    capture.readerTheme === "light"
      ? t("clipper.readerThemeLight")
      : capture.readerTheme === "dark"
        ? t("clipper.readerThemeDark")
        : t("clipper.readerThemeSepia");

  const captureToggles: readonly {
    readonly id: string;
    readonly label: string;
    readonly checked: boolean;
    readonly disabled?: boolean | undefined;
    readonly onChange: (checked: boolean) => void;
  }[] = [
    {
      id: "opt-mirror-images",
      label: t("clipper.mirrorImagesToggle"),
      checked: capture.mirrorImages,
      onChange: (checked) => onUpdatePatch({ mirrorImages: checked }, { mirrorImages: checked }),
    },
    {
      id: "opt-async-mirror",
      label: t("clipper.asyncImageMirrorToggle"),
      checked: capture.autoMirrorImagesAsync,
      disabled: !capture.mirrorImages,
      onChange: (checked) =>
        onUpdatePatch({ autoMirrorImagesAsync: checked }, { autoMirrorImagesAsync: checked }),
    },
    {
      id: "opt-compress-webp",
      label: t("clipper.compressWebpToggle"),
      checked: capture.compressImagesToWebp,
      disabled: !capture.mirrorImages,
      onChange: (checked) =>
        onUpdatePatch({ compressImagesToWebp: checked }, { compressImagesToWebp: checked }),
    },
    {
      id: "opt-save-snapshot",
      label: t("clipper.saveSnapshotToggle"),
      checked: capture.saveHtmlSnapshot,
      onChange: (checked) =>
        onUpdatePatch({ saveHtmlSnapshot: checked }, { saveHtmlSnapshot: checked }),
    },
    {
      id: "opt-floating-toolbar",
      label: t("clipper.showFloatingToolbarToggle"),
      checked: capture.showFloatingToolbar,
      onChange: (checked) =>
        onUpdatePatch({ showFloatingToolbar: checked }, { showFloatingToolbar: checked }),
    },
    {
      id: "opt-auto-restore",
      label: t("clipper.autoRestoreHighlightsToggle"),
      checked: capture.autoRestoreHighlights,
      onChange: (checked) =>
        onUpdatePatch({ autoRestoreHighlights: checked }, { autoRestoreHighlights: checked }),
    },
    {
      id: "opt-append-daily",
      label: t("clipper.defaultAppendDailyToggle"),
      checked: capture.defaultAppendToDaily,
      onChange: (checked) =>
        onUpdatePatch({ defaultAppendToDaily: checked }, { defaultAppendToDaily: checked }),
    },
    {
      id: "opt-auto-close-popup",
      label: t("clipper.autoClosePopupToggle"),
      checked: capture.autoClosePopupOnClip,
      onChange: (checked) =>
        onUpdatePatch({ autoClosePopupOnClip: checked }, { autoClosePopupOnClip: checked }),
    },
  ];

  return (
    <Card className="gap-4 rounded-lg px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[13px] font-semibold text-foreground">
          {t("clipper.optionsSectionCapture")}
        </h2>
        <span className="text-[11px] text-muted-foreground">{t("clipper.optionsAutoSaveHint")}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SpaceSelectField
          id="opt-space"
          includeUnspecified
          label={t("clipper.defaultSpaceLabel")}
          labelClassName="text-xs text-muted-foreground"
          onChange={(next) =>
            onUpdatePatch({ defaultSpaceId: next }, { defaultSpaceId: next })
          }
          spaces={spaces}
          value={capture.defaultSpaceId}
        />

        <Field className="w-full min-w-0">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="opt-locale">
            {t("clipper.languageLabel")}
          </FieldLabel>
          <Select
            onValueChange={(value) => {
              if (value === "zh-CN" || value === "en-US") {
                onUpdatePatch({ selectedLocale: value }, { locale: value });
              }
            }}
            value={capture.selectedLocale}
          >
            <SelectTrigger className="w-full min-w-0" id="opt-locale" size="sm">
              <SelectValue className="min-w-0 truncate">{localeLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="zh-CN">{t("clipper.languageZh")}</SelectItem>
              <SelectItem value="en-US">{t("clipper.languageEn")}</SelectItem>
            </SelectPopup>
          </Select>
        </Field>
      </div>

      <Field className="w-full min-w-0">
        <FieldLabel className="text-xs text-muted-foreground" htmlFor="opt-tags">
          {t("clipper.defaultTagsLabel")}
        </FieldLabel>
        <TagChipsInput
          id="opt-tags"
          onChange={(next) => onUpdatePatch({ defaultTags: next }, { defaultTags: next })}
          placeholder={t("clipper.defaultTagsPlaceholder")}
          suggestions={tagSuggestions}
          tags={capture.defaultTags}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field className="w-full min-w-0">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="opt-mode">
            {t("clipper.defaultClipModeLabel")}
          </FieldLabel>
          <Select
            onValueChange={(value) => {
              if (value === "client-dom" || value === "server-ingest") {
                onUpdatePatch({ clipMode: value }, { clipMode: value });
              }
            }}
            value={capture.clipMode}
          >
            <SelectTrigger className="w-full min-w-0" id="opt-mode" size="sm">
              <SelectValue className="min-w-0 truncate">{clipModeLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="client-dom">{t("clipper.clipModeClientDom")}</SelectItem>
              <SelectItem value="server-ingest">{t("clipper.clipModeServerIngest")}</SelectItem>
            </SelectPopup>
          </Select>
        </Field>

        <Field className="w-full min-w-0">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="opt-color">
            {t("clipper.defaultHighlightColorLabel")}
          </FieldLabel>
          <Select
            onValueChange={(value) => {
              if (
                value === "amber" ||
                value === "emerald" ||
                value === "blue" ||
                value === "rose"
              ) {
                onUpdatePatch({ highlightColor: value }, { highlightColor: value });
              }
            }}
            value={capture.highlightColor}
          >
            <SelectTrigger className="w-full min-w-0" id="opt-color" size="sm">
              <SelectValue className="min-w-0 truncate">{highlightColorLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="amber">{t("clipper.colorAmber")}</SelectItem>
              <SelectItem value="emerald">{t("clipper.colorEmerald")}</SelectItem>
              <SelectItem value="blue">{t("clipper.colorBlue")}</SelectItem>
              <SelectItem value="rose">{t("clipper.colorRose")}</SelectItem>
            </SelectPopup>
          </Select>
        </Field>

        <Field className="w-full min-w-0">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="opt-ade">
            {t("clipper.defaultAdeKindLabel")}
          </FieldLabel>
          <HostKindPicker
            customInputId="opt-ade-custom-host"
            id="opt-ade"
            onChange={(next) =>
              onUpdatePatch({ defaultAdeKind: next }, { defaultAdeKind: next })
            }
            value={capture.defaultAdeKind}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field className="w-full min-w-0">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="opt-surface-theme">
            {t("clipper.appearanceSurfaceLabel")}
          </FieldLabel>
          <Select
            onValueChange={(value) => {
              if (
                value === "system" ||
                value === "light" ||
                value === "light-dimmed" ||
                value === "dark" ||
                value === "dark-dimmed"
              ) {
                onUpdatePatch({ surfaceTheme: value }, { surfaceTheme: value });
              }
            }}
            value={capture.surfaceTheme}
          >
            <SelectTrigger className="w-full min-w-0" id="opt-surface-theme" size="sm">
              <SelectValue className="min-w-0 truncate">{surfaceThemeLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="system">{t("clipper.surfaceSystem")}</SelectItem>
              <SelectItem value="light">{t("clipper.surfaceLight")}</SelectItem>
              <SelectItem value="light-dimmed">{t("clipper.surfaceLightDimmed")}</SelectItem>
              <SelectItem value="dark">{t("clipper.surfaceDark")}</SelectItem>
              <SelectItem value="dark-dimmed">{t("clipper.surfaceDarkDimmed")}</SelectItem>
            </SelectPopup>
          </Select>
        </Field>

        <Field className="w-full min-w-0">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="opt-accent-preset">
            {t("clipper.appearanceAccentLabel")}
          </FieldLabel>
          <Select
            onValueChange={(value) => {
              if (
                value === "mono" ||
                value === "indigo" ||
                value === "sage" ||
                value === "terracotta"
              ) {
                onUpdatePatch({ accentPreset: value }, { accentPreset: value });
              }
            }}
            value={capture.accentPreset}
          >
            <SelectTrigger className="w-full min-w-0" id="opt-accent-preset" size="sm">
              <SelectValue className="min-w-0 truncate">{accentPresetLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="mono">{t("clipper.accentMono")}</SelectItem>
              <SelectItem value="indigo">{t("clipper.accentIndigo")}</SelectItem>
              <SelectItem value="sage">{t("clipper.accentSage")}</SelectItem>
              <SelectItem value="terracotta">{t("clipper.accentTerracotta")}</SelectItem>
            </SelectPopup>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field className="w-full min-w-0">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="opt-reader-theme">
            {t("clipper.defaultReaderThemeLabel")}
          </FieldLabel>
          <Select
            onValueChange={(value) => {
              if (value === "light" || value === "sepia" || value === "dark") {
                onUpdatePatch({ readerTheme: value }, { readerTheme: value });
              }
            }}
            value={capture.readerTheme}
          >
            <SelectTrigger className="w-full min-w-0" id="opt-reader-theme" size="sm">
              <SelectValue className="min-w-0 truncate">{readerThemeLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="light">{t("clipper.readerThemeLight")}</SelectItem>
              <SelectItem value="sepia">{t("clipper.readerThemeSepia")}</SelectItem>
              <SelectItem value="dark">{t("clipper.readerThemeDark")}</SelectItem>
            </SelectPopup>
          </Select>
        </Field>

        <Field className="w-full min-w-0">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="opt-reader-font">
            {t("clipper.defaultReaderFontSizeLabel")}
          </FieldLabel>
          <div className="flex w-full items-center gap-2">
            <Input
              className="flex-1 tabular-nums"
              id="opt-reader-font"
              max={24}
              min={13}
              onChange={(e) => {
                const val = Math.max(13, Math.min(24, Number(e.target.value) || 17));
                onUpdatePatch({ readerFontSize: val }, { readerFontSize: val });
              }}
              size="sm"
              type="number"
              value={String(capture.readerFontSize)}
            />
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {t("clipper.fontSizePx", { count: capture.readerFontSize })}
            </span>
          </div>
        </Field>
      </div>

      <Separator />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {captureToggles.map((item) => (
          <div
            className={`flex items-center justify-between gap-3 rounded-md bg-muted/45 px-3 py-2 ${
              item.disabled ? "opacity-55" : ""
            }`}
            key={item.id}
          >
            <label
              className={`flex-1 text-xs font-medium text-foreground ${
                item.disabled ? "cursor-not-allowed" : "cursor-pointer"
              }`}
              htmlFor={item.id}
            >
              {item.label}
            </label>
            <Switch
              checked={item.checked}
              disabled={item.disabled}
              id={item.id}
              onCheckedChange={(checked) => item.onChange(Boolean(checked))}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
