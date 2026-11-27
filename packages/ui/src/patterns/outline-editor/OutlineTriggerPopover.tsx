"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { AtSignIcon, CalendarDaysIcon, HashIcon } from "lucide-react";
import type React from "react";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import type {
  ActiveTrigger,
  OutlineKindLabels,
  OutlineTriggerItem,
} from "./types.ts";

export interface OutlineTriggerPopoverProps {
  readonly activeTrigger: ActiveTrigger;
  readonly filteredTriggerItems: readonly OutlineTriggerItem[];
  readonly triggerIndex: number;
  readonly kindLabels: OutlineKindLabels;
  readonly floatingRef: React.RefObject<HTMLDivElement | null>;
  readonly coords: { readonly x: number; readonly y: number } | null;
  readonly onSelectIndex: (index: number) => void;
}

export function OutlineTriggerPopover({
  activeTrigger,
  filteredTriggerItems,
  triggerIndex,
  kindLabels,
  floatingRef,
  coords,
  onSelectIndex,
}: OutlineTriggerPopoverProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <div
      className="fixed z-50 max-h-72 w-72 overflow-y-auto rounded-lg border border-[var(--border-overlay)] bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-overlay)] [scrollbar-gutter:stable]"
      data-inkade-ui-overlay="true"
      ref={floatingRef}
      role="listbox"
      style={
        coords
          ? { left: `${coords.x}px`, top: `${coords.y}px`, visibility: "visible" }
          : { left: "-9999px", top: "-9999px", visibility: "hidden" }
      }
    >
      {filteredTriggerItems.length === 0 ? (
        <div className="px-2.5 py-2 text-xs text-muted-foreground">
          {activeTrigger.kind === "wikilink" || activeTrigger.kind === "at"
            ? t("outline.noMatchingDocs")
            : activeTrigger.kind === "blockref"
              ? t("outline.blockRefMenuEmpty")
              : activeTrigger.kind === "tag"
                ? t("outline.tagMenuEmpty", { tag: activeTrigger.query })
                : t("outline.noMatchingDocs")}
        </div>
      ) : (
        filteredTriggerItems.map((item, idx) => {
          const highlighted = idx === Math.min(triggerIndex, filteredTriggerItems.length - 1);
          if (item.type === "at-date") {
            return (
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                  highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
                )}
                key={item.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectIndex(idx);
                }}
                type="button"
              >
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <CalendarDaysIcon className="size-3.5 text-muted-foreground" />
                  <span>{item.label}</span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {item.isoDate}
                </span>
              </button>
            );
          }
          if (item.type === "at-ade") {
            return (
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                  highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
                )}
                key="at-ade"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectIndex(idx);
                }}
                type="button"
              >
                <AtSignIcon className="size-3.5 text-primary" />
                <span className="font-medium text-foreground">{t("editor.atBindAdeLabel")}</span>
              </button>
            );
          }
          if (item.type === "at-doc") {
            return (
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                  highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
                )}
                key={`at-${item.doc.id}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectIndex(idx);
                }}
                type="button"
              >
                <span className="truncate font-medium text-foreground">{item.doc.title}</span>
                <Badge size="sm" variant="outline">
                  {kindLabels[item.doc.kind]}
                </Badge>
              </button>
            );
          }
          if (item.type === "slash") {
            return (
              <button
                className={cn(
                  "flex w-full cursor-pointer items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                  highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
                )}
                key={item.cmd.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectIndex(idx);
                }}
                type="button"
              >
                <span className="mt-0.5 shrink-0 text-muted-foreground">{item.cmd.icon}</span>
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{item.cmd.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {item.cmd.description}
                  </span>
                </span>
              </button>
            );
          }
          if (item.type === "wikilink") {
            return (
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                  highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
                )}
                key={item.doc.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectIndex(idx);
                }}
                type="button"
              >
                <span className="truncate font-medium text-foreground">{item.doc.title}</span>
                <Badge size="sm" variant="outline">
                  {kindLabels[item.doc.kind]}
                </Badge>
              </button>
            );
          }
          if (item.type === "blockref") {
            return (
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                  highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
                )}
                key={item.node.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectIndex(idx);
                }}
                type="button"
              >
                <span className="truncate font-medium text-foreground">
                  {item.node.contentText || item.node.contentMarkdown || t("common.untitled")}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {item.node.id.slice(0, 10)}
                </span>
              </button>
            );
          }
          return (
            <button
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
              )}
              key={item.tag}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectIndex(idx);
              }}
              type="button"
            >
              <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-muted/70 px-1.5 py-0.5 text-xs font-medium text-foreground/85">
                <HashIcon className="size-3 text-muted-foreground" />
                {item.tag}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
