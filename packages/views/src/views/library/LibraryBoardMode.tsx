import {
  type DocumentId,
  type DocumentSummary,
  formatPropertyScalar,
  type PropertyFieldDefinition,
  type PropertyOptionColor,
  type Space,
  TASK_PRIORITIES,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import { useInkadeClient } from "@inkade/sdk/react";
import {
  Badge,
  bindPragmaticDraggable,
  bindPragmaticDropTarget,
  Button,
  cn,
  DocumentKindIcon,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  getPropertyOptionColorStyle,
  PropertyOptionPill,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  SpaceIcon,
  TagList,
  TASK_PRIORITY_STYLES,
} from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlusIcon, KanbanSquareIcon, PinIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInkadeViewsContext } from "../../context.tsx";
import { getDocumentExcerpt } from "../../lib/typed-properties.ts";
import { DOC_PRIORITY_BADGE_LABELS, extractDocPriority } from "./types.ts";
import type { LibraryWorkspaceState } from "./useLibraryWorkspace.ts";

interface BoardColumnSpec {
  readonly value: string;
  readonly label: string;
  readonly color?: PropertyOptionColor | undefined;
}

function DraggableBoardCard({
  doc,
  groupFieldKey,
  fromBucket,
  readOnly,
  cardSchemaFields,
  spaceColor,
  spaceIcon,
  spaceName,
  onOpen,
}: {
  readonly doc: DocumentSummary;
  readonly groupFieldKey: string;
  readonly fromBucket: string;
  readonly readOnly: boolean;
  readonly cardSchemaFields: readonly PropertyFieldDefinition[];
  readonly spaceColor?: string | null | undefined;
  readonly spaceIcon?: string | null | undefined;
  readonly spaceName?: string | undefined;
  readonly onOpen: (doc: DocumentSummary, event: React.MouseEvent<HTMLElement>) => void;
}): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const docPriority = extractDocPriority(doc);
  const priorityStyle = TASK_PRIORITY_STYLES[docPriority];

  useEffect(() => {
    const el = cardRef.current;
    if (!el || readOnly) return;
    return bindPragmaticDraggable({
      element: el,
      getInitialData: () => ({
        type: "library-board-card",
        docId: doc.id,
        fromBucket,
      }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [doc.id, fromBucket, readOnly]);

  return (
    <div
      className={cn(
        "group flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border/80 bg-background p-2.5 shadow-xs transition-[border-color,opacity,transform] duration-[var(--duration-quick)] hover:border-primary/45",
        dragging && "opacity-45",
      )}
      data-testid={`board-card-${doc.id}`}
      onClick={(e) => onOpen(doc, e)}
      ref={cardRef}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <DocumentKindIcon kind={doc.kind} size="xs" />
          <span className="line-clamp-2 text-xs font-semibold text-foreground">{doc.title}</span>
        </div>
        {doc.pinned && <PinIcon className="size-3 shrink-0 text-amber-500 dark:text-amber-400" />}
      </div>

      {(() => {
        const cleanExcerpt = getDocumentExcerpt(doc, 140);
        return cleanExcerpt ? (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            {cleanExcerpt}
          </p>
        ) : null;
      })()}

      {(() => {
        const hasSchemaPriority =
          cardSchemaFields.some((f) => f.key === "priority") &&
          doc.properties?.priority !== undefined &&
          doc.properties?.priority !== null &&
          doc.properties?.priority !== "";
        return (
          <div className="flex flex-wrap items-center gap-1">
            {groupFieldKey !== "priority" && docPriority !== "none" && !hasSchemaPriority && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                  priorityStyle.pillClass,
                )}
              >
                <span className={cn("size-1.5 rounded-full", priorityStyle.dotClass)} />
                {DOC_PRIORITY_BADGE_LABELS[docPriority]}
              </span>
            )}
            {cardSchemaFields
              .filter((f) => f.key !== groupFieldKey)
              .slice(0, 2)
              .map((field) => {
                const val = doc.properties?.[field.key];
                if (val === undefined || val === null || val === "") return null;
                if (field.type === "select" && typeof val === "string") {
                  const opt = field.options.find((o) => o.value === val);
                  return (
                    <PropertyOptionPill
                      color={opt?.color}
                      key={field.key}
                      label={opt?.label ?? val}
                    />
                  );
                }
                return (
                  <Badge key={field.key} size="sm" variant="outline">
                    {`${field.label}: ${formatPropertyScalar(val)}`}
                  </Badge>
                );
              })}
            {spaceName && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <SpaceIcon color={spaceColor ?? undefined} icon={spaceIcon ?? undefined} size="xs" />
                <span className="max-w-24 truncate">{spaceName}</span>
              </span>
            )}
          </div>
        );
      })()}

      {doc.tags.length > 0 && (
        <TagList maxFallbackVisible={2} size="sm" tags={doc.tags} />
      )}
    </div>
  );
}

