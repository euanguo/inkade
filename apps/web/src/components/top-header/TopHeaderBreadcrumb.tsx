import type { DocumentRecord, DocumentSummary, Space } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { DocumentKindIcon, SpaceIcon, TagPill } from "@inkade/ui";
import { getRelativeDailyBadge, getTodayDailyDate } from "@inkade/views/lib/dates";
import { Link } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  CheckSquareIcon,
  InboxIcon,
  LibraryIcon,
  MessageSquareCodeIcon,
  PlugZapIcon,
  SettingsIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";

export interface MobileRouteMeta {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly meta: string | null;
}

export function resolveMobileRouteMeta({
  pathname,
  searchStr,
  isSettingsRoute,
  spaces,
  docs,
  inspectorDoc,
  t,
}: {
  readonly pathname: string;
  readonly searchStr: string;
  readonly isSettingsRoute: boolean;
  readonly spaces: readonly Space[];
  readonly docs: readonly DocumentSummary[];
  readonly inspectorDoc: DocumentRecord | null;
  readonly t: ReturnType<typeof useInkadeTranslation>["t"];
}): MobileRouteMeta {
  if (isSettingsRoute) {
    return {
      icon: <SettingsIcon className="size-3.5 shrink-0 text-muted-foreground" />,
      label: t("common.settings"),
      meta: null,
    };
  }
  if (pathname === "/daily" || pathname.startsWith("/daily/")) {
    const dateSegment = pathname.startsWith("/daily/")
      ? pathname.slice("/daily/".length).split("/")[0]
      : getTodayDailyDate();
    const activeDate = dateSegment || getTodayDailyDate();
    return {
      icon: <CalendarDaysIcon className="size-3.5 shrink-0 text-muted-foreground" />,
      label: t("nav.tabToday"),
      meta: activeDate.slice(5),
    };
  }
  if (pathname === "/inbox") {
    return {
      icon: <InboxIcon className="size-3.5 shrink-0 text-muted-foreground" />,
      label: t("nav.inbox"),
      meta: null,
    };
  }
  if (pathname === "/tasks") {
    return {
      icon: <CheckSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />,
      label: t("nav.tasks"),
      meta: null,
    };
  }
  if (pathname === "/library") {
    const tagParam = new URLSearchParams(searchStr).get("tag");
    return {
      icon: <LibraryIcon className="size-3.5 shrink-0 text-muted-foreground" />,
      label: t("nav.library"),
      meta: tagParam ? `#${tagParam}` : null,
    };
  }
  if (pathname === "/threads") {
    return {
      icon: <MessageSquareCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />,
      label: t("nav.threads"),
      meta: null,
    };
  }
  if (pathname === "/ask") {
    return {
      icon: <SparklesIcon className="size-3.5 shrink-0 text-muted-foreground" />,
      label: t("nav.askInkade"),
      meta: null,
    };
  }
  if (pathname === "/connect") {
    return {
      icon: <PlugZapIcon className="size-3.5 shrink-0 text-muted-foreground" />,
      label: t("nav.connectAi"),
      meta: null,
    };
  }
  if (pathname === "/graph") {
    return {
      icon: <SparklesIcon className="size-3.5 shrink-0 text-muted-foreground" />,
      label: t("graph.navTitle"),
      meta: null,
    };
  }
  if (pathname === "/trash") {
    return {
      icon: <Trash2Icon className="size-3.5 shrink-0 text-muted-foreground" />,
      label: t("common.trash"),
      meta: null,
    };
  }
  if (pathname.startsWith("/spaces/")) {
    const spaceId = decodeURIComponent(pathname.slice("/spaces/".length).split("/")[0] ?? "");
    const space = spaces.find((s) => s.id === spaceId) ?? null;
    return {
      icon: <SpaceIcon color={space?.color} icon={space?.icon} size="xs" tone="mono" />,
      label: space?.name ?? t("nav.spaces"),
      meta: null,
    };
  }
  if (pathname.startsWith("/docs/")) {
    const docId = decodeURIComponent(pathname.slice("/docs/".length).split("/")[0] ?? "");
    const doc =
      inspectorDoc?.id === docId
        ? inspectorDoc
        : docs.find((d) => d.id === docId) ?? null;
    return {
      icon: doc ? <DocumentKindIcon kind={doc.kind} size="xs" /> : null,
      label: doc?.title ?? t("common.loading"),
      meta: null,
    };
  }
  return {
    icon: null,
    label: t("common.appName"),
    meta: null,
  };
}

