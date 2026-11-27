import {
  cloneDefaultAppearancePreferences,
  cloneDefaultUserPreferences,
  isAccentPreset,
  isMotionProfile,
  isShellStyle,
  isSurfaceTheme,
  isThemePreference,
  isTypesetPreset,
  mergeUserPreferences,
  parseUserPreferences,
  resolveEffectiveSurfaceTheme,
  resolveEffectiveTheme,
  resolveToggledSurfaceTheme,
  type AccentPreset,
  type MotionProfile,
  type PreferredDarkSurface,
  type PreferredLightSurface,
  type ReaderFontFamilyPref,
  type ReaderMeasurePref,
  type ReaderPaperModePref,
  type ReaderTypographyPrefs,
  type ShellStyle,
  type SurfaceTheme,
  type ThemePreference,
  type TypesetPreset,
  type UserPreferences,
  type UserPreferencesPatch,
  type UserPreferencesRecord,
} from "@inkade/core";
import { inkadeQueryKeys } from "@inkade/sdk";
import { inkadeQueries, useOptionalInkadeSdkContext } from "@inkade/sdk/react";
import { QueryClientContext, useQuery } from "@tanstack/react-query";
import { createElement, useCallback, useContext, useEffect } from "react";
import type React from "react";
import { useDebounceCallback, useEventListener, useMediaQuery } from "usehooks-ts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";

export const USER_PREFERENCES_STORAGE_KEY = "inkade:preferences:v1";

const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

export interface InkadePersistedPreferencesState {
  readonly preferences: UserPreferences;
  readonly updatedAt: string | null;
  readonly themePreference: ThemePreference;
  readonly surfaceTheme: SurfaceTheme;
  readonly preferredLightSurface: PreferredLightSurface;
  readonly preferredDarkSurface: PreferredDarkSurface;
  readonly shellStyle: ShellStyle;
  readonly accentPreset: AccentPreset;
  readonly typesetPreset: TypesetPreset;
  readonly motionProfile: MotionProfile;
  readonly hoverPeek: boolean;
  readonly yjsOfflineEnabled: boolean;
}

export interface InkadePreferencesStoreState extends InkadePersistedPreferencesState {
  readonly isSyncing: boolean;
  readonly pendingServerPatch: UserPreferencesPatch | null;
  readonly updatePreferences: (patch: UserPreferencesPatch) => void;
  readonly resetPreferences: () => void;
  readonly setThemePreference: (
    next: ThemePreference,
    options?: { readonly freezeTransitions?: boolean | undefined },
  ) => "light" | "dark";
  readonly setSurfaceTheme: (
    next: SurfaceTheme,
    options?: { readonly freezeTransitions?: boolean | undefined },
  ) => SurfaceTheme;
  readonly setShellStyle: (next: ShellStyle) => void;
  readonly setAccentPreset: (next: AccentPreset) => void;
  readonly setTypesetPreset: (next: TypesetPreset) => void;
  readonly setMotionProfile: (next: MotionProfile) => void;
  readonly setHoverPeek: (enabled: boolean) => void;
  readonly setYjsOfflineEnabled: (enabled: boolean) => void;
  readonly setPaperMode: (next: ReaderPaperModePref) => void;
  readonly setReaderFont: (next: ReaderFontFamilyPref) => void;
  readonly setReaderMeasure: (next: ReaderMeasurePref) => void;
  readonly setReaderTypography: (patch: Partial<ReaderTypographyPrefs>) => void;
  readonly applyServerRecord: (record: UserPreferencesRecord) => void;
  readonly clearPendingServerPatch: () => void;
  readonly setSyncing: (syncing: boolean) => void;
  readonly resetAllPreferences: () => void;
}

function createInitialPersistedState(): InkadePersistedPreferencesState {
  return {
    preferences: cloneDefaultUserPreferences(),
    updatedAt: null,
    ...cloneDefaultAppearancePreferences(),
  };
}

function getSystemIsDark(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(PREFERS_DARK_QUERY)?.matches);
}

let themeSwapRaf1: number | null = null;
let themeSwapRaf2: number | null = null;

