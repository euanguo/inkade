import type { OutlineNodeId } from "@inkade/core";
import {
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from "@inkade/ui";
import { CheckSquareIcon } from "lucide-react";
import type React from "react";
import { useRef } from "react";
import { DispatchAdeDialog } from "../components/DispatchAdeDialog.tsx";
import { TaskDetailDrawer } from "../components/TaskDetailDrawer.tsx";
import {
  dispatchOrOpenThreadDialog,
  openBindingInHostOrTab,
} from "../context.tsx";
import { TasksAgendaView } from "./TasksAgendaView.tsx";
import { TasksBoardView } from "./TasksBoardView.tsx";
import { TasksBulkActionBar } from "./tasks/TasksBulkActionBar.tsx";
import { TasksFilterBar } from "./tasks/TasksFilterBar.tsx";
import { TasksHeaderBar } from "./tasks/TasksHeaderBar.tsx";
import { TasksQuickAddBar } from "./tasks/TasksQuickAddBar.tsx";
import { TasksVirtualList } from "./tasks/TasksVirtualList.tsx";
import type {
  TaskGroupFilter,
  TaskSourceEngineFilter,
  TasksViewProps,
  TasksViewUrlState,
  TasksWorkspaceMode,
} from "./tasks/types.ts";
import { useTasksWorkspace } from "./tasks/useTasksWorkspace.ts";

export type {
  TaskGroupFilter,
  TaskSourceEngineFilter,
  TasksViewProps,
  TasksViewUrlState,
  TasksWorkspaceMode,
};

export function TasksView(props: TasksViewProps = {}): React.ReactElement {
  const scrollToNodeIdRef = useRef<((nodeId: OutlineNodeId) => void) | null>(null);
  const state = useTasksWorkspace({ ...props, scrollToNodeIdRef });
  const {
    t,
    hostActions,
    environment,
    isReadOnly,
    updatePreferences,
    canvasWidth,
    todayStr,
    tomorrowStr,
    viewMode,
    setViewMode,
    boardGroupBy,
    setBoardGroupBy,
    groupFilter,
    setGroupFilter,
    statusFilter,
    setStatusFilter,
    quickAddPreset,
    setQuickAddPreset,
    priorityFilter,
    setPriorityFilter,
    sourceEngineFilter,
    setSourceEngineFilter,
    spaceFilter,
    setSpaceFilter,
    tagFilter,
    setTagFilter,
    searchQuery,
    setSearchQuery,
    dispatchTarget,
    setDispatchTarget,
    quickAddExpanded,
    setQuickAddExpanded,
    filterPopoverOpen,
    setFilterPopoverOpen,
    selectedBatchIds,
    setSelectedBatchIds,
    detailItem,
    setDetailNodeId,
    clearBatchSelection,
    quickAddInputRef,
    quickAddForm,
    watchedQuickAddText,
    parsedQuickSyntax,
    hasQuickTokens,
    tasksQuery,
    spaces,
    spaceById,
    stats,
    kpiGroups,
    availableTags,
    filteredTasks,
    visibleOrderedTasks,
    selectedAllCompleted,
    selectedIdsArray,
    isWideMode,
    activeFilterCount,
    showQuickAddRow,
    handleJumpToContext,
    handleQuickAddSubmit,
    toggleTodoMutation,
    toggleSubtaskMutation,
    quickAddMutation,
    updateScheduleMutation,
    updateDetailMutation,
    batchUpdateMutation,
    markBindingReadMutation,
    deleteTaskMutation,
  } = state;

  return (
    <div className="flex w-full flex-col">
      <TasksHeaderBar
        canvasWidth={canvasWidth}
        groupFilter={groupFilter}
        isPending={tasksQuery.isPending}
        isReadOnly={isReadOnly}
        isWideMode={isWideMode}
        kpiGroups={kpiGroups}
        onGroupFilterChange={setGroupFilter}
        onToggleCanvasWidth={() =>
          updatePreferences({
            layout: {
              workspaceCanvasWidth: canvasWidth === "fluid" ? "centered" : "fluid",
            },
          })
        }
        onToggleQuickAdd={() =>
          setQuickAddExpanded((prev) => {
            const next = !prev;
            if (next) {
              window.setTimeout(() => quickAddInputRef.current?.focus(), 0);
            }
            return next;
          })
        }
        onViewModeChange={setViewMode}
        quickAddExpanded={quickAddExpanded}
        stats={stats}
        viewMode={viewMode}
      />

      <div
        className={cn(
          "flex w-full flex-col gap-2.5 px-4 py-3 lg:px-6",
          canvasWidth === "centered" && "mx-auto max-w-[960px]",
        )}
        data-testid="tasks-body-container"
      >
        {showQuickAddRow && (
          <TasksQuickAddBar
            form={quickAddForm}
            hasQuickTokens={hasQuickTokens}
            inputRef={quickAddInputRef}
            isPending={quickAddMutation.isPending}
            onPresetChange={setQuickAddPreset}
            onSubmit={(e) => void handleQuickAddSubmit(e)}
            parsedQuickSyntax={parsedQuickSyntax}
            quickAddPreset={quickAddPreset}
            watchedText={watchedQuickAddText}
          />
        )}

        <TasksFilterBar
          activeFilterCount={activeFilterCount}
          availableTags={availableTags}
          filterPopoverOpen={filterPopoverOpen}
          onFilterPopoverOpenChange={setFilterPopoverOpen}
          onPriorityFilterChange={setPriorityFilter}
          onSearchQueryChange={setSearchQuery}
          onSourceEngineFilterChange={setSourceEngineFilter}
          onSpaceFilterChange={setSpaceFilter}
          onStatusFilterChange={setStatusFilter}
          onTagFilterChange={setTagFilter}
          priorityFilter={priorityFilter}
          searchQuery={searchQuery}
          sourceEngineFilter={sourceEngineFilter}
          spaceFilter={spaceFilter}
          spaces={spaces}
          statusFilter={statusFilter}
          tagFilter={tagFilter}
        />

        {tasksQuery.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-2.5">
            {["w-3/4", "w-2/3", "w-4/5", "w-3/5"].map((wClass, idx) => (
              <div
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5"
                key={idx}
              >
                <div className="flex items-start gap-3">
                  <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className={`h-4 max-w-full ${wClass}`} />
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Skeleton className="h-5 w-20 rounded-md" />
                      <Skeleton className="h-5 w-24 rounded-full" />
                      <Skeleton className="h-4 w-14 rounded-full" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : viewMode === "board" ? (
          <TasksBoardView
            activeTagFilter={tagFilter || undefined}
            groupBy={boardGroupBy}
            onClickTag={(tag) => setTagFilter((prev) => (prev === tag ? "" : tag))}
            onDispatchAde={(item) =>
              dispatchOrOpenThreadDialog(
                hostActions,
                environment,
                {
                  documentId: item.document.id,
                  documentTitle: item.document.title,
                  nodeId: item.node.id,
                  excerpt: item.node.contentText || item.node.contentMarkdown,
                },
                setDispatchTarget,
              )
            }
            onGroupByChange={setBoardGroupBy}
            onJumpToContext={handleJumpToContext}
            onMarkBindingRead={(b) => markBindingReadMutation.mutate(b.id)}
            onOpenBinding={(b) => openBindingInHostOrTab(hostActions, environment, b)}
            onOpenDetail={(item) => setDetailNodeId(item.node.id)}
            onQuickAddToColumn={
              isReadOnly ? undefined : (opts) => quickAddMutation.mutate({ ...opts })
            }
            onToggleComplete={(item, nextChecked) =>
              toggleTodoMutation.mutate({ node: item.node, nextChecked })
            }
            onToggleSubtask={(subtaskId, nextChecked) =>
              toggleSubtaskMutation.mutate({ subtaskId, nextChecked })
            }
            onUpdateSchedule={async (item, patch) => {
              await updateScheduleMutation.mutateAsync({ item, patch });
            }}
            readonly={isReadOnly}
            schedulePendingNodeId={
              updateScheduleMutation.isPending
                ? updateScheduleMutation.variables?.item.node.id
                : null
            }
            spacesById={spaceById}
            tasks={filteredTasks}
            todayDate={todayStr}
          />
        ) : viewMode === "agenda" ? (
          <TasksAgendaView
            onJumpToContext={handleJumpToContext}
            onOpenDetail={(item) => setDetailNodeId(item.node.id)}
            onQuickAddToSlot={
              isReadOnly ? undefined : (opts) => quickAddMutation.mutate({ ...opts })
            }
            onToggleComplete={(item, nextChecked) =>
              toggleTodoMutation.mutate({ node: item.node, nextChecked })
            }
            onUpdateSchedule={async (item, patch) => {
              await updateScheduleMutation.mutateAsync({ item, patch });
            }}
            readonly={isReadOnly}
            schedulePendingNodeId={
              updateScheduleMutation.isPending
                ? updateScheduleMutation.variables?.item.node.id
                : null
            }
            spacesById={spaceById}
            tasks={filteredTasks}
            todayDate={todayStr}
          />
        ) : filteredTasks.length === 0 ? (
          <Empty className="rounded-xl border border-dashed py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckSquareIcon />
              </EmptyMedia>
              <EmptyTitle>{t("tasks.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("tasks.emptyDesc")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <TasksVirtualList scrollToNodeIdRef={scrollToNodeIdRef} state={state} />
        )}

        {!isReadOnly && selectedBatchIds.size > 0 && (
          <TasksBulkActionBar
            isPending={batchUpdateMutation.isPending}
            onBatchUpdate={(input) => batchUpdateMutation.mutate(input)}
            onClearSelection={clearBatchSelection}
            onSelectAllVisible={() =>
              setSelectedBatchIds(
                new Set(visibleOrderedTasks.map((item) => item.node.id)),
              )
            }
            selectedAllCompleted={selectedAllCompleted}
            selectedCount={selectedBatchIds.size}
            selectedIds={selectedIdsArray}
            todayStr={todayStr}
            tomorrowStr={tomorrowStr}
            visibleOrderedTasks={visibleOrderedTasks}
          />
        )}

        <DispatchAdeDialog
          onClose={() => setDispatchTarget(null)}
          target={dispatchTarget}
        />

        <TaskDetailDrawer
          deleting={deleteTaskMutation.isPending}
          item={detailItem}
          onDelete={async (item) => {
            await deleteTaskMutation.mutateAsync(item);
          }}
          onJumpToContext={handleJumpToContext}
          onOpenChange={(open) => {
            if (!open) setDetailNodeId(null);
          }}
          onSave={async (item, patch) => {
            await updateDetailMutation.mutateAsync({ item, patch });
          }}
          open={detailItem !== null}
          pending={updateDetailMutation.isPending}
          readonly={isReadOnly}
          space={detailItem ? spaceById.get(detailItem.document.spaceId) : undefined}
          todayDate={todayStr}
        />
      </div>
    </div>
  );
}
