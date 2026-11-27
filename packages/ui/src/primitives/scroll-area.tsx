"use client";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import * as React from "react";
import { cn } from "../lib/utils.ts";

export type OpticalFadeTone = "background" | "sidebar" | "card" | "popover";

const OPTICAL_FADE_SURFACE: Readonly<Record<OpticalFadeTone, string>> = {
  background: "var(--background)",
  sidebar: "var(--sidebar)",
  card: "var(--card)",
  popover: "var(--popover)",
};

const OPTICAL_FADE_RANGE_PX = 24;

export function computeOpticalFadeOpacities(metrics: {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}): { readonly top: number; readonly bottom: number } {
  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  if (maxScroll <= 1) {
    return { top: 0, bottom: 0 };
  }
  const top = Math.min(1, Math.max(0, metrics.scrollTop / OPTICAL_FADE_RANGE_PX));
  const bottomRemaining = maxScroll - metrics.scrollTop;
  const bottom = Math.min(1, Math.max(0, bottomRemaining / OPTICAL_FADE_RANGE_PX));
  return { top, bottom };
}

export function ScrollArea({
  className,
  children,
  scrollFade = false,
  opticalFade = false,
  opticalFadeTone = "background",
  scrollbarGutter = false,
  fill = false,
  clampContentMinWidth = true,
  overscrollContain = false,
  onViewportScroll,
  viewportClassName,
  viewportRef,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  scrollFade?: boolean;
  opticalFade?: boolean;
  opticalFadeTone?: OpticalFadeTone;
  scrollbarGutter?: boolean;
  fill?: boolean;
  clampContentMinWidth?: boolean;
  overscrollContain?: boolean;
  onViewportScroll?: React.UIEventHandler<HTMLDivElement> | undefined;
  viewportClassName?: string | undefined;
  viewportRef?: React.Ref<HTMLDivElement> | undefined;
}): React.ReactElement {
  const internalViewportRef = React.useRef<HTMLDivElement | null>(null);
  const topFadeRef = React.useRef<HTMLDivElement | null>(null);
  const bottomFadeRef = React.useRef<HTMLDivElement | null>(null);

  const setViewportRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      internalViewportRef.current = node;
      if (typeof viewportRef === "function") {
        viewportRef(node);
      } else if (viewportRef && "current" in viewportRef) {
        viewportRef.current = node;
      }
    },
    [viewportRef],
  );

  React.useEffect(() => {
    if (!opticalFade) return;
    const viewport = internalViewportRef.current;
    if (!viewport) return;

    let rafId: number | null = null;
    const syncFade = (): void => {
      rafId = null;
      const { top, bottom } = computeOpticalFadeOpacities({
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      });
      if (topFadeRef.current) {
        topFadeRef.current.style.opacity = String(top);
      }
      if (bottomFadeRef.current) {
        bottomFadeRef.current.style.opacity = String(bottom);
      }
    };

    const scheduleSync = (): void => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(syncFade);
    };

    syncFade();
    viewport.addEventListener("scroll", scheduleSync, { passive: true });
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleSync) : null;
    resizeObserver?.observe(viewport);
    if (viewport.firstElementChild) {
      resizeObserver?.observe(viewport.firstElementChild);
    }

    return () => {
      viewport.removeEventListener("scroll", scheduleSync);
      resizeObserver?.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [opticalFade]);

  const fadeSurface = OPTICAL_FADE_SURFACE[opticalFadeTone];

  return (
    <ScrollAreaPrimitive.Root
      className={cn("relative size-full min-h-0", className)}
      data-optical-fade={opticalFade ? "true" : undefined}
      data-scroll-fade={scrollFade ? "true" : undefined}
      data-slot="scroll-area"
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        className={cn(
          "h-full rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--border-focus)]",
          overscrollContain &&
            "data-has-overflow-y:overscroll-y-contain data-has-overflow-x:overscroll-x-contain",
          scrollFade &&
            !opticalFade &&
            "mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] mask-l-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-start)))] mask-r-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-end)))] [--fade-size:1.5rem]",
          scrollbarGutter &&
            "data-has-overflow-y:pe-2.5 data-has-overflow-x:pb-2.5",
          viewportClassName,
        )}
        data-optical-fade={opticalFade ? "true" : undefined}
        data-scroll-fade={scrollFade ? "true" : undefined}
        data-slot="scroll-area-viewport"
        onScroll={onViewportScroll}
        ref={setViewportRefs}
      >
        <ScrollAreaPrimitive.Content
          className={cn(fill && "size-full")}
          data-slot="scroll-area-content"
          style={clampContentMinWidth ? { minWidth: 0 } : undefined}
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      {opticalFade ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 rounded-t-[inherit]"
            data-slot="scroll-area-optical-fade-top"
            ref={topFadeRef}
            style={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 backdrop-blur-[1px]"
              style={{
                background: `linear-gradient(to bottom, color-mix(in srgb, ${fadeSurface} 72%, transparent), transparent)`,
                maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
              }}
            />
            <div
              className="absolute inset-x-0 top-0 h-3 backdrop-blur-[4px]"
              style={{
                background: `linear-gradient(to bottom, color-mix(in srgb, ${fadeSurface} 92%, transparent), transparent)`,
                maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
              }}
            />
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 rounded-b-[inherit]"
            data-slot="scroll-area-optical-fade-bottom"
            ref={bottomFadeRef}
            style={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 backdrop-blur-[1px]"
              style={{
                background: `linear-gradient(to top, color-mix(in srgb, ${fadeSurface} 72%, transparent), transparent)`,
                maskImage: "linear-gradient(to top, black 0%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(to top, black 0%, transparent 100%)",
              }}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-3 backdrop-blur-[4px]"
              style={{
                background: `linear-gradient(to top, color-mix(in srgb, ${fadeSurface} 92%, transparent), transparent)`,
                maskImage: "linear-gradient(to top, black 0%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(to top, black 0%, transparent 100%)",
              }}
            />
          </div>
        </>
      ) : null}
      <ScrollBar orientation="vertical" />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props): React.ReactElement {
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn(
        "flex select-none touch-none bg-transparent opacity-0 transition-[opacity,width,height] delay-200 duration-150 data-[orientation=horizontal]:mx-1 data-[orientation=horizontal]:mb-0.5 data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:hover:h-1.5 data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-0.5 data-[orientation=vertical]:w-1 data-[orientation=vertical]:hover:w-1.5 data-hovering:opacity-100 data-scrolling:opacity-100 data-hovering:delay-0 data-scrolling:delay-0 data-hovering:duration-120 data-scrolling:duration-120",
        className,
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        className="relative flex-1 rounded-full bg-foreground/15 transition-colors duration-150 hover:bg-foreground/28 active:bg-foreground/32"
        data-slot="scroll-area-thumb"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollAreaPrimitive };
