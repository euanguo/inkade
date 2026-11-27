import {
  asDocumentId,
  asSpaceId,
  clipperPairSearchSchema,
  type ClipperPairSearchParams,
  dailySearchSchema,
  type DailySearchParams,
  docDetailSearchSchema,
  type DocDetailSearchParams,
  inboxSearchSchema,
  type InboxSearchParams,
  librarySearchSchema,
  type LibrarySearchParams,
  settingsSearchSchema,
  type SettingsSearchParams,
  tasksSearchSchema,
  type TasksSearchParams,
  threadsSearchSchema,
  type ThreadsSearchParams,
  type OutlineNodeId,
} from "@inkade/core";
import type {
  DailyViewUrlState,
  DocumentListViewProps,
  InboxViewUrlState,
  LibraryViewUrlState,
  ShareTargetParams,
  TasksViewUrlState,
  ThreadsViewUrlState,
} from "@inkade/views";
import {
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorComponentProps,
  Navigate,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useInkadeTranslation } from "@inkade/i18n";
import { Button } from "@inkade/ui";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import type React from "react";
import { lazy, Suspense, useCallback } from "react";
import { AppShell } from "./components/AppShell.tsx";
import { AuthGate } from "./components/AuthGate.tsx";
import { RouteContentFallback } from "./components/RouteContentFallback.tsx";
import { getAppBasePath } from "./lib/base-path.ts";
import { resolveSettingsSection } from "./pages/settings/types.ts";

function lazyNamed<TModule extends Record<string, unknown>, TKey extends keyof TModule>(
  importer: () => Promise<TModule>,
  exportName: TKey,
): React.LazyExoticComponent<
  TModule[TKey] extends React.ComponentType<infer P>
    ? React.ComponentType<P>
    : React.ComponentType<Record<string, never>>
> {
  return lazy(async () => {
    const mod = await importer();
    return {
      default: mod[exportName] as TModule[TKey] extends React.ComponentType<infer P>
        ? React.ComponentType<P>
        : React.ComponentType<Record<string, never>>,
    };
  });
}

const LazyDailyOutlineView = lazyNamed(
  () => import("@inkade/views/views/DailyOutlineView"),
  "DailyOutlineView",
);
const LazyTasksView = lazyNamed(
  () => import("@inkade/views/views/TasksView"),
  "TasksView",
);
const LazyDocumentListView = lazyNamed(
  () => import("@inkade/views/views/DocumentListView"),
  "DocumentListView",
);
const LazyDocumentDetailView = lazyNamed(
  () => import("@inkade/views/views/DocumentDetailView"),
  "DocumentDetailView",
);
const LazyThreadsView = lazyNamed(
  () => import("@inkade/views/views/ThreadsView"),
  "ThreadsView",
);
const LazyAskPage = lazyNamed(() => import("./pages/AskPage.tsx"), "AskPage");
const LazyConnectAiPage = lazyNamed(
  () => import("./pages/ConnectAiPage.tsx"),
  "ConnectAiPage",
);
const LazyInboxView = lazyNamed(() => import("@inkade/views/views/inbox"), "InboxView");
const LazyTrashPage = lazyNamed(() => import("./pages/TrashPage.tsx"), "TrashPage");
const LazySettingsPage = lazyNamed(
  () => import("./pages/SettingsPage.tsx"),
  "SettingsPage",
);
const LazyPublicSharePage = lazyNamed(
  () => import("./pages/PublicSharePage.tsx"),
  "PublicSharePage",
);
const LazyPublicSitePage = lazyNamed(
  () => import("./pages/PublicSitePage.tsx"),
  "PublicSitePage",
);
const LazyGraphPage = lazyNamed(
  () => import("./pages/GraphPage.tsx"),
  "GraphPage",
);
const LazyClipperPairPage = lazyNamed(
  () => import("./pages/ClipperPairPage.tsx"),
  "ClipperPairPage",
);

