import {
  asSpaceId,
  type DocumentId,
  type DocumentRecord,
  type DocumentSummary,
  parseQuickTaskSyntax,
  type SpaceId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeClient,
  useInkadeDocuments,
  useInkadeSpaces,
  useInkadeThreadBindings,
} from "@inkade/sdk/react";
import type {
  CommandPaletteEntry,
  CommandPaletteFilterChip,
  CommandPaletteScopeLockChip,
  CommandPaletteSearchHit,
  CommandPaletteUrlClipAction,
  CommandSearchMode,
} from "@inkade/ui";
import type { DispatchAdeTarget } from "@inkade/views/components/DispatchAdeDialog";
import { getTodayDailyDate } from "@inkade/views/lib/dates";
import {
  matchesDocumentSuperFilters,
  parseSuperCommandQuery,
  tagMatchesFilter,
} from "@inkade/views/lib/super-command-parser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import {
  isBlankDailyDoc,
  parseTodoQuickAddQuery,
  readRecentVisitMap,
  recordRecentDocVisit,
} from "./command-helpers.ts";

export interface UseCommandPaletteStateOptions {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function useCommandPaletteState({ open, onOpenChange }: UseCommandPaletteStateOptions) {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(open ? query.trim() : "", 180);
  const [searchMode, setSearchMode] = useState<CommandSearchMode>("hybrid");
  const [dispatchTarget, setDispatchTarget] = useState<DispatchAdeTarget | null>(null);
  const [lockedSpaceId, setLockedSpaceId] = useState<SpaceId | null>(null);
  const [recentVisitsVersion, setRecentVisitsVersion] = useState(0);
  const todoQuickAddText = useMemo(() => parseTodoQuickAddQuery(query), [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setLockedSpaceId(null);
    }
  }, [open]);

  const recentDocsQuery = useInkadeDocuments({ limit: 300 }, { enabled: open });
  const spacesQuery = useInkadeSpaces({ enabled: open });
  const bindingsQuery = useInkadeThreadBindings({}, { enabled: open });

  const activeSpaces = useMemo(
    () => (spacesQuery.data ?? []).filter((s) => s.archivedAt === null),
    [spacesQuery.data],
  );

  const todayStr = getTodayDailyDate();
  const parsedLive = useMemo(() => parseSuperCommandQuery(query, todayStr), [query, todayStr]);
  const parsedDebounced = useMemo(
    () => parseSuperCommandQuery(debouncedQuery, todayStr),
    [debouncedQuery, todayStr],
  );

