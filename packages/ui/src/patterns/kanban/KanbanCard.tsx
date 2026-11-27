"use client";

import {
  extractInlineTags,
  type AdeThreadBinding,
  type OutlineNode,
  type TaskPriority,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  BotIcon,
  CalendarDaysIcon,
  ClockIcon,
  CrosshairIcon,
  FlagIcon,
  GripVerticalIcon,
  MoonIcon,
  RepeatIcon,
  SendIcon,
  SunIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import { Checkbox } from "../../primitives/checkbox.tsx";
import { TagPill } from "../../primitives/tag-pill.tsx";
import { AdeThreadChip } from "../AdeThreadChip.tsx";
import { bindPragmaticDraggable } from "./pragmatic-dnd.ts";
import {
  formatTaskDurationLabel,
  getTaskPriorityLabelKey,
  getTaskRecurrenceLabelKey,
  getTaskSlotLabelKey,
  TASK_PRIORITY_STYLES,
} from "./task-styles.ts";

export interface KanbanCardProps {
  readonly node: OutlineNode;
  readonly bindings: readonly AdeThreadBinding[];
  readonly childCount: number;
  readonly currentDate?: string | undefined;
  readonly renderScheduleTrigger?: ((node: OutlineNode) => React.ReactNode) | undefined;
  readonly readOnly: boolean;
  readonly onToggleTodo: () => void;
  readonly onDispatchToAde?: (() => void) | undefined;
  readonly onFocusNode?: (() => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onMarkBindingRead?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onUnbindBinding?: ((binding: AdeThreadBinding) => void) | undefined;
}

export function KanbanCard({
  node,
  bindings,
  childCount,
  currentDate,
  renderScheduleTrigger,
  readOnly,
  onToggleTodo,
  onDispatchToAde,
  onFocusNode,
  onOpenBinding,
  onMarkBindingRead,
  onUnbindBinding,
}: KanbanCardProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const inlineTags = useMemo(
    () => extractInlineTags(node.contentMarkdown).slice(0, 3),
    [node.contentMarkdown],
  );

  useEffect(() => {
    const el = cardRef.current;
    if (!el || readOnly) return;
    return bindPragmaticDraggable({
      element: el,
      getInitialData: () => ({ type: "inkade-kanban-card", nodeId: node.id }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [node.id, readOnly]);

  const effectivePriority: TaskPriority = node.priority ?? "none";
  const priorityStyle = TASK_PRIORITY_STYLES[effectivePriority];
  const effectiveSlot = node.scheduledSlot ?? null;
  const effectiveDuration = node.durationMin ?? null;
  const hasScheduleDateBadge =
    node.scheduledDate !== undefined &&
    node.scheduledDate !== null &&
    node.scheduledDate !== currentDate;
  const scheduleNodeTrigger = renderScheduleTrigger?.(node);

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground transition-[transform,opacity,border-color] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] hover:border-foreground/20",
        dragging && "border-primary/60 opacity-45",
        !readOnly && "cursor-grab active:cursor-grabbing",
      )}
      ref={cardRef}
    >
      {effectivePriority !== "none" && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-1.5 left-0 w-[3px] rounded-r-full",
            priorityStyle.barClass,
          )}
        />
      )}

      <div
        className={cn(
          "flex flex-col gap-1.5 py-2.5 pr-3",
          effectivePriority !== "none" ? "pl-3.5" : "pl-3",
        )}
      >
        <div className="flex items-start gap-2">
          {!readOnly && (
            <GripVerticalIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/45 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
          {node.checked !== null && (
            <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={node.checked}
                disabled={readOnly}
                onCheckedChange={onToggleTodo}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "break-words text-sm leading-snug text-foreground",
                node.checked === true && "text-muted-foreground line-through",
              )}
            >
              {node.contentText || node.contentMarkdown || t("common.untitled")}
            </p>
            {node.noteMarkdown && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {node.noteText || node.noteMarkdown}
              </p>
            )}
          </div>
        </div>

        {(effectivePriority !== "none" ||
          hasScheduleDateBadge ||
          (effectiveSlot && effectiveSlot !== "today") ||
          effectiveDuration !== null ||
          node.recurrenceRule ||
          inlineTags.length > 0 ||
          node.authorType === "agent" ||
          childCount > 0 ||
          bindings.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {effectivePriority !== "none" && (
              <span
                className={cn(
                  "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold",
                  priorityStyle.pillClass,
                )}
              >
                <FlagIcon className="size-2.5" />
                <span>{t(getTaskPriorityLabelKey(effectivePriority, true))}</span>
              </span>
            )}
            {hasScheduleDateBadge && node.scheduledDate && (
              <Badge size="sm" variant="outline">
                <CalendarDaysIcon className="size-3" />
                <span className="font-mono">{node.scheduledDate}</span>
              </Badge>
            )}
            {effectiveSlot && effectiveSlot !== "today" && (
              <Badge size="sm" variant="secondary">
                {effectiveSlot === "morning" ? (
                  <SunIcon className="size-3 text-amber-500" />
                ) : effectiveSlot === "evening" ? (
                  <MoonIcon className="size-3 text-indigo-500" />
                ) : (
                  <ClockIcon className="size-3 text-sky-500" />
                )}
                <span>{t(getTaskSlotLabelKey(effectiveSlot))}</span>
              </Badge>
            )}
            {effectiveDuration !== null && effectiveDuration > 0 && (
              <Badge className="font-mono tabular-nums" size="sm" variant="outline">
                <ClockIcon className="size-3" />
                <span>{formatTaskDurationLabel(effectiveDuration, t)}</span>
              </Badge>
            )}
            {node.recurrenceRule && (
              <Badge size="sm" variant="outline">
                <RepeatIcon className="size-3" />
                <span>{t(getTaskRecurrenceLabelKey(node.recurrenceRule))}</span>
              </Badge>
            )}
            {node.authorType === "agent" && (
              <Badge size="sm" variant="info">
                <BotIcon className="size-3" />
                {t("common.actorAgent")}
              </Badge>
            )}
            {childCount > 0 && (
              <Badge size="sm" variant="outline">
                +{childCount}
              </Badge>
            )}
            {inlineTags.map((tag) => (
              <TagPill key={tag} size="sm" tag={tag} />
            ))}
            {bindings.map((binding) => (
              <AdeThreadChip
                binding={binding}
                compact
                key={binding.id}
                onMarkRead={onMarkBindingRead}
                onOpenInAde={onOpenBinding}
                onUnbind={onUnbindBinding}
              />
            ))}
          </div>
        )}
      </div>

      {(scheduleNodeTrigger || onDispatchToAde || onFocusNode) && (
        <div
          className="flex flex-wrap items-center justify-end gap-1 border-t border-border/60 px-3 py-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {scheduleNodeTrigger}
          {onFocusNode && (
            <Button
              aria-label={t("outline.kanbanFocusInOutline")}
              onClick={onFocusNode}
              size="xs"
              variant="ghost"
            >
              <CrosshairIcon className="size-3" />
              {t("outline.kanbanFocusInOutline")}
            </Button>
          )}
          {!readOnly && onDispatchToAde && (
            <Button
              aria-label={t("outline.dispatchNode")}
              onClick={onDispatchToAde}
              size="xs"
              variant="ghost"
            >
              <SendIcon className="size-3" />
              {t("outline.dispatchNode")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
