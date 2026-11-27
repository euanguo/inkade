import { asDocumentId, type DocumentId, type DocumentKind, type DocumentRecord } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import { useInkadeDocuments } from "@inkade/sdk/react";
import { Button, cn } from "@inkade/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDaysIcon,
  CheckSquareIcon,
  FileTextIcon,
  FolderTreeIcon,
  InboxIcon,
  ListTreeIcon,
  MessageSquareTextIcon,
  PaperclipIcon,
  PlugZapIcon,
  PlusIcon,
  RotateCcwIcon,
  SettingsIcon,
  Share2Icon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo } from "react";
import {
  shouldShowWorkspaceTabStrip,
  useWorkspaceTabsStore,
  type WorkspaceTabInput,
  type WorkspaceTabItem,
  type WorkspaceTabRouteKind,
} from "@inkade/views/lib/workspace-tabs-store";

export interface WorkspaceTabStripProps {
  readonly enabled: boolean;
  readonly isDesktop: boolean;
  readonly pathname: string;
  readonly searchStr: string;
  readonly onNavigatePath: (path: string) => void;
  readonly onOpenCommandPalette: () => void;
}

type WorkspaceTabTitleKey =
  | "tabs.daily"
  | "tabs.tasks"
  | "tabs.inbox"
  | "tabs.ask"
  | "tabs.graph"
  | "tabs.library"
  | "tabs.threads"
  | "tabs.connectAi"
  | "tabs.settings"
  | "tabs.untitled";

function classifyRouteTab(
  pathname: string,
  searchStr: string,
  t: (key: WorkspaceTabTitleKey) => string,
  docLookup: ReadonlyMap<DocumentId, { readonly title: string; readonly kind: DocumentKind }>,
): WorkspaceTabInput | null {
  if (pathname.startsWith("/share/") || pathname.startsWith("/site/") || pathname === "/pair") {
    return null;
  }

  const fullPath = searchStr ? `${pathname}${searchStr}` : pathname;
  if (pathname === "/" || pathname === "/daily" || pathname.startsWith("/daily/")) {
    const suffix = pathname.startsWith("/daily/")
      ? pathname.slice("/daily/".length).split("/")[0]
      : undefined;
    return {
      path: fullPath,
      routeKind: "daily",
      title: suffix ? `${t("tabs.daily")} · ${suffix}` : t("tabs.daily"),
    };
  }
  if (pathname.startsWith("/tasks")) {
    return { path: fullPath, routeKind: "tasks", title: t("tabs.tasks") };
  }
  if (pathname.startsWith("/inbox")) {
    return { path: fullPath, routeKind: "inbox", title: t("tabs.inbox") };
  }
  if (pathname.startsWith("/ask")) {
    return { path: fullPath, routeKind: "ask", title: t("tabs.ask") };
  }
  if (pathname.startsWith("/graph")) {
    return { path: fullPath, routeKind: "graph", title: t("tabs.graph") };
  }
  if (pathname.startsWith("/library") || pathname.startsWith("/spaces/")) {
    return { path: fullPath, routeKind: "library", title: t("tabs.library") };
  }
  if (pathname.startsWith("/threads")) {
    return { path: fullPath, routeKind: "threads", title: t("tabs.threads") };
  }
  if (pathname.startsWith("/connect")) {
    return { path: fullPath, routeKind: "connect-ai", title: t("tabs.connectAi") };
  }
  if (pathname.startsWith("/settings")) {
    return { path: fullPath, routeKind: "settings", title: t("tabs.settings") };
  }
  if (pathname.startsWith("/docs/")) {
    const rawId = decodeURIComponent(pathname.slice("/docs/".length).split("/")[0] ?? "");
    const docId = rawId ? asDocumentId(rawId) : undefined;
    const matched = docId ? docLookup.get(docId) : undefined;
    return {
      path: fullPath,
      routeKind: "doc",
      docId,
      kind: matched?.kind,
      title: matched?.title ?? rawId ?? t("tabs.untitled"),
    };
  }

  return { path: fullPath, routeKind: "other", title: t("tabs.untitled") };
}

function renderTabIcon(tab: WorkspaceTabItem): React.ReactElement {
  switch (tab.routeKind) {
    case "daily":
      return <CalendarDaysIcon className="size-3.5 shrink-0 opacity-70" />;
    case "tasks":
      return <CheckSquareIcon className="size-3.5 shrink-0 opacity-70" />;
    case "inbox":
      return <InboxIcon className="size-3.5 shrink-0 opacity-70" />;
    case "ask":
      return <MessageSquareTextIcon className="size-3.5 shrink-0 opacity-70" />;
    case "graph":
      return <Share2Icon className="size-3.5 shrink-0 opacity-70" />;
    case "library":
      return <FolderTreeIcon className="size-3.5 shrink-0 opacity-70" />;
    case "connect-ai":
      return <PlugZapIcon className="size-3.5 shrink-0 opacity-70" />;
    case "settings":
      return <SettingsIcon className="size-3.5 shrink-0 opacity-70" />;
    case "doc":
      if (tab.kind === "outline") return <ListTreeIcon className="size-3.5 shrink-0 opacity-70" />;
      if (tab.kind === "clip") return <PaperclipIcon className="size-3.5 shrink-0 opacity-70" />;
      return <FileTextIcon className="size-3.5 shrink-0 opacity-70" />;
    default:
      return <FileTextIcon className="size-3.5 shrink-0 opacity-70" />;
  }
}