function DailyRouteView({
  date,
  focusNodeId,
  urlState,
}: {
  readonly date?: string | undefined;
  readonly focusNodeId?: OutlineNodeId | undefined;
  readonly urlState?: DailyViewUrlState | undefined;
}) {
  const navigate = useNavigate();

  const handleUrlStateChange = useCallback(
    (patch: Partial<DailyViewUrlState>) => {
      if (date) {
        void navigate({
          to: "/daily/$date",
          params: { date },
          search: {
            ...(focusNodeId ? { nodeId: focusNodeId } : {}),
            ...urlState,
            ...patch,
          },
          replace: true,
        });
        return;
      }
      void navigate({
        to: "/daily",
        search: {
          ...urlState,
          ...patch,
        },
        replace: true,
      });
    },
    [date, focusNodeId, navigate, urlState],
  );

  return (
    <LazyDailyOutlineView
      date={date}
      focusNodeId={focusNodeId}
      onUrlStateChange={handleUrlStateChange}
      urlState={urlState}
    />
  );
}

function LibraryRouteView(props: DocumentListViewProps) {
  const navigate = useNavigate();

  const handleUrlStateChange = useCallback(
    (patch: Partial<LibraryViewUrlState>) => {
      const nextKind =
        patch.kind === "all"
          ? undefined
          : patch.kind ??
            (props.urlState?.kind === "all" ? undefined : props.urlState?.kind) ??
            props.initialKind;
      const mergedSearch = {
        ...(props.initialTag ? { tag: props.initialTag } : {}),
        ...(props.initialSpaceId ? { spaceId: props.initialSpaceId } : {}),
        ...(props.initialPinnedOnly ? { pinnedOnly: true } : {}),
        ...(props.initialUnreadOnly ? { unreadOnly: true } : {}),
        ...(props.activeViewId ? { viewId: props.activeViewId } : {}),
        ...props.urlState,
        ...patch,
        kind: nextKind,
      };
      if (props.spaceId) {
        void navigate({
          to: "/spaces/$spaceId",
          params: { spaceId: props.spaceId },
          search: mergedSearch,
          replace: true,
        });
        return;
      }
      void navigate({
        to: "/library",
        search: mergedSearch,
        replace: true,
      });
    },
    [
      navigate,
      props.activeViewId,
      props.initialKind,
      props.initialPinnedOnly,
      props.initialSpaceId,
      props.initialTag,
      props.initialUnreadOnly,
      props.spaceId,
      props.urlState,
    ],
  );

  return <LazyDocumentListView {...props} onUrlStateChange={handleUrlStateChange} />;
}

function TasksRouteView({ urlState }: { readonly urlState?: TasksViewUrlState | undefined }) {
  const navigate = useNavigate();

  const handleUrlStateChange = useCallback(
    (patch: Partial<TasksViewUrlState>) => {
      void navigate({
        to: "/tasks",
        search: {
          ...urlState,
          ...patch,
        },
        replace: true,
      });
    },
    [navigate, urlState],
  );

  return <LazyTasksView onUrlStateChange={handleUrlStateChange} urlState={urlState} />;
}

function ThreadsRouteView({ urlState }: { readonly urlState?: ThreadsViewUrlState | undefined }) {
  const navigate = useNavigate();

  const handleUrlStateChange = useCallback(
    (patch: Partial<ThreadsViewUrlState>) => {
      void navigate({
        to: "/threads",
        search: {
          ...urlState,
          ...patch,
        },
        replace: true,
      });
    },
    [navigate, urlState],
  );

  return <LazyThreadsView onUrlStateChange={handleUrlStateChange} urlState={urlState} />;
}

function InboxRouteView({
  initialItemId,
  initialQuery,
  initialTab,
  shareTarget,
  urlState,
}: {
  readonly initialItemId?: string | undefined;
  readonly initialQuery?: string | undefined;
  readonly initialTab?: InboxViewUrlState["tab"] | undefined;
  readonly shareTarget?: ShareTargetParams | undefined;
  readonly urlState?: InboxViewUrlState | undefined;
}) {
  const navigate = useNavigate();

  const handleUrlStateChange = useCallback(
    (patch: Partial<InboxViewUrlState>) => {
      void navigate({
        to: "/inbox",
        search: {
          ...(shareTarget?.title ? { title: shareTarget.title } : {}),
          ...(shareTarget?.text ? { text: shareTarget.text } : {}),
          ...(shareTarget?.url ? { url: shareTarget.url } : {}),
          ...urlState,
          ...patch,
        },
        replace: true,
      });
    },
    [navigate, shareTarget?.text, shareTarget?.title, shareTarget?.url, urlState],
  );

  const handleClearShareTarget = useCallback(() => {
    void navigate({
      to: "/inbox",
      search: {
        ...urlState,
      },
      replace: true,
    });
  }, [navigate, urlState]);

  return (
    <LazyInboxView
      initialItemId={initialItemId}
      initialQuery={initialQuery}
      initialTab={initialTab}
      onClearShareTarget={handleClearShareTarget}
      onUrlStateChange={handleUrlStateChange}
      shareTarget={shareTarget}
      urlState={urlState}
    />
  );
}

