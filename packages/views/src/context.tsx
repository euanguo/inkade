import type {
  AdeThreadBinding,
  DocumentId,
  DocumentKind,
  DocumentRecord,
  HighlightId,
  InkadePlaceChangedPayload,
  InkadeSaveStateChangedPayload,
  OutlineNode,
  OutlineNodeId,
  SavedViewId,
  SelectionAnchor,
  SpaceId,
} from "@inkade/core";
import { t } from "@inkade/i18n";
import { toastManager } from "@inkade/ui";
import type React from "react";
import { createContext, useContext, useMemo } from "react";
import { PreferencesServerSyncBridge } from "./lib/preferences-store.ts";

export interface DispatchThreadTarget {
  readonly documentId: DocumentId;
  readonly documentTitle: string;
  readonly nodeId?: OutlineNodeId | null | undefined;
  readonly selectionAnchor?: SelectionAnchor | null | undefined;
  readonly excerpt: string;
  readonly defaultTitle?: string | undefined;
}

export interface LibraryNavigationFilter {
  readonly spaceId?: SpaceId | undefined;
  readonly kind?: DocumentKind | undefined;
  readonly tag?: string | undefined;
  readonly pinnedOnly?: boolean | undefined;
  readonly unreadOnly?: boolean | undefined;
  readonly viewId?: SavedViewId | undefined;
}

export interface ThreadsNavigationFilter {
  readonly hostId?: string | undefined;
  readonly threadId?: string | undefined;
  readonly conflictMode?: boolean | undefined;
}

export interface NavigationBlockerOptions {
  readonly onSaveAndLeave?: (() => Promise<boolean> | boolean) | undefined;
  readonly onDiscardAndLeave?: (() => void) | undefined;
}

export interface InkadeNavigationAdapter {
  openDocument(
    documentId: DocumentId,
    options?: {
      readonly mode?: "read" | "edit" | undefined;
      readonly nodeId?: OutlineNodeId | undefined;
      readonly heading?: string | undefined;
      readonly highlight?: HighlightId | undefined;
      readonly page?: number | undefined;
      readonly annotation?: string | undefined;
    },
  ): void;
  openDaily(date?: string, options?: { readonly nodeId?: OutlineNodeId | undefined }): void;
  openSpace(spaceId: SpaceId): void;
  openLibrary(filter?: LibraryNavigationFilter): void;
  openThreads?(filter?: ThreadsNavigationFilter): void;
  openTasks?(): void;
  openInbox?(options?: { readonly tab?: string | undefined }): void;
  openTrash?(): void;
  openAsk?(): void;
  openConnect?(): void;
  openSettings?(section?: string): void;
  /**
   * Optional unsaved-change blocker hook (wired to `useBlocker` in web router, no-op in hostless contexts).
   */
  useNavigationBlocker?:
    | ((shouldBlock: boolean, confirmMessage: string, options?: NavigationBlockerOptions) => void)
    | undefined;
}

export interface InkadeHostActions {
  dispatchThread?(target: DispatchThreadTarget): void | Promise<void>;
  openThread?(binding: AdeThreadBinding): void | Promise<void>;
  openNewDocument?(options?: {
    readonly spaceId?: SpaceId | undefined;
    readonly kind?: DocumentKind | undefined;
  }): void;
  openQuickCapture?(prefill?: {
    readonly target?: "inbox" | "daily" | undefined;
    readonly title?: string | undefined;
    readonly text?: string | undefined;
    readonly sourceUrl?: string | undefined;
  }): void;
  openCreateSpace?(options?: { readonly defaultParentId?: SpaceId | null | undefined }): void;
  openEditSpace?(spaceId: SpaceId): void;
  openInspectorTab?(tab: "threads" | "backlinks" | "revisions"): void;
  setInspectorOpen?(open: boolean): void;
  toggleInspector?(): void;
  setSidebarMode?(mode: "tree" | "doc"): void;
  syncInspectorTarget?(target: {
    readonly document: DocumentRecord | null;
    readonly selectedNodeId?: OutlineNodeId | null | undefined;
  }): void;
  registerDocSidebarPanel?(panel: React.ReactNode | null): void;
  requestOpenSplitDoc?(documentId: DocumentId): void;
  readonly workspaceSplitManaged?: boolean | undefined;
  readonly pendingSplitDocId?: DocumentId | null | undefined;
  clearPendingSplitDoc?(): void;
  copyText?(text: string): Promise<boolean>;
  openExternalUrl?(url: string): void;
  reportSaveState?(payload: InkadeSaveStateChangedPayload): void;
  reportPlace?(payload: InkadePlaceChangedPayload): void;
}

export interface InkadeNotifier {
  success(title: string, description?: string): void;
  error(title: string, error?: unknown): void;
  withUndo?(options: {
    readonly title: string;
    readonly description?: string | undefined;
    readonly onUndo: () => Promise<void> | void;
  }): void;
}

export interface InkadeViewsEnvironment {
  readonly readonly?: boolean | undefined;
  readonly density?: "comfortable" | "compact" | undefined;
  readonly embed?: boolean | undefined;
  readonly hostId?: string | null | undefined;
  readonly effectiveTheme?: "light" | "dark" | undefined;
  readonly canSpawnThreadHost?: boolean | undefined;
  readonly canOpenThreadHost?: boolean | undefined;
  readonly documentBaseUrl?: string | undefined;
  readonly inspectorOpen?: boolean | undefined;
}

