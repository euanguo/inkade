import { useEffect, useState } from "react";

export type ResolvedUiTheme = "light" | "dark";

/**
 * Resolves the active UI color scheme from an explicit prop override or the
 * document root `.dark` class, observing theme mutations automatically.
 */
export function useResolvedTheme(explicitTheme?: ResolvedUiTheme): ResolvedUiTheme {
  const [domDarkScheme, setDomDarkScheme] = useState<boolean>(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );

  useEffect(() => {
    if (explicitTheme || typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const syncDomTheme = (): void => {
      setDomDarkScheme(document.documentElement.classList.contains("dark"));
    };
    syncDomTheme();
    const observer = new MutationObserver(syncDomTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-surface"],
    });
    return () => observer.disconnect();
  }, [explicitTheme]);

  return explicitTheme ?? (domDarkScheme ? "dark" : "light");
}
