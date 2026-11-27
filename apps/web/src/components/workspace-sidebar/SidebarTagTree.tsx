import type { SavedView } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { cn, GlideHighlight, GridDisclosure, SpaceIcon } from "@inkade/ui";
import type { NestedTagTreeNode } from "@inkade/views/lib/super-command-parser";
import { ChevronDownIcon, ChevronRightIcon, GlobeIcon, HashIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type React from "react";

export interface SidebarViewsAndTagsSectionProps {
  readonly savedViews: readonly SavedView[];
  readonly activeSavedViewId: string | null;
  readonly nestedTagTree: readonly NestedTagTreeNode[];
  readonly tagsExpanded: boolean;
  readonly expandedTagPaths: ReadonlySet<string>;
  readonly activeLibraryTag: string | null;
  readonly onToggleTagsExpanded: () => void;
  readonly onToggleTagExpand: (tagPath: string) => void;
  readonly onOpenSavedView: (view: SavedView) => void;
  readonly onOpenSavedViewDialog: () => void;
  readonly onPublishSavedView?: ((view: SavedView) => void) | undefined;
  readonly onDeleteSavedView: (viewId: SavedView["id"]) => void;
  readonly onSelectTag: (tagPath: string) => void;
}

export function SidebarViewsAndTagsSection({
  savedViews,
  activeSavedViewId,
  nestedTagTree,
  tagsExpanded,
  expandedTagPaths,
  activeLibraryTag,
  onToggleTagsExpanded,
  onToggleTagExpand,
  onOpenSavedView,
  onOpenSavedViewDialog,
  onPublishSavedView,
  onDeleteSavedView,
  onSelectTag,
}: SidebarViewsAndTagsSectionProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  const renderTagTree = (nodes: readonly NestedTagTreeNode[], depth = 0): React.ReactNode =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isExpanded = expandedTagPaths.has(node.fullPath);
      const isActive = activeLibraryTag === node.fullPath;
      return (
        <div key={node.fullPath}>
          <div
            className="flex items-center gap-1 py-0.5"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            {hasChildren ? (
              <button
                aria-label={
                  isExpanded
                    ? t("nav.collapseTagAria", { tag: node.segment })
                    : t("nav.expandTagAria", { tag: node.segment })
                }
                className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onToggleTagExpand(node.fullPath)}
                type="button"
              >
                {isExpanded ? (
                  <ChevronDownIcon className="size-3" />
                ) : (
                  <ChevronRightIcon className="size-3" />
                )}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}

            <button
              aria-pressed={isActive}
              className={cn(
                "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-1 ps-1.5 pe-2.5 text-left text-xs transition-colors duration-[var(--duration-micro)]",
                isActive
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
              )}
              onClick={() => onSelectTag(node.fullPath)}
              type="button"
            >
              <HashIcon className="size-3 shrink-0 opacity-60" />
              <span className="truncate">{node.segment}</span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground/70 tabular-nums">
                {node.totalCount}
              </span>
            </button>
          </div>
          {hasChildren && isExpanded ? renderTagTree(node.children, depth + 1) : null}
        </div>
      );
    });

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between px-2.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/85">
            {t("nav.savedViews")}
          </span>
          <button
            aria-label={t("nav.newSavedView")}
            className="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onOpenSavedViewDialog}
            type="button"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
        {savedViews.length > 0 ? (
          <GlideHighlight
            className="flex flex-col gap-0.5"
            highlightClassName="rounded-md bg-sidebar-accent/75"
            mode="pointer"
          >
            {savedViews.map((view) => {
              const isActiveView = activeSavedViewId === view.id;
              return (
                <div
                  className={cn(
                    "group relative z-10 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors duration-[var(--duration-micro)]",
                    isActiveView
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/70 in-data-[glide-visible=true]:hover:bg-transparent hover:text-sidebar-accent-foreground",
                  )}
                  data-glide-item
                  key={view.id}
                >
                  <button
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-0.5 text-left"
                    onClick={() => onOpenSavedView(view)}
                    type="button"
                  >
                    <SpaceIcon
                      color={view.color ?? "slate"}
                      icon={view.icon ?? "Bookmark"}
                      size="xs"
                      tone="mono"
                    />
                    <span className="truncate">{view.name}</span>
                  </button>
                  {onPublishSavedView ? (
                    <button
                      aria-label={t("garden.publishAction")}
                      className="hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground group-hover:inline-flex"
                      onClick={() => onPublishSavedView(view)}
                      title={t("garden.publishAction")}
                      type="button"
                    >
                      <GlobeIcon className="size-3" />
                    </button>
                  ) : null}
                  <button
                    aria-label={t("nav.deleteSavedViewAria", { name: view.name })}
                    className="hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-destructive-foreground group-hover:inline-flex"
                    onClick={() => onDeleteSavedView(view.id)}
                    type="button"
                  >
                    <Trash2Icon className="size-3" />
                  </button>
                </div>
              );
            })}
          </GlideHighlight>
        ) : null}
      </div>

      {nestedTagTree.length > 0 ? (
        <div className="flex flex-col gap-1">
          <button
            aria-expanded={tagsExpanded}
            aria-label={t("nav.toggleTagsAria")}
            className="flex w-full cursor-pointer items-center justify-between px-2.5 py-0.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground/85 transition-colors hover:text-foreground"
            onClick={onToggleTagsExpanded}
            type="button"
          >
            <span className="flex items-center gap-1">
              <ChevronRightIcon
                className={cn(
                  "size-3 transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out-strong)]",
                  tagsExpanded && "rotate-90",
                )}
              />
              <span>{t("nav.tags")}</span>
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/70 tabular-nums">
              {nestedTagTree.length}
            </span>
          </button>
          <GridDisclosure open={tagsExpanded}>
            <div className="flex flex-col gap-0.5 pt-0.5">{renderTagTree(nestedTagTree)}</div>
          </GridDisclosure>
        </div>
      ) : null}
    </>
  );
}
