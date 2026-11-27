import type { Space, SpaceId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useArchiveSpaceMutation,
  useInkadeClient,
  useInkadeSpaces,
  useInkadeWorkspaceSummary,
} from "@inkade/sdk/react";
import {
  cn,
  GlideHighlight,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  SpaceIcon,
} from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FilePlus2Icon,
  FolderPlusIcon,
  GlobeIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useInkadeViewsContext } from "../context.tsx";

export interface SpaceTreeItem {
  readonly space: Space;
  readonly children: readonly SpaceTreeItem[];
}

export function buildSpaceHierarchy(spaces: readonly Space[]): SpaceTreeItem[] {
  const active = spaces.filter((s) => s.archivedAt === null);
  const activeIds = new Set(active.map((s) => s.id));
  const byParent = new Map<string | null, Space[]>();

  for (const space of active) {
    const parentKey = space.parentId && activeIds.has(space.parentId) ? space.parentId : null;
    const list = byParent.get(parentKey);
    if (list) list.push(space);
    else byParent.set(parentKey, [space]);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  const visited = new Set<string>();
  function build(parentId: string | null): SpaceTreeItem[] {
    const list = byParent.get(parentId) ?? [];
    const items: SpaceTreeItem[] = [];
    for (const s of list) {
      if (visited.has(s.id)) continue;
      visited.add(s.id);
      items.push({ space: s, children: build(s.id) });
    }
    return items;
  }

  return build(null);
}

export interface SpaceTreeViewProps {
  readonly spaces?: readonly Space[] | undefined;
  readonly activeSpaceId?: string | null | undefined;
  readonly spaceDocCountMap?: ReadonlyMap<string, number> | undefined;
  readonly excludeSystemSlugs?: boolean | undefined;
  readonly onSelectSpace?: ((space: Space) => void) | undefined;
  readonly onQuickCreateDoc?: ((space: Space) => void) | undefined;
  readonly onPublishGarden?: ((space: Space) => void) | undefined;
  readonly onOpenSpaceDialog?: ((options: {
    readonly editingSpace?: Space | null | undefined;
    readonly defaultParentId?: SpaceId | null | undefined;
  }) => void) | undefined;
  readonly readonly?: boolean | undefined;
  readonly className?: string | undefined;
}

export function SpaceTreeView({
  spaces: spacesProp,
  activeSpaceId = null,
  spaceDocCountMap: docCountMapProp,
  excludeSystemSlugs = true,
  onSelectSpace,
  onQuickCreateDoc,
  onPublishGarden,
  onOpenSpaceDialog,
  readonly: readonlyProp,
  className,
}: SpaceTreeViewProps = {}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const { navigation, hostActions, notifier, environment } = useInkadeViewsContext();
  const isReadOnly = readonlyProp ?? environment.readonly ?? false;
  const queryClient = useQueryClient();

  const [expandedSpaceIds, setExpandedSpaceIds] = useState<Set<string>>(() => new Set());
  const [dragSpaceState, setDragSpaceState] = useState<{
    readonly spaceId: string;
    readonly parentId: string | null;
  } | null>(null);
  const [dropTargetSpace, setDropTargetSpace] = useState<{
    readonly spaceId: string;
    readonly position: "before" | "after";
  } | null>(null);

  const spacesQuery = useInkadeSpaces({
    enabled: spacesProp === undefined,
  });

  const summaryQuery = useInkadeWorkspaceSummary({
    enabled: docCountMapProp === undefined,
  });

  const spaces = useMemo(
    () => spacesProp ?? spacesQuery.data ?? [],
    [spacesProp, spacesQuery.data],
  );

  const spaceDocCountMap = useMemo(() => {
    if (docCountMapProp) return docCountMapProp;
    const map = new Map<string, number>();
    if (summaryQuery.data?.spaces) {
      for (const entry of summaryQuery.data.spaces) {
        map.set(entry.spaceId, entry.activeCount);
      }
    }
    return map;
  }, [docCountMapProp, summaryQuery.data]);

  const spaceTree = useMemo(
    () =>
      buildSpaceHierarchy(
        excludeSystemSlugs
          ? spaces.filter((s) => s.slug !== "daily" && s.slug !== "inbox")
          : spaces,
      ),
    [excludeSystemSlugs, spaces],
  );

  const archiveSpaceMutation = useArchiveSpaceMutation({
    onSuccess: (archived) => {
      notifier.success(t("nav.spaceArchived"), archived.name);
    },
    onError: (err) => notifier.error(t("nav.spaceArchiveFailed"), err),
  });

  const reorderSpacesMutation = useMutation({
    mutationFn: async (updates: ReadonlyArray<{ readonly id: SpaceId; readonly sortOrder: number }>) => {
      await Promise.all(updates.map((u) => client.spaces.update(u.id, { sortOrder: u.sortOrder })));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "spaces"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      notifier.success(t("nav.spaceReordered"));
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "spaces"] });
      notifier.error(t("nav.spaceReorderFailed"), err);
    },
  });

  const toggleSpaceExpand = (spaceId: string): void => {
    setExpandedSpaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      return next;
    });
  };

  const handleDropSiblingSpace = (
    siblings: readonly SpaceTreeItem[],
    draggedId: string,
    targetId: string,
    position: "before" | "after",
  ): void => {
    if (isReadOnly || draggedId === targetId) return;
    const siblingSpaces = siblings.map((item) => item.space);
    const draggedIndex = siblingSpaces.findIndex((s) => s.id === draggedId);
    const targetIndex = siblingSpaces.findIndex((s) => s.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const reordered = [...siblingSpaces];
    const [moved] = reordered.splice(draggedIndex, 1);
    if (!moved) return;
    const insertBase = reordered.findIndex((s) => s.id === targetId);
    if (insertBase === -1) return;
    reordered.splice(position === "before" ? insertBase : insertBase + 1, 0, moved);

    const updates = reordered
      .map((s, idx) => ({ id: s.id, sortOrder: idx * 10, prevOrder: s.sortOrder }))
      .filter((entry) => entry.sortOrder !== entry.prevOrder)
      .map(({ id, sortOrder }) => ({ id, sortOrder }));
    if (updates.length === 0) return;

    const orderMap = new Map(reordered.map((s, idx) => [s.id, idx * 10]));
    queryClient.setQueryData<readonly Space[]>(inkadeQueryKeys.spaces(false), (prev) =>
      prev
        ? prev.map((s) => (orderMap.has(s.id) ? { ...s, sortOrder: orderMap.get(s.id)! } : s))
        : prev,
    );
    reorderSpacesMutation.mutate(updates);
  };

  const triggerCreateDoc = (space: Space): void => {
    if (isReadOnly) return;
    if (onQuickCreateDoc) {
      onQuickCreateDoc(space);
      return;
    }
    hostActions.openNewDocument?.({
      spaceId: space.id,
      kind: space.defaultKind ?? "article",
    });
  };

  const triggerSpaceDialog = (options: {
    readonly editingSpace?: Space | null | undefined;
    readonly defaultParentId?: SpaceId | null | undefined;
  }): void => {
    if (isReadOnly) return;
    if (onOpenSpaceDialog) {
      onOpenSpaceDialog(options);
      return;
    }
    if (options.editingSpace) {
      hostActions.openEditSpace?.(options.editingSpace.id);
    } else {
      hostActions.openCreateSpace?.({ defaultParentId: options.defaultParentId ?? null });
    }
  };

  const renderSpaceTree = (items: readonly SpaceTreeItem[], depth = 0): React.ReactNode =>
    items.map((item) => {
      const hasChildren = item.children.length > 0;
      const isExpanded = expandedSpaceIds.has(item.space.id);
      const active = activeSpaceId === item.space.id;
      const docCount = spaceDocCountMap.get(item.space.id) ?? 0;
      const isDragging = dragSpaceState?.spaceId === item.space.id;
      const isDropBefore =
        dropTargetSpace?.spaceId === item.space.id && dropTargetSpace.position === "before";
      const isDropAfter =
        dropTargetSpace?.spaceId === item.space.id && dropTargetSpace.position === "after";

      return (
        <div key={item.space.id}>
          <div
            className={cn(
              "group relative z-10 flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors duration-[var(--duration-micro)]",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/70 in-data-[glide-visible=true]:hover:bg-transparent hover:text-sidebar-accent-foreground",
              isDragging && "opacity-45",
            )}
            data-glide-item
            draggable={!isReadOnly}
            onDragEnd={() => {
              setDragSpaceState(null);
              setDropTargetSpace(null);
            }}
            onDragLeave={() => {
              if (dropTargetSpace?.spaceId === item.space.id) setDropTargetSpace(null);
            }}
            onDragOver={(event) => {
              if (
                isReadOnly ||
                !dragSpaceState ||
                dragSpaceState.parentId !== item.space.parentId ||
                dragSpaceState.spaceId === item.space.id
              ) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              const position = event.clientY - rect.top < rect.height / 2 ? "before" : "after";
              setDropTargetSpace({ spaceId: item.space.id, position });
            }}
            onDragStart={(event) => {
              if (isReadOnly) return;
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", item.space.id);
              setDragSpaceState({ spaceId: item.space.id, parentId: item.space.parentId });
            }}
            onDrop={(event) => {
              if (
                isReadOnly ||
                !dragSpaceState ||
                dragSpaceState.parentId !== item.space.parentId ||
                dragSpaceState.spaceId === item.space.id
              ) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              const pos =
                dropTargetSpace?.spaceId === item.space.id ? dropTargetSpace.position : "after";
              handleDropSiblingSpace(items, dragSpaceState.spaceId, item.space.id, pos);
              setDragSpaceState(null);
              setDropTargetSpace(null);
            }}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            {isDropBefore ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-[2px] z-20 h-0.5 rounded-full bg-primary"
                data-slot="drop-indicator"
                style={{ left: `${depth * 14 + 8}px`, right: "8px" }}
              />
            ) : null}
            {isDropAfter ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-[2px] z-20 h-0.5 rounded-full bg-primary"
                data-slot="drop-indicator"
                style={{ left: `${depth * 14 + 8}px`, right: "8px" }}
              />
            ) : null}
            {hasChildren ? (
              <button
                aria-label={isExpanded ? t("nav.collapseSubspaces") : t("nav.expandSubspaces")}
                className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-muted"
                onClick={() => toggleSpaceExpand(item.space.id)}
                type="button"
              >
                {isExpanded ? (
                  <ChevronDownIcon className="size-3.5" />
                ) : (
                  <ChevronRightIcon className="size-3.5" />
                )}
              </button>
            ) : isReadOnly ? (
              <span aria-hidden="true" className="inline-flex w-4 shrink-0" />
            ) : (
              <span
                aria-label={t("nav.dragSpaceReorderAria", { name: item.space.name })}
                className="inline-flex w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70 active:cursor-grabbing"
              >
                <GripVerticalIcon className="size-3" />
              </span>
            )}

            <button
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-0.5 text-left"
              onClick={() => {
                onSelectSpace?.(item.space);
                navigation.openSpace(item.space.id);
              }}
              type="button"
            >
              <SpaceIcon color={item.space.color} icon={item.space.icon} size="xs" tone="mono" />
              <span className="truncate">{item.space.name}</span>
            </button>

            <div className="flex shrink-0 items-center gap-0.5">
              {docCount > 0 ? (
                <span className="px-0.5 font-mono text-[11px] tabular-nums text-muted-foreground/75 group-hover:hidden group-focus-within:hidden group-has-data-popup-open:hidden">
                  {docCount}
                </span>
              ) : null}

              {!isReadOnly ? (
                <>
                  <button
                    aria-label={t("nav.quickCreateInSpace", { name: item.space.name })}
                    className="hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 group-hover:inline-flex group-focus-within:inline-flex group-has-data-popup-open:inline-flex"
                    onClick={() => triggerCreateDoc(item.space)}
                    title={t("nav.quickCreateInSpace", { name: item.space.name })}
                    type="button"
                  >
                    <PlusIcon className="size-3.5" />
                  </button>

                  <Menu>
                    <MenuTrigger
                      render={
                        <button
                          aria-label={t("nav.spaceActions")}
                          className="hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:inline-flex group-hover:inline-flex group-focus-within:inline-flex"
                          type="button"
                        />
                      }
                    >
                      <MoreHorizontalIcon className="size-3.5" />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      <MenuItem onClick={() => triggerSpaceDialog({ editingSpace: item.space })}>
                        <PencilIcon />
                        {t("nav.renameOrEdit")}
                      </MenuItem>
                      <MenuItem onClick={() => triggerSpaceDialog({ defaultParentId: item.space.id })}>
                        <FolderPlusIcon />
                        {t("nav.createSubspace")}
                      </MenuItem>
                      <MenuItem onClick={() => triggerCreateDoc(item.space)}>
                        <FilePlus2Icon />
                        {t("nav.newDocHere")}
                      </MenuItem>
                      {onPublishGarden ? (
                        <MenuItem onClick={() => onPublishGarden(item.space)}>
                          <GlobeIcon />
                          {t("garden.publishAction")}
                        </MenuItem>
                      ) : null}
                      <MenuSeparator />
                      <MenuItem
                        onClick={() => archiveSpaceMutation.mutate(item.space.id)}
                        variant="destructive"
                      >
                        <ArchiveIcon />
                        {t("nav.archiveSpace")}
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                </>
              ) : null}
            </div>
          </div>
          {hasChildren && isExpanded ? renderSpaceTree(item.children, depth + 1) : null}
        </div>
      );
    });

  return (
    <GlideHighlight
      className={cn("flex flex-col gap-0.5", className)}
      highlightClassName="rounded-md bg-sidebar-accent/75"
      mode="pointer"
    >
      {renderSpaceTree(spaceTree)}
    </GlideHighlight>
  );
}
