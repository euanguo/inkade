import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_APPEARANCE_PREFERENCES, DEFAULT_USER_PREFERENCES } from "@inkade/core";
import {
  syncAppearanceToDocument,
  usePreferencesStore,
  USER_PREFERENCES_STORAGE_KEY,
} from "./preferences-store.ts";

function installMemoryDom(systemIsDark = false) {
  const store = new Map<string, string>();
  const classes = new Set<string>();
  const dataset: Record<string, string | undefined> = {};

  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };

  const mockWindow = {
    localStorage: mockStorage,
    matchMedia: () => ({
      matches: systemIsDark,
      media: "(prefers-color-scheme: dark)",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => true,
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };

  const mockDocument = {
    documentElement: {
      dataset,
      classList: {
        add: (cls: string) => {
          classes.add(cls);
        },
        remove: (cls: string) => {
          classes.delete(cls);
        },
        toggle: (cls: string, force?: boolean) => {
          if (force === undefined) {
            if (classes.has(cls)) classes.delete(cls);
            else classes.add(cls);
          } else if (force) {
            classes.add(cls);
          } else {
            classes.delete(cls);
          }
          return classes.has(cls);
        },
        contains: (cls: string) => classes.has(cls),
      },
    },
  };

  Object.defineProperty(globalThis, "window", {
    value: mockWindow,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: mockDocument,
    configurable: true,
    writable: true,
  });

  return { store, classes, dataset };
}

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

beforeEach(() => {
  installMemoryDom(false);
  usePreferencesStore.getState().resetAllPreferences();
});

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "document");
  }
});

describe("@inkade/views unified Zustand preferences store", () => {
  test("initializes defaults and persists solely under inkade:preferences:v1 with zero legacy mirrors", () => {
    const { store, dataset } = installMemoryDom(false);
    usePreferencesStore.getState().resetAllPreferences();

    const state = usePreferencesStore.getState();
    expect(state.preferences).toEqual(DEFAULT_USER_PREFERENCES);
    expect(state.shellStyle).toBe(DEFAULT_APPEARANCE_PREFERENCES.shellStyle);
    expect(state.surfaceTheme).toBe(DEFAULT_APPEARANCE_PREFERENCES.surfaceTheme);
    expect(state.accentPreset).toBe(DEFAULT_APPEARANCE_PREFERENCES.accentPreset);
    expect(state.yjsOfflineEnabled).toBe(true);

    state.updatePreferences({
      library: { viewMode: "grid" },
      reader: { measure: "full", paper: "sepia", fontFamily: "serif" },
    });
    state.setShellStyle("flush");
    state.setYjsOfflineEnabled(false);

    const persistedRaw = store.get(USER_PREFERENCES_STORAGE_KEY);
    expect(persistedRaw).toBeDefined();
    expect(Array.from(store.keys())).toEqual([USER_PREFERENCES_STORAGE_KEY]);

    const parsed = JSON.parse(persistedRaw ?? "{}") as {
      readonly state?: {
        readonly preferences?: typeof DEFAULT_USER_PREFERENCES;
        readonly shellStyle?: string;
        readonly yjsOfflineEnabled?: boolean;
      };
    };
    expect(parsed.state?.preferences?.library.viewMode).toBe("grid");
    expect(parsed.state?.preferences?.reader.measure).toBe("full");
    expect(parsed.state?.shellStyle).toBe("flush");
    expect(parsed.state?.yjsOfflineEnabled).toBe(false);

    expect(dataset["shell"]).toBe("flush");
    expect(dataset["paper"]).toBe("sepia");
    expect(dataset["readerFont"]).toBe("serif");
    expect(dataset["readerMeasure"]).toBe("full");
  });

  test("surface theme mutations remember crisp vs dimmed variants and sync dark class", () => {
    const { classes, dataset } = installMemoryDom(false);
    usePreferencesStore.getState().resetAllPreferences();

    usePreferencesStore.getState().setSurfaceTheme("dark-dimmed", { freezeTransitions: false });
    expect(classes.has("dark")).toBe(true);
    expect(dataset["surface"]).toBe("dark-dimmed");
    expect(usePreferencesStore.getState().themePreference).toBe("dark");
    expect(usePreferencesStore.getState().preferredDarkSurface).toBe("dark-dimmed");

    usePreferencesStore.getState().setThemePreference("light", { freezeTransitions: false });
    expect(classes.has("dark")).toBe(false);
    expect(dataset["surface"]).toBe("light");

    usePreferencesStore.getState().setThemePreference("dark", { freezeTransitions: false });
    expect(classes.has("dark")).toBe(true);
    expect(dataset["surface"]).toBe("dark-dimmed");
  });

  test("rehydrates fault-tolerantly from inkade:preferences:v1 on corrupted partial payloads", async () => {
    const { store, dataset } = installMemoryDom(true);
    store.set(
      USER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          preferences: {
            library: { viewMode: "table", sortBy: "invalid-field" },
            reader: { paper: "sepia", measure: "not-a-measure" },
          },
          shellStyle: "flush",
          accentPreset: "broken-accent",
          typesetPreset: "relaxed",
          motionProfile: "reduced-pulse",
        },
      }),
    );

    await usePreferencesStore.persist.rehydrate();
    const state = usePreferencesStore.getState();

    expect(state.preferences.library.viewMode).toBe("table");
    expect(state.preferences.library.sortBy).toBe("updatedAt");
    expect(state.preferences.reader.paper).toBe("sepia");
    expect(state.preferences.reader.measure).toBe("72ch");
    expect(state.shellStyle).toBe("flush");
    expect(state.accentPreset).toBe("mono");
    expect(state.typesetPreset).toBe("relaxed");
    expect(state.motionProfile).toBe("reduced-pulse");

    syncAppearanceToDocument(state);
    expect(dataset["shell"]).toBe("flush");
    expect(dataset["typeset"]).toBe("relaxed");
    expect(dataset["motion"]).toBe("reduced-pulse");
  });
});
