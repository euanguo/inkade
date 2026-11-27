import {
  type AdeKind,
  type AdeThreadBinding,
  type AdeThreadStatus,
  type AgentApprovalDecision,
  type AgentSteeringMode,
  detectBindingConflicts,
  type DocumentId,
  type ThreadBindingId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeClient,
  useInkadeDocuments,
  useInkadeThreadBindings,
} from "@inkade/sdk/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useInkadeViewsContext } from "../../context.tsx";
import { useUserPreferences } from "../../lib/preferences-store.ts";
import {
  type ThreadGroupMeta,
  THREADS_CONFLICT_SESSION_KEY,
  type ThreadsViewMode,
  type ThreadsViewProps,
} from "./types.ts";

export function useThreadsWorkspace({
  readonly: readonlyProp,
  urlState,
  onUrlStateChange,
}: ThreadsViewProps = {}) {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const { navigation, hostActions, notifier, environment } = useInkadeViewsContext();
  const isReadOnly = readonlyProp ?? environment.readonly ?? false;
  const { preferences, updatePreferences } = useUserPreferences();
  const canvasWidth = preferences.layout.workspaceCanvasWidth;
  const queryClient = useQueryClient();

  const [sessionConflictOverride, setSessionConflictOverride] = useState<ThreadsViewMode | null>(
    () => {
      if (typeof window === "undefined") return null;
      const stored = window.sessionStorage.getItem(THREADS_CONFLICT_SESSION_KEY);
      if (stored === "conflicts") {
        window.sessionStorage.removeItem(THREADS_CONFLICT_SESSION_KEY);
        return "conflicts";
      }
      return null;
    },
  );
  const [searchText, setSearchTextState] = useState<string>(() => urlState?.q ?? "");

  const kindFilter: AdeKind = urlState?.host ?? preferences.threads.hostFilter;
  const viewMode: ThreadsViewMode =
    urlState?.mode ?? sessionConflictOverride ?? preferences.threads.viewMode;

  const setViewMode = (next: ThreadsViewMode): void => {
    setSessionConflictOverride(null);
    updatePreferences({ threads: { viewMode: next } });
    onUrlStateChange?.({ mode: next });
  };

  const setKindFilter = (next: AdeKind): void => {
    updatePreferences({ threads: { hostFilter: next } });
    onUrlStateChange?.({ host: next === "all" ? undefined : next });
  };

  const setSearchText = (next: string): void => {
    setSearchTextState(next);
    onUrlStateChange?.({ q: next.trim() ? next : undefined });
  };

  const [focusedConflictDocId, setFocusedConflictDocId] = useState<DocumentId | null>(null);
  const [steeringDraftById, setSteeringDraftById] = useState<
    Readonly<Record<ThreadBindingId, string>>
  >({});
  const [steeringModeById, setSteeringModeById] = useState<
    Readonly<Record<ThreadBindingId, AgentSteeringMode>>
  >({});
  const [recentApprovalIds, setRecentApprovalIds] = useState<ReadonlySet<ThreadBindingId>>(
    () => new Set(),
  );

  const groupOrder: readonly ThreadGroupMeta[] = useMemo(
    () => [
      {
        status: "waiting_input",
        heading: t("threads.groupWaitingHeading"),
        description: t("threads.groupWaitingDesc"),
      },
      {
        status: "running",
        heading: t("threads.groupRunningHeading"),
        description: t("threads.groupRunningDesc"),
      },
      {
        status: "queued",
        heading: t("threads.groupQueuedHeading"),
        description: t("threads.groupQueuedDesc"),
      },
      {
        status: "completed",
        heading: t("threads.groupCompletedHeading"),
        description: t("threads.groupCompletedDesc"),
      },
      {
        status: "failed",
        heading: t("threads.groupFailedHeading"),
        description: t("threads.groupFailedDesc"),
      },
      {
        status: "archived",
        heading: t("threads.groupArchivedHeading"),
        description: t("threads.groupArchivedDesc"),
      },
    ],
    [t],
  );

  const bindingsQuery = useInkadeThreadBindings({});

  const availableHostKinds = useMemo(() => {
    const kinds = new Set<AdeKind>();
    for (const binding of bindingsQuery.data ?? []) {
      if (binding.adeKind) {
        kinds.add(binding.adeKind);
      }
    }
    return [...kinds].sort((a, b) => {
      if (a === "any") return -1;
      if (b === "any") return 1;
      return a.localeCompare(b);
    });
  }, [bindingsQuery.data]);

  const docsQuery = useInkadeDocuments({ limit: 300 });

  const invalidateThreadState = () => {
    void queryClient.invalidateQueries({
      queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
    });
    void queryClient.invalidateQueries({
      queryKey: [...inkadeQueryKeys.all, "away-summary"],
    });
    void queryClient.invalidateQueries({
      queryKey: inkadeQueryKeys.workspaceSummary(),
    });
  };

  const updateBindingMutation = useMutation({
    mutationFn: (vars: {
      readonly id: ThreadBindingId;
      readonly patch: { readonly status?: AdeThreadStatus; readonly unreadResult?: boolean };
    }) => {
      if (isReadOnly) throw new Error("Read-only mode");
      return client.threadBindings.update(vars.id, vars.patch);
    },
    onSuccess: () => {
      invalidateThreadState();
    },
    onError: (err) => notifier.error(t("threads.updateFailed"), err),
  });

  const approveBindingMutation = useMutation({
    mutationFn: (vars: {
      readonly id: ThreadBindingId;
      readonly decision: AgentApprovalDecision;
      readonly note?: string | undefined;
    }) => {
      if (isReadOnly) throw new Error("Read-only mode");
      return client.threadBindings.approve(vars.id, {
        decision: vars.decision,
        ...(vars.note ? { note: vars.note } : {}),
      });
    },
    onSuccess: (_data, vars) => {
      setRecentApprovalIds((prev) => {
        const next = new Set(prev);
        next.add(vars.id);
        return next;
      });
      invalidateThreadState();
      notifier.success(t("agentControl.approvalSuccessToast"));
    },
    onError: (err) => notifier.error(t("agentControl.approvalFailedToast"), err),
  });

  const undoApprovalMutation = useMutation({
    mutationFn: async (binding: AdeThreadBinding) => {
      if (isReadOnly) throw new Error("Read-only mode");
      if (!binding.pendingApproval) return binding;
      return client.threadBindings.update(binding.id, {
        status: "waiting_input",
        pendingApproval: {
          ...binding.pendingApproval,
          decision: null,
          decisionNote: null,
          decidedAt: null,
        },
      });
    },
    onSuccess: (_data, binding) => {
      setRecentApprovalIds((prev) => {
        const next = new Set(prev);
        next.delete(binding.id);
        return next;
      });
      invalidateThreadState();
      notifier.success(t("agentControl.approvalUndoToast"));
    },
    onError: (err) => notifier.error(t("agentControl.approvalFailedToast"), err),
  });

  const steerBindingMutation = useMutation({
    mutationFn: (vars: {
      readonly bindingId: ThreadBindingId;
      readonly text: string;
      readonly mode: AgentSteeringMode;
    }) => {
      if (isReadOnly) throw new Error("Read-only mode");
      return client.threadBindings.steer(vars.bindingId, {
        text: vars.text,
        mode: vars.mode,
      });
    },
    onSuccess: (_data, vars) => {
      setSteeringDraftById((prev) => ({ ...prev, [vars.bindingId]: "" }));
      invalidateThreadState();
      notifier.success(t("agentControl.steeringSentToast"));
    },
    onError: (err) => notifier.error(t("agentControl.steeringFailedToast"), err),
  });

  const deleteBindingMutation = useMutation({
    mutationFn: (id: ThreadBindingId) => {
      if (isReadOnly) throw new Error("Read-only mode");
      return client.threadBindings.delete(id);
    },
    onSuccess: () => {
      invalidateThreadState();
      notifier.success(t("threads.unboundToast"));
    },
    onError: (err) => notifier.error(t("threads.unbindFailed"), err),
  });

  const docMap = useMemo(
    () => new Map((docsQuery.data ?? []).map((d) => [d.id, d])),
    [docsQuery.data],
  );

  const docTitlesRecord = useMemo(() => {
    const rec: Record<string, string> = {};
    for (const doc of docsQuery.data ?? []) {
      rec[doc.id] = doc.title;
    }
    return rec;
  }, [docsQuery.data]);

  const conflicts = useMemo(
    () => detectBindingConflicts(bindingsQuery.data ?? []),
    [bindingsQuery.data],
  );

  const filteredConflicts = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return conflicts.filter((conflict) => {
      if (focusedConflictDocId && conflict.documentId !== focusedConflictDocId) return false;
      const matchesKind =
        kindFilter === "all" || conflict.bindings.some((b) => b.adeKind === kindFilter);
      if (!matchesKind) return false;
      if (!q) return true;
      const docTitle = docMap.get(conflict.documentId)?.title ?? "";
      return (
        docTitle.toLowerCase().includes(q) ||
        conflict.bindings.some(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            (b.lastSummary ?? "").toLowerCase().includes(q),
        )
      );
    });
  }, [conflicts, focusedConflictDocId, kindFilter, searchText, docMap]);

  const filteredBindings = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return (bindingsQuery.data ?? [])
      .filter((b) => (kindFilter === "all" ? true : b.adeKind === kindFilter))
      .filter((b) => {
        if (!q) return true;
        const docTitle = docMap.get(b.documentId)?.title ?? "";
        return (
          b.title.toLowerCase().includes(q) ||
          (b.lastSummary ?? "").toLowerCase().includes(q) ||
          b.externalThreadId.toLowerCase().includes(q) ||
          docTitle.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.lastSyncedAt.localeCompare(a.lastSyncedAt));
  }, [bindingsQuery.data, kindFilter, searchText, docMap]);

  const grouped = useMemo(() => {
    const map = new Map<AdeThreadStatus, AdeThreadBinding[]>();
    for (const item of groupOrder) {
      map.set(item.status, []);
    }
    for (const b of filteredBindings) {
      map.get(b.status)?.push(b);
    }
    return map;
  }, [filteredBindings, groupOrder]);

  return {
    t,
    navigation,
    hostActions,
    environment,
    updatePreferences,
    canvasWidth,
    viewMode,
    setViewMode,
    kindFilter,
    setKindFilter,
    searchText,
    setSearchText,
    setFocusedConflictDocId,
    steeringDraftById,
    setSteeringDraftById,
    steeringModeById,
    setSteeringModeById,
    recentApprovalIds,
    groupOrder,
    bindingsQuery,
    availableHostKinds,
    updateBindingMutation,
    approveBindingMutation,
    undoApprovalMutation,
    steerBindingMutation,
    deleteBindingMutation,
    docMap,
    docTitlesRecord,
    conflicts,
    filteredConflicts,
    filteredBindings,
    grouped,
  };
}

export type ThreadsWorkspaceState = ReturnType<typeof useThreadsWorkspace>;
