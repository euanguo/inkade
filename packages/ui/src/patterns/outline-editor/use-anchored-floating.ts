import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import type React from "react";
import { useLayoutEffect, useState } from "react";
import type { FloatingAnchorRect } from "./types.ts";

export function useAnchoredFloatingPosition(
  anchorRect: FloatingAnchorRect | null,
  elRef: React.RefObject<HTMLDivElement | null>,
  placement: "bottom-start" | "top-start" = "bottom-start",
  padding = 12,
): { readonly x: number; readonly y: number } | null {
  const [coords, setCoords] = useState<{ readonly x: number; readonly y: number } | null>(null);

  const left = anchorRect?.left;
  const top = anchorRect?.top;
  const bottom = anchorRect?.bottom;
  const right = anchorRect?.right;

  useLayoutEffect(() => {
    const floatingEl = elRef.current;
    if (!floatingEl || left === undefined || top === undefined || bottom === undefined) {
      setCoords(null);
      return;
    }

    const virtualEl = {
      getBoundingClientRect: () =>
        new DOMRect(
          left,
          top,
          Math.max(1, (right ?? left) - left),
          Math.max(18, bottom - top),
        ),
    };

    const update = (): void => {
      void computePosition(virtualEl, floatingEl, {
        strategy: "fixed",
        placement,
        middleware: [offset(6), flip({ padding }), shift({ padding })],
      }).then(({ x, y }) => setCoords({ x, y }));
    };

    update();
    return autoUpdate(virtualEl, floatingEl, update);
  }, [left, top, bottom, right, elRef, placement, padding]);

  return coords;
}
