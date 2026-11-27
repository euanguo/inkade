"use client";

import {
  splitMarkdownIntoSlides,
  type AdeThreadBinding,
  type ArtifactSandboxTicket,
  type DocumentArtifactId,
  type DocumentId,
  type ReaderTypographyPrefs,
  type SendHighlightToAgentResult,
  type Space,
  type SubmitArtifactCommentInput,
  type ViewQueryRequestInput,
  type ViewQueryResponse,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Maximize2Icon,
  Minimize2Icon,
  NotebookTextIcon,
  PresentationIcon,
  XIcon,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_TYPOGRAPHY_PREFS } from "../editor/TypographyPopover.tsx";
import { useResolvedTheme } from "../lib/use-resolved-theme.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import { Dialog, DialogPopup, DialogTitle } from "../primitives/dialog.tsx";
import { Kbd } from "../primitives/kbd.tsx";
import { MemoizedMarkdownProse } from "./article-reader/MarkdownComponents.tsx";
import type { ReaderWorkspaceDoc } from "./article-reader/reader-dom-helpers.ts";

const EMPTY_WORKSPACE_DOCS: readonly ReaderWorkspaceDoc[] = [];
const EMPTY_SPACES: readonly Pick<Space, "id" | "name" | "color" | "icon">[] = [];
const EMPTY_BINDINGS: readonly AdeThreadBinding[] = [];

export interface PresentationModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly markdown: string;
  readonly typographyPrefs?: ReaderTypographyPrefs | undefined;
  readonly theme?: "light" | "dark" | undefined;
  readonly workspaceDocs?: readonly ReaderWorkspaceDoc[] | undefined;
  readonly spaces?: readonly Pick<Space, "id" | "name" | "color" | "icon">[] | undefined;
  readonly bindings?: readonly AdeThreadBinding[] | undefined;
  readonly embeddedViewSnapshots?: Readonly<Record<string, ViewQueryResponse>> | undefined;
  readonly onQueryInkadeView?: ((spec: ViewQueryRequestInput) => Promise<ViewQueryResponse>) | undefined;
  readonly onIssueArtifactTicket?: ((artifactId: DocumentArtifactId) => Promise<ArtifactSandboxTicket>) | undefined;
  readonly onSubmitArtifactComment?: ((artifactId: DocumentArtifactId, input: SubmitArtifactCommentInput) => Promise<SendHighlightToAgentResult>) | undefined;
  readonly onOpenSecuritySettings?: (() => void) | undefined;
  readonly onOpenDocument?: ((docId: DocumentId, publicShareToken?: string | null) => void) | undefined;
  readonly onOpenWikilink?: ((targetSlugOrTitle: string, event?: React.MouseEvent) => void) | undefined;
}

export interface PresentationStageProps
  extends Omit<PresentationModalProps, "open" | "onOpenChange"> {
  readonly active?: boolean | undefined;
  readonly isFullscreen?: boolean | undefined;
  readonly onFullscreenChange?: ((fullscreen: boolean) => void) | undefined;
  readonly onRequestClose: () => void;
  readonly renderHeadingTitle?: ((headingText: string) => React.ReactElement) | undefined;
}

function renderSpeakerNotesEmptyHint(rawHint: string): React.ReactNode {
  const token = "<!-- notes: ... -->";
  const idx = rawHint.indexOf(token);
  if (idx === -1) return rawHint;
  return (
    <>
      {rawHint.slice(0, idx)}
      <code className="mx-0.5 inline-block whitespace-nowrap rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground/85">
        {token}
      </code>
      {rawHint.slice(idx + token.length)}
    </>
  );
}

