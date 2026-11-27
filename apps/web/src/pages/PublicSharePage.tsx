import {
  asSpaceId,
  asWorkspaceId,
  type DocumentRecord,
  extractToc,
  type OutlineNode,
  stripLeadingDuplicateTitle,
  TYPESET_PRESETS,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueries, useInkadeClient } from "@inkade/sdk/react";
import {
  syncAppearanceToDocument,
  useMotionProfile,
  usePaperMode,
  useReaderTypography,
  useThemePreference,
  useTypesetPreset,
} from "@inkade/views/lib/preferences-store";
import {
  ArticleReader,
  Badge,
  Button,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverTrigger,
  ProseMirrorOutlineEditor,
  Skeleton,
} from "@inkade/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Link2OffIcon,
  ListTreeIcon,
  MoonIcon,
  ScrollTextIcon,
  SunIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useEventListener } from "usehooks-ts";
import "@inkade/ui/katex.css";

export function PublicSharePage({ token }: { readonly token: string }): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const navigate = useNavigate();
  const { effectiveTheme, toggleLightDark } = useThemePreference();
  const { paperMode, togglePaperMode } = usePaperMode();
  const { typesetPreset, setTypesetPreset } = useTypesetPreset();
  const { typography, setTypography } = useReaderTypography();
  useMotionProfile();

  useEffect(() => {
    syncAppearanceToDocument();
  }, []);

  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const shareQuery = useQuery({
    ...inkadeQueries.publicShare(client, token),
    retry: false,
  });

  const shared = shareQuery.data;

  const toc = useMemo(() => {
    if (!shared || shared.document.kind === "outline") return [];
    return extractToc(
      stripLeadingDuplicateTitle(shared.document.contentMarkdown, shared.document.title),
    );
  }, [shared]);

  const updateScrollProgress = useCallback((): void => {
    if (typeof window === "undefined") return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) {
      setScrollProgress(0);
      return;
    }
    const next = Math.min(100, Math.max(0, (window.scrollY / max) * 100));
    setScrollProgress(next);
  }, []);

  useEffect(() => {
    updateScrollProgress();
  }, [shared?.document.id, shared?.document.contentMarkdown, updateScrollProgress]);

  useEventListener("scroll", updateScrollProgress, undefined, { passive: true });
  useEventListener("resize", updateScrollProgress, undefined, { passive: true });

  useEffect(() => {
    if (typeof document === "undefined" || typeof IntersectionObserver === "undefined" || toc.length === 0) {
      return;
    }
    const headings = toc
      .map((entry) => document.getElementById(entry.slug))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const item of entries) {
          if (item.isIntersecting && item.target.id) {
            setActiveSlug(item.target.id);
            break;
          }
        }
      },
      { rootMargin: "-72px 0px -70% 0px", threshold: 0.1 },
    );

    for (const heading of headings) {
      observer.observe(heading);
    }
    return () => observer.disconnect();
  }, [toc]);

  const cycleTypeset = (): void => {
    const idx = TYPESET_PRESETS.indexOf(typesetPreset);
    const next = TYPESET_PRESETS[(idx + 1) % TYPESET_PRESETS.length] ?? "standard";
    setTypesetPreset(next);
  };

  const typesetLabel =
    typesetPreset === "compact"
      ? t("settings.typesetCompact")
      : typesetPreset === "relaxed"
        ? t("settings.typesetRelaxed")
        : t("settings.typesetStandard");

  const jumpToHeading = (slug: string): void => {
    setActiveSlug(slug);
    document.getElementById(slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (shareQuery.isPending) {
    return (
      <div aria-busy="true" className="min-h-svh bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 lg:px-8">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="hidden h-3.5 w-28 sm:block" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-6 w-14 rounded-md" />
              <Skeleton className="h-6 w-16 rounded-md" />
              <Skeleton className="size-6 rounded-md" />
            </div>
          </div>
          <div className="h-[2px] w-full bg-border/35" />
        </header>

        <main className="mx-auto flex max-w-5xl items-start gap-8 px-4 py-8 lg:px-8">
          <div className="min-w-0 flex-1">
            <div className="flex max-w-[72ch] flex-col gap-4">
              <Skeleton className="h-9 w-2/3 max-w-md rounded-md" />
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <div className="flex flex-col gap-2.5 pt-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
              </div>
              <div className="mt-2 flex flex-col gap-2">
                <Skeleton className="h-6 w-48 rounded-md" />
                <div className="h-px w-full bg-border/60" />
              </div>
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </div>

          <aside className="hidden w-52 shrink-0 flex-col gap-2 pt-2 xl:flex">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-3 h-4 w-32" />
            <Skeleton className="ml-3 h-4 w-36" />
            <Skeleton className="h-4 w-28" />
          </aside>
        </main>
      </div>
    );
  }

  if (shareQuery.isError || !shared) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <Empty className="max-w-md rounded-lg border bg-card py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Link2OffIcon />
            </EmptyMedia>
            <EmptyTitle>{t("document.shareExpiredTitle")}</EmptyTitle>
            <EmptyDescription>{t("document.shareExpiredDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const docRecord: DocumentRecord = {
    id: shared.document.id,
    workspaceId: asWorkspaceId("public"),
    spaceId: asSpaceId("public"),
    kind: shared.document.kind,
    title: shared.document.title,
    slug: shared.document.slug,
    dailyDate: shared.document.dailyDate,
    contentMarkdown: shared.document.contentMarkdown,
    contentJson: null,
    contentText: shared.document.excerpt,
    excerpt: shared.document.excerpt,
    tags: shared.document.tags,
    sourceUrl: shared.document.sourceUrl,
    version: 1,
    pinned: false,
    unreadAgentUpdate: false,
    lastEditedByType: "human",
    trashedAt: null,
    createdAt: shared.document.createdAt,
    updatedAt: shared.document.updatedAt,
  };

  const outlineNodes: readonly OutlineNode[] = (shared.nodes ?? []).map((n) => ({
    ...n,
    documentId: shared.document.id,
    authorType: "human",
    authorId: null,
    sourceBindingId: null,
    deletedAt: null,
  }));

  const progressRounded = Math.round(scrollProgress);

  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* Standalone Public Share Header + Hairline Reading Progress */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 lg:px-8">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight">{t("common.appName")}</span>
            <Badge size="sm" variant="info">
              {t("document.shareSharedBadge")}
            </Badge>
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
              {shared.shareLink.expiresAt
                ? t("document.shareExpiresAt", {
                    time: shared.shareLink.expiresAt.slice(0, 16).replace("T", " "),
                  })
                : t("document.shareNeverExpires")}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="hidden font-mono text-[11px] text-muted-foreground tabular-nums md:inline"
              data-slot="public-share-progress-readout"
            >
              {t("publicShare.readingProgressLabel", { percent: progressRounded })}
            </span>

            {toc.length > 0 ? (
              <Popover>
                <PopoverTrigger
                  render={
                    <Button data-slot="public-share-toc-trigger" size="xs" variant="outline">
                      <ListTreeIcon />
                      <span>{t("publicShare.tocButton", { count: toc.length })}</span>
                    </Button>
                  }
                />
                <PopoverPopup align="end" className="w-72" viewportClassName="p-2.5">
                  <div className="flex flex-col gap-1">
                    <div className="border-b border-border px-1.5 pb-1.5 text-xs font-semibold text-foreground">
                      {t("publicShare.tocMenuTitle")}
                    </div>
                    <nav
                      aria-label={t("reader.tocAriaLabel")}
                      className="flex max-h-72 flex-col gap-0.5 overflow-y-auto [scrollbar-gutter:stable]"
                    >
                      {toc.map((entry) => {
                        const isActive = activeSlug === entry.slug;
                        return (
                          <PopoverClose
                            key={`${entry.slug}-${entry.startOffset}`}
                            render={
                              <a
                                className={cn(
                                  "block truncate rounded-md py-1.5 pr-2 text-xs transition-colors duration-[var(--duration-quick)]",
                                  isActive
                                    ? "bg-muted/70 font-medium text-primary"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                )}
                                href={`#${entry.slug}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  jumpToHeading(entry.slug);
                                }}
                                style={{ paddingLeft: `${8 + Math.max(0, entry.depth - 1) * 12}px` }}
                              >
                                {entry.text}
                              </a>
                            }
                          />
                        );
                      })}
                    </nav>
                  </div>
                </PopoverPopup>
              </Popover>
            ) : null}

            <Button
              aria-label={t("publicShare.typesetLabel")}
              onClick={cycleTypeset}
              size="xs"
              variant="ghost"
            >
              <span>{typesetLabel}</span>
            </Button>

            <Button
              onClick={togglePaperMode}
              size="xs"
              variant={paperMode === "sepia" ? "secondary" : "ghost"}
            >
              <ScrollTextIcon />
              <span>{t("common.paperSepia")}</span>
            </Button>

            <Button
              aria-label={
                effectiveTheme === "dark" ? t("nav.switchToLight") : t("nav.switchToDark")
              }
              onClick={toggleLightDark}
              size="icon-xs"
              variant="ghost"
            >
              {effectiveTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            </Button>
          </div>
        </div>

        <div
          aria-label={t("publicShare.readingProgressAria", { percent: progressRounded })}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progressRounded}
          className="h-[2px] w-full overflow-hidden bg-border/35"
          data-slot="public-share-progress"
          role="progressbar"
        >
          <div
            className="h-full bg-primary transition-[width] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]"
            style={{ width: `${scrollProgress}%` }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 lg:px-8">
        {shared.document.kind === "outline" && outlineNodes.length > 0 ? (
          <div className="flex flex-col gap-4">
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              {shared.document.title}
            </h1>
            <ProseMirrorOutlineEditor
              documentId={shared.document.id}
              nodes={outlineNodes}
              readOnly
              rootTitle={shared.document.title}
            />
          </div>
        ) : (
          <ArticleReader
            document={docRecord}
            embeddedViewSnapshots={shared.embeddedViews}
            enableKeyboardNav={false}
            onChangeTypographyPrefs={setTypography}
            onOpenDocument={(_docId, shareToken) => {
              if (shareToken) {
                void navigate({ to: "/share/$token", params: { token: shareToken } });
              }
            }}
            showToc
            theme={effectiveTheme}
            toc={toc}
            typographyPrefs={typography}
          />
        )}
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        {t("publicShare.readOnlyNote")} · {t("document.sharePoweredBy")} ·{" "}
        {t("document.shareCreatedAt", { time: shared.shareLink.createdAt.slice(0, 10) })}
      </footer>
    </div>
  );
}
