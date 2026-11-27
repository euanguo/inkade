"use client";

import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { DocumentKind } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import type { Editor } from "@tiptap/react";
import { CalendarDaysIcon, HashIcon, LoaderCircleIcon, PlusIcon, SparklesIcon } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import { GlideHighlight } from "../../primitives/glide-highlight.tsx";
import { Kbd } from "../../primitives/kbd.tsx";
import { DocumentKindIcon } from "../../primitives/tag-pill.tsx";
import type {
  MentionDocumentCandidate,
  SlashCommandCategory,
  SlashCommandItem,
  TriggerMatch,
} from "../types.ts";

export type MentionTriggerItem =
  | {
      readonly itemKind: "doc";
      readonly id: string;
      readonly title: string;
      readonly docKind: DocumentKind;
    }
  | {
      readonly itemKind: "date";
      readonly id: string;
      readonly label: string;
      readonly description: string;
      readonly isoDate: string;
      readonly keywords: string;
    }
  | {
      readonly itemKind: "create-doc";
      readonly id: "create-article" | "create-outline";
      readonly docKind: "article" | "outline";
      readonly title: string;
    }
  | {
      readonly itemKind: "bind-ade";
      readonly id: "bind-ade";
      readonly query: string;
    };

export interface BlockRefTriggerItem {
  readonly id: string;
  readonly label: string;
  readonly display: string;
}

export type ActiveTriggerItem =
  | SlashCommandItem
  | MentionDocumentCandidate
  | MentionTriggerItem
  | BlockRefTriggerItem;

export interface TriggerCommandMenuProps {
  readonly editor: Editor;
  readonly triggerMatch: TriggerMatch;
  readonly items: readonly ActiveTriggerItem[];
  readonly selectedIdx: number;
  readonly creatingMentionDoc: boolean;
  readonly kindLabels: Readonly<Record<DocumentKind, string>>;
  readonly onSelectIndex: (index: number) => void;
  readonly onHoverIndex: (index: number) => void;
}

