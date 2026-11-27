import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export const TAILWIND_FEATURE_AT_APPLY = 1;
export const TAILWIND_FEATURE_UTILITIES = 16;
export const TAILWIND_FEATURE_AT_THEME = 64;

export interface TailwindScanSource {
  base: string;
  pattern: string;
  negated: boolean;
}

export interface TailwindLoadedStylesheet {
  path: string;
  base: string;
  content: string;
}

export interface TailwindCompiledResult {
  readonly features: number;
  readonly root: { readonly base: string; readonly pattern: string } | "none" | null;
  readonly sources: ReadonlyArray<TailwindScanSource>;
  build(candidates: string[]): string;
}

export interface TailwindCompileOptions {
  base: string;
  from?: string;
  loadStylesheet: (id: string, base: string) => Promise<TailwindLoadedStylesheet>;
}

export interface TailwindScannerLike {
  readonly files: Iterable<string>;
  scan(): Iterable<string>;
}

export interface TailwindCompilerDeps {
  readonly compile: (
    css: string,
    options: TailwindCompileOptions,
  ) => Promise<TailwindCompiledResult>;
  readonly Scanner: new (options: { sources: TailwindScanSource[] }) => TailwindScannerLike;
}

export interface ResolveCssImportOptions {
  readonly aliases?: Readonly<Record<string, string>> | undefined;
  readonly fallbackResolveFromDirs?: readonly string[] | undefined;
}

export interface CompileTailwindCssOptions {
  readonly deps: TailwindCompilerDeps;
  readonly css: string;
  readonly inputPath: string;
  readonly rootDir: string;
  readonly aliases?: Readonly<Record<string, string>> | undefined;
  readonly fallbackResolveFromDirs?: readonly string[] | undefined;
  readonly extraSources?: readonly TailwindScanSource[] | undefined;
  readonly trackDependency?: ((depPath: string) => void | Promise<void>) | undefined;
}

export interface CompiledTailwindSession {
  readonly compiler: TailwindCompiledResult;
  readonly scanner: TailwindScannerLike;
  readonly candidates: Set<string>;
  readonly dependencies: Map<string, number | null>;
}

export interface InkadeTailwindVitePlugin {
  readonly name: "inkade-tailwind-v4";
  readonly enforce: "pre";
  configResolved(config: { readonly root: string }): void;
  transform(
    this: { addWatchFile(id: string): void },
    code: string,
    id: string,
  ): Promise<{ readonly code: string; readonly map: null } | null>;
}

function findPackageJson(pkgName: string, fromDir: string): string | null {
  let current = fromDir;
  while (true) {
    const candidate = resolve(current, "node_modules", pkgName, "package.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readLoadedStylesheet(filePath: string): Promise<TailwindLoadedStylesheet> {
  return {
    path: filePath,
    base: dirname(filePath),
    content: await readFile(filePath, "utf8"),
  };
}

/**
 * Resolves `@import` specifiers inside Tailwind v4 CSS entrypoints without
 * depending on `@tailwindcss/vite` or `lightningcss`.
 */
export async function resolveTailwindCssImport(
  id: string,
  base: string,
  options?: ResolveCssImportOptions,
): Promise<TailwindLoadedStylesheet> {
  const aliasedPath = options?.aliases?.[id];
  if (aliasedPath) {
    return readLoadedStylesheet(aliasedPath);
  }

  if (id.startsWith(".") || id.startsWith("/")) {
    return readLoadedStylesheet(resolve(base, id));
  }

  const searchBases = [base, ...(options?.fallbackResolveFromDirs ?? [])];
  for (const searchBase of searchBases) {
    const req = createRequire(resolve(searchBase, "package.json"));
    try {
      const direct = req.resolve(id);
      if (direct.endsWith(".css")) {
        return readLoadedStylesheet(direct);
      }
    } catch {
      // Fall through to package.json `style` / `exports` resolution
    }

    const parts = id.split("/");
    const pkgName = id.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? id);
    const subPath = parts.slice(id.startsWith("@") ? 2 : 1).join("/");
    const pkgJsonPath = findPackageJson(pkgName, searchBase);
    if (!pkgJsonPath) continue;

    const pkgDir = dirname(pkgJsonPath);
    const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8")) as {
      style?: string;
      exports?: Record<string, string | { style?: string; default?: string }>;
    };

    const entryKey = subPath ? `./${subPath}` : ".";
    const exp = pkg.exports?.[entryKey];
    let rel: string | undefined =
      typeof exp === "string" ? exp : (exp?.style ?? exp?.default);

    if (!rel && !subPath && pkg.style) {
      rel = pkg.style;
    }
    if (!rel && subPath) {
      rel = subPath.endsWith(".css") ? subPath : `${subPath}.css`;
    }

    if (rel) {
      const candidate = resolve(pkgDir, rel);
      if (existsSync(candidate)) {
        return readLoadedStylesheet(candidate);
      }
    }

    try {
      const resolved = req.resolve(id);
      return readLoadedStylesheet(resolved);
    } catch {
      // Continue trying fallback directories
    }
  }

  const req = createRequire(resolve(base, "package.json"));
  return readLoadedStylesheet(req.resolve(id));
}

