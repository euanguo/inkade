"use client";

import {
  asHighlightId,
  asThreadBindingId,
  type AdeThreadBinding,
  type ArtifactSandboxTicket,
  type BridgeSessionId,
  type BridgeSessionRecord,
  type DocumentArtifactId,
  type DocumentHighlight,
  type DocumentRecord,
  extractToc,
  type HighlightColor,
  type HighlightComment,
  type HighlightId,
  type ReaderFontFamilyPref,
  type ReaderFontSizePref,
  type ReaderMeasurePref,
  type ReaderTypographyPrefs,
  type SelectionAnchor,
  type SendHighlightToAgentResult,
  type Space,
  type SubmitArtifactCommentInput,
  stripLeadingDuplicateTitle,
  stripMarkdownSpeakerNotes,
  type ThreadBindingId,
  type TocEntry,
  type ViewQueryRequestInput,
  type ViewQueryResponse,
} from "@inkade/core";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_TYPOGRAPHY_PREFS } from "../editor/TypographyPopover.tsx";
import { useResolvedTheme } from "../lib/use-resolved-theme.ts";
import { cn } from "../lib/utils.ts";
import { MemoizedMarkdownProse } from "./article-reader/MarkdownComponents.tsx";
import {
  computeReadingStats,
  type ReaderWorkspaceDoc,
} from "./article-reader/reader-dom-helpers.ts";
import {
  ReaderAgentUpdateBanner,
  ReaderHeader,
} from "./article-reader/ReaderHeader.tsx";
import { ReaderSelectionToolbar } from "./article-reader/ReaderSelectionToolbar.tsx";
import { ReaderTocRail } from "./article-reader/ReaderTocRail.tsx";
import { useReaderInteractions } from "./article-reader/use-reader-interactions.ts";
import {
  MarginaliaOverlay,
  type MarginaliaDeliveryReceipt,
  type MarginaliaStatusFilter,
} from "./MarginaliaOverlay.tsx";

const EMPTY_WORKSPACE_DOCS: readonly ReaderWorkspaceDoc[] = [];
const EMPTY_SPACES: readonly Pick<Space, "id" | "name" | "color" | "icon">[] = [];
const EMPTY_HIGHLIGHTS: readonly DocumentHighlight[] = [];
const EMPTY_BINDINGS: readonly AdeThreadBinding[] = [];

