import {
  type DocumentId,
  type DocumentSummary,
  formatPropertyScalar,
  type PropertyFieldDefinition,
  TASK_PRIORITIES,
} from "@inkade/core";
import {
  Badge,
  Button,
  Checkbox,
  ClipFavicon,
  cn,
  DocumentKindIcon,
  Input,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Popover,
  PopoverPopup,
  PopoverTrigger,
  PropertyOptionPill,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  SpaceColorBadge,
  SpaceIcon,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TagList,
  TASK_PRIORITY_STYLES,
} from "@inkade/ui";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type ExpandedState,
  type GroupingState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Columns2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import Papa from "papaparse";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { type DocumentSortField, extractDisplayProperties } from "../../lib/typed-properties.ts";
import { useListVirtualizer } from "../../lib/use-list-virtualizer.ts";
import { DocAdeBadge } from "./LibrarySharedControls.tsx";
import {
  DOC_PRIORITY_BADGE_LABELS,
  extractDocPriority,
  formatRelativeDate,
  getKindBadgeVariant,
  summarizeDocAde,
} from "./types.ts";
import type { LibraryWorkspaceState } from "./useLibraryWorkspace.ts";

const PERSISTABLE_SORT_FIELDS: ReadonlySet<DocumentSortField> = new Set([
  "updatedAt",
  "createdAt",
  "title",
  "kind",
  "space",
]);

export interface LibraryPowerTableProps {
  readonly state: LibraryWorkspaceState;
  readonly scrollViewportRef: React.RefObject<HTMLDivElement | null>;
  readonly scrollToDocIdRef: React.MutableRefObject<((docId: DocumentId) => void) | null>;
}

const RESERVED_BUILT_IN_COLS = new Set([
  "__select__",
  "title",
  "kind",
  "space",
  "priority",
  "properties",
  "tags",
  "ade",
  "updatedAt",
  "createdAt",
  "__actions__",
]);

