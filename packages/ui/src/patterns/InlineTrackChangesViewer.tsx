"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { GitCompareIcon, SparklesIcon } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "../lib/utils.ts";
import {
  remarkInkadeCallouts,
  remarkInkadeWikilinks,
} from "./remark-inkade-wikilinks.ts";
import {
  buildInlineReviewModel,
  reconstructMarkdownFromSuggestions,
  type SuggestionDecision,
  type SuggestionHunk,
} from "./track-changes/diff-model.ts";
import {
  applyHunkDecisionWithHistory,
  findNextReviewHunkIndex,
  isReviewShortcutEditableTarget,
  type ReviewSessionState,
  undoLastHunkDecision,
} from "./track-changes/review-session.ts";
import { ReviewHeaderBar, ReviewKeyboardLegend } from "./track-changes/ReviewHeaderBar.tsx";
import { SuggestionHunkCard } from "./track-changes/SuggestionHunkCard.tsx";

export interface InlineTrackChangesViewerProps {
  readonly oldMarkdown: string;
  readonly newMarkdown: string;
  readonly oldLabel?: string | undefined;
  readonly newLabel?: string | undefined;
  readonly changeSummary?: string | null | undefined;
  readonly onApplyResolvedMarkdown?: ((resolvedMarkdown: string) => void) | undefined;
  readonly onCommentRework?: ((hunk: SuggestionHunk, comment: string) => void) | undefined;
  readonly onSwitchToCodeDiff?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly applying?: boolean | undefined;
  readonly enableKeyboardShortcuts?: boolean | undefined;
  readonly navigationKeys?: "jk" | "brackets" | undefined;
  readonly queuePosition?: number | undefined;
  readonly queueTotal?: number | undefined;
  readonly onPrevDocument?: (() => void) | undefined;
  readonly onNextDocument?: (() => void) | undefined;
  readonly className?: string | undefined;
}