export interface ResolvedInkadeNavigationAdapter extends InkadeNavigationAdapter {
  useNavigationBlocker(
    shouldBlock: boolean,
    confirmMessage: string,
    options?: NavigationBlockerOptions,
  ): void;
}

export interface InkadeViewsContextValue {
  readonly navigation: ResolvedInkadeNavigationAdapter;
  readonly hostActions: InkadeHostActions;
  readonly notifier: InkadeNotifier;
  readonly environment: InkadeViewsEnvironment;
}

const DEFAULT_NOTIFIER: InkadeNotifier = {
  success: (title, description) => {
    toastManager.add({
      title,
      ...(description ? { description } : {}),
      type: "success",
      timeout: 3000,
    });
  },
  error: (title, error) => {
    toastManager.add({
      title,
      description:
        error instanceof Error ? error.message : typeof error === "string" ? error : undefined,
      type: "error",
      timeout: 5000,
    });
  },
  withUndo: ({ title, description, onUndo }) => {
    let toastId = "";
    toastId = toastManager.add({
      title,
      ...(description ? { description } : {}),
      type: "info",
      timeout: 5000,
      actionProps: {
        children: t("common.undo"),
        onClick: () => {
          if (toastId) {
            toastManager.close(toastId);
          }
          void Promise.resolve(onUndo()).catch((err: unknown) => {
            toastManager.add({
              title: t("common.undoFailed"),
              description: err instanceof Error ? err.message : t("common.pleaseRetry"),
              type: "error",
              timeout: 4000,
            });
          });
        },
      },
    });
  },
};

function useNoopNavigationBlocker(
  _shouldBlock: boolean,
  _confirmMessage: string,
  _options?: NavigationBlockerOptions,
): void {}

const NOOP_NAVIGATION: ResolvedInkadeNavigationAdapter = {
  openDocument: () => {},
  openDaily: () => {},
  openSpace: () => {},
  openLibrary: () => {},
  useNavigationBlocker: useNoopNavigationBlocker,
};

const InkadeViewsContext = createContext<InkadeViewsContextValue | null>(null);

export interface InkadeViewsProviderProps {
  readonly navigation?: InkadeNavigationAdapter | undefined;
  readonly hostActions?: InkadeHostActions | undefined;
  readonly notifier?: InkadeNotifier | undefined;
  readonly environment?: InkadeViewsEnvironment | undefined;
  readonly children: React.ReactNode;
}

export function InkadeViewsProvider({
  navigation = NOOP_NAVIGATION,
  hostActions = {},
  notifier = DEFAULT_NOTIFIER,
  environment = {},
  children,
}: InkadeViewsProviderProps): React.ReactElement {
  const value = useMemo<InkadeViewsContextValue>(
    () => ({
      navigation: {
        ...navigation,
        useNavigationBlocker: navigation.useNavigationBlocker ?? useNoopNavigationBlocker,
      },
      hostActions,
      notifier,
      environment,
    }),
    [navigation, hostActions, notifier, environment],
  );
  return (
    <InkadeViewsContext.Provider value={value}>
      <PreferencesServerSyncBridge />
      {children}
    </InkadeViewsContext.Provider>
  );
}

export function useInkadeViewsContext(): InkadeViewsContextValue {
  const ctx = useContext(InkadeViewsContext);
  if (!ctx) {
    return {
      navigation: NOOP_NAVIGATION,
      hostActions: {},
      notifier: DEFAULT_NOTIFIER,
      environment: {},
    };
  }
  return ctx;
}

/**
 * Helper hook matching TanStack `useBlocker` semantics via injected navigation adapter.
 */
export function useViewsNavigationBlocker(
  shouldBlock: boolean,
  confirmMessage: string,
  options?: NavigationBlockerOptions,
): void {
  const { navigation } = useInkadeViewsContext();
  navigation.useNavigationBlocker(shouldBlock, confirmMessage, options);
}

export function dispatchOrOpenThreadDialog(
  hostActions: InkadeHostActions,
  environment: InkadeViewsEnvironment,
  target: DispatchThreadTarget,
  openDialog: (target: DispatchThreadTarget) => void,
): void {
  if (hostActions.dispatchThread && environment.canSpawnThreadHost) {
    void hostActions.dispatchThread(target);
    return;
  }
  openDialog(target);
}

export function openBindingInHostOrTab(
  hostActions: InkadeHostActions,
  environment: InkadeViewsEnvironment,
  binding: AdeThreadBinding,
): void {
  if (hostActions.openThread && environment.canOpenThreadHost) {
    void hostActions.openThread(binding);
    return;
  }
  if (binding.deepLink) {
    if (hostActions.openExternalUrl) {
      hostActions.openExternalUrl(binding.deepLink);
    } else if (typeof window !== "undefined") {
      window.open(binding.deepLink, "_blank", "noopener,noreferrer");
    }
    return;
  }
  if (hostActions.openThread) {
    void hostActions.openThread(binding);
    return;
  }
  hostActions.openInspectorTab?.("threads");
}

export type { OutlineNode };