export interface ArticleReaderProps {
  readonly document: DocumentRecord;
  readonly toc?: readonly TocEntry[] | undefined;
  readonly workspaceDocs?: readonly ReaderWorkspaceDoc[] | undefined;
  readonly spaces?: readonly Pick<Space, "id" | "name" | "color" | "icon">[] | undefined;
  readonly highlights?: readonly DocumentHighlight[] | undefined;
  readonly commentsByHighlightId?: Readonly<Record<string, readonly HighlightComment[]>> | undefined;
  readonly bindings?: readonly AdeThreadBinding[] | undefined;
  readonly bridgeSessions?: readonly BridgeSessionRecord[] | undefined;
  readonly activeHighlightId?: HighlightId | null | undefined;
  readonly statusFilter?: MarginaliaStatusFilter | undefined;
  readonly onStatusFilterChange?: ((next: MarginaliaStatusFilter) => void) | undefined;
  readonly sendingHighlightId?: HighlightId | null | undefined;
  readonly replyingHighlightId?: HighlightId | null | undefined;
  readonly deliveryReceipts?: Readonly<Record<string, MarginaliaDeliveryReceipt>> | undefined;
  readonly readOnly?: boolean | undefined;
  readonly showMarginaliaRail?: boolean | undefined;
  readonly enableKeyboardNav?: boolean | undefined;
  readonly onEdit?: (() => void) | undefined;
  readonly onViewDiff?: (() => void) | undefined;
  readonly onMarkAgentUpdateRead?: (() => void) | undefined;
  readonly onAskAgent?: ((anchor: SelectionAnchor) => void) | undefined;
  readonly onExcerptToDaily?: ((anchor: SelectionAnchor, markdownQuote: string) => void) | undefined;
  readonly onCopyQuoteLink?: ((anchor: SelectionAnchor) => void) | undefined;
  readonly onOpenWikilink?: ((targetSlugOrTitle: string, event?: React.MouseEvent) => void) | undefined;
  readonly onOpenDocument?: ((docId: DocumentRecord["id"], publicShareToken?: string | null) => void) | undefined;
  readonly onQueryInkadeView?: ((spec: ViewQueryRequestInput) => Promise<ViewQueryResponse>) | undefined;
  readonly embeddedViewSnapshots?: Readonly<Record<string, ViewQueryResponse>> | undefined;
  readonly onIssueArtifactTicket?: ((artifactId: DocumentArtifactId) => Promise<ArtifactSandboxTicket>) | undefined;
  readonly onSubmitArtifactComment?: ((artifactId: DocumentArtifactId, input: SubmitArtifactCommentInput) => Promise<SendHighlightToAgentResult>) | undefined;
  readonly onOpenSecuritySettings?: (() => void) | undefined;
  readonly onCreateMissingDoc?: ((title: string) => void) | undefined;
  readonly onCreateHighlight?: ((input: {
    readonly quote: string;
    readonly prefixContext: string;
    readonly suffixContext: string;
    readonly color: HighlightColor;
    readonly noteMarkdown?: string;
  }) => void) | undefined;
  readonly onUpdateHighlight?: ((
    highlightId: HighlightId,
    patch: { readonly color?: HighlightColor; readonly noteMarkdown?: string },
  ) => void) | undefined;
  readonly onDeleteHighlight?: ((highlightId: HighlightId) => void) | undefined;
  readonly onAddComment?: ((highlightId: HighlightId, bodyMarkdown: string) => void | Promise<unknown>) | undefined;
  readonly onSendToAgent?: ((
    highlightId: HighlightId,
    options?: {
      readonly bridgeSessionId?: BridgeSessionId | null | undefined;
      readonly bindingId?: ThreadBindingId | null | undefined;
      readonly bodyMarkdown?: string | undefined;
    },
  ) => void | Promise<unknown>) | undefined;
  readonly onResolveHighlight?: ((highlightId: HighlightId) => void) | undefined;
  readonly onReopenHighlight?: ((highlightId: HighlightId) => void) | undefined;
  readonly onSelectHighlight?: ((highlightId: HighlightId) => void) | undefined;
  readonly onSelectionQuoteChange?: ((quote: string | null) => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly showToc?: boolean | undefined;
  readonly typographyPrefs?: ReaderTypographyPrefs | undefined;
  readonly onChangeTypographyPrefs?: ((next: ReaderTypographyPrefs) => void) | undefined;
  readonly readerFont?: ReaderFontFamilyPref | undefined;
  readonly readerFontSize?: ReaderFontSizePref | undefined;
  readonly readerMeasure?: ReaderMeasurePref | undefined;
  readonly hideTitleHeader?: boolean | undefined;
  readonly suppressInnerSepiaBox?: boolean | undefined;
  readonly theme?: "light" | "dark" | undefined;
  readonly className?: string | undefined;
}

export function ArticleReader({
  document: doc,
  toc: tocProp,
  workspaceDocs = EMPTY_WORKSPACE_DOCS,
  spaces = EMPTY_SPACES,
  highlights = EMPTY_HIGHLIGHTS,
  commentsByHighlightId,
  bindings = EMPTY_BINDINGS,
  bridgeSessions,
  activeHighlightId: controlledActiveHighlightId,
  statusFilter,
  onStatusFilterChange,
  sendingHighlightId,
  replyingHighlightId,
  deliveryReceipts,
  readOnly = false,
  showMarginaliaRail = false,
  enableKeyboardNav = true,
  onEdit,
  onViewDiff,
  onMarkAgentUpdateRead,
  onAskAgent,
  onExcerptToDaily,
  onCopyQuoteLink,
  onOpenWikilink,
  onOpenDocument,
  onQueryInkadeView,
  embeddedViewSnapshots,
  onIssueArtifactTicket,
  onSubmitArtifactComment,
  onOpenSecuritySettings,
  onCreateMissingDoc,
  onCreateHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
  onAddComment,
  onSendToAgent,
  onResolveHighlight,
  onReopenHighlight,
  onSelectHighlight,
  onSelectionQuoteChange,
  onOpenBinding,
  showToc = true,
  typographyPrefs: typographyPrefsProp,
  onChangeTypographyPrefs,
  readerFont: readerFontProp,
  readerFontSize: readerFontSizeProp,
  readerMeasure: readerMeasureProp,
  hideTitleHeader = false,
  suppressInnerSepiaBox = false,
  theme: explicitTheme,
  className,
}: ArticleReaderProps): React.ReactElement {
  const theme = useResolvedTheme(explicitTheme);
  const rootRef = useRef<HTMLDivElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [uncontrolledPrefs, setUncontrolledPrefs] =
    useState<ReaderTypographyPrefs>(DEFAULT_TYPOGRAPHY_PREFS);
  const prefs = typographyPrefsProp ?? uncontrolledPrefs;
  const paperMode = prefs.paper;
  const activeFontFamily = readerFontProp ?? prefs.fontFamily;
  const activeFontSize = readerFontSizeProp ?? prefs.fontSize;
  const activeMeasure = readerMeasureProp ?? prefs.measure;

  const renderedMarkdown = useMemo(
    () => stripLeadingDuplicateTitle(stripMarkdownSpeakerNotes(doc.contentMarkdown), doc.title),
    [doc.contentMarkdown, doc.title],
  );

  const readingStats = useMemo(
    () => computeReadingStats(doc.contentMarkdown),
    [doc.contentMarkdown],
  );

  const toc = useMemo(
    () => tocProp ?? extractToc(renderedMarkdown),
    [tocProp, renderedMarkdown],
  );

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
  const bindingById = useMemo(
    () => new Map<ThreadBindingId, AdeThreadBinding>(bindings.map((b) => [b.id, b])),
    [bindings],
  );

  const updatePrefs = (patch: Partial<ReaderTypographyPrefs>): void => {
    const next: ReaderTypographyPrefs = {
      fontFamily: patch.fontFamily ?? activeFontFamily,
      measure: patch.measure ?? activeMeasure,
      fontSize: patch.fontSize ?? prefs.fontSize,
      paper: patch.paper ?? prefs.paper,
    };
    if (!typographyPrefsProp) {
      setUncontrolledPrefs(next);
    }
    onChangeTypographyPrefs?.(next);
  };

  const {
    activeSlug,
    selectionState,
    setSelectionState,
    noteComposerOpen,
    setNoteComposerOpen,
    noteInput,
    setNoteInput,
    noteColor,
    setNoteColor,
    anchorPositions,
    activeHighlightId,
    setActiveHighlightId,
    updateSelectionToolbar,
    handleCopyQuote,
    handleJumpToHighlight,
    handleSelectTocSlug,
  } = useReaderInteractions({
    docId: doc.id,
    docTitle: doc.title,
    contentMarkdown: doc.contentMarkdown,
    renderedMarkdown,
    toc,
    showToc,
    highlights,
    bindings,
    prefs,
    enableKeyboardNav,
    rootRef,
    proseRef,
    progressBarRef,
    onCreateHighlight,
    onAskAgent,
    onCopyQuoteLink,
  });

  const onSelectionQuoteChangeRef = useRef(onSelectionQuoteChange);
  onSelectionQuoteChangeRef.current = onSelectionQuoteChange;
  useEffect(() => {
    onSelectionQuoteChangeRef.current?.(selectionState?.anchor.quote ?? null);
  }, [selectionState?.anchor.quote]);

  useEffect(() => {
    if (controlledActiveHighlightId === undefined) return;
    setActiveHighlightId(controlledActiveHighlightId);
    if (controlledActiveHighlightId) {
      handleJumpToHighlight(controlledActiveHighlightId);
    }
  }, [controlledActiveHighlightId, handleJumpToHighlight, setActiveHighlightId]);

  const bindingByIdRef = useRef(bindingById);
  bindingByIdRef.current = bindingById;
  const onOpenBindingRef = useRef(onOpenBinding);
  onOpenBindingRef.current = onOpenBinding;
  const handleOpenBindingById = useCallback((id: string) => {
    if (!id.trim()) return;
    const found = bindingByIdRef.current.get(asThreadBindingId(id));
    if (found) onOpenBindingRef.current?.(found);
  }, []);

  const showInlineMarginalia =
    !showMarginaliaRail && (highlights.length > 0 || bindings.some((b) => Boolean(b.selectionAnchor?.quote)));

  return (
    <div className={cn("flex w-full flex-col gap-5", className)} ref={rootRef}>
      {/* Sticky 2px Top Scroll Progress Bar */}
      <div aria-hidden="true" className="sticky top-0 z-20 h-[2px] w-full overflow-hidden bg-border/30">
        <div
          className="h-full w-full origin-left bg-primary will-change-transform"
          ref={progressBarRef}
          style={{ transform: "scaleX(0)" }}
        />
      </div>

      {doc.unreadAgentUpdate && (
        <ReaderAgentUpdateBanner
          onMarkAgentUpdateRead={onMarkAgentUpdateRead}
          onViewDiff={onViewDiff}
          version={doc.version}
        />
      )}

      <div className="flex items-start gap-8">
        <article
          className={cn(
            "min-w-0 flex-1 rounded-xl transition-colors",
            paperMode === "sepia" &&
              !suppressInnerSepiaBox &&
              "inkade-paper-sepia border px-6 py-5 sm:px-8",
          )}
        >
          <ReaderHeader
            activeFontFamily={activeFontFamily}
            activeMeasure={activeMeasure}
            document={doc}
            hideTitleHeader={hideTitleHeader}
            onEdit={onEdit}
            onUpdatePrefs={updatePrefs}
            paperMode={paperMode}
            prefs={prefs}
            readingStats={readingStats}
          />

          <div
            className="relative"
            onClick={(e) => {
              const targetEl = (e.target as HTMLElement | null)?.closest<HTMLElement>(
                "mark[data-highlight-id], mark[data-binding-id]",
              );
              if (!targetEl) return;
              const hlId = targetEl.getAttribute("data-highlight-id");
              if (hlId && hlId.trim().length > 0) {
                const parsedId = asHighlightId(hlId);
                setActiveHighlightId(parsedId);
                onSelectHighlight?.(parsedId);
                return;
              }
              const bId = targetEl.getAttribute("data-binding-id");
              if (bId && bId.trim().length > 0) {
                const binding = bindingById.get(asThreadBindingId(bId));
                if (binding) onOpenBinding?.(binding);
              }
            }}
            onKeyUp={updateSelectionToolbar}
            onMouseUp={updateSelectionToolbar}
            ref={proseRef}
          >
            {selectionState &&
              (onCreateHighlight || onAskAgent || onExcerptToDaily || onCopyQuoteLink) && (
                <ReaderSelectionToolbar
                  docTitle={doc.title}
                  noteColor={noteColor}
                  noteComposerOpen={noteComposerOpen}
                  noteInput={noteInput}
                  onAskAgent={onAskAgent}
                  onClose={() => {
                    setNoteComposerOpen(false);
                    setSelectionState(null);
                  }}
                  onCopyQuote={handleCopyQuote}
                  onCreateHighlight={onCreateHighlight}
                  onExcerptToDaily={onExcerptToDaily}
                  onNoteColorChange={setNoteColor}
                  onNoteComposerOpenChange={setNoteComposerOpen}
                  onNoteInputChange={setNoteInput}
                  selectionState={selectionState}
                />
              )}

            <div
              className="inkade-prose"
              data-font={activeFontFamily}
              data-measure={activeMeasure}
              data-paper={paperMode === "sepia" ? "sepia" : undefined}
              data-size={activeFontSize}
            >
              <MemoizedMarkdownProse
                bindings={bindings}
                docsByKey={docsByKey}
                embeddedViewSnapshots={embeddedViewSnapshots}
                onCreateMissingDoc={onCreateMissingDoc}
                onIssueArtifactTicket={onIssueArtifactTicket}
                onOpenBinding={onOpenBinding}
                onOpenBindingById={handleOpenBindingById}
                onOpenDocument={onOpenDocument}
                onOpenSecuritySettings={onOpenSecuritySettings}
                onOpenWikilink={onOpenWikilink}
                onQueryInkadeView={onQueryInkadeView}
                onSubmitArtifactComment={onSubmitArtifactComment}
                paperMode={paperMode}
                renderedMarkdown={renderedMarkdown}
                spaceById={spaceById}
                spaces={spaces}
                theme={theme}
                workspaceDocs={workspaceDocs}
              />
            </div>
          </div>

          {showInlineMarginalia && (
            <MarginaliaOverlay
              activeHighlightId={activeHighlightId}
              anchorPositions={anchorPositions}
              bindings={bindings}
              bridgeSessions={bridgeSessions}
              commentsByHighlightId={commentsByHighlightId}
              deliveryReceipts={deliveryReceipts}
              highlights={highlights}
              mode="inline"
              onAddComment={onAddComment}
              onAskFromHighlight={
                onAskAgent ? (hl) => onAskAgent({ quote: hl.quote }) : undefined
              }
              onDeleteHighlight={onDeleteHighlight}
              onOpenBinding={onOpenBinding}
              onReopenHighlight={onReopenHighlight}
              onResolveHighlight={onResolveHighlight}
              onSelectHighlight={(hlId) => {
                handleJumpToHighlight(hlId);
                onSelectHighlight?.(hlId);
              }}
              onSendToAgent={onSendToAgent}
              onStatusFilterChange={onStatusFilterChange}
              onUpdateHighlight={onUpdateHighlight}
              readOnly={readOnly}
              replyingHighlightId={replyingHighlightId}
              sendingHighlightId={sendingHighlightId}
              statusFilter={statusFilter}
            />
          )}
        </article>

        {showMarginaliaRail &&
        (highlights.length > 0 || bindings.some((b) => Boolean(b.selectionAnchor?.quote))) ? (
          <div className="hidden flex-col gap-6 xl:flex">
            <MarginaliaOverlay
              activeHighlightId={activeHighlightId}
              anchorPositions={anchorPositions}
              bindings={bindings}
              bridgeSessions={bridgeSessions}
              commentsByHighlightId={commentsByHighlightId}
              deliveryReceipts={deliveryReceipts}
              highlights={highlights}
              mode="rail"
              onAddComment={onAddComment}
              onAskFromHighlight={
                onAskAgent ? (hl) => onAskAgent({ quote: hl.quote }) : undefined
              }
              onDeleteHighlight={onDeleteHighlight}
              onOpenBinding={onOpenBinding}
              onReopenHighlight={onReopenHighlight}
              onResolveHighlight={onResolveHighlight}
              onSelectHighlight={(hlId) => {
                handleJumpToHighlight(hlId);
                onSelectHighlight?.(hlId);
              }}
              onSendToAgent={onSendToAgent}
              onStatusFilterChange={onStatusFilterChange}
              onUpdateHighlight={onUpdateHighlight}
              readOnly={readOnly}
              replyingHighlightId={replyingHighlightId}
              sendingHighlightId={sendingHighlightId}
              statusFilter={statusFilter}
            />
          </div>
        ) : (
          showToc &&
          toc.length > 0 && (
            <ReaderTocRail
              activeSlug={activeSlug}
              onSelectSlug={handleSelectTocSlug}
              toc={toc}
            />
          )
        )}
      </div>
    </div>
  );
}
