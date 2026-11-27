"use client";

import type {
  DocumentKind,
  DocumentRecord,
  ReaderFontFamilyPref,
  ReaderMeasurePref,
  ReaderPaperModePref,
  ReaderTypographyPrefs,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  BookOpenIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  GitCompareIcon,
  PencilIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import { ClipFavicon } from "../../primitives/clip-media.tsx";
import { Popover, PopoverPopup, PopoverTrigger } from "../../primitives/popover.tsx";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../primitives/segmented-control.tsx";
import { DocumentKindIcon, TagPill } from "../../primitives/tag-pill.tsx";

export interface ReaderAgentUpdateBannerProps {
  readonly version: number;
  readonly onViewDiff?: (() => void) | undefined;
  readonly onMarkAgentUpdateRead?: (() => void) | undefined;
}

export function ReaderAgentUpdateBanner({
  version,
  onViewDiff,
  onMarkAgentUpdateRead,
}: ReaderAgentUpdateBannerProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-1.5 text-xs text-muted-foreground"
      data-slot="reader-quiet-update-banner"
      role="status"
    >
      <div className="flex items-center gap-2 text-foreground/85">
        <SparklesIcon className="size-3.5 shrink-0 text-primary/75" />
        <span>{t("reader.quietUpdateNotice", { version })}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {onViewDiff && (
          <Button onClick={onViewDiff} size="xs" variant="ghost">
            <GitCompareIcon />
            {t("reader.quietToggleChanges")}
          </Button>
        )}
        {onMarkAgentUpdateRead && (
          <Button onClick={onMarkAgentUpdateRead} size="xs" variant="ghost">
            <CheckIcon />
            {t("reader.markRead")}
          </Button>
        )}
      </div>
    </div>
  );
}

export interface ReaderHeaderProps {
  readonly document: DocumentRecord;
  readonly readingStats: { readonly wordCount: number; readonly minutes: number };
  readonly hideTitleHeader: boolean;
  readonly prefs: ReaderTypographyPrefs;
  readonly activeFontFamily: ReaderFontFamilyPref;
  readonly activeMeasure: ReaderMeasurePref;
  readonly paperMode: ReaderPaperModePref;
  readonly onUpdatePrefs: (patch: Partial<ReaderTypographyPrefs>) => void;
  readonly onEdit?: (() => void) | undefined;
}

