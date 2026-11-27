"use client";

import * as React from "react";
import { cn } from "../lib/utils.ts";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export interface GlideRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Computes item geometry relative to the GlideHighlight container's scroll-adjusted coordinate space.
 */
export function computeGlideRect(
  itemRect: Pick<DOMRect, "top" | "left" | "width" | "height">,
  containerRect: Pick<DOMRect, "top" | "left">,
  scrollTop = 0,
  scrollLeft = 0,
  insetX?: number,
  containerWidth?: number,
  scaleX = 1,
  scaleY = 1,
): GlideRect {
  const safeScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
  const safeScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
  const rawLeft = (itemRect.left - containerRect.left) / safeScaleX + scrollLeft;
  const rawTop = (itemRect.top - containerRect.top) / safeScaleY + scrollTop;
  const rawWidth = itemRect.width / safeScaleX;
  const rawHeight = itemRect.height / safeScaleY;
  if (insetX !== undefined && containerWidth !== undefined && containerWidth > insetX * 2) {
    return {
      top: rawTop,
      left: insetX,
      width: Math.max(0, containerWidth - insetX * 2),
      height: rawHeight,
    };
  }
  return {
    top: rawTop,
    left: rawLeft,
    width: rawWidth,
    height: rawHeight,
  };
}

function isSameGlideRect(a: GlideRect | null, b: GlideRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

export interface GlideHighlightProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `"pointer"` tracks pointer hover & focus across `[data-glide-item]` descendants.
   * `"highlighted"` tracks `[data-highlighted]` attributes driven by Base UI menus/selects/commands.
   */
  readonly mode?: "pointer" | "highlighted" | undefined;
  readonly rowSelector?: string | undefined;
  readonly highlightClassName?: string | undefined;
  readonly insetX?: number | undefined;
  readonly disabled?: boolean | undefined;
}

/**
 * Shared floating highlight plane that smoothly glides between hovered or keyboard-highlighted rows.
 */
export function GlideHighlight({
  mode = "pointer",
  rowSelector = "[data-glide-item]",
  highlightClassName = "rounded-md bg-accent",
  insetX,
  disabled = false,
  className,
  children,
  onPointerOver,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: GlideHighlightProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const activeTargetRef = React.useRef<HTMLElement | null>(null);
  const [rect, setRect] = React.useState<GlideRect | null>(null);
  const [visible, setVisible] = React.useState(false);

  const measureElement = React.useCallback(
    (target: HTMLElement | null) => {
      const container = containerRef.current;
      if (disabled || !container || !target || !container.contains(target)) {
        activeTargetRef.current = null;
        setVisible(false);
        return;
      }
      if (target.hasAttribute("data-disabled") || target.getAttribute("aria-disabled") === "true") {
        setVisible(false);
        return;
      }
      activeTargetRef.current = target;
      const containerRect = container.getBoundingClientRect();
      const scaleX = container.offsetWidth > 0 ? containerRect.width / container.offsetWidth : 1;
      const scaleY = container.offsetHeight > 0 ? containerRect.height / container.offsetHeight : 1;
      const next = computeGlideRect(
        target.getBoundingClientRect(),
        containerRect,
        container.scrollTop,
        container.scrollLeft,
        insetX,
        container.clientWidth,
        scaleX,
        scaleY,
      );
      setRect((prev) => (isSameGlideRect(prev, next) ? prev : next));
      setVisible(next.width > 0 && next.height > 0);
    },
    [disabled, insetX],
  );

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || disabled) {
      setVisible(false);
      return;
    }

    const syncFromHighlighted = () => {
      if (mode !== "highlighted") {
        if (activeTargetRef.current && container.contains(activeTargetRef.current)) {
          measureElement(activeTargetRef.current);
        }
        return;
      }
      const highlighted = container.querySelector<HTMLElement>("[data-highlighted]");
      measureElement(highlighted);
    };

    syncFromHighlighted();

    let mutationObserver: MutationObserver | null = null;
    if (mode === "highlighted" && typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => {
        syncFromHighlighted();
      });
      mutationObserver.observe(container, {
        attributes: true,
        attributeFilter: ["data-highlighted", "data-disabled", "aria-disabled"],
        childList: true,
        subtree: true,
      });
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        syncFromHighlighted();
      });
      resizeObserver.observe(container);
    }

    return () => {
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [disabled, measureElement, mode]);

  const handlePointerOver = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerOver?.(event);
    if (disabled || mode !== "pointer") return;
    const container = containerRef.current;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(rowSelector) : null;
    if (container && target && container.contains(target)) {
      measureElement(target);
    }
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(event);
    if (mode !== "pointer") return;
    activeTargetRef.current = null;
    setVisible(false);
  };

  const handleFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    onFocus?.(event);
    if (disabled || mode !== "pointer") return;
    const container = containerRef.current;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(rowSelector) : null;
    if (container && target && container.contains(target)) {
      measureElement(target);
    }
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    onBlur?.(event);
    if (mode !== "pointer") return;
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
      activeTargetRef.current = null;
      setVisible(false);
    }
  };

  return (
    <div
      className={cn("group/glide relative", className)}
      data-glide-visible={visible ? "true" : "false"}
      data-slot="glide-highlight"
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPointerLeave={handlePointerLeave}
      onPointerOver={handlePointerOver}
      ref={containerRef}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-0 left-0 z-0 transition-[transform,width,height,opacity] duration-[var(--duration-glide)] ease-[var(--ease-out-strong)] motion-reduce:transition-none",
          highlightClassName,
        )}
        data-slot="glide-highlight-plane"
        style={{
          transform: rect ? `translate3d(${rect.left}px, ${rect.top}px, 0)` : "translate3d(0, 0, 0)",
          width: rect ? `${rect.width}px` : "0px",
          height: rect ? `${rect.height}px` : "0px",
          opacity: visible ? 1 : 0,
        }}
      />
      {children}
    </div>
  );
}