export function TopHeaderBreadcrumb({
  pathname,
  searchStr,
  isSettingsRoute,
  spaces,
  docs,
  inspectorDoc,
}: {
  readonly pathname: string;
  readonly searchStr: string;
  readonly isSettingsRoute: boolean;
  readonly spaces: readonly Space[];
  readonly docs: readonly DocumentSummary[];
  readonly inspectorDoc: DocumentRecord | null;
}): React.ReactElement {
  const { t } = useInkadeTranslation();

  if (isSettingsRoute) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <SettingsIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-semibold text-foreground">{t("common.settings")}</span>
      </div>
    );
  }

  if (pathname === "/daily" || pathname.startsWith("/daily/")) {
    const dateSegment = pathname.startsWith("/daily/")
      ? pathname.slice("/daily/".length).split("/")[0]
      : getTodayDailyDate();
    const activeDate = dateSegment || getTodayDailyDate();
    const rel = getRelativeDailyBadge(activeDate);
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <CalendarDaysIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">
          {t("nav.tabToday")} ·{" "}
          <span className="font-mono text-xs text-muted-foreground">{activeDate}</span>
        </span>
        {rel ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">{rel}</span>
        ) : null}
      </div>
    );
  }

  if (pathname === "/inbox") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <InboxIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{t("nav.inbox")}</span>
      </div>
    );
  }

  if (pathname === "/tasks") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <CheckSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{t("nav.tasks")}</span>
      </div>
    );
  }

  if (pathname === "/threads") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <MessageSquareCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{t("nav.threads")}</span>
      </div>
    );
  }
  if (pathname === "/ask") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <SparklesIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{t("nav.askInkade")}</span>
      </div>
    );
  }
  if (pathname === "/graph") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <SparklesIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{t("graph.navTitle")}</span>
      </div>
    );
  }
  if (pathname === "/connect") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <PlugZapIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{t("nav.connectAi")}</span>
      </div>
    );
  }

  if (pathname === "/trash") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Trash2Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{t("common.trash")}</span>
      </div>
    );
  }

  if (pathname === "/library") {
    const tagParam = new URLSearchParams(searchStr).get("tag");
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <LibraryIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{t("nav.library")}</span>
        {tagParam ? <TagPill size="sm" tag={tagParam} /> : null}
      </div>
    );
  }

  if (pathname.startsWith("/spaces/")) {
    const spaceId = decodeURIComponent(pathname.slice("/spaces/".length).split("/")[0] ?? "");
    const space = spaces.find((s) => s.id === spaceId) ?? null;
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <SpaceIcon color={space?.color} icon={space?.icon} size="xs" tone="mono" />
        <span className="truncate font-medium text-foreground">
          {space?.name ?? t("nav.spaces")}
        </span>
      </div>
    );
  }

  if (pathname.startsWith("/docs/")) {
    const docId = decodeURIComponent(pathname.slice("/docs/".length).split("/")[0] ?? "");
    const doc =
      inspectorDoc?.id === docId
        ? inspectorDoc
        : docs.find((d) => d.id === docId) ?? null;
    const space = doc ? spaces.find((s) => s.id === doc.spaceId) ?? null : null;
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        {space ? (
          <>
            <Link
              className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              params={{ spaceId: space.id }}
              to="/spaces/$spaceId"
            >
              <SpaceIcon color={space.color} icon={space.icon} size="xs" tone="mono" />
              <span className="hidden max-w-36 truncate sm:inline">{space.name}</span>
            </Link>
            <span aria-hidden="true" className="text-muted-foreground/50">
              /
            </span>
          </>
        ) : null}
        {doc ? <DocumentKindIcon kind={doc.kind} size="xs" /> : null}
        <span className="truncate font-medium text-foreground">
          {doc?.title ?? t("common.loading")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span className="truncate font-medium text-foreground">{t("common.appName")}</span>
    </div>
  );
}
