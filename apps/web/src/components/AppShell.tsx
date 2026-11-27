import {
  asDocumentId,
  asHighlightId,
  asOutlineNodeId,
  type DocumentId,
  type DocumentKind,
  type InkadeEventPayloadMap,
  type InkadePlaceChangedPayload,
  type InkadeSaveStateChangedPayload,
  normalizeLegacyInboxTab,
  type Space,
  type SpaceId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  useInkadeDocuments,
  useInkadeRealtimeSync,
  useInkadeSavedViews,
  useInkadeSpaces,
  useInkadeWorkspaceSummary,
} from "@inkade/sdk/react";
import { buildAdeDispatchPrompt } from "@inkade/views/lib/mcp-snippet";
import {
  type InkadeHostActions,
  type InkadeNavigationAdapter,
  type InkadeNotifier,
  InkadeViewsProvider,
  type InkadeViewsEnvironment,
  type NavigationBlockerOptions,
} from "@inkade/views/context";
import {
  useShellStyle,
  useThemePreference,
  useUserPreferences,
} from "@inkade/views/lib/preferences-store";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Button,
  cn,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  INKADE_MEDIA_QUERIES,
  ResizeHandle,
  ScrollArea,
  useResizablePane,
} from "@inkade/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useBlocker, useNavigate, useRouterState } from "@tanstack/react-router";
import "@inkade/ui/katex.css";
import { WifiOffIcon } from "lucide-react";
import type React from "react";
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AskInkadeDrawer } from "./AskInkadeDrawer.tsx";
import {
  useCopyToClipboard,
  useEventListener,
  useLocalStorage,
  useMediaQuery,
} from "usehooks-ts";
import { tinykeys } from "tinykeys";
import { useInspector } from "../hooks/use-inspector.tsx";
import { getApiBaseUrl, getStoredBearerToken } from "../lib/api.ts";
import { getAppBasePath } from "../lib/base-path.ts";
import { useEmbedBridge } from "../lib/embed-bridge.ts";
import { useEmbedConfig } from "../lib/embed-config.ts";
import { isNativeMobileShell, postToNativeShell } from "../lib/mobile-shell.ts";
import { isEditableEventTarget, isImeEvent, isInsideOutlineEditor } from "@inkade/views/lib/shortcuts";
import { useWorkspaceTabsStore } from "@inkade/views/lib/workspace-tabs-store";
import { WorkspaceSplitPane } from "@inkade/views/components/WorkspaceSplitPane";
import { showErrorToast, showSuccessToast, showUndoToast } from "../lib/undo.ts";
import { DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from "../pages/settings/types.ts";
import { resolveSettingsSection } from "../pages/settings/types.ts";
import { CreateDocumentDialog } from "./CreateDocumentDialog.tsx";
import { CreateSpaceDialog } from "./CreateSpaceDialog.tsx";
import {
  DigitalGardenDialog,
  type DigitalGardenPresetSource,
} from "./DigitalGardenDialog.tsx";
import { GlobalCommandPalette } from "./GlobalCommandPalette.tsx";
import { GlobalShortcutsDialog } from "./GlobalShortcutsDialog.tsx";
import { InspectorPanel } from "./InspectorPanel.tsx";
import { QuickCaptureDrawer, type QuickCapturePrefill } from "./QuickCaptureDrawer.tsx";
import { RouteContentFallback } from "./RouteContentFallback.tsx";
import { SavedViewCreateDialog } from "./SavedViewCreateDialog.tsx";
import { SettingsModal } from "./SettingsModal.tsx";
import { MobileNavChrome, TopHeaderBar } from "./TopHeaderBar.tsx";
import { SidebarHoverPeek, type SidebarMode, WorkspaceSidebar } from "./WorkspaceSidebar.tsx";
import { WorkspaceTabStrip } from "./WorkspaceTabStrip.tsx";

const SIDEBAR_COLLAPSED_KEY = "inkade:sidebar:collapsed";

export interface AppActionsContextValue {
  readonly openNewDocumentDialog: (options?: {
    readonly spaceId?: SpaceId | undefined;
    readonly kind?: DocumentKind | undefined;
  }) => void;
  readonly openQuickCapture: (prefill?: QuickCapturePrefill) => void;
  readonly openAskDrawer: () => void;
  readonly openCommandPalette: () => void;
  readonly openSettingsModal: (section?: SettingsSectionId) => void;
  readonly effectiveTheme: "light" | "dark";
  readonly sidebarMode: SidebarMode;
  readonly setSidebarMode: (mode: SidebarMode) => void;
  readonly docSidebarPanel: React.ReactNode | null;
  readonly setDocSidebarPanel: (panel: React.ReactNode | null) => void;
  readonly requestOpenSplitDoc: (docId: DocumentId) => void;
  readonly pendingSplitDocId: DocumentId | null;
  readonly clearPendingSplitDoc: () => void;
}

const AppActionsContext = createContext<AppActionsContextValue | null>(null);

export function useAppActions(): AppActionsContextValue {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error("useAppActions must be used within AppShell");
  return ctx;
}

interface ActiveNavigationBlocker {
  readonly shouldBlock: boolean;
  readonly confirmMessage: string;
  readonly options?: NavigationBlockerOptions | undefined;
}

const EMPTY_NAVIGATION_BLOCKER: ActiveNavigationBlocker = {
  shouldBlock: false,
  confirmMessage: "",
};

const NavBlockerRegistryContext =
  createContext<React.MutableRefObject<ActiveNavigationBlocker> | null>(null);

function useRouterNavigationBlocker(
  shouldBlock: boolean,
  confirmMessage: string,
  options?: NavigationBlockerOptions,
): void {
  const registryRef = useContext(NavBlockerRegistryContext);

  useLayoutEffect(() => {
    if (!registryRef) return;
    registryRef.current = { shouldBlock, confirmMessage, options };
  }, [confirmMessage, options, registryRef, shouldBlock]);

  useEffect(() => {
    return () => {
      if (registryRef) {
        registryRef.current = EMPTY_NAVIGATION_BLOCKER;
      }
    };
  }, [registryRef]);
}

export function AppShell(): React.ReactElement {
  return <AppShellInner />;
}

function AppShellInner(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const navBlockStateRef = useRef<ActiveNavigationBlocker>(EMPTY_NAVIGATION_BLOCKER);
  const bypassNavBlockerRef = useRef(false);
  const [leavingSavePending, setLeavingSavePending] = useState(false);

  const blocker = useBlocker({
    shouldBlockFn: () =>
      navBlockStateRef.current.shouldBlock && !bypassNavBlockerRef.current,
    withResolver: true,
    enableBeforeUnload: false,
  });

  const resetBypassFlagOnNextFrame = useCallback(() => {
    const clear = (): void => {
      bypassNavBlockerRef.current = false;
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(clear);
    } else if (typeof queueMicrotask === "function") {
      queueMicrotask(clear);
    } else {
      setTimeout(clear, 0);
    }
  }, []);

  const handleUnsavedKeepEditing = useCallback(() => {
    if (blocker.status === "blocked") {
      blocker.reset();
    }
  }, [blocker]);

  const handleUnsavedDiscardAndLeave = useCallback(() => {
    if (blocker.status !== "blocked") return;
    navBlockStateRef.current.options?.onDiscardAndLeave?.();
    bypassNavBlockerRef.current = true;
    blocker.proceed();
    resetBypassFlagOnNextFrame();
  }, [blocker, resetBypassFlagOnNextFrame]);

  const handleUnsavedSaveAndLeave = useCallback(() => {
    const saveAndLeave = navBlockStateRef.current.options?.onSaveAndLeave;
    if (!saveAndLeave || blocker.status !== "blocked") return;
    setLeavingSavePending(true);
    void Promise.resolve(saveAndLeave())
      .then((ok) => {
        if (!ok) {
          if (blocker.status === "blocked") {
            blocker.reset();
          }
          return;
        }
        bypassNavBlockerRef.current = true;
        blocker.proceed();
        resetBypassFlagOnNextFrame();
      })
      .finally(() => {
        setLeavingSavePending(false);
      });
  }, [blocker, resetBypassFlagOnNextFrame]);

  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const {
    open: inspectorOpen,
    toggleOpen: toggleInspector,
    setOpen: setInspectorOpen,
    target: inspectorTarget,
    setTarget: setInspectorTarget,
    openWithTab: openInspectorTab,
  } = useInspector();
  const isDesktop = useMediaQuery(INKADE_MEDIA_QUERIES.lg);
  const { effectiveTheme, toggleLightDark, setPreference: setThemePreference } =
    useThemePreference();
  const { shellStyle } = useShellStyle();
  const embedConfig = useEmbedConfig();
  const isSettingsRoute = pathname === "/settings" || pathname.startsWith("/settings/");

  const [, copyToClipboard] = useCopyToClipboard();
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage<boolean>(
    SIDEBAR_COLLAPSED_KEY,
    false,
    {
      serializer: (v) => (v ? "true" : "false"),
      deserializer: (raw) => raw === "true" || raw === "1",
    },
  );
  const [peekOpen, setPeekOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalSection, setSettingsModalSection] =
    useState<SettingsSectionId>(DEFAULT_SETTINGS_SECTION);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCapturePrefill, setQuickCapturePrefill] = useState<QuickCapturePrefill | null>(null);
  const [askDrawerOpen, setAskDrawerOpen] = useState(false);
  const [savedViewDialogOpen, setSavedViewDialogOpen] = useState(false);
  const [gardenDialog, setGardenDialog] = useState<{
    readonly open: boolean;
    readonly presetSource?: DigitalGardenPresetSource | null | undefined;
  }>({ open: false });
  const { preferences: userPrefs, updatePreferences } = useUserPreferences();
  const enableWorkspaceTabs = userPrefs.layout.enableWorkspaceTabs;
  const splitOpen = useWorkspaceTabsStore((s) => s.splitOpen);
  const splitMode = useWorkspaceTabsStore((s) => s.splitMode);
  const splitDocId = useWorkspaceTabsStore((s) => s.splitDocId);
  const splitPrimaryRatio = useWorkspaceTabsStore((s) => s.splitPrimaryRatio);
  const setSplitMode = useWorkspaceTabsStore((s) => s.setSplitMode);
  const setSplitDocId = useWorkspaceTabsStore((s) => s.setSplitDocId);
  const setSplitPrimaryRatio = useWorkspaceTabsStore((s) => s.setSplitPrimaryRatio);
  const closeSplit = useWorkspaceTabsStore((s) => s.closeSplit);
  const sidebarMode: SidebarMode = userPrefs.layout.sidebarMode;
  const setSidebarMode = useCallback(
    (next: SidebarMode) => {
      updatePreferences({ layout: { sidebarMode: next } });
    },
    [updatePreferences],
  );
  const [docSidebarPanel, setDocSidebarPanel] = useState<React.ReactNode | null>(null);
  const [pendingSplitDocId, setPendingSplitDocId] = useState<DocumentId | null>(null);
  const [mainScrolled, setMainScrolled] = useState(false);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);

  const [newDocDialog, setNewDocDialog] = useState<{
    readonly open: boolean;
    readonly spaceId?: SpaceId | undefined;
    readonly kind?: DocumentKind | undefined;
  }>({ open: false });
  const [spaceDialog, setSpaceDialog] = useState<{
    readonly open: boolean;
    readonly editingSpace?: Space | null | undefined;
    readonly defaultParentId?: SpaceId | null | undefined;
  }>({ open: false });

  const sidebarPane = useResizablePane({
    storageKey: "inkade:pane:sidebar",
    defaultWidth: 276,
    minWidth: 220,
    maxWidth: 380,
    side: "left",
  });
  const inspectorPane = useResizablePane({
    storageKey: "inkade:pane:inspector",
    defaultWidth: 340,
    minWidth: 280,
    maxWidth: 480,
    side: "right",
  });

  useEffect(() => {
    setMainScrolled(false);
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
  }, [pathname]);

  const queryClient = useQueryClient();
  const realtimeToken = getStoredBearerToken();
  const shellEventHandlerRef = useRef<
    ((payload: InkadeEventPayloadMap["embed.shell_event"]) => void) | null
  >(null);
  const realtime = useInkadeRealtimeSync(queryClient, {
    enabled: true,
    baseUrl: getAppBasePath(),
    credentials: "include",
    ...(realtimeToken ? { token: realtimeToken } : {}),
    onEvent: (event) => {
      if (event.type === "embed.shell_event") {
        shellEventHandlerRef.current?.(event.payload);
      }
    },
  });
  const spacesQuery = useInkadeSpaces();
  const savedViewsQuery = useInkadeSavedViews();

  const openSettingsModal = useCallback((section?: SettingsSectionId) => {
    if (section) setSettingsModalSection(section);
    setSettingsModalOpen(true);
  }, []);

  useEffect(() => {
    const onOpenSettings = (event: Event) => {
      const custom = event as CustomEvent<{ readonly section?: SettingsSectionId | undefined }>;
      openSettingsModal(custom.detail?.section);
    };
    const onSplitEvent = (event: Event) => {
      const custom = event as CustomEvent<{ readonly documentId?: string | undefined }>;
      if (custom.detail?.documentId && custom.detail.documentId.trim().length > 0) {
        const nextDocId = asDocumentId(custom.detail.documentId);
        if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
          setInspectorOpen(false);
          useWorkspaceTabsStore.getState().openSplitDoc(nextDocId);
        } else {
          setPendingSplitDocId(nextDocId);
        }
      }
    };
    const onOpenGarden = (event: Event) => {
      const custom = event as CustomEvent<DigitalGardenPresetSource | undefined>;
      setGardenDialog({
        open: true,
        presetSource: custom.detail ?? null,
      });
    };
    window.addEventListener("inkade:open-settings-modal", onOpenSettings);
    window.addEventListener("inkade:open-split-doc", onSplitEvent);
    window.addEventListener("inkade:open-garden-dialog", onOpenGarden);
    return () => {
      window.removeEventListener("inkade:open-settings-modal", onOpenSettings);
      window.removeEventListener("inkade:open-split-doc", onSplitEvent);
      window.removeEventListener("inkade:open-garden-dialog", onOpenGarden);
    };
  }, [openSettingsModal, setInspectorOpen]);

  useEffect(() => {
    return tinykeys(window, {
      "$mod+k": (e) => { if (!isImeEvent(e)) { e.preventDefault(); setCommandOpen((p) => !p); } },
      "$mod+.": (e) => {
        if (!isImeEvent(e) && !isInsideOutlineEditor(e.target)) { e.preventDefault(); toggleInspector(); }
      },
      "$mod+Backslash": (e) => {
        if (!isImeEvent(e)) { e.preventDefault(); setSidebarCollapsed(!sidebarCollapsed); }
      },
      "$mod+Comma": (e) => {
        if (!isImeEvent(e)) { e.preventDefault(); if (!isSettingsRoute) setSettingsModalOpen((p) => !p); }
      },
      "g d": (e) => { if (!isImeEvent(e) && !isEditableEventTarget(e.target)) { e.preventDefault(); void navigate({ to: "/daily" }); } },
      "g i": (e) => { if (!isImeEvent(e) && !isEditableEventTarget(e.target)) { e.preventDefault(); void navigate({ to: "/inbox" }); } },
      "g l": (e) => { if (!isImeEvent(e) && !isEditableEventTarget(e.target)) { e.preventDefault(); void navigate({ to: "/library" }); } },
      "g g": (e) => { if (!isImeEvent(e) && !isEditableEventTarget(e.target)) { e.preventDefault(); void navigate({ to: "/graph" }); } },
      "g t": (e) => { if (!isImeEvent(e) && !isEditableEventTarget(e.target)) { e.preventDefault(); void navigate({ to: "/threads" }); } },
      "g k": (e) => { if (!isImeEvent(e) && !isEditableEventTarget(e.target)) { e.preventDefault(); void navigate({ to: "/tasks" }); } },
      "g a": (e) => { if (!isImeEvent(e) && !isEditableEventTarget(e.target)) { e.preventDefault(); void navigate({ to: "/ask" }); } },
      "g c": (e) => { if (!isImeEvent(e) && !isEditableEventTarget(e.target)) { e.preventDefault(); void navigate({ to: "/connect" }); } },
      c: (e) => {
        if (
          embedConfig.hideQuickCapture ||
          embedConfig.hideFab ||
          embedConfig.readonly ||
          isImeEvent(e) ||
          isEditableEventTarget(e.target) ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey
        ) {
          return;
        }
        e.preventDefault();
        setQuickCapturePrefill(null);
        setQuickCaptureOpen(true);
      },
    });
  }, [
    embedConfig.hideFab,
    embedConfig.hideQuickCapture,
    embedConfig.readonly,
    isSettingsRoute,
    navigate,
    setSidebarCollapsed,
    sidebarCollapsed,
    toggleInspector,
  ]);

  const navigateToRawPath = useCallback(
    (targetPath: string) => {
      void navigate({ to: targetPath as never });
    },
    [navigate],
  );

  const onGlobalShortcut = useCallback(
    (e: KeyboardEvent) => {
      if (isImeEvent(e)) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && isDesktop && enableWorkspaceTabs) {
        const keyLower = e.key.toLowerCase();
        if (!e.shiftKey && !e.altKey && keyLower === "w") {
          const store = useWorkspaceTabsStore.getState();
          if (store.tabs.length > 0) {
            e.preventDefault();
            const currentFull = searchStr ? `${pathname}${searchStr}` : pathname;
            const next = store.closeTab();
            if (next && next.path !== currentFull) {
              navigateToRawPath(next.path);
            }
            return;
          }
        }
        if (e.shiftKey && !e.altKey && keyLower === "t") {
          e.preventDefault();
          const restored = useWorkspaceTabsStore.getState().reopenLastClosedTab();
          if (restored) {
            navigateToRawPath(restored.path);
          }
          return;
        }
        if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
          const store = useWorkspaceTabsStore.getState();
          const idx = Number(e.key) - 1;
          if (store.tabs.length > 1) {
            e.preventDefault();
            const target = store.switchToTabIndex(idx);
            if (target) {
              navigateToRawPath(target.path);
            }
            return;
          }
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAskDrawerOpen((prev) => !prev);
        return;
      }
      if (isEditableEventTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      }
    },
    [enableWorkspaceTabs, isDesktop, navigateToRawPath, pathname, searchStr],
  );

  useEventListener("keydown", onGlobalShortcut);

  const openNewDocumentDialog = useCallback(
    (options?: { readonly spaceId?: SpaceId | undefined; readonly kind?: DocumentKind | undefined }) => {
      setNewDocDialog({ open: true, spaceId: options?.spaceId, kind: options?.kind });
    },
    [],
  );
  const handleMobileNavOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setQuickCaptureOpen(false);
        setAskDrawerOpen(false);
        if (!isDesktop) setInspectorOpen(false);
      }
      setMobileNavOpen(next);
    },
    [isDesktop, setInspectorOpen],
  );
  const handleMobileInspectorOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setMobileNavOpen(false);
        setQuickCaptureOpen(false);
        setAskDrawerOpen(false);
      }
      setInspectorOpen(next);
    },
    [setInspectorOpen],
  );
  const handleToggleInspector = useCallback(() => {
    if (!isDesktop && !inspectorOpen) {
      setMobileNavOpen(false);
      setQuickCaptureOpen(false);
      setAskDrawerOpen(false);
    }
    toggleInspector();
  }, [inspectorOpen, isDesktop, toggleInspector]);
  const handleQuickCaptureOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setMobileNavOpen(false);
        setAskDrawerOpen(false);
        if (!isDesktop) setInspectorOpen(false);
      }
      setQuickCaptureOpen(next);
      if (!next) setQuickCapturePrefill(null);
    },
    [isDesktop, setInspectorOpen],
  );
  const handleAskDrawerOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setMobileNavOpen(false);
        setQuickCaptureOpen(false);
        if (!isDesktop) setInspectorOpen(false);
      }
      setAskDrawerOpen(next);
    },
    [isDesktop, setInspectorOpen],
  );
  const openQuickCapture = useCallback(
    (prefill?: QuickCapturePrefill) => {
      if (
        isNativeMobileShell() &&
        postToNativeShell({
          kind: "open_native_capture",
          ...(prefill?.target ? { target: prefill.target } : {}),
          ...(prefill?.text ? { text: prefill.text } : {}),
          ...(prefill?.sourceUrl ? { url: prefill.sourceUrl } : {}),
          ...(prefill?.title ? { title: prefill.title } : {}),
        })
      ) {
        return;
      }
      setMobileNavOpen(false);
      setAskDrawerOpen(false);
      if (!isDesktop) setInspectorOpen(false);
      setQuickCapturePrefill(prefill ?? null);
      setQuickCaptureOpen(true);
    },
    [isDesktop, setInspectorOpen],
  );
  const openAskDrawer = useCallback(() => handleAskDrawerOpenChange(true), [handleAskDrawerOpenChange]);
  const openCommandPalette = useCallback(() => setCommandOpen(true), []);
  const requestOpenSplitDoc = useCallback(
    (docId: DocumentId) => {
      if (isDesktop) {
        setInspectorOpen(false);
        useWorkspaceTabsStore.getState().openSplitDoc(docId);
        return;
      }
      setPendingSplitDocId(docId);
    },
    [isDesktop, setInspectorOpen],
  );
  const clearPendingSplitDoc = useCallback(() => {
    setPendingSplitDocId(null);
  }, []);
  const closeDrawers = useCallback(() => {
    setMobileNavOpen(false);
    setPeekOpen(false);
  }, []);

  const actionsValue = useMemo<AppActionsContextValue>(
    () => ({
      openNewDocumentDialog,
      openQuickCapture,
      openAskDrawer,
      openCommandPalette,
      openSettingsModal,
      effectiveTheme,
      sidebarMode,
      setSidebarMode,
      docSidebarPanel,
      setDocSidebarPanel,
      requestOpenSplitDoc,
      pendingSplitDocId,
      clearPendingSplitDoc,
    }),
    [openNewDocumentDialog, openQuickCapture, openAskDrawer, openCommandPalette, openSettingsModal, effectiveTheme, sidebarMode, setSidebarMode, docSidebarPanel, requestOpenSplitDoc, pendingSplitDocId, clearPendingSplitDoc],
  );

  const renderSidebar = (mode: "desktop" | "peek" | "drawer") => (
    <WorkspaceSidebar
      docSidebarPanel={docSidebarPanel}
      effectiveTheme={effectiveTheme}
      fixedWidth={mode === "desktop" ? sidebarPane.width : undefined}
      isDrawer={mode === "drawer"}
      isPeek={mode === "peek"}
      isSettingsRoute={isSettingsRoute}
      onChangeSidebarMode={setSidebarMode}
      onCloseDrawers={closeDrawers}
      onOpenCommandPalette={() => { closeDrawers(); setCommandOpen(true); }}
      onOpenNewDoc={openNewDocumentDialog}
      onOpenSavedViewDialog={() => setSavedViewDialogOpen(true)}
      onOpenSettingsModal={() => openSettingsModal()}
      onOpenShortcuts={() => setShortcutsOpen(true)}
      onOpenSpaceDialog={(opts) => setSpaceDialog({ open: true, ...opts })}
      onSetSidebarCollapsed={setSidebarCollapsed}
      onToggleTheme={toggleLightDark}
      pathname={pathname}
      realtimeState={realtime.state}
      reconnectAttempt={realtime.reconnectAttempt}
      searchStr={searchStr}
      sidebarMode={sidebarMode}
    />
  );

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const savedViews = savedViewsQuery.data ?? [];

  const hideSidebar = embedConfig.hideSidebar;
  const hideTopbar = embedConfig.hideTopbar;
  const hideInspector = embedConfig.hideInspector;
  const hideMobileNav = embedConfig.hideMobileNav;
  const hideQuickCapture =
    embedConfig.hideQuickCapture || embedConfig.hideFab || embedConfig.readonly;

  const showDesktopSidebar = !isSettingsRoute && !hideSidebar && !sidebarCollapsed;
  const showDesktopInspector = !isSettingsRoute && !hideInspector && inspectorOpen;
  const isInsetDesktop =
    shellStyle === "inset" && !isSettingsRoute && !embedConfig.embed;
  const isPaneManagedRoute =
    pathname === "/library" ||
    pathname === "/inbox" ||
    pathname === "/ask" ||
    pathname === "/graph" ||
    pathname.startsWith("/spaces/") ||
    pathname.startsWith("/docs/");

  useEffect(() => {
    if (embedConfig.themeOverride) {
      setThemePreference(embedConfig.themeOverride);
    }
  }, [embedConfig.themeOverride, setThemePreference]);

  const [reportedSaveState, setReportedSaveState] = useState<InkadeSaveStateChangedPayload>({
    state: "saved",
    leaveLosesWork: false,
  });
  const [reportedPlace, setReportedPlace] = useState<InkadePlaceChangedPayload | null>(null);

  const embedBridge = useEmbedBridge({
    enabled: embedConfig.embed,
    currentPath: pathname,
    onNavigatePath: (nextPath) => {
      void navigate({ to: nextPath as never });
    },
    onGotoAnchor: (anchor) => {
      void navigate({
        to: "/docs/$docId",
        params: { docId: asDocumentId(anchor.documentId) },
        search: {
          ...(anchor.headingSlug ? { heading: anchor.headingSlug } : {}),
          ...(anchor.nodeId ? { nodeId: asOutlineNodeId(anchor.nodeId) } : {}),
          ...(anchor.highlightId ? { highlight: asHighlightId(anchor.highlightId) } : {}),
        },
      });
    },
  });

  const embedSummaryQuery = useInkadeWorkspaceSummary({ enabled: embedConfig.embed });

  const embedDocsQuery = useInkadeDocuments({ limit: 300 }, { enabled: embedConfig.embed });

  const {
    emitRouteChanged,
    emitStatusChanged,
    emitSaveStateChanged,
    emitPlaceChanged,
    handleServerShellEvent,
    canCopyClipboard,
    canOpenExternalUrl,
    canOpenThread,
    canSpawnThread,
    hostInfo,
    requestCopy,
    requestOpenThread,
    requestOpenUrl,
    requestSpawnThread,
  } = embedBridge;
  shellEventHandlerRef.current = handleServerShellEvent;

  useEffect(() => {
    if (!pathname.startsWith("/docs/")) {
      setReportedSaveState({ state: "saved", leaveLosesWork: false });
      setReportedPlace(null);
    }
  }, [pathname]);

  useEffect(() => {
    if (!embedConfig.embed) return;
    const effectiveSaveState: InkadeSaveStateChangedPayload = embedConfig.readonly
      ? { state: "readonly", leaveLosesWork: false }
      : realtime.state === "reconnecting"
        ? { state: "reconnecting", leaveLosesWork: reportedSaveState.leaveLosesWork }
        : reportedSaveState;
    emitSaveStateChanged(effectiveSaveState);
  }, [
    embedConfig.embed,
    embedConfig.readonly,
    emitSaveStateChanged,
    realtime.state,
    reportedSaveState,
  ]);

  useEffect(() => {
    if (!embedConfig.embed || !reportedPlace) return;
    emitPlaceChanged(reportedPlace);
  }, [embedConfig.embed, emitPlaceChanged, reportedPlace]);

  useEffect(() => {
    if (!embedConfig.embed) return;
    const docId = pathname.startsWith("/docs/")
      ? decodeURIComponent(pathname.slice("/docs/".length).split("/")[0] ?? "")
      : undefined;
    const spaceId = pathname.startsWith("/spaces/")
      ? decodeURIComponent(pathname.slice("/spaces/".length).split("/")[0] ?? "")
      : undefined;
    const dailyDate =
      pathname === "/daily"
        ? new Date().toISOString().slice(0, 10)
        : pathname.startsWith("/daily/")
          ? decodeURIComponent(pathname.slice("/daily/".length).split("/")[0] ?? "")
          : undefined;
    emitRouteChanged({
      path: pathname,
      ...(docId ? { documentId: docId } : {}),
      ...(spaceId ? { spaceId } : {}),
      ...(dailyDate ? { dailyDate } : {}),
    });
  }, [emitRouteChanged, embedConfig.embed, pathname]);

  const embedUnreadDocsCount = useMemo(
    () => (embedDocsQuery.data ?? []).filter((d) => d.trashedAt === null && d.unreadAgentUpdate).length,
    [embedDocsQuery.data],
  );
  const embedWaitingCount = embedSummaryQuery.data?.attentionThreadsCount ?? 0;

  useEffect(() => {
    if (!embedConfig.embed) return;
    emitStatusChanged({
      waitingCount: embedWaitingCount,
      unreadDocsCount: embedUnreadDocsCount,
      activeToolCalls: realtime.activeTools.length,
    });
  }, [
    emitStatusChanged,
    embedConfig.embed,
    embedUnreadDocsCount,
    embedWaitingCount,
    realtime.activeTools.length,
  ]);

  const viewsNavigation = useMemo<InkadeNavigationAdapter>(
    () => ({
      openDocument: (documentId, options) => {
        void navigate({
          to: "/docs/$docId",
          params: { docId: documentId },
          ...(options?.nodeId ||
          options?.heading ||
          options?.highlight ||
          options?.page ||
          options?.annotation
            ? {
                search: {
                  ...(options.nodeId ? { nodeId: options.nodeId } : {}),
                  ...(options.heading ? { heading: options.heading } : {}),
                  ...(options.highlight ? { highlight: options.highlight } : {}),
                  ...(options.page ? { page: options.page } : {}),
                  ...(options.annotation ? { annotation: options.annotation } : {}),
                },
              }
            : {}),
        });
      },
      openDaily: (date, options) => {
        if (date) {
          void navigate({
            to: "/daily/$date",
            params: { date },
            search: options?.nodeId ? { nodeId: options.nodeId } : {},
          });
        } else {
          void navigate({ to: "/daily" });
        }
      },
      openSpace: (spaceId) => {
        void navigate({ to: "/spaces/$spaceId", params: { spaceId } });
      },
      openLibrary: (filter) => {
        void navigate({
          to: "/library",
          search: {
            ...(filter?.spaceId ? { spaceId: filter.spaceId } : {}),
            ...(filter?.kind ? { kind: filter.kind } : {}),
            ...(filter?.tag ? { tag: filter.tag } : {}),
            ...(filter?.pinnedOnly ? { pinnedOnly: true } : {}),
            ...(filter?.unreadOnly ? { unreadOnly: true } : {}),
            ...(filter?.viewId ? { viewId: filter.viewId } : {}),
          },
        });
      },
      openThreads: (filter) => {
        if (filter?.conflictMode && typeof window !== "undefined") {
          window.sessionStorage.setItem("inkade:threads:initial-mode", "conflicts");
        }
        void navigate({
          to: "/threads",
          search: filter?.conflictMode ? { mode: "conflicts" } : {},
        });
      },
      openTasks: () => {
        void navigate({ to: "/tasks" });
      },
      openInbox: (options) => {
        const tab = normalizeLegacyInboxTab(options?.tab);
        void navigate({ to: "/inbox", search: tab ? { tab } : {} });
      },
      openTrash: () => {
        void navigate({ to: "/trash" });
      },
      openAsk: () => {
        void navigate({ to: "/ask" });
      },
      openConnect: () => {
        void navigate({ to: "/connect" });
      },
      openSettings: (section) => {
        void navigate({
          to: "/settings/$section",
          params: { section: resolveSettingsSection(section) },
        });
      },
      useNavigationBlocker: useRouterNavigationBlocker,
    }),
    [navigate],
  );

  const viewsHostActions = useMemo<InkadeHostActions>(
    () => ({
      openNewDocument: openNewDocumentDialog,
      openQuickCapture,
      openCreateSpace: (options) =>
        setSpaceDialog({
          open: true,
          ...(options?.defaultParentId !== undefined
            ? { defaultParentId: options.defaultParentId }
            : {}),
        }),
      openEditSpace: (spaceId) => {
        const editingSpace = spaces.find((s) => s.id === spaceId) ?? null;
        setSpaceDialog({ open: true, editingSpace });
      },
      openInspectorTab,
      setInspectorOpen,
      toggleInspector,
      setSidebarMode,
      syncInspectorTarget: setInspectorTarget,
      registerDocSidebarPanel: setDocSidebarPanel,
      requestOpenSplitDoc,
      workspaceSplitManaged: isDesktop && !embedConfig.embed && !isSettingsRoute,
      pendingSplitDocId,
      clearPendingSplitDoc,
      copyText: async (text) => {
        if (embedConfig.embed && canCopyClipboard) {
          return requestCopy(text);
        }
        return copyToClipboard(text);
      },
      openExternalUrl: (url) => {
        if (embedConfig.embed && canOpenExternalUrl) {
          void requestOpenUrl(url);
          return;
        }
        if (typeof window !== "undefined") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      },
      reportSaveState: setReportedSaveState,
      reportPlace: setReportedPlace,
      ...(embedConfig.embed && canSpawnThread
        ? {
            dispatchThread: async (target) => {
              const prompt = buildAdeDispatchPrompt({
                adeKind: hostInfo?.hostId ?? "any",
                documentTitle: target.documentTitle,
                documentId: target.documentId,
                nodeId: target.nodeId,
                excerpt: target.excerpt,
                selectionAnchor: target.selectionAnchor,
              });
              const title =
                target.defaultTitle?.trim() ||
                (target.nodeId || target.selectionAnchor
                  ? target.excerpt.replace(/\s+/g, " ").trim().slice(0, 80)
                  : "") ||
                target.documentTitle;
              await requestSpawnThread({
                documentId: target.documentId,
                documentTitle: target.documentTitle,
                ...(target.nodeId !== undefined ? { nodeId: target.nodeId } : {}),
                ...(target.selectionAnchor !== undefined
                  ? { selectionAnchor: target.selectionAnchor }
                  : {}),
                prompt,
                title,
              });
            },
          }
        : {}),
      ...(embedConfig.embed && canOpenThread
        ? {
            openThread: async (binding) => {
              await requestOpenThread(binding);
            },
          }
        : {}),
    }),
    [
      canCopyClipboard,
      canOpenExternalUrl,
      canOpenThread,
      canSpawnThread,
      clearPendingSplitDoc,
      copyToClipboard,
      embedConfig.embed,
      hostInfo?.hostId,
      isDesktop,
      isSettingsRoute,
      openInspectorTab,
      pendingSplitDocId,
      requestCopy,
      requestOpenThread,
      requestOpenUrl,
      requestSpawnThread,
      openNewDocumentDialog,
      openQuickCapture,
      requestOpenSplitDoc,
      setInspectorOpen,
      setInspectorTarget,
      setSidebarMode,
      spaces,
      toggleInspector,
    ],
  );

  const viewsNotifier = useMemo<InkadeNotifier>(
    () => ({
      success: showSuccessToast,
      error: showErrorToast,
      withUndo: showUndoToast,
    }),
    [],
  );

  const viewsEnvironment = useMemo<InkadeViewsEnvironment>(
    () => ({
      effectiveTheme,
      inspectorOpen: !hideInspector && inspectorOpen,
      readonly: embedConfig.readonly,
      density: embedConfig.density,
      embed: embedConfig.embed,
      hostId: embedBridge.hostInfo?.hostId ?? embedConfig.hostId,
      canSpawnThreadHost: embedConfig.embed && embedBridge.canSpawnThread,
      canOpenThreadHost: embedConfig.embed && embedBridge.canOpenThread,
      documentBaseUrl: getApiBaseUrl(),
    }),
    [
      effectiveTheme,
      embedBridge.canOpenThread,
      embedBridge.canSpawnThread,
      embedBridge.hostInfo?.hostId,
      embedConfig.density,
      embedConfig.embed,
      embedConfig.hostId,
      embedConfig.readonly,
      hideInspector,
      inspectorOpen,
    ],
  );

  return (
    <NavBlockerRegistryContext.Provider value={navBlockStateRef}>
      <InkadeViewsProvider
        environment={viewsEnvironment}
        hostActions={viewsHostActions}
        navigation={viewsNavigation}
        notifier={viewsNotifier}
      >
      <AppActionsContext.Provider value={actionsValue}>
        <div
        className={cn(
          "inkade-shell-root flex h-svh w-full overflow-hidden text-foreground",
          embedBridge.connected && "inkade-host-bridge",
          isInsetDesktop ? "bg-[var(--studio-ground,var(--sidebar))] lg:p-1.5" : "bg-background",
        )}
      >
        {!isSettingsRoute && !hideSidebar ? (
          <>
            <aside
              aria-hidden={sidebarCollapsed || undefined}
              className={cn(
                "hidden h-full shrink-0 overflow-hidden lg:block",
                sidebarPane.isResizing
                  ? "transition-none"
                  : "transition-[width,opacity] duration-[var(--duration-fast)] ease-[var(--ease-link)]",
                sidebarCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
              )}
              data-slot="app-sidebar"
              inert={sidebarCollapsed ? true : undefined}
              style={{ width: sidebarCollapsed ? "0px" : `${sidebarPane.width}px` }}
            >
              {renderSidebar("desktop")}
            </aside>
            {showDesktopSidebar ? (
              <ResizeHandle
                ariaLabel={t("nav.resizeSidebarAria")}
                className={cn("hidden lg:block", isInsetDesktop && "lg:w-1 lg:bg-transparent")}
                onResizeDelta={sidebarPane.resizeByDelta}
                onResizeEnd={() => sidebarPane.setIsResizing(false)}
                onResizeStart={() => sidebarPane.setIsResizing(true)}
                onReset={sidebarPane.resetWidth}
                orientation="vertical"
                valueMax={380}
                valueMin={220}
                valueNow={sidebarPane.width}
              />
            ) : null}
          </>
        ) : null}

        <SidebarHoverPeek
          enabled={!isSettingsRoute && !hideSidebar && sidebarCollapsed && isDesktop}
          onOpenChange={setPeekOpen}
          open={peekOpen}
        >
          {renderSidebar("peek")}
        </SidebarHoverPeek>

        {!hideSidebar && !hideMobileNav ? (
          <Drawer onOpenChange={handleMobileNavOpenChange} open={mobileNavOpen} position="left">
            <DrawerPopup
              className="w-[82vw] max-w-80 overflow-hidden bg-sidebar p-0"
              showCloseButton={false}
              variant="straight"
            >
              <DrawerHeader className="sr-only"><DrawerTitle>{t("nav.navMenu")}</DrawerTitle></DrawerHeader>
              <DrawerContent className="h-full">{renderSidebar("drawer")}</DrawerContent>
            </DrawerPopup>
          </Drawer>
        ) : null}

        <div
          className={cn(
            "flex min-w-0 flex-1 overflow-hidden",
            isInsetDesktop && "lg:rounded-xl lg:border lg:border-border lg:bg-background",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {realtime.state === "reconnecting" ? (
              <div className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1 text-xs text-warning-foreground" role="status">
                <WifiOffIcon className="size-3.5" />
                <span>{t("nav.realtimeBanner", { attempt: realtime.reconnectAttempt })}</span>
              </div>
            ) : null}

            {!hideTopbar ? (
              <TopHeaderBar
                activeAgentTools={realtime.activeTools}
                hideInspector={hideInspector}
                hideQuickCapture={hideQuickCapture}
                hideSidebarTrigger={hideSidebar}
                inspectorDoc={inspectorTarget.document}
                inspectorOpen={inspectorOpen}
                isSettingsRoute={isSettingsRoute}
                onBackToWorkspace={() => void navigate({ to: "/daily" })}
                onExpandSidebar={() => setSidebarCollapsed(false)}
                onOpenCommandPalette={() => setCommandOpen(true)}
                onOpenMobileNav={() => handleMobileNavOpenChange(true)}
                onOpenQuickCapture={() => openQuickCapture()}
                onToggleInspector={handleToggleInspector}
                pathname={pathname}
                realtimeState={realtime.state}
                reconnectAttempt={realtime.reconnectAttempt}
                scrolled={mainScrolled}
                searchStr={searchStr}
                sidebarCollapsed={sidebarCollapsed}
              />
            ) : null}

            {!hideTopbar && !isSettingsRoute ? (
              <WorkspaceTabStrip
                enabled={enableWorkspaceTabs}
                isDesktop={isDesktop}
                onNavigatePath={navigateToRawPath}
                onOpenCommandPalette={() => setCommandOpen(true)}
                pathname={pathname}
                searchStr={searchStr}
              />
            ) : null}

            {(() => {
              const primaryDocId = pathname.startsWith("/docs/")
                ? asDocumentId(decodeURIComponent(pathname.slice("/docs/".length).split("/")[0] ?? ""))
                : null;
              const mainElement = isPaneManagedRoute ? (
                <main
                  className={cn(
                    "min-h-0 flex-1 overflow-hidden",
                    hideMobileNav ? "pb-0" : "pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0",
                  )}
                >
                  <Suspense fallback={<RouteContentFallback />}>
                    <Outlet />
                  </Suspense>
                </main>
              ) : (
                <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <ScrollArea
                    className="min-h-0 flex-1"
                    onViewportScroll={(e) => setMainScrolled(e.currentTarget.scrollTop > 4)}
                    overscrollContain
                    viewportRef={mainScrollRef}
                  >
                    <div
                      className={cn(
                        "min-h-full",
                        hideMobileNav
                          ? "pb-4"
                          : isSettingsRoute
                            ? "pb-20 md:pb-0"
                            : "pb-20 md:pb-6",
                      )}
                    >
                      <Suspense fallback={<RouteContentFallback />}>
                        <Outlet />
                      </Suspense>
                    </div>
                  </ScrollArea>
                </main>
              );

              const showWorkspaceSplit =
                isDesktop && splitOpen && !embedConfig.embed && !isSettingsRoute;
              if (!showWorkspaceSplit) {
                return mainElement;
              }

              return (
                <Group
                  className="flex min-h-0 flex-1 overflow-hidden"
                  defaultLayout={{
                    primary: splitPrimaryRatio,
                    split: 100 - splitPrimaryRatio,
                  }}
                  onLayoutChanged={(layout) => {
                    const nextPrimary = layout.primary;
                    if (typeof nextPrimary === "number" && Number.isFinite(nextPrimary)) {
                      setSplitPrimaryRatio(nextPrimary);
                    }
                  }}
                  orientation="horizontal"
                >
                  <Panel
                    className="flex min-h-0 min-w-0 flex-col"
                    defaultSize={`${splitPrimaryRatio}%`}
                    id="primary"
                    minSize="35%"
                  >
                    {mainElement}
                  </Panel>
                  <Separator
                    aria-label={t("document.splitPaneHeader")}
                    className="hidden w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40 focus-visible:outline-none lg:block"
                  />
                  <Panel
                    className="hidden min-h-0 min-w-0 flex-col lg:flex"
                    defaultSize={`${100 - splitPrimaryRatio}%`}
                    id="split"
                    maxSize="65%"
                    minSize="25%"
                  >
                    <WorkspaceSplitPane
                      isPrimaryDailyToday={pathname === "/daily"}
                      onChangeSplitDocId={(nextId) => setSplitDocId(nextId)}
                      onChangeSplitMode={(nextMode) => setSplitMode(nextMode)}
                      onClose={closeSplit}
                      onSwapPrimary={(targetDocId) => {
                        if (primaryDocId && primaryDocId !== targetDocId) {
                          setSplitDocId(primaryDocId);
                          setSplitMode("doc");
                        }
                        void navigate({ to: "/docs/$docId", params: { docId: targetDocId } });
                      }}
                      primaryDocumentId={primaryDocId}
                      splitDocId={splitDocId}
                      splitMode={splitMode}
                    />
                  </Panel>
                </Group>
              );
            })()}
          </div>

          {showDesktopInspector ? (
            <>
              <ResizeHandle
                ariaLabel={t("nav.resizeInspectorAria")}
                className="hidden lg:block"
                onResizeDelta={inspectorPane.resizeByDelta}
                onResizeEnd={() => inspectorPane.setIsResizing(false)}
                onResizeStart={() => inspectorPane.setIsResizing(true)}
                onReset={inspectorPane.resetWidth}
                orientation="vertical"
                valueMax={480}
                valueMin={280}
                valueNow={inspectorPane.width}
              />
              <aside
                className="hidden h-full shrink-0 lg:block"
                data-slot="app-inspector"
                style={{ width: `${inspectorPane.width}px` }}
              >
                <InspectorPanel />
              </aside>
            </>
          ) : null}
        </div>

        {!isSettingsRoute && !hideInspector ? (
          <div className="lg:hidden">
            <Drawer
              onOpenChange={handleMobileInspectorOpenChange}
              open={!isDesktop && inspectorOpen}
              position="right"
            >
              <DrawerPopup
                className="w-[88vw] max-w-sm overflow-hidden bg-sidebar p-0"
                showCloseButton={false}
                variant="straight"
              >
                <DrawerHeader className="sr-only"><DrawerTitle>{t("nav.inspectorDrawerTitle")}</DrawerTitle></DrawerHeader>
                <DrawerPanel className="h-full p-0" scrollable={false}><InspectorPanel isDrawer /></DrawerPanel>
              </DrawerPopup>
            </Drawer>
          </div>
        ) : null}

        {!hideMobileNav ? (
          <MobileNavChrome
            hideQuickCapture={hideQuickCapture}
            isSettingsRoute={isSettingsRoute}
            onOpenQuickCapture={() => openQuickCapture()}
            pathname={pathname}
          />
        ) : null}
      </div>

      <GlobalCommandPalette effectiveTheme={effectiveTheme} onNewDocument={() => openNewDocumentDialog()} onOpenAskDrawer={openAskDrawer} onOpenChange={setCommandOpen} onQuickCapture={() => openQuickCapture()} onToggleTheme={toggleLightDark} open={commandOpen} />
      <AskInkadeDrawer onOpenChange={handleAskDrawerOpenChange} open={askDrawerOpen} />
      <QuickCaptureDrawer
        onOpenChange={handleQuickCaptureOpenChange}
        open={quickCaptureOpen}
        prefill={quickCapturePrefill}
        spaces={spaces}
      />
      <CreateDocumentDialog defaultKind={newDocDialog.kind} defaultSpaceId={newDocDialog.spaceId} onCreated={(created) => void navigate({ to: "/docs/$docId", params: { docId: created.id } })} onOpenChange={(open) => setNewDocDialog((prev) => ({ ...prev, open }))} open={newDocDialog.open} spaces={spaces} />
      <CreateSpaceDialog defaultParentId={spaceDialog.defaultParentId} editingSpace={spaceDialog.editingSpace} onOpenChange={(open) => setSpaceDialog((prev) => ({ ...prev, open }))} open={spaceDialog.open} spaces={spaces} />
      <SavedViewCreateDialog existingCount={savedViews.length} onOpenChange={setSavedViewDialogOpen} open={savedViewDialogOpen} spaces={spaces} />
      <DigitalGardenDialog
        onOpenChange={(open) =>
          setGardenDialog((prev) => ({
            open,
            ...(open ? { presetSource: prev.presetSource } : {}),
          }))
        }
        open={gardenDialog.open}
        presetSource={gardenDialog.presetSource}
      />
      <GlobalShortcutsDialog onOpenChange={setShortcutsOpen} open={shortcutsOpen} />
      <SettingsModal initialSection={settingsModalSection} onOpenChange={setSettingsModalOpen} open={settingsModalOpen} />
      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !leavingSavePending) {
            handleUnsavedKeepEditing();
          }
        }}
        open={blocker.status === "blocked"}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("document.unsavedDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {navBlockStateRef.current.confirmMessage || t("document.unsavedConfirmMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              disabled={leavingSavePending}
              onClick={handleUnsavedKeepEditing}
              variant="outline"
            >
              {t("document.unsavedActionKeepEditing")}
            </Button>
            <Button
              disabled={leavingSavePending}
              onClick={handleUnsavedDiscardAndLeave}
              variant="destructive-outline"
            >
              {t("document.unsavedActionDiscard")}
            </Button>
            {navBlockStateRef.current.options?.onSaveAndLeave ? (
              <Button loading={leavingSavePending} onClick={handleUnsavedSaveAndLeave}>
                {t("document.unsavedActionSaveAndLeave")}
              </Button>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
        </AppActionsContext.Provider>
      </InkadeViewsProvider>
    </NavBlockerRegistryContext.Provider>
  );
}
