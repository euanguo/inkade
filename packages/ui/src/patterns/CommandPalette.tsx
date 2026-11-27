"use client";

import type { DocumentId, DocumentKind, DocumentRecord, SearchHit } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  CommandIcon,
  FileTextIcon,
  Link2Icon,
  ListTreeIcon,
  Loader2Icon,
  PaperclipIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from "../primitives/command.tsx";
import { Kbd } from "../primitives/kbd.tsx";
import { Skeleton } from "../primitives/skeleton.tsx";
import { SpaceIcon } from "../primitives/space-icon.tsx";
import { parseHighlightSegments } from "./command-highlight.ts";

export type CommandSearchMode = "hybrid" | "keyword";
export type CommandHitMatchSource = "hybrid" | "semantic" | "keyword";

export type CommandPaletteSearchHit = SearchHit & {
  readonly matchSource?: CommandHitMatchSource | undefined;
};

export interface CommandPaletteUrlClipAction {
  readonly url: string;
  readonly label: string;
  readonly loading?: boolean | undefined;
  readonly onClip: () => void;
}

export interface CommandPaletteAction {
  readonly id: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly shortcut?: string | undefined;
  readonly icon?: React.ReactNode | undefined;
  readonly keywords?: readonly string[] | undefined;
  readonly alwaysShow?: boolean | undefined;
  readonly onSelect: () => void;
}

export interface CommandPaletteFilterChip {
  readonly key: string;
  readonly label: string;
}

export interface CommandPaletteScopeLockChip {
  readonly label: string;
  readonly color?: string | undefined;
  readonly icon?: string | undefined;
  readonly onClear: () => void;
}

export type CommandPaletteEntry =
  | {
      readonly id: string;
      readonly entryType: "hit";
      readonly label: string;
      readonly hit: CommandPaletteSearchHit;
      readonly matchSource?: CommandHitMatchSource | undefined;
    }
  | {
      readonly id: string;
      readonly entryType: "document";
      readonly label: string;
      readonly document: Pick<DocumentRecord, "id" | "title" | "kind" | "spaceId" | "updatedAt">;
    }
  | {
      readonly id: string;
      readonly entryType: "action";
      readonly label: string;
      readonly action: CommandPaletteAction;
    };

type InternalCommandPaletteEntry =
  | CommandPaletteEntry
  | {
      readonly id: string;
      readonly entryType: "url-clip";
      readonly label: string;
      readonly urlClip: CommandPaletteUrlClipAction;
    };

export interface CommandPaletteGroup {
  readonly value: string;
  readonly items: readonly CommandPaletteEntry[];
}

interface InternalCommandPaletteGroup {
  readonly value: string;
  readonly items: readonly InternalCommandPaletteEntry[];
}

const KIND_ICONS: Readonly<Record<DocumentKind, React.ReactElement>> = {
  outline: <ListTreeIcon className="size-4 text-muted-foreground" />,
  article: <FileTextIcon className="size-4 text-muted-foreground" />,
  clip: <PaperclipIcon className="size-4 text-muted-foreground" />,
};

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly filterText?: string | undefined;
  readonly activeFilters?: readonly CommandPaletteFilterChip[] | undefined;
  readonly scopeLockChip?: CommandPaletteScopeLockChip | null | undefined;
  readonly onTabAction?: ((activeEntry: CommandPaletteEntry | null) => boolean) | undefined;
  readonly onBackspaceEmpty?: (() => boolean) | undefined;
  readonly searchHits?: readonly CommandPaletteSearchHit[] | undefined;
  readonly recentDocuments?: readonly Pick<
    DocumentRecord,
    "id" | "title" | "kind" | "spaceId" | "updatedAt"
  >[] | undefined;
  readonly bypassDocumentFilter?: boolean | undefined;
  readonly actions?: readonly CommandPaletteAction[] | undefined;
  readonly extraGroups?: readonly CommandPaletteGroup[] | undefined;
  readonly loading?: boolean | undefined;
  readonly placeholder?: string | undefined;
  readonly hintText?: string | undefined;
  readonly searchMode?: CommandSearchMode | undefined;
  readonly onSearchModeChange?: ((mode: CommandSearchMode) => void) | undefined;
  readonly urlClipAction?: CommandPaletteUrlClipAction | null | undefined;
  readonly onSelectHit?: ((hit: CommandPaletteSearchHit) => void) | undefined;
  readonly onSelectDocument?: ((documentId: DocumentId) => void) | undefined;
  readonly onOpenInSplit?: ((documentId: DocumentId) => void) | undefined;
  readonly onDispatchAde?: ((documentId: DocumentId, title: string) => void) | undefined;
  readonly className?: string | undefined;
}

function extractHighlightedEntryId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return typeof value.id === "string" ? value.id : null;
  }
  return null;
}

