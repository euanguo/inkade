import { zodResolver } from "@hookform/resolvers/zod";
import {
  extractInlineTags,
  type OutlineNode,
  type OutlineNodeId,
  parseQuickTaskSyntax,
  slotForScheduledStartMin,
  type SpaceId,
  type BatchUpdateTasksInput,
  type TaskPriority,
  type ThreadBindingId,
  type UpdateTaskInput,
  type WorkspaceTaskItem,
} from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import { useInkadeClient } from "@inkade/sdk/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { stripTrailingHashTags } from "../../components/TaskItemCard.tsx";
import type { TaskSchedulePatch } from "../../components/TaskSchedulePopover.tsx";
import { useInkadeViewsContext } from "../../context.tsx";
import type { QuickAddPreset } from "./types.ts";

export interface UseTasksMutationsOptions {
  readonly t: ReturnType<typeof useInkadeTranslation>["t"];
  readonly isReadOnly: boolean;
  readonly todayStr: string;
  readonly tomorrowStr: string;
  readonly quickAddPreset: QuickAddPreset;
  readonly spaceFilter: SpaceId | "__all__";
  readonly onCreatedNode: (node: OutlineNode) => void;
  readonly onClearBatchSelection: () => void;
}

export function useTasksMutations({
  t,
  isReadOnly,
  todayStr,
  tomorrowStr,
  quickAddPreset,
  spaceFilter,
  onCreatedNode,
  onClearBatchSelection,
}: UseTasksMutationsOptions) {
  const client = useInkadeClient();
  const { notifier } = useInkadeViewsContext();
  const queryClient = useQueryClient();

  const quickAddSchema = useMemo(
    () =>
      z.object({
        text: z.string().trim().min(1, t("validation.required")),
      }),
    [t],
  );
  const quickAddForm = useForm<{ text: string }>({
    resolver: zodResolver(quickAddSchema),
    defaultValues: { text: "" },
  });
  const watchedQuickAddText = useWatch({ control: quickAddForm.control, name: "text" });
  const [whenOpenNodeId, setWhenOpenNodeId] = useState<OutlineNodeId | null>(null);
  const [recentlyCompletedIds, setRecentlyCompletedIds] = useState<ReadonlySet<OutlineNodeId>>(
    () => new Set(),
  );
  const completionTimersRef = useRef<Map<OutlineNodeId, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = completionTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const parsedQuickSyntax = useMemo(
    () => parseQuickTaskSyntax(watchedQuickAddText),
    [watchedQuickAddText],
  );

  const hasQuickTokens = Boolean(
    watchedQuickAddText.trim() &&
      (parsedQuickSyntax.priority !== undefined ||
        parsedQuickSyntax.scheduledDate !== undefined ||
        parsedQuickSyntax.scheduledStartMin !== undefined ||
        parsedQuickSyntax.scheduledSlot !== undefined ||
        parsedQuickSyntax.durationMin !== undefined ||
        parsedQuickSyntax.dueDate !== undefined ||
        parsedQuickSyntax.recurrenceRule !== undefined),
  );

  const invalidateTasksQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
    void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
    void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] });
    void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
  }, [queryClient]);

  const toggleTodoMutation = useMutation({
    mutationFn: (vars: {
      readonly node: OutlineNode;
      readonly nextChecked: boolean;
      readonly skipUndo?: boolean;
    }) => client.tasks.update(vars.node.id, { checked: vars.nextChecked }),
    onSuccess: (res, vars) => {
      const nodeId = vars.node.id;
      const prevTimer = completionTimersRef.current.get(nodeId);
      if (prevTimer) {
        clearTimeout(prevTimer);
        completionTimersRef.current.delete(nodeId);
      }

      if (vars.nextChecked) {
        setRecentlyCompletedIds((prev) => new Set(prev).add(nodeId));
        const timer = setTimeout(() => {
          setRecentlyCompletedIds((prev) => {
            if (!prev.has(nodeId)) return prev;
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
          completionTimersRef.current.delete(nodeId);
        }, 1200);
        completionTimersRef.current.set(nodeId, timer);

        if (!vars.skipUndo) {
          const rawTitle =
            vars.node.contentText || vars.node.contentMarkdown || t("common.untitled");
          const cleanToastTitle = stripTrailingHashTags(
            rawTitle,
            extractInlineTags(vars.node.contentMarkdown),
          );
          const toastTitle = res.spawnedNextNode
            ? t("tasks.recurringSpawnedToast", {
                title: cleanToastTitle,
                date: res.spawnedNextNode.scheduledDate ?? todayStr,
              })
            : t("tasks.completedUndoToast", { title: cleanToastTitle });
          if (notifier.withUndo) {
            notifier.withUndo({
              title: toastTitle,
              onUndo: () =>
                toggleTodoMutation.mutate({
                  node: vars.node,
                  nextChecked: false,
                  skipUndo: true,
                }),
            });
          } else {
            notifier.success(toastTitle);
          }
        }
      } else {
        setRecentlyCompletedIds((prev) => {
          if (!prev.has(nodeId)) return prev;
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }

      invalidateTasksQueries();
    },
    onError: (err) => notifier.error(t("tasks.toggleFailed"), err),
  });

  const toggleSubtaskMutation = useMutation({
    mutationFn: (vars: { readonly subtaskId: OutlineNodeId; readonly nextChecked: boolean }) =>
      client.tasks.update(vars.subtaskId, { checked: vars.nextChecked }),
    onSuccess: () => {
      invalidateTasksQueries();
    },
    onError: (err) => notifier.error(t("tasks.toggleFailed"), err),
  });

  const quickAddMutation = useMutation({
    mutationFn: async (vars: {
      readonly rawText: string;
      readonly scheduledDate?: string | null | undefined;
      readonly scheduledSlot?: "today" | "morning" | "afternoon" | "evening" | null | undefined;
      readonly priority?: TaskPriority | undefined;
    }) => {
      if (isReadOnly) throw new Error("Read-only mode");
      const parsed = parseQuickTaskSyntax(vars.rawText);
      const effectiveScheduledDate =
        parsed.scheduledDate !== undefined
          ? parsed.scheduledDate
          : vars.scheduledDate !== undefined
            ? vars.scheduledDate
            : quickAddPreset === "tomorrow"
              ? tomorrowStr
              : quickAddPreset === "anytime"
                ? null
                : todayStr;
      const effectiveSlot =
        parsed.scheduledSlot !== undefined
          ? parsed.scheduledSlot
          : vars.scheduledSlot !== undefined
            ? vars.scheduledSlot
            : quickAddPreset === "tonight" && effectiveScheduledDate === todayStr
              ? "evening"
              : undefined;

      return client.tasks.create({
        title: vars.rawText,
        parseQuickSyntax: true,
        referenceDate: todayStr,
        ...(spaceFilter !== "__all__" ? { spaceId: spaceFilter } : {}),
        ...(parsed.scheduledDate === undefined
          ? { scheduledDate: effectiveScheduledDate }
          : {}),
        ...(parsed.scheduledSlot === undefined && effectiveSlot !== undefined
          ? { scheduledSlot: effectiveSlot }
          : {}),
        ...(parsed.scheduledStartMin !== undefined
          ? { scheduledStartMin: parsed.scheduledStartMin }
          : {}),
        ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.priority === undefined && vars.priority !== undefined
          ? { priority: vars.priority }
          : {}),
      });
    },
    onSuccess: (created) => {
      quickAddForm.reset({ text: "" });
      onCreatedNode(created.node);
      invalidateTasksQueries();
      const scheduledDate = created.node.scheduledDate ?? null;
      if (scheduledDate === null) {
        notifier.success(t("tasks.quickAddCreatedAnytimeToast"));
      } else if (scheduledDate === todayStr) {
        notifier.success(t("tasks.quickAddCreatedToast"));
      } else {
        notifier.success(t("tasks.quickAddCreatedForDateToast", { date: scheduledDate }));
      }
    },
    onError: (err) => notifier.error(t("tasks.quickAddCreateFailed"), err),
  });

  const updateScheduleMutation = useMutation({
    mutationFn: async (vars: {
      readonly item: WorkspaceTaskItem;
      readonly patch: TaskSchedulePatch;
    }) => {
      if (isReadOnly) throw new Error("Read-only mode");
      const targetId = vars.item.taskId ?? vars.item.node.id;
      const derivedSlot =
        vars.patch.scheduledSlot !== undefined
          ? vars.patch.scheduledSlot
          : vars.patch.scheduledStartMin !== undefined && vars.patch.scheduledStartMin !== null
            ? slotForScheduledStartMin(vars.patch.scheduledStartMin)
            : undefined;
      return client.tasks.update(targetId, {
        ...(vars.patch.scheduledDate !== undefined
          ? { scheduledDate: vars.patch.scheduledDate }
          : {}),
        ...(derivedSlot !== undefined ? { scheduledSlot: derivedSlot } : {}),
        ...(vars.patch.scheduledStartMin !== undefined
          ? { scheduledStartMin: vars.patch.scheduledStartMin }
          : {}),
        ...(vars.patch.durationMin !== undefined
          ? { durationMin: vars.patch.durationMin }
          : {}),
        ...(vars.patch.priority !== undefined ? { priority: vars.patch.priority } : {}),
        ...(vars.patch.recurrenceRule !== undefined
          ? { recurrenceRule: vars.patch.recurrenceRule }
          : {}),
        ...(vars.patch.dueDate !== undefined ? { dueDate: vars.patch.dueDate } : {}),
      });
    },
    onSuccess: (_res, vars) => {
      setWhenOpenNodeId(null);
      invalidateTasksQueries();
      if (vars.patch.scheduledDate === null) {
        notifier.success(t("tasks.whenClearToAnytime"));
      } else if (typeof vars.patch.scheduledDate === "string") {
        notifier.success(
          vars.patch.scheduledDate === todayStr
            ? t("tasks.rescheduledToast")
            : t("tasks.whenRescheduledToast", { date: vars.patch.scheduledDate }),
        );
      } else if (vars.patch.priority !== undefined) {
        notifier.success(t("tasks.boardPriorityUpdatedToast"));
      } else {
        notifier.success(t("tasks.boardRescheduledToast"));
      }
    },
    onError: (err) => notifier.error(t("tasks.rescheduleFailed"), err),
  });

  const updateDetailMutation = useMutation({
    mutationFn: async (vars: {
      readonly item: WorkspaceTaskItem;
      readonly patch: UpdateTaskInput;
    }) => {
      if (isReadOnly) throw new Error("Read-only mode");
      const targetId = vars.item.taskId ?? vars.item.node.id;
      return client.tasks.update(targetId, vars.patch);
    },
    onSuccess: () => {
      invalidateTasksQueries();
      notifier.success(t("tasks.detailSavedToast"));
    },
    onError: (err) => notifier.error(t("tasks.rescheduleFailed"), err),
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (input: BatchUpdateTasksInput) => {
      if (isReadOnly) throw new Error("Read-only mode");
      return client.tasks.batchUpdate(input);
    },
    onSuccess: (res) => {
      onClearBatchSelection();
      invalidateTasksQueries();
      notifier.success(t("tasks.batchUpdatedToast", { count: res.updated.length }));
    },
    onError: (err) => notifier.error(t("tasks.batchUpdateFailed"), err),
  });

  const markBindingReadMutation = useMutation({
    mutationFn: (bindingId: ThreadBindingId) =>
      client.threadBindings.update(bindingId, { unreadResult: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
      });
    },
    onError: (err) => notifier.error(t("daily.markReadFailed"), err),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (item: WorkspaceTaskItem) => {
      if (isReadOnly) throw new Error("Read-only mode");
      const isMarkdownEngine =
        item.sourceEngine === "markdown" ||
        item.document.kind === "article" ||
        item.document.kind === "clip";
      if (isMarkdownEngine) {
        throw new Error("Markdown tasks cannot be deleted from drawer");
      }
      return client.outlineNodes.delete(item.node.id);
    },
    onSuccess: (_deleted, item) => {
      invalidateTasksQueries();
      void queryClient.invalidateQueries({
        queryKey: inkadeQueryKeys.outlineNodes(item.document.id),
      });
      notifier.success(t("tasks.deleteSuccessToast"));
    },
    onError: (err) => notifier.error(t("tasks.deleteFailedToast"), err),
  });

  const handleQuickAddSubmit = quickAddForm.handleSubmit((values) => {
    const trimmed = values.text.trim();
    if (!trimmed || quickAddMutation.isPending) return;
    quickAddMutation.mutate({ rawText: trimmed });
  });

  return {
    quickAddForm,
    watchedQuickAddText,
    parsedQuickSyntax,
    hasQuickTokens,
    whenOpenNodeId,
    setWhenOpenNodeId,
    recentlyCompletedIds,
    toggleTodoMutation,
    toggleSubtaskMutation,
    quickAddMutation,
    updateScheduleMutation,
    updateDetailMutation,
    batchUpdateMutation,
    markBindingReadMutation,
    deleteTaskMutation,
    handleQuickAddSubmit,
  };
}
