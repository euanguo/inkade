"use client";

import {
  matchHighlightAnchor,
  type AdeThreadBinding,
  type AnchorMatchResult,
  type AnchorSpec,
  type BridgeSessionId,
  type BridgeSessionRecord,
  type DocumentHighlight,
  type HighlightColor,
  type HighlightComment,
  type HighlightId,
  type HighlightStatus,
  type HighlightWakeDeliveryTarget,
  type ThreadBindingId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  RotateCcwIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import { Popover, PopoverPopup, PopoverTrigger } from "../primitives/popover.tsx";
import { Textarea } from "../primitives/textarea.tsx";
import { AdeThreadChip } from "./AdeThreadChip.tsx";

export { matchHighlightAnchor, type AnchorMatchResult, type AnchorSpec };

export type MarginaliaStatusFilter = HighlightStatus | "all";

export interface MarginaliaDeliveryReceipt {
  readonly deliveryTarget: HighlightWakeDeliveryTarget;
  readonly wakeStatus?: string | undefined;
  readonly agentLabel?: string | undefined;
}

export interface MarginaliaReceiptSummary {
  readonly kind: "woke" | "queued" | "unowned" | "sent";
  readonly targetLabel?: string | undefined;
}

export function filterMarginaliaHighlights(
  highlights: readonly DocumentHighlight[],
  filter: MarginaliaStatusFilter,
): readonly DocumentHighlight[] {
  if (filter === "all") return highlights;
  return highlights.filter((hl) => hl.status === filter);
}

export function resolveHighlightBinding(
  highlight: DocumentHighlight,
  bindings: readonly AdeThreadBinding[],
): AdeThreadBinding | null {
  if (highlight.bindingId) {
    const direct = bindings.find((b) => b.id === highlight.bindingId && b.status !== "archived");
    if (direct) return direct;
  }
  return (
    bindings.find((b) => b.status === "running") ??
    bindings.find((b) => b.status === "waiting_input") ??
    bindings.find((b) => b.status === "queued") ??
    null
  );
}

function renderInlineCommentMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          className="break-all rounded bg-muted/85 px-1 py-0.5 font-mono text-[10.5px] text-foreground"
          key={idx}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong className="font-semibold text-foreground" key={idx}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function formatCompactWorkspacePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.length <= 34) return trimmed;
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length <= 3) return trimmed;
  return `…/${parts.slice(-3).join("/")}`;
}

function isLegacyArtifactBoilerplateNote(highlight: DocumentHighlight): boolean {
  return Boolean(
    highlight.prefixContext?.startsWith("inkade-artifact:") &&
      highlight.noteMarkdown.startsWith("Interactive artifact comment thread"),
  );
}

export interface EstimateMarginaliaHeightOptions {
  readonly hasReplyForm?: boolean | undefined;
  readonly hasReceipt?: boolean | undefined;
  readonly ignoreBoilerplateNote?: boolean | undefined;
}

export function estimateMarginaliaCardHeight(
  highlight: DocumentHighlight,
  comments: readonly HighlightComment[] = [],
  options?: EstimateMarginaliaHeightOptions,
): number {
  if (highlight.status === "resolved") {
    return 76;
  }
  if (!options) {
    const noteHeight = highlight.noteMarkdown ? 44 : 24;
    const commentsHeight = comments.length * 46;
    return 124 + noteHeight + commentsHeight;
  }
  const hasVisibleNote =
    Boolean(highlight.noteMarkdown) &&
    !(options.ignoreBoilerplateNote && isLegacyArtifactBoilerplateNote(highlight));
  const noteHeight = hasVisibleNote
    ? Math.max(44, 18 + Math.ceil(highlight.noteMarkdown.length / 24) * 20)
    : options.hasReplyForm
      ? 24
      : 0;
  const commentsHeight = comments.reduce(
    (sum, comment) =>
      sum + Math.max(54, 34 + Math.ceil(comment.bodyMarkdown.length / 22) * 18),
    0,
  );
  const replyHeight = options.hasReplyForm ? 104 : 0;
  const receiptHeight = options.hasReceipt ? 28 : 0;
  return 72 + noteHeight + commentsHeight + replyHeight + receiptHeight;
}