  const detectedClipUrl = useMemo<string | null>(() => {
    const trimmed = query.trim();
    const match = /^https?:\/\/\S+/i.exec(trimmed);
    if (!match) return null;
    const candidate = match[0].replace(/[),.;:!?]+$/u, "");
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  }, [query]);

  const resolvedSpace = useMemo(() => {
    if (!parsedLive.spaceQuery) return null;
    const q = parsedLive.spaceQuery.toLowerCase();
    return (
      activeSpaces.find((s) => s.slug.toLowerCase() === q || s.name.toLowerCase() === q) ??
      activeSpaces.find(
        (s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
      ) ??
      null
    );
  }, [activeSpaces, parsedLive.spaceQuery]);

  const resolvedDebouncedSpace = useMemo(() => {
    if (!parsedDebounced.spaceQuery) return null;
    const q = parsedDebounced.spaceQuery.toLowerCase();
    return (
      activeSpaces.find((s) => s.slug.toLowerCase() === q || s.name.toLowerCase() === q) ??
      activeSpaces.find(
        (s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
      ) ??
      null
    );
  }, [activeSpaces, parsedDebounced.spaceQuery]);

  const lockedSpace = useMemo(
    () => (lockedSpaceId ? activeSpaces.find((s) => s.id === lockedSpaceId) ?? null : null),
    [activeSpaces, lockedSpaceId],
  );

  const effectiveScopeSpace = lockedSpace ?? resolvedSpace;
  const effectiveDebouncedSpace = lockedSpace ?? resolvedDebouncedSpace;

  const defaultArticleSpace = useMemo(
    () =>
      effectiveScopeSpace ??
      activeSpaces.find((s) => s.slug === "research") ??
      activeSpaces.find((s) => s.slug !== "inbox" && s.slug !== "daily") ??
      activeSpaces[0] ??
      null,
    [activeSpaces, effectiveScopeSpace],
  );

  const searchQuery = useQuery({
    queryKey:
      searchMode === "hybrid"
        ? inkadeQueryKeys.semanticSearch(
            parsedDebounced.textQuery,
            "hybrid",
            effectiveDebouncedSpace?.id,
            parsedDebounced.kind ?? undefined,
            parsedDebounced.tags[0],
          )
        : inkadeQueryKeys.search(
            parsedDebounced.textQuery,
            effectiveDebouncedSpace?.id,
            parsedDebounced.kind ?? undefined,
            parsedDebounced.tags[0],
          ),
    queryFn: async (): Promise<readonly CommandPaletteSearchHit[]> => {
      const commonInput = {
        q: parsedDebounced.textQuery,
        spaceId: effectiveDebouncedSpace?.id,
        kind: parsedDebounced.kind ?? undefined,
        tag: parsedDebounced.tags[0],
        limit: 20,
      };
      if (searchMode === "hybrid") {
        try {
          const res = await client.search.semantic({
            ...commonInput,
            mode: "hybrid",
          });
          return res.hits.map((hit) => ({
            entityType: "document" as const,
            documentId: hit.documentId,
            nodeId: null,
            spaceId: hit.spaceId,
            kind: hit.kind,
            title: hit.title,
            snippet: hit.snippet,
            tags: hit.tags,
            score: hit.score,
            updatedAt: hit.updatedAt,
            matchSource: hit.matchSource,
          }));
        } catch {
          const fallbackHits = await client.search.query(commonInput);
          return fallbackHits.map((hit) => ({ ...hit, matchSource: "keyword" as const }));
        }
      }
      const hits = await client.search.query(commonInput);
      return hits.map((hit) => ({ ...hit, matchSource: "keyword" as const }));
    },
    enabled: open && parsedDebounced.textQuery.length > 0,
  });

  const ingestUrlMutation = useMutation({
    mutationFn: async (url: string) =>
      client.clips.ingestUrl({
        url,
        ...(resolvedSpace ? { spaceId: resolvedSpace.id } : {}),
        ...(parsedLive.tags.length > 0 ? { tags: [...parsedLive.tags] } : {}),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      showSuccessToast(t("command.clipUrlSuccessTitle"), res.document.title);
      onOpenChange(false);
      if (res.document?.id) {
        void navigate({ to: "/docs/$docId", params: { docId: res.document.id } });
      } else {
        void navigate({ to: "/inbox" });
      }
    },
    onError: (err) => {
      showErrorToast(t("command.clipUrlFailed"), err);
    },
  });

  const urlClipAction = useMemo<CommandPaletteUrlClipAction | null>(() => {
    if (!detectedClipUrl) return null;
    return {
      url: detectedClipUrl,
      label: ingestUrlMutation.isPending
        ? t("command.clipUrlActionLoading")
        : t("command.clipUrlActionLabel"),
      loading: ingestUrlMutation.isPending,
      onClip: () => {
        if (!ingestUrlMutation.isPending) {
          ingestUrlMutation.mutate(detectedClipUrl);
        }
      },
    };
  }, [detectedClipUrl, ingestUrlMutation, t]);

  const createArticleMutation = useMutation({
    mutationFn: async (title: string) => {
      const targetSpaceId = defaultArticleSpace?.id ?? asSpaceId("spc_research");
      return client.documents.create({
        spaceId: targetSpaceId,
        kind: "article",
        title,
        contentMarkdown: `# ${title}\n\n`,
        tags: [...parsedLive.tags],
      });
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      showSuccessToast(t("command.articleCreatedFromCommand", { title: created.title }));
      void navigate({ to: "/docs/$docId", params: { docId: created.id } });
    },
    onError: (err) => showErrorToast(t("command.articleCreateFailed"), err),
  });

  const createTodoMutation = useMutation({
    mutationFn: async (rawText: string) => {
      const parsed = parseQuickTaskSyntax(rawText, new Date(`${todayStr}T12:00:00`));
      const targetScheduledDate =
        parsed.scheduledDate !== undefined ? parsed.scheduledDate : todayStr;
      return client.tasks.create({
        title: rawText,
        parseQuickSyntax: true,
        referenceDate: todayStr,
        scheduledDate: targetScheduledDate,
        ...(effectiveScopeSpace ? { spaceId: effectiveScopeSpace.id } : {}),
      });
    },
    onSuccess: (created) => {
      const targetDate = created.node.scheduledDate ?? todayStr;
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.dailyOutline(targetDate) });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.dailyOutline(todayStr) });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      showSuccessToast(t("command.todoQuickAddSuccess"));
      onOpenChange(false);
    },
    onError: (err) => showErrorToast(t("command.todoQuickAddFailed"), err),
  });

  const handleExportZip = useCallback(async () => {
    try {
      const bytes = await client.workspace.exportZip();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `inkade-workspace-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      showSuccessToast(t("nav.exportZipSuccess"));
    } catch (err) {
      showErrorToast(t("nav.exportZipFailed"), err);
    }
  }, [client, t]);

  const docs = useMemo(() => recentDocsQuery.data ?? [], [recentDocsQuery.data]);
  const docById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const spaceNameById = useMemo(
    () => new Map(activeSpaces.map((s) => [s.id, s.name])),
    [activeSpaces],
  );
  const spaceSlugById = useMemo(
    () => new Map(activeSpaces.map((s) => [s.id, s.slug])),
    [activeSpaces],
  );

  const waitingBindings = useMemo(
    () => (bindingsQuery.data ?? []).filter((b) => b.status === "waiting_input"),
    [bindingsQuery.data],
  );
  const waitingDocIds = useMemo(
    () => new Set(waitingBindings.map((b) => b.documentId)),
    [waitingBindings],
  );

  const filterContext = useMemo(
    () => ({
      spaceNameById,
      spaceSlugById,
      waitingDocIds,
    }),
    [spaceNameById, spaceSlugById, waitingDocIds],
  );

  const recentVisitTimestamps = useMemo(() => {
    void recentVisitsVersion;
    if (!open) return {};
    return readRecentVisitMap();
  }, [open, recentVisitsVersion]);

  const filteredRecentDocs = useMemo(() => {
    let active = docs.filter((d) => d.trashedAt === null);
    if (effectiveScopeSpace) {
      active = active.filter((d) => d.spaceId === effectiveScopeSpace.id);
    }
    if (!parsedLive.hasStructuredFilters && !parsedLive.textQuery) {
      const filtered =
        lockedSpace?.slug === "daily" ? active : active.filter((d) => !isBlankDailyDoc(d));
      return [...filtered].sort((a, b) => {
        const va = recentVisitTimestamps[a.id] ?? 0;
        const vb = recentVisitTimestamps[b.id] ?? 0;
        if (va !== vb) return vb - va;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
    }
    return active.filter((d) => matchesDocumentSuperFilters(d, parsedLive, filterContext));
  }, [
    docs,
    effectiveScopeSpace,
    filterContext,
    lockedSpace?.slug,
    parsedLive,
    recentVisitTimestamps,
  ]);

  const filteredSearchHits = useMemo(() => {
    if (parsedDebounced.textQuery.length === 0) return [];
    const hits = searchQuery.data ?? [];
    return hits.filter((hit) => {
      const doc = docById.get(hit.documentId);
      if (effectiveScopeSpace && hit.spaceId !== effectiveScopeSpace.id) {
        return false;
      }
      if (parsedLive.unreadOnly && !doc?.unreadAgentUpdate) {
        return false;
      }
      if (parsedLive.waitingOnly && !waitingDocIds.has(hit.documentId)) {
        return false;
      }
      if (parsedLive.spaceQuery && !effectiveScopeSpace) {
        const sName = (spaceNameById.get(hit.spaceId) ?? "").toLowerCase();
        const sSlug = (spaceSlugById.get(hit.spaceId) ?? "").toLowerCase();
        const q = parsedLive.spaceQuery.toLowerCase();
        if (!sName.includes(q) && !sSlug.includes(q)) return false;
      }
      for (const requiredTag of parsedLive.tags) {
        if (!hit.tags.some((tag) => tagMatchesFilter(tag, requiredTag))) {
          return false;
        }
      }
      return true;
    });
  }, [
    docById,
    effectiveScopeSpace,
    parsedDebounced.textQuery.length,
    parsedLive.spaceQuery,
    parsedLive.tags,
    parsedLive.unreadOnly,
    parsedLive.waitingOnly,
    searchQuery.data,
    spaceNameById,
    spaceSlugById,
    waitingDocIds,
  ]);

  const activeFilters = useMemo<CommandPaletteFilterChip[]>(() => {
    const chips: CommandPaletteFilterChip[] = [];
    for (const tag of parsedLive.tags) {
      chips.push({ key: `tag:${tag}`, label: t("command.filterChipTag", { tag }) });
    }
    if (parsedLive.spaceQuery) {
      chips.push({
        key: `space:${parsedLive.spaceQuery}`,
        label: t("command.filterChipSpace", { space: resolvedSpace?.name ?? parsedLive.spaceQuery }),
      });
    }
    if (parsedLive.kind) {
      chips.push({
        key: `kind:${parsedLive.kind}`,
        label: t("command.filterChipKind", { kind: parsedLive.kind }),
      });
    }
    if (parsedLive.unreadOnly) {
      chips.push({ key: "is:unread", label: t("command.filterChipUnread") });
    }
    if (parsedLive.waitingOnly) {
      chips.push({ key: "@waiting", label: t("command.filterChipWaiting") });
    }
    return chips;
  }, [parsedLive, resolvedSpace, t]);

  const handleSelectHit = async (hit: CommandPaletteSearchHit): Promise<void> => {
    recordRecentDocVisit(hit.documentId);
    setRecentVisitsVersion((v) => v + 1);
    if (hit.entityType === "outline_node" && hit.nodeId) {
      let targetDoc: DocumentSummary | DocumentRecord | undefined = docById.get(hit.documentId);
      if (!targetDoc) {
        try {
          targetDoc = await client.documents.get(hit.documentId);
        } catch {
          targetDoc = undefined;
        }
      }
      if (targetDoc?.kind === "outline" && targetDoc.dailyDate) {
        void navigate({
          to: "/daily/$date",
          params: { date: targetDoc.dailyDate },
          search: { nodeId: hit.nodeId },
        });
        return;
      }
    }
    void navigate({ to: "/docs/$docId", params: { docId: hit.documentId } });
  };

  const handleSelectDoc = (documentId: DocumentId): void => {
    recordRecentDocVisit(documentId);
    setRecentVisitsVersion((v) => v + 1);
    const doc = docById.get(documentId);
    if (doc?.kind === "outline" && doc.dailyDate) {
      void navigate({ to: "/daily/$date", params: { date: doc.dailyDate }, search: {} });
      return;
    }
    void navigate({ to: "/docs/$docId", params: { docId: documentId } });
  };

  const handleOpenInSplit = useCallback(
    (documentId: DocumentId) => {
      recordRecentDocVisit(documentId);
      setRecentVisitsVersion((v) => v + 1);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("inkade:open-split-doc", { detail: { documentId } }),
        );
        const isDesktopViewport = window.matchMedia("(min-width: 1024px)").matches;
        if (isDesktopViewport) {
          return;
        }
      }
      if (!pathname.startsWith("/docs/")) {
        void navigate({ to: "/docs/$docId", params: { docId: documentId } });
      }
    },
    [navigate, pathname],
  );

  const handleDispatchAde = useCallback(
    (documentId: DocumentId, title: string) => {
      const existingDoc = docById.get(documentId);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("inkade:dispatch-ade", { detail: { documentId, title } }),
        );
      }
      if (existingDoc?.kind === "outline" && existingDoc.dailyDate) {
        void navigate({
          to: "/daily/$date",
          params: { date: existingDoc.dailyDate },
          search: {},
        });
      } else {
        void navigate({ to: "/docs/$docId", params: { docId: documentId } });
      }
      setDispatchTarget({
        documentId,
        documentTitle: existingDoc?.title ?? title,
        excerpt: existingDoc?.excerpt || title,
      });
    },
    [docById, navigate],
  );

  const scopeLockChip = useMemo<CommandPaletteScopeLockChip | null>(() => {
    if (!lockedSpace) return null;
    return {
      label: t("command.scopeLockChip", { name: lockedSpace.name }),
      color: lockedSpace.color,
      icon: lockedSpace.icon,
      onClear: () => setLockedSpaceId(null),
    };
  }, [lockedSpace, t]);

  const handleTabAction = useCallback(
    (entry: CommandPaletteEntry | null): boolean => {
      if (entry?.entryType === "action" && entry.action.id.startsWith("go-space:")) {
        const spaceId = entry.action.id.slice("go-space:".length);
        const matchedSpace = activeSpaces.find((s) => s.id === spaceId);
        if (matchedSpace) {
          setLockedSpaceId(matchedSpace.id);
          setQuery("");
          return true;
        }
      }
      if (entry?.entryType === "document" && entry.document.spaceId) {
        if (activeSpaces.some((s) => s.id === entry.document.spaceId)) {
          setLockedSpaceId(entry.document.spaceId);
          setQuery("");
          return true;
        }
      }
      if (entry?.entryType === "hit" && entry.hit.spaceId) {
        if (activeSpaces.some((s) => s.id === entry.hit.spaceId)) {
          setLockedSpaceId(entry.hit.spaceId);
          setQuery("");
          return true;
        }
      }
      if (resolvedSpace) {
        setLockedSpaceId(resolvedSpace.id);
        setQuery("");
        return true;
      }
      const trimmed = query.trim().toLowerCase();
      if (trimmed.length > 0) {
        const matchedSpace = activeSpaces.find(
          (s) =>
            s.name.toLowerCase().includes(trimmed) || s.slug.toLowerCase().includes(trimmed),
        );
        if (matchedSpace) {
          setLockedSpaceId(matchedSpace.id);
          setQuery("");
          return true;
        }
      }
      return false;
    },
    [activeSpaces, query, resolvedSpace],
  );

  const handleBackspaceEmpty = useCallback((): boolean => {
    if (!lockedSpaceId) return false;
    setLockedSpaceId(null);
    return true;
  }, [lockedSpaceId]);

  return {
    t,
    navigate,
    pathname,
    query,
    setQuery,
    debouncedQuery,
    searchMode,
    setSearchMode,
    dispatchTarget,
    setDispatchTarget,
    lockedSpace,
    todoQuickAddText,
    activeSpaces,
    parsedLive,
    detectedClipUrl,
    defaultArticleSpace,
    searchQuery,
    urlClipAction,
    createArticleMutation,
    createTodoMutation,
    handleExportZip,
    docById,
    waitingBindings,
    filteredRecentDocs,
    filteredSearchHits,
    activeFilters,
    scopeLockChip,
    handleSelectHit,
    handleSelectDoc,
    handleOpenInSplit,
    handleDispatchAde,
    handleTabAction,
    handleBackspaceEmpty,
  };
}
