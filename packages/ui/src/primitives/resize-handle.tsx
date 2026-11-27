"use client";

import { GripHorizontalIcon, GripVerticalIcon } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { cn } from "../lib/utils.ts";

export function clampPaneWidth(
  width: number,
  minWidth: number,
  maxWidth: number,
): number {
  const safeMin = Number.isFinite(minWidth) ? minWidth : 0;
  const safeMax = Number.isFinite(maxWidth) ? Math.max(safeMin, maxWidth) : safeMin;
  if (!Number.isFinite(width)) return Math.round(safeMin);
  return Math.round(Math.min(safeMax, Math.max(safeMin, width)));
}

export interface UseResizablePaneOptions {
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly side?: "left" | "right" | undefined;
}

export interface UseResizablePaneResult {
  readonly width: number;
  readonly setWidth: (next: number) => void;
  readonly resizeByDelta: (deltaPx: number) => void;
  readonly resetWidth: () => void;
  readonly isResizing: boolean;
  readonly setIsResizing: (resizing: boolean) => void;
}

/**
 * Manages a clamped pane width with SSR-safe localStorage persistence.
 */
export function useResizablePane({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  side = "left",
}: UseResizablePaneOptions): UseResizablePaneResult {
  const fallbackWidth = clampPaneWidth(defaultWidth, minWidth, maxWidth);
  const [storedWidth, setStoredWidth] = useLocalStorage<number>(storageKey, fallbackWidth, {
    serializer: (next) => String(clampPaneWidth(next, minWidth, maxWidth)),
    deserializer: (raw) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? clampPaneWidth(parsed, minWidth, maxWidth) : fallbackWidth;
    },
  });
  const width = clampPaneWidth(storedWidth, minWidth, maxWidth);
  const [isResizing, setIsResizing] = useState(false);

  const setWidth = useCallback(
    (next: number) => {
      setStoredWidth(clampPaneWidth(next, minWidth, maxWidth));
    },
    [maxWidth, minWidth, setStoredWidth],
  );

  const resizeByDelta = useCallback(
    (deltaPx: number) => {
      if (!Number.isFinite(deltaPx) || deltaPx === 0) return;
      const signed = side === "right" ? -deltaPx : deltaPx;
      setStoredWidth((prev) => clampPaneWidth(prev + signed, minWidth, maxWidth));
    },
    [maxWidth, minWidth, setStoredWidth, side],
  );

  const resetWidth = useCallback(() => {
    setStoredWidth(clampPaneWidth(defaultWidth, minWidth, maxWidth));
  }, [defaultWidth, maxWidth, minWidth, setStoredWidth]);

  return {
    width,
    setWidth,
    resizeByDelta,
    resetWidth,
    isResizing,
    setIsResizing,
  };
}

export interface ResizeHandleProps {
  readonly orientation?: "vertical" | "horizontal" | undefined;
  readonly onResizeDelta: (deltaPx: number) => void;
  readonly onReset?: (() => void) | undefined;
  readonly onResizeStart?: (() => void) | undefined;
  readonly onResizeEnd?: (() => void) | undefined;
  readonly ariaLabel?: string | undefined;
  readonly valueNow?: number | undefined;
  readonly valueMin?: number | undefined;
  readonly valueMax?: number | undefined;
  readonly className?: string | undefined;
}

const KEYBOARD_STEP_PX = 8;

/**
 * Hairline 1px split handle with an 8px hit target, bold centered rail and grip pill on
 * hover/drag, self-healing window-scoped pointer capture, double-click reset, and arrow nudging.
 */
