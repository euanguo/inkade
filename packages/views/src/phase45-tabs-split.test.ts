import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { asDocumentId } from "@inkade/core";
import {
  DEFAULT_SPLIT_PRIMARY_RATIO,
  MAX_SPLIT_PRIMARY_RATIO,
  MIN_SPLIT_PRIMARY_RATIO,
  shouldShowWorkspaceTabStrip,
  useWorkspaceTabsStore,
  WORKSPACE_TABS_STORAGE_KEY,
} from "./lib/workspace-tabs-store.ts";

function installMemoryStorage() {
  const storageMap = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
  };

  Object.defineProperty(globalThis, "window", {
    value: { localStorage: mockStorage },
    configurable: true,
    writable: true,
  });

  return storageMap;
}

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

beforeEach(() => {
  installMemoryStorage();
  useWorkspaceTabsStore.getState().resetAll();
});

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("@inkade/views Phase 45 Workspace Tabs & Split View Zustand store", () => {
  test("shouldShowWorkspaceTabStrip auto-hides unless explicitly enabled AND more than 1 tab exists", () => {
    expect(shouldShowWorkspaceTabStrip(false, 0)).toBe(false);
    expect(shouldShowWorkspaceTabStrip(false, 1)).toBe(false);
    expect(shouldShowWorkspaceTabStrip(false, 4)).toBe(false);
    expect(shouldShowWorkspaceTabStrip(true, 0)).toBe(false);
    expect(shouldShowWorkspaceTabStrip(true, 1)).toBe(false);
    expect(shouldShowWorkspaceTabStrip(true, 2)).toBe(true);
    expect(shouldShowWorkspaceTabStrip(true, 5)).toBe(true);
  });

  test("manages multi-tab navigation, Cmd+W close, Cmd+Shift+T reopen, and Cmd+1..9 switching", () => {
    const store = useWorkspaceTabsStore.getState();

    // Initial route sync creates the first tab
    store.syncRouteToActiveTab({
      path: "/daily",
      title: "Daily",
      routeKind: "daily",
    });
    expect(useWorkspaceTabsStore.getState().tabs).toHaveLength(1);

    const docAlphaId = asDocumentId("doc_alpha");
    const docSplitId = asDocumentId("doc_split_123");

    // Explicitly opening new tabs appends & activates them
    const tab2 = store.openTab(
      {
        path: "/docs/doc_alpha",
        title: "Alpha Architecture",
        routeKind: "doc",
        docId: docAlphaId,
        kind: "article",
      },
      { inNewTab: true },
    );
    const tab3 = store.openTab(
      {
        path: "/graph",
        title: "Graph",
        routeKind: "graph",
      },
      { inNewTab: true },
    );

    expect(useWorkspaceTabsStore.getState().tabs).toHaveLength(3);
    expect(useWorkspaceTabsStore.getState().activeTabId).toBe(tab3.id);

    // Cmd+1 switches to first tab; Cmd+9 jumps to last tab when fewer than 9 tabs exist
    const switchedFirst = store.switchToTabIndex(0);
    expect(switchedFirst?.path).toBe("/daily");
    expect(useWorkspaceTabsStore.getState().activeTabId).toBe(switchedFirst?.id ?? null);

    const switchedLast = store.switchToTabIndex(8);
    expect(switchedLast?.id).toBe(tab3.id);

    // Close active tab (Cmd+W) -> pushes to closedTabs and selects adjacent tab
    const nextAfterClose = store.closeTab();
    expect(nextAfterClose?.id).toBe(tab2.id);
    expect(useWorkspaceTabsStore.getState().tabs).toHaveLength(2);
    expect(useWorkspaceTabsStore.getState().closedTabs.map((t) => t.path)).toEqual(["/graph"]);

    // Reopen closed tab (Cmd+Shift+T) -> restores /graph
    const reopened = store.reopenLastClosedTab();
    expect(reopened?.path).toBe("/graph");
    expect(useWorkspaceTabsStore.getState().tabs).toHaveLength(3);
    expect(useWorkspaceTabsStore.getState().closedTabs).toHaveLength(0);

    // Update doc tab title in place
    store.updateTabTitle({ docId: docAlphaId }, "Alpha v2", "outline");
    const renamed = useWorkspaceTabsStore
      .getState()
      .tabs.find((t) => t.path === "/docs/doc_alpha");
    expect(renamed?.title).toBe("Alpha v2");
    expect(renamed?.kind).toBe("outline");
    expect(docSplitId).toBe(asDocumentId("doc_split_123"));
  });

  test("persists Split View document, mode, and clamped ratio across store rehydration", async () => {
    const storageMap = installMemoryStorage();
    useWorkspaceTabsStore.getState().resetAll();

    const docSplitId = asDocumentId("doc_split_123");
    const store = useWorkspaceTabsStore.getState();
    expect(store.splitOpen).toBe(false);
    expect(store.splitPrimaryRatio).toBe(DEFAULT_SPLIT_PRIMARY_RATIO);

    store.openSplitDoc(docSplitId);
    store.setSplitPrimaryRatio(12); // clamps to MIN_SPLIT_PRIMARY_RATIO
    expect(useWorkspaceTabsStore.getState().splitPrimaryRatio).toBe(MIN_SPLIT_PRIMARY_RATIO);

    store.setSplitPrimaryRatio(95); // clamps to MAX_SPLIT_PRIMARY_RATIO
    expect(useWorkspaceTabsStore.getState().splitPrimaryRatio).toBe(MAX_SPLIT_PRIMARY_RATIO);

    store.setSplitPrimaryRatio(58.4);
    expect(useWorkspaceTabsStore.getState().splitPrimaryRatio).toBe(58);
    expect(useWorkspaceTabsStore.getState().splitOpen).toBe(true);
    expect(useWorkspaceTabsStore.getState().splitMode).toBe("doc");
    expect(useWorkspaceTabsStore.getState().splitDocId).toBe(docSplitId);

    const rawPersisted = storageMap.get(WORKSPACE_TABS_STORAGE_KEY);
    expect(rawPersisted).toBeDefined();

    // Reset in-memory state, restore persisted snapshot into storage, then rehydrate
    useWorkspaceTabsStore.getState().resetAll();
    expect(useWorkspaceTabsStore.getState().splitOpen).toBe(false);
    storageMap.set(WORKSPACE_TABS_STORAGE_KEY, rawPersisted!);
    await useWorkspaceTabsStore.persist.rehydrate();

    const rehydrated = useWorkspaceTabsStore.getState();
    expect(rehydrated.splitOpen).toBe(true);
    expect(rehydrated.splitMode).toBe("doc");
    expect(rehydrated.splitDocId).toBe(docSplitId);
    expect(rehydrated.splitPrimaryRatio).toBe(58);

    // Switch to daily mode then close
    rehydrated.openSplitDaily();
    expect(useWorkspaceTabsStore.getState().splitMode).toBe("daily");
    rehydrated.setSplitMode("closed");
    expect(useWorkspaceTabsStore.getState().splitOpen).toBe(false);
  });
});
