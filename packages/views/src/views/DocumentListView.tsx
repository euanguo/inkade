import type { DocumentId } from "@inkade/core";
import { inkadeQueryKeys } from "@inkade/sdk";
import { useInkadeClient } from "@inkade/sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useInkadeViewsContext } from "../context.tsx";
import {
  Button,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  ResizeHandle,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  SpaceIcon,
} from "@inkade/ui";
import {
  ArrowLeftIcon,
  BookmarkCheckIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FilePlus2Icon,
  FileTextIcon,
  FileUpIcon,
  SearchIcon,
} from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { SpaceSchemaDialog } from "../components/SpaceSchemaEditor.tsx";
import {
  DocumentDetailSkeleton,
  LibraryGridSkeleton,
  LibraryTableSkeleton,
} from "../components/ViewSkeletons.tsx";
import { DocumentDetailView } from "./DocumentDetailView.tsx";
import { LibraryBoardMode } from "./library/LibraryBoardMode.tsx";
import { LibraryBulkActionBar } from "./library/LibraryBulkActionBar.tsx";
import { LibraryGridMode } from "./library/LibraryGridMode.tsx";
import { LibraryListMode } from "./library/LibraryListMode.tsx";
import { LibraryPowerTable } from "./library/LibraryPowerTable.tsx";
import {
  LibraryActiveFilterBadges,
  LibraryDisplayOptionsMenu,
  LibraryEmptyDailiesToggle,
  LibraryEmptyState,
  LibraryPaginationFooter,
  LibrarySortControls,
  LibraryViewSwitcher,
} from "./library/LibrarySharedControls.tsx";
import type { DocumentListViewProps, LibraryViewUrlState } from "./library/types.ts";
import { useLibraryWorkspace } from "./library/useLibraryWorkspace.ts";

export type { DocumentListViewProps, LibraryViewUrlState };

