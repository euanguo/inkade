import type {
  ReaderFontFamilyPref,
  ReaderFontSizePref,
  ReaderMeasurePref,
  ReaderPaperModePref,
  ReaderTypographyPrefs,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { TypeIcon } from "lucide-react";
import type React from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "../primitives/button.tsx";
import { Popover, PopoverPopup, PopoverTrigger } from "../primitives/popover.tsx";

export type { ReaderTypographyPrefs };

export const DEFAULT_TYPOGRAPHY_PREFS: ReaderTypographyPrefs = {
  fontFamily: "sans",
  fontSize: "base",
  measure: "72ch",
  paper: "default",
};

export interface TypographyPopoverProps {
  readonly value: ReaderTypographyPrefs;
  readonly onChange: (next: ReaderTypographyPrefs) => void;
  readonly className?: string | undefined;
}

export function TypographyPopover({
  value,
  onChange,
  className,
}: TypographyPopoverProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  const updateField = <K extends keyof ReaderTypographyPrefs>(
    key: K,
    nextVal: ReaderTypographyPrefs[K],
  ): void => {
    onChange({
      ...value,
      [key]: nextVal,
    });
  };

  const fontOptions: ReadonlyArray<{
    readonly id: ReaderFontFamilyPref;
    readonly label: string;
    readonly previewClass: string;
  }> = [
    { id: "sans", label: t("reader.fontSans"), previewClass: "font-sans" },
    { id: "serif", label: t("reader.fontSerif"), previewClass: "font-serif" },
    { id: "mono", label: t("reader.fontMono"), previewClass: "font-mono" },
  ];

  const sizeOptions: ReadonlyArray<{
    readonly id: ReaderFontSizePref;
    readonly label: string;
  }> = [
    { id: "sm", label: t("reader.fontSizeSm") },
    { id: "base", label: t("reader.fontSizeBase") },
    { id: "lg", label: t("reader.fontSizeLg") },
  ];

  const measureOptions: ReadonlyArray<{
    readonly id: ReaderMeasurePref;
    readonly label: string;
  }> = [
    { id: "65ch", label: t("reader.measureNarrow") },
    { id: "72ch", label: t("reader.measureMedium") },
    { id: "88ch", label: t("reader.measureWide") },
    { id: "full", label: t("reader.measureFull") },
  ];

  const paperOptions: ReadonlyArray<{
    readonly id: ReaderPaperModePref;
    readonly label: string;
    readonly swatchClass: string;
  }> = [
    {
      id: "default",
      label: t("reader.paperCrisp"),
      swatchClass: "bg-[#ffffff] border-neutral-300 dark:bg-[#141517] dark:border-neutral-700",
    },
    {
      id: "sepia",
      label: t("reader.paperSepia"),
      swatchClass: "bg-[#fbf8f1] border-[#d8cbb0] dark:bg-[#161411] dark:border-[#4b3e2b]",
    },
  ];

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("reader.typographyButtonAria")}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md border border-border/70 bg-background/80 px-2 text-xs font-medium text-foreground/85 outline-none transition-colors duration-[var(--duration-quick)] hover:border-border hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          value.paper === "sepia" &&
            "border-[#d7c9ab] bg-[#f4ecdb]/80 dark:border-[#3e3427] dark:bg-[#221d16]",
          className,
        )}
        data-testid="typography-popover-trigger"
        title={t("reader.typographyButtonTitle")}
      >
        <TypeIcon className="size-3.5" />
        <span>{t("reader.typographyButtonShort")}</span>
      </PopoverTrigger>

      <PopoverPopup align="end" className="w-[min(20rem,calc(100vw-2rem))] p-3.5" sideOffset={8}>
        <div className="flex flex-col gap-3.5" data-testid="typography-popover-panel">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              {t("reader.typographyPanelTitle")}
            </span>
            <Button
              onClick={() => onChange(DEFAULT_TYPOGRAPHY_PREFS)}
              size="xs"
              type="button"
              variant="ghost"
            >
              {t("reader.typographyReset")}
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("reader.fontFamilyLabel")}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {fontOptions.map((opt) => {
                const active = value.fontFamily === opt.id;
                return (
                  <button
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-1.5 text-xs transition-colors duration-[var(--duration-quick)]",
                      active
                        ? "border-primary bg-primary/10 font-semibold text-foreground"
                        : "border-border/70 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
                    )}
                    key={opt.id}
                    onClick={() => updateField("fontFamily", opt.id)}
                    type="button"
                  >
                    <span className={cn("text-sm leading-none", opt.previewClass)}>
                      {t("reader.typographySampleGlyph")}
                    </span>
                    <span className="whitespace-nowrap text-[11px]">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("reader.fontSizeLabel")}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {sizeOptions.map((opt) => {
                const active = value.fontSize === opt.id;
                return (
                  <button
                    aria-pressed={active}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs transition-colors duration-[var(--duration-quick)]",
                      active
                        ? "border-primary bg-primary/10 font-semibold text-foreground"
                        : "border-border/70 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
                    )}
                    key={opt.id}
                    onClick={() => updateField("fontSize", opt.id)}
                    type="button"
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hidden flex-col gap-1.5 sm:flex">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("reader.measureLabel")}
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {measureOptions.map((opt) => {
                const active = value.measure === opt.id;
                return (
                  <button
                    aria-pressed={active}
                    className={cn(
                      "whitespace-nowrap rounded-md border px-2 py-1 text-[11px] transition-colors duration-[var(--duration-quick)]",
                      active
                        ? "border-primary bg-primary/10 font-semibold text-foreground"
                        : "border-border/70 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
                    )}
                    key={opt.id}
                    onClick={() => updateField("measure", opt.id)}
                    type="button"
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("reader.paperThemeLabel")}
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {paperOptions.map((opt) => {
                const active = value.paper === opt.id;
                return (
                  <button
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors duration-[var(--duration-quick)]",
                      active
                        ? "border-primary bg-primary/10 font-semibold text-foreground"
                        : "border-border/70 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
                    )}
                    key={opt.id}
                    onClick={() => updateField("paper", opt.id)}
                    type="button"
                  >
                    <span className={cn("size-3.5 shrink-0 rounded-full border", opt.swatchClass)} />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
