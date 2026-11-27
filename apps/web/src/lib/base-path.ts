const SAFE_BASE_PATH_RE = /^\/[a-zA-Z0-9/_-]+$/;

export function sanitizeAppBasePath(raw?: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/") return "";
  const normalized = trimmed.replace(/\/+$/, "");
  if (!normalized || normalized.includes("//") || !SAFE_BASE_PATH_RE.test(normalized)) {
    return "";
  }
  return normalized;
}

declare global {
  interface Window {
    __INKADE_BASE_PATH__?: string | undefined;
  }
}

export function getAppBasePath(): string {
  if (typeof window === "undefined") {
    return "";
  }
  if (typeof window.__INKADE_BASE_PATH__ === "string") {
    return sanitizeAppBasePath(window.__INKADE_BASE_PATH__);
  }
  if (typeof document !== "undefined") {
    const baseEl = document.querySelector("base[href]");
    const href = baseEl?.getAttribute("href");
    if (href) {
      try {
        const parsed = new URL(href, window.location.origin);
        return sanitizeAppBasePath(parsed.pathname);
      } catch {
        return sanitizeAppBasePath(href);
      }
    }
  }
  return "";
}

export function withBasePath(path: string): string {
  if (!path) {
    return getAppBasePath() || "/";
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const base = getAppBasePath();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalizedPath}` : normalizedPath;
}