export function DocumentListView(props: DocumentListViewProps = {}): React.ReactElement {
  const scrollToDocIdRef = useRef<((docId: DocumentId) => void) | null>(null);
  const studioScrollRef = useRef<HTMLDivElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  const { notifier } = useInkadeViewsContext();
  const state = useLibraryWorkspace({ ...props, scrollToDocIdRef });

  const {
    t,
    navigation,
    hostActions,
    canvasWidth,
    updatePreferences,
    isReadOnly,
    isMdUp,
    viewMode,
    displayOptions,
    displayPopoverOpen,
    setDisplayPopoverOpen,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
    selectedDocId,
    setSelectedDocId,
    setSelectedDocIds,
    bulkTagPopoverOpen,
    setBulkTagPopoverOpen,
    bulkTagDraft,
    setBulkTagDraft,
    studioDocId,
    setStudioDocId,
    splitDocId,
    setSplitDocId,
    kindFilter,
    setKindFilter,
    searchText,
    setSearchText,
    tagFilter,
    setTagFilter,
    pinnedOnly,
    unreadOnly,
    listPane,
    kindLabels,
    updateDisplayOptions,
    docsQuery,
    spaces,
    activeSpaces,
    allDocs,
    activeSavedView,
    activeSpace,
    filteredDocs,
    hiddenEmptyDailyCount,
    selectedDocs,
    hasExtraFilters,
    isSavedViewModified,
    showEmptyDailiesPill,
    isCompact,
    handleViewModeChange,
    handleResetFilters,
    saveViewLayoutMutation,
    bulkMoveSpaceMutation,
    bulkAddTagMutation,
    bulkPinMutation,
    bulkTrashMutation,
  } = state;

  const shouldPinSelected = selectedDocs.some((d) => !d.pinned);

  const renderBulkBar = (): React.ReactElement | null => {
    if (selectedDocs.length === 0) return null;
    return (
      <div
        className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-40 flex flex-col gap-1.5 rounded-xl border border-[var(--border-overlay)] bg-popover/96 px-3 py-2 shadow-[var(--shadow-overlay)] backdrop-blur-md md:inset-x-auto md:bottom-6 md:left-1/2 md:max-w-[94vw] md:-translate-x-1/2 md:flex-row md:flex-nowrap md:items-center md:gap-1.5 md:rounded-xl md:py-1.5"
        data-testid="library-bulk-bar"
      >
        <LibraryBulkActionBar
          activeSpaces={activeSpaces}
          bulkTagDraft={bulkTagDraft}
          bulkTagPopoverOpen={bulkTagPopoverOpen}
          movePending={bulkMoveSpaceMutation.isPending}
          onBulkAddTag={(tag) => bulkAddTagMutation.mutate(tag)}
          onBulkMoveSpace={(targetSpaceId) => bulkMoveSpaceMutation.mutate(targetSpaceId)}
          onBulkPin={(nextPinned) => bulkPinMutation.mutate(nextPinned)}
          onBulkTagDraftChange={setBulkTagDraft}
          onBulkTagPopoverOpenChange={setBulkTagPopoverOpen}
          onBulkTrash={() => bulkTrashMutation.mutate()}
          onClearSelection={() => setSelectedDocIds(new Set())}
          pinPending={bulkPinMutation.isPending}
          selectedCount={selectedDocs.length}
          shouldPin={shouldPinSelected}
          tagPending={bulkAddTagMutation.isPending}
          trashPending={bulkTrashMutation.isPending}
        />
      </div>
    );
  };

  // --- Studio Mode (Grid Card Wall or Sortable Property Table) ---
  if (viewMode !== "list") {
    if (studioDocId) {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between gap-2 border-b bg-background/85 px-4 py-2">
            <Button onClick={() => setStudioDocId(null)} size="xs" variant="ghost">
              <ArrowLeftIcon />
              {t("library.backToStudio")}
            </Button>
            <div className="flex items-center gap-1.5">
              <LibraryViewSwitcher
                compact
                onViewModeChange={handleViewModeChange}
                viewMode={viewMode}
              />
              <Button
                onClick={() => navigation.openDocument(studioDocId)}
                size="xs"
                variant="outline"
              >
                <ExternalLinkIcon />
                {t("library.openFullPage")}
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <DocumentDetailView
              documentId={studioDocId}
              externalSplitDocId={splitDocId}
              onExternalSplitClear={() => setSplitDocId(null)}
              readonly={isReadOnly}
              spaces={spaces}
              workspaceDocs={allDocs}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <header className="flex flex-col gap-2 border-b px-4 py-2.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {activeSpace && (
                <SpaceIcon
                  color={activeSpace.color}
                  icon={activeSpace.icon}
                  size="sm"
                  withChip
                />
              )}
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                {activeSavedView
                  ? activeSavedView.name
                  : activeSpace
                    ? activeSpace.name
                    : t("library.title")}
              </h1>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {filteredDocs.length}
              </span>

              <SegmentedControl size="sm">
                {(["all", "article", "clip", "outline"] as const).map((k) => (
                  <SegmentedControlItem
                    data-pressed={kindFilter === k ? "" : undefined}
                    key={k}
                    onClick={() => setKindFilter(k)}
                  >
                    {k === "all" ? t("common.all") : kindLabels[k]}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>

              <LibraryEmptyDailiesToggle
                hiddenCount={hiddenEmptyDailyCount}
                onToggle={() =>
                  updateDisplayOptions({ showEmptyDailies: !displayOptions.showEmptyDailies })
                }
                show={showEmptyDailiesPill}
                showEmptyDailies={displayOptions.showEmptyDailies}
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <div className="min-w-0 basis-full sm:w-48 sm:basis-auto xl:w-56">
                <Input
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder={t("library.filterPlaceholder")}
                  size="sm"
                  startAddon={<SearchIcon />}
                  value={searchText}
                />
              </div>
              <LibrarySortControls
                compact
                onSortByChange={setSortBy}
                onToggleSortDir={() =>
                  setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
                }
                sortBy={sortBy}
                sortDir={sortDir}
              />
              <LibraryDisplayOptionsMenu
                canvasWidth={canvasWidth}
                compact
                displayOptions={displayOptions}
                onOpenChange={setDisplayPopoverOpen}
                onUpdateCanvasWidth={(next) =>
                  updatePreferences({ layout: { workspaceCanvasWidth: next } })
                }
                onUpdateDisplayOptions={updateDisplayOptions}
                open={displayPopoverOpen}
              />
              <LibraryViewSwitcher
                onViewModeChange={handleViewModeChange}
                viewMode={viewMode}
              />
              {activeSavedView && isSavedViewModified && (
                <Button
                  loading={saveViewLayoutMutation.isPending}
                  onClick={() => saveViewLayoutMutation.mutate()}
                  size="xs"
                  variant="secondary"
                >
                  <BookmarkCheckIcon />
                  {t("library.saveViewLayout")}
                </Button>
              )}
              {hasExtraFilters && (
                <Button onClick={handleResetFilters} size="xs" variant="ghost">
                  {t("library.clearFilters")}
                </Button>
              )}
              {activeSpace && !isReadOnly && (
                <Button
                  aria-label={t("library.schemaSettingsButton")}
                  onClick={() => setSchemaDialogOpen(true)}
                  size="xs"
                  title={t("library.schemaSettingsButton")}
                  variant="outline"
                >
                  <DatabaseIcon className="size-3.5" />
                  <span className="hidden sm:inline">{t("library.schemaSettingsButton")}</span>
                </Button>
              )}
              {!isReadOnly && (
                <>
                  <input
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setUploadingPdf(true);
                      void client.pdf
                        .upload({
                          file,
                          filename: file.name,
                          ...(activeSpace?.id ? { spaceId: activeSpace.id } : {}),
                        })
                        .then(async (res) => {
                          await Promise.all([
                            queryClient.invalidateQueries({
                              queryKey: [...inkadeQueryKeys.all, "documents"],
                            }),
                            queryClient.invalidateQueries({
                              queryKey: inkadeQueryKeys.workspaceSummary(),
                            }),
                          ]);
                          notifier.success(
                            t("pdfStudy.uploadPdfSuccessToast", { pages: res.asset.pageCount }),
                          );
                          navigation.openDocument(res.document.id);
                        })
                        .catch((err) => notifier.error(t("pdfStudy.uploadPdfFailedToast"), err))
                        .finally(() => setUploadingPdf(false));
                    }}
                    ref={pdfInputRef}
                    type="file"
                  />
                  <Button
                    aria-label={t("pdfStudy.uploadPdfBtn")}
                    disabled={uploadingPdf}
                    loading={uploadingPdf}
                    onClick={() => pdfInputRef.current?.click()}
                    size="xs"
                    title={t("pdfStudy.uploadPdfBtn")}
                    variant="outline"
                  >
                    <FileUpIcon />
                    <span className="hidden sm:inline">{t("pdfStudy.uploadPdfBtn")}</span>
                  </Button>
                </>
              )}
              <Button
                className="active:scale-[0.985] transition-[transform,colors]"
                onClick={() =>
                  hostActions.openNewDocument?.({
                    spaceId: activeSpace?.id,
                    kind: activeSpace?.defaultKind ?? "article",
                  })
                }
                size="xs"
                variant="outline"
              >
                <FilePlus2Icon />
                {t("library.newDoc")}
              </Button>
            </div>
          </div>

          <LibraryActiveFilterBadges
            activeSavedView={activeSavedView}
            hiddenEmptyDailyCount={hiddenEmptyDailyCount}
            omitEmptyDailies
            onClearTag={() => setTagFilter(null)}
            onToggleEmptyDailies={() =>
              updateDisplayOptions({ showEmptyDailies: !displayOptions.showEmptyDailies })
            }
            pinnedOnly={pinnedOnly}
            showEmptyDailies={displayOptions.showEmptyDailies}
            showEmptyDailiesPill={showEmptyDailiesPill}
            tagFilter={tagFilter}
            unreadOnly={unreadOnly}
          />
        </header>

        <ScrollArea className="min-h-0 flex-1" scrollFade viewportRef={studioScrollRef}>
          <div
            className={cn(
              "w-full px-4 py-3 pb-6 sm:px-6 sm:py-4 md:pb-4",
              canvasWidth === "centered" && "mx-auto max-w-[960px]",
            )}
            data-testid="library-body-container"
          >
            {docsQuery.isPending ? (
              viewMode === "table" ? (
                <LibraryTableSkeleton compact={isCompact} />
              ) : (
                <LibraryGridSkeleton compact={isCompact} />
              )
            ) : filteredDocs.length === 0 ? (
              <LibraryEmptyState
                onCreateArticle={() =>
                  hostActions.openNewDocument?.({
                    spaceId: activeSpace?.id,
                    kind: activeSpace?.defaultKind ?? "article",
                  })
                }
              />
            ) : viewMode === "grid" ? (
              <>
                <LibraryGridMode
                  scrollToDocIdRef={scrollToDocIdRef}
                  scrollViewportRef={studioScrollRef}
                  state={state}
                />
                <LibraryPaginationFooter
                  hasNextPage={Boolean(docsQuery.hasNextPage)}
                  isFetchingNextPage={docsQuery.isFetchingNextPage}
                  isPending={docsQuery.isPending}
                  onLoadMore={() => void docsQuery.fetchNextPage()}
                  totalLoaded={filteredDocs.length}
                />
              </>
            ) : viewMode === "board" ? (
              <>
                <LibraryBoardMode state={state} />
                <LibraryPaginationFooter
                  hasNextPage={Boolean(docsQuery.hasNextPage)}
                  isFetchingNextPage={docsQuery.isFetchingNextPage}
                  isPending={docsQuery.isPending}
                  onLoadMore={() => void docsQuery.fetchNextPage()}
                  totalLoaded={filteredDocs.length}
                />
              </>
            ) : (
              <>
                <LibraryPowerTable
                  scrollToDocIdRef={scrollToDocIdRef}
                  scrollViewportRef={studioScrollRef}
                  state={state}
                />
                <LibraryPaginationFooter
                  hasNextPage={Boolean(docsQuery.hasNextPage)}
                  isFetchingNextPage={docsQuery.isFetchingNextPage}
                  isPending={docsQuery.isPending}
                  onLoadMore={() => void docsQuery.fetchNextPage()}
                  totalLoaded={filteredDocs.length}
                />
              </>
            )}
          </div>
        </ScrollArea>

        {activeSpace && (
          <SpaceSchemaDialog
            onOpenChange={setSchemaDialogOpen}
            open={schemaDialogOpen}
            readOnly={isReadOnly}
            spaceId={activeSpace.id}
            spaceName={activeSpace.name}
          />
        )}

        {!isReadOnly && renderBulkBar()}
      </div>
    );
  }

  // --- Bear / Craft Split List Mode ---
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <section
        className={`flex min-h-0 w-full flex-1 flex-col bg-background md:flex-none md:shrink-0 ${
          selectedDocId ? "hidden md:flex" : "flex"
        }`}
        style={isMdUp ? { width: `${listPane.width}px` } : undefined}
      >
        <div className="flex flex-col gap-2 border-b p-2.5">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex min-w-0 items-center gap-2">
              {activeSpace && (
                <SpaceIcon
                  color={activeSpace.color}
                  icon={activeSpace.icon}
                  size="sm"
                  withChip
                />
              )}
              <h1 className="truncate text-sm font-semibold tracking-tight">
                {activeSavedView
                  ? activeSavedView.name
                  : activeSpace
                    ? activeSpace.name
                    : t("library.title")}
              </h1>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                {filteredDocs.length}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {hasExtraFilters && (
                <Button onClick={handleResetFilters} size="xs" variant="ghost">
                  {t("library.clearFilters")}
                </Button>
              )}
              <LibraryViewSwitcher
                compact
                onViewModeChange={handleViewModeChange}
                viewMode={viewMode}
              />
              <LibraryDisplayOptionsMenu
                canvasWidth={canvasWidth}
                compact
                displayOptions={displayOptions}
                onOpenChange={setDisplayPopoverOpen}
                onUpdateCanvasWidth={(next) =>
                  updatePreferences({ layout: { workspaceCanvasWidth: next } })
                }
                onUpdateDisplayOptions={updateDisplayOptions}
                open={displayPopoverOpen}
              />
              <Button
                aria-label={t("library.newDoc")}
                className="active:scale-[0.985] transition-[transform,colors]"
                onClick={() =>
                  hostActions.openNewDocument?.({
                    spaceId: activeSpace?.id,
                    kind: activeSpace?.defaultKind ?? "article",
                  })
                }
                size="icon-xs"
                title={t("library.newDoc")}
                variant="outline"
              >
                <FilePlus2Icon />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Input
              className="min-w-0 flex-1"
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t("library.filterPlaceholder")}
              size="sm"
              startAddon={<SearchIcon />}
              value={searchText}
            />
            <LibrarySortControls
              compact
              onSortByChange={setSortBy}
              onToggleSortDir={() =>
                setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
              }
              sortBy={sortBy}
              sortDir={sortDir}
            />
          </div>

          <SegmentedControl className="w-full" size="sm">
            {(["all", "article", "clip", "outline"] as const).map((k) => (
              <SegmentedControlItem
                className="flex-1"
                data-pressed={kindFilter === k ? "" : undefined}
                key={k}
                onClick={() => setKindFilter(k)}
              >
                {k === "all" ? t("common.all") : kindLabels[k]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>

          <LibraryActiveFilterBadges
            activeSavedView={activeSavedView}
            hiddenEmptyDailyCount={hiddenEmptyDailyCount}
            onClearTag={() => setTagFilter(null)}
            onToggleEmptyDailies={() =>
              updateDisplayOptions({ showEmptyDailies: !displayOptions.showEmptyDailies })
            }
            pinnedOnly={pinnedOnly}
            showEmptyDailies={displayOptions.showEmptyDailies}
            showEmptyDailiesPill={showEmptyDailiesPill}
            tagFilter={tagFilter}
            unreadOnly={unreadOnly}
          />

          {activeSavedView && isSavedViewModified && (
            <Button
              className="w-full justify-center"
              loading={saveViewLayoutMutation.isPending}
              onClick={() => saveViewLayoutMutation.mutate()}
              size="xs"
              variant="secondary"
            >
              <BookmarkCheckIcon />
              {t("library.saveViewLayout")}
            </Button>
          )}
        </div>

        <LibraryListMode scrollToDocIdRef={scrollToDocIdRef} state={state} />
      </section>

      <ResizeHandle
        ariaLabel={t("library.resizeListAria")}
        className="hidden md:block"
        onResizeDelta={listPane.resizeByDelta}
        onResizeEnd={() => listPane.setIsResizing(false)}
        onResizeStart={() => listPane.setIsResizing(true)}
        onReset={listPane.resetWidth}
        orientation="vertical"
        valueMax={460}
        valueMin={260}
        valueNow={listPane.width}
      />

      <section
        className={`min-w-0 flex-1 overflow-hidden ${
          selectedDocId ? "flex flex-col" : "hidden md:flex md:flex-col"
        }`}
      >
        {selectedDocId ? (
          <>
            <div className="border-b px-4 py-2 md:hidden">
              <Button
                onClick={() => setSelectedDocId(null)}
                size="xs"
                variant="ghost"
              >
                <ArrowLeftIcon />
                {t("library.backToList")}
              </Button>
            </div>
            <div className="h-full min-h-0 flex-1 overflow-hidden">
              <DocumentDetailView
                documentId={selectedDocId}
                externalSplitDocId={splitDocId}
                onExternalSplitClear={() => setSplitDocId(null)}
                readonly={isReadOnly}
                spaces={spaces}
                workspaceDocs={allDocs}
              />
            </div>
          </>
        ) : docsQuery.isPending ? (
          <DocumentDetailSkeleton />
        ) : (
          <Empty className="h-full py-20">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileTextIcon />
              </EmptyMedia>
              <EmptyTitle>{t("library.selectDocTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("library.selectDocDescPrefix")}{" "}
                <code className="font-mono">E</code>{" "}
                {t("library.selectDocDescSuffix")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>

      {renderBulkBar()}
    </div>
  );
}