export function formatThreadReceiptInfo(params: {
  readonly highlight: DocumentHighlight;
  readonly comments: readonly HighlightComment[];
  readonly receipt?: MarginaliaDeliveryReceipt | undefined;
  readonly bindings?: readonly AdeThreadBinding[] | undefined;
}): MarginaliaReceiptSummary | null {
  const { highlight, comments, receipt, bindings = [] } = params;
  if (receipt) {
    if (receipt.deliveryTarget === "unowned") {
      return { kind: "unowned" };
    }
    if (receipt.wakeStatus === "pending") {
      return { kind: "queued" };
    }
    return {
      kind: "woke",
      targetLabel: receipt.agentLabel || "Agent",
    };
  }

  const latestSent = [...comments].reverse().find((c) => c.sentToAgentAt !== null);
  if (!latestSent) return null;

  const bound = resolveHighlightBinding(highlight, bindings);
  if (bound) {
    return {
      kind: "woke",
      targetLabel: bound.title || bound.adeKind,
    };
  }
  return { kind: "sent" };
}

export interface MarginaliaLayoutItem {
  readonly id: string;
  readonly idealTop: number;
  readonly estimatedHeight: number;
}

export interface MarginaliaPositionedItem extends MarginaliaLayoutItem {
  readonly top: number;
}

/**
 * Collision-free vertical layout solver for right-rail marginalia cards.
 * Guarantees a minimum `gap` px between adjacent cards while staying as close as possible to `idealTop`.
 */
export function resolveMarginaliaCollisions(
  items: readonly MarginaliaLayoutItem[],
  gap = 12,
): MarginaliaPositionedItem[] {
  const sorted = [...items].sort((a, b) => a.idealTop - b.idealTop);
  const placed: MarginaliaPositionedItem[] = [];
  let cursorBottom = 0;

  for (const item of sorted) {
    const top = Math.max(0, item.idealTop, cursorBottom);
    placed.push({ ...item, top });
    cursorBottom = top + Math.max(48, item.estimatedHeight) + gap;
  }

  return placed;
}

export const HIGHLIGHT_COLOR_SWATCHES: Readonly<
  Record<HighlightColor, { readonly dotClass: string; readonly borderClass: string }>
> = {
  amber: {
    dotClass: "bg-amber-400",
    borderClass: "border-border",
  },
  emerald: {
    dotClass: "bg-emerald-400",
    borderClass: "border-border",
  },
  blue: {
    dotClass: "bg-blue-400",
    borderClass: "border-border",
  },
  rose: {
    dotClass: "bg-rose-400",
    borderClass: "border-border",
  },
};

export interface MarginaliaAnchorPosition {
  readonly kind: "highlight" | "binding";
  readonly id: string;
  readonly top: number;
}

export interface MarginaliaOverlayProps {
  readonly highlights: readonly DocumentHighlight[];
  readonly commentsByHighlightId?: Readonly<Record<string, readonly HighlightComment[]>> | undefined;
  readonly bindings?: readonly AdeThreadBinding[] | undefined;
  readonly bridgeSessions?: readonly BridgeSessionRecord[] | undefined;
  readonly anchorPositions: readonly MarginaliaAnchorPosition[];
  readonly activeHighlightId?: HighlightId | null | undefined;
  readonly statusFilter?: MarginaliaStatusFilter | undefined;
  readonly onStatusFilterChange?: ((next: MarginaliaStatusFilter) => void) | undefined;
  readonly sendingHighlightId?: HighlightId | null | undefined;
  readonly replyingHighlightId?: HighlightId | null | undefined;
  readonly deliveryReceipts?: Readonly<Record<string, MarginaliaDeliveryReceipt>> | undefined;
  readonly readOnly?: boolean | undefined;
  readonly onSelectHighlight?: ((highlightId: HighlightId) => void) | undefined;
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
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onAskFromHighlight?: ((highlight: DocumentHighlight) => void) | undefined;
  readonly mode?: "rail" | "inline" | undefined;
  readonly className?: string | undefined;
}

