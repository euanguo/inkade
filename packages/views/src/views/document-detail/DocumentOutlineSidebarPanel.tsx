import type {
  AdeThreadBinding,
  DocumentHighlight,
  HighlightId,
  TocEntry,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { ADE_STATUS_META, Badge, Button, cn, GlideHighlight } from "@inkade/ui";
import type React from "react";
import { memo, useSyncExternalStore } from "react";
import { type ActiveHeadingStore, getBindingStatusLabel } from "./types.ts";

export const DocumentOutlineSidebarPanel = memo(function DocumentOutlineSidebarPanel({
  store,
  toc,
  highlights,
  bindings,
  onScrollToHeading,
  onScrollToHighlight,
  onOpenThreadsTab,
}: {
  readonly store: ActiveHeadingStore;
  readonly toc: readonly TocEntry[];
  readonly highlights: readonly DocumentHighlight[];
  readonly bindings: readonly AdeThreadBinding[];
  readonly onScrollToHeading: (entry: TocEntry) => void;
  readonly onScrollToHighlight: (highlightId: HighlightId) => void;
  readonly onOpenThreadsTab: () => void;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const activeHeadingSlug = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );

  return (
    <div className="flex flex-col gap-5 px-2.5 py-3 text-xs">
      <section className="flex flex-col gap-1.5">
        <p className="px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("reader.sidebarOutlineTitle")}
        </p>
        {toc.length === 0 ? (
          <p className="px-1.5 text-muted-foreground/80">
            {t("reader.sidebarOutlineEmpty")}
          </p>
        ) : (
          <nav>
            <GlideHighlight
              className="flex flex-col gap-0.5"
              highlightClassName="rounded-md bg-sidebar-accent/75"
              mode="pointer"
            >
              {toc.map((entry) => {
                const isActive = activeHeadingSlug === entry.slug;
                return (
                  <button
                    className={cn(
                      "relative z-10 w-full cursor-pointer truncate rounded-md py-1 pr-2 text-left transition-colors",
                      isActive
                        ? "bg-sidebar-accent font-medium text-primary"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent in-data-[glide-visible=true]:hover:bg-transparent hover:text-sidebar-accent-foreground",
                    )}
                    data-glide-item
                    key={`sb-${entry.slug}-${entry.startOffset}`}
                    onClick={() => onScrollToHeading(entry)}
                    style={{ paddingLeft: `${Math.max(0, entry.depth - 1) * 10 + 6}px` }}
                    type="button"
                  >
                    {entry.text}
                  </button>
                );
              })}
            </GlideHighlight>
          </nav>
        )}
      </section>

      <section className="flex flex-col gap-1.5 border-t pt-3">
        <p className="px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("reader.sidebarHighlightsTitle")}
        </p>
        {highlights.length === 0 ? (
          <p className="px-1.5 text-muted-foreground/80">
            {t("reader.sidebarHighlightsEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {highlights.slice(0, 12).map((hl) => (
              <button
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-0.5 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border/70 hover:bg-sidebar-accent/70",
                  hl.status === "resolved" && "opacity-70",
                )}
                key={hl.id}
                onClick={() => onScrollToHighlight(hl.id)}
                type="button"
              >
                <span className="line-clamp-2 text-sidebar-foreground/90">{hl.quote}</span>
                {hl.noteMarkdown && (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {hl.noteMarkdown}
                  </span>
                )}
                {(hl.status === "resolved" || (hl.commentCount ?? 0) > 0) && (
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    {hl.status === "resolved" && (
                      <span>{t("reader.commentResolvedBadge")}</span>
                    )}
                    {(hl.commentCount ?? 0) > 0 && (
                      <span>{t("reader.commentCountLabel", { count: hl.commentCount ?? 0 })}</span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1.5 border-t pt-3">
        <div className="flex items-center justify-between px-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("reader.sidebarAdeThreadsTitle")}
          </p>
          <Button onClick={onOpenThreadsTab} size="xs" variant="ghost">
            {t("reader.sidebarInspectThreads")}
          </Button>
        </div>
        {bindings.length === 0 ? (
          <p className="px-1.5 text-muted-foreground/80">
            {t("reader.sidebarAdeThreadsEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {bindings.slice(0, 8).map((binding) => {
              const meta = ADE_STATUS_META[binding.status];
              return (
                <button
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
                  key={binding.id}
                  onClick={onOpenThreadsTab}
                  type="button"
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className={cn("size-1.5 shrink-0 rounded-full", meta.dotClassName)} />
                    <span className="truncate text-sidebar-foreground/90">
                      {binding.title || binding.externalThreadId}
                    </span>
                  </span>
                  <Badge size="sm" variant={meta.badgeVariant}>
                    {getBindingStatusLabel(binding.status, t)}
                  </Badge>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
});
