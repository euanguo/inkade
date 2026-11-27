import type { DocumentId, DocumentKind } from "@inkade/core";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export const WORKSPACE_TABS_STORAGE_KEY = "inkade:workspace-tabs";
export const MAX_CLOSED_TABS = 20;
export const DEFAULT_SPLIT_PRIMARY_RATIO = 62;
export const MIN_SPLIT_PRIMARY_RATIO = 30;
export const MAX_SPLIT_PRIMARY_RATIO = 75;

export type WorkspaceTabRouteKind =
  | "daily"
  | "tasks"
  | "inbox"
  | "doc"
  | "library"
  | "threads"
  | "ask"
  | "graph"
  | "connect-ai"
  | "settings"
  | "other";

export interface WorkspaceTabItem {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly routeKind: WorkspaceTabRouteKind;
  readonly docId?: DocumentId | undefined;
  readonly kind?: DocumentKind | undefined;
}

export type WorkspaceTabInput = Omit<WorkspaceTabItem, "id">;

export type SplitPaneMode = "doc" | "daily";

export interface WorkspaceTabsState {
  readonly tabs: readonly WorkspaceTabItem[];
  readonly activeTabId: string | null;
  readonly closedTabs: readonly WorkspaceTabItem[];

  readonly splitOpen: boolean;
  readonly splitMode: SplitPaneMode;
  readonly splitDocId: DocumentId | null;
  readonly splitPrimaryRatio: number;

  readonly syncRouteToActiveTab: (input: WorkspaceTabInput) => void;
  readonly openTab: (
    input: WorkspaceTabInput,
    options?: { readonly inNewTab?: boolean | undefined },
  ) => WorkspaceTabItem;
  readonly activateTab: (tabId: string) => WorkspaceTabItem | null;
  readonly switchToTabIndex: (zeroBasedIndex: number) => WorkspaceTabItem | null;
  readonly closeTab: (tabId?: string) => WorkspaceTabItem | null;
  readonly closeOtherTabs: (keepTabId: string) => WorkspaceTabItem | null;
  readonly reopenLastClosedTab: () => WorkspaceTabItem | null;
  readonly updateTabTitle: (
    matcher: { readonly path?: string | undefined; readonly docId?: DocumentId | undefined },
    title: string,
    kind?: DocumentKind,
  ) => void;

  readonly openSplitDoc: (docId: DocumentId) => void;
  readonly openSplitDaily: () => void;
  readonly setSplitMode: (mode: SplitPaneMode | "closed") => void;
  readonly setSplitDocId: (docId: DocumentId | null) => void;
  readonly setSplitPrimaryRatio: (ratio: number) => void;
  readonly closeSplit: () => void;
  readonly resetAll: () => void;
}

const memoryFallbackStorage = new Map<string, string>();

const safeStateStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window !== "undefined") {
      try {
        return window.localStorage.getItem(name);
      } catch {
        // Fallback below when storage access is denied.
      }
    }
    return memoryFallbackStorage.get(name) ?? null;
  },
  setItem: (name, value) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(name, value);
        return;
      } catch {
        // Fallback below when storage access is denied.
      }
    }
    memoryFallbackStorage.set(name, value);
  },
  removeItem: (name) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(name);
        return;
      } catch {
        // Fallback below.
      }
    }
    memoryFallbackStorage.delete(name);
  },
};

function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SPLIT_PRIMARY_RATIO;
  return Math.max(MIN_SPLIT_PRIMARY_RATIO, Math.min(MAX_SPLIT_PRIMARY_RATIO, Math.round(value)));
}

let tabCounter = 0;

function createTabId(): string {
  tabCounter += 1;
  return `tab_${Date.now().toString(36)}_${tabCounter.toString(36)}`;
}

export function shouldShowWorkspaceTabStrip(
  enableWorkspaceTabs: boolean,
  tabCount: number,
): boolean {
  return enableWorkspaceTabs && tabCount > 1;
}

