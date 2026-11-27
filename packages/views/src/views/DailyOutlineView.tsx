import {
  Button,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  OutlineKanbanBoard,
  ProseMirrorOutlineEditor,
  ScrollArea,
  Skeleton,
} from "@inkade/ui";
import { CalendarDaysIcon } from "lucide-react";
import type React from "react";
import { DispatchAdeDialog } from "../components/DispatchAdeDialog.tsx";
import { PromoteNodeDialog } from "../components/PromoteNodeDialog.tsx";
import { TaskSchedulePopover } from "../components/TaskSchedulePopover.tsx";
import { OutlineTreeSkeleton } from "../components/ViewSkeletons.tsx";
import { DailyAgentAndStreamSection } from "./daily/DailyAgentAndStreamSection.tsx";
import { DailyFocusRail } from "./daily/DailyFocusRail.tsx";
import { DailyFocusTasksList } from "./daily/DailyFocusTasksList.tsx";
import { DailyHeaderBar } from "./daily/DailyHeaderBar.tsx";
import {
  DailyQuietTriageStrip,
  DailyTemplateOfferBanner,
  DailyTodayTodosStrip,
} from "./daily/DailyWorkspaceStrips.tsx";
import type {
  DailyOutlineViewProps,
  DailyViewMode,
  DailyViewUrlState,
} from "./daily/types.ts";
import { useDailyWorkspace } from "./daily/useDailyWorkspace.ts";

export type { DailyOutlineViewProps, DailyViewMode, DailyViewUrlState };