function freezeTransitionsForThemeSwap(root: HTMLElement): void {
  if (!root.classList || typeof root.classList.add !== "function" || typeof root.classList.remove !== "function") {
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

export function syncAppearanceToDocument(
  state?: Pick<
    InkadePersistedPreferencesState,
    | "themePreference"
    | "surfaceTheme"
    | "preferredLightSurface"
    | "preferredDarkSurface"
    | "shellStyle"
    | "accentPreset"
    | "typesetPreset"
    | "motionProfile"
    | "preferences"
  >,
  options?: { readonly freezeTransitions?: boolean | undefined },
): "light" | "dark" {
  const snapshot = state ?? usePreferencesStore.getState();
  const systemIsDark = getSystemIsDark();
  const effective = resolveEffectiveTheme(snapshot.themePreference, systemIsDark);
  const syncedSurface = resolveEffectiveSurfaceTheme(
    snapshot.themePreference,
    snapshot.surfaceTheme,
    {
      preferredLight: snapshot.preferredLightSurface,
      preferredDark: snapshot.preferredDarkSurface,
      systemIsDark,
    },
  );

  if (typeof document !== "undefined" && document.documentElement) {
    const root = document.documentElement;
    if (options?.freezeTransitions) {
      freezeTransitionsForThemeSwap(root);
    }
    root.classList?.toggle?.("dark", effective === "dark");
    if (root.dataset) {
      root.dataset.surface = syncedSurface;
      root.dataset.accent = snapshot.accentPreset;
      root.dataset.shell = snapshot.shellStyle;
      root.dataset.typeset = snapshot.typesetPreset;
      root.dataset.motion = snapshot.motionProfile;
      root.dataset.paper = snapshot.preferences.reader.paper;
      root.dataset.readerFont = snapshot.preferences.reader.fontFamily;
      root.dataset.readerMeasure = snapshot.preferences.reader.measure;
    }
  }

  return effective;
}

function mergePatches(
  current: UserPreferencesPatch | null,
  next: UserPreferencesPatch,
): UserPreferencesPatch {
  if (!current) return next;
  return {
    ...(current.tasks || next.tasks ? { tasks: { ...current.tasks, ...next.tasks } } : {}),
    ...(current.daily || next.daily ? { daily: { ...current.daily, ...next.daily } } : {}),
    ...(current.library || next.library
      ? {
          library: {
            ...current.library,
            ...next.library,
            ...(current.library?.displayOptions || next.library?.displayOptions
              ? {
                  displayOptions: {
                    ...current.library?.displayOptions,
                    ...next.library?.displayOptions,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(current.threads || next.threads
      ? { threads: { ...current.threads, ...next.threads } }
      : {}),
    ...(current.inbox || next.inbox ? { inbox: { ...current.inbox, ...next.inbox } } : {}),
    ...(current.layout || next.layout ? { layout: { ...current.layout, ...next.layout } } : {}),
    ...(current.reader || next.reader ? { reader: { ...current.reader, ...next.reader } } : {}),
  };
}

function createDynamicWindowStorage(): {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
} {
  return {
    getItem: (name: string) => {
      if (typeof window === "undefined") return null;
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: string) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(name, value);
      } catch {
        // Ignore storage quota or sandbox errors
      }
    },
    removeItem: (name: string) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(name);
      } catch {
        // Ignore storage errors
      }
    },
  };
}

export const usePreferencesStore = create<InkadePreferencesStoreState>()(
  persist(
    (set, get) => ({
      ...createInitialPersistedState(),
      isSyncing: false,
      pendingServerPatch: null,

      updatePreferences: (patch) => {
        set((state) => {
          const nextPreferences = mergeUserPreferences(state.preferences, patch);
          const nextState: InkadePreferencesStoreState = {
            ...state,
            preferences: nextPreferences,
            updatedAt: new Date().toISOString(),
            pendingServerPatch: mergePatches(state.pendingServerPatch, patch),
          };
          syncAppearanceToDocument(nextState);
          return nextState;
        });
      },

      resetPreferences: () => {
        get().updatePreferences(cloneDefaultUserPreferences());
      },

      setThemePreference: (next, options) => {
        let effective: "light" | "dark" = "light";
        set((state) => {
          const systemIsDark = getSystemIsDark();
          const syncedSurface = resolveEffectiveSurfaceTheme(next, state.surfaceTheme, {
            preferredLight: state.preferredLightSurface,
            preferredDark: state.preferredDarkSurface,
            systemIsDark,
          });
          const nextState: InkadePreferencesStoreState = {
            ...state,
            themePreference: next,
            surfaceTheme: syncedSurface,
          };
          effective = syncAppearanceToDocument(nextState, {
            freezeTransitions: options?.freezeTransitions ?? true,
          });
          return nextState;
        });
        return effective;
      },

      setSurfaceTheme: (next, options) => {
        set((state) => {
          const isDark = next === "dark" || next === "dark-dimmed";
          const nextState: InkadePreferencesStoreState = {
            ...state,
            surfaceTheme: next,
            themePreference: isDark ? "dark" : "light",
            preferredLightSurface: isDark ? state.preferredLightSurface : next,
            preferredDarkSurface: isDark ? next : state.preferredDarkSurface,
          };
          syncAppearanceToDocument(nextState, {
            freezeTransitions: options?.freezeTransitions ?? true,
          });
          return nextState;
        });
        return next;
      },

      setShellStyle: (next) => {
        set((state) => {
          const nextState: InkadePreferencesStoreState = {
            ...state,
            shellStyle: next,
          };
          syncAppearanceToDocument(nextState);
          return nextState;
        });
      },

      setAccentPreset: (next) => {
        set((state) => {
          const nextState: InkadePreferencesStoreState = {
            ...state,
            accentPreset: next,
          };
          syncAppearanceToDocument(nextState);
          return nextState;
        });
      },

      setTypesetPreset: (next) => {
        set((state) => {
          const nextState: InkadePreferencesStoreState = {
            ...state,
            typesetPreset: next,
          };
          syncAppearanceToDocument(nextState);
          return nextState;
        });
      },

      setMotionProfile: (next) => {
        set((state) => {
          const nextState: InkadePreferencesStoreState = {
            ...state,
            motionProfile: next,
          };
          syncAppearanceToDocument(nextState);
          return nextState;
        });
      },

      setHoverPeek: (enabled) => {
        set({ hoverPeek: enabled });
      },

      setYjsOfflineEnabled: (enabled) => {
        set({ yjsOfflineEnabled: enabled });
      },

      setPaperMode: (next) => {
        get().updatePreferences({ reader: { paper: next } });
      },

      setReaderFont: (next) => {
        get().updatePreferences({ reader: { fontFamily: next } });
      },

      setReaderMeasure: (next) => {
        get().updatePreferences({ reader: { measure: next } });
      },

      setReaderTypography: (patch) => {
        get().updatePreferences({ reader: patch });
      },

      applyServerRecord: (record) => {
        set((state) => {
          const nextState: InkadePreferencesStoreState = {
            ...state,
            preferences: record.preferences,
            updatedAt: record.updatedAt,
          };
          syncAppearanceToDocument(nextState);
          return nextState;
        });
      },

      clearPendingServerPatch: () => {
        set({ pendingServerPatch: null });
      },

      setSyncing: (syncing) => {
        set({ isSyncing: syncing });
      },

      resetAllPreferences: () => {
        const nextState = {
          ...createInitialPersistedState(),
          isSyncing: false,
          pendingServerPatch: null,
        };
        set(nextState);
        syncAppearanceToDocument(nextState);
      },
    }),
    {
      name: USER_PREFERENCES_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(createDynamicWindowStorage),
      partialize: (state): InkadePersistedPreferencesState => ({
        preferences: state.preferences,
        updatedAt: state.updatedAt,
        themePreference: state.themePreference,
        surfaceTheme: state.surfaceTheme,
        preferredLightSurface: state.preferredLightSurface,
        preferredDarkSurface: state.preferredDarkSurface,
        shellStyle: state.shellStyle,
        accentPreset: state.accentPreset,
        typesetPreset: state.typesetPreset,
        motionProfile: state.motionProfile,
        hoverPeek: state.hoverPeek,
        yjsOfflineEnabled: state.yjsOfflineEnabled,
      }),
      merge: (persistedState, currentState) => {
        if (!persistedState || typeof persistedState !== "object") {
          return currentState;
        }
        const raw = persistedState as Partial<InkadePersistedPreferencesState>;
        const preferredLightSurface =
          raw.preferredLightSurface === "light" || raw.preferredLightSurface === "light-dimmed"
            ? raw.preferredLightSurface
            : currentState.preferredLightSurface;
        const preferredDarkSurface =
          raw.preferredDarkSurface === "dark" || raw.preferredDarkSurface === "dark-dimmed"
            ? raw.preferredDarkSurface
            : currentState.preferredDarkSurface;

        return {
          ...currentState,
          preferences:
            raw.preferences !== undefined
              ? parseUserPreferences(raw.preferences)
              : currentState.preferences,
          updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
          themePreference: isThemePreference(raw.themePreference)
            ? raw.themePreference
            : currentState.themePreference,
          surfaceTheme: isSurfaceTheme(raw.surfaceTheme)
            ? raw.surfaceTheme
            : currentState.surfaceTheme,
          preferredLightSurface,
          preferredDarkSurface,
          shellStyle: isShellStyle(raw.shellStyle) ? raw.shellStyle : currentState.shellStyle,
          accentPreset: isAccentPreset(raw.accentPreset)
            ? raw.accentPreset
            : currentState.accentPreset,
          typesetPreset: isTypesetPreset(raw.typesetPreset)
            ? raw.typesetPreset
            : currentState.typesetPreset,
          motionProfile: isMotionProfile(raw.motionProfile)
            ? raw.motionProfile
            : currentState.motionProfile,
          hoverPeek: typeof raw.hoverPeek === "boolean" ? raw.hoverPeek : currentState.hoverPeek,
          yjsOfflineEnabled:
            typeof raw.yjsOfflineEnabled === "boolean"
              ? raw.yjsOfflineEnabled
              : currentState.yjsOfflineEnabled,
        };
      },
      onRehydrateStorage: () => (rehydratedState) => {
        if (rehydratedState) {
          syncAppearanceToDocument(rehydratedState);
        }
      },
    },
  ),
);

function PreferencesServerSyncWorker(): null {
  const sdkCtx = useOptionalInkadeSdkContext();
  const queryClient = useContext(QueryClientContext);
  const updatedAt = usePreferencesStore((s) => s.updatedAt);
  const pendingServerPatch = usePreferencesStore((s) => s.pendingServerPatch);
  const applyServerRecord = usePreferencesStore((s) => s.applyServerRecord);
  const setSyncing = usePreferencesStore((s) => s.setSyncing);

  const prefsQuery = useQuery({
    ...(sdkCtx
      ? inkadeQueries.preferences(sdkCtx.client)
      : {
          queryKey: inkadeQueryKeys.preferences(),
          queryFn: () => Promise.reject(new Error("Missing SDK context")),
        }),
    enabled: Boolean(sdkCtx),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    setSyncing(prefsQuery.isFetching);
  }, [prefsQuery.isFetching, setSyncing]);

  useEffect(() => {
    const serverRecord = prefsQuery.data;
    if (!serverRecord?.updatedAt) return;
    if (usePreferencesStore.getState().pendingServerPatch) return;

    const serverMs = Date.parse(serverRecord.updatedAt);
    const localMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
    if (!Number.isFinite(serverMs)) return;

    if (!Number.isFinite(localMs) || serverMs > localMs) {
      applyServerRecord(serverRecord);
    }
  }, [applyServerRecord, prefsQuery.data, updatedAt]);

  const flushPendingPatch = useCallback(async () => {
    const patch = usePreferencesStore.getState().pendingServerPatch;
    if (!patch || !sdkCtx) return;
    usePreferencesStore.getState().clearPendingServerPatch();

    try {
      setSyncing(true);
      const saved = await sdkCtx.client.preferences.update(patch);
      queryClient?.setQueryData(inkadeQueryKeys.preferences(), saved);
      if (!usePreferencesStore.getState().pendingServerPatch && saved.updatedAt) {
        applyServerRecord(saved);
      }
    } catch {
      // Preserve optimistic local state on offline or restricted token
    } finally {
      setSyncing(false);
    }
  }, [applyServerRecord, queryClient, sdkCtx, setSyncing]);

  const triggerFlushPendingPatch = useCallback(() => {
    void flushPendingPatch();
  }, [flushPendingPatch]);

  const debouncedFlush = useDebounceCallback(triggerFlushPendingPatch, 500);

  useEffect(() => {
    if (!pendingServerPatch || !sdkCtx) return;
    debouncedFlush();
  }, [debouncedFlush, pendingServerPatch, sdkCtx]);

  const handlePageHide = useCallback(() => {
    if (usePreferencesStore.getState().pendingServerPatch && sdkCtx) {
      debouncedFlush.cancel();
      void flushPendingPatch();
    }
  }, [debouncedFlush, flushPendingPatch, sdkCtx]);

  useEventListener("pagehide", handlePageHide);

  return null;
}

/**
 * Mounts once at workspace root (`InkadeViewsProvider`) to keep `"inkade:preferences:v1"`
 * synchronized with OS color scheme, cross-tab storage edits, and server user preferences.
 */
export function PreferencesServerSyncBridge(): React.ReactElement | null {
  const sdkCtx = useOptionalInkadeSdkContext();
  const queryClient = useContext(QueryClientContext);
  const canUseServerSync = Boolean(sdkCtx && queryClient);
  const themePreference = usePreferencesStore((s) => s.themePreference);
  const systemIsDark = useMediaQuery(PREFERS_DARK_QUERY);

  useEffect(() => {
    syncAppearanceToDocument();
  }, [systemIsDark, themePreference]);

  const handleStorageEvent = useCallback((event: StorageEvent) => {
    if (event.key === null || event.key === USER_PREFERENCES_STORAGE_KEY) {
      void usePreferencesStore.persist.rehydrate();
    }
  }, []);

  useEventListener("storage", handleStorageEvent);

  return canUseServerSync ? createElement(PreferencesServerSyncWorker) : null;
}

export function useUserPreferences(): {
  readonly preferences: UserPreferences;
  readonly updatedAt: string | null;
  readonly isSyncing: boolean;
  readonly updatePreferences: (patch: UserPreferencesPatch) => void;
  readonly resetPreferences: () => void;
} {
  return usePreferencesStore(
    useShallow((s) => ({
      preferences: s.preferences,
      updatedAt: s.updatedAt,
      isSyncing: s.isSyncing,
      updatePreferences: s.updatePreferences,
      resetPreferences: s.resetPreferences,
    })),
  );
}

export function useThemePreference(): {
  readonly preference: ThemePreference;
  readonly effectiveTheme: "light" | "dark";
  readonly setPreference: (next: ThemePreference) => void;
  readonly toggleLightDark: () => void;
} {
  const systemIsDark = useMediaQuery(PREFERS_DARK_QUERY);
  const { preference, setPreference } = usePreferencesStore(
    useShallow((s) => ({
      preference: s.themePreference,
      setPreference: s.setThemePreference,
    })),
  );
  const effectiveTheme = resolveEffectiveTheme(preference, systemIsDark);
  const toggleLightDark = useCallback(() => {
    setPreference(effectiveTheme === "dark" ? "light" : "dark");
  }, [effectiveTheme, setPreference]);

  return {
    preference,
    effectiveTheme,
    setPreference,
    toggleLightDark,
  };
}

export function useSurfaceTheme(): {
  readonly surfaceTheme: SurfaceTheme;
  readonly toggledSurfaceTheme: SurfaceTheme;
  readonly setSurfaceTheme: (next: SurfaceTheme) => void;
} {
  const systemIsDark = useMediaQuery(PREFERS_DARK_QUERY);
  const {
    themePreference,
    storedSurface,
    preferredLight,
    preferredDark,
    setSurfaceTheme,
  } = usePreferencesStore(
    useShallow((s) => ({
      themePreference: s.themePreference,
      storedSurface: s.surfaceTheme,
      preferredLight: s.preferredLightSurface,
      preferredDark: s.preferredDarkSurface,
      setSurfaceTheme: s.setSurfaceTheme,
    })),
  );

  const surfaceTheme = resolveEffectiveSurfaceTheme(themePreference, storedSurface, {
    preferredLight,
    preferredDark,
    systemIsDark,
  });

  const toggledSurfaceTheme = resolveToggledSurfaceTheme(surfaceTheme, {
    preferredLight,
    preferredDark,
  });

  return {
    surfaceTheme,
    toggledSurfaceTheme,
    setSurfaceTheme,
  };
}

export function useShellStyle(): {
  readonly shellStyle: ShellStyle;
  readonly setShellStyle: (next: ShellStyle) => void;
} {
  return usePreferencesStore(
    useShallow((s) => ({
      shellStyle: s.shellStyle,
      setShellStyle: s.setShellStyle,
    })),
  );
}

export function useAccentPreset(): {
  readonly accent: AccentPreset;
  readonly setAccent: (next: AccentPreset) => void;
} {
  return usePreferencesStore(
    useShallow((s) => ({
      accent: s.accentPreset,
      setAccent: s.setAccentPreset,
    })),
  );
}

export function useHoverPeekPreference(): {
  readonly hoverPeek: boolean;
  readonly setHoverPeek: (enabled: boolean) => void;
} {
  return usePreferencesStore(
    useShallow((s) => ({
      hoverPeek: s.hoverPeek,
      setHoverPeek: s.setHoverPeek,
    })),
  );
}

export function useTypesetPreset(): {
  readonly typesetPreset: TypesetPreset;
  readonly setTypesetPreset: (next: TypesetPreset) => void;
} {
  return usePreferencesStore(
    useShallow((s) => ({
      typesetPreset: s.typesetPreset,
      setTypesetPreset: s.setTypesetPreset,
    })),
  );
}

export function useMotionProfile(): {
  readonly motionProfile: MotionProfile;
  readonly setMotionProfile: (next: MotionProfile) => void;
} {
  return usePreferencesStore(
    useShallow((s) => ({
      motionProfile: s.motionProfile,
      setMotionProfile: s.setMotionProfile,
    })),
  );
}

export function usePaperMode(): {
  readonly paperMode: ReaderPaperModePref;
  readonly paper: ReaderPaperModePref;
  readonly setPaperMode: (next: ReaderPaperModePref) => void;
  readonly setPaper: (next: ReaderPaperModePref) => void;
  readonly togglePaperMode: () => void;
} {
  const { paperMode, setPaperMode } = usePreferencesStore(
    useShallow((s) => ({
      paperMode: s.preferences.reader.paper,
      setPaperMode: s.setPaperMode,
    })),
  );
  const togglePaperMode = useCallback(() => {
    setPaperMode(paperMode === "sepia" ? "default" : "sepia");
  }, [paperMode, setPaperMode]);

  return {
    paperMode,
    paper: paperMode,
    setPaperMode,
    setPaper: setPaperMode,
    togglePaperMode,
  };
}

export function useReaderFont(): {
  readonly readerFont: ReaderFontFamilyPref;
  readonly setReaderFont: (next: ReaderFontFamilyPref) => void;
} {
  return usePreferencesStore(
    useShallow((s) => ({
      readerFont: s.preferences.reader.fontFamily,
      setReaderFont: s.setReaderFont,
    })),
  );
}

export function useReaderMeasure(): {
  readonly readerMeasure: ReaderMeasurePref;
  readonly setReaderMeasure: (next: ReaderMeasurePref) => void;
} {
  return usePreferencesStore(
    useShallow((s) => ({
      readerMeasure: s.preferences.reader.measure,
      setReaderMeasure: s.setReaderMeasure,
    })),
  );
}

export function useReaderTypography(): {
  readonly typography: ReaderTypographyPrefs;
  readonly setTypography: (patch: Partial<ReaderTypographyPrefs>) => void;
} {
  return usePreferencesStore(
    useShallow((s) => ({
      typography: s.preferences.reader,
      setTypography: s.setReaderTypography,
    })),
  );
}

export function useYjsOfflineEnabled(): {
  readonly yjsOfflineEnabled: boolean;
  readonly setYjsOfflineEnabled: (enabled: boolean) => void;
} {
  return usePreferencesStore(
    useShallow((s) => ({
      yjsOfflineEnabled: s.yjsOfflineEnabled,
      setYjsOfflineEnabled: s.setYjsOfflineEnabled,
    })),
  );
}

/**
 * Resolves the effective `"light" | "dark"` color scheme from an explicit host override
 * or the unified Zustand preferences store + OS media query.
 */
export function useResolvedColorScheme(explicitTheme?: "light" | "dark"): "light" | "dark" {
  const { effectiveTheme } = useThemePreference();
  return explicitTheme ?? effectiveTheme;
}