function getEntryDocumentTarget(
  entry: InternalCommandPaletteEntry | null,
): { readonly documentId: DocumentId; readonly title: string } | null {
  if (!entry) return null;
  if (entry.entryType === "hit") {
    return { documentId: entry.hit.documentId, title: entry.hit.title };
  }
  if (entry.entryType === "document") {
    return { documentId: entry.document.id, title: entry.document.title };
  }
  return null;
}

function HighlightedSnippet({ snippet }: { snippet: string }): React.ReactElement {
  const segments = useMemo(() => parseHighlightSegments(snippet), [snippet]);
  return (
    <span className="line-clamp-1 text-xs text-muted-foreground">
      {segments.map((seg, idx) =>
        seg.highlighted ? (
          <mark className="inkade-highlight" key={idx}>
            {seg.text}
          </mark>
        ) : (
          <span key={idx}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  filterText,
  activeFilters = [],
  scopeLockChip = null,
  onTabAction,
  onBackspaceEmpty,
  searchHits = [],
  recentDocuments = [],
  bypassDocumentFilter = false,
  actions = [],
  extraGroups = [],
  loading = false,
  placeholder,
  hintText,
  searchMode = "keyword",
  onSearchModeChange,
  urlClipAction = null,
  onSelectHit,
  onSelectDocument,
  onOpenInSplit,
  onDispatchAde,
  className,
}: CommandPaletteProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const normalizedFilter = (filterText ?? query).trim().toLowerCase();
  const resolvedPlaceholder = placeholder ?? t("command.placeholder");

  useEffect(() => {
    if (!open) {
      setHighlightedEntryId(null);
    }
  }, [open]);

  const kindLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutline"),
    article: t("common.kindArticle"),
    clip: t("common.kindClip"),
  };

  const groups = useMemo<InternalCommandPaletteGroup[]>(() => {
    const result: InternalCommandPaletteGroup[] = [];

    if (urlClipAction) {
      result.push({
        value: t("command.groupUrlClip"),
        items: [
          {
            id: `url-clip:${urlClipAction.url}`,
            entryType: "url-clip",
            label: urlClipAction.label,
            urlClip: urlClipAction,
          },
        ],
      });
    }

    for (const extra of extraGroups) {
      if (extra.items.length > 0) {
        result.push(extra);
      }
    }

    if (searchHits.length > 0) {
      result.push({
        value: t("command.groupSearchResults"),
        items: searchHits.map((hit) => ({
          id: `hit:${hit.entityType}:${hit.documentId}:${hit.nodeId ?? "doc"}`,
          entryType: "hit",
          label: hit.title,
          hit,
          matchSource: hit.matchSource,
        })),
      });
    }

    const filteredRecent = (
      bypassDocumentFilter
        ? recentDocuments
        : recentDocuments.filter(
            (doc) => !normalizedFilter || doc.title.toLowerCase().includes(normalizedFilter),
          )
    ).slice(0, 8);

    if (filteredRecent.length > 0) {
      result.push({
        value: t("command.groupRecentDocs"),
        items: filteredRecent.map((doc) => ({
          id: `doc:${doc.id}`,
          entryType: "document",
          label: doc.title,
          document: doc,
        })),
      });
    }

    const filteredActions = actions.filter((action) => {
      if (action.alwaysShow) return true;
      if (!normalizedFilter) return true;
      if (action.label.toLowerCase().includes(normalizedFilter)) return true;
      if (action.description?.toLowerCase().includes(normalizedFilter)) return true;
      return action.keywords?.some((kw) => kw.toLowerCase().includes(normalizedFilter)) ?? false;
    });

    if (filteredActions.length > 0) {
      result.push({
        value: t("command.groupQuickActions"),
        items: filteredActions.map((action) => ({
          id: `action:${action.id}`,
          entryType: "action",
          label: action.label,
          action,
        })),
      });
    }

    return result;
  }, [
    urlClipAction,
    extraGroups,
    searchHits,
    recentDocuments,
    bypassDocumentFilter,
    actions,
    normalizedFilter,
    t,
  ]);

  const allEntries = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );

  const activeEntry = useMemo<InternalCommandPaletteEntry | null>(() => {
    if (highlightedEntryId) {
      const matched = allEntries.find((entry) => entry.id === highlightedEntryId);
      if (matched) return matched;
    }
    return allEntries[0] ?? null;
  }, [allEntries, highlightedEntryId]);

  const handleSelectEntry = (entry: InternalCommandPaletteEntry): void => {
    if (entry.entryType === "url-clip") {
      if (!entry.urlClip.loading) {
        entry.urlClip.onClip();
      }
      return;
    }
    onOpenChange(false);
    if (entry.entryType === "hit") {
      onSelectHit?.(entry.hit);
    } else if (entry.entryType === "document") {
      onSelectDocument?.(entry.document.id);
    } else {
      entry.action.onSelect();
    }
  };

  const handlePopupKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return;

    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      onTabAction
    ) {
      const targetEntry = activeEntry && activeEntry.entryType !== "url-clip" ? activeEntry : null;
      if (onTabAction(targetEntry)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    if (
      event.key === "Backspace" &&
      query.length === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      onBackspaceEmpty
    ) {
      if (onBackspaceEmpty()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    if (
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "k" &&
      onSearchModeChange
    ) {
      event.preventDefault();
      event.stopPropagation();
      onSearchModeChange(searchMode === "hybrid" ? "keyword" : "hybrid");
      return;
    }

    if (event.key !== "Enter") return;

    const targetDoc = getEntryDocumentTarget(activeEntry);
    if (!targetDoc) return;

    if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && onOpenInSplit) {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      onOpenInSplit(targetDoc.documentId);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && onDispatchAde) {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      onDispatchAde(targetDoc.documentId, targetDoc.title);
    }
  };

  return (
    <CommandDialog onOpenChange={onOpenChange} open={open}>
      <CommandDialogPopup
        className={cn("max-w-2xl", className)}
        onKeyDownCapture={handlePopupKeyDownCapture}
      >
        <Command
          items={groups}
          mode="none"
          onItemHighlighted={(value) => {
            const nextId = extractHighlightedEntryId(value);
            setHighlightedEntryId((prev) => (prev === nextId ? prev : nextId));
          }}
          onValueChange={(next) => onQueryChange(next)}
          value={query}
        >
          <div className="flex items-center gap-2 pr-3">
            {scopeLockChip && (
              <span
                className="ml-3 inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/35 bg-primary/10 py-0.5 pr-1 pl-2 text-xs font-medium text-primary"
                data-testid="command-scope-lock-pill"
              >
                <SpaceIcon color={scopeLockChip.color} icon={scopeLockChip.icon} size="xs" />
                <span className="max-w-28 truncate">{scopeLockChip.label}</span>
                <button
                  aria-label={t("command.scopeUnlockAria")}
                  className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full hover:bg-primary/20"
                  onClick={scopeLockChip.onClear}
                  type="button"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            )}
            <div className="min-w-0 flex-1">
              <CommandInput placeholder={resolvedPlaceholder} />
            </div>
            {(onSearchModeChange || searchMode === "hybrid") && (
              <button
                aria-label={t("command.toggleSearchModeAria")}
                className={cn(
                  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default",
                  searchMode === "hybrid"
                    ? "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15"
                    : "border-border bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                disabled={!onSearchModeChange}
                onClick={() =>
                  onSearchModeChange?.(searchMode === "hybrid" ? "keyword" : "hybrid")
                }
                title={t("command.toggleSearchModeTitle")}
                type="button"
              >
                {searchMode === "hybrid" ? (
                  <SparklesIcon className="size-3" />
                ) : (
                  <SearchIcon className="size-3" />
                )}
                <span>
                  {searchMode === "hybrid" ? t("command.modeHybrid") : t("command.modeKeyword")}
                </span>
                {onSearchModeChange && (
                  <Kbd className="hidden h-4 min-w-0 px-1 text-[10px] sm:inline-flex">
                    ⌘⇧K
                  </Kbd>
                )}
              </button>
            )}
          </div>
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3.5 py-1.5">
              {activeFilters.map((chip) => (
                <Badge key={chip.key} size="sm" variant="info">
                  {chip.label}
                </Badge>
              ))}
            </div>
          )}
          <CommandPanel>
            <CommandList>
              {loading && (
                <div aria-busy="true" className="flex flex-col gap-1 px-2 py-2">
                  <Skeleton className="mx-2 mb-1 h-3 w-20" />
                  {["w-44", "w-56", "w-36"].map((wClass, idx) => (
                    <div className="flex items-center justify-between gap-2.5 px-2 py-2" key={idx}>
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <Skeleton className="size-4 shrink-0 rounded-sm" />
                        <Skeleton className={`h-4 max-w-full ${wClass}`} />
                      </div>
                      <Skeleton className="h-4 w-12 shrink-0 rounded-full" />
                    </div>
                  ))}
                </div>
              )}

              {groups.length === 0 && !loading && (
                <CommandEmpty>
                  <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                    <SearchIcon className="size-5 text-muted-foreground/70" />
                    <p className="text-sm font-medium text-foreground">{t("command.noResultsTitle")}</p>
                    <p className="text-xs text-muted-foreground">{t("command.noResultsDesc")}</p>
                  </div>
                </CommandEmpty>
              )}

              {groups.map((group, groupIdx) => (
                <div key={group.value}>
                  {groupIdx > 0 && <CommandSeparator />}
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel>{group.value}</CommandGroupLabel>
                    <CommandCollection>
                      {(entry: InternalCommandPaletteEntry) => {
                        const hitMatchSource =
                          entry.entryType === "hit"
                            ? (entry.matchSource ?? entry.hit.matchSource)
                            : undefined;

                        return (
                          <CommandItem
                            className={
                              entry.entryType === "url-clip"
                                ? "rounded-xl border border-primary/25 bg-primary/8 px-3 py-2.5 data-highlighted:border-primary/45 data-highlighted:bg-primary/14"
                                : undefined
                            }
                            key={entry.id}
                            onClick={() => handleSelectEntry(entry)}
                            onMouseEnter={() => setHighlightedEntryId(entry.id)}
                            value={entry.id}
                          >
                            {entry.entryType === "url-clip" && (
                              <div className="flex w-full min-w-0 items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <span className="shrink-0 text-primary">
                                    {entry.urlClip.loading ? (
                                      <Loader2Icon className="size-4 animate-spin" />
                                    ) : (
                                      <Link2Icon className="size-4" />
                                    )}
                                  </span>
                                  <div className="flex min-w-0 flex-col gap-0.5">
                                    <span className="truncate font-medium text-foreground">
                                      {entry.urlClip.label}
                                    </span>
                                    <span className="truncate font-mono text-xs text-muted-foreground">
                                      {entry.urlClip.url}
                                    </span>
                                  </div>
                                </div>
                                <Kbd>↵</Kbd>
                              </div>
                            )}

                            {entry.entryType === "hit" && (
                              <div className="flex w-full min-w-0 items-start gap-2.5 py-0.5">
                                <span className="mt-0.5 shrink-0">
                                  {KIND_ICONS[entry.hit.kind]}
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate font-medium text-foreground">
                                      {entry.hit.title}
                                    </span>
                                    <Badge size="sm" variant="outline">
                                      {entry.hit.entityType === "outline_node"
                                        ? t("command.nodeBadge")
                                        : kindLabels[entry.hit.kind]}
                                    </Badge>
                                    {(hitMatchSource === "hybrid" ||
                                      hitMatchSource === "semantic") && (
                                      <Badge
                                        size="sm"
                                        variant={hitMatchSource === "hybrid" ? "info" : "secondary"}
                                      >
                                        <SparklesIcon className="size-2.5" />
                                        {hitMatchSource === "hybrid"
                                          ? t("command.matchSourceHybrid")
                                          : t("command.matchSourceSemantic")}
                                      </Badge>
                                    )}
                                  </div>
                                  {entry.hit.snippet && (
                                    <HighlightedSnippet snippet={entry.hit.snippet} />
                                  )}
                                </div>
                              </div>
                            )}

                            {entry.entryType === "document" && (
                              <div className="flex w-full min-w-0 items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  {KIND_ICONS[entry.document.kind]}
                                  <span className="truncate font-medium">
                                    {entry.document.title}
                                  </span>
                                </div>
                                <Badge size="sm" variant="secondary">
                                  {kindLabels[entry.document.kind]}
                                </Badge>
                              </div>
                            )}

                            {entry.entryType === "action" && (
                              <div className="flex w-full min-w-0 items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <span className="shrink-0 text-muted-foreground">
                                    {entry.action.icon ?? <SparklesIcon className="size-4" />}
                                  </span>
                                  <div className="flex min-w-0 flex-col">
                                    <span className="truncate font-medium">
                                      {entry.action.label}
                                    </span>
                                    {entry.action.description && (
                                      <span className="truncate text-xs text-muted-foreground">
                                        {entry.action.description}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {entry.action.shortcut && (
                                  <CommandShortcut>{entry.action.shortcut}</CommandShortcut>
                                )}
                              </div>
                            )}
                          </CommandItem>
                        );
                      }}
                    </CommandCollection>
                  </CommandGroup>
                </div>
              ))}
            </CommandList>
          </CommandPanel>

          <CommandFooter className="flex-wrap gap-y-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <CommandIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {hintText ??
                  (searchMode === "hybrid"
                    ? t("command.footerTitleHybrid")
                    : t("command.footerTitle"))}
              </span>
            </div>
            <div className="hidden flex-wrap items-center gap-x-2.5 gap-y-1 sm:flex">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <span>{t("command.navigateHint")}</span>
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd>
                <span>{t("command.openHint")}</span>
              </span>
              <span className="flex items-center gap-1">
                <Kbd>⇧⏎</Kbd>
                <span>{t("command.splitHint")}</span>
              </span>
              <span className="flex items-center gap-1">
                <Kbd>⌘⏎</Kbd>
                <span>{t("command.dispatchHint")}</span>
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Tab</Kbd>
                <span>
                  {scopeLockChip ? t("command.scopeUnlockHint") : t("command.scopeLockHint")}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Esc</Kbd>
                <span>{t("command.closeHint")}</span>
              </span>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
