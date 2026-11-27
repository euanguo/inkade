import { extractSourceDomain, type UnifiedInboxCounts } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  ClipFavicon,
  cn,
  DocumentKindIcon,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  GlideHighlight,
  Input,
  ScrollArea,
  Skeleton,
  TagList,
} from "@inkade/ui";
import { CheckCheckIcon, ClockIcon, InboxIcon, PlusIcon, SearchIcon } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { useListVirtualizer } from "../../lib/use-list-virtualizer.ts";
import {
  formatRelativeTime,
  formatSnoozeUntilShort,
  getInboxItemSubtitle,
  getItemKindLabel,
  getQueueDotClassName,
  type InboxFilterTab,
  type UnifiedInboxItem,
} from "./types.ts";

export interface InboxQueuePaneProps {
  readonly widthPx?: number | undefined;
  readonly selectedItemId: string | null;
  readonly activeTab: InboxFilterTab;
  readonly onChangeTab: (tab: InboxFilterTab) => void;
  readonly filterText: string;
  readonly onChangeFilterText: (text: string) => void;
  readonly tabCounts: UnifiedInboxCounts;
  readonly filteredItems: readonly UnifiedInboxItem[];
  readonly snoozedCount: number;
  readonly exitingItemIds: ReadonlySet<string>;
  readonly isLoading: boolean;
  readonly clearReadPending: boolean;
  readonly onClearRead: () => void;
  readonly onOpenQuickCapture: () => void;
  readonly onSelectItem: (itemId: string) => void;
  readonly scrollToIndexRef: React.MutableRefObject<((index: number) => void) | null>;
}

