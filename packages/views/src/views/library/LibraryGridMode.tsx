import type { DocumentId } from "@inkade/core";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  ClipCoverThumbnail,
  ClipFavicon,
  cn,
  DocumentKindIcon,
  INKADE_MEDIA_QUERIES,
  SpaceColorBadge,
  TagList,
} from "@inkade/ui";
import { Columns2Icon, PinIcon, PinOffIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo } from "react";
import { useMediaQuery } from "usehooks-ts";
import { extractDisplayProperties, getDocumentExcerpt } from "../../lib/typed-properties.ts";
import { useListVirtualizer } from "../../lib/use-list-virtualizer.ts";
import { DocAdeBadge } from "./LibrarySharedControls.tsx";
import { formatRelativeDate, summarizeDocAde } from "./types.ts";
import type { LibraryWorkspaceState } from "./useLibraryWorkspace.ts";

export interface LibraryGridModeProps {
  readonly state: LibraryWorkspaceState;
  readonly scrollViewportRef: React.RefObject<HTMLDivElement | null>;
  readonly scrollToDocIdRef: React.MutableRefObject<((docId: DocumentId) => void) | null>;
}

export function LibraryGridMode({
  state,
  scrollViewportRef,
  scrollToDocIdRef,
}: LibraryGridModeProps): React.ReactElement {
  const {
    t,
    isLgUp,
    isCompact,
    canvasWidth,
    displayOptions,
    filteredDocs,
    spaceById,
    bindingsByDocId,
    selectedDocIds,
    activeCursorDocId,
    kindLabels,
    itemRefs,
    toggleDocSelection,
    togglePinMutation,
    handleOpenStudioDoc,
    handleSplitFromStudio,
  } = state;

  const isSmUp = useMediaQuery(INKADE_MEDIA_QUERIES.sm);
  const isXlUp = useMediaQuery(INKADE_MEDIA_QUERIES.xl);
  const is2XlUp = useMediaQuery(INKADE_MEDIA_QUERIES["2xl"]);

  const columnCount =
    is2XlUp && canvasWidth === "fluid" ? 4 : isXlUp ? 3 : isSmUp ? 2 : 1;

  const rows = useMemo(() => {
    const chunked: Array<readonly (typeof filteredDocs)[number][]> = [];
    for (let i = 0; i < filteredDocs.length; i += columnCount) {
      chunked.push(filteredDocs.slice(i, i + columnCount));
    }
    return chunked;
  }, [columnCount, filteredDocs]);

  const virtualizer = useListVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: () => (isCompact ? 185 : 225),
    overscan: 4,
    gap: 12,
    getItemKey: (rowIndex) => rows[rowIndex]?.map((d) => d.id).join(":") ?? rowIndex,
  });

  useEffect(() => {
    scrollToDocIdRef.current = (docId: DocumentId) => {
      const idx = filteredDocs.findIndex((d) => d.id === docId);
      if (idx >= 0) {
        virtualizer.scrollToIndex(Math.floor(idx / columnCount), { align: "auto" });
      } else {
        itemRefs.current.get(docId)?.scrollIntoView({ block: "nearest" });
      }
    };
    return () => {
      scrollToDocIdRef.current = null;
    };
  }, [columnCount, filteredDocs, itemRefs, scrollToDocIdRef, virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      className="relative w-full"
      data-testid="library-grid-virtual"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualRows.map((virtualRow) => {
        const rowDocs = rows[virtualRow.index];
        if (!rowDocs) return null;

        return (
          <div
            className={cn(
              "absolute top-0 left-0 grid w-full gap-3",
              columnCount === 4
                ? "grid-cols-4"
                : columnCount === 3
                  ? "grid-cols-3"
                  : columnCount === 2
                    ? "grid-cols-2"
                    : "grid-cols-1",
            )}
            data-index={virtualRow.index}
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            style={{
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {rowDocs.map((doc) => {
              const space = spaceById.get(doc.spaceId);
              const propsInfo = extractDisplayProperties(doc);
              const excerpt = getDocumentExcerpt(doc, 160);
              const adeSummary = summarizeDocAde(bindingsByDocId.get(doc.id));
              const isBulkSelected = selectedDocIds.has(doc.id);
              const isCursor = activeCursorDocId === doc.id;
              const cardProps = propsInfo.presetEntries
                .filter(
                  (e) =>
                    !(e.key === "sourceUrl" && propsInfo.sourceDomain) &&
                    e.displayValue !== propsInfo.primaryStatus,
                )
                .slice(0, 2);

              return (
                <Card
                  className={cn(
                    "group cursor-pointer transition-colors duration-[var(--duration-quick)] hover:border-foreground/25",
                    isBulkSelected || isCursor
                      ? "border-primary/60 bg-accent/35"
                      : doc.unreadAgentUpdate && "border-primary/35 bg-brand-subtle/20",
                  )}
                  key={doc.id}
                  onClick={(e) => handleOpenStudioDoc(doc, e)}
                  ref={(el) => {
                    if (el) itemRefs.current.set(doc.id, el);
                    else itemRefs.current.delete(doc.id);
                  }}
                >
                  <CardContent
                    className={cn(
                      "flex h-full flex-col justify-between",
                      isCompact ? "gap-2 p-3" : "gap-3 p-4",
                    )}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "shrink-0 transition-opacity",
                              selectedDocIds.size > 0 || isBulkSelected
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-100",
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              aria-label={t("library.selectItemAria", { title: doc.title })}
                              checked={isBulkSelected}
                              onCheckedChange={() => toggleDocSelection(doc.id)}
                            />
                          </span>
                          <DocumentKindIcon kind={doc.kind} size="sm" />
                          <h2 className="truncate text-sm font-semibold text-foreground">
                            {doc.title}
                          </h2>
                        </div>

                        <div
                          className="flex shrink-0 items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {doc.unreadAgentUpdate && (
                            <span
                              aria-label={t("library.unreadAgentUpdate")}
                              className="size-2 rounded-full bg-primary animate-pulse"
                              title={t("library.unreadAgentUpdate")}
                            />
                          )}
                          <Button
                            aria-label={
                              doc.pinned ? t("library.unpinAction") : t("library.pinAction")
                            }
                            className={cn(
                              !doc.pinned && "opacity-0 transition-opacity group-hover:opacity-100",
                            )}
                            onClick={() =>
                              togglePinMutation.mutate({
                                docId: doc.id,
                                pinned: !doc.pinned,
                              })
                            }
                            size="icon-xs"
                            title={
                              doc.pinned ? t("library.unpinAction") : t("library.pinAction")
                            }
                            variant="ghost"
                          >
                            {doc.pinned ? (
                              <PinIcon className="text-amber-500 dark:text-amber-400" />
                            ) : (
                              <PinOffIcon className="text-muted-foreground" />
                            )}
                          </Button>
                          {isLgUp && (
                            <Button
                              aria-label={t("library.openInSplitPane")}
                              className="opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => handleSplitFromStudio(doc)}
                              size="icon-xs"
                              title={t("library.openInSplitPane")}
                              variant="ghost"
                            >
                              <Columns2Icon />
                            </Button>
                          )}
                        </div>
                      </div>

                      {doc.kind === "clip" && propsInfo.coverImageUrl && (
                        <ClipCoverThumbnail coverImageUrl={propsInfo.coverImageUrl} />
                      )}

                      {displayOptions.showExcerpt && excerpt && (
                        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                          {excerpt}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex max-w-36 items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground/85">
                          <SpaceColorBadge color={space?.color} size="sm" />
                          <span className="truncate">
                            {space?.name ?? kindLabels[doc.kind]}
                          </span>
                        </span>

                        {displayOptions.showProperties && propsInfo.sourceDomain && (
                          <span
                            aria-label={t("library.sourceDomainAria", {
                              domain: propsInfo.sourceDomain,
                            })}
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

                        {displayOptions.showProperties && propsInfo.primaryStatus && (
                          <Badge size="sm" variant="secondary">
                            {propsInfo.primaryStatus}
                          </Badge>
                        )}

                        {displayOptions.showProperties &&
                          cardProps.map((prop) => (
                            <Badge key={prop.key} size="sm" variant="outline">
                              <span className="text-muted-foreground">
                                {prop.labelKey ? t(prop.labelKey) : prop.key}
                              </span>
                              <span>{prop.displayValue}</span>
                            </Badge>
                          ))}

                        {displayOptions.showAdeBadge && <DocAdeBadge summary={adeSummary} />}
                      </div>

                      {(() => {
                        const hasFooterTags = displayOptions.showTags && doc.tags.length > 0;
                        return (
                          <div
                            className={`flex items-center justify-between gap-2 text-[11px] text-muted-foreground ${
                              hasFooterTags
                                ? `border-t border-border/60 ${isCompact ? "pt-2.5" : "pt-3"}`
                                : "pt-0.5"
                            }`}
                          >
                            {displayOptions.showTags ? (
                              <TagList
                                className="min-w-0 flex-1"
                                emptyFallback={<span />}
                                formatOverflow={(count) => t("library.moreTagsCount", { count })}
                                maxFallbackVisible={3}
                                size="sm"
                                tags={doc.tags}
                              />
                            ) : (
                              <span />
                            )}
                            <span
                              className="shrink-0 font-mono text-[11px] tabular-nums"
                              title={doc.updatedAt}
                            >
                              {formatRelativeDate(doc.updatedAt, t)}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