function BoardColumnLane({
  column,
  docs,
  groupFieldKey,
  readOnly,
  cardSchemaFields,
  spaceById,
  onMoveDoc,
  onOpenDoc,
}: {
  readonly column: BoardColumnSpec;
  readonly docs: readonly DocumentSummary[];
  readonly groupFieldKey: string;
  readonly readOnly: boolean;
  readonly cardSchemaFields: readonly PropertyFieldDefinition[];
  readonly spaceById: ReadonlyMap<DocumentSummary["spaceId"], Pick<Space, "name" | "color" | "icon">>;
  readonly onMoveDoc: (docId: DocumentId, targetBucket: string, targetLabel: string) => void;
  readonly onOpenDoc: (doc: DocumentSummary, event: React.MouseEvent<HTMLElement>) => void;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const colRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const el = colRef.current;
    if (!el || readOnly) return;
    return bindPragmaticDropTarget({
      element: el,
      canDrop: ({ sourceData }) =>
        sourceData.type === "library-board-card" && sourceData.fromBucket !== column.value,
      onDragEnter: () => setDragOver(true),
      onDragLeave: () => setDragOver(false),
      onDrop: ({ sourceData }) => {
        setDragOver(false);
        const docId = typeof sourceData.docId === "string" ? (sourceData.docId as DocumentId) : null;
        if (docId) {
          onMoveDoc(docId, column.value, column.label);
        }
      },
    });
  }, [column.label, column.value, onMoveDoc, readOnly]);

  const colorStyle = column.color ? getPropertyOptionColorStyle(column.color) : null;

  return (
    <div
      className={cn(
        "flex min-h-[220px] w-[82vw] max-w-[300px] shrink-0 snap-center flex-col gap-2 rounded-xl border p-2.5 transition-colors sm:w-72",
        dragOver
          ? "border-primary bg-brand-subtle/25"
          : colorStyle
            ? colorStyle.laneTintClass
            : "border-border/80 bg-muted/30",
      )}
      data-testid={`board-column-${column.value}`}
      ref={colRef}
    >
      <div className="flex items-center justify-between gap-2 px-0.5">
        {column.color ? (
          <PropertyOptionPill color={column.color} label={column.label} />
        ) : (
          <span className="truncate text-xs font-semibold text-foreground">{column.label}</span>
        )}
        <Badge size="sm" variant="secondary">
          {t("board.columnCount", { count: docs.length })}
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        {docs.map((doc) => {
          const sp = spaceById.get(doc.spaceId);
          return (
            <DraggableBoardCard
              cardSchemaFields={cardSchemaFields}
              doc={doc}
              fromBucket={column.value}
              groupFieldKey={groupFieldKey}
              key={doc.id}
              onOpen={onOpenDoc}
              readOnly={readOnly}
              spaceColor={sp?.color}
              spaceIcon={sp?.icon}
              spaceName={sp?.name}
            />
          );
        })}
      </div>
    </div>
  );
}