export function InboxQueuePane({
  widthPx,
  selectedItemId,
  activeTab,
  onChangeTab,
  filterText,
  onChangeFilterText,
  tabCounts,
  filteredItems,
  snoozedCount,
  exitingItemIds,
  isLoading,
  clearReadPending,
  onClearRead,
  onOpenQuickCapture,
  onSelectItem,
  scrollToIndexRef,
}: InboxQueuePaneProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useListVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: () => 86,
    overscan: 8,
    getItemKey: (idx) => filteredItems[idx]?.id ?? idx,
  });

  useEffect(() => {
    scrollToIndexRef.current = (index: number) => {
      virtualizer.scrollToIndex(index, { align: "auto" });
    };
    return () => {
      scrollToIndexRef.current = null;
    };
  }, [scrollToIndexRef, virtualizer]);

  const filterTabs: ReadonlyArray<{
    readonly id: InboxFilterTab;
    readonly label: string;
    readonly count: number;
  }> = [
    { id: "exceptions", label: t("inbox.tabExceptions"), count: tabCounts.exceptions },
    { id: "digest", label: t("inbox.tabDigest"), count: tabCounts.digest },
    { id: "clips", label: t("inbox.tabClips"), count: tabCounts.clips },
    { id: "snoozed", label: t("inbox.tabSnoozed"), count: tabCounts.snoozed },
  ];

  const virtualItems = virtualizer.getVirtualItems();
  const activeTabLabel = filterTabs.find((tab) => tab.id === activeTab)?.label ?? activeTab;
  const firstNonEmptyOtherTab = !filterText.trim()
    ? filterTabs.find((tab) => tab.id !== activeTab && tab.count > 0)
    : undefined;

  return (
    <section
      className={`flex min-h-0 w-full flex-1 flex-col bg-background md:flex-none md:shrink-0 ${
        selectedItemId ? "hidden md:flex" : "flex"
      }`}
      style={widthPx !== undefined ? { width: `${widthPx}px` } : undefined}
    >
      <div className="flex flex-col gap-2 border-b border-border/70 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
              {t("inbox.title")}
            </h1>
            <Badge className="tabular-nums" size="sm" variant="outline">
              {filteredItems.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              disabled={clearReadPending}
              onClick={onClearRead}
              size="xs"
              title={t("inbox.clearReadConfirmAria")}
              variant="ghost"
            >
              <CheckCheckIcon />
              <span className="hidden sm:inline">{t("inbox.clearRead")}</span>
            </Button>
            <Button onClick={onOpenQuickCapture} size="xs" variant="outline">
              <PlusIcon />
              {t("inbox.addQuickCapture")}
            </Button>
          </div>
        </div>

        <div
          aria-label={t("inbox.filterTabsAria")}
          className="flex items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
        >
          {filterTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                aria-selected={active}
                className={cn(
                  "inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium transition-colors duration-[var(--duration-micro)]",
                  active
                    ? "bg-muted text-foreground"
                    : "text-foreground/70 hover:bg-muted/50 hover:text-foreground",
                )}
                key={tab.id}
                onClick={() => onChangeTab(tab.id)}
                role="tab"
                type="button"
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className="font-mono text-[10px] text-foreground/75 tabular-nums">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <Input
          onChange={(e) => onChangeFilterText(e.target.value)}
          placeholder={t("inbox.filterPlaceholder")}
          size="sm"
          startAddon={<SearchIcon />}
          value={filterText}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1" scrollFade viewportRef={scrollViewportRef}>
        {isLoading ? (
          <div aria-busy="true" className="divide-y divide-border/60">
            {["w-44", "w-36", "w-48", "w-40", "w-52"].map((titleWidth, idx) => (
              <div className="flex flex-col gap-1.5 px-3.5 py-2.5" key={idx}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Skeleton className="size-1.5 shrink-0 rounded-full" />
                    <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                    <Skeleton className={`h-3.5 max-w-full ${titleWidth}`} />
                  </div>
                  <Skeleton className="h-3 w-10 shrink-0" />
                </div>
                <Skeleton className="ml-3.5 h-3 w-4/5" />
                <div className="flex items-center gap-2 pl-3.5">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>
                {firstNonEmptyOtherTab
                  ? t("inbox.emptyBucketTitle", { tab: activeTabLabel })
                  : activeTab === "exceptions" && !filterText && snoozedCount > 0
                    ? t("inbox.inboxZeroTitle")
                    : t("inbox.inboxZeroFilteredTitle")}
              </EmptyTitle>
              <EmptyDescription>
                {firstNonEmptyOtherTab
                  ? t("inbox.emptyBucketDesc")
                  : activeTab === "exceptions" && !filterText && snoozedCount > 0
                    ? t("inbox.inboxZeroDesc")
                    : t("inbox.inboxZeroFilteredDesc")}
              </EmptyDescription>
            </EmptyHeader>
            {firstNonEmptyOtherTab ? (
              <EmptyContent>
                <Button
                  onClick={() => onChangeTab(firstNonEmptyOtherTab.id)}
                  size="sm"
                  variant="outline"
                >
                  {t("inbox.switchToBucketBtn", {
                    tab: firstNonEmptyOtherTab.label,
                    count: firstNonEmptyOtherTab.count,
                  })}
                </Button>
              </EmptyContent>
            ) : (filterText || activeTab !== "exceptions") ? (
              <EmptyContent>
                <Button
                  onClick={() => {
                    onChangeFilterText("");
                    onChangeTab("exceptions");
                  }}
                  size="sm"
                  variant="outline"
                >
                  {t("inbox.clearFilter")}
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <GlideHighlight
            className="relative w-full"
            highlightClassName="rounded-none bg-muted/45"
            mode="pointer"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const item = filteredItems[virtualRow.index];
              if (!item) return null;
              const isSelected = selectedItemId === item.id;
              const isExiting = exitingItemIds.has(item.id);
              const domain =
                item.kind === "clip" || item.kind === "digest"
                  ? extractSourceDomain(item.doc.sourceUrl)
                  : null;
              const clipMeta =
                item.kind === "clip" || item.kind === "digest"
                  ? (item.doc.sourceMeta ?? {})
                  : null;
              const rawFavicon =
                typeof clipMeta?.["faviconUrl"] === "string"
                  ? clipMeta["faviconUrl"]
                  : typeof clipMeta?.["favicon"] === "string"
                    ? clipMeta["favicon"]
                    : null;
              const faviconUrl =
                rawFavicon &&
                (/^https?:\/\//i.test(rawFavicon) || rawFavicon.startsWith("/api/v1/attachments/"))
                  ? rawFavicon
                  : null;
              const tags = item.kind === "clip" || item.kind === "digest" ? item.doc.tags : [];
              const subtitle = getInboxItemSubtitle(item, t);

              return (
                <button
                  className={cn(
                    "group absolute top-0 left-0 z-10 flex w-full cursor-pointer flex-col gap-1 border-b border-border/60 px-3.5 py-2.5 text-left transition-[opacity,transform,colors] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                    isExiting
                      ? "pointer-events-none -translate-x-2 opacity-0"
                      : isSelected
                        ? "bg-muted/85"
                        : "bg-transparent hover:bg-muted/45 in-data-[glide-visible=true]:hover:bg-transparent",
                  )}
                  data-active={isSelected ? "true" : undefined}
                  data-glide-item
                  data-inbox-kind={item.kind}
                  data-index={virtualRow.index}
                  key={item.id}
                  onClick={() => onSelectItem(item.id)}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn("size-1.5 shrink-0 rounded-full", getQueueDotClassName(item))}
                      />
                      {item.kind === "clip" || item.kind === "digest" ? (
                        <DocumentKindIcon kind={item.doc.kind} size="xs" />
                      ) : null}
                      <span
                        className={cn(
                          "truncate text-xs text-foreground",
                          item.unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {item.title}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-foreground/70 tabular-nums">
                      {formatRelativeTime(item.sortAt, t)}
                    </span>
                  </div>

                  {subtitle && (
                    <p className="line-clamp-1 pl-3.5 text-xs text-foreground/75">{subtitle}</p>
                  )}

                  <div className="flex items-center gap-1.5 pl-3.5 text-[11px] text-foreground/75">
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-foreground/85">
                      {getItemKindLabel(item, t)}
                    </span>
                    {domain && (
                      <>
                        <span aria-hidden="true" className="shrink-0 text-muted-foreground/45">
                          ·
                        </span>
                        <span
                          aria-label={t("inbox.clipDomainAria", { domain })}
                          className="inline-flex min-w-0 max-w-44 items-center gap-1"
                          title={domain}
                        >
                          <ClipFavicon className="size-3.5" domain={domain} faviconUrl={faviconUrl} />
                          <span className="truncate">{domain}</span>
                        </span>
                      </>
                    )}
                    {item.snoozedUntil && (
                      <Badge className="shrink-0" size="sm" variant="outline">
                        <ClockIcon className="size-2.5" />
                        <span>
                          {t("inbox.snoozedUntilBadge", {
                            until: formatSnoozeUntilShort(item.snoozedUntil),
                          })}
                        </span>
                      </Badge>
                    )}
                  </div>

                  {tags.length > 0 && (
                    <div className="pl-3.5">
                      <TagList
                        formatOverflow={(count) => t("library.moreTagsCount", { count })}
                        maxFallbackVisible={3}
                        size="sm"
                        tags={tags}
                      />
                    </div>
                  )}
                </button>
              );
            })}
          </GlideHighlight>
        )}
        {!isLoading && filteredItems.length > 0 ? (
          <p className="px-4 py-4 text-center text-[11px] text-muted-foreground/80">
            {t("inbox.queueEndSummary", { count: filteredItems.length })}
          </p>
        ) : null}
      </ScrollArea>
    </section>
  );
}
