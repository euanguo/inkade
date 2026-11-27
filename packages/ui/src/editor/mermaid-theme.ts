import createDOMPurify, { type DOMPurify, type WindowLike } from "dompurify";
import mermaid, { type MermaidConfig } from "mermaid";

let renderChain: Promise<void> = Promise.resolve();
const svgPurifyByWindow = new WeakMap<object, DOMPurify>();
const MAX_MERMAID_SVG_CACHE = 200;
const mermaidSvgCache = new Map<string, string>();
let offscreenMermaidHost: HTMLDivElement | null = null;

export function buildMermaidCacheKey(chart: string, theme: "light" | "dark"): string {
  return `v2:${theme}\0${chart.trim()}`;
}

export function getCachedMermaidSvg(key: string): string | undefined {
  const cached = mermaidSvgCache.get(key);
  if (cached === undefined) return undefined;
  mermaidSvgCache.delete(key);
  mermaidSvgCache.set(key, cached);
  return cached;
}

export function setCachedMermaidSvg(key: string, svg: string): void {
  if (!svg) return;
  if (mermaidSvgCache.has(key)) {
    mermaidSvgCache.delete(key);
  } else if (mermaidSvgCache.size >= MAX_MERMAID_SVG_CACHE) {
    const oldestKey = mermaidSvgCache.keys().next().value;
    if (oldestKey !== undefined) {
      mermaidSvgCache.delete(oldestKey);
    }
  }
  mermaidSvgCache.set(key, svg);
}

function getOffscreenMermaidHost(): HTMLDivElement | undefined {
  if (typeof document === "undefined" || !document.body) return undefined;
  if (offscreenMermaidHost && document.body.contains(offscreenMermaidHost)) {
    return offscreenMermaidHost;
  }
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dataset.slot = "mermaid-offscreen-host";
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;width:4096px;min-height:1px;visibility:hidden;pointer-events:none;z-index:-1;";
  document.body.appendChild(host);
  offscreenMermaidHost = host;
  return host;
}

const MERMAID_FORBIDDEN_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "meta",
  "link",
  "base",
  "audio",
  "video",
  "canvas",
];

const MERMAID_FORBIDDEN_ATTRS = ["srcdoc"];

/**
 * Sanitizes Mermaid-generated SVG markup with DOMPurify's SVG profile while preserving
 * HTML integration `<foreignObject>` label nodes used by Mermaid diagrams.
 * Fails closed (`""`) when no supported DOM window is available.
 */
export function sanitizeMermaidSvg(rawSvg: string, win?: WindowLike): string {
  if (!rawSvg.trim()) return "";
  const targetWin: WindowLike | undefined = win ?? (typeof window !== "undefined" ? window : undefined);
  if (!targetWin) return "";

  let purify = svgPurifyByWindow.get(targetWin);
  if (!purify) {
    purify = createDOMPurify(targetWin);
    if (!purify.isSupported) return "";
    svgPurifyByWindow.set(targetWin, purify);
  }

  return purify.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ["foreignObject"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: MERMAID_FORBIDDEN_TAGS,
    FORBID_ATTR: MERMAID_FORBIDDEN_ATTRS,
  });
}

