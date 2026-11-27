import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueries, useInkadeClient } from "@inkade/sdk/react";
import { Button, cn, GlideHighlight, Input, Kbd, ScrollArea } from "@inkade/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  DatabaseZapIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  FolderKanbanIcon,
  HardDriveIcon,
  KeyboardIcon,
  KeyRoundIcon,
  Link2Icon,
  PaletteIcon,
  ScrollTextIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserCheckIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventListener } from "usehooks-ts";
import { isEditableEventTarget, isImeEvent } from "@inkade/views/lib/shortcuts";
import {
  filterSettingsSections,
  formatByteSize,
  getSettingsSectionMeta,
  groupSettingsSections,
  type SettingsGroupId,
  type SettingsSectionId,
  type SettingsTranslationKey,
} from "./types.ts";

const SECTION_ICONS: Readonly<Record<SettingsSectionId, React.ReactNode>> = {
  appearance: <PaletteIcon className="size-4 shrink-0" />,
  shortcuts: <KeyboardIcon className="size-4 shrink-0" />,
  account: <UserCheckIcon className="size-4 shrink-0" />,
  spaces: <FolderKanbanIcon className="size-4 shrink-0" />,
  templates: <FileCode2Icon className="size-4 shrink-0" />,
  storage: <HardDriveIcon className="size-4 shrink-0" />,
  backup: <ArchiveRestoreIcon className="size-4 shrink-0" />,
  rag: <SparklesIcon className="size-4 shrink-0" />,
  sync: <DatabaseZapIcon className="size-4 shrink-0" />,
  tokens: <KeyRoundIcon className="size-4 shrink-0" />,
  "scope-rules": <ShieldCheckIcon className="size-4 shrink-0" />,
  "audit-logs": <ScrollTextIcon className="size-4 shrink-0" />,
  security: <ShieldCheckIcon className="size-4 shrink-0" />,
  "share-links": <Link2Icon className="size-4 shrink-0" />,
};

const GROUP_LABEL_KEYS: Readonly<Record<SettingsGroupId, SettingsTranslationKey>> = {
  personal: "settings.groupPersonal",
  workspace: "settings.groupWorkspace",
  intelligence: "settings.groupIntelligence",
  agentSecurity: "settings.groupAgentSecurity",
};

function hasActiveOverlayInDom(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"][data-open], [role="listbox"][data-open]',
    ),
  );
}

export interface SettingsLayoutProps {
  readonly activeSection: SettingsSectionId;
  readonly children: React.ReactNode;
  readonly mode?: "page" | "modal" | undefined;
  readonly onSelectSection?: ((section: SettingsSectionId) => void) | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly onOpenFullPage?: (() => void) | undefined;
}

