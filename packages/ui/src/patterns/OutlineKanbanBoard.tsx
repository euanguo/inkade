"use client";

import {
  createOrderKeyBetween,
  parseQuickTaskSyntax,
  TASK_PRIORITIES,
  type AdeThreadBinding,
  type CreateOutlineNodeInput,
  type DocumentId,
  type MoveOutlineNodeInput,
  type OutlineNode,
  type OutlineNodeId,
  type TaskPriority,
  type UpdateOutlineNodeInput,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import type React from "react";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils.ts";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../primitives/segmented-control.tsx";
import { KanbanColumn } from "./kanban/KanbanColumn.tsx";
import {
  getTaskPriorityLabelKey,
  type KanbanColumnModel,
  type KanbanGroupMode,
  TASK_PRIORITY_STYLES,
} from "./kanban/task-styles.ts";
import { buildOutlineChildrenMap } from "./outline-helpers.ts";

export interface OutlineKanbanBoardProps {
  readonly documentId: DocumentId;
  readonly nodes: readonly OutlineNode[];
  readonly bindings?: readonly AdeThreadBinding[] | undefined;
  readonly currentDate?: string | undefined;
  readonly groupBy?: KanbanGroupMode | undefined;
  readonly onGroupByChange?: ((next: KanbanGroupMode) => void) | undefined;
  readonly renderCardScheduleTrigger?: ((node: OutlineNode) => React.ReactNode) | undefined;
  readonly onUpdateNode?: ((nodeId: OutlineNodeId, patch: UpdateOutlineNodeInput) => void) | undefined;
  readonly onMoveNode?: ((nodeId: OutlineNodeId, move: MoveOutlineNodeInput) => void) | undefined;
  readonly onCreateNode?: ((input: CreateOutlineNodeInput) => void) | undefined;
  readonly onDispatchToAde?: ((node: OutlineNode) => void) | undefined;
  readonly onFocusNode?: ((nodeId: OutlineNodeId) => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onMarkBindingRead?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onUnbindBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly readOnly?: boolean | undefined;
  readonly className?: string | undefined;
}

const ACTIVE_ADE_STATUSES = new Set(["queued", "running", "waiting_input"]);

export function OutlineKanbanBoard({
  documentId,
  nodes,
  bindings = [],
  currentDate,
  groupBy: groupByProp,
  onGroupByChange,
  renderCardScheduleTrigger,
  onUpdateNode,
  onMoveNode,
  onCreateNode,
  onDispatchToAde,
  onFocusNode,
  onOpenBinding,
  onMarkBindingRead,
  onUnbindBinding,
  readOnly = false,
  className,
}: OutlineKanbanBoardProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [uncontrolledGroupBy, setUncontrolledGroupBy] = useState<KanbanGroupMode>("status");
  const groupBy = groupByProp ?? uncontrolledGroupBy;
  const setGroupBy = (next: KanbanGroupMode): void => {
    if (groupByProp === undefined) {
      setUncontrolledGroupBy(next);
    }
    onGroupByChange?.(next);
  };

  const activeNodes = useMemo(
    () => nodes.filter((n) => n.deletedAt === null),
    [nodes],
  );
  const childrenMap = useMemo(() => buildOutlineChildrenMap(activeNodes), [activeNodes]);

  const bindingsByNode = useMemo(() => {
    const map = new Map<OutlineNodeId, AdeThreadBinding[]>();
    for (const b of bindings) {
      if (!b.nodeId) continue;
      const list = map.get(b.nodeId);
      if (list) list.push(b);
      else map.set(b.nodeId, [b]);
    }
    return map;
  }, [bindings]);

  const columns = useMemo<KanbanColumnModel[]>(() => {
    if (groupBy === "branch") {
      const roots = childrenMap.get(null) ?? [];
      return roots.map((root) => {
        const children = childrenMap.get(root.id) ?? [];
        return {
          id: `branch:${root.id}`,
          title: root.contentText || root.contentMarkdown || t("common.untitled"),
          count: children.length,
          accentClass: "bg-primary",
          cards: children,
          targetParentId: root.id,
        };
      });
    }

    if (groupBy === "priority") {
      const byPriority: Record<TaskPriority, OutlineNode[]> = {
        p1: [],
        p2: [],
        p3: [],
        p4: [],
        none: [],
      };
      for (const node of activeNodes) {
        const nodeBindings = bindingsByNode.get(node.id) ?? [];
        if (node.checked === null && nodeBindings.length === 0) continue;
        const p: TaskPriority = node.priority ?? "none";
        byPriority[p].push(node);
      }

      return TASK_PRIORITIES.map((priority) => {
        const cards = byPriority[priority];
        return {
          id: `priority:${priority}`,
          title: t(getTaskPriorityLabelKey(priority, false)),
          count: cards.length,
          accentClass: TASK_PRIORITY_STYLES[priority].dotClass,
          cards,
          targetParentId: null,
          targetChecked: false,
          targetPriority: priority,
        };
      });
    }

    const todoCards: OutlineNode[] = [];
    const inProgressCards: OutlineNode[] = [];
    const doneCards: OutlineNode[] = [];

    for (const node of activeNodes) {
      const nodeBindings = bindingsByNode.get(node.id) ?? [];
      const hasActiveAde = nodeBindings.some((b) => ACTIVE_ADE_STATUSES.has(b.status));

      if (node.checked === true) {
        doneCards.push(node);
      } else if (hasActiveAde) {
        inProgressCards.push(node);
      } else if (node.checked === false) {
        todoCards.push(node);
      }
    }

    return [
      {
        id: "status:todo",
        title: t("outline.kanbanColTodo"),
        count: todoCards.length,
        accentClass: "bg-amber-500",
        cards: todoCards,
        targetParentId: null,
        targetChecked: false,
      },
      {
        id: "status:in_progress",
        title: t("outline.kanbanColInProgress"),
        count: inProgressCards.length,
        accentClass: "bg-info",
        cards: inProgressCards,
        targetParentId: null,
        targetChecked: false,
      },
      {
        id: "status:done",
        title: t("outline.kanbanColDone"),
        count: doneCards.length,
        accentClass: "bg-success",
        cards: doneCards,
        targetParentId: null,
        targetChecked: true,
      },
    ];
  }, [activeNodes, bindingsByNode, childrenMap, groupBy, t]);

  const handleDropCard = (nodeId: OutlineNodeId, targetColumn: KanbanColumnModel): void => {
    if (readOnly) return;
    const node = activeNodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (groupBy === "branch") {
      if (node.id === targetColumn.targetParentId) return;
      const targetSiblings = (childrenMap.get(targetColumn.targetParentId) ?? []).filter(
        (n) => n.id !== nodeId,
      );
      const lastChild = targetSiblings[targetSiblings.length - 1] ?? null;
      const orderKey = createOrderKeyBetween(lastChild?.orderKey ?? null, null);
      onMoveNode?.(nodeId, {
        parentNodeId: targetColumn.targetParentId,
        afterNodeId: lastChild?.id ?? null,
        orderKey,
      });
      return;
    }

    if (groupBy === "priority" && targetColumn.targetPriority) {
      const currentPriority = node.priority ?? "none";
      if (currentPriority !== targetColumn.targetPriority) {
        onUpdateNode?.(nodeId, { priority: targetColumn.targetPriority });
      }
      return;
    }

    if (targetColumn.id === "status:done") {
      if (node.checked !== true) {
        onUpdateNode?.(nodeId, { checked: true });
      }
      return;
    }

    if (targetColumn.id === "status:todo") {
      if (node.checked !== false) {
        onUpdateNode?.(nodeId, { checked: false });
      }
      return;
    }

    if (targetColumn.id === "status:in_progress") {
      if (node.checked !== false) {
        onUpdateNode?.(nodeId, { checked: false });
      }
      const nodeBindings = bindingsByNode.get(nodeId) ?? [];
      if (nodeBindings.length === 0) {
        onDispatchToAde?.(node);
      }
    }
  };

  const handleQuickAdd = (column: KanbanColumnModel, text: string): void => {
    if (!onCreateNode || readOnly) return;
    const siblings = childrenMap.get(column.targetParentId) ?? [];
    const lastSibling = siblings[siblings.length - 1] ?? null;
    const parsed = parseQuickTaskSyntax(text);
    const effectivePriority =
      parsed.priority ??
      (groupBy === "priority" ? column.targetPriority : undefined);

    onCreateNode({
      documentId,
      parentNodeId: column.targetParentId,
      afterNodeId: lastSibling?.id ?? null,
      contentMarkdown: parsed.title,
      checked: groupBy === "status" ? (column.targetChecked ?? false) : false,
      collapsed: false,
      authorType: "human",
      ...(effectivePriority ? { priority: effectivePriority } : {}),
      ...(parsed.scheduledDate !== undefined
        ? { scheduledDate: parsed.scheduledDate }
        : currentDate
          ? { scheduledDate: currentDate }
          : {}),
      ...(parsed.scheduledSlot !== undefined ? { scheduledSlot: parsed.scheduledSlot } : {}),
      ...(parsed.durationMin !== undefined ? { durationMin: parsed.durationMin } : {}),
      ...(parsed.recurrenceRule !== undefined ? { recurrenceRule: parsed.recurrenceRule } : {}),
    });
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl size="sm">
          <SegmentedControlItem
            data-pressed={groupBy === "status" ? "" : undefined}
            onClick={() => setGroupBy("status")}
          >
            {t("outline.kanbanGroupByStatus")}
          </SegmentedControlItem>
          <SegmentedControlItem
            data-pressed={groupBy === "priority" ? "" : undefined}
            onClick={() => setGroupBy("priority")}
          >
            {t("tasks.boardGroupPriority")}
          </SegmentedControlItem>
          <SegmentedControlItem
            data-pressed={groupBy === "branch" ? "" : undefined}
            onClick={() => setGroupBy("branch")}
          >
            {t("outline.kanbanGroupByBranch")}
          </SegmentedControlItem>
        </SegmentedControl>
      </div>

      {groupBy === "branch" && columns.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          {t("outline.kanbanNoBranches")}
        </div>
      ) : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 sm:snap-none">
          {columns.map((column) => (
            <KanbanColumn
              bindingsByNode={bindingsByNode}
              childrenMap={childrenMap}
              column={column}
              currentDate={currentDate}
              key={column.id}
              onDispatchToAde={onDispatchToAde}
              onDropCard={handleDropCard}
              onFocusNode={onFocusNode}
              onMarkBindingRead={onMarkBindingRead}
              onOpenBinding={onOpenBinding}
              onQuickAdd={onCreateNode ? handleQuickAdd : undefined}
              onToggleTodo={(node) =>
                onUpdateNode?.(node.id, {
                  checked: node.checked === true ? false : true,
                })
              }
              onUnbindBinding={onUnbindBinding}
              readOnly={readOnly}
              renderCardScheduleTrigger={renderCardScheduleTrigger}
            />
          ))}
        </div>
      )}
    </div>
  );
}
