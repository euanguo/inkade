"use client";

import * as React from "react";
import { useIsomorphicLayoutEffect, useResizeObserver } from "usehooks-ts";
import { cn, prefersReducedMotion } from "../lib/utils.ts";
import { GridDisclosure } from "../primitives/grid-disclosure.tsx";

export interface SelectionAnchorRect {
  readonly x: number;
  readonly y: number;
}

/**
 * Anchors a floating bar beneath (or above) a text selection's bounding box relative to its host container,
 * horizontally centered against the complete selection while vertically attached to the anchor line rect.
 */
export function computeSelectionAnchorRect(
  selectionBounds: Pick<DOMRect, "left" | "width" | "top" | "bottom">,
  anchorLineRect: Pick<DOMRect, "top" | "bottom">,
  hostBounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  options?: {
    readonly placement?: "below" | "above" | undefined;
    readonly offsetPx?: number | undefined;
    readonly minEdgePx?: number | undefined;
  },
): SelectionAnchorRect {
  const placement = options?.placement ?? "below";
  const offsetPx = options?.offsetPx ?? 8;
  const minEdgePx = options?.minEdgePx ?? 12;
  const rawX = selectionBounds.left - hostBounds.left + selectionBounds.width / 2;
  const clampedX =
    hostBounds.width > minEdgePx * 2
      ? Math.min(Math.max(rawX, minEdgePx), hostBounds.width - minEdgePx)
      : rawX;
  const rawY =
    placement === "above"
      ? anchorLineRect.top - hostBounds.top - offsetPx
      : anchorLineRect.bottom - hostBounds.top + offsetPx;

  return {
    x: Math.round(clampedX),
    y: Math.round(rawY),
  };
}

export interface SelectionActionBarProps {
  /** Changing this key triggers smooth WAAPI intrinsic-width morphing across action states. */
  readonly morphKey?: string | number | boolean | undefined;
  readonly children: React.ReactNode;
  readonly drawer?: React.ReactNode | undefined;
  readonly drawerOpen?: boolean | undefined;
  readonly onMouseDown?: React.MouseEventHandler<HTMLDivElement> | undefined;
  readonly pillClassName?: string | undefined;
  readonly shape?: "rounded" | "pill" | undefined;
  readonly className?: string | undefined;
  readonly style?: React.CSSProperties | undefined;
}

function measurePillFrameExtraWidth(bar: HTMLElement | null): number {
  if (!bar || typeof window === "undefined") return 10;
  const cs = window.getComputedStyle(bar);
  const padL = Number.parseFloat(cs.paddingLeft) || 0;
  const padR = Number.parseFloat(cs.paddingRight) || 0;
  const borderL = Number.parseFloat(cs.borderLeftWidth) || 0;
  const borderR = Number.parseFloat(cs.borderRightWidth) || 0;
  return Math.ceil(padL + padR + borderL + borderR);
}

/**
 * Floating contextual AI & formatting selection pill with intrinsic-width WAAPI morphing
 * and an optional Grid-animated secondary composer drawer.
 */
export function SelectionActionBar({
  morphKey,
  children,
  drawer,
  drawerOpen = false,
  onMouseDown,
  pillClassName,
  shape = "rounded",
  className,
  style,
}: SelectionActionBarProps): React.ReactElement {
  const barRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const previousKeyRef = React.useRef(morphKey);
  const lastWidthRef = React.useRef(0);
  const widthAnimationRef = React.useRef<Animation | null>(null);

  useIsomorphicLayoutEffect(() => {
    const bar = barRef.current;
    const content = contentRef.current;
    if (!bar || !content) return;

    const nextWidth = Math.ceil(content.getBoundingClientRect().width) + measurePillFrameExtraWidth(bar);
    const previousWidth =
      lastWidthRef.current || Math.ceil(bar.getBoundingClientRect().width);
    const viewportCap = typeof window !== "undefined" ? window.innerWidth - 32 : nextWidth;

    if (
      previousKeyRef.current !== morphKey &&
      !prefersReducedMotion() &&
      (typeof window === "undefined" || window.innerWidth >= 640) &&
      nextWidth <= viewportCap &&
      previousWidth <= viewportCap &&
      Math.abs(nextWidth - previousWidth) > 1 &&
      typeof bar.animate === "function"
    ) {
      widthAnimationRef.current?.cancel();
      try {
        const animation = bar.animate(
          [{ width: `${previousWidth}px` }, { width: `${nextWidth}px` }],
          {
            duration: 280,
            easing: "cubic-bezier(0.23, 1, 0.32, 1)",
          },
        );
        widthAnimationRef.current = animation;
        animation.onfinish = () => {
          lastWidthRef.current = nextWidth;
          widthAnimationRef.current = null;
        };
      } catch {
        lastWidthRef.current = nextWidth;
      }
    } else {
      lastWidthRef.current = nextWidth;
    }

    previousKeyRef.current = morphKey;
  }, [morphKey]);

  useResizeObserver({
    ref: contentRef as React.RefObject<HTMLDivElement>,
    onResize: () => {
      const content = contentRef.current;
      if (!content || widthAnimationRef.current?.playState === "running") return;
      lastWidthRef.current =
        Math.ceil(content.getBoundingClientRect().width) +
        measurePillFrameExtraWidth(barRef.current);
    },
  });

  React.useEffect(() => {
    return () => {
      widthAnimationRef.current?.cancel();
    };
  }, []);

  return (
    <div
      className={cn("flex flex-col items-start gap-1.5", className)}
      data-slot="selection-action-bar"
      style={style}
    >
      <div
        className={cn(
          "flex w-fit max-w-[calc(100vw-1.5rem)] items-center overflow-hidden border border-[var(--border-overlay)] bg-popover p-1 text-popover-foreground shadow-[var(--shadow-overlay)] sm:overflow-x-auto sm:overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          shape === "pill"
            ? "rounded-full px-1.5 py-1"
            : "rounded-xl [&_button:not(.rounded-full)]:rounded-lg",
          pillClassName,
        )}
        data-slot="selection-action-bar-pill"
        onMouseDown={onMouseDown}
        ref={barRef}
        style={{
          animation: prefersReducedMotion()
            ? undefined
            : "inkade-pop-in var(--duration-fast) var(--ease-out-strong) both",
        }}
      >
        <div
          className="flex w-fit max-w-full flex-wrap items-center gap-0.5 sm:max-w-none sm:shrink-0 sm:flex-nowrap"
          data-slot="selection-action-bar-content"
          ref={contentRef}
        >
          {children}
        </div>
      </div>

      {drawer ? (
        <GridDisclosure className="w-full" open={Boolean(drawerOpen)}>
          {drawer}
        </GridDisclosure>
      ) : null}
    </div>
  );
}