export function ResizeHandle({
  orientation = "vertical",
  onResizeDelta,
  onReset,
  onResizeStart,
  onResizeEnd,
  ariaLabel,
  valueNow,
  valueMin,
  valueMax,
  className,
}: ResizeHandleProps): React.ReactElement {
  const [dragging, setDragging] = useState(false);
  const handleElRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const lastCoordRef = useRef<number | null>(null);
  const cleanupWindowListenersRef = useRef<(() => void) | null>(null);
  const onResizeDeltaRef = useRef(onResizeDelta);
  const onResizeEndRef = useRef(onResizeEnd);

  onResizeDeltaRef.current = onResizeDelta;
  onResizeEndRef.current = onResizeEnd;

  const isVertical = orientation === "vertical";

  const endDrag = useCallback(() => {
    if (cleanupWindowListenersRef.current) {
      cleanupWindowListenersRef.current();
      cleanupWindowListenersRef.current = null;
    }

    const el = handleElRef.current;
    const pointerId = activePointerIdRef.current;
    if (el && pointerId !== null) {
      try {
        if (el.hasPointerCapture(pointerId)) {
          el.releasePointerCapture(pointerId);
        }
      } catch {
        // Ignore stale pointerId or detached DOM node
      }
    }

    if (typeof document !== "undefined") {
      delete document.documentElement.dataset.inkadeResizing;
    }

    const wasDragging = isDraggingRef.current;
    isDraggingRef.current = false;
    activePointerIdRef.current = null;
    lastCoordRef.current = null;

    if (wasDragging) {
      setDragging(false);
      onResizeEndRef.current?.();
    }
  }, []);

  useEffect(() => endDrag, [endDrag]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      endDrag();
      event.preventDefault();

      isDraggingRef.current = true;
      activePointerIdRef.current = event.pointerId;
      lastCoordRef.current = isVertical ? event.clientX : event.clientY;
      setDragging(true);

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic events or browsers without capture support
      }

      if (typeof document !== "undefined") {
        document.documentElement.dataset.inkadeResizing = isVertical ? "vertical" : "horizontal";
      }

      if (typeof window !== "undefined") {
        const onWindowPointerMove = (moveEvent: PointerEvent) => {
          if (!isDraggingRef.current || moveEvent.pointerId !== activePointerIdRef.current) {
            return;
          }
          // Self-heal if mouse button was released outside capture or during focus transitions
          if (moveEvent.pointerType === "mouse" && (moveEvent.buttons & 1) === 0) {
            endDrag();
            return;
          }
          if (lastCoordRef.current === null) return;
          const current = isVertical ? moveEvent.clientX : moveEvent.clientY;
          const delta = current - lastCoordRef.current;
          if (delta !== 0) {
            lastCoordRef.current = current;
            onResizeDeltaRef.current(delta);
          }
        };

        const onWindowPointerEnd = (endEvent: PointerEvent) => {
          if (endEvent.pointerId !== activePointerIdRef.current) return;
          endDrag();
        };

        const onWindowBlur = () => {
          endDrag();
        };

        const onWindowKeyDown = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key === "Escape") {
            endDrag();
          }
        };

        window.addEventListener("pointermove", onWindowPointerMove);
        window.addEventListener("pointerup", onWindowPointerEnd);
        window.addEventListener("pointercancel", onWindowPointerEnd);
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("keydown", onWindowKeyDown);

        cleanupWindowListenersRef.current = () => {
          window.removeEventListener("pointermove", onWindowPointerMove);
          window.removeEventListener("pointerup", onWindowPointerEnd);
          window.removeEventListener("pointercancel", onWindowPointerEnd);
          window.removeEventListener("blur", onWindowBlur);
          window.removeEventListener("keydown", onWindowKeyDown);
        };
      }

      onResizeStart?.();
    },
    [endDrag, isVertical, onResizeStart],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isVertical) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onResizeDeltaRef.current(-KEYBOARD_STEP_PX);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onResizeDeltaRef.current(KEYBOARD_STEP_PX);
        }
      } else {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onResizeDeltaRef.current(-KEYBOARD_STEP_PX);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          onResizeDeltaRef.current(KEYBOARD_STEP_PX);
        }
      }
    },
    [isVertical],
  );

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation={orientation}
      aria-valuemax={valueMax}
      aria-valuemin={valueMin}
      aria-valuenow={valueNow}
      className={cn(
        "group relative z-10 shrink-0 select-none touch-none overflow-visible bg-border/80 outline-none hover:z-20 focus-visible:z-20 data-[resizing=true]:z-30",
        isVertical
          ? "h-full w-px cursor-col-resize after:absolute after:inset-y-0 after:-left-[4px] after:-right-[4px] after:content-['']"
          : "h-px w-full cursor-row-resize after:absolute after:inset-x-0 after:-top-[4px] after:-bottom-[4px] after:content-['']",
        "focus-visible:bg-primary",
        className,
      )}
      data-orientation={orientation}
      data-resizing={dragging ? "true" : undefined}
      data-slot="resize-handle"
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={handlePointerDown}
      ref={handleElRef}
      role="separator"
      tabIndex={0}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute rounded-full bg-transparent transition-[background-color,width,height] duration-[var(--duration-quick)]",
          isVertical
            ? "inset-y-0 left-1/2 w-[2px] -translate-x-1/2 group-hover:bg-foreground/30 group-focus-visible:bg-primary/70"
            : "inset-x-0 top-1/2 h-[2px] -translate-y-1/2 group-hover:bg-foreground/30 group-focus-visible:bg-primary/70",
          dragging && (isVertical ? "w-[2.5px] bg-primary" : "h-[2.5px] bg-primary"),
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground opacity-0 shadow-xs transition-[opacity,border-color,color,background-color] duration-[var(--duration-quick)] group-hover:opacity-100 group-focus-visible:opacity-100",
          isVertical ? "h-7 w-3" : "h-3 w-7",
          dragging && "border-primary/60 bg-background text-primary opacity-100",
        )}
        data-slot="resize-handle-grip"
      >
        {isVertical ? (
          <GripVerticalIcon className="size-2.5 shrink-0" />
        ) : (
          <GripHorizontalIcon className="size-2.5 shrink-0" />
        )}
      </span>
    </div>
  );
}