export const useWorkspaceTabsStore = create<WorkspaceTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      closedTabs: [],
      splitOpen: false,
      splitMode: "doc",
      splitDocId: null,
      splitPrimaryRatio: DEFAULT_SPLIT_PRIMARY_RATIO,

      syncRouteToActiveTab: (input) => {
        const state = get();
        const inputBasePath = input.path.split("?")[0] ?? input.path;
        const existingIndex = state.tabs.findIndex(
          (t) =>
            t.path === input.path ||
            (input.routeKind === "doc" && input.docId && t.docId === input.docId) ||
            (input.routeKind !== "doc" &&
              input.routeKind !== "other" &&
              (t.path.split("?")[0] ?? t.path) === inputBasePath),
        );
        if (existingIndex >= 0) {
          const existing = state.tabs[existingIndex]!;
          const nextTitle =
            input.title.trim().length > 0 ? input.title : existing.title;
          const nextTab: WorkspaceTabItem = {
            ...existing,
            path: input.path,
            title: nextTitle,
            routeKind: input.routeKind,
            docId: input.docId ?? existing.docId,
            kind: input.kind ?? existing.kind,
          };
          const unchanged =
            state.activeTabId === existing.id &&
            nextTab.path === existing.path &&
            nextTab.title === existing.title &&
            nextTab.routeKind === existing.routeKind &&
            nextTab.docId === existing.docId &&
            nextTab.kind === existing.kind;
          if (unchanged) return;

          const nextTabs = [...state.tabs];
          nextTabs[existingIndex] = nextTab;
          set({ tabs: nextTabs, activeTabId: existing.id });
          return;
        }

        if (state.tabs.length === 0 || !state.activeTabId) {
          const firstTab: WorkspaceTabItem = { id: createTabId(), ...input };
          set({ tabs: [firstTab], activeTabId: firstTab.id });
          return;
        }

        const activeIndex = state.tabs.findIndex((t) => t.id === state.activeTabId);
        if (activeIndex < 0) {
          const created: WorkspaceTabItem = { id: createTabId(), ...input };
          set({ tabs: [...state.tabs, created], activeTabId: created.id });
          return;
        }

        const current = state.tabs[activeIndex]!;
        const nextTabs = [...state.tabs];
        nextTabs[activeIndex] = {
          id: current.id,
          ...input,
        };
        set({ tabs: nextTabs });
      },

      openTab: (input, options) => {
        const state = get();
        const existing = state.tabs.find((t) => t.path === input.path);
        if (existing && !options?.inNewTab) {
          const updated: WorkspaceTabItem = {
            ...existing,
            title: input.title.trim().length > 0 ? input.title : existing.title,
            routeKind: input.routeKind,
            docId: input.docId ?? existing.docId,
            kind: input.kind ?? existing.kind,
          };
          set({
            tabs: state.tabs.map((t) => (t.id === existing.id ? updated : t)),
            activeTabId: existing.id,
          });
          return updated;
        }

        if (existing && options?.inNewTab) {
          set({ activeTabId: existing.id });
          return existing;
        }

        const created: WorkspaceTabItem = {
          id: createTabId(),
          ...input,
        };
        set({
          tabs: [...state.tabs, created],
          activeTabId: created.id,
        });
        return created;
      },

      activateTab: (tabId) => {
        const state = get();
        const found = state.tabs.find((t) => t.id === tabId) ?? null;
        if (!found) return null;
        if (state.activeTabId !== found.id) {
          set({ activeTabId: found.id });
        }
        return found;
      },

      switchToTabIndex: (zeroBasedIndex) => {
        const state = get();
        if (state.tabs.length === 0 || zeroBasedIndex < 0) return null;
        const targetIndex =
          zeroBasedIndex === 8 && state.tabs.length < 9
            ? state.tabs.length - 1
            : zeroBasedIndex;
        const found = state.tabs[targetIndex] ?? null;
        if (!found) return null;
        if (state.activeTabId !== found.id) {
          set({ activeTabId: found.id });
        }
        return found;
      },

      closeTab: (tabId) => {
        const state = get();
        const targetId = tabId ?? state.activeTabId;
        if (!targetId) return null;
        const idx = state.tabs.findIndex((t) => t.id === targetId);
        if (idx < 0) return null;

        const removed = state.tabs[idx]!;
        const remaining = state.tabs.filter((t) => t.id !== targetId);
        const nextClosed = [removed, ...state.closedTabs].slice(0, MAX_CLOSED_TABS);

        if (remaining.length === 0) {
          const fallback: WorkspaceTabItem = {
            id: createTabId(),
            path: "/daily",
            title: "Daily",
            routeKind: "daily",
          };
          set({
            tabs: [fallback],
            activeTabId: fallback.id,
            closedTabs: nextClosed,
          });
          return fallback;
        }

        const wasActive = state.activeTabId === targetId;
        const nextActive = wasActive
          ? (remaining[Math.min(idx, remaining.length - 1)] ?? remaining[0]!)
          : (remaining.find((t) => t.id === state.activeTabId) ?? remaining[0]!);

        set({
          tabs: remaining,
          activeTabId: nextActive.id,
          closedTabs: nextClosed,
        });

        return nextActive;
      },

      closeOtherTabs: (keepTabId) => {
        const state = get();
        const kept = state.tabs.find((t) => t.id === keepTabId);
        if (!kept) return null;
        const dropped = state.tabs.filter((t) => t.id !== keepTabId).reverse();
        const nextClosed = [...dropped, ...state.closedTabs].slice(0, MAX_CLOSED_TABS);
        set({
          tabs: [kept],
          activeTabId: kept.id,
          closedTabs: nextClosed,
        });
        return kept;
      },

      reopenLastClosedTab: () => {
        const state = get();
        if (state.closedTabs.length === 0) return null;
        const [top, ...rest] = state.closedTabs;
        if (!top) return null;

        const existing = state.tabs.find((t) => t.path === top.path);
        if (existing) {
          set({
            activeTabId: existing.id,
            closedTabs: rest,
          });
          return existing;
        }

        const restored: WorkspaceTabItem = {
          ...top,
          id: createTabId(),
        };
        set({
          tabs: [...state.tabs, restored],
          activeTabId: restored.id,
          closedTabs: rest,
        });
        return restored;
      },

      updateTabTitle: (matcher, title, kind) => {
        const cleanTitle = title.trim();
        if (!cleanTitle) return;
        const state = get();
        let changed = false;
        const nextTabs = state.tabs.map((tab) => {
          const matchesPath = matcher.path !== undefined && tab.path === matcher.path;
          const matchesDoc = matcher.docId !== undefined && tab.docId === matcher.docId;
          if (!matchesPath && !matchesDoc) return tab;
          if (tab.title === cleanTitle && (kind === undefined || tab.kind === kind)) {
            return tab;
          }
          changed = true;
          return {
            ...tab,
            title: cleanTitle,
            ...(kind !== undefined ? { kind } : {}),
          };
        });
        if (changed) {
          set({ tabs: nextTabs });
        }
      },

      openSplitDoc: (docId) =>
        set({
          splitOpen: true,
          splitMode: "doc",
          splitDocId: docId,
        }),

      openSplitDaily: () =>
        set({
          splitOpen: true,
          splitMode: "daily",
        }),

      setSplitMode: (mode) => {
        if (mode === "closed") {
          set({ splitOpen: false });
          return;
        }
        set({ splitOpen: true, splitMode: mode });
      },

      setSplitDocId: (docId) =>
        set((prev) => ({
          splitDocId: docId,
          splitOpen: docId ? true : prev.splitOpen,
          splitMode: docId ? "doc" : prev.splitMode,
        })),

      setSplitPrimaryRatio: (ratio) =>
        set((prev) => {
          const clamped = clampSplitRatio(ratio);
          return Math.abs(prev.splitPrimaryRatio - clamped) < 0.25
            ? prev
            : { splitPrimaryRatio: clamped };
        }),

      closeSplit: () => set({ splitOpen: false }),

      resetAll: () =>
        set({
          tabs: [],
          activeTabId: null,
          closedTabs: [],
          splitOpen: false,
          splitMode: "doc",
          splitDocId: null,
          splitPrimaryRatio: DEFAULT_SPLIT_PRIMARY_RATIO,
        }),
    }),
    {
      name: WORKSPACE_TABS_STORAGE_KEY,
      storage: createJSONStorage(() => safeStateStorage),
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        closedTabs: state.closedTabs,
        splitOpen: state.splitOpen,
        splitMode: state.splitMode,
        splitDocId: state.splitDocId,
        splitPrimaryRatio: state.splitPrimaryRatio,
      }),
    },
  ),
);