export function InlineTrackChangesViewer({
  oldMarkdown,
  newMarkdown,
  oldLabel,
  newLabel,
  changeSummary,
  onApplyResolvedMarkdown,
  onCommentRework,
  onSwitchToCodeDiff,
  onClose,
  applying = false,
  enableKeyboardShortcuts = true,
  navigationKeys = "jk",
  queuePosition,
  queueTotal,
  onPrevDocument,
  onNextDocument,
  className,
}: InlineTrackChangesViewerProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [reviewState, setReviewState] = useState<ReviewSessionState>({
    decisions: {},
    activeIndex: 0,
    history: [],
  });
  const [commentingHunkId, setCommentingHunkId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const hunkRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const { segments, hunks } = useMemo(
    () => buildInlineReviewModel(oldMarkdown, newMarkdown),
    [oldMarkdown, newMarkdown],
  );

  useEffect(() => {
    setReviewState({ decisions: {}, activeIndex: 0, history: [] });
    setCommentingHunkId(null);
    setCommentDraft("");
  }, [oldMarkdown, newMarkdown]);

  const decisions = reviewState.decisions;
  const activeHunkIndex =
    hunks.length === 0 ? 0 : Math.max(0, Math.min(hunks.length - 1, reviewState.activeIndex));

  const pendingCount = useMemo(
    () => hunks.filter((h) => (decisions[h.id] ?? "pending") === "pending").length,
    [hunks, decisions],
  );

  const scrollHunkIntoView = useCallback((hunkId: string | undefined): void => {
    if (!hunkId) return;
    const el = hunkRefs.current.get(hunkId);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const setHunkDecision = useCallback(
    (hunkId: string, decision: SuggestionDecision): void => {
      const idx = hunks.findIndex((h) => h.id === hunkId);
      setReviewState((prev) =>
        applyHunkDecisionWithHistory(prev, hunkId, idx >= 0 ? idx : 0, decision, hunks),
      );
    },
    [hunks],
  );

  const handleUndoLast = useCallback((): void => {
    setReviewState((prev) => {
      const next = undoLastHunkDecision(prev);
      const targetHunk = hunks[next.activeIndex];
      scrollHunkIntoView(targetHunk?.id);
      return next;
    });
  }, [hunks, scrollHunkIntoView]);

  useEffect(() => {
    if (!enableKeyboardShortcuts || hunks.length === 0 || typeof window === "undefined") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isReviewShortcutEditableTarget(event.target)
      ) {
        return;
      }

      const lower = event.key.toLowerCase();
      const isNextHunk = navigationKeys === "brackets" ? event.key === "]" : lower === "j";
      const isPrevHunk = navigationKeys === "brackets" ? event.key === "[" : lower === "k";

      if (isNextHunk || isPrevHunk) {
        event.preventDefault();
        const direction = isNextHunk ? 1 : -1;
        setReviewState((prev) => {
          const nextIdx = findNextReviewHunkIndex(hunks, prev.decisions, prev.activeIndex, direction);
          scrollHunkIntoView(hunks[nextIdx]?.id);
          return { ...prev, activeIndex: nextIdx };
        });
      } else if (lower === "y" || lower === "n") {
        event.preventDefault();
        const decision: SuggestionDecision = lower === "y" ? "accepted" : "rejected";
        setReviewState((prev) => {
          const idx = Math.max(0, Math.min(hunks.length - 1, prev.activeIndex));
          const target = hunks[idx];
          if (!target) return prev;
          const next = applyHunkDecisionWithHistory(prev, target.id, idx, decision, hunks);
          scrollHunkIntoView(hunks[next.activeIndex]?.id);
          return next;
        });
      } else if (lower === "z") {
        event.preventDefault();
        handleUndoLast();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enableKeyboardShortcuts, handleUndoLast, hunks, navigationKeys, scrollHunkIntoView]);

  const applyAllDecisions = (targetDecision: Exclude<SuggestionDecision, "pending">): void => {
    if (hunks.length === 0) return;
    setReviewState((prev) => {
      const changes = hunks
        .filter((h) => (prev.decisions[h.id] ?? "pending") !== targetDecision)
        .map((h) => ({
          hunkId: h.id,
          prevDecision: prev.decisions[h.id] ?? ("pending" as const),
        }));
      if (changes.length === 0) return prev;
      const next: Record<string, SuggestionDecision> = { ...prev.decisions };
      for (const h of hunks) next[h.id] = targetDecision;
      const firstChange = changes[0]!;
      return {
        decisions: next,
        activeIndex: prev.activeIndex,
        history: [
          ...prev.history,
          {
            hunkId: firstChange.hunkId,
            prevDecision: firstChange.prevDecision,
            prevIndex: prev.activeIndex,
            changes,
          },
        ],
      };
    });
  };

  const handleApply = (): void => {
    const resolved = reconstructMarkdownFromSuggestions(segments, decisions, "new");
    onApplyResolvedMarkdown?.(resolved);
  };

  const handleSendComment = (hunk: SuggestionHunk): void => {
    const trimmed = commentDraft.trim();
    if (!trimmed) return;
    onCommentRework?.(hunk, trimmed);
    setCommentingHunkId(null);
    setCommentDraft("");
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[var(--shadow-card)]",
        className,
      )}
      data-slot="inline-track-changes-viewer"
    >
      <ReviewHeaderBar
        applying={applying}
        hasApplyHandler={Boolean(onApplyResolvedMarkdown)}
        hasHistory={reviewState.history.length > 0}
        hunksCount={hunks.length}
        newLabel={newLabel}
        oldLabel={oldLabel}
        onAcceptAll={() => applyAllDecisions("accepted")}
        onApply={handleApply}
        onClose={onClose}
        onNextDocument={onNextDocument}
        onPrevDocument={onPrevDocument}
        onRejectAll={() => applyAllDecisions("rejected")}
        onSwitchToCodeDiff={onSwitchToCodeDiff}
        onUndo={handleUndoLast}
        pendingCount={pendingCount}
        queuePosition={queuePosition}
        queueTotal={queueTotal}
      />

      {changeSummary && (
        <div className="flex items-start gap-2 border-b bg-brand-subtle/40 px-4 py-2 text-xs text-foreground">
          <SparklesIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-primary">{t("diff.agentSummaryLabel")}: </span>
            <span>{changeSummary}</span>
          </div>
        </div>
      )}

      {hunks.length === 0 ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <GitCompareIcon className="size-4" />
          <span>{t("diff.noChangesDesc")}</span>
        </div>
      ) : (
        <div className="inkade-prose mx-auto w-full max-w-[76ch] px-6 py-5">
          {segments.map((seg, idx) => {
            if (seg.type === "unchanged") {
              return (
                <div className="my-2 opacity-90" key={`unchanged-${idx}`}>
                  <Markdown
                    rehypePlugins={[rehypeKatex]}
                    remarkPlugins={[remarkGfm, remarkMath, remarkInkadeCallouts, remarkInkadeWikilinks]}
                  >
                    {seg.text}
                  </Markdown>
                </div>
              );
            }

            const { hunk } = seg;
            const decision = decisions[hunk.id] ?? "pending";
            const isCommenting = commentingHunkId === hunk.id;

            return (
              <SuggestionHunkCard
                commentDraft={commentDraft}
                decision={decision}
                hasCommentHandler={Boolean(onCommentRework)}
                hunk={hunk}
                isActive={hunk.index === activeHunkIndex}
                isCommenting={isCommenting}
                key={hunk.id}
                onCommentDraftChange={setCommentDraft}
                onDecision={(next) => setHunkDecision(hunk.id, next)}
                onSelect={() => setReviewState((prev) => ({ ...prev, activeIndex: hunk.index }))}
                onSubmitComment={() => handleSendComment(hunk)}
                onToggleComment={() => {
                  setCommentingHunkId(isCommenting ? null : hunk.id);
                  setCommentDraft("");
                }}
                setCardRef={(el) => {
                  if (el) hunkRefs.current.set(hunk.id, el);
                  else hunkRefs.current.delete(hunk.id);
                }}
              />
            );
          })}
        </div>
      )}

      {enableKeyboardShortcuts && hunks.length > 0 && (
        <ReviewKeyboardLegend navigationKeys={navigationKeys} />
      )}
    </div>
  );
}
