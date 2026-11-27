import { create } from "zustand";
import {
  DEFAULT_CLIPPER_SETTINGS,
  loadClipperSettings,
  loadOfflineQueueItems,
  saveClipperSettings,
  type ClipperSettings,
} from "../../shared/storage.ts";

export interface ClipperSettingsStoreState {
  readonly settings: ClipperSettings;
  readonly settingsLoaded: boolean;
  readonly offlineCount: number;
  setSettings: (settings: ClipperSettings) => void;
  setSettingsLoaded: (loaded: boolean) => void;
  setOfflineCount: (countOrUpdater: number | ((prev: number) => number)) => void;
  refreshSettings: () => Promise<ClipperSettings>;
  refreshOfflineCount: () => Promise<number>;
  saveSettingsPatch: (patch: Partial<ClipperSettings>) => Promise<ClipperSettings>;
}

export const useClipperSettingsStore = create<ClipperSettingsStoreState>((set) => ({
  settings: DEFAULT_CLIPPER_SETTINGS,
  settingsLoaded: false,
  offlineCount: 0,
  setSettings: (settings) => set({ settings }),
  setSettingsLoaded: (settingsLoaded) => set({ settingsLoaded }),
  setOfflineCount: (countOrUpdater) =>
    set((state) => ({
      offlineCount:
        typeof countOrUpdater === "function"
          ? countOrUpdater(state.offlineCount)
          : countOrUpdater,
    })),
  refreshSettings: async () => {
    const loaded = await loadClipperSettings();
    set({ settings: loaded, settingsLoaded: true });
    return loaded;
  },
  refreshOfflineCount: async () => {
    const items = await loadOfflineQueueItems();
    set({ offlineCount: items.length });
    return items.length;
  },
  saveSettingsPatch: async (patch) => {
    const saved = await saveClipperSettings(patch);
    set({ settings: saved });
    return saved;
  },
}));
