import { useInkadeTranslation } from "@inkade/i18n";
import type { ActiveAgentToolCall } from "@inkade/sdk/react";
import {
  Badge,
  Button,
  cn,
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@inkade/ui";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  InboxIcon,
  LibraryIcon,
  MessageSquareCodeIcon,
  NetworkIcon,
  PlugZapIcon,
  SettingsIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";

export interface MobileViewSwitcherSheetProps {
  readonly open: boolean;
  readonly pathname: string;
  readonly isSettingsRoute: boolean;
  readonly hideQuickCapture: boolean;
  readonly realtimeState: string;
  readonly realtimeStatusText: string;
  readonly exceptionsCount: number;
  readonly recentBatchesCount: number;
  readonly activeAgentTools: readonly ActiveAgentToolCall[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenQuickCapture: () => void;
}

export function MobileViewSwitcherSheet({
  open,
  pathname,
  isSettingsRoute,
  hideQuickCapture: _hideQuickCapture,
  realtimeState,
  realtimeStatusText,
  exceptionsCount,
  recentBatchesCount,
  activeAgentTools,
  onOpenChange,
  onOpenQuickCapture: _onOpenQuickCapture,
}: MobileViewSwitcherSheetProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const navigate = useNavigate();

  const routeItems = [
    {
      to: "/daily" as const,
      label: t("nav.dailyToday"),
      icon: <CalendarDaysIcon className="size-4 shrink-0" />,
      active: pathname === "/daily" || pathname.startsWith("/daily/"),
    },
    {
      to: "/tasks" as const,
      label: t("nav.tasks"),
      icon: <CheckSquareIcon className="size-4 shrink-0" />,
      active: pathname === "/tasks",
    },
    {
      to: "/inbox" as const,
      label: t("nav.inbox"),
      icon: <InboxIcon className="size-4 shrink-0" />,
      active: pathname === "/inbox",
    },
    {
      to: "/library" as const,
      label: t("nav.library"),
      icon: <LibraryIcon className="size-4 shrink-0" />,
      active: pathname === "/library" || pathname.startsWith("/spaces/"),
    },
    {
      to: "/threads" as const,
      label: t("nav.threads"),
      icon: <MessageSquareCodeIcon className="size-4 shrink-0" />,
      active: pathname === "/threads",
    },
    {
      to: "/ask" as const,
      label: t("nav.askInkade"),
      icon: <SparklesIcon className="size-4 shrink-0" />,
      active: pathname === "/ask",
    },
    {
      to: "/graph" as const,
      label: t("graph.navTitle"),
      icon: <NetworkIcon className="size-4 shrink-0" />,
      active: pathname === "/graph",
    },
    {
      to: "/connect" as const,
      label: t("nav.connectAi"),
      icon: <PlugZapIcon className="size-4 shrink-0" />,
      active: pathname === "/connect",
    },
    {
      to: "/trash" as const,
      label: t("common.trash"),
      icon: <Trash2Icon className="size-4 shrink-0" />,
      active: pathname === "/trash",
    },
    {
      to: "/settings" as const,
      label: t("common.settings"),
      icon: <SettingsIcon className="size-4 shrink-0" />,
      active: isSettingsRoute,
    },
  ];

  return (
    <Drawer onOpenChange={onOpenChange} open={open} position="bottom">
      <DrawerPopup
        className="md:hidden"
        data-testid="mobile-view-switcher-sheet"
        showBar
        showCloseButton
      >
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-base">
            {t("nav.mobileWorkspaceSwitcherTitle")}
          </DrawerTitle>
          <DrawerDescription className="text-xs">
            {t("nav.mobileCurrentRouteHint")}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel
          className="flex max-h-[75dvh] flex-col gap-3 overflow-y-auto pt-1 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          scrollable={false}
        >
          <div className="grid grid-cols-2 gap-2">
            {routeItems.map((routeItem) => (
              <button
                className={cn(
                  "flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                  routeItem.active
                    ? "border-primary/50 bg-accent text-foreground"
                    : "border-border/75 bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                key={routeItem.to}
                onClick={() => {
                  onOpenChange(false);
                  void navigate({ to: routeItem.to });
                }}
                type="button"
              >
                {routeItem.icon}
                <span className="min-w-0 flex-1 truncate">{routeItem.label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    realtimeState === "connected"
                      ? "bg-success"
                      : realtimeState === "reconnecting"
                        ? "bg-warning animate-pulse"
                        : "bg-muted-foreground/50",
                  )}
                  data-motion-essential={
                    realtimeState === "reconnecting" ? "pulse" : undefined
                  }
                />
                <span>{realtimeStatusText}</span>
              </span>
              {activeAgentTools.length > 0 && activeAgentTools[0] && (
                <Badge size="sm" variant="info">
                  <SparklesIcon className="size-3" />
                  <span className="max-w-36 truncate font-mono">
                    {activeAgentTools[0].toolName}
                  </span>
                </Badge>
              )}
            </div>

            {exceptionsCount > 0 ? (
              <Button
                className="justify-between"
                onClick={() => {
                  onOpenChange(false);
                  void navigate({ to: "/inbox", search: { tab: "exceptions" } });
                }}
                size="sm"
                variant="outline"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="size-2 rounded-full bg-amber-500" />
                  <span>{t("reviewCenter.quietActivityExceptions", { count: exceptionsCount })}</span>
                </span>
                <ChevronRightIcon className="size-4" />
              </Button>
            ) : recentBatchesCount > 0 ? (
              <Button
                className="justify-between"
                onClick={() => {
                  onOpenChange(false);
                  void navigate({ to: "/threads" });
                }}
                size="sm"
                variant="outline"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="size-2 rounded-full bg-emerald-500/80" />
                  <span>{t("reviewCenter.quietActivityBatches", { count: recentBatchesCount })}</span>
                </span>
                <ChevronRightIcon className="size-4" />
              </Button>
            ) : null}
          </div>
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
}
