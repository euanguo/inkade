"use client";

import {
  asSpaceId,
  asWorkspaceId,
  evaluateViewQueryOnDocuments,
  formatPropertyScalar,
  parseInkadeViewBlock,
  type DocumentId,
  type DocumentSummary,
  type InkadeViewDisplayMode,
  type PropertyFieldDefinition,
  type Space,
  type ViewQueryDocumentItem,
  type ViewQueryRequestInput,
  type ViewQueryResponse,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  AlertTriangleIcon,
  ArrowUpDownIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  KanbanSquareIcon,
  LayoutGridIcon,
  TableIcon,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorWorkspaceDocSummary } from "../editor/context.tsx";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { SegmentedControl, SegmentedControlItem } from "../primitives/segmented-control.tsx";
import { SpaceIcon } from "../primitives/space-icon.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "../primitives/table.tsx";
import { DocumentKindIcon, TagPill } from "../primitives/tag-pill.tsx";
import { PropertyOptionPill } from "./property-option-badge.tsx";

export interface InkadeViewBlockProps {
  readonly rawYaml: string;
  readonly workspaceDocs?: readonly EditorWorkspaceDocSummary[] | undefined;
  readonly spaces?: readonly Pick<Space, "id" | "name" | "color" | "icon">[] | undefined;
  readonly onQueryInkadeView?: ((spec: ViewQueryRequestInput) => Promise<ViewQueryResponse>) | undefined;
  readonly embeddedSnapshot?: ViewQueryResponse | undefined;
  readonly onOpenDocument?: ((docId: DocumentId, publicShareToken?: string | null) => void) | undefined;
  readonly onOpenWikilink?: ((target: string, event?: React.MouseEvent) => void) | undefined;
  readonly className?: string | undefined;
  readonly headerExtra?: React.ReactNode;
}

function toFallbackDocumentSummaries(
  workspaceDocs: readonly EditorWorkspaceDocSummary[],
): readonly DocumentSummary[] {
  return workspaceDocs.map((doc) => {
    const base = {
      id: doc.id,
      workspaceId: asWorkspaceId("local"),
      spaceId: asSpaceId(doc.spaceId ?? "spc_default"),
      title: doc.title,
      slug: doc.slug,
      dailyDate: null,
      excerpt: doc.excerpt,
      tags: doc.tags ?? [],
      properties: {},
      version: 1,
      pinned: false,
      unreadAgentUpdate: false,
      lastEditedByType: "human" as const,
      trashedAt: null,
      createdAt: "",
      updatedAt: "",
    };
    if (doc.kind === "clip") {
      return { ...base, kind: "clip" as const };
    }
    if (doc.kind === "outline") {
      return { ...base, kind: "outline" as const };
    }
    return { ...base, kind: "article" as const };
  });
}