export function TriggerCommandMenu({
  editor,
  triggerMatch,
  items,
  selectedIdx,
  creatingMentionDoc,
  kindLabels,
  onSelectIndex,
  onHoverIndex,
}: TriggerCommandMenuProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const floatingRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ readonly x: number; readonly y: number } | null>(null);

  // Floating UI automatic viewport positioning & flip/shift
  useLayoutEffect(() => {
    const floatingEl = floatingRef.current;
    if (!floatingEl) return;

    const getReferenceRect = (): DOMRect => {
      try {
        const pos = Math.min(triggerMatch.rangeTo, editor.state.doc.content.size);
        const c = editor.view.coordsAtPos(pos);
        return new DOMRect(c.left, c.top, Math.max(1, c.right - c.left), Math.max(18, c.bottom - c.top));
      } catch {
        return new DOMRect(120, 120, 1, 18);
      }
    };

    const virtualEl = {
      getBoundingClientRect: getReferenceRect,
      contextElement: editor.view.dom,
    };

    const update = (): void => {
      void computePosition(virtualEl, floatingEl, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [
          offset(6),
          flip({ padding: 12 }),
          shift({ padding: 12 }),
        ],
      }).then(({ x, y }) => {
        setCoords({ x, y });
      });
    };

    update();
    return autoUpdate(virtualEl, floatingEl, update);
  }, [editor, triggerMatch.rangeFrom, triggerMatch.rangeTo]);

  // Keep active keyboard-selected item smoothly visible across list & sticky footer
  useEffect(() => {
    const activeEl = floatingRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const categoryLabels: Readonly<Record<SlashCommandCategory, string>> = {
    basic: t("editor.slashGroupBasic"),
    media: t("editor.slashGroupMedia"),
    layout: t("editor.slashGroupLayout"),
    knowledge: t("editor.slashGroupKnowledge"),
  };

  const clampedSelected = Math.min(selectedIdx, Math.max(0, items.length - 1));

  const indexedItems = items.map((item, idx) => ({ item, idx }));
  const isMentionMode = triggerMatch.kind === "mention";
  const scrollableMentionEntries = isMentionMode
    ? indexedItems.filter(({ item }) => {
        const m = item as MentionTriggerItem;
        return m.itemKind === "doc" || m.itemKind === "date";
      })
    : indexedItems;
  const stickyMentionActions = isMentionMode
    ? indexedItems.filter(({ item }) => {
        const m = item as MentionTriggerItem;
        return m.itemKind === "create-doc" || m.itemKind === "bind-ade";
      })
    : [];

  const renderMentionActionRow = ({
    mentionItem,
    idx,
  }: {
    mentionItem: Extract<MentionTriggerItem, { itemKind: "create-doc" | "bind-ade" }>;
    idx: number;
  }): React.ReactElement => {
    const active = idx === clampedSelected;
    const actionLabel =
      mentionItem.itemKind === "bind-ade"
        ? t("editor.mentionBindAde")
        : mentionItem.docKind === "article"
          ? t("editor.mentionCreateArticle")
          : t("editor.mentionCreateOutline");
    const actionDesc =
      mentionItem.itemKind === "bind-ade"
        ? t("editor.mentionBindAdeDesc")
        : mentionItem.docKind === "article"
          ? t("editor.mentionCreateArticleDesc", { title: mentionItem.title })
          : t("editor.mentionCreateOutlineDesc", { title: mentionItem.title });

    return (
      <button
        className={cn(
          "relative z-10 flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs transition-colors",
          active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
          creatingMentionDoc && "opacity-60",
        )}
        data-active={active ? "true" : undefined}
        data-highlighted={active ? "" : undefined}
        disabled={creatingMentionDoc}
        key={mentionItem.id}
        onClick={() => onSelectIndex(idx)}
        onMouseEnter={() => onHoverIndex(idx)}
        type="button"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-background">
          {creatingMentionDoc && mentionItem.itemKind === "create-doc" ? (
            <LoaderCircleIcon className="size-3.5 animate-spin text-primary" />
          ) : mentionItem.itemKind === "bind-ade" ? (
            <SparklesIcon className="size-3.5 text-primary" />
          ) : (
            <PlusIcon className="size-3.5 text-primary" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {creatingMentionDoc && mentionItem.itemKind === "create-doc"
              ? t("editor.mentionCreating")
              : actionLabel}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{actionDesc}</p>
        </div>
      </button>
    );
  };

  const content = (
    <div
      className="not-typeset fixed z-50 flex w-80 max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-[var(--border-overlay)] bg-popover text-popover-foreground shadow-[var(--shadow-overlay)]"
      data-slot="trigger-command-menu"
      data-testid="editor-trigger-menu"
      onMouseDown={(e) => e.preventDefault()}
      ref={floatingRef}
      style={
        coords
          ? { top: `${coords.y}px`, left: `${coords.x}px`, visibility: "visible" }
          : { top: "-9999px", left: "-9999px", visibility: "hidden" }
      }
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>
          {triggerMatch.kind === "slash"
            ? t("editor.slashMenuTitle")
            : triggerMatch.kind === "wikilink"
              ? t("editor.insertWikilink")
              : triggerMatch.kind === "mention"
                ? t("editor.mentionMenuTitle")
                : t("editor.blockRefTitle")}
        </span>
        {triggerMatch.query && (
          <span className="max-w-28 truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] normal-case text-foreground">
            {triggerMatch.query}
          </span>
        )}
      </div>

      {/* Scrollable Items List with V4.2/V4.3 GlideHighlight */}
      <div className="max-h-60 overflow-y-auto p-1 [scrollbar-gutter:stable]" ref={listRef}>
        {scrollableMentionEntries.length === 0 ? (
          <div className="px-2.5 py-4 text-center text-xs text-muted-foreground">
            {triggerMatch.kind === "slash"
              ? t("editor.slashNoResults")
              : triggerMatch.kind === "wikilink" || triggerMatch.kind === "mention"
                ? t("editor.noMatchingDocs")
                : t("editor.noMatchingBlockRefs")}
          </div>
        ) : (
          <GlideHighlight
            className="flex flex-col gap-0.5"
            highlightClassName="rounded-[var(--radius-menu-item)] bg-accent"
            mode="highlighted"
          >
            {scrollableMentionEntries.map(({ item, idx }, listPos) => {
              const active = idx === clampedSelected;

              if (triggerMatch.kind === "slash") {
                const cmd = item as SlashCommandItem;
                const prevCmd =
                  listPos > 0 ? (scrollableMentionEntries[listPos - 1]?.item as SlashCommandItem) : null;
                const showCategory = !prevCmd || prevCmd.category !== cmd.category;
                return (
                  <div className="flex flex-col gap-0.5" key={cmd.id}>
                    {showCategory && (
                      <div
                        className={cn(
                          "px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/85",
                          listPos > 0 && "mt-1 border-t border-border/50 pt-2",
                        )}
                      >
                        {categoryLabels[cmd.category]}
                      </div>
                    )}
                    <button
                      className={cn(
                        "relative z-10 flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs transition-colors",
                        active
                          ? "bg-accent text-accent-foreground in-data-[glide-visible=true]:bg-transparent"
                          : "hover:bg-accent/60 in-data-[glide-visible=true]:hover:bg-transparent",
                      )}
                      data-active={active ? "true" : undefined}
                      data-highlighted={active ? "" : undefined}
                      onClick={() => onSelectIndex(idx)}
                      onMouseEnter={() => onHoverIndex(idx)}
                      type="button"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-foreground/85">
                        {cmd.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{cmd.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {cmd.description}
                        </p>
                      </div>
                      {cmd.shortcut && (
                        <Kbd className="shrink-0 text-[10px]">{cmd.shortcut}</Kbd>
                      )}
                    </button>
                  </div>
                );
              }

              if (triggerMatch.kind === "wikilink") {
                const d = item as MentionDocumentCandidate;
                return (
                  <button
                    className={cn(
                      "relative z-10 flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs transition-colors",
                      active
                        ? "bg-accent text-accent-foreground in-data-[glide-visible=true]:bg-transparent"
                        : "hover:bg-accent/60 in-data-[glide-visible=true]:hover:bg-transparent",
                    )}
                    data-active={active ? "true" : undefined}
                    data-highlighted={active ? "" : undefined}
                    key={d.id}
                    onClick={() => onSelectIndex(idx)}
                    onMouseEnter={() => onHoverIndex(idx)}
                    type="button"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <DocumentKindIcon kind={d.kind} size="xs" />
                      <span className="truncate">{d.title}</span>
                    </span>
                    <Badge size="sm" variant="outline">
                      {kindLabels[d.kind]}
                    </Badge>
                  </button>
                );
              }

              if (triggerMatch.kind === "mention") {
                const mentionItem = item as MentionTriggerItem;
                if (mentionItem.itemKind === "date") {
                  return (
                    <button
                      className={cn(
                        "relative z-10 flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs transition-colors",
                        active
                          ? "bg-accent text-accent-foreground in-data-[glide-visible=true]:bg-transparent"
                          : "hover:bg-accent/60 in-data-[glide-visible=true]:hover:bg-transparent",
                      )}
                      data-active={active ? "true" : undefined}
                      data-highlighted={active ? "" : undefined}
                      key={`mention-date-${mentionItem.id}`}
                      onClick={() => onSelectIndex(idx)}
                      onMouseEnter={() => onHoverIndex(idx)}
                      type="button"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <CalendarDaysIcon className="size-3.5 shrink-0 text-primary" />
                        <span className="truncate font-medium">{mentionItem.label}</span>
                      </span>
                      <Badge className="shrink-0 font-mono text-[10px]" size="sm" variant="outline">
                        {mentionItem.isoDate}
                      </Badge>
                    </button>
                  );
                }
                if (mentionItem.itemKind === "doc") {
                  return (
                    <button
                      className={cn(
                        "relative z-10 flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs transition-colors",
                        active
                          ? "bg-accent text-accent-foreground in-data-[glide-visible=true]:bg-transparent"
                          : "hover:bg-accent/60 in-data-[glide-visible=true]:hover:bg-transparent",
                      )}
                      data-active={active ? "true" : undefined}
                      data-highlighted={active ? "" : undefined}
                      key={`mention-doc-${mentionItem.id}`}
                      onClick={() => onSelectIndex(idx)}
                      onMouseEnter={() => onHoverIndex(idx)}
                      type="button"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <DocumentKindIcon kind={mentionItem.docKind} size="xs" />
                        <span className="truncate">{mentionItem.title}</span>
                      </span>
                      <Badge size="sm" variant="outline">
                        {kindLabels[mentionItem.docKind]}
                      </Badge>
                    </button>
                  );
                }
                return null;
              }

              const refItem = item as BlockRefTriggerItem;
              return (
                <button
                  className={cn(
                    "relative z-10 flex cursor-pointer items-center gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs transition-colors",
                    active
                      ? "bg-accent text-accent-foreground in-data-[glide-visible=true]:bg-transparent"
                      : "hover:bg-accent/60 in-data-[glide-visible=true]:hover:bg-transparent",
                  )}
                  data-active={active ? "true" : undefined}
                  data-highlighted={active ? "" : undefined}
                  key={refItem.id}
                  onClick={() => onSelectIndex(idx)}
                  onMouseEnter={() => onHoverIndex(idx)}
                  type="button"
                >
                  <HashIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{refItem.display}</span>
                </button>
              );
            })}
          </GlideHighlight>
        )}
      </div>

      {isMentionMode && stickyMentionActions.length > 0 && (
        <div
          className="flex shrink-0 flex-col gap-0.5 border-t border-border/60 bg-popover p-1"
          data-slot="mention-quick-actions"
        >
          <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("editor.mentionQuickActionsLabel")}
          </div>
          {stickyMentionActions.map(({ item, idx }) =>
            renderMentionActionRow({
              mentionItem: item as Extract<MentionTriggerItem, { itemKind: "create-doc" | "bind-ade" }>,
              idx,
            }),
          )}
        </div>
      )}

      {/* Capacities / RemNote-style Keyboard Legend Footer */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 bg-muted/35 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Kbd className="text-[10px]">↑↓</Kbd>
          <span>{t("editor.slashLegendNavigate")}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd className="text-[10px]">↵</Kbd>
          <span>{t("editor.slashLegendSelect")}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd className="text-[10px]">Esc</Kbd>
          <span>{t("editor.slashLegendClose")}</span>
        </span>
      </div>
    </div>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
