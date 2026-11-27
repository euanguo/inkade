import type { ClipperAccentPreset, ClipperSurfaceTheme } from "../shared/storage.ts";

export interface ClipperThemePreferences {
  readonly surfaceTheme?: ClipperSurfaceTheme | undefined;
  readonly accentPreset?: ClipperAccentPreset | undefined;
}

// Synchronize `@inkade/ui` V4.0–V4.6 4-tier surface themes, accent presets,
// and OS color-scheme / reduced-motion preferences with zero-flicker atomic swaps.
export function syncClipperSystemTheme(preferences?: ClipperThemePreferences): () => void {
  const root = document.documentElement;
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const applyTheme = (useSwitchingGuard: boolean): void => {
    const surfacePref = preferences?.surfaceTheme ?? "system";
    const resolvedSurface =
      surfacePref === "system" ? (darkQuery.matches ? "dark" : "light") : surfacePref;
    const isDark = resolvedSurface === "dark" || resolvedSurface === "dark-dimmed";
    const resolvedAccent = preferences?.accentPreset ?? "mono";

    if (useSwitchingGuard) {
      root.classList.add("inkade-theme-switching");
    }

    root.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
    root.dataset.surface = resolvedSurface;
    root.dataset.accent = resolvedAccent;
    root.dataset.shell = "inset";
    root.dataset.typeset = "standard";
    root.dataset.motion = reducedMotionQuery.matches ? "reduced-pulse" : "comfort";

    if (useSwitchingGuard && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          root.classList.remove("inkade-theme-switching");
        });
      });
    } else if (useSwitchingGuard) {
      root.classList.remove("inkade-theme-switching");
    }
  };

  applyTheme(Boolean(root.dataset.surface));

  const onChange = (): void => {
    applyTheme(true);
  };

  darkQuery.addEventListener("change", onChange);
  reducedMotionQuery.addEventListener("change", onChange);
  return () => {
    darkQuery.removeEventListener("change", onChange);
    reducedMotionQuery.removeEventListener("change", onChange);
  };
}
