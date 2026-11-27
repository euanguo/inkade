import {
  matchClipperTrigger,
  type ClipperTemplate,
  type ClipperTemplateTrigger,
  type SpaceId,
} from "@inkade/core";
import { Liquid, type Context, type Emitter, type TagToken } from "liquidjs";
import type { ExtractedArticle, ExtractedHighlightAnchor } from "../extractor.ts";
import {
  normalizeFilterSegmentForLiquid,
  registerInkadeLiquidFilters,
  stringifyTemplateValue,
} from "./filters.ts";

export interface TemplateRenderContext {
  readonly article: ExtractedArticle;
  readonly doc?: Document | null | undefined;
  readonly selection?: ExtractedHighlightAnchor | null | undefined;
  readonly selectionMarkdown?: string | undefined;
  readonly highlights?: readonly {
    readonly quote: string;
    readonly color: string;
    readonly noteMarkdown?: string | undefined;
  }[] | undefined;
  readonly now?: Date | undefined;
}

export interface PendingAiPrompt {
  readonly placeholder: string;
  readonly prompt: string;
}

export interface RenderedClipPlan {
  readonly title: string;
  readonly contentMarkdown: string;
  readonly tags: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
  readonly targetSpaceId?: SpaceId | "" | undefined;
  readonly appendToDaily: boolean;
  readonly dailyLine: string;
  readonly mirrorImages: boolean;
  readonly saveHtmlSnapshot: boolean;
  readonly pendingPrompts: readonly PendingAiPrompt[];
}

function triggerSpecificityWeight(type: ClipperTemplateTrigger["type"]): number {
  if (type === "regex") return 40;
  if (type === "schema-type") return 30;
  if (type === "glob") return 20;
  return 10;
}

export function matchTemplateForPage(
  templates: readonly ClipperTemplate[],
  context: { readonly url: string; readonly schemaTypes?: readonly string[] | undefined },
): { readonly template: ClipperTemplate | null; readonly autoMatched: boolean } {
  const enabled = templates.filter((t) => t.enabled);
  if (enabled.length === 0) return { template: null, autoMatched: false };

  let bestMatch: { template: ClipperTemplate; score: number } | null = null;
  for (const tpl of enabled) {
    if (tpl.triggers.length === 0) continue;
    let maxTriggerWeight = -1;
    for (const trigger of tpl.triggers) {
      if (matchClipperTrigger(trigger, context)) {
        maxTriggerWeight = Math.max(maxTriggerWeight, triggerSpecificityWeight(trigger.type));
      }
    }
    if (maxTriggerWeight >= 0) {
      const score = tpl.priority * 100 + maxTriggerWeight;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { template: tpl, score };
      }
    }
  }

  if (bestMatch) {
    return { template: bestMatch.template, autoMatched: true };
  }

  const fallback =
    enabled.find((t) => t.triggers.length === 0) ??
    [...enabled].sort((a, b) => b.priority - a.priority)[0] ??
    null;

  return { template: fallback, autoMatched: false };
}