function renderDynamicCellValue(
  doc: ViewQueryDocumentItem,
  colKey: string,
  fieldDef: PropertyFieldDefinition | undefined,
  t: ReturnType<typeof useInkadeTranslation>["t"],
): React.ReactNode {
  if (colKey === "kind") {
    const kindLabel =
      doc.kind === "outline"
        ? t("common.kindOutline")
        : doc.kind === "clip"
          ? t("common.kindClip")
          : t("common.kindArticle");
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
        <DocumentKindIcon kind={doc.kind} size="xs" />
        <span>{kindLabel}</span>
      </span>
    );
  }
  if (colKey === "tags") {
    return doc.tags.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {doc.tags.slice(0, 3).map((tag) => (
          <TagPill key={tag} size="sm" tag={tag} />
        ))}
      </div>
    ) : (
      <span className="text-muted-foreground/50">-</span>
    );
  }
  if (colKey === "updatedAt" || colKey === "createdAt") {
    const rawDate = colKey === "updatedAt" ? doc.updatedAt : doc.createdAt;
    return (
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {rawDate ? rawDate.slice(0, 10) : "-"}
      </span>
    );
  }

  const raw = doc.properties?.[colKey];
  if (raw === null || raw === undefined || raw === "") {
    return <span className="text-muted-foreground/50">-</span>;
  }

  if (fieldDef?.type === "select" && typeof raw === "string") {
    const opt = fieldDef.options.find((o) => o.value === raw);
    return <PropertyOptionPill color={opt?.color} label={opt?.label ?? raw} />;
  }
  if (fieldDef?.type === "multi_select" && Array.isArray(raw)) {
    return (
      <div className="flex flex-wrap gap-1">
        {raw.slice(0, 3).map((item) => {
          const val = String(item);
          const opt = fieldDef.options.find((o) => o.value === val);
          return <PropertyOptionPill color={opt?.color} key={val} label={opt?.label ?? val} />;
        })}
      </div>
    );
  }
  if (fieldDef?.type === "checkbox" || typeof raw === "boolean") {
    return (
      <Badge size="sm" variant={raw ? "success" : "secondary"}>
        {raw ? t("schema.checkboxEnabled") : t("schema.checkboxDisabled")}
      </Badge>
    );
  }
  if (fieldDef?.type === "number" && typeof raw === "number") {
    const unit = fieldDef.numberUnit ? ` ${fieldDef.numberUnit}` : "";
    return (
      <span className="font-mono text-xs tabular-nums">
        {fieldDef.numberFormat === "percent" ? `${raw}%` : `${raw}${unit}`}
      </span>
    );
  }
  if (fieldDef?.type === "url" && typeof raw === "string") {
    return (
      <a
        className="inline-flex max-w-[180px] items-center gap-1 truncate text-xs text-primary hover:underline"
        href={raw}
        onClick={(e) => e.stopPropagation()}
        rel="noreferrer noopener"
        target="_blank"
      >
        <span className="truncate">{raw}</span>
        <ExternalLinkIcon className="size-3 shrink-0" />
      </a>
    );
  }
  if (Array.isArray(raw)) {
    return <span className="text-xs text-foreground">{raw.map(formatPropertyScalar).join(", ")}</span>;
  }
  return <span className="text-xs text-foreground">{formatPropertyScalar(raw)}</span>;
}

