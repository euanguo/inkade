import { useEffect, useState } from "react";

export type EmbedChromePreset = "full" | "minimal" | "none";
export type EmbedHideTarget =
  | "sidebar"
  | "topbar"
  | "inspector"
  | "mobileNav"
  | "fab"
  | "quickCapture";
export type EmbedDensity = "comfortable" | "compact";
export type EmbedThemeOverride = "light" | "dark" | "system";

export interface EmbedConfig {
  readonly embed: boolean;
  readonly chrome: EmbedChromePreset;
  readonly hidden: readonly EmbedHideTarget[];
  readonly hideSidebar: boolean;
  readonly hideTopbar: boolean;
  readonly hideInspector: boolean;
  readonly hideMobileNav: boolean;
  readonly hideFab: boolean;
  readonly hideQuickCapture: boolean;
  readonly themeOverride: EmbedThemeOverride | null;
  readonly density: EmbedDensity;
  readonly readonly: boolean;
  readonly hostId: string | null;
  readonly embedTicket: string | null;
}

const EMBED_CONFIG_STORAGE_KEY = "inkade:embed:config:v1";
const EMBED_CONFIG_CHANGE_EVENT = "inkade:embed-config-change";

const VALID_HIDE_TARGETS = new Set<EmbedHideTarget>([
  "sidebar",
  "topbar",
  "inspector",
  "mobileNav",
  "fab",
  "quickCapture",
]);

const VALID_HIDE_TARGET_STRINGS: ReadonlySet<string> = VALID_HIDE_TARGETS;

function isEmbedHideTarget(value: unknown): value is EmbedHideTarget {
  return typeof value === "string" && VALID_HIDE_TARGET_STRINGS.has(value);
}

const DEFAULT_EMBED_CONFIG: EmbedConfig = {
  embed: false,
  chrome: "full",
  hidden: [],
  hideSidebar: false,
  hideTopbar: false,
  hideInspector: false,
  hideMobileNav: false,
  hideFab: false,
  hideQuickCapture: false,
  themeOverride: null,
  density: "comfortable",
  readonly: false,
  hostId: null,
  embedTicket: null,
};

function isTruthyFlag(val: string | null): boolean {
  return val === "1" || val === "true";
}

function isFalsyFlag(val: string | null): boolean {
  return val === "0" || val === "false";
}

function computeHiddenFlags(
  chrome: EmbedChromePreset,
  explicitHidden: readonly EmbedHideTarget[],
): {
  readonly hidden: readonly EmbedHideTarget[];
  readonly hideSidebar: boolean;
  readonly hideTopbar: boolean;
  readonly hideInspector: boolean;
  readonly hideMobileNav: boolean;
  readonly hideFab: boolean;
  readonly hideQuickCapture: boolean;
} {
  const set = new Set<EmbedHideTarget>(explicitHidden);
  if (chrome === "minimal") {
    set.add("sidebar");
    set.add("mobileNav");
  } else if (chrome === "none") {
    set.add("sidebar");
    set.add("topbar");
    set.add("inspector");
    set.add("mobileNav");
    set.add("fab");
    set.add("quickCapture");
  }
  const hidden = [...set];
  return {
    hidden,
    hideSidebar: set.has("sidebar"),
    hideTopbar: set.has("topbar"),
    hideInspector: set.has("inspector"),
    hideMobileNav: set.has("mobileNav"),
    hideFab: set.has("fab"),
    hideQuickCapture: set.has("quickCapture"),
  };
}

