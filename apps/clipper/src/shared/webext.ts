export interface WebExtTab {
  readonly id?: number | undefined;
  readonly windowId?: number | undefined;
  readonly url?: string | undefined;
  readonly title?: string | undefined;
}

export interface WebExtStorageArea {
  get(keys?: string | readonly string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | readonly string[]): Promise<void>;
}

export interface WebExtStorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

export interface WebExtContextMenuInfo {
  readonly menuItemId: string | number;
  readonly selectionText?: string | undefined;
  readonly pageUrl?: string | undefined;
  readonly linkUrl?: string | undefined;
  readonly srcUrl?: string | undefined;
  readonly mediaType?: string | undefined;
}

export interface WebExtDnrRule {
  readonly id: number;
  readonly priority?: number | undefined;
  readonly action: {
    readonly type: "modifyHeaders";
    readonly requestHeaders: ReadonlyArray<{
      readonly header: string;
      readonly operation: "set" | "remove" | "append";
      readonly value?: string | undefined;
    }>;
  };
  readonly condition: {
    readonly urlFilter?: string | undefined;
    readonly requestDomains?: readonly string[] | undefined;
    readonly resourceTypes?: readonly string[] | undefined;
  };
}

export interface WebExtApi {
  readonly runtime?: {
    readonly onMessage?: {
      addListener(
        listener: (
          message: unknown,
          sender: { readonly tab?: WebExtTab | undefined },
          sendResponse: (response?: unknown) => void,
        ) => boolean | Promise<unknown> | void,
      ): void;
      removeListener?(
        listener: (
          message: unknown,
          sender: { readonly tab?: WebExtTab | undefined },
          sendResponse: (response?: unknown) => void,
        ) => boolean | Promise<unknown> | void,
      ): void;
    } | undefined;
    readonly onInstalled?: {
      addListener(listener: () => void): void;
    } | undefined;
    readonly onStartup?: {
      addListener(listener: () => void): void;
    } | undefined;
    sendMessage?<T = unknown>(message: unknown): Promise<T>;
    openOptionsPage?(): Promise<void> | void;
    getURL?(path: string): string;
  } | undefined;
  readonly storage?: {
    readonly sync?: WebExtStorageArea | undefined;
    readonly local?: WebExtStorageArea | undefined;
    readonly session?: WebExtStorageArea | undefined;
    readonly onChanged?: {
      addListener(
        listener: (
          changes: Record<string, WebExtStorageChange>,
          areaName: string,
        ) => void,
      ): void;
      removeListener?(
        listener: (
          changes: Record<string, WebExtStorageChange>,
          areaName: string,
        ) => void,
      ): void;
    } | undefined;
  } | undefined;
  readonly tabs?: {
    query(queryInfo: {
      readonly active?: boolean;
      readonly currentWindow?: boolean;
    }): Promise<WebExtTab[]>;
    get?(tabId: number): Promise<WebExtTab>;
    sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;
    create?(createProperties: { readonly url: string }): Promise<WebExtTab>;
    remove?(tabId: number): Promise<void>;
    readonly onActivated?: {
      addListener(listener: (info: { readonly tabId: number; readonly windowId: number }) => void): void;
      removeListener?(
        listener: (info: { readonly tabId: number; readonly windowId: number }) => void,
      ): void;
    } | undefined;
    readonly onUpdated?: {
      addListener(
        listener: (
          tabId: number,
          changeInfo: { readonly status?: string; readonly url?: string },
          tab: WebExtTab,
        ) => void,
      ): void;
      removeListener?(
        listener: (
          tabId: number,
          changeInfo: { readonly status?: string; readonly url?: string },
          tab: WebExtTab,
        ) => void,
      ): void;
    } | undefined;
  } | undefined;
  readonly scripting?: {
    executeScript(injection: {
      readonly target: { readonly tabId: number };
      readonly files?: readonly string[] | undefined;
    }): Promise<unknown[]>;
  } | undefined;
  readonly contextMenus?: {
    removeAll?(callback?: () => void): Promise<void> | void;
    create(createProperties: {
      readonly id: string;
      readonly title: string;
      readonly contexts: readonly string[];
    }): void;
    readonly onClicked?: {
      addListener(listener: (info: WebExtContextMenuInfo, tab?: WebExtTab) => void): void;
    } | undefined;
  } | undefined;
  readonly commands?: {
    getAll?(): Promise<
      ReadonlyArray<{
        readonly name?: string | undefined;
        readonly description?: string | undefined;
        readonly shortcut?: string | undefined;
      }>
    >;
    readonly onCommand?: {
      addListener(listener: (command: string) => void): void;
    } | undefined;
  } | undefined;
  readonly action?: {
    setBadgeText(details: {
      readonly text: string;
      readonly tabId?: number | undefined;
    }): Promise<void> | void;
    setBadgeBackgroundColor(details: {
      readonly color: string;
      readonly tabId?: number | undefined;
    }): Promise<void> | void;
  } | undefined;
  readonly permissions?: {
    contains(permissions: {
      readonly origins?: readonly string[] | undefined;
      readonly permissions?: readonly string[] | undefined;
    }): Promise<boolean>;
    request(permissions: {
      readonly origins?: readonly string[] | undefined;
      readonly permissions?: readonly string[] | undefined;
    }): Promise<boolean>;
  } | undefined;
  readonly declarativeNetRequest?: {
    getDynamicRules?(): Promise<WebExtDnrRule[]>;
    updateDynamicRules(options: {
      readonly removeRuleIds?: readonly number[] | undefined;
      readonly addRules?: readonly WebExtDnrRule[] | undefined;
    }): Promise<void>;
  } | undefined;
  readonly sidePanel?: {
    open?(options: { readonly windowId?: number; readonly tabId?: number }): Promise<void>;
    setPanelBehavior?(options: { readonly openPanelOnActionClick?: boolean }): Promise<void>;
  } | undefined;
  readonly sidebarAction?: {
    open?(): Promise<void>;
  } | undefined;
}