export function PresentationStage({
  active = true,
  isFullscreen: controlledFullscreen,
  onFullscreenChange,
  onRequestClose,
  renderHeadingTitle,
  title,
  markdown,
  typographyPrefs = DEFAULT_TYPOGRAPHY_PREFS,
  theme: explicitTheme,
  workspaceDocs = EMPTY_WORKSPACE_DOCS,
  spaces = EMPTY_SPACES,
  bindings = EMPTY_BINDINGS,
  embeddedViewSnapshots,
  onQueryInkadeView,
  onIssueArtifactTicket,
  onSubmitArtifactComment,
  onOpenSecuritySettings,
  onOpenDocument,
  onOpenWikilink,
}: PresentationStageProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const theme = useResolvedTheme(explicitTheme);
  const stageRootRef = useRef<HTMLDivElement>(null);

  const { slides } = useMemo(
    () => splitMarkdownIntoSlides(markdown, title),
    [markdown, title],
  );

  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [uncontrolledFullscreen, setUncontrolledFullscreen] = useState(false);

  const isFullscreen = controlledFullscreen ?? uncontrolledFullscreen;
  const setFullscreenState = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setUncontrolledFullscreen((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        onFullscreenChange?.(resolved);
        return resolved;
      });
    },
    [onFullscreenChange],
  );

  const totalSlides = slides.length;
  const safeIndex = totalSlides > 0 ? Math.min(currentSlideIndex, totalSlides - 1) : 0;
  const activeSlide = slides[safeIndex] ?? null;

  useEffect(() => {
    if (active) {
      setCurrentSlideIndex(0);
      if (typeof globalThis.requestAnimationFrame === "function") {
        const rafId = globalThis.requestAnimationFrame(() => {
          stageRootRef.current?.focus({ preventScroll: true });
        });
        return () => {
          if (typeof globalThis.cancelAnimationFrame === "function") {
            globalThis.cancelAnimationFrame(rafId);
          }
        };
      }
      stageRootRef.current?.focus({ preventScroll: true });
    } else {
      setFullscreenState(false);
    }
    return undefined;
  }, [active, setFullscreenState]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleFsChange = (): void => {
      setFullscreenState(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, [setFullscreenState]);

  const goPrev = useCallback(() => {
    setCurrentSlideIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const goNext = useCallback(() => {
    setCurrentSlideIndex((prev) => Math.min(Math.max(0, totalSlides - 1), prev + 1));
  }, [totalSlides]);

  const toggleFullscreen = useCallback(async () => {
    const el = stageRootRef.current;
    if (typeof document !== "undefined" && document.fullscreenElement) {
      try {
        await document.exitFullscreen();
        setFullscreenState(false);
        return;
      } catch {
        // fallback toggle
      }
    }
    if (el && typeof el.requestFullscreen === "function") {
      try {
        await el.requestFullscreen();
        setFullscreenState(true);
        return;
      } catch {
        // fallback toggle when Fullscreen API is unavailable or rejected
      }
    }
    setFullscreenState((prev) => !prev);
  }, [setFullscreenState]);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const rawTarget = event.target;
      const target =
        rawTarget &&
        typeof rawTarget === "object" &&
        "nodeType" in rawTarget &&
        typeof (rawTarget as { readonly nodeType?: unknown }).nodeType === "number"
          ? (rawTarget as HTMLElement)
          : null;
      const isTargetInsideStage = Boolean(target && stageRootRef.current?.contains(target));
      if (
        isTargetInsideStage &&
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goPrev();
        return;
      }
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (event.shiftKey) goPrev();
        else goNext();
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setCurrentSlideIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setCurrentSlideIndex(Math.max(0, totalSlides - 1));
        return;
      }
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        setNotesOpen((prev) => !prev);
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (typeof document !== "undefined" && document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
          setFullscreenState(false);
        }
        onRequestClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [active, goNext, goPrev, onRequestClose, setFullscreenState, toggleFullscreen, totalSlides]);

  const docsByKey = useMemo(() => {
    const map = new Map<string, ReaderWorkspaceDoc>();
    for (const item of workspaceDocs) {
      map.set(item.id.toLowerCase(), item);
      map.set(item.slug.toLowerCase(), item);
      map.set(item.title.toLowerCase(), item);
    }
    return map;
  }, [workspaceDocs]);

  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const paperMode = typographyPrefs.paper;
  const progressPercent = totalSlides > 0 ? Math.round(((safeIndex + 1) / totalSlides) * 100) : 0;
  const headingLabel = t("presentation.dialogTitle", { title });

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col bg-[var(--studio-ground,var(--muted))] text-foreground outline-none"
      data-fullscreen={isFullscreen ? "true" : "false"}
      data-paper={paperMode === "sepia" ? "sepia" : undefined}
      data-testid="presentation-stage-root"
      ref={stageRootRef}
      tabIndex={-1}
    >
      {/* Top HUD */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/85 px-4 py-2.5 backdrop-blur-sm sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <PresentationIcon className="size-4 shrink-0 text-primary" />
          {renderHeadingTitle ? (
            renderHeadingTitle(headingLabel)
          ) : (
            <h2 className="truncate font-sans text-sm font-semibold">{headingLabel}</h2>
          )}
          {totalSlides > 0 && (
            <Badge className="shrink-0 tabular-nums" size="sm" variant="secondary">
              {t("presentation.slideCounter", {
                current: safeIndex + 1,
                total: totalSlides,
              })}
            </Badge>
          )}
          {activeSlide?.title && (
            <span className="hidden truncate text-xs text-muted-foreground md:inline">
              {activeSlide.title}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            aria-label={t("presentation.toggleNotesAria")}
            aria-pressed={notesOpen}
            data-testid="presentation-toggle-notes"
            onClick={() => setNotesOpen((prev) => !prev)}
            size="xs"
            title={t("presentation.toggleNotesAria")}
            type="button"
            variant={notesOpen ? "secondary" : "ghost"}
          >
            <NotebookTextIcon className="size-3.5" />
            <span className="hidden sm:inline">{t("presentation.toggleNotes")}</span>
            {activeSlide?.speakerNotes && (
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            )}
          </Button>

          <Button
            aria-label={t("presentation.fullscreenAria")}
            aria-pressed={isFullscreen}
            data-testid="presentation-toggle-fullscreen"
            onClick={() => void toggleFullscreen()}
            size="xs"
            title={t("presentation.fullscreenAria")}
            type="button"
            variant={isFullscreen ? "secondary" : "ghost"}
          >
            {isFullscreen ? (
              <Minimize2Icon className="size-3.5" />
            ) : (
              <Maximize2Icon className="size-3.5" />
            )}
            <span className="hidden sm:inline">
              {isFullscreen
                ? t("presentation.exitFullscreen")
                : t("presentation.enterFullscreen")}
            </span>
          </Button>

          <Button
            aria-label={t("presentation.closeAria")}
            data-testid="presentation-close"
            onClick={onRequestClose}
            size="xs"
            title={t("presentation.closeAria")}
            type="button"
            variant="ghost"
          >
            <XIcon className="size-3.5" />
            <span className="hidden sm:inline">{t("presentation.closeBtn")}</span>
          </Button>
        </div>
      </header>

      {/* Main Stage + Optional Speaker Notes Drawer */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-8">
          {activeSlide ? (
            <section
              aria-label={activeSlide.title}
              className={cn(
                "relative flex aspect-video max-h-full w-full max-w-[min(100%,calc((100vh-11.5rem)*16/9))] flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-[var(--elevation-raised)] transition-colors duration-[var(--duration-fast)]",
                paperMode === "sepia" && "inkade-paper-sepia",
              )}
              data-paper={paperMode === "sepia" ? "sepia" : undefined}
              data-slide-index={safeIndex}
              data-testid="presentation-slide-stage"
            >
              <div className="flex min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-7">
                <div
                  className="inkade-prose my-auto w-full min-w-0"
                  data-font={typographyPrefs.fontFamily}
                  data-measure="full"
                  data-paper={paperMode === "sepia" ? "sepia" : undefined}
                  data-size={typographyPrefs.fontSize}
                >
                  <MemoizedMarkdownProse
                    bindings={bindings}
                    docsByKey={docsByKey}
                    embeddedViewSnapshots={embeddedViewSnapshots}
                    onIssueArtifactTicket={onIssueArtifactTicket}
                    onOpenDocument={onOpenDocument}
                    onOpenSecuritySettings={onOpenSecuritySettings}
                    onOpenWikilink={onOpenWikilink}
                    onQueryInkadeView={onQueryInkadeView}
                    onSubmitArtifactComment={onSubmitArtifactComment}
                    paperMode={paperMode}
                    renderedMarkdown={activeSlide.markdown}
                    spaceById={spaceById}
                    spaces={spaces}
                    theme={theme}
                    workspaceDocs={workspaceDocs}
                  />
                </div>
              </div>
            </section>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card px-6 py-8 text-sm text-muted-foreground">
              {t("presentation.emptyDocument")}
            </div>
          )}
        </div>

        {notesOpen && (
          <aside
            aria-label={t("presentation.speakerNotesHeading")}
            className="flex h-48 shrink-0 flex-col border-t border-border bg-card/95 sm:h-auto sm:w-80 sm:border-t-0 sm:border-l lg:w-96"
            data-testid="presentation-notes-drawer"
          >
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
              <span className="text-xs font-semibold text-foreground">
                {t("presentation.speakerNotesHeading")}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {t("presentation.slideCounter", {
                  current: safeIndex + 1,
                  total: Math.max(1, totalSlides),
                })}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed text-foreground/90">
              {activeSlide?.speakerNotes ? (
                <p className="whitespace-pre-wrap">{activeSlide.speakerNotes}</p>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {renderSpeakerNotesEmptyHint(t("presentation.noSpeakerNotes"))}
                </p>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Controls + Progress Bar + Slide Jump */}
      <footer className="flex shrink-0 flex-col gap-2 border-t border-border bg-card/90 px-4 py-2.5 sm:px-6">
        <div
          aria-label={t("presentation.slideCounter", {
            current: safeIndex + 1,
            total: Math.max(1, totalSlides),
          })}
          aria-valuemax={Math.max(1, totalSlides)}
          aria-valuemin={1}
          aria-valuenow={safeIndex + 1}
          className="flex h-2 w-full items-center gap-1"
          data-testid="presentation-progress"
          role="progressbar"
        >
          {totalSlides <= 24 && totalSlides > 0 ? (
            slides.map((slide, idx) => (
              <button
                aria-label={t("presentation.slideLabel", { index: idx + 1 })}
                className={cn(
                  "h-1.5 flex-1 cursor-pointer rounded-full transition-colors duration-[var(--duration-quick)]",
                  idx <= safeIndex
                    ? "bg-primary"
                    : "bg-muted-foreground/20 hover:bg-muted-foreground/40",
                )}
                key={slide.index}
                onClick={() => setCurrentSlideIndex(idx)}
                title={slide.title}
                type="button"
              />
            ))
          ) : (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Button
              aria-label={t("presentation.prevSlide")}
              data-testid="presentation-prev"
              disabled={safeIndex <= 0}
              onClick={goPrev}
              size="xs"
              type="button"
              variant="outline"
            >
              <ChevronLeftIcon className="size-3.5" />
              <span className="hidden sm:inline">{t("presentation.prevSlide")}</span>
            </Button>

            {totalSlides > 0 && (
              <select
                aria-label={t("presentation.jumpToSlide")}
                className="h-7 max-w-64 cursor-pointer truncate rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-80"
                data-testid="presentation-slide-select"
                onChange={(e) => {
                  const nextIdx = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(nextIdx) && nextIdx >= 0 && nextIdx < totalSlides) {
                    setCurrentSlideIndex(nextIdx);
                  }
                }}
                value={safeIndex}
              >
                {slides.map((slide, idx) => {
                  const trimmedTitle = slide.title.trim();
                  const slideNum = idx + 1;
                  const label = new RegExp(`^${slideNum}[.、)]\\s*`).test(trimmedTitle)
                    ? trimmedTitle
                    : /^\d+[.、)]\s*/.test(trimmedTitle)
                      ? `${slideNum} · ${trimmedTitle}`
                      : `${slideNum}. ${trimmedTitle}`;
                  return (
                    <option key={slide.index} value={idx}>
                      {label}
                    </option>
                  );
                })}
              </select>
            )}

            <Button
              aria-label={t("presentation.nextSlide")}
              data-testid="presentation-next"
              disabled={safeIndex >= totalSlides - 1}
              onClick={goNext}
              size="xs"
              type="button"
              variant="outline"
            >
              <span className="hidden sm:inline">{t("presentation.nextSlide")}</span>
              <ChevronRightIcon className="size-3.5" />
            </Button>
          </div>

          <div className="hidden items-center gap-3 text-[11px] text-muted-foreground lg:flex">
            <span className="inline-flex items-center gap-1">
              <Kbd>←</Kbd>
              <Kbd>→</Kbd>
              <Kbd>{t("presentation.keySpace")}</Kbd>
              <span>{t("presentation.shortcutsHintPrevNext")}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>N</Kbd>
              <span>{t("presentation.shortcutsHintNotes")}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>F</Kbd>
              <span>{t("presentation.shortcutsHintFullscreen")}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Esc</Kbd>
              <span>{t("presentation.shortcutsHintExit")}</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function PresentationModal({
  open,
  onOpenChange,
  ...stageProps
}: PresentationModalProps): React.ReactElement {
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup
        bottomStickOnMobile={false}
        className={cn(
          "flex flex-col overflow-hidden bg-[var(--studio-ground,var(--muted))] p-0 text-foreground transition-[width,height,border-radius] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]",
          isFullscreen
            ? "row-span-3 h-screen max-h-screen w-screen max-w-none rounded-none border-0"
            : "row-span-3 h-[92vh] max-h-[92vh] w-[96vw] max-w-none rounded-2xl",
        )}
        data-fullscreen={isFullscreen ? "true" : "false"}
        data-testid="presentation-modal"
        showCloseButton={false}
      >
        <PresentationStage
          {...stageProps}
          active={open}
          isFullscreen={isFullscreen}
          onFullscreenChange={setIsFullscreen}
          onRequestClose={() => onOpenChange(false)}
          renderHeadingTitle={(headingLabel) => (
            <DialogTitle className="truncate font-sans text-sm font-semibold">
              {headingLabel}
            </DialogTitle>
          )}
        />
      </DialogPopup>
    </Dialog>
  );
}
