import { setInkadeLocale, useInkadeLocale } from "@inkade/i18n";
import { useEffect } from "react";
import { loadClipperSettings, type ClipperSettings } from "../../shared/storage.ts";
import { getWebExt } from "../../shared/webext.ts";
import { useClipperSettingsStore } from "../stores/settings-store.ts";
import { syncClipperSystemTheme } from "../theme.ts";

/**
 * Keeps theme CSS tokens, extension settings, locale, and offline queue counts
 * synchronized across `chrome.storage.onChanged` in any extension surface.
 */
export function useClipperThemeAndStorageSync(options?: {
  readonly surfaceThemeOverride?: ClipperSettings["surfaceTheme"] | undefined;
  readonly accentPresetOverride?: ClipperSettings["accentPreset"] | undefined;
  readonly onSettingsExternalChange?: ((next: ClipperSettings) => void | Promise<void>) | undefined;
  readonly onOfflineQueueExternalChange?: (() => void | Promise<void>) | undefined;
}): void {
  const settings = useClipperSettingsStore((s) => s.settings);
  const setSettings = useClipperSettingsStore((s) => s.setSettings);
  const refreshOfflineCount = useClipperSettingsStore((s) => s.refreshOfflineCount);
  const { setLocale } = useInkadeLocale();

  const surfaceTheme = options?.surfaceThemeOverride ?? settings.surfaceTheme;
  const accentPreset = options?.accentPresetOverride ?? settings.accentPreset;
  const onSettingsExternalChange = options?.onSettingsExternalChange;
  const onOfflineQueueExternalChange = options?.onOfflineQueueExternalChange;

  useEffect(
    () => syncClipperSystemTheme({ surfaceTheme, accentPreset }),
    [surfaceTheme, accentPreset],
  );

  useEffect(() => {
    const ext = getWebExt();
    if (!ext?.storage?.onChanged) return;
    const onChanged = (changes: Record<string, unknown>, areaName: string) => {
      if (
        (areaName === "sync" || areaName === "local") &&
        ("inkade:clipper:settings" in changes || "inkade:clipper:local-secrets" in changes)
      ) {
        void loadClipperSettings().then((next) => {
          setSettings(next);
          setInkadeLocale(next.locale);
          setLocale(next.locale);
          if (onSettingsExternalChange) {
            void onSettingsExternalChange(next);
          }
        });
      }
      if ("inkade:clipper:offline-queue" in changes) {
        void refreshOfflineCount();
        if (onOfflineQueueExternalChange) {
          void onOfflineQueueExternalChange();
        }
      }
    };
    ext.storage.onChanged.addListener(onChanged);
    return () => ext.storage?.onChanged?.removeListener?.(onChanged);
  }, [
    onOfflineQueueExternalChange,
    onSettingsExternalChange,
    refreshOfflineCount,
    setLocale,
    setSettings,
  ]);
}