export function SettingsLayout({
  activeSection,
  children,
  mode = "page",
  onSelectSection,
  onClose,
  onOpenFullPage,
}: SettingsLayoutProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const navigate = useNavigate();
  const [filterQuery, setFilterQuery] = useState("");
  const isModal = mode === "modal";
  const contentViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (contentViewportRef.current) {
      contentViewportRef.current.scrollTop = 0;
    }
  }, [activeSection, isModal]);

  const railSummaryQuery = useQuery({
    ...inkadeQueries.workspaceSummary(client),
    retry: false,
    staleTime: 30_000,
  });

  const railBucketsQuery = useQuery({
    ...inkadeQueries.storageBuckets(client),
    retry: false,
    staleTime: 30_000,
  });

  const railTokensQuery = useQuery({
    ...inkadeQueries.tokens(client),
    retry: false,
    staleTime: 30_000,
  });

  const railTotalDocs =
    railBucketsQuery.data?.totalDocumentCount ??
    (railSummaryQuery.data?.spaces ?? []).reduce((sum, entry) => sum + entry.activeCount, 0);
  const railIndexedDocs = railBucketsQuery.data?.indexedCount ?? railTotalDocs;
  const railUsedBytes = railBucketsQuery.data?.totalUsedBytes ?? null;
  const railActiveTokens = (railTokensQuery.data ?? []).filter(
    (tok) => tok.revokedAt === null,
  ).length;

  const onEscapeKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (isModal) return;
      if (event.key !== "Escape" || event.defaultPrevented || isImeEvent(event)) return;
      if (isEditableEventTarget(event.target)) return;
      if (hasActiveOverlayInDom()) return;
      event.preventDefault();
      if (onClose) {
        onClose();
      } else {
        void navigate({ to: "/daily" });
      }
    },
    [isModal, navigate, onClose],
  );

  useEventListener("keydown", onEscapeKeyDown);

  const filteredSections = useMemo(
    () =>
      filterSettingsSections(
        filterQuery,
        (meta) => `${t(meta.labelKey)} ${t(meta.descriptionKey)}`,
      ),
    [filterQuery, t],
  );

  const groupedSections = useMemo(
    () => groupSettingsSections(filteredSections),
    [filteredSections],
  );

  const activeMeta = getSettingsSectionMeta(activeSection);

  return (
    <div
      className={cn(
        "flex flex-col md:flex-row",
        isModal ? "h-full min-h-0" : "min-h-full",
      )}
    >
      {/* Desktop Linear-style Secondary Settings Sidebar */}
      <aside
        aria-label={t("settings.settingsNavAria")}
        className={cn(
          "hidden w-[228px] shrink-0 flex-col border-r border-border bg-sidebar/60 md:flex lg:w-[244px]",
          isModal ? "h-full min-h-0" : "md:sticky md:top-0 md:h-svh",
        )}
      >
        <div className="flex shrink-0 flex-col gap-3 p-3">
          {isModal ? (
            <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                {t("common.settings")}
              </span>
              <Kbd>Esc</Kbd>
            </div>
          ) : (
            <Button
              className="w-full justify-between px-2.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (onClose) onClose();
                else void navigate({ to: "/daily" });
              }}
              size="sm"
              variant="ghost"
            >
              <span className="flex items-center gap-2">
                <ArrowLeftIcon className="size-3.5" />
                <span>{t("settings.backToWorkspace")}</span>
              </span>
              <Kbd>Esc</Kbd>
            </Button>
          )}

          <Input
            aria-label={t("settings.filterSectionsPlaceholder")}
            endAddon={
              filterQuery ? (
                <button
                  aria-label={t("settings.clearFilter")}
                  className="cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setFilterQuery("")}
                  type="button"
                >
                  <XIcon className="size-3" />
                </button>
              ) : undefined
            }
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={t("settings.filterSectionsPlaceholder")}
            size="sm"
            startAddon={<SearchIcon />}
            value={filterQuery}
          />
        </div>

        <ScrollArea className="min-h-0 flex-1" scrollFade>
          <nav aria-label={t("settings.settingsNavAria")} className="flex flex-col gap-2.5 py-2 pl-2.5 pr-3.5">
            {groupedSections.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {t("settings.noMatchingSections")}
              </p>
            ) : (
              groupedSections.map(({ group, items }) => (
                <div className="flex flex-col gap-0.5" key={group}>
                  <div className="px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(GROUP_LABEL_KEYS[group])}
                  </div>
                  <GlideHighlight
                    className="flex flex-col gap-0.5"
                    highlightClassName="rounded-md bg-sidebar-accent"
                    mode="pointer"
                  >
                    {items.map((item) => {
                      const active = item.id === activeSection;
                      const itemClass = cn(
                        "relative z-10 flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-sm transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent in-data-[glide-visible=true]:hover:bg-transparent hover:text-sidebar-accent-foreground",
                      );
                      const inner = (
                        <>
                          <span className={active ? "text-foreground" : "text-muted-foreground"}>
                            {SECTION_ICONS[item.id]}
                          </span>
                          <span className="truncate">{t(item.labelKey)}</span>
                        </>
                      );
                      if (isModal) {
                        return (
                          <button
                            aria-current={active ? "page" : undefined}
                            className={itemClass}
                            data-glide-item
                            key={item.id}
                            onClick={() => onSelectSection?.(item.id)}
                            type="button"
                          >
                            {inner}
                          </button>
                        );
                      }
                      return (
                        <Link
                          className={itemClass}
                          data-glide-item
                          key={item.id}
                          params={{ section: item.id }}
                          to="/settings/$section"
                        >
                          {inner}
                        </Link>
                      );
                    })}
                  </GlideHighlight>
                </div>
              ))
            )}
          </nav>
        </ScrollArea>

        <div
          className="mx-2.5 mb-2.5 mt-1 flex shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-background/90 px-3 py-2 text-xs"
          data-slot="settings-workspace-status"
        >
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-emerald-500"
            />
            <span className="truncate">{t("settings.railStatusTitle")}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{t("settings.railIndexedCoverage")}</span>
            <span className="font-mono font-medium text-foreground tabular-nums">
              {t("settings.railIndexedValue", {
                indexed: railIndexedDocs,
                total: railTotalDocs,
              })}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{t("settings.railStorageUsage")}</span>
            <span className="font-mono font-medium text-foreground tabular-nums">
              {railUsedBytes !== null ? formatByteSize(railUsedBytes) : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{t("settings.railActiveTokens")}</span>
            <span className="font-mono font-medium text-foreground tabular-nums">
              {t("settings.railTokensCount", { count: railActiveTokens })}
            </span>
          </div>
        </div>
      </aside>

      {/* Mobile Search + Horizontal Section Tabs */}
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border bg-sidebar/40 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <Input
            aria-label={t("settings.filterSectionsPlaceholder")}
            className="flex-1"
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={t("settings.filterSectionsPlaceholder")}
            size="sm"
            startAddon={<SearchIcon />}
            value={filterQuery}
          />
          {isModal && onOpenFullPage ? (
            <Button onClick={onOpenFullPage} size="sm" variant="outline">
              <ExternalLinkIcon />
              <span>{t("settings.openFullPage")}</span>
            </Button>
          ) : null}
          {isModal && onClose ? (
            <Button
              aria-label={t("settings.closeSettingsModalAria")}
              onClick={onClose}
              size="icon-sm"
              variant="ghost"
            >
              <XIcon />
            </Button>
          ) : null}
        </div>

        <nav
          aria-label={t("settings.settingsNavAria")}
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {filteredSections.map((item) => {
            const active = item.id === activeSection;
            const tabClass = cn(
              "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
              active
                ? "border-border bg-sidebar-accent text-sidebar-accent-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            );
            if (isModal) {
              return (
                <button
                  aria-current={active ? "page" : undefined}
                  className={tabClass}
                  key={item.id}
                  onClick={() => onSelectSection?.(item.id)}
                  type="button"
                >
                  {SECTION_ICONS[item.id]}
                  <span>{t(item.labelKey)}</span>
                </button>
              );
            }
            return (
              <Link
                className={tabClass}
                key={item.id}
                params={{ section: item.id }}
                to="/settings/$section"
              >
                {SECTION_ICONS[item.id]}
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right Content Canvas */}
      {isModal ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <div className="hidden h-12 shrink-0 items-center justify-between gap-2 pl-6 pr-3 md:flex">
            <span className="truncate text-xs font-medium text-muted-foreground">
              {t(activeMeta.labelKey)}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {onOpenFullPage ? (
                <Button onClick={onOpenFullPage} size="xs" variant="outline">
                  <ExternalLinkIcon />
                  <span>{t("settings.openFullPage")}</span>
                </Button>
              ) : null}
              {onClose ? (
                <Button
                  aria-label={t("settings.closeSettingsModalAria")}
                  onClick={onClose}
                  size="icon-xs"
                  variant="ghost"
                >
                  <XIcon />
                </Button>
              ) : null}
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1" opticalFade viewportRef={contentViewportRef}>
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 pb-6 sm:px-6 md:px-8 md:pb-8">
              {children}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 pb-6 sm:px-6 md:px-8 md:pt-8 md:pb-8">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