function SchemaInlineCellEditor({
  doc,
  field,
  readOnly,
  onSaveValue,
}: {
  readonly doc: DocumentSummary;
  readonly field: PropertyFieldDefinition;
  readonly readOnly: boolean;
  readonly onSaveValue: (next: unknown) => void;
}): React.ReactElement {
  const { t } = useInkadeViewsT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const raw = doc.properties?.[field.key];

  if (field.type === "checkbox") {
    const isUnset = raw === undefined || raw === null;
    const checked = Boolean(raw);
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 transition-opacity",
          isUnset && "opacity-55 hover:opacity-100 focus-within:opacity-100",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Switch
          aria-label={field.label}
          checked={checked}
          disabled={readOnly}
          onCheckedChange={(next) => onSaveValue(next)}
        />
      </div>
    );
  }

  if (field.type === "select") {
    const strVal = typeof raw === "string" ? raw : "";
    const activeOpt = field.options.find((o) => o.value === strVal);
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Menu>
          <MenuTrigger
            render={
              <button
                className="cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-muted disabled:cursor-default"
                disabled={readOnly}
                type="button"
              />
            }
          >
            {activeOpt ? (
              <PropertyOptionPill color={activeOpt.color} label={activeOpt.label} />
            ) : strVal ? (
              <PropertyOptionPill label={strVal} />
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuItem onClick={() => onSaveValue(undefined)}>
              <span className="text-muted-foreground">{t("schema.selectOptionPlaceholder")}</span>
            </MenuItem>
            {field.options.map((opt) => (
              <MenuItem key={opt.value} onClick={() => onSaveValue(opt.value)}>
                <PropertyOptionPill color={opt.color} label={opt.label} />
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  if (field.type === "multi_select") {
    const vals = Array.isArray(raw) ? raw.map(formatPropertyScalar) : [];
    return (
      <div className="flex flex-wrap gap-1">
        {vals.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          vals.slice(0, 3).map((v) => {
            const opt = field.options.find((o) => o.value === v);
            return <PropertyOptionPill color={opt?.color} key={v} label={opt?.label ?? v} />;
          })
        )}
      </div>
    );
  }

  if (field.type === "url" && typeof raw === "string" && raw.trim() && !editing) {
    return (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <a
          className="inline-flex max-w-36 items-center gap-1 truncate text-xs text-primary hover:underline"
          href={raw}
          rel="noreferrer noopener"
          target="_blank"
        >
          <span className="truncate">{raw}</span>
          <ExternalLinkIcon className="size-3 shrink-0" />
        </a>
        {!readOnly && (
          <button
            aria-label={t("common.edit")}
            className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted"
            onClick={() => {
              setDraft(raw);
              setEditing(true);
            }}
            type="button"
          >
            <PlusIcon className="size-2.5" />
          </button>
        )}
      </div>
    );
  }

  if (editing && !readOnly) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          className="h-6 w-28 text-xs"
          onBlur={() => {
            setEditing(false);
            const trimmed = draft.trim();
            if (!trimmed) {
              onSaveValue(undefined);
              return;
            }
            if (field.type === "number") {
              const num = Number(trimmed);
              if (Number.isFinite(num)) onSaveValue(num);
              return;
            }
            onSaveValue(trimmed);
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
          size="sm"
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          value={draft}
        />
      </div>
    );
  }

  const displayStr =
    raw === undefined || raw === null || raw === ""
      ? ""
      : field.type === "number" && typeof raw === "number"
        ? field.numberFormat === "percent"
          ? `${raw}%`
          : field.numberUnit
            ? `${raw} ${field.numberUnit}`
            : String(raw)
        : formatPropertyScalar(raw);

  return (
    <button
      className="min-w-10 cursor-text truncate rounded px-1 py-0.5 text-left text-xs text-foreground transition-colors hover:bg-muted/70 disabled:cursor-default"
      disabled={readOnly}
      onClick={(e) => {
        if (readOnly) return;
        e.stopPropagation();
        setDraft(formatPropertyScalar(raw));
        setEditing(true);
      }}
      type="button"
    >
      {displayStr || <span className="text-muted-foreground">—</span>}
    </button>
  );
}

// Local bridge cleanly resolved by React Compiler / hooks in LibraryPowerTable
let useInkadeViewsT: () => { readonly t: LibraryWorkspaceState["t"] };

export function LibraryPowerTable({
  state,
  scrollViewportRef,
  scrollToDocIdRef,
}: LibraryPowerTableProps): React.ReactElement {
  const {
    t,
    isReadOnly,
    isLgUp,
    isCompact,
    displayOptions,
    filteredDocs,
    activeSpaces,
    activeSchemaFields,
    allSchemaFields,
    tableVisibleColumns,
    setTableVisibleColumns,
    tableColumnWidths,
    setTableColumnWidths,
    tableSortRules,
    setTableSortRules,
    sortBy,
    sortDir,
    applyLibrarySort,
    spaceById,
    bindingsByDocId,
    allWorkspaceTags,
    selectedDocIds,
    activeCursorDocId,
    openPriorityEditorDocId,
    setOpenPriorityEditorDocId,
    openTagEditorDocId,
    setOpenTagEditorDocId,
    inlineTagDraft,
    setInlineTagDraft,
    kindLabels,
    itemRefs,
    toggleDocSelection,
    toggleSelectAllVisible,
    handleOpenStudioDoc,
    handleSplitFromStudio,
    togglePinMutation,
    quickMoveSpaceMutation,
    quickUpdatePriorityMutation,
    quickUpdateTagsMutation,
    quickUpdatePropertiesMutation,
  } = state;

  useInkadeViewsT = () => ({ t });

  const effectiveSchemaFields = useMemo(
    () => (activeSchemaFields.length > 0 ? activeSchemaFields : allSchemaFields),
    [activeSchemaFields, allSchemaFields],
  );

  const schemaPriorityField = useMemo(
    () => effectiveSchemaFields.find((f) => f.key === "priority") ?? null,
    [effectiveSchemaFields],
  );

  const dynamicFields = useMemo(
    () =>
      effectiveSchemaFields.filter(
        (f) => f.showInTable && !RESERVED_BUILT_IN_COLS.has(f.key),
      ),
    [effectiveSchemaFields],
  );

  const [sorting, setSorting] = useState<SortingState>(() =>
    tableSortRules
      ? tableSortRules.map((r) => ({ id: r.field, desc: r.dir === "desc" }))
      : [{ id: sortBy, desc: sortDir === "desc" }],
  );
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    () => ({ ...(tableColumnWidths ?? {}) }),
  );

  useEffect(() => {
    if (tableColumnWidths) {
      setColumnSizing({ ...tableColumnWidths });
    }
  }, [tableColumnWidths]);

  useEffect(() => {
    if (tableSortRules) {
      setSorting(tableSortRules.map((r) => ({ id: r.field, desc: r.dir === "desc" })));
      return;
    }
    setSorting([{ id: sortBy, desc: sortDir === "desc" }]);
  }, [tableSortRules, sortBy, sortDir]);

  const columnVisibility = useMemo<VisibilityState>(() => {
    const stateMap: VisibilityState = {
      properties: displayOptions.showProperties,
      tags: displayOptions.showTags,
      ade: displayOptions.showAdeBadge,
    };
    if (tableVisibleColumns) {
      const visibleSet = new Set(tableVisibleColumns);
      for (const colKey of ["kind", "space", "priority", "properties", "tags", "ade", "updatedAt", "createdAt"]) {
        stateMap[colKey] = visibleSet.has(colKey);
      }
      for (const f of dynamicFields) {
        stateMap[f.key] = visibleSet.has(f.key);
      }
    }
    return stateMap;
  }, [
    displayOptions.showAdeBadge,
    displayOptions.showProperties,
    displayOptions.showTags,
    dynamicFields,
    tableVisibleColumns,
  ]);

  const allVisibleSelected =
    filteredDocs.length > 0 && filteredDocs.every((d) => selectedDocIds.has(d.id));

  const groupableSelectFields = useMemo(
    () =>
      (activeSchemaFields.length > 0 ? activeSchemaFields : allSchemaFields).filter(
        (f) => f.type === "select",
      ),
    [activeSchemaFields, allSchemaFields],
  );

  const columns = useMemo<ColumnDef<DocumentSummary>[]>(() => {
    const baseCols: ColumnDef<DocumentSummary>[] = [
      {
        id: "__select__",
        size: 38,
        enableResizing: false,
        enableSorting: false,
        enableGrouping: false,
        header: () => (
          <Checkbox
            aria-label={t("library.selectAllVisible")}
            checked={allVisibleSelected}
            onCheckedChange={toggleSelectAllVisible}
          />
        ),
        cell: ({ row }) => {
          const doc = row.original;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Checkbox
                aria-label={t("library.selectItemAria", { title: doc.title })}
                checked={selectedDocIds.has(doc.id)}
                onCheckedChange={() => toggleDocSelection(doc.id)}
              />
            </div>
          );
        },
      },
      {
        id: "title",
        accessorKey: "title",
        size: 260,
        minSize: 160,
        header: t("library.colTitle"),
        enableGrouping: false,
        cell: ({ row }) => {
          const doc = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <DocumentKindIcon kind={doc.kind} size="xs" />
              <span className="truncate font-medium text-foreground">{doc.title}</span>
              {doc.unreadAgentUpdate && (
                <span
                  aria-label={t("library.unreadAgentUpdate")}
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                  title={t("library.unreadAgentUpdate")}
                />
              )}
              {doc.pinned && (
                <PinIcon className="size-3 shrink-0 text-amber-500 dark:text-amber-400" />
              )}
            </div>
          );
        },
      },
      {
        id: "kind",
        accessorKey: "kind",
        size: 96,
        header: t("library.colKind"),
        cell: ({ row }) => (
          <Badge size="sm" variant={getKindBadgeVariant(row.original.kind)}>
            {kindLabels[row.original.kind]}
          </Badge>
        ),
      },
      {
        id: "space",
        accessorFn: (doc) => spaceById.get(doc.spaceId)?.name ?? doc.spaceId,
        size: 136,
        header: t("library.colSpace"),
        cell: ({ row }) => {
          const doc = row.original;
          const space = spaceById.get(doc.spaceId);
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      aria-label={t("library.quickMoveSpaceAria")}
                      className="inline-flex max-w-32 cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-foreground/85 transition-colors hover:bg-muted"
                      type="button"
                    />
                  }
                >
                  <SpaceColorBadge color={space?.color} size="sm" />
                  <span className="truncate">{space?.name ?? "—"}</span>
                </MenuTrigger>
                <MenuPopup align="start">
                  {activeSpaces.map((s) => (
                    <MenuItem
                      key={s.id}
                      onClick={() =>
                        quickMoveSpaceMutation.mutate({ docId: doc.id, spaceId: s.id })
                      }
                    >
                      <SpaceIcon color={s.color} icon={s.icon} size="xs" tone="mono" />
                      <span>{s.name}</span>
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            </div>
          );
        },
      },
      {
        id: "priority",
        accessorFn: (doc) => {
          if (schemaPriorityField) {
            const val = doc.properties?.[schemaPriorityField.key];
            return typeof val === "string" || typeof val === "number" ? String(val) : "";
          }
          return extractDocPriority(doc);
        },
        size: 96,
        header: t("library.colPriority"),
        cell: ({ row }) => {
          const doc = row.original;
          if (schemaPriorityField) {
            return (
              <SchemaInlineCellEditor
                doc={doc}
                field={schemaPriorityField}
                onSaveValue={(nextValue) => {
                  const nextProps: Record<string, unknown> = { ...(doc.properties ?? {}) };
                  if (nextValue === undefined || nextValue === null || nextValue === "") {
                    delete nextProps[schemaPriorityField.key];
                  } else {
                    nextProps[schemaPriorityField.key] = nextValue;
                  }
                  quickUpdatePropertiesMutation.mutate({
                    docId: doc.id,
                    properties: Object.keys(nextProps).length > 0 ? nextProps : null,
                  });
                }}
                readOnly={isReadOnly}
              />
            );
          }
          const docPriority = extractDocPriority(doc);
          const priorityStyle = TASK_PRIORITY_STYLES[docPriority];
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Popover
                onOpenChange={(nextOpen) =>
                  setOpenPriorityEditorDocId(nextOpen ? doc.id : null)
                }
                open={openPriorityEditorDocId === doc.id}
              >
                <PopoverTrigger
                  render={
                    <button
                      aria-label={t("library.quickEditPriorityAria")}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-60",
                        docPriority !== "none"
                          ? priorityStyle.pillClass
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-muted",
                      )}
                      data-testid={`library-inline-priority-${doc.id}`}
                      disabled={isReadOnly || quickUpdatePriorityMutation.isPending}
                      type="button"
                    />
                  }
                >
                  {docPriority !== "none" && (
                    <span className={cn("size-1.5 rounded-full", priorityStyle.dotClass)} />
                  )}
                  <span>{DOC_PRIORITY_BADGE_LABELS[docPriority]}</span>
                </PopoverTrigger>
                <PopoverPopup align="start" className="w-40" viewportClassName="p-1.5">
                  <div className="flex flex-col gap-0.5">
                    {TASK_PRIORITIES.map((p) => {
                      const active = docPriority === p;
                      const pStyle = TASK_PRIORITY_STYLES[p];
                      return (
                        <button
                          className={cn(
                            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent",
                            active && "bg-accent font-medium",
                          )}
                          key={p}
                          onClick={() =>
                            quickUpdatePriorityMutation.mutate({ doc, priority: p })
                          }
                          type="button"
                        >
                          <span className="flex items-center gap-1.5">
                            {p !== "none" && (
                              <span className={cn("size-2 rounded-full", pStyle.dotClass)} />
                            )}
                            <span>
                              {p === "none"
                                ? t("library.priorityNone")
                                : DOC_PRIORITY_BADGE_LABELS[p]}
                            </span>
                          </span>
                          {active && <CheckIcon className="size-3.5 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </PopoverPopup>
              </Popover>
            </div>
          );
        },
      },
    ];

    const schemaCols: ColumnDef<DocumentSummary>[] = dynamicFields.map((field) => ({
      id: field.key,
      accessorFn: (doc) => {
        const val = doc.properties?.[field.key];
        if (val === undefined || val === null) return "";
        return Array.isArray(val) ? val.join(", ") : val;
      },
      aggregationFn: field.type === "number" ? "sum" : "count",
      size: field.type === "number" ? 110 : field.type === "checkbox" ? 88 : 150,
      header: field.label,
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <SchemaInlineCellEditor
            doc={doc}
            field={field}
            onSaveValue={(nextValue) => {
              const nextProps: Record<string, unknown> = { ...(doc.properties ?? {}) };
              if (nextValue === undefined || nextValue === null || nextValue === "") {
                delete nextProps[field.key];
              } else {
                nextProps[field.key] = nextValue;
              }
              quickUpdatePropertiesMutation.mutate({
                docId: doc.id,
                properties: Object.keys(nextProps).length > 0 ? nextProps : null,
              });
            }}
            readOnly={isReadOnly}
          />
        );
      },
      aggregatedCell: ({ getValue }) => {
        const val = getValue();
        if (field.type === "number" && typeof val === "number") {
          return (
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {t("library.colSumStat", { sum: Number(val.toFixed(2)) })}
            </span>
          );
        }
        return null;
      },
    }));

    const trailingCols: ColumnDef<DocumentSummary>[] = [
      {
        id: "properties",
        size: 190,
        enableSorting: false,
        enableGrouping: false,
        header: t("library.colProperties"),
        cell: ({ row }) => {
          const doc = row.original;
          const propsInfo = extractDisplayProperties(doc);
          const visibleProps = propsInfo.allEntries.slice(0, 2);
          if (visibleProps.length === 0 && !propsInfo.sourceDomain) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-wrap items-center gap-1">
              {propsInfo.sourceDomain && (
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
              {visibleProps
                .filter((p) => !(p.key === "sourceUrl" && propsInfo.sourceDomain))
                .map((prop) => (
                  <Badge key={prop.key} size="sm" variant="outline">
                    <span className="text-muted-foreground">
                      {prop.labelKey ? t(prop.labelKey) : prop.key}
                    </span>
                    <span className="max-w-24 truncate">{prop.displayValue}</span>
                  </Badge>
                ))}
            </div>
          );
        },
      },
      {
        id: "tags",
        size: 165,
        enableSorting: false,
        enableGrouping: false,
        header: t("library.colTags"),
        cell: ({ row }) => {
          const doc = row.original;
          const tagSuggestions = allWorkspaceTags.filter((tag) => !doc.tags.includes(tag));
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Popover
                onOpenChange={(nextOpen) => {
                  setOpenTagEditorDocId(nextOpen ? doc.id : null);
                  if (!nextOpen) setInlineTagDraft("");
                }}
                open={openTagEditorDocId === doc.id}
              >
                <PopoverTrigger
                  render={
                    <button
                      aria-label={t("library.quickEditTagsAria")}
                      className="group/tagbtn flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted disabled:cursor-default"
                      data-testid={`library-inline-tags-${doc.id}`}
                      disabled={isReadOnly}
                      type="button"
                    />
                  }
                >
                  <div className="min-w-0 flex-1">
                    <TagList
                      emptyFallback={<span className="text-muted-foreground">—</span>}
                      formatOverflow={(count) => t("library.moreTagsCount", { count })}
                      maxFallbackVisible={2}
                      size="sm"
                      tags={doc.tags}
                    />
                  </div>
                  {!isReadOnly && (
                    <PlusIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/tagbtn:opacity-100" />
                  )}
                </PopoverTrigger>
                <PopoverPopup align="start" className="w-64" viewportClassName="p-2.5">
                  <div className="flex flex-col gap-2.5">
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const cleanTag = inlineTagDraft.trim().replace(/^#+/, "");
                        if (!cleanTag) return;
                        if (!doc.tags.includes(cleanTag)) {
                          quickUpdateTagsMutation.mutate({
                            docId: doc.id,
                            tags: [...doc.tags, cleanTag],
                          });
                        }
                        setInlineTagDraft("");
                      }}
                    >
                      <input
                        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                        onChange={(e) => setInlineTagDraft(e.target.value)}
                        placeholder={t("library.addTagPlaceholder")}
                        value={inlineTagDraft}
                      />
                      <Button
                        disabled={!inlineTagDraft.trim() || quickUpdateTagsMutation.isPending}
                        size="xs"
                        type="submit"
                      >
                        {t("library.addTagAction")}
                      </Button>
                    </form>
                    {doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 border-t border-border/60 pt-2">
                        {doc.tags.map((tag) => (
                          <button
                            className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                            key={tag}
                            onClick={() =>
                              quickUpdateTagsMutation.mutate({
                                docId: doc.id,
                                tags: doc.tags.filter((item) => item !== tag),
                              })
                            }
                            type="button"
                          >
                            <span>{tag}</span>
                            <XIcon className="size-2.5" />
                          </button>
                        ))}
                      </div>
                    )}
                    {tagSuggestions.length === 0 ? (
                      doc.tags.length === 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          {t("library.noWorkspaceTags")}
                        </p>
                      )
                    ) : (
                      <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto border-t border-border/60 pt-2">
                        {tagSuggestions.map((tag) => (
                          <button
                            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
                            key={tag}
                            onClick={() =>
                              quickUpdateTagsMutation.mutate({
                                docId: doc.id,
                                tags: [...doc.tags, tag],
                              })
                            }
                            type="button"
                          >
                            <PlusIcon className="size-2.5" />
                            <span>{tag}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </PopoverPopup>
              </Popover>
            </div>
          );
        },
      },
      {
        id: "ade",
        size: 110,
        enableSorting: false,
        enableGrouping: false,
        header: t("library.colAde"),
        cell: ({ row }) => {
          const adeSummary = summarizeDocAde(bindingsByDocId.get(row.original.id));
          return adeSummary ? (
            <DocAdeBadge summary={adeSummary} />
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        size: 110,
        enableGrouping: false,
        header: t("library.colUpdated"),
        cell: ({ row }) => (
          <span
            className="font-mono text-xs text-muted-foreground tabular-nums"
            title={row.original.updatedAt}
          >
            {formatRelativeDate(row.original.updatedAt, t)}
          </span>
        ),
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        size: 105,
        enableGrouping: false,
        header: t("library.colCreated"),
        cell: ({ row }) => (
          <span
            className="font-mono text-xs text-muted-foreground tabular-nums"
            title={row.original.createdAt}
          >
            {row.original.createdAt.slice(0, 10)}
          </span>
        ),
      },
      {
        id: "__actions__",
        size: 120,
        enableResizing: false,
        enableSorting: false,
        enableGrouping: false,
        header: () => <span className="block text-right">{t("library.colActions")}</span>,
        cell: ({ row }) => {
          const doc = row.original;
          return (
            <div
              className="flex items-center justify-end gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                aria-label={doc.pinned ? t("library.unpinAction") : t("library.pinAction")}
                onClick={() => togglePinMutation.mutate({ docId: doc.id, pinned: !doc.pinned })}
                size="icon-xs"
                title={doc.pinned ? t("library.unpinAction") : t("library.pinAction")}
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
                  onClick={() => handleSplitFromStudio(doc)}
                  size="icon-xs"
                  title={t("library.openInSplitPane")}
                  variant="ghost"
                >
                  <Columns2Icon />
                </Button>
              )}
              <Button onClick={() => handleOpenStudioDoc(doc)} size="xs" variant="ghost">
                {t("library.openAction")}
              </Button>
            </div>
          );
        },
      },
    ];

    return [...baseCols, ...schemaCols, ...trailingCols];
  }, [
    activeSpaces,
    allVisibleSelected,
    allWorkspaceTags,
    bindingsByDocId,
    dynamicFields,
    handleOpenStudioDoc,
    handleSplitFromStudio,
    inlineTagDraft,
    isLgUp,
    isReadOnly,
    kindLabels,
    openPriorityEditorDocId,
    openTagEditorDocId,
    quickMoveSpaceMutation,
    quickUpdatePriorityMutation,
    quickUpdatePropertiesMutation,
    quickUpdateTagsMutation,
    schemaPriorityField,
    selectedDocIds,
    setInlineTagDraft,
    setOpenPriorityEditorDocId,
    setOpenTagEditorDocId,
    spaceById,
    t,
    toggleDocSelection,
    togglePinMutation,
    toggleSelectAllVisible,
  ]);

  const tableData = useMemo(() => [...filteredDocs], [filteredDocs]);

  const table = useReactTable({
    data: tableData,
    columns,
    autoResetExpanded: false,
    state: {
      sorting,
      grouping,
      expanded,
      columnVisibility,
      columnSizing,
    },
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    enableGrouping: true,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(next);
      setTableSortRules(
        next.length > 0
          ? next.map((s) => ({ field: s.id, dir: s.desc ? "desc" : "asc" }))
          : null,
      );
      const primary = next[0];
      if (primary && PERSISTABLE_SORT_FIELDS.has(primary.id as DocumentSortField)) {
        applyLibrarySort(primary.id as DocumentSortField, primary.desc ? "desc" : "asc");
      }
    },
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    onColumnSizingChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnSizing) : updater;
      setColumnSizing(next);
      const rounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(next)) {
        rounded[k] = Math.max(48, Math.min(960, Math.round(v)));
      }
      setTableColumnWidths(Object.keys(rounded).length > 0 ? rounded : null);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const tableRows = table.getRowModel().rows;
  const numericFields = useMemo(
    () => dynamicFields.filter((f) => f.type === "number"),
    [dynamicFields],
  );
  const numericSums = useMemo(() => {
    const sums = new Map<string, number>();
    for (const f of numericFields) {
      let sum = 0;
      for (const doc of filteredDocs) {
        const val = doc.properties?.[f.key];
        const num = typeof val === "number" ? val : typeof val === "string" ? Number(val) : NaN;
        if (Number.isFinite(num)) sum += num;
      }
      sums.set(f.key, Number(sum.toFixed(2)));
    }
    return sums;
  }, [filteredDocs, numericFields]);

  const virtualizer = useListVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: tableRows.length,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: () => (isCompact ? 38 : 48),
    overscan: 10,
    getItemKey: (index) => tableRows[index]?.id ?? index,
  });

  useEffect(() => {
    scrollToDocIdRef.current = (docId: DocumentId) => {
      const idx = tableRows.findIndex((r) => !r.getIsGrouped() && r.original.id === docId);
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: "auto" });
      } else {
        itemRefs.current.get(docId)?.scrollIntoView({ block: "nearest" });
      }
    };
    return () => {
      scrollToDocIdRef.current = null;
    };
  }, [itemRefs, scrollToDocIdRef, tableRows, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? Math.max(0, totalSize - virtualItems[virtualItems.length - 1]!.end) : 0;
  const visibleColumnsCount = table.getVisibleLeafColumns().length;

  const handleExportCsv = (): void => {
    const visibleCols = table
      .getVisibleLeafColumns()
      .filter((col) => col.id !== "__select__" && col.id !== "__actions__");
    const headers = visibleCols.map((col) =>
      typeof col.columnDef.header === "string" ? col.columnDef.header : col.id,
    );
    const dataRows = filteredDocs.map((doc) =>
      visibleCols.map((col) => {
        if (col.id === "title") return doc.title;
        if (col.id === "kind") return kindLabels[doc.kind];
        if (col.id === "space") return spaceById.get(doc.spaceId)?.name ?? doc.spaceId;
        if (col.id === "priority") return DOC_PRIORITY_BADGE_LABELS[extractDocPriority(doc)];
        if (col.id === "tags") return doc.tags.join(", ");
        if (col.id === "updatedAt") return doc.updatedAt;
        if (col.id === "createdAt") return doc.createdAt;
        const val = doc.properties?.[col.id];
        if (val === undefined || val === null) return "";
        return formatPropertyScalar(val);
      }),
    );
    const csvText = Papa.unparse([headers, ...dataRows]);
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `inkade-library-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleableColumns = useMemo(
    () =>
      table
        .getAllLeafColumns()
        .filter((col) => col.id !== "__select__" && col.id !== "title" && col.id !== "__actions__"),
    [table],
  );

  const handleToggleColVisibility = (colId: string, nextVisible: boolean): void => {
    const currentlyVisible = toggleableColumns
      .filter((col) => col.getIsVisible())
      .map((col) => col.id);
    const nextList = nextVisible
      ? [...new Set([...currentlyVisible, colId])]
      : currentlyVisible.filter((id) => id !== colId);
    setTableVisibleColumns(nextList);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="library-power-table">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t("library.groupByLabel")}</span>
            <Select<string>
              onValueChange={(val) =>
                setGrouping(!val || val === "__none__" ? [] : [val])
              }
              value={grouping[0] ?? "__none__"}
            >
              <SelectTrigger className="w-36" size="sm">
                <SelectValue>
                  {grouping[0] === "priority"
                    ? t("library.groupByPriority")
                    : grouping[0]
                      ? (groupableSelectFields.find((f) => f.key === grouping[0])?.label ??
                        grouping[0])
                      : t("library.groupByNone")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="__none__">{t("library.groupByNone")}</SelectItem>
                <SelectItem value="priority">{t("library.groupByPriority")}</SelectItem>
                {groupableSelectFields.map((field) => (
                  <SelectItem key={field.key} value={field.key}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>

          <Popover>
            <PopoverTrigger
              render={
                <Button size="xs" type="button" variant="outline">
                  <SlidersHorizontalIcon className="size-3.5" />
                  <span>{t("library.columnsVisibilityButton")}</span>
                </Button>
              }
            />
            <PopoverPopup align="start" className="w-52" viewportClassName="p-2.5">
              <div className="flex flex-col gap-1.5">
                {toggleableColumns.map((col) => {
                  const label =
                    typeof col.columnDef.header === "string" ? col.columnDef.header : col.id;
                  const visible = col.getIsVisible();
                  return (
                    <label
                      className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                      key={col.id}
                    >
                      <Checkbox
                        checked={visible}
                        onCheckedChange={(checked) =>
                          handleToggleColVisibility(col.id, Boolean(checked))
                        }
                      />
                      <span className="truncate">{label}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverPopup>
          </Popover>
        </div>

        <Button
          onClick={handleExportCsv}
          size="xs"
          type="button"
          variant="outline"
        >
          <DownloadIcon className="size-3.5" />
          <span>{t("library.exportCsvButton")}</span>
        </Button>
      </div>

      <Table
        style={{
          minWidth: "100%",
          ...(table.getTotalSize() > 1280 ? { width: table.getTotalSize() } : {}),
        }}
        variant="card"
      >
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortState = header.column.getIsSorted();
                return (
                  <TableHead
                    className="relative select-none"
                    key={header.id}
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 font-medium transition-colors hover:text-foreground",
                          sortState ? "text-foreground" : "text-muted-foreground",
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                        type="button"
                      >
                        <span>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        {sortState === "asc" ? (
                          <ArrowUpIcon className="size-3" />
                        ) : sortState === "desc" ? (
                          <ArrowDownIcon className="size-3" />
                        ) : (
                          <ArrowUpDownIcon className="size-3 opacity-75" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}

                    {header.column.getCanResize() && (
                      <div
                        className={cn(
                          "absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/40",
                          header.column.getIsResizing() && "bg-primary",
                        )}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                      />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {paddingTop > 0 && (
            <TableRow aria-hidden="true" className="pointer-events-none border-0 hover:bg-transparent">
              <TableCell
                className="h-0 border-0 p-0"
                colSpan={visibleColumnsCount}
                style={{ height: paddingTop }}
              />
            </TableRow>
          )}

          {virtualItems.map((virtualRow) => {
            const row = tableRows[virtualRow.index];
            if (!row) return null;

            if (row.getIsGrouped()) {
              const groupColId = row.groupingColumnId ?? "";
              const groupFieldDef = dynamicFields.find((f) => f.key === groupColId);
              const groupValStr = formatPropertyScalar(row.groupingValue);
              const groupOpt = groupFieldDef?.options.find((o) => o.value === groupValStr);
              return (
                <TableRow
                  className="cursor-pointer bg-muted/40 hover:bg-muted/65"
                  key={row.id}
                  onClick={row.getToggleExpandedHandler()}
                >
                  <TableCell colSpan={visibleColumnsCount}>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground">
                      {row.getIsExpanded() ? (
                        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                      )}
                      {groupOpt ? (
                        <PropertyOptionPill color={groupOpt.color} label={groupOpt.label} />
                      ) : (
                        <span>{groupValStr || t("board.unassignedColumn")}</span>
                      )}
                      <Badge size="sm" variant="secondary">
                        {t("library.colCountStat", { count: row.subRows.length })}
                      </Badge>
                      {numericFields.map((numField) => {
                        let sum = 0;
                        let count = 0;
                        for (const subRow of row.subRows) {
                          const rawVal = subRow.original.properties?.[numField.key];
                          const num =
                            typeof rawVal === "number"
                              ? rawVal
                              : typeof rawVal === "string"
                                ? Number(rawVal)
                                : NaN;
                          if (Number.isFinite(num)) {
                            sum += num;
                            count += 1;
                          }
                        }
                        if (count === 0) return null;
                        return (
                          <span
                            className="font-mono text-[11px] font-normal text-muted-foreground tabular-nums"
                            key={numField.key}
                          >
                            {numField.label}: {Number(sum.toFixed(2))}
                          </span>
                        );
                      })}
                    </div>
                  </TableCell>
                </TableRow>
              );
            }

            const doc = row.original;
            const isBulkSelected = selectedDocIds.has(doc.id);
            const isCursor = activeCursorDocId === doc.id;

            return (
              <TableRow
                className={cn(
                  "cursor-pointer",
                  (isBulkSelected || isCursor) && "bg-accent/40",
                )}
                data-index={virtualRow.index}
                key={doc.id}
                onClick={(e) => handleOpenStudioDoc(doc, e)}
                ref={(el) => {
                  virtualizer.measureElement(el);
                  if (el) itemRefs.current.set(doc.id, el);
                  else itemRefs.current.delete(doc.id);
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    className={cn(isCompact && "py-1.5")}
                    key={cell.id}
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}

          {paddingBottom > 0 && (
            <TableRow aria-hidden="true" className="pointer-events-none border-0 hover:bg-transparent">
              <TableCell
                className="h-0 border-0 p-0"
                colSpan={visibleColumnsCount}
                style={{ height: paddingBottom }}
              />
            </TableRow>
          )}
        </TableBody>
        {numericFields.length > 0 && (
          <TableFooter>
            <TableRow>
              {table.getVisibleLeafColumns().map((col, idx) => {
                if (idx === 1) {
                  return (
                    <TableCell className="text-xs text-muted-foreground" key={col.id}>
                      {t("library.colCountStat", { count: filteredDocs.length })}
                    </TableCell>
                  );
                }
                const numSum = numericSums.get(col.id);
                if (numSum !== undefined) {
                  return (
                    <TableCell
                      className="font-mono text-xs text-foreground tabular-nums"
                      key={col.id}
                    >
                      {t("library.colSumStat", { sum: numSum })}
                    </TableCell>
                  );
                }
                return <TableCell key={col.id} />;
              })}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
