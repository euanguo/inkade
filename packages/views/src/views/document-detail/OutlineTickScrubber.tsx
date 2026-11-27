import type { TocEntry } from "@inkade/core";
import { cn, GlideHighlight } from "@inkade/ui";
import type React from "react";
import { memo, useSyncExternalStore } from "react";
import type { ActiveHeadingStore } from "./types.ts";

export const OutlineTickScrubber = memo(function OutlineTickScrubber({
  store,
  toc,
  isSplitOpen,
  onScrollToHeading,
  ariaLabel,
  outlineTitle,
}: {
  readonly store: ActiveHeadingStore;
  readonly toc: readonly TocEntry[];
  readonly isSplitOpen: boolean;
  readonly onScrollToHeading: (entry: TocEntry) => void;
  readonly ariaLabel: string;
  readonly outlineTitle: string;
}): React.ReactElement {
  const activeHeadingSlug = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "group/scrubber sticky top-24 hidden w-9 shrink-0 flex-col items-end py-2",
        isSplitOpen ? "2xl:flex" : "xl:flex",
      )}
      data-testid="outline-tick-scrubber"
    >
      <div className="flex flex-col items-end gap-2 rounded-lg px-1.5 py-2 transition-colors hover:bg-muted/60">
        {toc.map((entry) => {
          const isActive = activeHeadingSlug === entry.slug;
          const tickWidth =
            entry.depth === 1 ? "w-5" : entry.depth === 2 ? "w-3.5" : "w-2";
          return (
            <button
              aria-current={isActive ? "location" : undefined}
              aria-label={entry.text}
              className={cn(
                "h-[2px] cursor-pointer rounded-full transition-[width,background-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                tickWidth,
                isActive
                  ? "w-6 bg-primary"
                  : "bg-muted-foreground/35 group-hover/scrubber:bg-muted-foreground/60 hover:bg-foreground",
              )}
              key={`tick-${entry.slug}-${entry.startOffset}`}
              onClick={() => onScrollToHeading(entry)}
              title={entry.text}
              type="button"
            />
          );
        })}
      </div>
      <div className="pointer-events-none invisible absolute top-0 right-full z-30 mr-2 max-h-[65vh] w-60 overflow-y-auto rounded-lg border border-[var(--border-overlay)] bg-popover/95 p-2.5 opacity-0 shadow-[var(--shadow-overlay)] backdrop-blur-md transition-[opacity,visibility] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] [scrollbar-gutter:stable] group-hover/scrubber:pointer-events-auto group-hover/scrubber:visible group-hover/scrubber:opacity-100">
        <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {outlineTitle}
        </p>
        <GlideHighlight
          className="flex flex-col gap-0.5"
          highlightClassName="rounded-md bg-accent"
          mode="pointer"
        >
          {toc.map((entry) => {
            const isActive = activeHeadingSlug === entry.slug;
            return (
              <button
                className={cn(
                  "relative z-10 w-full cursor-pointer truncate rounded-md py-1 pr-2 text-left text-xs transition-colors",
                  isActive
                    ? "bg-accent/70 font-medium text-primary"
                    : "text-muted-foreground hover:bg-accent in-data-[glide-visible=true]:hover:bg-transparent hover:text-foreground",
                )}
                data-glide-item
                key={`card-${entry.slug}-${entry.startOffset}`}
                onClick={() => onScrollToHeading(entry)}
                style={{ paddingLeft: `${Math.max(0, entry.depth - 1) * 10 + 8}px` }}
                type="button"
              >
                {entry.text}
              </button>
            );
          })}
        </GlideHighlight>
      </div>
    </nav>
  );
});