export function LibraryBoardMode({
  state,
}: {
  readonly state: LibraryWorkspaceState;
}): React.ReactElement {
  const client = useInkadeClient();
  const { notifier } = useInkadeViewsContext();
  const queryClient = useQueryClient();
  const {
    t,
    isReadOnly,
    filteredDocs,
    activeSchemaFields,
    allSchemaFields,
    boardGroupByField,
    setBoardGroupByField,
    spaceById,
    activeSpace,
    currentViewFilterSnapshot,
    quickUpdatePropertiesMutation,
    handleOpenStudioDoc,
  } = state;

  const selectFields = useMemo(
    () =>
      (activeSchemaFields.length > 0 ? activeSchemaFields : allSchemaFields).filter(
        (f) => f.type === "select",
      ),
    [activeSchemaFields, allSchemaFields],
  );

  const effectiveGroupField = useMemo(() => {
    if (boardGroupByField && (boardGroupByField === "priority" || selectFields.some((f) => f.key === boardGroupByField))) {
      return boardGroupByField;
    }
    return selectFields[0]?.key ?? "priority";
  }, [boardGroupByField, selectFields]);

  const activeFieldDef = useMemo(
    () => selectFields.find((f) => f.key === effectiveGroupField) ?? null,
    [effectiveGroupField, selectFields],
  );

  const columns = useMemo<readonly BoardColumnSpec[]>(() => {
    if (effectiveGroupField === "priority") {
      return TASK_PRIORITIES.map((p) => ({
        value: p,
        label: p === "none" ? t("library.priorityNone") : DOC_PRIORITY_BADGE_LABELS[p],
      }));
    }
    const baseOpts: BoardColumnSpec[] = (activeFieldDef?.options ?? []).map((opt) => ({
      value: opt.value,
      label: opt.label,
      color: opt.color,
    }));
    const known = new Set(baseOpts.map((c) => c.value));
    for (const doc of filteredDocs) {
      const raw = doc.properties?.[effectiveGroupField];
      if (typeof raw === "string" && raw.trim() && !known.has(raw)) {
        known.add(raw);
        baseOpts.push({ value: raw, label: raw });
      }
    }
    baseOpts.push({ value: "__unassigned__", label: t("board.unassignedColumn") });
    return baseOpts;
  }, [activeFieldDef, effectiveGroupField, filteredDocs, t]);

  const docsByColumn = useMemo(() => {
    const map = new Map<string, DocumentSummary[]>();
    for (const col of columns) {
      map.set(col.value, []);
    }
    for (const doc of filteredDocs) {
      if (effectiveGroupField === "priority") {
        const p = extractDocPriority(doc);
        map.get(p)?.push(doc);
      } else {
        const raw = doc.properties?.[effectiveGroupField];
        const bucket =
          typeof raw === "string" && raw.trim() && map.has(raw) ? raw : "__unassigned__";
        map.get(bucket)?.push(doc);
      }
    }
    return map;
  }, [columns, effectiveGroupField, filteredDocs]);

  const saveBoardAsViewMutation = useMutation({
    mutationFn: () => {
      const groupLabel = activeFieldDef?.label ?? t("library.groupByPriority");
      return client.savedViews.create({
        name: t("board.saveAsViewName", { field: groupLabel }),
        icon: "KanbanSquare",
        displayMode: "board",
        groupByField: effectiveGroupField,
        filter: {
          ...currentViewFilterSnapshot,
          ...(activeSpace ? { spaceId: activeSpace.id } : {}),
          viewMode: "board",
        },
      });
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.savedViews() });
      notifier.success(t("nav.savedViewCreated"), created.name);
    },
    onError: (err) => notifier.error(t("nav.savedViewCreateFailed"), err),
  });

  const handleMoveDoc = (docId: DocumentId, targetBucket: string, targetLabel: string): void => {
    const doc = filteredDocs.find((d) => d.id === docId);
    if (!doc) return;
    const nextProps: Record<string, unknown> = { ...(doc.properties ?? {}) };
    if (effectiveGroupField === "priority") {
      if (targetBucket === "none") {
        delete nextProps["priority"];
      } else {
        nextProps["priority"] = targetBucket;
      }
    } else if (targetBucket === "__unassigned__") {
      delete nextProps[effectiveGroupField];
    } else {
      nextProps[effectiveGroupField] = targetBucket;
    }

    quickUpdatePropertiesMutation.mutate(
      {
        docId,
        properties: Object.keys(nextProps).length > 0 ? nextProps : null,
      },
      {
        onSuccess: () => {
          notifier.success(
            t("board.movedCardToast", { title: doc.title, column: targetLabel }),
          );
        },
      },
    );
  };

  const cardSchemaFields = useMemo(
    () => (activeSchemaFields.length > 0 ? activeSchemaFields : allSchemaFields).filter((f) => f.showInCard),
    [activeSchemaFields, allSchemaFields],
  );

  if (filteredDocs.length === 0) {
    return (
      <Empty className="border-border/70">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KanbanSquareIcon />
          </EmptyMedia>
          <EmptyTitle>{t("library.emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("library.emptyDesc")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="library-board-mode">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-muted/25 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("board.groupByFieldLabel")}
          </span>
          <Select<string>
            onValueChange={(val) => {
              if (val) setBoardGroupByField(val);
            }}
            value={effectiveGroupField}
          >
            <SelectTrigger className="w-44" size="sm">
              <SelectValue>
                {effectiveGroupField === "priority"
                  ? t("library.groupByPriority")
                  : (activeFieldDef?.label ?? effectiveGroupField)}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="priority">{t("library.groupByPriority")}</SelectItem>
              {selectFields.map((field) => (
                <SelectItem key={field.key} value={field.key}>
                  {field.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>

          {selectFields.length === 0 && (
            <span className="text-[11px] text-muted-foreground">
              {activeSpace ? t("board.noSelectFieldDesc") : t("board.noSelectFieldNoSpaceDesc")}
            </span>
          )}
        </div>

        {!isReadOnly && (
          <Button
            loading={saveBoardAsViewMutation.isPending}
            onClick={() => saveBoardAsViewMutation.mutate()}
            size="xs"
            type="button"
            variant="outline"
          >
            <BookmarkPlusIcon className="size-3.5" />
            <span>{t("board.saveAsViewButton")}</span>
          </Button>
        )}
      </div>

      <div className="flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-2 sm:snap-none">
        {columns.map((column) => (
          <BoardColumnLane
            cardSchemaFields={cardSchemaFields}
            column={column}
            docs={docsByColumn.get(column.value) ?? []}
            groupFieldKey={effectiveGroupField}
            key={column.value}
            onMoveDoc={handleMoveDoc}
            onOpenDoc={handleOpenStudioDoc}
            readOnly={isReadOnly}
            spaceById={spaceById}
          />
        ))}
      </div>
    </div>
  );
}
