import {
  asSpaceId,
  countUnifiedInboxBadge,
  type DocumentRecord,
  isDarkSurfaceTheme,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  type ActiveAgentToolCall,
  useInkadeAuditBatches,
  useInkadeBriefingRuns,
  useInkadeDocuments,
  useInkadeSpaces,
  useInkadeThreadBindings,
  useInkadeWhoami,
} from "@inkade/sdk/react";
import {
  Button,
  cn,
  Kbd,
  Tooltip,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@inkade/ui";
import { useMotionProfile, useSurfaceTheme } from "@inkade/views/lib/preferences-store";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChevronsUpDownIcon,
  MenuIcon,
  MoonIcon,
  PanelLeftOpenIcon,
  PanelRightIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { runWithThemeRipple } from "../lib/theme.ts";
import { MobileNavChrome, type MobileNavChromeProps } from "./top-header/MobileNavChrome.tsx";
import { MobileViewSwitcherSheet } from "./top-header/MobileViewSwitcherSheet.tsx";
import { resolveMobileRouteMeta, TopHeaderBreadcrumb } from "./top-header/TopHeaderBreadcrumb.tsx";

export { MobileNavChrome, type MobileNavChromeProps };

export interface TopHeaderBarProps {
  readonly pathname: string;
  readonly searchStr: string;
  readonly isSettingsRoute: boolean;
  readonly sidebarCollapsed: boolean;
  readonly inspectorOpen: boolean;
  readonly scrolled?: boolean | undefined;
  readonly scrollProgress?: number | undefined;
  readonly inspectorDoc: DocumentRecord | null;
  readonly realtimeState: string;
  readonly reconnectAttempt: number;
  readonly activeAgentTools?: readonly ActiveAgentToolCall[] | undefined;
  readonly hideSidebarTrigger?: boolean | undefined;
  readonly hideQuickCapture?: boolean | undefined;
  readonly hideInspector?: boolean | undefined;
  readonly onOpenMobileNav: () => void;
  readonly onExpandSidebar: () => void;
  readonly onOpenCommandPalette: () => void;
  readonly onOpenQuickCapture: () => void;
  readonly onToggleInspector: () => void;
  readonly onBackToWorkspace: () => void;
}

export function TopHeaderBar({
  pathname,
  searchStr,
  isSettingsRoute,
  sidebarCollapsed,
  inspectorOpen,
  scrolled = false,
  scrollProgress,
  inspectorDoc,
  realtimeState,
  reconnectAttempt,
  activeAgentTools = [],
  hideSidebarTrigger = false,
  hideQuickCapture = false,
  hideInspector = false,
  onOpenMobileNav,
  onExpandSidebar,
  onOpenCommandPalette,
  onOpenQuickCapture,
  onToggleInspector,
  onBackToWorkspace,
}: TopHeaderBarProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const navigate = useNavigate();
  const { surfaceTheme, toggledSurfaceTheme, setSurfaceTheme } = useSurfaceTheme();
  const { motionProfile } = useMotionProfile();
  const isDarkSurface = isDarkSurfaceTheme(surfaceTheme);
  const headerRef = useRef<HTMLElement | null>(null);
  const headerTooltipHandle = useMemo(() => TooltipCreateHandle<string>(), []);
  const [mobileSwitcherOpen, setMobileSwitcherOpen] = useState(false);

  useEffect(() => {
    headerTooltipHandle.close();
  }, [headerTooltipHandle, pathname, searchStr]);

  useEffect(() => {
    const onOpenReview = (): void => {
      void navigate({ to: "/inbox", search: { tab: "digest" } });
    };
    window.addEventListener("inkade:open-review-center", onOpenReview);
    return () => window.removeEventListener("inkade:open-review-center", onOpenReview);
  }, [navigate]);

  useEffect(() => {
    const headerEl = headerRef.current;
    if (!headerEl) return;
    if (scrollProgress !== undefined) {
      const clamped = Math.min(1, Math.max(0, scrollProgress));
      headerEl.style.setProperty("--header-scroll-opacity", String(clamped));
      return;
    }

    const scrollContainer = headerEl.nextElementSibling;
    if (!(scrollContainer instanceof HTMLElement)) {
      headerEl.style.setProperty("--header-scroll-opacity", scrolled ? "1" : "0");
      return;
    }

    let rafId: number | null = null;
    const syncScroll = (): void => {
      rafId = null;
      const ratio = Math.min(1, Math.max(0, scrollContainer.scrollTop / 24));
      headerEl.style.setProperty("--header-scroll-opacity", String(ratio));
    };

    const scheduleSync = (): void => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(syncScroll);
    };

    syncScroll();
    scrollContainer.addEventListener("scroll", scheduleSync, { passive: true });
    return () => {
      scrollContainer.removeEventListener("scroll", scheduleSync);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [pathname, scrollProgress, scrolled]);

  const whoamiQuery = useInkadeWhoami();
  const isAdminPrincipal =
    whoamiQuery.data?.scope.permission === "admin" &&
    whoamiQuery.data?.scope.spaceIds === "*";
  const spacesQuery = useInkadeSpaces();
  const docsQuery = useInkadeDocuments({ limit: 300 });
  const bindingsQuery = useInkadeThreadBindings({});
  const briefingRunsQuery = useInkadeBriefingRuns({ status: "failed", undismissedOnly: true, limit: 50 });
  const auditBatchesQuery = useInkadeAuditBatches(10, { enabled: isAdminPrincipal });
  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const docs = useMemo(() => docsQuery.data ?? [], [docsQuery.data]);
  const bindings = useMemo(() => bindingsQuery.data ?? [], [bindingsQuery.data]);
  const inboxSpaceId = useMemo(
    () => spaces.find((s) => s.slug === "inbox")?.id ?? asSpaceId("spc_inbox"),
    [spaces],
  );
  const exceptionsCount = useMemo(
    () =>
      countUnifiedInboxBadge({
        docs,
        bindings,
        briefingRuns: briefingRunsQuery.data ?? [],
        inboxSpaceId,
      }),
    [bindings, briefingRunsQuery.data, docs, inboxSpaceId],
  );
  const recentBatchesCount = auditBatchesQuery.data?.length ?? 0;

  const mobileCurrentRoute = useMemo(
    () =>
      resolveMobileRouteMeta({
        pathname,
        searchStr,
        isSettingsRoute,
        spaces,
        docs,
        inspectorDoc,
        t,
      }),
    [docs, inspectorDoc, isSettingsRoute, pathname, searchStr, spaces, t],
  );

  const realtimeStatusText =
    realtimeState === "connected"
      ? t("nav.realtimeConnected")
      : realtimeState === "reconnecting"
        ? t("nav.realtimeReconnecting", { attempt: reconnectAttempt })
        : t("nav.realtimeConnecting");

  const themeToggleLabel = isDarkSurface ? t("nav.switchToLight") : t("nav.switchToDark");
  const resolvedScrollOpacity =
    scrollProgress !== undefined
      ? Math.min(1, Math.max(0, scrollProgress))
      : undefined;

  return (
    <TooltipProvider closeDelay={0} delay={80}>
      <header
        className={cn(
          "sticky top-0 z-20 flex h-11 shrink-0 items-center justify-between gap-1 bg-background/95 px-2 backdrop-blur-sm sm:gap-2 sm:px-3 lg:px-5",
          isSettingsRoute && "md:hidden",
        )}
        data-slot="app-topbar"
        ref={headerRef}
      >
        <div className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1.5">
          {!hideSidebarTrigger ? (
            <TooltipTrigger
              handle={headerTooltipHandle}
              payload={t("nav.openMenu")}
              render={
                <Button
                  aria-label={t("nav.openMenu")}
                  className="shrink-0 lg:hidden"
                  onClick={onOpenMobileNav}
                  size="icon-sm"
                  variant="ghost"
                >
                  <MenuIcon />
                </Button>
              }
            />
          ) : null}
          {!isSettingsRoute && !hideSidebarTrigger && sidebarCollapsed ? (
            <TooltipTrigger
              handle={headerTooltipHandle}
              payload={t("nav.expandSidebar")}
              render={
                <Button
                  aria-label={t("nav.expandSidebar")}
                  className="hidden shrink-0 lg:inline-flex"
                  onClick={onExpandSidebar}
                  size="icon-sm"
                  variant="ghost"
                >
                  <PanelLeftOpenIcon />
                </Button>
              }
            />
          ) : null}
          {!isSettingsRoute ? (
            <TooltipTrigger
              handle={headerTooltipHandle}
              payload={t("nav.searchOrCommand")}
              render={
                <Button
                  aria-label={t("nav.searchOrCommand")}
                  className="shrink-0 md:hidden"
                  onClick={onOpenCommandPalette}
                  size="icon-sm"
                  variant="ghost"
                >
                  <SearchIcon />
                </Button>
              }
            />
          ) : null}
          <nav
            aria-label={t("nav.breadcrumbAria")}
            className="min-w-0 flex-1 overflow-hidden pl-0.5"
          >
            <div className="hidden min-w-0 items-center md:flex">
              <TopHeaderBreadcrumb
                docs={docs}
                inspectorDoc={inspectorDoc}
                isSettingsRoute={isSettingsRoute}
                pathname={pathname}
                searchStr={searchStr}
                spaces={spaces}
              />
            </div>
            <button
              aria-label={t("nav.mobileViewSwitcherAria")}
              className="inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md border border-border/65 bg-muted/45 px-1.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent sm:gap-1.5 sm:px-2 md:hidden"
              data-slot="mobile-view-switcher-trigger"
              onClick={() => setMobileSwitcherOpen(true)}
              type="button"
            >
              {mobileCurrentRoute.icon}
              <span className="min-w-0 truncate">{mobileCurrentRoute.label}</span>
              {mobileCurrentRoute.meta ? (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {mobileCurrentRoute.meta}
                </span>
              ) : null}
              {(exceptionsCount > 0 || activeAgentTools.length > 0) && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    activeAgentTools.length > 0 ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
              )}
              <ChevronsUpDownIcon className="size-3 shrink-0 opacity-60" />
            </button>
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          {activeAgentTools.length > 0 && activeAgentTools[0] ? (
            <span
              aria-label={t("nav.agentToolAria", { count: activeAgentTools.length })}
              className="hidden items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/15 dark:text-emerald-300 sm:inline-flex"
              data-slot="topbar-agent-activity"
              role="status"
              title={
                activeAgentTools[0].tokenName
                  ? t("nav.agentToolActiveWithToken", {
                      token: activeAgentTools[0].tokenName,
                      tool: activeAgentTools[0].toolName,
                    })
                  : t("nav.agentToolActive", { tool: activeAgentTools[0].toolName })
              }
            >
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-emerald-500 animate-pulse dark:bg-emerald-400"
                data-motion-essential="pulse"
              />
              <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                {activeAgentTools[0].tokenName ? (
                  <>
                    <span className="max-w-28 truncate opacity-85">
                      {activeAgentTools[0].tokenName}
                    </span>
                    <span aria-hidden="true">·</span>
                  </>
                ) : null}
                <span className="max-w-44 shrink-0 truncate font-semibold">
                  {activeAgentTools[0].toolName}
                </span>
              </span>
              {activeAgentTools.length > 1 ? (
                <span className="shrink-0 font-mono text-[10px] opacity-80">
                  {t("nav.agentToolMore", { count: activeAgentTools.length - 1 })}
                </span>
              ) : null}
            </span>
          ) : null}

          <TooltipTrigger
            handle={headerTooltipHandle}
            payload={realtimeStatusText}
            render={
              <span
                aria-label={realtimeStatusText}
                className="hidden items-center gap-1.5 px-1.5 py-1 sm:inline-flex"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    realtimeState === "connected"
                      ? "bg-success"
                      : realtimeState === "reconnecting"
                        ? "bg-warning animate-pulse"
                        : "bg-muted-foreground/50",
                  )}
                  data-motion-essential={realtimeState === "reconnecting" ? "pulse" : undefined}
                />
              </span>
            }
          />

          <TooltipTrigger
            handle={headerTooltipHandle}
            payload={themeToggleLabel}
            render={
              <Button
                aria-label={themeToggleLabel}
                className="transition-[transform,color,background-color,border-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] active:scale-[0.97]"
                onClick={(event) => {
                  runWithThemeRipple(
                    () => setSurfaceTheme(toggledSurfaceTheme),
                    event,
                    { motionProfile },
                  );
                }}
                size="icon-xs"
                variant="ghost"
              >
                {isDarkSurface ? <SunIcon /> : <MoonIcon />}
              </Button>
            }
          />

          {isSettingsRoute ? (
            <Button
              className="max-w-[8.5rem] shrink-0 transition-[transform,color,background-color,border-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] active:scale-[0.985] sm:max-w-none"
              onClick={onBackToWorkspace}
              size="xs"
              variant="outline"
            >
              <ArrowLeftIcon className="shrink-0" />
              <span className="truncate">{t("common.backToWorkspace")}</span>
            </Button>
          ) : (
            <>
              {exceptionsCount > 0 ? (
                <TooltipTrigger
                  handle={headerTooltipHandle}
                  payload={t("reviewCenter.quietActivityExceptions", { count: exceptionsCount })}
                  render={
                    <Button
                      aria-label={t("reviewCenter.quietActivityExceptions", {
                        count: exceptionsCount,
                      })}
                      className="hidden gap-1.5 text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200 sm:inline-flex"
                      data-slot="topbar-quiet-activity-pill"
                      onClick={() => void navigate({ to: "/inbox", search: { tab: "exceptions" } })}
                      size="xs"
                      variant="ghost"
                    >
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
                      <span className="tabular-nums">
                        {t("reviewCenter.quietActivityExceptions", { count: exceptionsCount })}
                      </span>
                    </Button>
                  }
                />
              ) : recentBatchesCount > 0 ? (
                <TooltipTrigger
                  handle={headerTooltipHandle}
                  payload={t("reviewCenter.quietActivityAria")}
                  render={
                    <Button
                      aria-label={t("reviewCenter.quietActivityAria")}
                      className="hidden gap-1.5 text-muted-foreground hover:text-foreground sm:inline-flex"
                      data-slot="topbar-quiet-activity-pill"
                      onClick={() => void navigate({ to: "/threads" })}
                      size="xs"
                      variant="ghost"
                    >
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-emerald-500/80"
                      />
                      <span className="tabular-nums">
                        {t("reviewCenter.quietActivityBatches", { count: recentBatchesCount })}
                      </span>
                    </Button>
                  }
                />
              ) : null}
              {!hideQuickCapture ? (
                <TooltipTrigger
                  handle={headerTooltipHandle}
                  payload={t("nav.quickCaptureAria")}
                  render={
                    <Button
                      className="hidden text-muted-foreground hover:text-foreground sm:inline-flex"
                      onClick={onOpenQuickCapture}
                      size="xs"
                      variant="ghost"
                    >
                      <PlusIcon />
                      {t("nav.quickCapture")}
                    </Button>
                  }
                />
              ) : null}
              {!hideInspector ? (
                <TooltipTrigger
                  handle={headerTooltipHandle}
                  payload={t("nav.toggleInspector")}
                  render={
                    <Button
                      aria-label={t("nav.toggleInspector")}
                      aria-pressed={inspectorOpen}
                      className="transition-[transform,color,background-color,border-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] active:scale-[0.985]"
                      onClick={onToggleInspector}
                      size="xs"
                      variant={inspectorOpen ? "secondary" : "ghost"}
                    >
                      <PanelRightIcon />
                      <span className="hidden sm:inline">{t("nav.inspector")}</span>
                      <Kbd className="hidden md:inline-flex">⌘.</Kbd>
                    </Button>
                  }
                />
              ) : null}
            </>
          )}
        </div>

        <Tooltip handle={headerTooltipHandle}>
          {({ payload }) => (
            <TooltipPopup side="bottom">
              <span>{payload ?? ""}</span>
            </TooltipPopup>
          )}
        </Tooltip>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-full h-2.5 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]"
          data-slot="top-header-optical-fade"
          style={{
            opacity: resolvedScrollOpacity ?? (scrolled ? 1 : "var(--header-scroll-opacity, 0)"),
            background:
              "linear-gradient(to bottom, color-mix(in srgb, var(--foreground) 4%, transparent), transparent)",
          }}
        />
      </header>

      <MobileViewSwitcherSheet
        activeAgentTools={activeAgentTools}
        exceptionsCount={exceptionsCount}
        hideQuickCapture={hideQuickCapture}
        isSettingsRoute={isSettingsRoute}
        onOpenChange={setMobileSwitcherOpen}
        onOpenQuickCapture={onOpenQuickCapture}
        open={mobileSwitcherOpen}
        pathname={pathname}
        realtimeState={realtimeState}
        realtimeStatusText={realtimeStatusText}
        recentBatchesCount={recentBatchesCount}
      />
    </TooltipProvider>
  );
}