export function InkadeViewBlock({
  rawYaml,
  workspaceDocs = [],
  spaces = [],
  onQueryInkadeView,
  embeddedSnapshot,
  onOpenDocument,
  onOpenWikilink,
  className,
  headerExtra,
}: InkadeViewBlockProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const parsed = useMemo(() => parseInkadeViewBlock(rawYaml), [rawYaml]);

  const [displayMode, setDisplayMode] = useState<InkadeViewDisplayMode>(
    parsed.ok ? parsed.spec.mode : "table",
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const [serverResponse, setServerResponse] = useState<ViewQueryResponse | null>(
    embeddedSnapshot ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const onQueryRef = useRef(onQueryInkadeView);
  onQueryRef.current = onQueryInkadeView;
  const tRef = useRef(t);
  tRef.current = t;
  const hasQueryFn = Boolean(onQueryInkadeView);

  useEffect(() => {
    if (parsed.ok) {
      setDisplayMode(parsed.spec.mode);
    }
  }, [parsed]);

  useEffect(() => {
    if (embeddedSnapshot) {
      setServerResponse(embeddedSnapshot);
      setQueryError(null);
      return;
    }
    const queryFn = onQueryRef.current;
    if (!parsed.ok || !queryFn) return;
    let cancelled = false;
    setLoading(true);
    setQueryError(null);
    void queryFn(parsed.spec)
      .then((res) => {
        if (!cancelled) {
          setServerResponse(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setQueryError(err instanceof Error ? err.message : tRef.current("inkadeView.error"));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [embeddedSnapshot, hasQueryFn, parsed]);

  const effectiveResponse = useMemo<ViewQueryResponse>(() => {
    if (embeddedSnapshot) return embeddedSnapshot;
    if (serverResponse) return serverResponse;
    if (!parsed.ok) {
      return {
        documents: [],
        totalCount: 0,
        limit: 24,
        offset: 0,
        schemaFields: [],
        numericAggregates: [],
      };
    }
    return evaluateViewQueryOnDocuments(toFallbackDocumentSummaries(workspaceDocs), [], parsed.spec);
  }, [embeddedSnapshot, parsed, serverResponse, workspaceDocs]);

  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const schemaByKey = useMemo(
    () => new Map(effectiveResponse.schemaFields.map((f) => [f.key, f])),
    [effectiveResponse.schemaFields],
  );

  const handleOpenDocItem = useCallback(
    (doc: ViewQueryDocumentItem, event: React.MouseEvent): void => {
      if (onOpenDocument) {
        onOpenDocument(doc.id, doc.publicShareToken ?? null);
        return;
      }
      onOpenWikilink?.(doc.slug || doc.title, event);
    },
    [onOpenDocument, onOpenWikilink],
  );

  const columnKeys = useMemo(() => {
    if (parsed.ok && parsed.spec.columns && parsed.spec.columns.length > 0) {
      return parsed.spec.columns;
    }
    const schemaCols = effectiveResponse.schemaFields
      .filter((f) => f.showInTable)
      .map((f) => f.key)
      .slice(0, 3);
    return schemaCols.length > 0
      ? ["title", "kind", ...schemaCols]
      : ["title", "kind", "updatedAt"];
  }, [effectiveResponse.schemaFields, parsed]);

  const tableColumns = useMemo<ColumnDef<ViewQueryDocumentItem>[]>(() => {
    return columnKeys.map((key) => {
      const schemaField = schemaByKey.get(key);
      const headerLabel =
        schemaField?.label ??
        (key === "title"
          ? t("inkadeView.colTitle")
          : key === "kind"
            ? t("inkadeView.colKind")
            : key === "updatedAt"
              ? t("inkadeView.colUpdatedAt")
              : key === "tags"
                ? t("inkadeView.colTags")
                : key);

      return {
        id: key,
        header: headerLabel,
        accessorFn: (row) => {
          if (key === "title") return row.title;
          if (key === "kind") return row.kind;
          if (key === "updatedAt") return row.updatedAt;
          if (key === "createdAt") return row.createdAt;
          if (key === "tags") return row.tags.join(", ");
          const raw = row.properties?.[key];
          return Array.isArray(raw) ? raw.join(", ") : raw ?? "";
        },
        cell: ({ row }) => {
          const item = row.original;
          if (key === "title") {
            return (
              <button
                aria-label={t("inkadeView.openDocAria", { title: item.title })}
                className="flex max-w-[155px] min-w-0 cursor-pointer items-center gap-1.5 text-left font-medium text-foreground hover:text-primary hover:underline sm:max-w-[195px] xl:max-w-[230px]"
                onClick={(e) => handleOpenDocItem(item, e)}
                type="button"
              >
                <DocumentKindIcon kind={item.kind} size="xs" />
                <span className="truncate">{item.title}</span>
              </button>
            );
          }
          return renderDynamicCellValue(item, key, schemaField, t);
        },
      };
    });
  }, [columnKeys, handleOpenDocItem, schemaByKey, t]);

  const table = useReactTable({
    data: [...effectiveResponse.documents],
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const boardGroups = useMemo(() => {
    const groupKey =
      (parsed.ok ? parsed.spec.groupBy : undefined) ??
      effectiveResponse.schemaFields.find((f) => f.type === "select")?.key ??
      "kind";
    const fieldDef = schemaByKey.get(groupKey);
    const orderedKeys: string[] = [];
    const grouped = new Map<string, ViewQueryDocumentItem[]>();

    if (fieldDef?.type === "select") {
      for (const opt of fieldDef.options) {
        orderedKeys.push(opt.value);
        grouped.set(opt.value, []);
      }
    }

    for (const item of effectiveResponse.documents) {
      const rawVal =
        groupKey === "kind"
          ? item.kind
          : groupKey === "spaceId"
            ? (spaceById.get(item.spaceId)?.name ?? item.spaceId)
            : item.properties?.[groupKey];
      const bucketStr = formatPropertyScalar(rawVal);
      const bucket = bucketStr.trim() !== "" ? bucketStr : "__unassigned__";
      if (!grouped.has(bucket)) {
        orderedKeys.push(bucket);
        grouped.set(bucket, []);
      }
      grouped.get(bucket)?.push(item);
    }

    return orderedKeys.map((key) => {
      const opt = fieldDef?.options.find((o) => o.value === key);
      const label =
        key === "__unassigned__" ? t("board.unassignedColumn") : (opt?.label ?? key);
      return {
        key,
        label,
        color: opt?.color,
        docs: grouped.get(key) ?? [],
      };
    });
  }, [effectiveResponse.documents, effectiveResponse.schemaFields, parsed, schemaByKey, spaceById, t]);

  if (!parsed.ok) {
    return (
      <div
        className={cn(
          "not-typeset my-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive-foreground",
          className,
        )}
        data-testid="inkade-view-invalid"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangleIcon className="size-3.5 shrink-0" />
            <span>{t("editor.inkadeViewInvalidYaml")}</span>
          </div>
          {headerExtra}
        </div>
        <p className="mt-1 font-mono text-[11px] opacity-85">{parsed.error}</p>
      </div>
    );
  }

  const cardFields = effectiveResponse.schemaFields.filter((f) => f.showInCard).slice(0, 3);

  return (
    <div
      className={cn(
        "not-typeset my-3 overflow-hidden rounded-xl border border-border bg-card/90 shadow-[var(--shadow-card)]",
        className,
      )}
      data-testid="inkade-view-block"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/35 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <DatabaseIcon className="size-3.5 shrink-0 text-primary" />
          <span className="text-xs font-semibold text-foreground">{t("editor.inkadeViewTitle")}</span>
          <Badge size="sm" variant="secondary">
            {t("inkadeView.totalMatched", { count: effectiveResponse.totalCount })}
          </Badge>
          {embeddedSnapshot && (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              {t("inkadeView.privateHiddenHint")}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <SegmentedControl size="sm">
            <SegmentedControlItem
              data-pressed={displayMode === "table" ? "" : undefined}
              onClick={() => setDisplayMode("table")}
            >
              <TableIcon className="size-3" />
              <span>{t("inkadeView.modeTable")}</span>
            </SegmentedControlItem>
            <SegmentedControlItem
              data-pressed={displayMode === "cards" ? "" : undefined}
              onClick={() => setDisplayMode("cards")}
            >
              <LayoutGridIcon className="size-3" />
              <span>{t("inkadeView.modeCards")}</span>
            </SegmentedControlItem>
            <SegmentedControlItem
              data-pressed={displayMode === "board" ? "" : undefined}
              onClick={() => setDisplayMode("board")}
            >
              <KanbanSquareIcon className="size-3" />
              <span>{t("inkadeView.modeBoard")}</span>
            </SegmentedControlItem>
          </SegmentedControl>
          {headerExtra}
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("inkadeView.loading")}
        </div>
      ) : queryError ? (
        <div className="px-4 py-4 text-xs text-destructive-foreground">{queryError}</div>
      ) : effectiveResponse.documents.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("inkadeView.empty")}
        </div>
      ) : displayMode === "table" ? (
        <Table className="w-full table-auto">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    className={cn(
                      "whitespace-nowrap px-2.5 py-2 text-xs",
                      schemaByKey.get(header.id)?.type === "number" && "text-right",
                    )}
                    key={header.id}
                  >
                    <button
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground",
                        schemaByKey.get(header.id)?.type === "number" && "ml-auto justify-end",
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                      type="button"
                    >
                      <span>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      <ArrowUpDownIcon className="size-3 opacity-75" />
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow className="hover:bg-muted/35" key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    className={cn(
                      "px-2.5 py-2",
                      schemaByKey.get(cell.column.id)?.type === "number" && "text-right",
                    )}
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {effectiveResponse.numericAggregates.some((agg) => columnKeys.includes(agg.field)) && (
            <TableFooter className="border-t border-border/80 bg-muted/30">
              <TableRow>
                {columnKeys.map((colKey) => {
                  const agg = effectiveResponse.numericAggregates.find((a) => a.field === colKey);
                  return (
                    <TableCell
                      className={cn(
                        "border-t border-border/80 px-2.5 py-2 text-[11px] font-medium text-muted-foreground",
                        schemaByKey.get(colKey)?.type === "number" && "text-right",
                      )}
                      key={colKey}
                    >
                      {agg ? (
                        <span className="whitespace-nowrap font-mono tabular-nums">
                          {t("inkadeView.numericAggPrefix", {
                            field: schemaByKey.get(agg.field)?.label ?? agg.field,
                            sum: agg.sum,
                          })}
                        </span>
                      ) : null}
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      ) : displayMode === "cards" ? (
        <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {effectiveResponse.documents.map((item) => {
            const space = spaceById.get(item.spaceId);
            return (
              <button
                className="flex cursor-pointer flex-col items-start gap-1.5 rounded-lg border border-border/80 bg-background/80 p-3 text-left transition-[border-color,background-color] duration-[var(--duration-quick)] hover:border-primary/40 hover:bg-muted/30"
                key={item.id}
                onClick={(e) => handleOpenDocItem(item, e)}
                type="button"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <DocumentKindIcon kind={item.kind} size="xs" />
                    <span className="truncate text-xs font-semibold text-foreground">
                      {item.title}
                    </span>
                  </div>
                  {space && <SpaceIcon color={space.color} icon={space.icon} size="xs" />}
                </div>
                {item.excerpt && (
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {item.excerpt}
                  </p>
                )}
                {cardFields.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {cardFields.map((field) => {
                      const val = item.properties?.[field.key];
                      if (val === undefined || val === null || val === "") return null;
                      return (
                        <React.Fragment key={field.key}>
                          {renderDynamicCellValue(item, field.key, field, t)}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto p-3">
          {boardGroups.map((group) => (
            <div
              className="flex w-64 shrink-0 flex-col gap-2 rounded-lg border border-border/80 bg-muted/30 p-2"
              key={group.key}
            >
              <div className="flex items-center justify-between gap-2 px-1">
                {group.color ? (
                  <PropertyOptionPill color={group.color} label={group.label} />
                ) : (
                  <span className="truncate text-xs font-semibold text-foreground">{group.label}</span>
                )}
                <Badge size="sm" variant="secondary">
                  {group.docs.length}
                </Badge>
              </div>
              <div className="flex flex-col gap-1.5">
                {group.docs.map((item) => (
                  <button
                    className="flex cursor-pointer flex-col items-start gap-1 rounded-md border border-border/70 bg-background p-2 text-left transition-colors hover:border-primary/40"
                    key={item.id}
                    onClick={(e) => handleOpenDocItem(item, e)}
                    type="button"
                  >
                    <div className="flex w-full items-center gap-1.5">
                      <DocumentKindIcon kind={item.kind} size="xs" />
                      <span className="truncate text-xs font-medium text-foreground">
                        {item.title}
                      </span>
                    </div>
                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.tags.slice(0, 2).map((tag) => (
                          <TagPill key={tag} size="sm" tag={tag} />
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {displayMode !== "table" && effectiveResponse.numericAggregates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-muted/25 px-3 py-1.5 text-[11px] text-muted-foreground">
          {effectiveResponse.numericAggregates.map((agg) => (
            <span className="font-mono tabular-nums" key={agg.field}>
              {t("inkadeView.numericAggPrefix", {
                field: schemaByKey.get(agg.field)?.label ?? agg.field,
                sum: agg.sum,
              })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
