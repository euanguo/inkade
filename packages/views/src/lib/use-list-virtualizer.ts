import {
  type PartialKeys,
  type ReactVirtualizer,
  type ReactVirtualizerOptions,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

export interface FallbackRect {
  readonly width: number;
  readonly height: number;
}

const DEFAULT_FALLBACK_RECT: FallbackRect = { width: 800, height: 600 };

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Observes scroll container bounds while keeping a positive fallback height when
 * running in SSR or non-layout test environments (e.g. Happy-DOM).
 */
function createFallbackObserveElementRect<
  TScrollElement extends Element,
  TItemElement extends Element,
>(fallbackRect: FallbackRect) {
  return (
    instance: Virtualizer<TScrollElement, TItemElement>,
    cb: (rect: { width: number; height: number }) => void,
  ): (() => void) | undefined => {
    const element = instance.scrollElement;
    if (!element) {
      cb({ width: fallbackRect.width, height: fallbackRect.height });
      return undefined;
    }

    const emitRect = (): void => {
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      cb({
        width: width > 0 ? width : fallbackRect.width,
        height: height > 0 ? height : fallbackRect.height,
      });
    };

    emitRect();

    const targetWindow = instance.targetWindow;
    if (!targetWindow || typeof targetWindow.ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new targetWindow.ResizeObserver(() => {
      emitRect();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  };
}

/**
 * Measures dynamic row size, falling back to `estimateSize` when layout engines
 * return 0 (such as Happy-DOM unit tests).
 */
function fallbackMeasureElement<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  element: TItemElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<TScrollElement, TItemElement>,
): number {
  let measured = 0;
  const horizontal = Boolean(instance.options.horizontal);
  if (entry?.borderBoxSize?.[0]) {
    const box = entry.borderBoxSize[0];
    measured = Math.round(horizontal ? box.inlineSize : box.blockSize);
  } else if (typeof HTMLElement !== "undefined" && element instanceof HTMLElement) {
    measured = horizontal ? element.offsetWidth : element.offsetHeight;
  } else {
    const rect = element.getBoundingClientRect();
    measured = Math.round(horizontal ? rect.width : rect.height);
  }

  if (measured > 0) {
    return measured;
  }

  const index = instance.indexFromElement(element);
  if (Number.isFinite(index) && index >= 0) {
    return instance.options.estimateSize(index);
  }
  return 48;
}

export type UseListVirtualizerOptions<
  TScrollElement extends Element,
  TItemElement extends Element,
> = PartialKeys<
  ReactVirtualizerOptions<TScrollElement, TItemElement>,
  "observeElementRect" | "observeElementOffset" | "scrollToFn"
> & {
  readonly fallbackRect?: FallbackRect | undefined;
};

/**
 * Thin wrapper around TanStack `useVirtualizer` with safe SSR and Happy-DOM fallbacks.
 */
export function useListVirtualizer<
  TScrollElement extends Element = HTMLDivElement,
  TItemElement extends Element = HTMLElement,
>({
  fallbackRect = DEFAULT_FALLBACK_RECT,
  overscan = 8,
  ...options
}: UseListVirtualizerOptions<TScrollElement, TItemElement>): ReactVirtualizer<
  TScrollElement,
  TItemElement
> {
  const fallbackWidth = fallbackRect.width;
  const fallbackHeight = fallbackRect.height;
  const observeElementRect = useMemo(
    () =>
      createFallbackObserveElementRect<TScrollElement, TItemElement>({
        width: fallbackWidth,
        height: fallbackHeight,
      }),
    [fallbackHeight, fallbackWidth],
  );

  return useVirtualizer({
    overscan,
    initialRect: fallbackRect,
    observeElementRect,
    measureElement: fallbackMeasureElement,
    ...options,
  });
}

/**
 * Finds the nearest scrollable ancestor element (preferring Base UI ScrollArea viewports).
 */
export function findScrollableAncestor(element: HTMLElement | null): HTMLElement | null {
  if (typeof window === "undefined") return null;
  let current = element?.parentElement ?? null;
  while (current) {
    if (current.getAttribute("data-slot") === "scroll-area-viewport") {
      return current;
    }
    const overflowY = window.getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Resolves an enclosing scroll container and computes `scrollMargin` between the
 * list wrapper and that scroll container so virtualizers work cleanly inside outer ScrollAreas.
 */
export function useAncestorScrollMetrics(
  wrapperRef: React.RefObject<HTMLElement | null>,
  depsKey?: string | number | boolean,
): {
  readonly scrollElement: HTMLElement | null;
  readonly scrollMargin: number;
} {
  const [metrics, setMetrics] = useState<{
    readonly scrollElement: HTMLElement | null;
    readonly scrollMargin: number;
  }>({ scrollElement: null, scrollMargin: 0 });

  useIsomorphicLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const scroller = findScrollableAncestor(wrapper);

    const update = (): void => {
      const nextWrapper = wrapperRef.current;
      const nextScroller = findScrollableAncestor(nextWrapper);
      if (!nextWrapper || !nextScroller) {
        setMetrics((prev) =>
          prev.scrollElement === null && prev.scrollMargin === 0
            ? prev
            : { scrollElement: null, scrollMargin: 0 },
        );
        return;
      }
      const wrapperRect = nextWrapper.getBoundingClientRect();
      const scrollerRect = nextScroller.getBoundingClientRect();
      const margin = Math.max(
        0,
        Math.round(wrapperRect.top - scrollerRect.top + nextScroller.scrollTop),
      );
      setMetrics((prev) =>
        prev.scrollElement === nextScroller && prev.scrollMargin === margin
          ? prev
          : { scrollElement: nextScroller, scrollMargin: margin },
      );
    };

    update();

    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(update);
    if (scroller) ro.observe(scroller);
    if (wrapper?.parentElement) ro.observe(wrapper.parentElement);
    return () => {
      ro.disconnect();
    };
  }, [wrapperRef, depsKey]);

  return metrics;
}