export function getWebExt(): WebExtApi | null {
  const g = globalThis as unknown as {
    readonly browser?: WebExtApi | undefined;
    readonly chrome?: WebExtApi | undefined;
  };
  return g.browser ?? g.chrome ?? null;
}

export function isRestrictedTabUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return true;
  return !(rawUrl.startsWith("http://") || rawUrl.startsWith("https://"));
}

export function originPatternForUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}/*`;
  } catch {
    return null;
  }
}

export async function hasHostOriginPermission(rawUrl: string): Promise<boolean> {
  const ext = getWebExt();
  const pattern = originPatternForUrl(rawUrl);
  if (!pattern || !ext?.permissions?.contains) return true;
  try {
    return await ext.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * Requests optional host origin permission for `rawUrl`.
 * Must be triggered directly inside a user gesture handler (click / keyboard command).
 */
export async function requestHostOriginPermission(rawUrl: string): Promise<boolean> {
  const ext = getWebExt();
  const pattern = originPatternForUrl(rawUrl);
  if (!pattern || !ext?.permissions?.request) return false;
  try {
    return await ext.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

export async function openClipperSidePanel(tab?: WebExtTab): Promise<boolean> {
  const ext = getWebExt();
  if (!ext) return false;
  if (ext.sidePanel?.open) {
    try {
      await ext.sidePanel.open(
        tab?.windowId !== undefined
          ? { windowId: tab.windowId }
          : tab?.id !== undefined
            ? { tabId: tab.id }
            : {},
      );
      return true;
    } catch {
      // fall through
    }
  }
  if (ext.sidebarAction?.open) {
    try {
      await ext.sidebarAction.open();
      return true;
    } catch {
      // fall through
    }
  }
  return false;
}

/**
 * Resolves the target HTTP/HTTPS webpage tab for Popup or Side Panel views.
 * Handles direct panel context (`active: true, currentWindow: true`), optional `?tabId=` query param,
 * and fallback to the most recent HTTP/HTTPS tab when the extension UI itself is opened in a tab.
 */
export async function resolveTargetTab(preferredTabId?: number | null): Promise<WebExtTab | null> {
  const ext = getWebExt();
  if (!ext?.tabs) return null;

  let candidateId = preferredTabId ?? null;
  if (candidateId === null && typeof window !== "undefined" && window.location?.search) {
    const rawParam = new URLSearchParams(window.location.search).get("tabId");
    if (rawParam) {
      const parsed = Number.parseInt(rawParam, 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        candidateId = parsed;
      }
    }
  }

  if (candidateId !== null && candidateId > 0 && ext.tabs.get) {
    try {
      const specific = await ext.tabs.get(candidateId);
      if (specific && !isRestrictedTabUrl(specific.url)) {
        return specific;
      }
    } catch {
      // fall through
    }
  }

  try {
    const activeTabs = await ext.tabs.query({ active: true, currentWindow: true });
    if (activeTabs[0] && !isRestrictedTabUrl(activeTabs[0].url)) {
      return activeTabs[0];
    }

    const windowTabs = await ext.tabs.query({ currentWindow: true });
    const inWindow = [...windowTabs].reverse().find((tab) => !isRestrictedTabUrl(tab.url));
    if (inWindow) return inWindow;

    const allTabs = await ext.tabs.query({});
    return [...allTabs].reverse().find((tab) => !isRestrictedTabUrl(tab.url)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Sends a runtime message to `tabId`, injecting `scriptFile` on demand if no matching
 * listener responded (note: Chrome MV3 resolves `tabs.sendMessage` to `undefined` rather
 * than rejecting when another listener such as `content-loader.js` returns `false`).
 */
export async function sendMessageEnsuringScript<T = unknown>(
  tabId: number,
  scriptFile: string,
  message: unknown,
): Promise<T | null> {
  const ext = getWebExt();
  if (!ext?.tabs) return null;

  try {
    const res = await ext.tabs.sendMessage<T | undefined>(tabId, message);
    if (res !== undefined && res !== null) {
      return res;
    }
  } catch {
    // No listener replied; inject script below and retry once.
  }

  if (!ext.scripting) return null;
  try {
    await ext.scripting.executeScript({
      target: { tabId },
      files: [scriptFile],
    });
    const retry = await ext.tabs.sendMessage<T | undefined>(tabId, message);
    return retry ?? null;
  } catch {
    return null;
  }
}
