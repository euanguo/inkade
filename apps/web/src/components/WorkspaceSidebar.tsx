import {
  asSpaceId,
  countUnifiedInboxBadge,
  type DocumentKind,
  type SavedView,
  type Space,
  type SpaceId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useDeleteSavedViewMutation,
  useInkadeBootstrap,
  useInkadeBriefingRuns,
  useInkadeClient,
  useInkadeDocuments,
  useInkadeSavedViews,
  useInkadeSpaces,
  useInkadeThreadBindings,
  useInkadeWhoami,
  useInkadeWorkspaceSummary,
} from "@inkade/sdk/react";
import {
  Button,
  cn,
  GlideHighlight,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Separator,
} from "@inkade/ui";
import { useInboxLocalState } from "@inkade/views/lib/inbox-local-state";
import { useShellStyle } from "@inkade/views/lib/preferences-store";
import { buildNestedTagTree } from "@inkade/views/lib/super-command-parser";
import { SpaceTreeView } from "@inkade/views/views/SpaceTreeView";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  CheckSquareIcon,
  FileTextIcon,
  FolderTreeIcon,
  InboxIcon,
  KeyboardIcon,
  LibraryIcon,
  MessageSquareCodeIcon,
  NetworkIcon,
  PinIcon,
  PlugZapIcon,
  PlusIcon,
  SettingsIcon,
  SmartphoneIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { signOutSession } from "../lib/api.ts";
import { isNativeMobileShell, postToNativeShell } from "../lib/mobile-shell.ts";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";
import { OnboardingGuideCard } from "./OnboardingGuideCard.tsx";
import {
  SidebarHoverPeek,
  type SidebarMode,
  SidebarNavLink,
  useWorkspacePermissionLabels,
} from "./workspace-sidebar/SidebarNavLink.tsx";
import { SidebarViewsAndTagsSection } from "./workspace-sidebar/SidebarTagTree.tsx";
import { SidebarWorkspaceMenu } from "./workspace-sidebar/SidebarWorkspaceMenu.tsx";

export { SidebarHoverPeek, type SidebarMode };

export interface WorkspaceSidebarProps {
  readonly isPeek?: boolean | undefined;
  readonly isDrawer?: boolean | undefined;
  readonly fixedWidth?: number | undefined;
  readonly pathname: string;
  readonly searchStr: string;
  readonly isSettingsRoute: boolean;
  readonly realtimeState: string;
  readonly reconnectAttempt: number;
  readonly effectiveTheme: "light" | "dark";
  readonly sidebarMode: SidebarMode;
  readonly docSidebarPanel: React.ReactNode | null;
  readonly onChangeSidebarMode: (mode: SidebarMode) => void;
  readonly onToggleTheme: () => void;
  readonly onOpenNewDoc: (options?: {
    readonly spaceId?: SpaceId | undefined;
    readonly kind?: DocumentKind | undefined;
  }) => void;
  readonly onOpenSpaceDialog: (options: {
    readonly editingSpace?: Space | null | undefined;
    readonly defaultParentId?: SpaceId | null | undefined;
  }) => void;
  readonly onOpenSavedViewDialog: () => void;
  readonly onOpenCommandPalette: () => void;
  readonly onOpenShortcuts: () => void;
  readonly onOpenSettingsModal: () => void;
  readonly onSetSidebarCollapsed: (collapsed: boolean) => void;
  readonly onCloseDrawers: () => void;
}

