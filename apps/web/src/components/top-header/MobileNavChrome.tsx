import { asSpaceId, countUnifiedInboxBadge } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  useInkadeBriefingRuns,
  useInkadeDocuments,
  useInkadeSpaces,
  useInkadeThreadBindings,
  useInkadeWorkspaceSummary,
} from "@inkade/sdk/react";
import { Button, cn } from "@inkade/ui";
import { useInboxLocalState } from "@inkade/views/lib/inbox-local-state";
import { Link } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  InboxIcon,
  LibraryIcon,
  MessageSquareCodeIcon,
  PlusIcon,
} from "lucide-react";
import type React from "react";
import { useMemo } from "react";

export interface MobileNavChromeProps {
  readonly pathname: string;
  readonly isSettingsRoute: boolean;
  readonly hideQuickCapture?: boolean | undefined;
  readonly onOpenQuickCapture: () => void;
}

function MobileTabLink({
  to,
  label,
  icon,
  active,
  badge,
}: {
  readonly to: "/daily" | "/inbox" | "/library" | "/threads";
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly active: boolean;
  readonly badge?: number | undefined;
}): React.ReactElement {
  return (
    <Link
      className={cn(
        "relative flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] transition-colors",
        active ? "font-medium text-foreground" : "text-muted-foreground",
      )}
      to={to}
    >
      <span className="relative">
        {icon}
        {badge !== undefined && badge > 0 ? (
          <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-neutral-950 ring-1 ring-background">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate leading-tight">{label}</span>
    </Link>
  );
}

export function MobileNavChrome({
  pathname,
  isSettingsRoute: _isSettingsRoute,
  hideQuickCapture = false,
  onOpenQuickCapture,
}: MobileNavChromeProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const inboxLocalState = useInboxLocalState();
  const summaryQuery = useInkadeWorkspaceSummary();
  const spacesQuery = useInkadeSpaces();
  const docsQuery = useInkadeDocuments({ limit: 300 });
  const bindingsQuery = useInkadeThreadBindings({});
  const briefingRunsQuery = useInkadeBriefingRuns({ status: "failed", undismissedOnly: true, limit: 50 });
  const inboxSpaceId =
    (spacesQuery.data ?? []).find((s) => s.slug === "inbox")?.id ?? asSpaceId("spc_inbox");
  const inboxCount = useMemo(
    () =>
      countUnifiedInboxBadge({
        docs: docsQuery.data ?? [],
        bindings: bindingsQuery.data ?? [],
        briefingRuns: briefingRunsQuery.data ?? [],
        inboxSpaceId,
        bindingSnoozeMap: inboxLocalState.snoozeMap,
        bindingUnreadMap: inboxLocalState.unreadMap,
      }),
    [
      docsQuery.data,
      bindingsQuery.data,
      briefingRunsQuery.data,
      inboxSpaceId,
      inboxLocalState.snoozeMap,
      inboxLocalState.unreadMap,
    ],
  );
  const attentionThreadsCount = summaryQuery.data?.attentionThreadsCount ?? 0;

  return (
    <div className="md:hidden" data-slot="app-mobile-nav">
      <nav
        aria-label={t("nav.mobileNav")}
        className={cn(
          "safe-area-bottom fixed inset-x-0 bottom-0 z-30 grid items-center border-t bg-background/95 backdrop-blur",
          hideQuickCapture ? "grid-cols-4" : "grid-cols-5",
        )}
      >
        <MobileTabLink
          active={pathname === "/daily" || pathname.startsWith("/daily/")}
          icon={<CalendarDaysIcon className="size-4" />}
          label={t("nav.tabToday")}
          to="/daily"
        />
        <MobileTabLink
          active={pathname === "/inbox"}
          badge={inboxCount > 0 ? inboxCount : undefined}
          icon={<InboxIcon className="size-4" />}
          label={t("nav.tabInbox")}
          to="/inbox"
        />
        {!hideQuickCapture ? (
          <div className="flex items-center justify-center py-1.5">
            <Button
              aria-label={t("nav.quickCaptureAria")}
              className="size-9 rounded-full p-0 ring-1 ring-border/40 transition-transform duration-[var(--duration-micro)] ease-[var(--ease-smooth-out)] active:scale-95"
              onClick={onOpenQuickCapture}
              size="sm"
              title={t("nav.quickCapture")}
              type="button"
            >
              <PlusIcon className="size-4" />
            </Button>
          </div>
        ) : null}
        <MobileTabLink
          active={pathname === "/library" || pathname.startsWith("/spaces/")}
          icon={<LibraryIcon className="size-4" />}
          label={t("nav.tabLibrary")}
          to="/library"
        />
        <MobileTabLink
          active={pathname === "/threads"}
          badge={attentionThreadsCount > 0 ? attentionThreadsCount : undefined}
          icon={<MessageSquareCodeIcon className="size-4" />}
          label={t("nav.tabThreads")}
          to="/threads"
        />
      </nav>
    </div>
  );
}