export function ReaderHeader({
  document: doc,
  readingStats,
  hideTitleHeader,
  prefs,
  activeFontFamily,
  activeMeasure,
  paperMode,
  onUpdatePrefs,
  onEdit,
}: ReaderHeaderProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  const kindLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutline"),
    article: t("common.kindArticle"),
    clip: t("common.kindClip"),
  };

  const sourceMeta = useMemo<Record<string, unknown>>(
    () => doc.sourceMeta ?? {},
    [doc.sourceMeta],
  );
  const snapshotAttachmentId =
    typeof sourceMeta["snapshotAttachmentId"] === "string"
      ? sourceMeta["snapshotAttachmentId"]
      : typeof sourceMeta["htmlSnapshotAttachmentId"] === "string"
        ? sourceMeta["htmlSnapshotAttachmentId"]
        : null;
  const clipFaviconUrl =
    typeof sourceMeta["faviconUrl"] === "string" && sourceMeta["faviconUrl"]
      ? sourceMeta["faviconUrl"]
      : typeof sourceMeta["favicon"] === "string" && sourceMeta["favicon"]
        ? sourceMeta["favicon"]
        : null;

  const clipDomain = useMemo(() => {
    if (typeof sourceMeta["domain"] === "string" && sourceMeta["domain"]) {
      return sourceMeta["domain"];
    }
    if (!doc.sourceUrl) return null;
    try {
      return new URL(doc.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }, [doc.sourceUrl, sourceMeta]);

  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-3",
        hideTitleHeader ? "mb-3" : "mb-6 border-b pb-4",
      )}
    >
      {(!hideTitleHeader || doc.kind === "clip" || Boolean(doc.sourceUrl) || Boolean(snapshotAttachmentId)) && (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {!hideTitleHeader && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge size="sm" variant="secondary">
                  <DocumentKindIcon kind={doc.kind} size="xs" />
                  {kindLabels[doc.kind]}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {t("common.version", { version: doc.version })}
                </span>
                <Badge size="sm" variant="outline">
                  <ClockIcon className="size-3" />
                  <span>{t("reader.readingTime", { minutes: readingStats.minutes })}</span>
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {t("reader.wordCount", { count: readingStats.wordCount })}
                </span>
                {doc.tags.map((tag) => (
                  <TagPill key={tag} size="sm" tag={tag} />
                ))}
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {doc.title}
              </h1>
            </>
          )}

          {(doc.kind === "clip" || doc.sourceUrl || snapshotAttachmentId) && (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-xs">
              <ClipFavicon className="size-4" domain={clipDomain} faviconUrl={clipFaviconUrl} />
              <span className="font-medium text-foreground">
                {clipDomain ?? t("reader.clipSourceLabel")}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {t("reader.clipCapturedAt", { time: doc.createdAt.slice(0, 10) })}
              </span>
              {doc.sourceUrl && (
                <a
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  href={doc.sourceUrl}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  <span>{t("reader.openOriginalUrl")}</span>
                  <ExternalLinkIcon className="size-3" />
                </a>
              )}
              {snapshotAttachmentId && (
                <a
                  className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 font-medium text-foreground hover:bg-accent"
                  href={`/api/v1/attachments/${encodeURIComponent(snapshotAttachmentId)}/download`}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  <BookOpenIcon className="size-3" />
                  <span>{t("reader.openOfflineSnapshot")}</span>
                </a>
              )}
            </div>
          )}
        </div>
      )}

      <div className={cn("flex items-center gap-1.5", hideTitleHeader && "ml-auto")}>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                aria-label={t("reader.readingPrefsAria")}
                size="xs"
                variant="ghost"
              />
            }
          >
            <SlidersHorizontalIcon />
            <span className="hidden sm:inline">{t("reader.readingPrefs")}</span>
          </PopoverTrigger>
          <PopoverPopup align="end" className="w-72" viewportClassName="gap-3.5 p-3.5">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {t("reader.fontSizeLabel")}
              </span>
              <SegmentedControl className="w-full" size="sm">
                {(["sm", "base", "lg"] as const).map((sz) => (
                  <SegmentedControlItem
                    className="flex-1"
                    data-pressed={prefs.fontSize === sz ? "" : undefined}
                    key={sz}
                    onClick={() => onUpdatePrefs({ fontSize: sz })}
                  >
                    {sz === "sm"
                      ? t("reader.fontSizeSm")
                      : sz === "base"
                        ? t("reader.fontSizeBase")
                        : t("reader.fontSizeLg")}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {t("reader.measureLabel")}
              </span>
              <SegmentedControl className="w-full" size="sm">
                {(["65ch", "72ch", "88ch", "full"] as const).map((m) => (
                  <SegmentedControlItem
                    className="flex-1 whitespace-nowrap"
                    data-pressed={activeMeasure === m ? "" : undefined}
                    key={m}
                    onClick={() => onUpdatePrefs({ measure: m })}
                  >
                    {m === "65ch"
                      ? t("reader.measureNarrow")
                      : m === "72ch"
                        ? t("reader.measureMedium")
                        : m === "88ch"
                          ? t("reader.measureWide")
                          : t("reader.measureFull")}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {t("reader.fontFamilyLabel")}
              </span>
              <SegmentedControl className="w-full" size="sm">
                <SegmentedControlItem
                  className="flex-1"
                  data-pressed={activeFontFamily === "sans" ? "" : undefined}
                  onClick={() => onUpdatePrefs({ fontFamily: "sans" })}
                >
                  {t("reader.fontSans")}
                </SegmentedControlItem>
                <SegmentedControlItem
                  className="flex-1"
                  data-pressed={activeFontFamily === "serif" ? "" : undefined}
                  onClick={() => onUpdatePrefs({ fontFamily: "serif" })}
                >
                  {t("reader.fontSerif")}
                </SegmentedControlItem>
                <SegmentedControlItem
                  className="flex-1"
                  data-pressed={activeFontFamily === "mono" ? "" : undefined}
                  onClick={() => onUpdatePrefs({ fontFamily: "mono" })}
                >
                  {t("reader.fontMono")}
                </SegmentedControlItem>
              </SegmentedControl>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {t("reader.paperThemeLabel")}
              </span>
              <SegmentedControl className="w-full" size="sm">
                <SegmentedControlItem
                  className="flex-1"
                  data-pressed={paperMode === "default" ? "" : undefined}
                  onClick={() => onUpdatePrefs({ paper: "default" })}
                >
                  {t("reader.paperCrisp")}
                </SegmentedControlItem>
                <SegmentedControlItem
                  className="flex-1"
                  data-pressed={paperMode === "sepia" ? "" : undefined}
                  onClick={() => onUpdatePrefs({ paper: "sepia" })}
                >
                  {t("reader.paperSepia")}
                </SegmentedControlItem>
              </SegmentedControl>
            </div>
          </PopoverPopup>
        </Popover>

        {onEdit && (
          <Button onClick={onEdit} size="sm" variant="outline">
            <PencilIcon />
            {t("common.edit")}
          </Button>
        )}
      </div>
    </header>
  );
}
