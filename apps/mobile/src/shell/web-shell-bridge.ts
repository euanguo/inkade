export interface WebShellBootstrapInput {
  readonly authMode: "token" | "local-auto";
  readonly token?: string | null | undefined;
  readonly platform: string;
  readonly locale?: string | null | undefined;
}

export type DeepLinkShellAction =
  | {
      readonly kind: "capture";
      readonly params: {
        readonly target?: "daily" | "inbox" | "clip" | undefined;
        readonly url?: string | undefined;
        readonly text?: string | undefined;
        readonly title?: string | undefined;
      };
    }
  | { readonly kind: "shell" }
  | { readonly kind: "connect" }
  | { readonly kind: "web_path"; readonly path: string };

export type WebViewNavigationPolicy = "allow_in_webview" | "open_external" | "block";

function safeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function parseQueryParamsFromUrl(url: string): Record<string, string> {
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return {};
  const rawQuery = url.slice(qIndex + 1).split("#", 1)[0] ?? "";
  const search = new URLSearchParams(rawQuery);
  const out: Record<string, string> = {};
  for (const [k, v] of search.entries()) {
    out[k] = v;
  }
  return out;
}

/**
 * Generates an inline bootstrap script run inside the embedded `@inkade/web` WebView before
 * page scripts execute, injecting bearer auth token / locale and marking `data-mobile-shell="native"`.
 */
export function buildWebShellBootstrapScript(input: WebShellBootstrapInput): string {
  const cleanToken =
    input.authMode === "token" && typeof input.token === "string" && input.token.trim().length > 0
      ? input.token.trim()
      : null;

  const bootPayload = {
    version: 1,
    platform: input.platform,
    authMode: input.authMode,
    ...(cleanToken ? { token: cleanToken } : {}),
    ...(input.locale ? { locale: input.locale } : {}),
  };

  return `(function () {
  try {
    window.__INKADE_MOBILE_SHELL__ = ${safeInlineJson(bootPayload)};
    if (typeof window.localStorage !== "undefined") {
      ${
        cleanToken
          ? `window.localStorage.setItem("inkade:auth-token", ${safeInlineJson(cleanToken)});`
          : `window.localStorage.removeItem("inkade:auth-token");`
      }
      ${
        input.locale
          ? `window.localStorage.setItem("inkade:locale", ${safeInlineJson(input.locale)});`
          : ""
      }
    }
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.dataset.mobileShell = "native";
      document.documentElement.dataset.mobilePlatform = ${safeInlineJson(input.platform)};
    }
  } catch (e) {}
})(); true;`;
}

/**
 * Resolves a safe same-origin workspace URL for the embedded WebView, defaulting to `/daily`.
 */
export function resolveShellRouteUrl(baseUrl: string, path?: string | null): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const candidate = (path ?? "/daily").trim();
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    /[\r\n]/.test(candidate)
  ) {
    return `${normalizedBase}/daily`;
  }
  return `${normalizedBase}${candidate}`;
}

/**
 * Maps `inkade://` deep links & Android Share routes into thin-shell destinations.
 */
export function mapDeepLinkToShellAction(url: string): DeepLinkShellAction | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let withoutScheme: string;
  if (trimmed.startsWith("/")) {
    withoutScheme = trimmed.slice(1);
  } else {
    const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/);
    if (!schemeMatch?.[2]) return null;
    if (schemeMatch[1]?.toLowerCase() !== "inkade") return null;
    withoutScheme = schemeMatch[2];
  }

  const pathPart = withoutScheme.split(/[?#]/, 1)[0] ?? "";
  const full = pathPart.replace(/^\/+|\/+$/g, "");
  const qp = parseQueryParamsFromUrl(trimmed);

  if (full === "web") {
    const rawTargetPath = (qp["path"] ?? "/daily").trim();
    const safePath =
      rawTargetPath.startsWith("/") &&
      !rawTargetPath.startsWith("//") &&
      !/[\r\n]/.test(rawTargetPath)
        ? rawTargetPath
        : "/daily";
    return { kind: "web_path", path: safePath };
  }

  if (full === "capture" || qp["text"] || qp["url"]) {
    const rawTarget = qp["target"];
    const target =
      rawTarget === "daily" || rawTarget === "inbox" || rawTarget === "clip"
        ? rawTarget
        : undefined;
    return {
      kind: "capture",
      params: {
        ...(target ? { target } : {}),
        ...(qp["url"] ? { url: qp["url"] } : {}),
        ...(qp["text"] ? { text: qp["text"] } : {}),
        ...(qp["title"] ? { title: qp["title"] } : {}),
      },
    };
  }

  if (full === "shell") {
    return { kind: "shell" };
  }
  if (full === "connect") {
    return { kind: "connect" };
  }

  if (full.startsWith("doc/")) {
    const id = full.slice("doc/".length).split("/")[0];
    return id ? { kind: "web_path", path: `/docs/${encodeURIComponent(id)}` } : null;
  }
  if (full.startsWith("daily/")) {
    const date = full.slice("daily/".length).split("/")[0];
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { kind: "web_path", path: `/daily/${date}` };
    }
    return { kind: "web_path", path: "/daily" };
  }
  if (
    full === "daily" ||
    full === "inbox" ||
    full === "library" ||
    full === "tasks" ||
    full === "threads" ||
    full === "settings"
  ) {
    return { kind: "web_path", path: `/${full}` };
  }

  return null;
}

/**
 * Classifies WebView navigation requests so only same-origin HTTP(S) pages load inside the shell.
 */
export function classifyWebViewNavigation(
  requestUrl: string,
  baseUrl: string,
): WebViewNavigationPolicy {
  const clean = requestUrl.trim();
  if (!clean) return "block";
  if (clean === "about:blank") return "allow_in_webview";

  let req: URL;
  let base: URL;
  try {
    req = new URL(clean);
    base = new URL(baseUrl);
  } catch {
    return "block";
  }

  const protocol = req.protocol.toLowerCase();
  if (
    protocol === "javascript:" ||
    protocol === "data:" ||
    protocol === "file:" ||
    protocol === "vbscript:" ||
    protocol === "blob:"
  ) {
    return "block";
  }

  if ((protocol === "http:" || protocol === "https:") && req.origin === base.origin) {
    return "allow_in_webview";
  }

  // Allow http/https external links, mailto, and valid RFC 3986 custom deep-link schemes
  if (/^[a-z][a-z0-9+.-]*:$/.test(protocol) && protocol !== "about:") {
    return "open_external";
  }

  return "block";
}