function getNestedValue(target: unknown, dottedPath: string): unknown {
  if (!target || typeof target !== "object") return undefined;
  const parts = dottedPath.split(".").filter(Boolean);
  let curr: unknown = target;
  for (const part of parts) {
    if (curr === null || curr === undefined) return undefined;
    if (Array.isArray(curr)) {
      const idx = Number.parseInt(part, 10);
      if (!Number.isNaN(idx)) {
        curr = curr[idx];
      } else {
        curr = (curr[0] as Record<string, unknown> | undefined)?.[part];
      }
      continue;
    }
    if (typeof curr === "object") {
      curr = (curr as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return curr;
}

function formatHighlightsList(
  highlights: TemplateRenderContext["highlights"],
): string {
  if (!highlights || highlights.length === 0) return "";
  return highlights
    .map((h) => {
      const quoteBlock = `> ${h.quote.replace(/\n/g, "\n> ")}`;
      return h.noteMarkdown?.trim()
        ? `${quoteBlock}\n>\n> *${h.noteMarkdown.trim()}*`
        : quoteBlock;
    })
    .join("\n\n");
}

export function buildBaseVariableMap(ctx: TemplateRenderContext): Record<string, unknown> {
  const now = ctx.now ?? new Date();
  const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return {
    title: ctx.article.title,
    url: ctx.article.url,
    domain: ctx.article.meta.domain,
    author: ctx.article.meta.author ?? "",
    published: ctx.article.meta.published ?? "",
    description: ctx.article.meta.description ?? ctx.article.excerpt,
    excerpt: ctx.article.excerpt,
    site: ctx.article.meta.site ?? ctx.article.meta.domain,
    date: isoDate,
    time: timeStr,
    now: now.toISOString(),
    content: ctx.article.markdown,
    selection: ctx.selectionMarkdown?.trim() || ctx.selection?.quote || "",
    highlights: formatHighlightsList(ctx.highlights),
    highlightList: (ctx.highlights ?? []).map((h) => h.quote),
    words: String(ctx.article.meta.wordCount ?? 0),
    image: ctx.article.meta.image ?? ctx.article.imageUrls[0] ?? "",
    images: [...ctx.article.imageUrls],
    extractor: ctx.article.extractor,
    transcript: ctx.article.variables.transcript ?? "",
    adapter: ctx.article.variables.adapter ?? "",
    ...ctx.article.variables,
  };
}

function resolveDynamicLookup(expr: string, ctx?: TemplateRenderContext): unknown {
  if (!ctx) return "";
  const trimmed = expr.trim();

  if (trimmed.startsWith("selector:") && ctx.doc) {
    const css = trimmed.slice("selector:".length).trim();
    try {
      const matches = Array.from(ctx.doc.querySelectorAll(css));
      if (matches.length <= 1) return matches[0]?.textContent?.trim() ?? "";
      return matches.map((el) => el.textContent?.trim() ?? "").filter(Boolean);
    } catch {
      return "";
    }
  }

  if (trimmed.startsWith("selectorHtml:") && ctx.doc) {
    const css = trimmed.slice("selectorHtml:".length).trim();
    try {
      return ctx.doc.querySelector(css)?.innerHTML?.trim() ?? "";
    } catch {
      return "";
    }
  }

  if (trimmed.startsWith("meta:") && ctx.doc) {
    const metaKey = trimmed.slice("meta:".length).trim();
    const safeKey = metaKey.replace(/"/g, '\\"');
    const el =
      ctx.doc.querySelector(`meta[name="${safeKey}"]`) ??
      ctx.doc.querySelector(`meta[property="${safeKey}"]`);
    return el?.getAttribute("content")?.trim() ?? "";
  }

  if (trimmed.startsWith("schema:")) {
    const rawPath = trimmed.slice("schema:".length).trim();
    const schemaData = ctx.article.meta.schemaOrgData;
    const typedMatch = /^@([^.]+)\.(.+)$/.exec(rawPath);
    if (typedMatch) {
      const targetType = typedMatch[1]!.toLowerCase();
      const nestedPath = typedMatch[2]!;
      const items = Array.isArray(schemaData) ? schemaData : schemaData ? [schemaData] : [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const rawType = (item as Record<string, unknown>)["@type"];
        const types = Array.isArray(rawType) ? rawType : rawType ? [rawType] : [];
        if (types.some((t) => String(t).toLowerCase() === targetType)) {
          const val = getNestedValue(item, nestedPath);
          if (val !== undefined) return val;
        }
      }
      return "";
    }
    if (Array.isArray(schemaData)) {
      for (const item of schemaData) {
        const val = getNestedValue(item, rawPath);
        if (val !== undefined) return val;
      }
      return "";
    }
    return getNestedValue(schemaData, rawPath) ?? "";
  }

  return "";
}

function splitTopLevelPipes(expr: string): string[] {
  const parts: string[] = [];
  let curr = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;
    if (quote) {
      if (ch === "\\" && i + 1 < expr.length) {
        curr += ch + expr[++i]!;
        continue;
      }
      if (ch === quote) quote = null;
      curr += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      curr += ch;
      continue;
    }
    if (ch === "|") {
      parts.push(curr.trim());
      curr = "";
      continue;
    }
    curr += ch;
  }
  if (curr.trim() || parts.length > 0) {
    parts.push(curr.trim());
  }
  return parts;
}

const DYNAMIC_PREFIX_RE = /^(?:selectorHtml|selector|meta|schema):/;
const INLINE_DYNAMIC_TOKEN_RE = /\b(selectorHtml|selector|meta|schema):([^\s|"'=!<>&]+)/g;

function normalizeOutputInner(
  inner: string,
  registerDynamic: (rawExpr: string) => string,
): string {
  const trimmed = inner.trim();
  const promptMatch = /^(?:"((?:[^"\\]|\\.)+)"|'((?:[^'\\]|\\.)+)')(?:\s*\|([\s\S]+))?$/.exec(trimmed);
  if (promptMatch) {
    const literal = promptMatch[1] !== undefined ? `"${promptMatch[1]}"` : `'${promptMatch[2] ?? ""}'`;
    return `{% inkade_prompt ${literal} %}`;
  }

  const segments = splitTopLevelPipes(trimmed);
  const baseExpr = (segments[0] ?? "").trim();
  const normalizedBase = DYNAMIC_PREFIX_RE.test(baseExpr)
    ? registerDynamic(baseExpr)
    : baseExpr;
  const normalizedFilters = segments
    .slice(1)
    .map((seg) => normalizeFilterSegmentForLiquid(seg))
    .filter(Boolean);

  return normalizedFilters.length > 0
    ? `{{ ${normalizedBase} | ${normalizedFilters.join(" | ")} }}`
    : `{{ ${normalizedBase} }}`;
}

function normalizeTagInner(
  inner: string,
  branchStack: Array<"if" | "unless">,
  registerDynamic: (rawExpr: string) => string,
): string {
  const trimmed = inner.trim();
  const replaceDynamicTokens = (expr: string): string => {
    let out = "";
    let quote: '"' | "'" | null = null;
    let cursor = 0;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i]!;
      if (quote) {
        if (ch === "\\" && i + 1 < expr.length) {
          i++;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const segment = expr.slice(cursor, i);
        out += segment.replace(INLINE_DYNAMIC_TOKEN_RE, (full) => registerDynamic(full));
        cursor = i;
        quote = ch;
        continue;
      }
    }
    const tail = expr.slice(cursor);
    out += quote ? tail : tail.replace(INLINE_DYNAMIC_TOKEN_RE, (full) => registerDynamic(full));
    return out;
  };

  if (trimmed.startsWith("if ")) {
    const cond = trimmed.slice(3).trim();
    if (cond.startsWith("!")) {
      branchStack.push("unless");
      return `{% unless ${replaceDynamicTokens(cond.slice(1).trim())} %}`;
    }
    branchStack.push("if");
    return `{% if ${replaceDynamicTokens(cond)} %}`;
  }

  if (trimmed === "endif") {
    const kind = branchStack.pop() ?? "if";
    return kind === "unless" ? "{% endunless %}" : "{% endif %}";
  }

  if (trimmed.startsWith("elsif ")) {
    return `{% elsif ${replaceDynamicTokens(trimmed.slice(6).trim())} %}`;
  }

  if (trimmed.startsWith("unless ")) {
    branchStack.push("unless");
    return `{% unless ${replaceDynamicTokens(trimmed.slice(7).trim())} %}`;
  }

  if (trimmed === "endunless") {
    branchStack.pop();
    return "{% endunless %}";
  }

  if (trimmed.startsWith("for ")) {
    const forMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+(.+)$/.exec(trimmed.slice(4).trim());
    if (forMatch) {
      const loopVar = forMatch[1]!;
      const listExpr = forMatch[2]!.trim();
      const normalizedList = DYNAMIC_PREFIX_RE.test(listExpr)
        ? registerDynamic(listExpr)
        : replaceDynamicTokens(listExpr);
      return `{% for ${loopVar} in ${normalizedList} %}`;
    }
  }

  return `{% ${trimmed} %}`;
}

function findMatchingDelimiter(
  template: string,
  startIdx: number,
  closeSeq: "}}" | "%}",
): number {
  let quote: '"' | "'" | null = null;
  for (let i = startIdx; i < template.length - 1; i++) {
    const ch = template[i]!;
    if (quote) {
      if (ch === "\\" && i + 1 < template.length) {
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
    if (ch === closeSeq[0] && template[i + 1] === closeSeq[1]) {
      return i;
    }
  }
  return -1;
}

function prepareLiquidTemplate(
  template: string,
  ctx?: TemplateRenderContext,
): { readonly source: string; readonly dynamicScope: Record<string, unknown> } {
  const dynamicScope: Record<string, unknown> = {};
  const dynamicByExpr = new Map<string, string>();
  let dynCounter = 0;
  const registerDynamic = (rawExpr: string): string => {
    const key = rawExpr.trim();
    const existing = dynamicByExpr.get(key);
    if (existing) return existing;
    const varName = `__inkade_dyn_${dynCounter++}`;
    dynamicByExpr.set(key, varName);
    dynamicScope[varName] = resolveDynamicLookup(key, ctx);
    return varName;
  };

  const branchStack: Array<"if" | "unless"> = [];
  let out = "";
  let i = 0;

  while (i < template.length) {
    if (template.startsWith("{{", i)) {
      const endIdx = findMatchingDelimiter(template, i + 2, "}}");
      if (endIdx !== -1) {
        const inner = template.slice(i + 2, endIdx);
        out += normalizeOutputInner(inner, registerDynamic);
        i = endIdx + 2;
        continue;
      }
    }
    if (template.startsWith("{%", i)) {
      const endIdx = findMatchingDelimiter(template, i + 2, "%}");
      if (endIdx !== -1) {
        const inner = template.slice(i + 2, endIdx);
        out += normalizeTagInner(inner, branchStack, registerDynamic);
        i = endIdx + 2;
        continue;
      }
    }
    out += template[i]!;
    i++;
  }

  return { source: out, dynamicScope };
}

const PROMPT_COLLECTOR_KEY = "__inkadePromptsOut";

/**
 * Creates a sandboxed LiquidJS engine configured with all Inkade clipping filters
 * and the `inkade_prompt` deferred AI prompt tag.
 */
export function createInkadeLiquidEngine(): Liquid {
  const engine = new Liquid({
    ownPropertyOnly: true,
    jsTruthy: true,
    strictFilters: false,
    strictVariables: false,
    parseLimit: 1_000_000,
    renderLimit: 5000,
    memoryLimit: 50_000_000,
    outputEscape: stringifyTemplateValue,
  });

  registerInkadeLiquidFilters(engine);

  const promptArgs = new WeakMap<TagToken, string>();

  engine.registerTag("inkade_prompt", {
    parse(tagToken: TagToken) {
      promptArgs.set(tagToken, tagToken.args.trim());
    },
    render(ctx: Context, emitter: Emitter) {
      const tokenRef = (this as { readonly token?: TagToken }).token;
      const rawArg = (tokenRef ? promptArgs.get(tokenRef) : undefined) ?? "";
      let promptText = rawArg;
      if (
        (rawArg.startsWith('"') && rawArg.endsWith('"')) ||
        (rawArg.startsWith("'") && rawArg.endsWith("'"))
      ) {
        promptText = rawArg.slice(1, -1).replace(/\\(.)/g, "$1");
      }
      promptText = promptText.trim();
      const prompts = ctx.globals[PROMPT_COLLECTOR_KEY] as PendingAiPrompt[] | undefined;
      const idx = prompts ? prompts.length : 0;
      const placeholder = `<!--inkade-ai-prompt:${idx}-->`;
      if (prompts) {
        prompts.push({ placeholder, prompt: promptText });
      }
      emitter.write(placeholder);
    },
  });

  return engine;
}

const sharedLiquidEngine = createInkadeLiquidEngine();

/**
 * Renders a Liquid template string against a flat variable dictionary (used by both server and clipper).
 */
export function renderTemplateVariables(
  content: string,
  vars: Readonly<Record<string, unknown>>,
): string {
  const { source, dynamicScope } = prepareLiquidTemplate(content);
  const rendered: unknown = sharedLiquidEngine.parseAndRenderSync(source, {
    ...vars,
    ...dynamicScope,
  });
  return stringifyTemplateValue(rendered);
}

function renderPreparedBlock(
  template: string,
  vars: Readonly<Record<string, unknown>>,
  ctx: TemplateRenderContext,
  promptsOut: PendingAiPrompt[],
): string {
  const { source, dynamicScope } = prepareLiquidTemplate(template, ctx);
  const rendered: unknown = sharedLiquidEngine.parseAndRenderSync(
    source,
    { ...vars, ...dynamicScope },
    {
      globals: {
        [PROMPT_COLLECTOR_KEY]: promptsOut,
      },
    },
  );
  return stringifyTemplateValue(rendered);
}

function coercePropertyValue(
  rawText: string,
  type: "text" | "number" | "boolean" | "list" | "date",
): unknown {
  const trimmed = rawText.trim();
  if (type === "number") {
    const parsed = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : trimmed;
  }
  if (type === "boolean") {
    return trimmed === "true" || trimmed === "1" || trimmed === "yes";
  }
  if (type === "list") {
    return trimmed
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return trimmed;
}

/**
 * Compiles a ClipperTemplate against an extracted page context using LiquidJS,
 * producing the ready-to-sync plan plus any pending AI prompt placeholders.
 */
export function renderClipTemplate(
  template: ClipperTemplate,
  ctx: TemplateRenderContext,
): RenderedClipPlan {
  const vars = buildBaseVariableMap(ctx);
  const promptsOut: PendingAiPrompt[] = [];

  const title =
    renderPreparedBlock(template.titleTemplate, vars, ctx, promptsOut).trim() ||
    ctx.article.title.trim();
  const resolvedVars = { ...vars, title };
  const contentMarkdown = renderPreparedBlock(
    template.contentTemplate,
    resolvedVars,
    ctx,
    promptsOut,
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const tagsRaw = renderPreparedBlock(template.tagsTemplate, resolvedVars, ctx, promptsOut);
  const tags = [
    ...new Set(
      tagsRaw
        .split(/[,，\n]/)
        .map((t) => t.trim().replace(/^#+/, ""))
        .filter(Boolean),
    ),
  ];

  const properties: Record<string, unknown> = {};
  for (const prop of template.properties) {
    const evaluated = renderPreparedBlock(prop.valueTemplate, resolvedVars, ctx, promptsOut);
    if (evaluated.trim().length > 0) {
      properties[prop.key] = coercePropertyValue(evaluated, prop.type);
    }
  }

  const dailyLine = renderPreparedBlock(
    template.dailyLineTemplate,
    resolvedVars,
    ctx,
    promptsOut,
  ).trim();

  return {
    title,
    contentMarkdown,
    tags,
    properties,
    targetSpaceId: template.targetSpaceId,
    appendToDaily: template.appendToDaily,
    dailyLine,
    mirrorImages: template.mirrorImages,
    saveHtmlSnapshot: template.saveHtmlSnapshot,
    pendingPrompts: promptsOut,
  };
}