export function parseEmbedConfigFromSearch(
  search: string,
  stored?: Omit<EmbedConfig, "embedTicket"> | null,
): EmbedConfig {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const embedParam = params.get("embed");
  if (isFalsyFlag(embedParam)) {
    return DEFAULT_EMBED_CONFIG;
  }

  const embedTicketRaw = params.get("embedTicket")?.trim() || null;
  const chromeParam = params.get("chrome");
  const hideParam = params.get("hide");
  const themeParam = params.get("theme");
  const densityParam = params.get("density");
  const readonlyParam = params.get("readonly");
  const hostParam = params.get("host");

  const hasAnyEmbedParam =
    embedParam !== null ||
    chromeParam !== null ||
    hideParam !== null ||
    themeParam !== null ||
    densityParam !== null ||
    readonlyParam !== null ||
    hostParam !== null ||
    embedTicketRaw !== null;

  if (!hasAnyEmbedParam) {
    return stored ? { ...stored, embedTicket: null } : DEFAULT_EMBED_CONFIG;
  }

  const chrome: EmbedChromePreset =
    chromeParam === "minimal" || chromeParam === "none" || chromeParam === "full"
      ? chromeParam
      : stored?.chrome ?? "full";

  const parsedHidden: EmbedHideTarget[] =
    hideParam !== null
      ? hideParam
          .split(",")
          .map((part) => part.trim())
          .filter((part): part is EmbedHideTarget =>
            VALID_HIDE_TARGETS.has(part as EmbedHideTarget),
          )
      : chromeParam !== null
        ? []
        : [...(stored?.hidden ?? [])];

  const hiddenFlags = computeHiddenFlags(chrome, parsedHidden);

  const themeOverride: EmbedThemeOverride | null =
    themeParam === "light" || themeParam === "dark" || themeParam === "system"
      ? themeParam
      : stored?.themeOverride ?? null;

  const density: EmbedDensity =
    densityParam === "compact" || densityParam === "comfortable"
      ? densityParam
      : stored?.density ?? "comfortable";

  const readonly =
    readonlyParam !== null ? isTruthyFlag(readonlyParam) : (stored?.readonly ?? false);

  const sanitizedHost =
    hostParam && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(hostParam.trim())
      ? hostParam.trim().toLowerCase()
      : stored?.hostId ?? null;

  const embed =
    isTruthyFlag(embedParam) ||
    Boolean(stored?.embed) ||
    chrome !== "full" ||
    hiddenFlags.hidden.length > 0 ||
    embedTicketRaw !== null;

  return {
    embed,
    chrome,
    ...hiddenFlags,
    themeOverride,
    density,
    readonly,
    hostId: sanitizedHost,
    embedTicket: embedTicketRaw,
  };
}

function readStoredEmbedConfig(): Omit<EmbedConfig, "embedTicket"> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(EMBED_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Omit<EmbedConfig, "embedTicket">> | null;
    if (!parsed || typeof parsed !== "object" || !parsed.embed) return null;
    const chrome: EmbedChromePreset =
      parsed.chrome === "minimal" || parsed.chrome === "none" || parsed.chrome === "full"
        ? parsed.chrome
        : "full";
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter(isEmbedHideTarget)
      : [];
    const flags = computeHiddenFlags(chrome, hidden);
    return {
      embed: Boolean(parsed.embed),
      chrome,
      ...flags,
      themeOverride:
        parsed.themeOverride === "light" ||
        parsed.themeOverride === "dark" ||
        parsed.themeOverride === "system"
          ? parsed.themeOverride
          : null,
      density: parsed.density === "compact" ? "compact" : "comfortable",
      readonly: Boolean(parsed.readonly),
      hostId: typeof parsed.hostId === "string" ? parsed.hostId : null,
    };
  } catch {
    return null;
  }
}

export function clearEmbedConfigStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(EMBED_CONFIG_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function resolveCurrentEmbedConfig(): EmbedConfig {
  if (typeof window === "undefined") {
    return DEFAULT_EMBED_CONFIG;
  }
  const params = new URLSearchParams(window.location.search);
  const embedParam = params.get("embed");
  if (isFalsyFlag(embedParam)) {
    clearEmbedConfigStorage();
    return DEFAULT_EMBED_CONFIG;
  }
  const stored = readStoredEmbedConfig();
  const resolved = parseEmbedConfigFromSearch(window.location.search, stored);
  if (resolved.embed) {
    try {
      const { embedTicket: _omit, ...persistable } = resolved;
      window.sessionStorage.setItem(EMBED_CONFIG_STORAGE_KEY, JSON.stringify(persistable));
    } catch {
      // ignore storage errors
    }
  }
  return resolved;
}

export function applyEmbedDatasetAttributes(config: Pick<EmbedConfig, "embed" | "density">): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (config.embed) {
    root.dataset.embed = "true";
  } else {
    delete root.dataset.embed;
  }
  if (config.density === "compact") {
    root.dataset.density = "compact";
  } else {
    delete root.dataset.density;
  }
}

export function isEmbedMode(): boolean {
  return resolveCurrentEmbedConfig().embed;
}

export function consumeEmbedTicketFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("embedTicket")) return;
  url.searchParams.delete("embedTicket");
  const nextUrl = `${url.pathname}${url.search ? url.search : ""}${url.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
  window.dispatchEvent(new CustomEvent(EMBED_CONFIG_CHANGE_EVENT));
}

export function useEmbedConfig(): EmbedConfig {
  const [config, setConfig] = useState<EmbedConfig>(() => resolveCurrentEmbedConfig());

  useEffect(() => {
    const sync = (): void => {
      const next = resolveCurrentEmbedConfig();
      setConfig(next);
      applyEmbedDatasetAttributes(next);
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener(EMBED_CONFIG_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(EMBED_CONFIG_CHANGE_EVENT, sync);
    };
  }, []);

  return config;
}