export function MarginaliaOverlay({
  highlights,
  commentsByHighlightId = {},
  bindings = [],
  bridgeSessions = [],
  anchorPositions,
  activeHighlightId,
  statusFilter: statusFilterProp,
  onStatusFilterChange,
  sendingHighlightId,
  replyingHighlightId,
  deliveryReceipts = {},
  readOnly = false,
  onSelectHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
  onAddComment,
  onSendToAgent,
  onResolveHighlight,
  onReopenHighlight,
  onOpenBinding,
  onAskFromHighlight,
  mode = "rail",
  className,
}: MarginaliaOverlayProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const [editingId, setEditingId] = useState<HighlightId | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [internalFilter, setInternalFilter] = useState<MarginaliaStatusFilter>("all");
  const [replyDrafts, setReplyDrafts] = useState<Readonly<Record<string, string>>>({});
  const [expandedResolvedIds, setExpandedResolvedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [sessionPickerHighlightId, setSessionPickerHighlightId] = useState<HighlightId | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<Readonly<Record<string, number>>>({});
  const cardNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const refCallbacksRef = useRef<Map<string, (node: HTMLDivElement | null) => void>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const updateCardMeasurement = useCallback((cardKey: string, el: HTMLElement) => {
    const rectHeight = el.getBoundingClientRect().height;
    const measured = Math.ceil(rectHeight > 0 ? rectHeight : el.offsetHeight);
    if (measured <= 0) return;
    setMeasuredHeights((prev) => {
      const existing = prev[cardKey] ?? 0;
      if (Math.abs(existing - measured) < 1) return prev;
      return { ...prev, [cardKey]: measured };
    });
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const cardKey = el.dataset.marginaliaCardKey;
        if (cardKey) {
          updateCardMeasurement(cardKey, el);
        }
      }
    });
    resizeObserverRef.current = observer;
    for (const [cardKey, node] of cardNodesRef.current.entries()) {
      observer.observe(node);
      updateCardMeasurement(cardKey, node);
    }
    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [updateCardMeasurement]);

  const getCardRefCallback = useCallback(
    (cardKey: string) => {
      let cached = refCallbacksRef.current.get(cardKey);
      if (!cached) {
        cached = (node: HTMLDivElement | null) => {
          const prevNode = cardNodesRef.current.get(cardKey);
          if (prevNode && prevNode !== node) {
            resizeObserverRef.current?.unobserve(prevNode);
            cardNodesRef.current.delete(cardKey);
          }
          if (node) {
            cardNodesRef.current.set(cardKey, node);
            resizeObserverRef.current?.observe(node);
            updateCardMeasurement(cardKey, node);
          }
        };
        refCallbacksRef.current.set(cardKey, cached);
      }
      return cached;
    },
    [updateCardMeasurement],
  );

  const statusFilter = statusFilterProp ?? internalFilter;
  const setStatusFilter = onStatusFilterChange ?? setInternalFilter;

  const filteredHighlights = useMemo(
    () => filterMarginaliaHighlights(highlights, statusFilter),
    [highlights, statusFilter],
  );

  const onlineBridgeSessions = useMemo(
    () => bridgeSessions.filter((s) => s.status === "online"),
    [bridgeSessions],
  );

  const anchoredBindings = useMemo(
    () => bindings.filter((b) => Boolean(b.selectionAnchor?.quote)),
    [bindings],
  );

  const posMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const pos of anchorPositions) {
      map.set(`${pos.kind}:${pos.id}`, pos.top);
    }
    return map;
  }, [anchorPositions]);

  const { anchoredCards, orphanHighlights } = useMemo(() => {
    const rawItems: Array<{
      readonly id: string;
      readonly kind: "highlight" | "binding";
      readonly idealTop: number;
      readonly estimatedHeight: number;
      readonly highlight?: DocumentHighlight;
      readonly binding?: AdeThreadBinding;
    }> = [];
    const orphans: DocumentHighlight[] = [];
    const hasReplyForm = !readOnly && Boolean(onAddComment || onSendToAgent);

    for (const hl of filteredHighlights) {
      const top = posMap.get(`highlight:${hl.id}`);
      if (top === undefined) {
        orphans.push(hl);
        continue;
      }
      const comments = commentsByHighlightId[hl.id] ?? [];
      const receipt = formatThreadReceiptInfo({
        highlight: hl,
        comments,
        receipt: deliveryReceipts[hl.id],
        bindings,
      });
      const cardKey = `highlight:${hl.id}`;
      const baseEstimated = estimateMarginaliaCardHeight(hl, comments, {
        hasReplyForm,
        hasReceipt: Boolean(receipt),
        ignoreBoilerplateNote: true,
      });
      rawItems.push({
        id: cardKey,
        kind: "highlight",
        idealTop: top,
        estimatedHeight: Math.max(baseEstimated, measuredHeights[cardKey] ?? 0),
        highlight: hl,
      });
    }

    for (const b of anchoredBindings) {
      const top = posMap.get(`binding:${b.id}`);
      if (top === undefined) continue;
      const cardKey = `binding:${b.id}`;
      rawItems.push({
        id: cardKey,
        kind: "binding",
        idealTop: top,
        estimatedHeight: Math.max(96, measuredHeights[cardKey] ?? 0),
        binding: b,
      });
    }

    const laidOut = resolveMarginaliaCollisions(rawItems, 12);
    const byId = new Map(rawItems.map((item) => [item.id, item]));
    const cards = laidOut.map((pos) => ({
      ...pos,
      item: byId.get(pos.id)!,
    }));

    return { anchoredCards: cards, orphanHighlights: orphans };
  }, [
    filteredHighlights,
    anchoredBindings,
    posMap,
    commentsByHighlightId,
    measuredHeights,
    readOnly,
    onAddComment,
    onSendToAgent,
    deliveryReceipts,
    bindings,
  ]);

  if (highlights.length === 0 && anchoredBindings.length === 0) {
    return null;
  }

  const openCount = highlights.filter((hl) => hl.status !== "resolved").length;
  const resolvedCount = highlights.length - openCount;

  const renderFilterBar = (): React.ReactElement | null => {
    if (highlights.length === 0) return null;
    const filterItems: readonly { readonly key: MarginaliaStatusFilter; readonly label: string }[] = [
      { key: "all", label: `${t("reader.commentFilterAll")} (${highlights.length})` },
      { key: "open", label: `${t("reader.commentFilterOpen")} (${openCount})` },
      { key: "resolved", label: `${t("reader.commentFilterResolved")} (${resolvedCount})` },
    ];
    return (
      <div className="flex flex-wrap items-center gap-1" data-testid="marginalia-status-filter">
        {filterItems.map((item) => (
          <button
            className={cn(
              "cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors",
              statusFilter === item.key
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            key={item.key}
            onClick={() => setStatusFilter(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  };

  const submitReply = async (hlId: HighlightId): Promise<void> => {
    const draft = (replyDrafts[hlId] ?? "").trim();
    if (!draft || !onAddComment) return;
    await onAddComment(hlId, draft);
    setReplyDrafts((prev) => ({ ...prev, [hlId]: "" }));
  };

  const dispatchToAgent = async (
    hlId: HighlightId,
    options?: {
      readonly bridgeSessionId?: BridgeSessionId | null | undefined;
      readonly bindingId?: ThreadBindingId | null | undefined;
    },
  ): Promise<void> => {
    if (!onSendToAgent) return;
    const draft = (replyDrafts[hlId] ?? "").trim();
    await onSendToAgent(hlId, {
      ...options,
      ...(draft ? { bodyMarkdown: draft } : {}),
    });
    if (draft) {
      setReplyDrafts((prev) => ({ ...prev, [hlId]: "" }));
    }
    setSessionPickerHighlightId(null);
  };

  const renderHighlightCard = (
    hl: DocumentHighlight,
    style?: React.CSSProperties,
  ): React.ReactElement => {
    const swatch = HIGHLIGHT_COLOR_SWATCHES[hl.color];
    const isEditing = editingId === hl.id;
    const isActive = activeHighlightId === hl.id;
    const isResolved = hl.status === "resolved";
    const isExpanded = !isResolved || expandedResolvedIds.has(hl.id);
    const comments = commentsByHighlightId[hl.id] ?? [];
    const replyDraft = replyDrafts[hl.id] ?? "";
    const boundThread = resolveHighlightBinding(hl, bindings);
    const receiptSummary = formatThreadReceiptInfo({
      highlight: hl,
      comments,
      receipt: deliveryReceipts[hl.id],
      bindings,
    });
    const isSending = sendingHighlightId === hl.id;
    const isReplying = replyingHighlightId === hl.id;

    const cardKey = `highlight:${hl.id}`;
    const showNoteText = Boolean(hl.noteMarkdown && !isLegacyArtifactBoilerplateNote(hl));

    return (
      <div
        className={cn(
          "min-w-0 max-w-full rounded-lg border border-border bg-card p-2.5 text-xs text-card-foreground transition-colors [overflow-wrap:anywhere]",
          isResolved && "opacity-80",
          isActive && "ring-2 ring-primary/40",
          style ? "absolute right-0 left-0" : "relative",
        )}
        data-highlight-status={hl.status}
        data-marginalia-card-key={style ? cardKey : undefined}
        data-marginalia-highlight-id={hl.id}
        key={hl.id}
        ref={style ? getCardRefCallback(cardKey) : undefined}
        style={style}
      >
        <div className="mb-1.5 flex items-center justify-between gap-1.5">
          <button
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
            onClick={() => onSelectHighlight?.(hl.id)}
            title={t("reader.jumpToHighlight")}
            type="button"
          >
            <span className={cn("size-2 shrink-0 rounded-full", swatch.dotClass)} />
            <span className="line-clamp-1 min-w-0 break-all font-medium text-muted-foreground">
              {hl.quote}
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-0.5">
            {isResolved && (
              <Badge size="sm" variant="secondary">
                {t("reader.commentResolvedBadge")}
              </Badge>
            )}
            {!readOnly && !isResolved && onResolveHighlight && (
              <Button
                aria-label={t("reader.resolveThread")}
                onClick={() => onResolveHighlight(hl.id)}
                size="icon-xs"
                title={t("reader.resolveThread")}
                variant="ghost"
              >
                <CheckCircle2Icon className="size-3" />
              </Button>
            )}
            {!readOnly && isResolved && onReopenHighlight && (
              <Button
                aria-label={t("reader.reopenThread")}
                onClick={() => onReopenHighlight(hl.id)}
                size="icon-xs"
                title={t("reader.reopenThread")}
                variant="ghost"
              >
                <RotateCcwIcon className="size-3" />
              </Button>
            )}
            {!readOnly && onUpdateHighlight && (
              <Button
                aria-label={t("reader.editNote")}
                onClick={() => {
                  setEditingId(isEditing ? null : hl.id);
                  setNoteDraft(hl.noteMarkdown);
                }}
                size="icon-xs"
                variant="ghost"
              >
                <PencilIcon className="size-3" />
              </Button>
            )}
            {!readOnly && onAskFromHighlight && (
              <Button
                aria-label={t("reader.askAgent")}
                onClick={() => onAskFromHighlight(hl)}
                size="icon-xs"
                variant="ghost"
              >
                <SparklesIcon className="size-3" />
              </Button>
            )}
            {!readOnly && onDeleteHighlight && (
              <Button
                aria-label={t("reader.deleteHighlight")}
                onClick={() => onDeleteHighlight(hl.id)}
                size="icon-xs"
                variant="ghost"
              >
                <Trash2Icon className="size-3 text-muted-foreground hover:text-destructive-foreground" />
              </Button>
            )}
          </div>
        </div>

        {isResolved && (
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{t("reader.commentCountLabel", { count: comments.length })}</span>
            <button
              className="inline-flex cursor-pointer items-center gap-0.5 hover:text-foreground"
              onClick={() =>
                setExpandedResolvedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(hl.id)) next.delete(hl.id);
                  else next.add(hl.id);
                  return next;
                })
              }
              type="button"
            >
              {isExpanded ? (
                <>
                  <ChevronDownIcon className="size-3" />
                  {t("reader.expandResolved")}
                </>
              ) : (
                <>
                  <ChevronRightIcon className="size-3" />
                  {t("reader.collapseResolved")}
                </>
              )}
            </button>
          </div>
        )}

        {isExpanded && (
          <>
            {isEditing ? (
              <div className="flex flex-col gap-1.5">
                {onUpdateHighlight && (
                  <div className="flex items-center gap-1">
                    {(["amber", "emerald", "blue", "rose"] as const).map((color) => (
                      <button
                        aria-label={color}
                        className={cn(
                          "size-4 cursor-pointer rounded-full border",
                          HIGHLIGHT_COLOR_SWATCHES[color].dotClass,
                          hl.color === color && "ring-2 ring-foreground/50 ring-offset-1",
                        )}
                        key={color}
                        onClick={() => onUpdateHighlight(hl.id, { color })}
                        type="button"
                      />
                    ))}
                  </div>
                )}
                <Textarea
                  autoFocus
                  className="min-h-16 text-xs"
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder={t("reader.notePlaceholder")}
                  value={noteDraft}
                />
                <div className="flex justify-end gap-1">
                  <Button
                    onClick={() => setEditingId(null)}
                    size="xs"
                    variant="ghost"
                  >
                    <XIcon className="size-3" />
                    {t("common.cancel")}
                  </Button>
                  <Button
                    onClick={() => {
                      onUpdateHighlight?.(hl.id, { noteMarkdown: noteDraft });
                      setEditingId(null);
                    }}
                    size="xs"
                    variant="default"
                  >
                    <CheckIcon className="size-3" />
                    {t("reader.saveNote")}
                  </Button>
                </div>
              </div>
            ) : showNoteText ? (
              <p className="min-w-0 whitespace-pre-wrap text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
                {renderInlineCommentMarkdown(hl.noteMarkdown)}
              </p>
            ) : !readOnly && onUpdateHighlight && comments.length === 0 ? (
              <button
                className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setEditingId(hl.id);
                  setNoteDraft("");
                }}
                type="button"
              >
                <MessageSquarePlusIcon className="size-3" />
                {t("reader.addNote")}
              </button>
            ) : null}

            {comments.length > 0 && (
              <div
                className="mt-2 flex flex-col gap-1.5 border-t border-border/60 pt-2"
                data-testid="highlight-comment-list"
              >
                {comments.map((comment) => {
                  const authorLabel =
                    comment.authorType === "agent"
                      ? comment.authorName || t("reader.authorAgent")
                      : comment.authorType === "collaborator"
                        ? comment.authorName || t("reader.authorCollaborator")
                        : t("reader.authorOwner");
                  return (
                    <div
                      className={cn(
                        "rounded-md px-2 py-1.5 text-[11px]",
                        comment.authorType === "agent"
                          ? "bg-primary/8 text-foreground"
                          : comment.authorType === "collaborator"
                            ? "bg-amber-500/10 text-foreground"
                            : "bg-muted/50 text-foreground",
                      )}
                      key={comment.id}
                    >
                      <div className="mb-0.5 flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1 font-medium text-foreground/85">
                          {comment.authorType === "agent" ? (
                            <BotIcon className="size-3 text-primary" />
                          ) : comment.authorType === "collaborator" ? (
                            <UsersIcon className="size-3 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <UserIcon className="size-3" />
                          )}
                          <span>{authorLabel}</span>
                        </span>
                        <span className="tabular-nums">
                          {comment.createdAt.slice(11, 16)}
                        </span>
                      </div>
                      <p className="min-w-0 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                        {renderInlineCommentMarkdown(comment.bodyMarkdown)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {!readOnly && (onAddComment || onSendToAgent) && (
              <div className="mt-2 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <Textarea
                  className="min-h-12 text-xs"
                  onChange={(e) =>
                    setReplyDrafts((prev) => ({ ...prev, [hl.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void submitReply(hl.id);
                    }
                  }}
                  placeholder={t("reader.commentReplyPlaceholder")}
                  value={replyDraft}
                />
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div className="flex items-center gap-1">
                    {onAddComment && (
                      <Button
                        disabled={!replyDraft.trim() || isReplying}
                        loading={isReplying}
                        onClick={() => void submitReply(hl.id)}
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        {t("reader.addReply")}
                      </Button>
                    )}
                  </div>

                  {onSendToAgent &&
                    (boundThread || onlineBridgeSessions.length === 0 ? (
                      <Button
                        disabled={isSending}
                        loading={isSending}
                        onClick={() =>
                          void dispatchToAgent(
                            hl.id,
                            boundThread ? { bindingId: boundThread.id } : undefined,
                          )
                        }
                        size="xs"
                        type="button"
                        variant="secondary"
                      >
                        <SendIcon className="size-3" />
                        {isSending ? t("reader.sendingToAgent") : t("reader.sendToAgent")}
                      </Button>
                    ) : (
                      <Popover
                        onOpenChange={(open) =>
                          setSessionPickerHighlightId(open ? hl.id : null)
                        }
                        open={sessionPickerHighlightId === hl.id}
                      >
                        <PopoverTrigger
                          render={
                            <Button
                              disabled={isSending}
                              loading={isSending}
                              size="xs"
                              type="button"
                              variant="secondary"
                            >
                              <SendIcon className="size-3" />
                              {isSending ? t("reader.sendingToAgent") : t("reader.sendToAgent")}
                            </Button>
                          }
                        />
                        <PopoverPopup
                          align="end"
                          className="w-72 bg-popover p-1.5 shadow-[var(--shadow-overlay)]"
                          sideOffset={6}
                        >
                          <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                            {t("reader.selectTargetSession")}
                          </p>
                          <div className="flex flex-col gap-0.5">
                            {onlineBridgeSessions.map((session) => {
                              const sessionTitle =
                                session.harnessName.trim().toLowerCase() ===
                                session.adeKind.trim().toLowerCase()
                                  ? session.harnessName
                                  : `${session.harnessName} (${session.adeKind})`;
                              return (
                                <button
                                  className="flex w-full cursor-pointer flex-col rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                                  key={session.id}
                                  onClick={() =>
                                    void dispatchToAgent(hl.id, {
                                      bridgeSessionId: session.id,
                                    })
                                  }
                                  type="button"
                                >
                                  <span className="font-medium text-foreground">
                                    {sessionTitle}
                                  </span>
                                  {session.workspacePath && (
                                    <span
                                      className="truncate text-[10px] text-muted-foreground"
                                      title={session.workspacePath}
                                    >
                                      {formatCompactWorkspacePath(session.workspacePath)}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                            <button
                              className="mt-1 flex w-full cursor-pointer items-center rounded-md border-t border-border/60 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              onClick={() => void dispatchToAgent(hl.id)}
                              type="button"
                            >
                              {t("reader.unownedQueueOption")}
                            </button>
                          </div>
                        </PopoverPopup>
                      </Popover>
                    ))}
                </div>

                {receiptSummary && (
                  <div className="flex items-center gap-1" data-testid="highlight-delivery-receipt">
                    <Badge
                      size="sm"
                      variant={
                        receiptSummary.kind === "woke"
                          ? "success"
                          : receiptSummary.kind === "unowned"
                            ? "warning"
                            : "secondary"
                      }
                    >
                      {receiptSummary.kind === "woke"
                        ? t("reader.receiptWokeAgent", {
                            target: receiptSummary.targetLabel ?? "Agent",
                          })
                        : receiptSummary.kind === "queued"
                          ? t("reader.receiptQueued")
                          : receiptSummary.kind === "unowned"
                            ? t("reader.receiptAwaitingClaim")
                            : t("reader.receiptSent")}
                    </Badge>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  if (mode === "inline") {
    return (
      <section
        aria-label={t("reader.marginaliaTitle")}
        className={cn("mt-6 flex min-w-0 max-w-full flex-col gap-3 border-t pt-4", className)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("reader.marginaliaCount", { count: highlights.length + anchoredBindings.length })}
          </span>
          {renderFilterBar()}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
          {filteredHighlights.map((hl) => renderHighlightCard(hl))}
          {anchoredBindings.map((b) => (
            <div
              className="min-w-0 max-w-full rounded-xl border bg-card p-2.5 text-xs [overflow-wrap:anywhere]"
              key={b.id}
            >
              <AdeThreadChip binding={b} compact onOpenInAde={onOpenBinding} />
              {b.selectionAnchor?.quote && (
                <p className="mt-1.5 line-clamp-2 min-w-0 border-l-2 border-primary/40 pl-2 text-muted-foreground [overflow-wrap:anywhere]">
                  {b.selectionAnchor.quote}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    );
  }

  const maxRailHeight = anchoredCards.reduce(
    (max, card) => Math.max(max, card.top + card.estimatedHeight + 24),
    160,
  );

  return (
    <aside
      aria-label={t("reader.marginaliaTitle")}
      className={cn("relative w-68 min-w-0 shrink-0", className)}
    >
      <div className="mb-2 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("reader.marginaliaCount", { count: highlights.length + anchoredBindings.length })}
        </span>
        {renderFilterBar()}
      </div>

      <div className="relative" style={{ minHeight: `${maxRailHeight}px` }}>
        {anchoredCards.map(({ top, item }) => {
          if (item.kind === "highlight" && item.highlight) {
            return renderHighlightCard(item.highlight, { top: `${top}px` });
          }
          if (item.kind === "binding" && item.binding) {
            const b = item.binding;
            const bindingCardKey = `binding:${b.id}`;
            return (
              <div
                className="absolute right-0 left-0 min-w-0 rounded-lg border border-border bg-card p-2.5 text-xs [overflow-wrap:anywhere]"
                data-marginalia-card-key={bindingCardKey}
                key={item.id}
                ref={getCardRefCallback(bindingCardKey)}
                style={{ top: `${top}px` }}
              >
                <AdeThreadChip binding={b} compact onOpenInAde={onOpenBinding} />
                {b.selectionAnchor?.quote && (
                  <p className="mt-1.5 line-clamp-2 min-w-0 border-l-2 border-primary/40 pl-2 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                    {b.selectionAnchor.quote}
                  </p>
                )}
              </div>
            );
          }
          return null;
        })}
      </div>

      {orphanHighlights.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center gap-1.5">
            <Badge size="sm" variant="outline">
              {t("reader.orphanedMarginalia")}
            </Badge>
          </div>
          {orphanHighlights.map((hl) => renderHighlightCard(hl))}
        </div>
      )}
    </aside>
  );
}
