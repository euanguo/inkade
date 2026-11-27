import type { DocumentSummary } from "@inkade/core";
import { CommandPalette } from "@inkade/ui";
import { DispatchAdeDialog } from "@inkade/views/components/DispatchAdeDialog";
import type React from "react";
import { useCommandPaletteActions } from "./command-palette/useCommandPaletteActions.tsx";
import { useCommandPaletteState } from "./command-palette/useCommandPaletteState.ts";

export interface GlobalCommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly effectiveTheme: "light" | "dark";
  readonly onToggleTheme: () => void;
  readonly onNewDocument: () => void;
  readonly onQuickCapture: () => void;
  readonly onOpenAskDrawer: () => void;
}

export function GlobalCommandPalette({
  open,
  onOpenChange,
  effectiveTheme,
  onToggleTheme,
  onNewDocument,
  onQuickCapture,
  onOpenAskDrawer,
}: GlobalCommandPaletteProps): React.ReactElement {
  const state = useCommandPaletteState({ open, onOpenChange });
  const {
    t,
    navigate,
    pathname,
    query,
    setQuery,
    debouncedQuery,
    searchMode,
    setSearchMode,
    dispatchTarget,
    setDispatchTarget,
    lockedSpace,
    todoQuickAddText,
    activeSpaces,
    parsedLive,
    detectedClipUrl,
    defaultArticleSpace,
    searchQuery,
    urlClipAction,
    createArticleMutation,
    createTodoMutation,
    handleExportZip,
    docById,
    waitingBindings,
    filteredRecentDocs,
    filteredSearchHits,
    activeFilters,
    scopeLockChip,
    handleSelectHit,
    handleSelectDoc,
    handleOpenInSplit,
    handleDispatchAde,
    handleTabAction,
    handleBackspaceEmpty,
  } = state;

  const { extraGroups, actions } = useCommandPaletteActions({
    t,
    navigate,
    pathname,
    effectiveTheme,
    onToggleTheme,
    onNewDocument,
    onQuickCapture,
    onOpenAskDrawer,
    todoQuickAddText,
    detectedClipUrl,
    parsedLive,
    defaultArticleSpace,
    activeSpaces,
    waitingBindings,
    docById,
    searchIsFetching: searchQuery.isFetching,
    filteredSearchHitsCount: filteredSearchHits.length,
    filteredRecentDocsCount: filteredRecentDocs.length,
    onCreateTodo: (text) => createTodoMutation.mutate(text),
    onCreateArticle: (title) => createArticleMutation.mutate(title),
    onExportZip: handleExportZip,
  });

  const recentDocuments: readonly Pick<
    DocumentSummary,
    "id" | "title" | "kind" | "spaceId" | "updatedAt"
  >[] = filteredRecentDocs;

  return (
    <>
      <CommandPalette
        actions={actions}
        activeFilters={activeFilters}
        bypassDocumentFilter={
          Boolean(lockedSpace) ||
          parsedLive.hasStructuredFilters ||
          parsedLive.textQuery.length > 0
        }
        extraGroups={extraGroups}
        filterText={parsedLive.textQuery}
        hintText={t("command.superSyntaxHint")}
        loading={debouncedQuery.length > 0 && parsedLive.textQuery.length > 0 && searchQuery.isFetching}
        onBackspaceEmpty={handleBackspaceEmpty}
        onDispatchAde={handleDispatchAde}
        onOpenChange={onOpenChange}
        onOpenInSplit={handleOpenInSplit}
        onQueryChange={setQuery}
        onSearchModeChange={setSearchMode}
        onSelectDocument={handleSelectDoc}
        onSelectHit={(hit) => void handleSelectHit(hit)}
        onTabAction={handleTabAction}
        open={open}
        query={query}
        recentDocuments={recentDocuments}
        scopeLockChip={scopeLockChip}
        searchHits={filteredSearchHits}
        searchMode={searchMode}
        urlClipAction={urlClipAction}
      />
      <DispatchAdeDialog onClose={() => setDispatchTarget(null)} target={dispatchTarget} />
    </>
  );
}