export function WorkspaceTabStrip({
  enabled,
  isDesktop,
  pathname,
  searchStr,
  onNavigatePath,
  onOpenCommandPalette,
}: WorkspaceTabStripProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const queryClient = useQueryClient();
  const docsQuery = useInkadeDocuments({ limit: 300 }, { enabled });
  const tabs = useWorkspaceTabsStore((s) => s.tabs);
  const activeTabId = useWorkspaceTabsStore((s) => s.activeTabId);
  const closedTabs = useWorkspaceTabsStore((s) => s.closedTabs);
  const openTab = useWorkspaceTabsStore((s) => s.openTab);
  const syncRouteToActiveTab = useWorkspaceTabsStore((s) => s.syncRouteToActiveTab);
  const activateTab = useWorkspaceTabsStore((s) => s.activateTab);
  const closeTab = useWorkspaceTabsStore((s) => s.closeTab);
  const reopenLastClosedTab = useWorkspaceTabsStore((s) => s.reopenLastClosedTab);

  const docLookup = useMemo(() => {
    const map = new Map<DocumentId, { readonly title: string; readonly kind: DocumentKind }>();
    for (const doc of docsQuery.data ?? []) {
      map.set(doc.id, { title: doc.title, kind: doc.kind });
    }
    return map;
  }, [docsQuery.data]);

  useEffect(() => {
    if (!enabled) return;
    const translated = (key: WorkspaceTabTitleKey): string => t(key);
    const tabInput = classifyRouteTab(pathname, searchStr, translated, docLookup);
    if (!tabInput) return;

    let resolvedTabInput = tabInput;
    if (tabInput.routeKind === "doc" && tabInput.docId && !docLookup.has(tabInput.docId)) {
      const cachedDoc = queryClient.getQueryData<DocumentRecord>(
        inkadeQueryKeys.document(tabInput.docId),
      );
      if (cachedDoc) {
        resolvedTabInput = {
          ...tabInput,
          title: cachedDoc.title,
          kind: cachedDoc.kind,
        };
      }
    }

    const store = useWorkspaceTabsStore.getState();
    const resolvedBasePath = resolvedTabInput.path.split("?")[0] ?? resolvedTabInput.path;
    const existingTab = store.tabs.find(
      (item) =>
        item.path === resolvedTabInput.path ||
        (resolvedTabInput.routeKind === "doc" &&
          resolvedTabInput.docId &&
          item.docId === resolvedTabInput.docId) ||
        (resolvedTabInput.routeKind !== "doc" &&
          resolvedTabInput.routeKind !== "other" &&
          (item.path.split("?")[0] ?? item.path) === resolvedBasePath),
    );
    if (existingTab) {
      syncRouteToActiveTab(resolvedTabInput);
      return;
    }

    const currentActiveTab = store.tabs.find((item) => item.id === store.activeTabId);
    if (
      resolvedTabInput.routeKind === "doc" &&
      currentActiveTab?.routeKind === "doc" &&
      currentActiveTab.docId &&
      resolvedTabInput.docId &&
      currentActiveTab.docId !== resolvedTabInput.docId
    ) {
      openTab(resolvedTabInput, { inNewTab: true });
      return;
    }

    syncRouteToActiveTab(resolvedTabInput);
  }, [docLookup, enabled, openTab, pathname, queryClient, searchStr, syncRouteToActiveTab, t]);

  const showStrip = isDesktop && shouldShowWorkspaceTabStrip(enabled, tabs.length);
  if (!showStrip) {
    return null;
  }

  return (
    <div
      aria-label={t("tabs.enableLabel")}
      className="hidden h-9 shrink-0 items-center gap-1 border-b border-border/70 bg-muted/25 px-2 lg:flex print:hidden"
      role="tablist"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const displayTitle =
            tab.docId && docLookup.has(tab.docId)
              ? (docLookup.get(tab.docId)?.title ?? tab.title)
              : tab.title;
          return (
            <div
              aria-selected={isActive}
              className={cn(
                "group flex h-7 max-w-[200px] min-w-[96px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                isActive
                  ? "border-border bg-background font-medium text-foreground shadow-2xs"
                  : "border-transparent bg-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
              key={tab.id}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  const next = closeTab(tab.id);
                  if (isActive && next) {
                    onNavigatePath(next.path);
                  }
                }
              }}
              role="tab"
            >
              <button
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left focus-visible:outline-none"
                onClick={() => {
                  const target = activateTab(tab.id);
                  if (target) {
                    onNavigatePath(target.path);
                  }
                }}
                title={displayTitle}
                type="button"
              >
                {renderTabIcon(tab)}
                <span className="truncate">{displayTitle}</span>
              </button>

              <button
                aria-label={t("tabs.closeTab")}
                className={cn(
                  "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground",
                  isActive ? "opacity-75 hover:opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  const next = closeTab(tab.id);
                  if (isActive && next) {
                    onNavigatePath(next.path);
                  }
                }}
                title={t("tabs.closeTab")}
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pl-1">
        {closedTabs.length > 0 ? (
          <Button
            aria-label={t("tabs.reopenClosedTab")}
            onClick={() => {
              const restored = reopenLastClosedTab();
              if (restored) {
                onNavigatePath(restored.path);
              }
            }}
            size="icon-xs"
            title={t("tabs.reopenClosedTab")}
            variant="ghost"
          >
            <RotateCcwIcon className="size-3.5" />
          </Button>
        ) : null}

        <Button
          aria-label={t("tabs.newTab")}
          onClick={onOpenCommandPalette}
          size="icon-xs"
          title={t("tabs.newTab")}
          variant="ghost"
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export type { WorkspaceTabRouteKind };
