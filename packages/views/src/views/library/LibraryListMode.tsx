import type { DocumentId } from "@inkade/core";
import {
  Badge,
  Button,
  Checkbox,
  ClipFavicon,
  cn,
  DocumentKindIcon,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  ScrollArea,
  SpaceColorBadge,
  SpaceIcon,
  TagList,
} from "@inkade/ui";
import { Columns2Icon, PinIcon, PinOffIcon } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { extractDisplayProperties, getDocumentExcerpt } from "../../lib/typed-properties.ts";
import { useListVirtualizer } from "../../lib/use-list-virtualizer.ts";
import { LibraryListSkeleton } from "../../components/ViewSkeletons.tsx";
import {
  DocAdeBadge,
  LibraryEmptyState,
  LibraryPaginationFooter,
} from "./LibrarySharedControls.tsx";
import { formatRelativeDate, summarizeDocAde } from "./types.ts";
import type { LibraryWorkspaceState } from "./useLibraryWorkspace.ts";

export interface LibraryListModeProps {
  readonly state: LibraryWorkspaceState;
  readonly scrollToDocIdRef: React.MutableRefObject<((docId: DocumentId) => void) | null>;
}

export function LibraryListMode({
  state,
  scrollToDocIdRef,
}: LibraryListModeProps): React.ReactElement {
  const {
    t,
    hostActions,
    isLgUp,
    isCompact,
    displayOptions,
    docsQuery,
    filteredDocs,
    activeSpace,
    activeSpaces,
    spaceById,
    bindingsByDocId,
    selectedDocId,
    setSelectedDocId,
    selectedDocIds,
    splitDocId,
    setSplitDocId,
    kindLabels,
    itemRefs,
    toggleDocSelection,
    togglePinMutation,
    quickMoveSpaceMutation,
    onSelectDocument,
  } = state;

  const viewportRef = useRef<HTMLDivElement>(null);

  const virtualizer = useListVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: filteredDocs.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => (isCompact ? 76 : 108),
    overscan: 8,
    gap: 6,
    getItemKey: (index) => filteredDocs[index]?.id ?? index,
  });

  useEffect(() => {
    scrollToDocIdRef.current = (docId: DocumentId) => {
      const idx = filteredDocs.findIndex((d) => d.id === docId);
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: "auto" });
      } else {
        itemRefs.current.get(docId)?.scrollIntoView({ block: "nearest" });
      }
    };
    return () => {
      scrollToDocIdRef.current = null;
    };
  }, [filteredDocs, itemRefs, scrollToDocIdRef, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <ScrollArea className="min-h-0 flex-1" scrollFade viewportRef={viewportRef}>
      {docsQuery.isPending ? (
        <LibraryListSkeleton compact={isCompact} />
      ) : filteredDocs.length === 0 ? (
        <LibraryEmptyState
          onCreateArticle={() =>
            hostActions.openNewDocument?.({
              spaceId: activeSpace?.id,
              kind: activeSpace?.defaultKind ?? "article",
            })
          }
        />
      ) : (
        <div className="p-2 pb-6 md:pb-2">
          <div
            className="relative w-full"
            data-testid="library-list-virtual"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const doc = filteredDocs[virtualRow.index];
              if (!doc) return null;
              const isSelected = selectedDocId === doc.id;
              const isBulkSelected = selectedDocIds.has(doc.id);
              const isSplitActive = splitDocId === doc.id;
              const space = spaceById.get(doc.spaceId);
              const propsInfo = extractDisplayProperties(doc);
              const excerpt = getDocumentExcerpt(doc, 120);
              const adeSummary = summarizeDocAde(bindingsByDocId.get(doc.id));
              const firstProp = propsInfo.presetEntries.find(
                (e) => !(e.key === "sourceUrl" && propsInfo.sourceDomain),
              );

              const handleSelectRow = (e: React.MouseEvent<HTMLElement>): void => {
                if (
                  (e.metaKey || e.ctrlKey) &&
                  selectedDocId &&
                  selectedDocId !== doc.id &&
                  isLgUp
                ) {
                  setSplitDocId(doc.id);
                  return;
                }
                setSelectedDocId(doc.id);
                onSelectDocument?.(doc);
              };

              return (
                <div
                  className={cn(
                    "group absolute top-0 left-0 flex w-full cursor-pointer flex-col rounded-lg border px-3 text-left transition-colors duration-[var(--duration-quick)]",
                    isCompact ? "gap-1 py-1.5" : "gap-1.5 py-2.5",
                    isBulkSelected
                      ? "border-primary/60 bg-accent/65"
                      : isSelected
                        ? "border-border bg-accent/80"
                        : isSplitActive
                          ? "border-info/45 bg-info/8"
                          : doc.unreadAgentUpdate
                            ? "border-primary/30 bg-brand-subtle/35 hover:border-primary/50 hover:bg-brand-subtle/50"
                            : "border-transparent hover:border-border hover:bg-muted/50",
                  )}
                  data-index={virtualRow.index}
                  key={doc.id}
                  onClick={handleSelectRow}
                  ref={(el) => {
                    virtualizer.measureElement(el);
                    if (el) itemRefs.current.set(doc.id, el);
                    else itemRefs.current.delete(doc.id);
                  }}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2 md:pr-14">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          "shrink-0 transition-opacity",
                          selectedDocIds.size > 0 || isBulkSelected
                            ? "inline-flex opacity-100"
                            : "hidden [@media(hover:hover)]:inline-flex opacity-0 group-hover:opacity-100",
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          aria-label={t("library.selectItemAria", { title: doc.title })}
                          checked={isBulkSelected}
                          onCheckedChange={() => toggleDocSelection(doc.id)}
                        />
                      </span>
                      <DocumentKindIcon kind={doc.kind} size="xs" />
                      <span className="truncate text-sm font-semibold text-foreground">
                        {doc.title}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {doc.unreadAgentUpdate && (
                        <span
                          aria-label={t("library.unreadAgentUpdate")}
                          className="size-2 rounded-full bg-primary animate-pulse"
                          title={t("library.unreadAgentUpdate")}
                        />
                      )}
                      {doc.pinned && (
                        <PinIcon className="size-3 text-amber-500 dark:text-amber-400" />
                      )}
                    </div>
                  </div>

                  {displayOptions.showExcerpt && excerpt && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {excerpt}
                    </p>
                  )}

                  <div
                    className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <Menu>
                        <MenuTrigger
                          render={
                            <button
                              aria-label={t("library.quickMoveSpaceAria")}
                              className="inline-flex max-w-28 cursor-pointer items-center gap-1 rounded-full border bg-card px-1.5 py-0.5 text-[11px] font-medium text-foreground/85 transition-colors hover:border-border/90 hover:bg-muted"
                              type="button"
                            />
                          }
                        >
                          <SpaceColorBadge color={space?.color} size="sm" />
                          <span className="truncate">
                            {space?.name ?? kindLabels[doc.kind]}
                          </span>
                        </MenuTrigger>
                        <MenuPopup align="start">
                          {activeSpaces.map((s) => (
                            <MenuItem
                              key={s.id}
                              onClick={() =>
                                quickMoveSpaceMutation.mutate({
                                  docId: doc.id,
                                  spaceId: s.id,
                                })
                              }
                            >
                              <SpaceIcon color={s.color} icon={s.icon} size="xs" tone="mono" />
                              <span>{s.name}</span>
                            </MenuItem>
                          ))}
                        </MenuPopup>
                      </Menu>

                      {displayOptions.showProperties && propsInfo.sourceDomain && (
                        <span
                          className="inline-flex min-w-0 max-w-36 items-center gap-1.5 text-[11px] text-muted-foreground"
                          title={propsInfo.sourceDomain}
                        >
                          <ClipFavicon
                            className="size-3.5"
                            domain={propsInfo.sourceDomain}
                            faviconUrl={propsInfo.faviconUrl}
                          />
                          <span className="truncate">{propsInfo.sourceDomain}</span>
                        </span>
                      )}
                      {displayOptions.showProperties && firstProp && (
                        <Badge size="sm" variant="outline">
                          <span className="max-w-20 truncate">{firstProp.displayValue}</span>
                        </Badge>
                      )}
                      {displayOptions.showAdeBadge && <DocAdeBadge summary={adeSummary} />}
                      {displayOptions.showTags && doc.tags.length > 0 && (
                        <TagList
                          className="min-w-20 flex-1"
                          formatOverflow={(count) => t("library.moreTagsCount", { count })}
                          maxFallbackVisible={2}
                          size="sm"
                          tags={doc.tags}
                        />
                      )}
                    </div>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums">
                      {formatRelativeDate(doc.updatedAt, t)}
                    </span>
                  </div>

                  <div
                    className="absolute top-2 right-2 flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      aria-label={
                        doc.pinned ? t("library.unpinAction") : t("library.pinAction")
                      }
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() =>
                        togglePinMutation.mutate({
                          docId: doc.id,
                          pinned: !doc.pinned,
                        })
                      }
                      size="icon-xs"
                      title={doc.pinned ? t("library.unpinAction") : t("library.pinAction")}
                      variant="outline"
                    >
                      {doc.pinned ? <PinIcon className="text-amber-500" /> : <PinOffIcon />}
                    </Button>
                    {isLgUp && selectedDocId && selectedDocId !== doc.id && (
                      <Button
                        aria-label={t("library.openInSplitPane")}
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => setSplitDocId(doc.id)}
                        size="icon-xs"
                        title={t("library.openInSplitPane")}
                        variant="outline"
                      >
                        <Columns2Icon />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <LibraryPaginationFooter
            hasNextPage={Boolean(docsQuery.hasNextPage)}
            isFetchingNextPage={docsQuery.isFetchingNextPage}
            isPending={docsQuery.isPending}
            onLoadMore={() => void docsQuery.fetchNextPage()}
            totalLoaded={filteredDocs.length}
          />
        </div>
      )}
    </ScrollArea>
  );
}