function InkadeRouteErrorFallback({ error, reset }: ErrorComponentProps) {
  const { t } = useInkadeTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  const detail = error instanceof Error ? error.message : String(error);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6 text-foreground">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10 text-destructive">
            <AlertTriangleIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-base font-semibold text-foreground">{t("common.errorTitle")}</h1>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("common.errorDesc")}</p>
          </div>
        </div>
        {detail && (
          <pre className="max-h-32 overflow-auto rounded-md border border-border/70 bg-muted/40 px-3 py-2 font-mono text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
            {detail}
          </pre>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            onClick={() => {
              void navigate({ to: "/daily" });
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("common.errorBackToday")}
          </Button>
          <Button
            onClick={() => {
              reset();
              void router.invalidate();
            }}
            size="sm"
            type="button"
            variant="default"
          >
            <RotateCcwIcon className="size-3.5" />
            {t("common.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({
  errorComponent: InkadeRouteErrorFallback,
  component: function RootRouteComponent() {
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    if (pathname.startsWith("/share/") || pathname.startsWith("/site/")) {
      return (
        <Suspense fallback={<RouteContentFallback />}>
          <Outlet />
        </Suspense>
      );
    }
    return (
      <AuthGate>
        <AppShell />
      </AuthGate>
    );
  },
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/daily" />,
});

const dailyIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/daily",
  validateSearch: (search: Record<string, unknown>): DailySearchParams =>
    dailySearchSchema.parse(search),
  component: function DailyIndexRouteComponent() {
    const { view, kanbanGroup } = dailyIndexRoute.useSearch();
    return <DailyRouteView urlState={{ view, kanbanGroup }} />;
  },
});

const dailyDateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/daily/$date",
  validateSearch: (search: Record<string, unknown>): DailySearchParams =>
    dailySearchSchema.parse(search),
  component: function DailyDateRouteComponent() {
    const { date } = dailyDateRoute.useParams();
    const { nodeId, view, kanbanGroup } = dailyDateRoute.useSearch();
    return <DailyRouteView date={date} focusNodeId={nodeId} urlState={{ view, kanbanGroup }} />;
  },
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  validateSearch: (search: Record<string, unknown>): TasksSearchParams =>
    tasksSearchSchema.parse(search),
  component: function TasksRouteComponent() {
    const urlState = tasksRoute.useSearch();
    return <TasksRouteView urlState={urlState} />;
  },
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  validateSearch: (search: Record<string, unknown>): InboxSearchParams =>
    inboxSearchSchema.parse(search),
  component: function InboxRouteComponent() {
    const { title, text, url, tab, q, item } = inboxRoute.useSearch();
    const hasShareTarget = Boolean(title || text || url);
    return (
      <InboxRouteView
        initialItemId={item}
        initialQuery={q}
        initialTab={tab}
        shareTarget={hasShareTarget ? { title, text, url } : undefined}
        urlState={{ tab, q, item }}
      />
    );
  },
});

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library",
  validateSearch: (search: Record<string, unknown>): LibrarySearchParams =>
    librarySearchSchema.parse(search),
  component: function LibraryRouteComponent() {
    const { tag, spaceId, kind, pinnedOnly, unreadOnly, viewId, view, sort, dir, q, doc } =
      libraryRoute.useSearch();
    return (
      <LibraryRouteView
        activeViewId={viewId}
        initialKind={kind}
        initialPinnedOnly={pinnedOnly}
        initialSpaceId={spaceId}
        initialTag={tag}
        initialUnreadOnly={unreadOnly}
        urlState={{ view, sort, dir, kind, q, doc }}
      />
    );
  },
});

const spaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/spaces/$spaceId",
  validateSearch: (search: Record<string, unknown>): LibrarySearchParams =>
    librarySearchSchema.parse(search),
  component: function SpaceRouteComponent() {
    const { spaceId } = spaceRoute.useParams();
    const { tag, kind, pinnedOnly, unreadOnly, viewId, view, sort, dir, q, doc } =
      spaceRoute.useSearch();
    return (
      <LibraryRouteView
        activeViewId={viewId}
        initialKind={kind}
        initialPinnedOnly={pinnedOnly}
        initialTag={tag}
        initialUnreadOnly={unreadOnly}
        spaceId={asSpaceId(spaceId)}
        urlState={{ view, sort, dir, kind, q, doc }}
      />
    );
  },
});

const docRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/docs/$docId",
  validateSearch: (search: Record<string, unknown>): DocDetailSearchParams =>
    docDetailSearchSchema.parse(search),
  component: function DocRouteComponent() {
    const { docId } = docRoute.useParams();
    const { nodeId, heading, highlight, page, annotation } = docRoute.useSearch();
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <LazyDocumentDetailView
          documentId={asDocumentId(docId)}
          focusAnnotationId={annotation}
          focusHeading={heading}
          focusHighlightId={highlight}
          focusNodeId={nodeId}
          focusPage={page}
        />
      </div>
    );
  },
});

const askRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ask",
  component: () => <LazyAskPage />,
});

const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connect",
  component: () => <LazyConnectAiPage />,
});

const graphRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/graph",
  component: () => <LazyGraphPage />,
});

const threadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/threads",
  validateSearch: (search: Record<string, unknown>): ThreadsSearchParams =>
    threadsSearchSchema.parse(search),
  component: function ThreadsRouteComponent() {
    const urlState = threadsRoute.useSearch();
    return <ThreadsRouteView urlState={urlState} />;
  },
});

const trashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/trash",
  component: () => <LazyTrashPage />,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: (search: Record<string, unknown>): SettingsSearchParams =>
    settingsSearchSchema.parse(search),
  component: function SettingsIndexRouteComponent() {
    const { section } = settingsRoute.useSearch();
    return (
      <Navigate
        params={{ section: resolveSettingsSection(section) }}
        replace
        to="/settings/$section"
      />
    );
  },
});

const settingsSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  component: function SettingsSectionRouteComponent() {
    const { section } = settingsSectionRoute.useParams();
    const resolved = resolveSettingsSection(section);
    if (section !== resolved) {
      return <Navigate params={{ section: resolved }} replace to="/settings/$section" />;
    }
    return <LazySettingsPage section={resolved} />;
  },
});

const publicShareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/share/$token",
  component: function PublicShareRouteComponent() {
    const { token } = publicShareRoute.useParams();
    return <LazyPublicSharePage token={token} />;
  },
});

const publicSiteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/site/$slug",
  component: function PublicSiteRouteComponent() {
    const { slug } = publicSiteRoute.useParams();
    return <LazyPublicSitePage slug={slug} />;
  },
});

const publicSiteDocRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/site/$slug/$docSlug",
  component: function PublicSiteDocRouteComponent() {
    const { slug, docSlug } = publicSiteDocRoute.useParams();
    return <LazyPublicSitePage docSlug={docSlug} slug={slug} />;
  },
});

const clipperPairRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clipper/pair",
  validateSearch: (search: Record<string, unknown>): ClipperPairSearchParams =>
    clipperPairSearchSchema.parse(search),
  component: function ClipperPairRouteComponent() {
    const { nonce, serverUrl } = clipperPairRoute.useSearch();
    return <LazyClipperPairPage initialServerUrl={serverUrl} nonce={nonce} />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  dailyIndexRoute,
  dailyDateRoute,
  tasksRoute,
  inboxRoute,
  libraryRoute,
  spaceRoute,
  docRoute,
  threadsRoute,
  askRoute,
  graphRoute,
  connectRoute,
  trashRoute,
  settingsRoute,
  settingsSectionRoute,
  publicShareRoute,
  publicSiteRoute,
  publicSiteDocRoute,
  clipperPairRoute,
]);

const basepath = getAppBasePath();

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  ...(basepath ? { basepath } : {}),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