export async function normalizeTailwindScannerSources(
  sources: ReadonlyArray<TailwindScanSource>,
): Promise<TailwindScanSource[]> {
  const normalized: TailwindScanSource[] = [];
  for (const src of sources) {
    if (!src.pattern.includes("*")) {
      const candidateDir = resolve(src.base, src.pattern);
      if (existsSync(candidateDir)) {
        const info = await stat(candidateDir).catch(() => null);
        if (info?.isDirectory()) {
          normalized.push({
            base: candidateDir,
            pattern: "**/*",
            negated: src.negated,
          });
          continue;
        }
      }
    }
    normalized.push({
      base: src.base,
      pattern: src.pattern,
      negated: src.negated,
    });
  }
  return normalized;
}

/**
 * Compiles a Tailwind v4 CSS stylesheet once using injected `tailwindcss` + `@tailwindcss/oxide`
 * primitives (used directly by standalone build scripts such as `apps/clipper/scripts/build.ts`).
 */
export async function compileTailwindV4Css(
  options: CompileTailwindCssOptions,
): Promise<{
  readonly css: string;
  readonly compiler: TailwindCompiledResult;
  readonly scannedFiles: readonly string[];
}> {
  const compiler = await options.deps.compile(options.css, {
    base: dirname(options.inputPath),
    from: options.inputPath,
    loadStylesheet: async (depId, depBase) => {
      const loaded = await resolveTailwindCssImport(depId, depBase, {
        aliases: options.aliases,
        fallbackResolveFromDirs: options.fallbackResolveFromDirs,
      });
      await options.trackDependency?.(loaded.path);
      return loaded;
    },
  });

  const rawSources: TailwindScanSource[] =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base: options.rootDir, pattern: "**/*", negated: false }]
        : [{ base: compiler.root.base, pattern: compiler.root.pattern, negated: false }];

  const allSources = await normalizeTailwindScannerSources([
    ...rawSources,
    ...compiler.sources,
    ...(options.extraSources ?? []),
  ]);

  const scanner = new options.deps.Scanner({ sources: allSources });
  const candidates = [...scanner.scan()];
  const css = compiler.build(candidates);

  return {
    css,
    compiler,
    scannedFiles: [...scanner.files],
  };
}

/**
 * Creates a permissive-license Tailwind CSS v4 Vite plugin built on
 * MIT `tailwindcss` + `@tailwindcss/oxide` (zero MPL-2.0 transitive deps).
 */
export function createInkadeTailwindVitePlugin(
  deps: TailwindCompilerDeps,
): InkadeTailwindVitePlugin {
  let rootDir = process.cwd();
  const sessions = new Map<string, CompiledTailwindSession>();

  async function depsChanged(depsMap: Map<string, number | null>): Promise<boolean> {
    for (const [depPath, prevMtime] of depsMap) {
      if (prevMtime === null) return true;
      const info = await stat(depPath).catch(() => null);
      if (!info || info.mtimeMs > prevMtime) return true;
    }
    return false;
  }

  return {
    name: "inkade-tailwind-v4",
    enforce: "pre",
    configResolved(config) {
      rootDir = config.root;
    },
    async transform(code, id) {
      const cleanId = id.split("?", 1)[0] ?? id;
      if (!cleanId.endsWith(".css")) return null;
      if (
        !code.includes("@import") &&
        !code.includes("@theme") &&
        !code.includes("@tailwind") &&
        !code.includes("@source")
      ) {
        return null;
      }

      let session = sessions.get(cleanId);
      const needsCompile = !session || (await depsChanged(session.dependencies));

      if (needsCompile) {
        const dependencies = new Map<string, number | null>();
        const trackDep = async (depPath: string) => {
          this.addWatchFile(depPath);
          const info = await stat(depPath).catch(() => null);
          dependencies.set(depPath, info ? info.mtimeMs : null);
        };
        await trackDep(cleanId);

        const compiler = await deps.compile(code, {
          base: dirname(cleanId),
          from: cleanId,
          loadStylesheet: async (depId, base) => {
            const loaded = await resolveTailwindCssImport(depId, base);
            await trackDep(loaded.path);
            return loaded;
          },
        });

        if (
          (compiler.features &
            (TAILWIND_FEATURE_UTILITIES |
              TAILWIND_FEATURE_AT_THEME |
              TAILWIND_FEATURE_AT_APPLY)) ===
          0
        ) {
          return null;
        }

        const rawSources: TailwindScanSource[] =
          compiler.root === "none"
            ? []
            : compiler.root === null
              ? [{ base: rootDir, pattern: "**/*", negated: false }]
              : [{ base: compiler.root.base, pattern: compiler.root.pattern, negated: false }];
        const allSources = await normalizeTailwindScannerSources([...rawSources, ...compiler.sources]);
        const scanner = new deps.Scanner({ sources: allSources });
        session = {
          compiler,
          scanner,
          candidates: new Set<string>(),
          dependencies,
        };
        sessions.set(cleanId, session);
      }

      if (!session) return null;

      if ((session.compiler.features & TAILWIND_FEATURE_UTILITIES) !== 0) {
        for (const candidate of session.scanner.scan()) {
          session.candidates.add(candidate);
        }
        for (const file of session.scanner.files) {
          this.addWatchFile(file);
        }
      }

      return {
        code: session.compiler.build([...session.candidates]),
        map: null,
      };
    },
  };
}