const LIGHT_MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  themeVariables: {
    darkMode: false,
    background: "transparent",
    fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
    primaryColor: "#f4f4f5",
    primaryTextColor: "#18181b",
    primaryBorderColor: "#a1a1aa",
    secondaryColor: "#fafafa",
    secondaryTextColor: "#27272a",
    secondaryBorderColor: "#d4d4d8",
    tertiaryColor: "#ffffff",
    tertiaryTextColor: "#27272a",
    tertiaryBorderColor: "#d4d4d8",
    lineColor: "#52525b",
    textColor: "#18181b",
    mainBkg: "#f4f4f5",
    nodeBkg: "#f4f4f5",
    nodeBorder: "#a1a1aa",
    clusterBkg: "#fafafa",
    clusterBorder: "#d4d4d8",
    edgeLabelBackground: "#ffffff",
    labelBackground: "#ffffff",
    titleColor: "#18181b",
    nodeTextColor: "#18181b",
    actorBkg: "#f4f4f5",
    actorBorder: "#a1a1aa",
    actorTextColor: "#18181b",
    signalColor: "#52525b",
    signalTextColor: "#18181b",
    labelBoxBkgColor: "#ffffff",
    labelBoxBorderColor: "#d4d4d8",
    labelTextColor: "#18181b",
  },
  themeCSS: [
    ".edgeLabel span, .edgeLabel p, .edgeLabel text, .nodeLabel, .label { color: #18181b !important; fill: #18181b !important; }",
    ".edgeLabel rect, .edgeLabel .labelBkg { fill: #ffffff !important; background-color: #ffffff !important; opacity: 0.96 !important; }",
    ".arrowheadPath, .flowchart-link { stroke: #52525b !important; }",
  ].join(" "),
};

const DARK_MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  themeVariables: {
    darkMode: true,
    background: "transparent",
    fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
    primaryColor: "#262a34",
    primaryTextColor: "#f4f4f5",
    primaryBorderColor: "#636c7e",
    secondaryColor: "#1f232c",
    secondaryTextColor: "#e4e4e7",
    secondaryBorderColor: "#4b5263",
    tertiaryColor: "#181a20",
    tertiaryTextColor: "#e4e4e7",
    tertiaryBorderColor: "#4b5263",
    lineColor: "#a1a1aa",
    textColor: "#f4f4f5",
    mainBkg: "#262a34",
    nodeBkg: "#262a34",
    nodeBorder: "#636c7e",
    clusterBkg: "#1a1c22",
    clusterBorder: "#4b5263",
    edgeLabelBackground: "#1e2026",
    labelBackground: "#1e2026",
    titleColor: "#f4f4f5",
    nodeTextColor: "#f4f4f5",
    actorBkg: "#262a34",
    actorBorder: "#636c7e",
    actorTextColor: "#f4f4f5",
    signalColor: "#d4d4d8",
    signalTextColor: "#f4f4f5",
    labelBoxBkgColor: "#262a34",
    labelBoxBorderColor: "#636c7e",
    labelTextColor: "#f4f4f5",
    noteBkgColor: "#2e2a1f",
    noteBorderColor: "#a16207",
    noteTextColor: "#fef3c7",
  },
  themeCSS: [
    ".edgeLabel span, .edgeLabel p, .edgeLabel text, .nodeLabel, .label, text.messageText, .actor tspan { color: #f4f4f5 !important; fill: #f4f4f5 !important; }",
    ".edgeLabel rect, .edgeLabel .labelBkg { fill: #1e2026 !important; background-color: #1e2026 !important; opacity: 0.96 !important; }",
    ".arrowheadPath, .flowchart-link { stroke: #a1a1aa !important; }",
    ".marker { fill: #a1a1aa !important; stroke: #a1a1aa !important; }",
  ].join(" "),
};

/**
 * Serializes Mermaid initialization and SVG rendering through a FIFO queue so
 * concurrent light/dark diagram renders never race on Mermaid's global config.
 */
export function renderMermaidDiagram(
  renderId: string,
  chart: string,
  theme: "light" | "dark",
): Promise<string> {
  const task = renderChain.then(async () => {
    const baseConfig = theme === "dark" ? DARK_MERMAID_CONFIG : LIGHT_MERMAID_CONFIG;
    mermaid.initialize({ ...baseConfig, securityLevel: "strict" });
    const host = getOffscreenMermaidHost();
    try {
      const result = host
        ? await mermaid.render(renderId, chart, host)
        : await mermaid.render(renderId, chart);
      return sanitizeMermaidSvg(result.svg);
    } finally {
      host?.replaceChildren();
    }
  });
  renderChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
