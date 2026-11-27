import { Liquid } from "liquidjs";
import { htmlToInkadeMarkdown } from "../markdown.ts";

export function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyTemplateValue(item)).join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value as unknown[];
  const s = stringifyTemplateValue(value);
  if (!s.trim()) return [];
  if (s.includes("\n")) {
    return s.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  return s.split(",").map((part) => part.trim()).filter(Boolean);
}

function formatDateToken(raw: unknown, fmtArg?: unknown): string {
  const s = stringifyTemplateValue(raw).trim();
  const parsed = s ? new Date(s) : new Date();
  if (Number.isNaN(parsed.getTime())) return s;

  const fmt = fmtArg !== undefined ? stringifyTemplateValue(fmtArg).trim() || "YYYY-MM-DD" : "YYYY-MM-DD";
  if (fmt.toUpperCase() === "ISO") return parsed.toISOString();

  const yyyy = String(parsed.getFullYear());
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  const ss = String(parsed.getSeconds()).padStart(2, "0");

  return fmt
    .replace(/YYYY/g, yyyy)
    .replace(/MM/g, mm)
    .replace(/DD/g, dd)
    .replace(/HH/g, hh)
    .replace(/mm/g, min)
    .replace(/ss/g, ss);
}

type LiquidFilterImpl = (...args: unknown[]) => unknown;

export const INKADE_LIQUID_FILTERS: Readonly<Record<string, LiquidFilterImpl>> = {
  trim: (val) => stringifyTemplateValue(val).trim(),
  lower: (val) => stringifyTemplateValue(val).toLowerCase(),
  upper: (val) => stringifyTemplateValue(val).toUpperCase(),
  capitalize: (val) => {
    const s = stringifyTemplateValue(val);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  },
  title: (val) =>
    stringifyTemplateValue(val).replace(/\b\w/g, (ch) => ch.toUpperCase()),
  replace: (val, search, replacement) => {
    const s = stringifyTemplateValue(val);
    const needle = stringifyTemplateValue(search);
    const next = stringifyTemplateValue(replacement);
    if (!needle) return s;
    return s.split(needle).join(next);
  },
  slice: (val, startArg, endArg) => {
    const start = Number.parseInt(stringifyTemplateValue(startArg) || "0", 10) || 0;
    const end =
      endArg !== undefined && endArg !== null
        ? Number.parseInt(stringifyTemplateValue(endArg), 10)
        : undefined;
    if (Array.isArray(val)) return (val as unknown[]).slice(start, end);
    return stringifyTemplateValue(val).slice(start, end);
  },
  truncate: (val, lenArg) => {
    const maxLen = Math.max(1, Number.parseInt(stringifyTemplateValue(lenArg) || "140", 10) || 140);
    const s = stringifyTemplateValue(val).trim();
    return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
  },
  strip_tags: (val) =>
    stringifyTemplateValue(val)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  markdown: (val) => htmlToInkadeMarkdown(stringifyTemplateValue(val)),
  blockquote: (val) => {
    const s = stringifyTemplateValue(val).trim();
    if (!s) return "";
    return s
      .split(/\r?\n/)
      .map((line) => (line.trim() ? `> ${line}` : ">"))
      .join("\n");
  },
  callout: (val, kindArg) => {
    const kind = (stringifyTemplateValue(kindArg) || "NOTE").trim().toUpperCase() || "NOTE";
    const body = stringifyTemplateValue(val).trim();
    if (!body) return "";
    const quoted = body
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n");
    return `> [!${kind}]\n${quoted}`;
  },
  wikilink: (val) => {
    const s = stringifyTemplateValue(val).trim();
    if (!s) return "";
    return s.startsWith("[[") && s.endsWith("]]") ? s : `[[${s}]]`;
  },
  slug: (val) =>
    stringifyTemplateValue(val)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, ""),
  encode_uri: (val) => encodeURIComponent(stringifyTemplateValue(val)),
  split: (val, sepArg) => {
    const sep = sepArg !== undefined ? stringifyTemplateValue(sepArg) : ",";
    return stringifyTemplateValue(val)
      .split(sep)
      .map((x) => x.trim())
      .filter(Boolean);
  },
  join: (val, sepArg) => {
    const sep = sepArg !== undefined ? stringifyTemplateValue(sepArg) : ", ";
    return asArray(val).map((x) => stringifyTemplateValue(x)).join(sep);
  },
  first: (val) => asArray(val)[0] ?? "",
  last: (val) => {
    const arr = asArray(val);
    return arr[arr.length - 1] ?? "";
  },
  length: (val) => (Array.isArray(val) ? val.length : stringifyTemplateValue(val).length),
  unique: (val) => [...new Set(asArray(val).map((x) => stringifyTemplateValue(x)))],
  map: (val, tplArg) => {
    const tpl = tplArg !== undefined ? stringifyTemplateValue(tplArg) : "{{item}}";
    return asArray(val).map((item) => tpl.replace(/\{\{\s*item\s*\}\}/g, stringifyTemplateValue(item)));
  },
  default: (val, fallbackArg) => {
    const fallback = fallbackArg !== undefined ? fallbackArg : "";
    if (val === null || val === undefined) return fallback;
    if (Array.isArray(val)) return val.length > 0 ? val : fallback;
    return stringifyTemplateValue(val).trim() ? val : fallback;
  },
  json: (val) => JSON.stringify(val ?? null, null, 2),
  date: (val, fmtArg) => formatDateToken(val, fmtArg),
};

