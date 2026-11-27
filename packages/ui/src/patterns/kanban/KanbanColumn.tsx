"use client";

import {
  asOutlineNodeId,
  type AdeThreadBinding,
  type OutlineNode,
  type OutlineNodeId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { PlusIcon } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import { Input } from "../../primitives/input.tsx";
import { KanbanCard } from "./KanbanCard.tsx";
import { bindPragmaticDropTarget } from "./pragmatic-dnd.ts";
import type { KanbanColumnModel } from "./task-styles.ts";

export interface KanbanColumnProps {
  readonly column: KanbanColumnModel;
  readonly bindingsByNode: ReadonlyMap<OutlineNodeId, readonly AdeThreadBinding[]>;
  readonly childrenMap: ReadonlyMap<OutlineNodeId | null, readonly OutlineNode[]>;
  readonly currentDate?: string | undefined;
  readonly renderCardScheduleTrigger?: ((node: OutlineNode) => React.ReactNode) | undefined;
  readonly readOnly: boolean;
  readonly onDropCard: (nodeId: OutlineNodeId, column: KanbanColumnModel) => void;
  readonly onToggleTodo: (node: OutlineNode) => void;
  readonly onQuickAdd?: ((column: KanbanColumnModel, text: string) => void) | undefined;
  readonly onDispatchToAde?: ((node: OutlineNode) => void) | undefined;
  readonly onFocusNode?: ((nodeId: OutlineNodeId) => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onMarkBindingRead?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onUnbindBinding?: ((binding: AdeThreadBinding) => void) | undefined;
}

export function KanbanColumn({
  column,
  bindingsByNode,
  childrenMap,
  currentDate,
  renderCardScheduleTrigger,
  readOnly,
  onDropCard,
  onToggleTodo,
  onQuickAdd,
  onDispatchToAde,
  onFocusNode,
  onOpenBinding,
  onMarkBindingRead,
  onUnbindBinding,
}: KanbanColumnProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const colRef = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [addingText, setAddingText] = useState("");

  useEffect(() => {
    const el = colRef.current;
    if (!el || readOnly) return;
    return bindPragmaticDropTarget({
      element: el,
      canDrop: ({ sourceData }) => sourceData["type"] === "inkade-kanban-card",
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: ({ sourceData }) => {
        setIsOver(false);
        const nodeId = sourceData["nodeId"];
        if (typeof nodeId === "string" && nodeId.trim().length > 0) {
          onDropCard(asOutlineNodeId(nodeId), column);
        }
      },
    });
  }, [column, onDropCard, readOnly]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = addingText.trim();
    if (!trimmed || !onQuickAdd) return;
    onQuickAdd(column, trimmed);
    setAddingText("");
  };

  return (
    <div
      className={cn(
        "flex min-h-[280px] w-[82vw] max-w-[320px] shrink-0 snap-center flex-1 flex-col gap-2.5 rounded-xl border border-transparent bg-muted/35 p-2.5 transition-colors sm:w-auto sm:min-w-[270px] sm:max-w-none",
        isOver && "border-primary/50 bg-primary/6",
      )}
      ref={colRef}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", column.accentClass)} />
          <h3 className="truncate text-sm font-semibold text-foreground">{column.title}</h3>
        </div>
        <Badge size="sm" variant="secondary">
          {column.count}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {column.cards.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed py-8 text-xs text-muted-foreground">
            {t("outline.kanbanEmptyColumn")}
          </div>
        ) : (
          column.cards.map((node) => (
            <KanbanCard
              bindings={bindingsByNode.get(node.id) ?? []}
              childCount={(childrenMap.get(node.id) ?? []).length}
              currentDate={currentDate}
              key={node.id}
              node={node}
              onDispatchToAde={onDispatchToAde ? () => onDispatchToAde(node) : undefined}
              onFocusNode={onFocusNode ? () => onFocusNode(node.id) : undefined}
              onMarkBindingRead={onMarkBindingRead}
              onOpenBinding={onOpenBinding}
              onToggleTodo={() => onToggleTodo(node)}
              onUnbindBinding={onUnbindBinding}
              readOnly={readOnly}
              renderScheduleTrigger={renderCardScheduleTrigger}
            />
          ))
        )}
      </div>

      {!readOnly && onQuickAdd && (
        <form className="flex items-center gap-1.5 pt-1" onSubmit={handleSubmit}>
          <Input
            onChange={(e) => setAddingText(e.target.value)}
            placeholder={t("outline.kanbanAddTodoPlaceholder")}
            size="sm"
            value={addingText}
          />
          <Button
            aria-label={t("outline.kanbanAddTodoButton")}
            disabled={!addingText.trim()}
            size="icon-sm"
            type="submit"
            variant="outline"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </form>
      )}
    </div>
  );
}
