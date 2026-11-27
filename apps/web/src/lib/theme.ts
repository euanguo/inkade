import type { MotionProfile } from "@inkade/core";

export interface RippleOrigin {
  readonly clientX: number;
  readonly clientY: number;
}

interface DocumentWithViewTransition {
  startViewTransition?: (callback: () => void) => { readonly ready: Promise<void> };
}

let themeSwapRaf1: number | null = null;
let themeSwapRaf2: number | null = null;

/**
 * Temporarily suppresses CSS transitions during surface theme swaps so background
 * colors switch crisp-to-crisp across panels without mismatched lag.
 */
export function freezeTransitionsForThemeSwap(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (
    !root?.classList ||
    typeof root.classList.add !== "function" ||
    typeof root.classList.remove !== "function"
  ) {
    return;
  }
  root.classList.add("inkade-theme-switching");

  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    if (themeSwapRaf1 !== null) window.cancelAnimationFrame(themeSwapRaf1);
    if (themeSwapRaf2 !== null) window.cancelAnimationFrame(themeSwapRaf2);
    themeSwapRaf1 = window.requestAnimationFrame(() => {
      themeSwapRaf1 = null;
      themeSwapRaf2 = window.requestAnimationFrame(() => {
        themeSwapRaf2 = null;
        root.classList.remove("inkade-theme-switching");
      });
    });
  } else {
    root.classList.remove("inkade-theme-switching");
  }
}

export function isReducedMotionForRipple(motionProfile?: MotionProfile): boolean {
  if (motionProfile === "reduced-pulse") return true;
  if (typeof document !== "undefined" && document.documentElement.dataset?.motion === "reduced-pulse") {
    return true;
  }
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
  );
}

/**
 * Wraps a theme state mutation in a radial ViewTransition ripple anchored at the trigger
 * coordinates, falling back cleanly when reduced motion is active or ViewTransitions are unsupported.
 */
export function runWithThemeRipple(
  applyTheme: () => void,
  origin?: RippleOrigin,
  options?: { readonly motionProfile?: MotionProfile | undefined },
): void {
  if (typeof document === "undefined" || isReducedMotionForRipple(options?.motionProfile)) {
    applyTheme();
    return;
  }

  const docWithVt = document as Document & DocumentWithViewTransition;
  if (typeof docWithVt.startViewTransition !== "function") {
    applyTheme();
    return;
  }

  const viewportWidth =
    typeof window !== "undefined" && Number.isFinite(window.innerWidth) ? window.innerWidth : 1280;
  const viewportHeight =
    typeof window !== "undefined" && Number.isFinite(window.innerHeight) ? window.innerHeight : 800;
  const x = origin && Number.isFinite(origin.clientX) ? origin.clientX : viewportWidth / 2;
  const y = origin && Number.isFinite(origin.clientY) ? origin.clientY : viewportHeight / 2;
  const maxRadius = Math.hypot(Math.max(x, viewportWidth - x), Math.max(y, viewportHeight - y));

  const transition = docWithVt.startViewTransition(() => {
    applyTheme();
  });

  if (transition && typeof document.documentElement?.animate === "function") {
    void transition.ready
      .then(() => {
        try {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${maxRadius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 380,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              pseudoElement: "::view-transition-new(root)",
            },
          );
        } catch {
          // Ignore unsupported pseudoElement animation errors
        }
      })
      .catch(() => {
        // Ignore aborted ViewTransitions
      });
  }
}