export function registerInkadeLiquidFilters(engine: Liquid): void {
  for (const [name, impl] of Object.entries(INKADE_LIQUID_FILTERS)) {
    engine.registerFilter(name, impl);
  }
}

/**
 * Normalizes colon-delimited filter arguments (`replace:"a":"b"`, `slice:0:5`)
 * into standard Liquid comma-delimited syntax (`replace:"a", "b"`, `slice:0, 5`)
 * while preserving colons inside string literals.
 */
export function normalizeFilterSegmentForLiquid(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return "";

  let firstColon = -1;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (quote) {
      if (ch === "\\" && i + 1 < trimmed.length) {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ":") {
      firstColon = i;
      break;
    }
  }

  if (firstColon === -1) return trimmed;
  const name = trimmed.slice(0, firstColon).trim();
  const rest = trimmed.slice(firstColon + 1).trim();
  let normalizedArgs = "";
  quote = null;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (quote) {
      if (ch === "\\" && i + 1 < rest.length) {
        normalizedArgs += ch + rest[i + 1]!;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      normalizedArgs += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      normalizedArgs += ch;
      continue;
    }
    if (ch === ":") {
      normalizedArgs += ", ";
      continue;
    }
    normalizedArgs += ch;
  }

  return `${name}: ${normalizedArgs}`;
}

const sharedFilterLiquidEngine = new Liquid({
  ownPropertyOnly: true,
  jsTruthy: true,
  strictFilters: false,
  strictVariables: false,
  outputEscape: stringifyTemplateValue,
});
registerInkadeLiquidFilters(sharedFilterLiquidEngine);

/**
 * Evaluates a list of Inkade Liquid filter expressions against `initialValue` via LiquidJS.
 */
export function applyFilterPipeline(initialValue: unknown, filterExprs: readonly string[]): string {
  const normalized = filterExprs
    .map((expr) => normalizeFilterSegmentForLiquid(expr))
    .filter(Boolean);
  if (normalized.length === 0) {
    return stringifyTemplateValue(initialValue);
  }
  const rendered: unknown = sharedFilterLiquidEngine.parseAndRenderSync(
    `{{ __input | ${normalized.join(" | ")} }}`,
    { __input: initialValue },
  );
  return stringifyTemplateValue(rendered);
}
