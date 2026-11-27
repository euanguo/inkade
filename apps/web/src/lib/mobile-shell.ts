import {
  MOBILE_ACCENT_PRESETS,
  MOBILE_SURFACE_THEMES,
  type MobileAccentPreset,
  type MobileShellWebToHostMessage,
  type MobileSurfaceTheme,
} from "@inkade/core";
import type { QueryClient } from "@tanstack/react-query";

export interface InkadeMobileShellBootstrap {
  readonly version: 1;
  readonly platform: string;
  readonly authMode: "token" | "local-auto";
  readonly token?: string | undefined;
  readonly locale?: string | undefined;
}

declare global {
  interface Window {
    __INKADE_MOBILE_SHELL__?: InkadeMobileShellBootstrap;
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
  }
}

export function isNativeMobileShell(): boolean {
  if (typeof window === "undefined") return false;
  return (
    Boolean(window.__INKADE_MOBILE_SHELL__) ||
    typeof window.ReactNativeWebView?.postMessage === "function"
  );
}

export function getMobileShellInjectedToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const boot = window.__INKADE_MOBILE_SHELL__;
  if (!boot || boot.authMode !== "token" || !boot.token) return undefined;
  const trimmed = boot.token.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function postToNativeShell(msg: MobileShellWebToHostMessage): boolean {
  if (typeof window === "undefined") return false;
  const post = window.ReactNativeWebView?.postMessage;
  if (typeof post !== "function") return false;
  try {
    post.call(window.ReactNativeWebView, JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

function parseSurfaceDataset(raw: string | undefined): MobileSurfaceTheme | undefined {
  return raw && (MOBILE_SURFACE_THEMES as readonly string[]).includes(raw)
    ? (raw as MobileSurfaceTheme)
    : undefined;
}

function parseAccentDataset(raw: string | undefined): MobileAccentPreset | undefined {
  return raw && (MOBILE_ACCENT_PRESETS as readonly string[]).includes(raw)
    ? (raw as MobileAccentPreset)
    : undefined;
}

export function notifyNativeShellTheme(): void {
  if (typeof document === "undefined" || !isNativeMobileShell()) return;
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");
  const computedBg =
    typeof window.getComputedStyle === "function"
      ? window.getComputedStyle(root).getPropertyValue("--background").trim()
      : "";
  const backgroundColor = computedBg || (isDark ? "#141517" : "#ffffff");
  const surface = parseSurfaceDataset(root.dataset.surface);
  const accent = parseAccentDataset(root.dataset.accent);
  postToNativeShell({
    kind: "theme_sync",
    isDark,
    backgroundColor,
    ...(surface ? { surface } : {}),
    ...(accent ? { accent } : {}),
  });
}

export function installMobileShellBridge(options: {
  readonly queryClient: QueryClient;
  readonly navigateToPath: (path: string) => void;
}): () => void {
  if (typeof window === "undefined" || typeof document === "undefined" || !isNativeMobileShell()) {
    return () => {};
  }

  document.documentElement.dataset.mobileShell = "native";
  notifyNativeShellTheme();

  const observer =
    typeof MutationObserver === "function"
      ? new MutationObserver(() => {
          notifyNativeShellTheme();
        })
      : null;
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-surface", "data-accent", "data-paper"],
  });

  const onRefresh = (): void => {
    void options.queryClient.invalidateQueries();
  };

  const onNavigate = (event: Event): void => {
    const custom = event as CustomEvent<{ readonly path?: string | undefined }>;
    const path = custom.detail?.path;
    if (typeof path === "string" && path.startsWith("/")) {
      options.navigateToPath(path);
    }
  };

  window.addEventListener("inkade:mobile-shell-refresh", onRefresh);
  window.addEventListener("inkade:mobile-shell-navigate", onNavigate);

  return () => {
    observer?.disconnect();
    window.removeEventListener("inkade:mobile-shell-refresh", onRefresh);
    window.removeEventListener("inkade:mobile-shell-navigate", onNavigate);
  };
}
