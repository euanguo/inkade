"use client";

import * as React from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "./badge.tsx";
import { TagPill, type TagPillProps } from "./tag-pill.tsx";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * Computes how many tags fit cleanly on a single line before collapsing remainder into `+N`.
 */
export function computeVisibleTagCount(
  itemWidths: readonly number[],
  availableWidth: number,
  overflowWidth: number,
  gap = 4,
  minVisible = 1,
): number {
  if (itemWidths.length === 0) return 0;
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return itemWidths.length;
  }

  let used = 0;
  let visible = 0;

  for (let i = 0; i < itemWidths.length; i += 1) {
    const width = Math.max(0, itemWidths[i] ?? 0);
    const nextUsed = used + (visible > 0 ? gap : 0) + width;
    const remainingAfter = itemWidths.length - (i + 1);
    const neededWithOverflow =
      nextUsed + (remainingAfter > 0 ? gap + Math.max(0, overflowWidth) : 0);

    if (neededWithOverflow > availableWidth) {
      break;
    }
    used = nextUsed;
    visible += 1;
  }

  return Math.min(itemWidths.length, Math.max(minVisible, visible));
}

export interface TagListProps {
  readonly tags: readonly string[];
  readonly maxFallbackVisible?: number | undefined;
  readonly tone?: TagPillProps["tone"] | undefined;
  readonly size?: TagPillProps["size"] | undefined;
  readonly activeTag?: string | null | undefined;
  readonly onTagClick?: ((tag: string) => void) | undefined;
  readonly formatOverflow?: ((hiddenCount: number) => string) | undefined;
  readonly emptyFallback?: React.ReactNode | undefined;
  readonly className?: string | undefined;
}

/**
 * Single-row adaptive tag list that measures available container width and collapses overflow into `+N`.
 */
export function TagList({
  tags,
  maxFallbackVisible = 3,
  tone = "neutral",
  size = "sm",
  activeTag,
  onTagClick,
  formatOverflow,
  emptyFallback = null,
  className,
}: TagListProps): React.ReactElement | null {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const measureRef = React.useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = React.useState<number>(() =>
    Math.min(tags.length, Math.max(1, maxFallbackVisible)),
  );

  React.useEffect(() => {
    setVisibleCount((prev) =>
      tags.length === 0 ? 0 : Math.min(tags.length, Math.max(1, prev || maxFallbackVisible)),
    );
  }, [maxFallbackVisible, tags.length]);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure || tags.length === 0) return;

    const update = () => {
      const available = container.clientWidth;
      if (available <= 0) return;
      const tagWidths = Array.from(
        measure.querySelectorAll<HTMLElement>("[data-tag-measure]"),
        (el) => el.offsetWidth,
      );
      const overflowWidth =
        measure.querySelector<HTMLElement>("[data-overflow-measure]")?.offsetWidth ?? 28;
      const next = computeVisibleTagCount(tagWidths, available, overflowWidth, 4, 1);
      setVisibleCount((prev) => (prev === next ? prev : next));
    };

    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [tags, size, tone]);

  if (tags.length === 0) {
    return emptyFallback ? <>{emptyFallback}</> : null;
  }

  const clampedVisible = Math.min(tags.length, Math.max(1, visibleCount));
  const hiddenCount = tags.length - clampedVisible;
  const overflowText = formatOverflow ? formatOverflow(hiddenCount) : `+${hiddenCount}`;

  return (
    <div
      aria-label={tags.join(", ")}
      className={cn("relative flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden", className)}
      data-slot="tag-list"
      ref={containerRef}
      title={tags.join(", ")}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 flex flex-nowrap items-center gap-1 whitespace-nowrap"
        ref={measureRef}
      >
        {tags.map((tag) => (
          <span data-tag-measure="" key={tag}>
            <TagPill size={size} tag={tag} tone={tone} />
          </span>
        ))}
        <span data-overflow-measure="">
          <Badge size={size === "md" ? "default" : "sm"} variant="secondary">
            {formatOverflow ? formatOverflow(tags.length) : `+${tags.length}`}
          </Badge>
        </span>
      </div>

      {tags.slice(0, clampedVisible).map((tag) => (
        <TagPill
          active={activeTag ? tag.toLowerCase() === activeTag.toLowerCase() : false}
          className={clampedVisible === 1 && hiddenCount > 0 ? "min-w-0 shrink" : undefined}
          key={tag}
          onClick={onTagClick ? () => onTagClick(tag) : undefined}
          size={size}
          tag={tag}
          tone={tone}
        />
      ))}

      {hiddenCount > 0 ? (
        <Badge
          className="shrink-0 tabular-nums"
          data-slot="tag-list-overflow"
          size={size === "md" ? "default" : "sm"}
          variant="secondary"
        >
          {overflowText}
        </Badge>
      ) : null}
    </div>
  );
}
