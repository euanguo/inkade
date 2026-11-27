"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import {
  CalendarArrowUpIcon,
  CheckSquareIcon,
  CrosshairIcon,
  FileOutputIcon,
  Link2Icon,
  MessageSquarePlusIcon,
  RepeatIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import { Kbd } from "../../primitives/kbd.tsx";
import type { NodeActionMenuState, OutlineDeferTarget } from "./types.ts";

export interface OutlineNodeActionMenuProps {
  readonly nodeMenu: NodeActionMenuState;
  readonly floatingRef: React.RefObject<HTMLDivElement | null>;
  readonly coords: { readonly x: number; readonly y: number } | null;
  readonly hasDeferHandler: boolean;
  readonly hasMirrorHandler?: boolean | undefined;
  readonly tomorrowPreviewDate: string;
  readonly nextMondayPreviewDate: string;
  readonly onToggleTodo: (itemPos: number) => void;
  readonly onAddOrFocusNote: (itemPos: number) => void;
  readonly onDefer: (
    itemPos: number,
    target: OutlineDeferTarget,
    nodeId: string | null,
  ) => void;
  readonly onDispatchToAde: (itemPos: number, nodeId: string | null) => void;
  readonly onPromoteToArticle: (itemPos: number, nodeId: string | null) => void;
  readonly onCreateMirror?: ((itemPos: number, nodeId: string | null) => void) | undefined;
  readonly onCopyBlockLink?: ((itemPos: number, nodeId: string | null) => void) | undefined;
  readonly onZoomIntoNode: (itemPos: number, nodeId: string | null) => void;
  readonly onDeleteNode: (
    itemPos: number,
    nodeId: string | null,
    sourceBindingId: string | null,
  ) => void;
  readonly onClose: () => void;
}

export function OutlineNodeActionMenu({
  nodeMenu,
  floatingRef,
  coords,
  hasDeferHandler,
  hasMirrorHandler = false,
  tomorrowPreviewDate,
  nextMondayPreviewDate,
  onToggleTodo,
  onAddOrFocusNote,
  onDefer,
  onDispatchToAde,
  onPromoteToArticle,
  onCreateMirror,
  onCopyBlockLink,
  onZoomIntoNode,
  onDeleteNode,
  onClose,
}: OutlineNodeActionMenuProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <div
      className="fixed z-50 w-60 rounded-lg border border-[var(--border-overlay)] bg-popover p-1 text-popover-foreground shadow-[var(--shadow-overlay)]"
      data-inkade-node-menu="true"
      data-inkade-ui-overlay="true"
      ref={floatingRef}
      role="menu"
      style={
        coords
          ? { left: `${coords.x}px`, top: `${coords.y}px`, visibility: "visible" }
          : { left: "-9999px", top: "-9999px", visibility: "hidden" }
      }
    >
      <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
        {t("outline.nodeActionsTitle")}
      </div>

      <button
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
        onClick={() => {
          const target = nodeMenu;
          onClose();
          onToggleTodo(target.itemPos);
        }}
        role="menuitem"
        type="button"
      >
        <span className="flex items-center gap-2">
          <CheckSquareIcon className="size-3.5 text-muted-foreground" />
          <span>{t("outline.toggleTodo")}</span>
        </span>
        <Kbd className="text-[10px]">⌘↵</Kbd>
      </button>

      <button
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
        onClick={() => {
          const target = nodeMenu;
          onClose();
          onAddOrFocusNote(target.itemPos);
        }}
        role="menuitem"
        type="button"
      >
        <span className="flex items-center gap-2">
          <MessageSquarePlusIcon className="size-3.5 text-muted-foreground" />
          <span>{t("outline.addNote")}</span>
        </span>
        <Kbd className="text-[10px]">⇧↵</Kbd>
      </button>

      {hasDeferHandler && (
        <>
          <div aria-hidden="true" className="my-1 h-px bg-border/70" />
          <div className="px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {t("outline.deferMenuTitle")}
          </div>
          <button
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
            onClick={() => {
              const target = nodeMenu;
              onClose();
              onDefer(target.itemPos, "tomorrow", target.nodeId);
            }}
            role="menuitem"
            type="button"
          >
            <span className="flex items-center gap-2">
              <CalendarArrowUpIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
              <span>{t("outline.deferTomorrow")}</span>
            </span>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {tomorrowPreviewDate}
            </span>
          </button>
          <button
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
            onClick={() => {
              const target = nodeMenu;
              onClose();
              onDefer(target.itemPos, "next_monday", target.nodeId);
            }}
            role="menuitem"
            type="button"
          >
            <span className="flex items-center gap-2">
              <CalendarArrowUpIcon className="size-3.5 text-primary" />
              <span>{t("outline.deferNextMonday")}</span>
            </span>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {nextMondayPreviewDate}
            </span>
          </button>
        </>
      )}

      <div aria-hidden="true" className="my-1 h-px bg-border/70" />

      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
        onClick={() => {
          const target = nodeMenu;
          onClose();
          onDispatchToAde(target.itemPos, target.nodeId);
        }}
        role="menuitem"
        type="button"
      >
        <SendIcon className="size-3.5 text-muted-foreground" />
        <span>{t("outline.dispatchNode")}</span>
      </button>

      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
        onClick={() => {
          const target = nodeMenu;
          onClose();
          onPromoteToArticle(target.itemPos, target.nodeId);
        }}
        role="menuitem"
        type="button"
      >
        <FileOutputIcon className="size-3.5 text-muted-foreground" />
        <span>{t("outline.promoteToArticle")}</span>
      </button>

      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
        onClick={() => {
          const target = nodeMenu;
          onClose();
          onZoomIntoNode(target.itemPos, target.nodeId);
        }}
        role="menuitem"
        type="button"
      >
        <CrosshairIcon className="size-3.5 text-muted-foreground" />
        <span>{t("outline.zoomIntoNode")}</span>
      </button>

      {hasMirrorHandler && onCreateMirror && (
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
          onClick={() => {
            const target = nodeMenu;
            onClose();
            onCreateMirror(target.itemPos, target.nodeId);
          }}
          role="menuitem"
          type="button"
        >
          <RepeatIcon className="size-3.5 text-teal-600 dark:text-teal-400" />
          <span>{t("mirrorNode.createMirrorAction")}</span>
        </button>
      )}

      {onCopyBlockLink && (
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
          onClick={() => {
            const target = nodeMenu;
            onClose();
            onCopyBlockLink(target.itemPos, target.nodeId);
          }}
          role="menuitem"
          type="button"
        >
          <Link2Icon className="size-3.5 text-muted-foreground" />
          <span>{t("mirrorNode.copyBlockLinkAction")}</span>
        </button>
      )}

      <div aria-hidden="true" className="my-1 h-px bg-border/70" />

      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/12"
        onClick={() => {
          const target = nodeMenu;
          onClose();
          onDeleteNode(target.itemPos, target.nodeId, target.sourceBindingId);
        }}
        role="menuitem"
        type="button"
      >
        <Trash2Icon className="size-3.5" />
        <span>{t("outline.deleteNode")}</span>
      </button>
    </div>
  );
}
