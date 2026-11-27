import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export type ShikiThemeKind = "light" | "dark";

export const PRIORITY_SHIKI_LANGUAGES: readonly string[] = [
  "plaintext",
  "mermaid",
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "bash",
  "json",
  "sql",
  "css",
  "html",
  "markdown",
  "yaml",
  "rust",
  "go",
  "java",
  "cpp",
  "c",
  "diff",
];

type ShikiLangImporter = () => Promise<{ readonly default: LanguageRegistration[] }>;

const SHIKI_LANGUAGE_LOADERS: Readonly<Record<string, ShikiLangImporter>> = {
  astro: () => import("shiki/langs/astro.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  clojure: () => import("shiki/langs/clojure.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  elixir: () => import("shiki/langs/elixir.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  haskell: () => import("shiki/langs/haskell.mjs"),
  hcl: () => import("shiki/langs/hcl.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  latex: () => import("shiki/langs/latex.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  makefile: () => import("shiki/langs/makefile.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  nginx: () => import("shiki/langs/nginx.mjs"),
  nix: () => import("shiki/langs/nix.mjs"),
  objectivec: () => import("shiki/langs/objective-c.mjs"),
  perl: () => import("shiki/langs/perl.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  prisma: () => import("shiki/langs/prisma.mjs"),
  proto: () => import("shiki/langs/proto.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  regex: () => import("shiki/langs/regex.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  scala: () => import("shiki/langs/scala.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  wasm: () => import("shiki/langs/wasm.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  zig: () => import("shiki/langs/zig.mjs"),
};

const SHIKI_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  text: "plaintext",
  txt: "plaintext",
  plain: "plaintext",
  plaintext: "plaintext",
  mermaid: "mermaid",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  python3: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  shellscript: "bash",
  yml: "yaml",
  md: "markdown",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  "c#": "csharp",
  rs: "rust",
  rb: "ruby",
  kt: "kotlin",
  kts: "kotlin",
  objc: "objectivec",
  "objective-c": "objectivec",
  tex: "latex",
  docker: "dockerfile",
  gql: "graphql",
  make: "makefile",
  ps1: "powershell",
  pwsh: "powershell",
  svg: "xml",
  terraform: "hcl",
  tf: "hcl",
  protobuf: "proto",
  json5: "jsonc",
  clj: "clojure",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  pl: "perl",
  htm: "html",
};

export const SHIKI_SUPPORTED_LANGUAGES: readonly string[] = (() => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const lang of [...PRIORITY_SHIKI_LANGUAGES, ...Object.keys(SHIKI_LANGUAGE_LOADERS).sort()]) {
    if (!seen.has(lang)) {
      seen.add(lang);
      ordered.push(lang);
    }
  }
  return ordered;
})();

const MAX_SHIKI_CACHE_ENTRIES = 200;
const MAX_HIGHLIGHT_CHAR_LENGTH = 40_000;

const shikiHtmlCache = new Map<string, string>();
const shikiTokensCache = new Map<string, readonly (readonly ThemedToken[])[]>();
const loadedLanguages = new Set<string>(["plaintext", "text"]);
const inFlightLanguageLoads = new Map<string, Promise<string>>();

let highlighterInstance: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;

function setBoundedCache<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_SHIKI_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

/**
 * Resolves a code block language label or alias to a canonical Shiki language identifier.
 */
export function resolveShikiLanguage(rawLang: string | null | undefined): string {
  const cleaned = (rawLang ?? "").trim().toLowerCase();
  if (!cleaned) return "plaintext";
  const aliased = SHIKI_LANGUAGE_ALIASES[cleaned] ?? cleaned;
  if (aliased === "plaintext" || aliased === "mermaid") {
    return aliased;
  }
  return aliased in SHIKI_LANGUAGE_LOADERS ? aliased : "plaintext";
}

/**
 * Lazily creates and caches the singleton `shiki/core` highlighter with JS regex engine
 * and light/dark GitHub themes, avoiding eager grammar loading and WASM bundling.
 */
export async function getShikiHighlighter(): Promise<HighlighterCore> {
  if (highlighterInstance) {
    return highlighterInstance;
  }
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [lightThemeMod, darkThemeMod] = await Promise.all([
        import("shiki/themes/github-light.mjs"),
        import("shiki/themes/github-dark.mjs"),
      ]);
      const hl = await createHighlighterCore({
        themes: [lightThemeMod.default, darkThemeMod.default],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
      highlighterInstance = hl;
      return hl;
    })();
  }
  return highlighterPromise;
}

/**
 * Loads the requested Shiki language grammar on demand, deduplicating concurrent imports.
 */
export async function ensureShikiLanguage(
  rawLang: string | null | undefined,
): Promise<{ readonly highlighter: HighlighterCore; readonly lang: string }> {
  const highlighter = await getShikiHighlighter();
  const canonical = resolveShikiLanguage(rawLang);
  if (canonical === "plaintext" || canonical === "mermaid") {
    return { highlighter, lang: "text" };
  }
  if (loadedLanguages.has(canonical)) {
    return { highlighter, lang: canonical };
  }

  let pending = inFlightLanguageLoads.get(canonical);
  if (!pending) {
    const loader = SHIKI_LANGUAGE_LOADERS[canonical];
    if (!loader) {
      return { highlighter, lang: "text" };
    }
    pending = loader()
      .then(async (mod) => {
        await highlighter.loadLanguage(mod.default);
        loadedLanguages.add(canonical);
        return canonical;
      })
      .catch(() => "text")
      .finally(() => {
        inFlightLanguageLoads.delete(canonical);
      });
    inFlightLanguageLoads.set(canonical, pending);
  }

  const resolved = await pending;
  return { highlighter, lang: resolved };
}

export function getCachedShikiHtml(
  code: string,
  language: string,
  theme: ShikiThemeKind,
): string | null {
  const canonical = resolveShikiLanguage(language);
  const cacheKey = `${theme}\0${canonical}\0${code}`;
  return shikiHtmlCache.get(cacheKey) ?? null;
}

/**
 * Highlights a code snippet to standalone HTML using the shared lazy `shiki/core` engine.
 */
export async function highlightCodeToHtml(
  code: string,
  language: string,
  theme: ShikiThemeKind,
): Promise<string | null> {
  const canonical = resolveShikiLanguage(language);
  const cacheKey = `${theme}\0${canonical}\0${code}`;
  const cached = shikiHtmlCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const shikiTheme = theme === "dark" ? "github-dark" : "github-light";
  try {
    const { highlighter, lang } = await ensureShikiLanguage(canonical);
    const html = highlighter.codeToHtml(code, {
      lang: code.length > MAX_HIGHLIGHT_CHAR_LENGTH ? "text" : lang,
      theme: shikiTheme,
    });
    setBoundedCache(shikiHtmlCache, cacheKey, html);
    return html;
  } catch {
    try {
      const highlighter = await getShikiHighlighter();
      const fallbackHtml = highlighter.codeToHtml(code, {
        lang: "text",
        theme: shikiTheme,
      });
      setBoundedCache(shikiHtmlCache, cacheKey, fallbackHtml);
      return fallbackHtml;
    } catch {
      return null;
    }
  }
}

/**
 * Returns dual-theme (`--shiki-light` / `--shiki-dark`) Shiki tokens synchronously when
 * cached or when the highlighter and grammar are already loaded; otherwise returns `null`.
 */
export function tokenizeCodeSync(
  code: string,
  language: string,
): readonly (readonly ThemedToken[])[] | null {
  const canonical = resolveShikiLanguage(language);
  if (
    canonical === "plaintext" ||
    canonical === "mermaid" ||
    code.length === 0 ||
    code.length > MAX_HIGHLIGHT_CHAR_LENGTH
  ) {
    return null;
  }

  const cacheKey = `${canonical}\0${code}`;
  const cached = shikiTokensCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (!highlighterInstance || !loadedLanguages.has(canonical)) {
    return null;
  }

  try {
    const result = highlighterInstance.codeToTokens(code, {
      lang: canonical,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
    setBoundedCache(shikiTokensCache, cacheKey, result.tokens);
    return result.tokens;
  } catch {
    return null;
  }
}

/**
 * Ensures the highlighter and language grammar are loaded and populates the token cache.
 */
export async function ensureCodeTokens(code: string, language: string): Promise<boolean> {
  const canonical = resolveShikiLanguage(language);
  if (
    canonical === "plaintext" ||
    canonical === "mermaid" ||
    code.length === 0 ||
    code.length > MAX_HIGHLIGHT_CHAR_LENGTH
  ) {
    return false;
  }

  const cacheKey = `${canonical}\0${code}`;
  if (shikiTokensCache.has(cacheKey)) {
    return true;
  }

  try {
    const { highlighter, lang } = await ensureShikiLanguage(canonical);
    if (lang === "text") {
      return false;
    }
    const result = highlighter.codeToTokens(code, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
    setBoundedCache(shikiTokensCache, cacheKey, result.tokens);
    return true;
  } catch {
    return false;
  }
}
