"use client";

import {
  type DocumentId,
  type SerendipityDocCandidate,
  type SerendipityPick,
  trimReadableExcerpt,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { PinIcon, QuoteIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import type React from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import { Skeleton } from "../primitives/skeleton.tsx";
import { DocumentKindIcon, TagPill } from "../primitives/tag-pill.tsx";

export interface DailyReviewCardProps<
  TDoc extends SerendipityDocCandidate = SerendipityDocCandidate,
> {
  readonly items: readonly SerendipityPick<TDoc>[];
  readonly onOpenDoc: (docId: DocumentId) => void;
  readonly onQuoteToToday?: ((doc: TDoc) => void) | undefined;
  readonly onShuffle?: (() => void) | undefined;
  readonly loading?: boolean | undefined;
  readonly quotingDocId?: DocumentId | null | undefined;
  readonly className?: string | undefined;
}

export function DailyReviewCard<TDoc extends SerendipityDocCandidate>({
  items,
  onOpenDoc,
  onQuoteToToday,
  onShuffle,
  loading = false,
  quotingDocId = null,
  className,
}: DailyReviewCardProps<TDoc>): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <section
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3.5",
        className,
      )}
      data-testid="daily-serendipity-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <SparklesIcon className="size-3.5 text-primary" />
          <span>{t("daily.serendipityTitle")}</span>
        </h2>
        {onShuffle && (
          <Button
            aria-label={t("daily.serendipityShuffle")}
            onClick={onShuffle}
            size="icon-xs"
            title={t("daily.serendipityShuffle")}
            type="button"
            variant="ghost"
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        )}
      </div>

      {loading ? (
        <div aria-busy="true" className="flex flex-col divide-y divide-border/60">
          {[0, 1].map((idx) => (
            <div className="flex flex-col gap-1.5 py-2.5 first:pt-0.5 last:pb-0" key={idx}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                  <Skeleton className="h-3.5 w-40" />
                </div>
                <Skeleton className="h-4 w-12 shrink-0 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground/80">
          {t("daily.serendipityEmpty")}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border/60">
          {items.map(({ doc, ageDays, reason }) => {
            const snippet = trimReadableExcerpt(
              doc.excerpt.trim() || doc.contentText?.trim() || "",
              140,
            );
            return (
              <article
                className="flex flex-col gap-1.5 py-2.5 first:pt-0.5 last:pb-0"
                key={doc.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-xs font-medium text-foreground transition-colors hover:text-primary"
                    onClick={() => onOpenDoc(doc.id)}
                    type="button"
                  >
                    <DocumentKindIcon kind={doc.kind} size="xs" />
                    <span className="truncate">{doc.title}</span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {reason === "pinned" && (
                      <PinIcon className="size-3 text-amber-500 dark:text-amber-400" />
                    )}
                    <Badge size="sm" variant="outline">
                      {ageDays >= 1
                        ? t("daily.serendipityAgeDays", { count: ageDays })
                        : t("daily.serendipityRecent")}
                    </Badge>
                  </div>
                </div>

                {snippet && (
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {snippet}
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {doc.tags.slice(0, 2).map((tag) => (
                      <TagPill key={tag} size="sm" tag={tag} />
                    ))}
                  </div>
                  {onQuoteToToday && (
                    <Button
                      disabled={quotingDocId === doc.id}
                      onClick={() => onQuoteToToday(doc)}
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      <QuoteIcon className="size-3" />
                      <span>{t("daily.serendipityQuoteToToday")}</span>
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