export function WorkspaceSidebar({
  isPeek = false,
  isDrawer = false,
  fixedWidth,
  pathname,
  searchStr,
  isSettingsRoute,
  realtimeState,
  reconnectAttempt,
  effectiveTheme,
  sidebarMode,
  docSidebarPanel,
  onChangeSidebarMode,
  onToggleTheme,
  onOpenNewDoc,
  onOpenSpaceDialog,
  onOpenSavedViewDialog,
  onOpenCommandPalette,
  onOpenShortcuts,
  onOpenSettingsModal,
  onSetSidebarCollapsed,
  onCloseDrawers,
}: WorkspaceSidebarProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { shellStyle } = useShellStyle();
  const permissionLabels = useWorkspacePermissionLabels();

  const [expandedTagPaths, setExpandedTagPaths] = useState<Set<string>>(() => new Set());
  const [tagsExpanded, setTagsExpanded] = useState(false);

  const bootstrapQuery = useInkadeBootstrap();
  const whoamiQuery = useInkadeWhoami();
  const summaryQuery = useInkadeWorkspaceSummary();
  const spacesQuery = useInkadeSpaces();
  const docsQuery = useInkadeDocuments({ limit: 300 });
  const bindingsQuery = useInkadeThreadBindings({});
  const briefingRunsQuery = useInkadeBriefingRuns({ status: "failed", undismissedOnly: true, limit: 50 });
  const savedViewsQuery = useInkadeSavedViews();

  const deleteSavedViewMutation = useDeleteSavedViewMutation({
    onSuccess: () => {
      showSuccessToast(t("nav.savedViewDeleted"));
    },
    onError: (err) => showErrorToast(t("nav.savedViewDeleteFailed"), err),
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

  const handleSignOut = useCallback(async () => {
    await signOutSession();
    void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.whoami() });
    void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.bootstrap() });
  }, [queryClient]);

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const docs = useMemo(() => docsQuery.data ?? [], [docsQuery.data]);
  const bindings = useMemo(() => bindingsQuery.data ?? [], [bindingsQuery.data]);
  const savedViews = savedViewsQuery.data ?? [];
  const whoami = whoamiQuery.data;
  const workspaceName = bootstrapQuery.data?.workspace?.name ?? t("common.appName");
  const workspaceInitial = workspaceName.trim().charAt(0).toUpperCase() || "I";

  const spaceDocCountMap = useMemo(() => {
    const map = new Map<string, number>();
    if (summaryQuery.data?.spaces) {
      for (const entry of summaryQuery.data.spaces) map.set(entry.spaceId, entry.activeCount);
      return map;
    }
    for (const d of docs) {
      if (d.trashedAt !== null) continue;
      map.set(d.spaceId, (map.get(d.spaceId) ?? 0) + 1);
    }
    return map;
  }, [summaryQuery.data, docs]);

  const pinnedDocs = useMemo(
    () => docs.filter((d) => d.pinned && d.trashedAt === null),
    [docs],
  );
  const inboxLocalState = useInboxLocalState();
  const inboxSpaceId = useMemo(
    () => spaces.find((s) => s.slug === "inbox")?.id ?? asSpaceId("spc_inbox"),
    [spaces],
  );
  const runningThreadsCount = useMemo(
    () => bindings.filter((b) => b.status === "running").length,
    [bindings],
  );
  const unifiedInboxCount = useMemo(
    () =>
      countUnifiedInboxBadge({
        docs,
        bindings,
        briefingRuns: briefingRunsQuery.data ?? [],
        inboxSpaceId,
        bindingSnoozeMap: inboxLocalState.snoozeMap,
        bindingUnreadMap: inboxLocalState.unreadMap,
      }),
    [
      docs,
      bindings,
      briefingRunsQuery.data,
      inboxSpaceId,
      inboxLocalState.snoozeMap,
      inboxLocalState.unreadMap,
    ],
  );
  const attentionThreadsCount =
    summaryQuery.data?.attentionThreadsCount ??
    bindings.filter((b) => b.status === "waiting_input" || b.unreadResult || b.status === "failed")
      .length;
  const openTasksCount = useMemo(
    () => (summaryQuery.data?.dailyActivity ?? []).reduce((sum, e) => sum + e.openTaskCount, 0),
    [summaryQuery.data?.dailyActivity],
  );
  const nestedTagTree = useMemo(() => {
    if (summaryQuery.data?.tags && summaryQuery.data.tags.length > 0) {
      return buildNestedTagTree(summaryQuery.data.tags);
    }
    const counts = new Map<string, number>();
    for (const d of docs) {
      if (d.trashedAt !== null) continue;
      for (const tag of d.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return buildNestedTagTree([...counts.entries()].map(([tag, count]) => ({ tag, count })));
  }, [summaryQuery.data, docs]);

  const activeLibraryTag =
    pathname === "/library" ? new URLSearchParams(searchStr).get("tag") : null;
  const activeSavedViewId =
    pathname === "/library" ? new URLSearchParams(searchStr).get("viewId") : null;
  const effectiveSidebarMode: SidebarMode = docSidebarPanel ? sidebarMode : "tree";

  const toggleTagExpand = (tagPath: string): void => {
    setExpandedTagPaths((prev) => {
      const next = new Set(prev);
      if (next.has(tagPath)) next.delete(tagPath);
      else next.add(tagPath);
      return next;
    });
  };

  const handleOpenSavedView = (view: SavedView): void => {
    onCloseDrawers();
    void navigate({
      to: "/library",
      search: {
        viewId: view.id,
        ...(view.filter.spaceId ? { spaceId: view.filter.spaceId } : {}),
        ...(view.filter.kind ? { kind: view.filter.kind } : {}),
        ...(view.filter.tag ? { tag: view.filter.tag } : {}),
        ...(view.filter.pinnedOnly ? { pinnedOnly: true } : {}),
        ...(view.filter.unreadOnly ? { unreadOnly: true } : {}),
      },
    });
  };

  const realtimeStatusText =
    realtimeState === "connected"
      ? t("nav.realtimeConnected")
      : realtimeState === "reconnecting"
        ? t("nav.realtimeReconnecting", { attempt: reconnectAttempt })
        : t("nav.realtimeConnecting");

  return (
    <div
      className={cn(
        "flex h-full flex-col text-sidebar-foreground",
        fixedWidth !== undefined && "shrink-0",
        isPeek
          ? "bg-sidebar/95"
          : shellStyle === "inset"
            ? "bg-sidebar lg:bg-transparent"
            : "bg-sidebar",
      )}
      style={
        fixedWidth !== undefined
          ? { width: `${fixedWidth}px`, minWidth: `${fixedWidth}px` }
          : undefined
      }
    >
      <SidebarWorkspaceMenu
        effectiveTheme={effectiveTheme}
        isDrawer={isDrawer}
        isPeek={isPeek}
        onCloseDrawers={onCloseDrawers}
        onExportZip={handleExportZip}
        onOpenCommandPalette={onOpenCommandPalette}
        onOpenNewDoc={() => onOpenNewDoc()}
        onOpenSettingsModal={onOpenSettingsModal}
        onOpenShortcuts={onOpenShortcuts}
        onSetSidebarCollapsed={onSetSidebarCollapsed}
        onSignOut={handleSignOut}
        onToggleTheme={onToggleTheme}
        permissionLabels={permissionLabels}
        whoami={whoami}
        workspaceInitial={workspaceInitial}
        workspaceName={workspaceName}
      />

      <ScrollArea className="min-h-0 flex-1" scrollFade>
        {effectiveSidebarMode === "doc" && docSidebarPanel ? (
          <div className="py-3 pl-2.5 pr-3.5">{docSidebarPanel}</div>
        ) : (
          <div className="flex flex-col gap-4 py-3 pl-2.5 pr-3.5">
            <nav aria-label={t("nav.primaryWorkspaces")}>
              <GlideHighlight
                className="flex flex-col gap-0.5"
                highlightClassName="rounded-md bg-sidebar-accent/75"
                mode="pointer"
              >
                <SidebarNavLink
                  active={pathname === "/inbox"}
                  badge={unifiedInboxCount > 0 ? String(unifiedInboxCount) : undefined}
                  icon={
                    <InboxIcon
                      className={cn(
                        "size-4 shrink-0",
                        pathname === "/inbox" ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                  }
                  label={t("nav.inbox")}
                  onNavigate={onCloseDrawers}
                  shortcut="G I"
                  to="/inbox"
                />
                <SidebarNavLink
                  active={pathname === "/daily" || pathname.startsWith("/daily/")}
                  icon={
                    <CalendarDaysIcon
                      className={cn(
                        "size-4 shrink-0",
                        pathname === "/daily" || pathname.startsWith("/daily/")
                          ? "text-foreground"
                          : "text-muted-foreground",
                      )}
                    />
                  }
                  label={t("nav.dailyToday")}
                  onNavigate={onCloseDrawers}
                  shortcut="G D"
                  to="/daily"
                />
                <SidebarNavLink
                  active={pathname === "/tasks"}
                  badge={openTasksCount > 0 ? String(openTasksCount) : undefined}
                  icon={
                    <CheckSquareIcon
                      className={cn(
                        "size-4 shrink-0",
                        pathname === "/tasks" ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                  }
                  label={t("nav.tasks")}
                  onNavigate={onCloseDrawers}
                  shortcut="G K"
                  to="/tasks"
                />
                <SidebarNavLink
                  active={pathname === "/library"}
                  icon={
                    <LibraryIcon
                      className={cn(
                        "size-4 shrink-0",
                        pathname === "/library" ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                  }
                  label={t("nav.library")}
                  onNavigate={onCloseDrawers}
                  shortcut="G L"
                  to="/library"
                />
                <SidebarNavLink
                  active={pathname === "/graph"}
                  icon={
                    <NetworkIcon
                      className={cn(
                        "size-4 shrink-0",
                        pathname === "/graph" ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                  }
                  label={t("graph.navTitle")}
                  onNavigate={onCloseDrawers}
                  shortcut="G G"
                  to="/graph"
                />
              </GlideHighlight>
            </nav>

            {pinnedDocs.length > 0 ? (
              <div className="flex flex-col gap-1">
                <div className="px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/85">
                  {t("nav.pinned")}
                </div>
                <GlideHighlight
                  className="flex flex-col gap-0.5"
                  highlightClassName="rounded-md bg-sidebar-accent/75"
                  mode="pointer"
                >
                  {pinnedDocs.slice(0, 8).map((doc) => {
                    const isActiveDoc = pathname === `/docs/${doc.id}`;
                    return (
                      <Link
                        className={cn(
                          "relative z-10 flex items-center gap-2 rounded-md px-2.5 py-1 text-sm transition-colors duration-[var(--duration-micro)]",
                          isActiveDoc
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/70 in-data-[glide-visible=true]:hover:bg-transparent hover:text-sidebar-accent-foreground",
                        )}
                        data-glide-item
                        key={doc.id}
                        onClick={onCloseDrawers}
                        params={{ docId: doc.id }}
                        to="/docs/$docId"
                      >
                        <PinIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{doc.title}</span>
                      </Link>
                    );
                  })}
                </GlideHighlight>
              </div>
            ) : null}

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-2.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/85">
                  {t("nav.spaces")}
                </span>
                <button
                  aria-label={t("nav.newSpace")}
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => onOpenSpaceDialog({})}
                  type="button"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </div>
              <SpaceTreeView
                activeSpaceId={
                  pathname.startsWith("/spaces/") ? pathname.slice("/spaces/".length) : null
                }
                onOpenSpaceDialog={onOpenSpaceDialog}
                onQuickCreateDoc={(space) => {
                  onCloseDrawers();
                  onOpenNewDoc({
                    spaceId: space.id,
                    kind: space.defaultKind ?? "article",
                  });
                }}
                onPublishGarden={(space) => {
                  onCloseDrawers();
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new CustomEvent("inkade:open-garden-dialog", {
                        detail: {
                          sourceType: "space",
                          sourceId: space.id,
                          suggestedTitle: space.name,
                        },
                      }),
                    );
                  }
                }}
                onSelectSpace={onCloseDrawers}
                spaceDocCountMap={spaceDocCountMap}
                spaces={spaces}
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/85">
                {t("nav.agentSection")}
              </div>
              <GlideHighlight
                className="flex flex-col gap-0.5"
                highlightClassName="rounded-md bg-sidebar-accent/75"
                mode="pointer"
              >
                <SidebarNavLink
                  active={pathname === "/threads"}
                  badge={
                    attentionThreadsCount > 0
                      ? String(attentionThreadsCount)
                      : runningThreadsCount > 0
                        ? String(runningThreadsCount)
                        : undefined
                  }
                  icon={
                    <span className="relative inline-flex shrink-0 items-center">
                      <MessageSquareCodeIcon
                        className={cn(
                          "size-4",
                          pathname === "/threads" ? "text-foreground" : "text-muted-foreground",
                        )}
                      />
                      {attentionThreadsCount > 0 || runningThreadsCount > 0 ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute -top-0.5 -right-0.5 size-1.5 rounded-full",
                            attentionThreadsCount > 0
                              ? "bg-amber-500"
                              : "bg-blue-500 animate-pulse",
                          )}
                          data-motion-essential={runningThreadsCount > 0 ? "pulse" : undefined}
                        />
                      ) : null}
                    </span>
                  }
                  label={t("nav.threads")}
                  onNavigate={onCloseDrawers}
                  shortcut="G T"
                  to="/threads"
                />
                <SidebarNavLink
                  active={pathname === "/ask"}
                  icon={
                    <SparklesIcon
                      className={cn(
                        "size-4 shrink-0",
                        pathname === "/ask" ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                  }
                  label={t("nav.askInkade")}
                  onNavigate={onCloseDrawers}
                  shortcut="G A"
                  to="/ask"
                />
                <SidebarNavLink
                  active={pathname === "/connect"}
                  icon={
                    <PlugZapIcon
                      className={cn(
                        "size-4 shrink-0",
                        pathname === "/connect" ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                  }
                  label={t("nav.connectAi")}
                  onNavigate={onCloseDrawers}
                  shortcut="G C"
                  to="/connect"
                />
              </GlideHighlight>
            </div>

            <SidebarViewsAndTagsSection
              activeLibraryTag={activeLibraryTag}
              activeSavedViewId={activeSavedViewId}
              expandedTagPaths={expandedTagPaths}
              nestedTagTree={nestedTagTree}
              onDeleteSavedView={(viewId) => deleteSavedViewMutation.mutate(viewId)}
              onOpenSavedView={handleOpenSavedView}
              onOpenSavedViewDialog={onOpenSavedViewDialog}
              onPublishSavedView={(view) => {
                onCloseDrawers();
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("inkade:open-garden-dialog", {
                      detail: {
                        sourceType: "saved_view",
                        sourceId: view.id,
                        suggestedTitle: view.name,
                      },
                    }),
                  );
                }
              }}
              onSelectTag={(tagPath) => {
                onCloseDrawers();
                void navigate({ to: "/library", search: { tag: tagPath } });
              }}
              onToggleTagExpand={toggleTagExpand}
              onToggleTagsExpanded={() => setTagsExpanded((prev) => !prev)}
              savedViews={savedViews}
              tagsExpanded={tagsExpanded}
            />

            <Separator />

            <GlideHighlight
              className="flex flex-col gap-0.5 pb-2"
              highlightClassName="rounded-md bg-sidebar-accent/75"
              mode="pointer"
            >
              <SidebarNavLink
                active={pathname === "/trash"}
                icon={<Trash2Icon className="size-4 text-muted-foreground" />}
                label={t("nav.trash")}
                onNavigate={onCloseDrawers}
                to="/trash"
              />
              <SidebarNavLink
                active={isSettingsRoute}
                icon={<SettingsIcon className="size-4 text-muted-foreground" />}
                label={t("nav.settingsAndMcp")}
                onNavigate={onCloseDrawers}
                shortcut="⌘,"
                to="/settings"
              />
              {isNativeMobileShell() ? (
                <button
                  className="relative z-10 flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground transition-colors duration-[var(--duration-micro)] hover:bg-sidebar-accent/70 in-data-[glide-visible=true]:hover:bg-transparent hover:text-sidebar-accent-foreground"
                  data-glide-item
                  onClick={() => {
                    onCloseDrawers();
                    postToNativeShell({ kind: "open_shell_settings" });
                  }}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <SmartphoneIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{t("mobile.shell.openShellControls")}</span>
                  </span>
                </button>
              ) : null}
            </GlideHighlight>
          </div>
        )}
      </ScrollArea>

      {!isPeek ? (
        <OnboardingGuideCard
          onNavigate={(to) => {
            onCloseDrawers();
            void navigate({ to });
          }}
          onOpenCommandPalette={() => {
            onCloseDrawers();
            onOpenCommandPalette();
          }}
          onOpenSettings={() => {
            onCloseDrawers();
            onOpenSettingsModal();
          }}
          variant="sidebar"
        />
      ) : null}

      {docSidebarPanel ? (
        <div className="shrink-0 px-3 pt-1.5 pb-1">
          <SegmentedControl
            aria-label={t("nav.sidebarModeGroupAria")}
            className="w-full"
            size="sm"
          >
            <SegmentedControlItem
              className="flex-1"
              data-pressed={effectiveSidebarMode === "tree" ? "" : undefined}
              onClick={() => onChangeSidebarMode("tree")}
            >
              <FolderTreeIcon />
              <span>{t("nav.sidebarModeTree")}</span>
            </SegmentedControlItem>
            <SegmentedControlItem
              className="flex-1"
              data-pressed={effectiveSidebarMode === "doc" ? "" : undefined}
              onClick={() => onChangeSidebarMode("doc")}
            >
              <FileTextIcon />
              <span>{t("nav.sidebarModeDoc")}</span>
            </SegmentedControlItem>
          </SegmentedControl>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-sidebar-border/60 py-2 pl-2.5 pr-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              realtimeState === "connected"
                ? "bg-success"
                : realtimeState === "reconnecting"
                  ? "bg-warning animate-pulse"
                  : "bg-muted-foreground/50",
            )}
            data-motion-essential={realtimeState === "reconnecting" ? "pulse" : undefined}
          />
          <span className="truncate text-xs text-muted-foreground">{realtimeStatusText}</span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {isNativeMobileShell() ? (
            <Button
              aria-label={t("mobile.shell.openShellControls")}
              onClick={() => {
                onCloseDrawers();
                postToNativeShell({ kind: "open_shell_settings" });
              }}
              size="icon-xs"
              title={t("mobile.shell.openShellControls")}
              variant="ghost"
            >
              <SmartphoneIcon />
            </Button>
          ) : null}
          {!isDrawer ? (
            <>
              <Button
                aria-label={t("nav.keyboardShortcuts")}
                onClick={() => {
                  onCloseDrawers();
                  onOpenShortcuts();
                }}
                size="icon-xs"
                title={t("nav.keyboardShortcuts")}
                variant="ghost"
              >
                <KeyboardIcon />
              </Button>
              <Button
                aria-label={t("nav.openSettingsModal")}
                onClick={() => {
                  onCloseDrawers();
                  onOpenSettingsModal();
                }}
                size="icon-xs"
                title={t("nav.openSettingsModal")}
                variant="ghost"
              >
                <SettingsIcon />
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