export function DailyOutlineView(props: DailyOutlineViewProps = {}): React.ReactElement {
  const state = useDailyWorkspace(props);
  const {
    t,
    navigation,
    isReadOnly,
    isCompact,
    activeDate,
    todayStr,
    canvasWidth,
    readerMeasure,
    viewMode,
    setViewMode,
    kanbanGroupBy,
    setKanbanGroupBy,
    focusRailOpen,
    focusRootId,
    setFocusRootId,
    highlightedNodeId,
    dispatchTarget,
    setDispatchTarget,
    promoteTarget,
    setPromoteTarget,
    dailyQuery,
    allDocsQuery,
    bindingsQuery,
    dailyDoc,
    nodes,
    spaces,
    workspaceTags,
    rolloverDocDatesById,
    rolloverTodos,
    dismissRollover,
    goDate,
    openDispatch,
    openBindingTarget,
    handleOpenDocument,
    handleClickTag,
    handleBatchCollapseChange,
    handleBatchMutate,
    handleDeferNode,
    createNodeMutation,
    updateNodeMutation,
    moveNodeMutation,
    deleteNodeMutation,
    rolloverAllMutation,
    rolloverSelectedMutation,
    markBindingReadMutation,
    unbindMutation,
    updateTaskScheduleMutation,
  } = state;

  return (
    <div className="flex w-full flex-col">
      <DailyHeaderBar state={state} />

      <div
        className={cn(
          "flex w-full flex-col",
          isCompact ? "gap-2.5 px-3 py-2.5 pb-6 md:pb-2.5" : "gap-3 px-4 py-3 pb-6 md:pb-3 lg:px-6",
          viewMode === "kanban"
            ? canvasWidth === "centered" && "mx-auto max-w-[960px]"
            : readerMeasure === "full"
              ? "max-w-none"
              : focusRailOpen
                ? "mx-auto max-w-[1160px]"
                : "mx-auto max-w-[820px]",
        )}
        data-testid="daily-body-container"
      >
        <DailyTemplateOfferBanner state={state} />

        <div className="flex flex-col items-start gap-6 lg:flex-row">
          <div className="flex min-w-0 w-full flex-1 flex-col gap-3.5">
            <DailyQuietTriageStrip state={state} />
            <DailyTodayTodosStrip state={state} />

            {dailyQuery.isPending ? (
              viewMode === "kanban" ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {[0, 1, 2].map((col) => (
                    <div
                      className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3"
                      key={col}
                    >
                      <div className="flex items-center justify-between border-b border-border/60 pb-2">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-4 w-6 rounded-full" />
                      </div>
                      <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background p-2.5">
                        <Skeleton className="h-3.5 w-4/5" />
                        <Skeleton className="h-3 w-16 rounded-full" />
                      </div>
                      <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background p-2.5">
                        <Skeleton className="h-3.5 w-2/3" />
                        <Skeleton className="h-3 w-12 rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : viewMode === "tasks" ? (
                <div
                  className={cn(
                    "mx-auto flex w-full flex-col divide-y divide-border/70 rounded-lg border border-border bg-background",
                    readerMeasure === "full" ? "max-w-none" : "max-w-[740px]",
                  )}
                >
                  {["w-3/4", "w-2/3", "w-4/5", "w-1/2", "w-5/6"].map((wClass, idx) => (
                    <div className="flex items-start gap-3 px-3.5 py-2.5" key={idx}>
                      <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Skeleton className={`h-4 ${wClass}`} />
                        <Skeleton className="h-3 w-28" />
                      </div>
                      <Skeleton className="size-6 shrink-0 rounded-md" />
                    </div>
                  ))}
                </div>
              ) : (
                <OutlineTreeSkeleton rows={7} showToolbar />
              )
            ) : dailyQuery.isError || !dailyDoc ? (
              <Empty className="rounded-lg border border-dashed py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CalendarDaysIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t("daily.loadFailedTitle", { date: activeDate })}</EmptyTitle>
                  <EmptyDescription>
                    {dailyQuery.error instanceof Error
                      ? dailyQuery.error.message
                      : t("daily.loadFailedFallback")}
                  </EmptyDescription>
                </EmptyHeader>
                <Button onClick={() => void dailyQuery.refetch()} size="sm" variant="outline">
                  {t("common.retry")}
                </Button>
              </Empty>
            ) : (
              <div
                className={cn(
                  "flex flex-col gap-4 transition-opacity duration-[var(--duration-quick)]",
                  dailyQuery.isPlaceholderData && "pointer-events-none opacity-70",
                )}
              >
                <ScrollArea
                  className="w-full [&_[data-slot=scroll-area-viewport]]:max-h-[min(78vh,880px)]"
                  opticalFade
                  opticalFadeTone="background"
                >
                  {viewMode === "kanban" ? (
                    <OutlineKanbanBoard
                      bindings={bindingsQuery.data ?? []}
                      currentDate={activeDate}
                      documentId={dailyDoc.id}
                      groupBy={kanbanGroupBy}
                      nodes={nodes}
                      onCreateNode={(input) => createNodeMutation.mutate(input)}
                      onDispatchToAde={(node) =>
                        openDispatch({
                          documentId: dailyDoc.id,
                          documentTitle: dailyDoc.title,
                          nodeId: node.id,
                          excerpt: node.contentText || node.contentMarkdown,
                        })
                      }
                      onFocusNode={(nodeId) => {
                        setFocusRootId(nodeId);
                        setViewMode("outline");
                      }}
                      onGroupByChange={setKanbanGroupBy}
                      onMarkBindingRead={(binding) => markBindingReadMutation.mutate(binding.id)}
                      onMoveNode={(nodeId, move) => moveNodeMutation.mutate({ nodeId, move })}
                      onOpenBinding={openBindingTarget}
                      onUnbindBinding={(binding) => unbindMutation.mutate(binding.id)}
                      onUpdateNode={(nodeId, patch) => updateNodeMutation.mutate({ nodeId, patch })}
                      renderCardScheduleTrigger={(node) => {
                        if (isReadOnly || node.checked === true) return null;
                        return (
                          <TaskSchedulePopover
                            compact
                            onUpdate={(patch) =>
                              updateTaskScheduleMutation.mutate({
                                nodeId: node.id,
                                patch,
                              })
                            }
                            pending={
                              updateTaskScheduleMutation.isPending &&
                              updateTaskScheduleMutation.variables?.nodeId === node.id
                            }
                            todayDate={todayStr}
                            value={{
                              scheduledDate: node.scheduledDate ?? activeDate,
                              scheduledSlot: node.scheduledSlot ?? null,
                              durationMin: node.durationMin ?? null,
                              priority: node.priority ?? null,
                              recurrenceRule: node.recurrenceRule ?? null,
                              dueDate: node.dueDate ?? null,
                            }}
                          />
                        );
                      }}
                    />
                  ) : viewMode === "tasks" ? (
                    <DailyFocusTasksList state={state} />
                  ) : (
                    <ProseMirrorOutlineEditor
                      bindings={bindingsQuery.data ?? []}
                      deferBaseDate={activeDate}
                      documentId={dailyDoc.id}
                      highlightedNodeId={highlightedNodeId}
                      initialFocusRootId={focusRootId}
                      nodes={nodes}
                      onBatchCollapseChange={(collapsed, ids) =>
                        void handleBatchCollapseChange(collapsed, ids)
                      }
                      onBatchMutate={handleBatchMutate}
                      onClickTag={handleClickTag}
                      onCreateNode={(input) => createNodeMutation.mutate(input)}
                      onDeferNode={(node, target) =>
                        handleDeferNode(dailyDoc.id, activeDate, nodes, node, target)
                      }
                      onDeleteNode={(nodeId) => deleteNodeMutation.mutate(nodeId)}
                      onDismissRollover={dismissRollover}
                      onDispatchToAde={(node) =>
                        openDispatch({
                          documentId: dailyDoc.id,
                          documentTitle: dailyDoc.title,
                          nodeId: node.id,
                          excerpt: node.contentText || node.contentMarkdown,
                        })
                      }
                      onFocusRootChange={setFocusRootId}
                      onMarkBindingRead={(binding) => markBindingReadMutation.mutate(binding.id)}
                      onMoveNode={(nodeId, move) => moveNodeMutation.mutate({ nodeId, move })}
                      onOpenBinding={openBindingTarget}
                      onOpenDate={goDate}
                      onOpenDocument={handleOpenDocument}
                      onPromoteToArticle={(rootNode, subtree) =>
                        setPromoteTarget({
                          documentId: dailyDoc.id,
                          rootNode,
                          subtree,
                        })
                      }
                      onRolloverAll={() => rolloverAllMutation.mutate()}
                      onRolloverSelected={(ids) => rolloverSelectedMutation.mutate(ids)}
                      onUnbindBinding={(binding) => unbindMutation.mutate(binding.id)}
                      onUpdateNode={(nodeId, patch) => updateNodeMutation.mutate({ nodeId, patch })}
                      readOnly={isReadOnly || dailyQuery.isPlaceholderData}
                      rolloverDocDatesById={rolloverDocDatesById}
                      rolloverTodos={rolloverTodos}
                      rootTitle={activeDate}
                      workspaceDocs={allDocsQuery.data ?? []}
                      workspaceTags={workspaceTags}
                    />
                  )}
                </ScrollArea>

                <DailyAgentAndStreamSection state={state} />
              </div>
            )}
          </div>

          <DailyFocusRail state={state} />
        </div>
      </div>

      <DispatchAdeDialog onClose={() => setDispatchTarget(null)} target={dispatchTarget} />

      <PromoteNodeDialog
        onClose={() => setPromoteTarget(null)}
        onPromoted={(article) => {
          navigation.openDocument(article.id);
        }}
        spaces={spaces}
        target={promoteTarget}
      />
    </div>
  );
}
