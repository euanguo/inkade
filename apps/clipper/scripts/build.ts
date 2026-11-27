import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";
import { compileTailwindV4Css } from "../../../scripts/tailwind-v4-compiler.ts";
import { buildManifestForTarget, type ClipperBrowserTarget } from "./manifests.ts";

const rootDir = resolve(import.meta.dir, "..");
const workspaceRoot = resolve(rootDir, "../..");
const packagesUiDir = join(workspaceRoot, "packages/ui");
const distDir = join(rootDir, "dist");
const stageDir = join(rootDir, ".build-stage");
const iconsDir = join(rootDir, "assets/icons");
const isDev = process.argv.includes("--dev");

interface PackageJsonShape {
  version?: string;
}

const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as PackageJsonShape;
const version = pkg.version ?? "0.1.0";

rmSync(stageDir, { recursive: true, force: true });
rmSync(distDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
mkdirSync(distDir, { recursive: true });

async function buildIifeScript(srcRel: string, outFilename: string): Promise<void> {
  const tmpOut = join(stageDir, "iife-tmp");
  rmSync(tmpOut, { recursive: true, force: true });
  mkdirSync(tmpOut, { recursive: true });

  const result = await Bun.build({
    entrypoints: [join(rootDir, srcRel)],
    outdir: tmpOut,
    target: "browser",
    format: "iife",
    splitting: false,
    sourcemap: isDev ? "inline" : "none",
    minify: !isDev,
    define: {
      "process.env.NODE_ENV": JSON.stringify(isDev ? "development" : "production"),
    },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Failed to build classic IIFE script: ${srcRel}`);
  }

  const builtFiles = readdirSync(tmpOut).filter((name) => name.endsWith(".js"));
  if (builtFiles.length !== 1) {
    throw new Error(`Expected single IIFE output for ${srcRel}, got ${builtFiles.join(", ")}`);
  }

  renameSync(join(tmpOut, builtFiles[0]!), join(stageDir, outFilename));
}

async function buildBackgroundScript(): Promise<void> {
  const tmpOut = join(stageDir, "bg-tmp");
  rmSync(tmpOut, { recursive: true, force: true });
  mkdirSync(tmpOut, { recursive: true });

  const result = await Bun.build({
    entrypoints: [join(rootDir, "src/background/index.ts")],
    outdir: tmpOut,
    target: "browser",
    format: "esm",
    splitting: false,
    sourcemap: isDev ? "inline" : "none",
    minify: !isDev,
    plugins: [
      {
        // Service Workers have no `document`; force the worker-safe character entity table instead of index.dom.js
        name: "worker-safe-named-entities",
        setup(build) {
          build.onResolve({ filter: /^decode-named-character-reference$/ }, (args) => {
            const pkgJson = Bun.resolveSync(
              "decode-named-character-reference/package.json",
              args.importer,
            );
            return { path: join(dirname(pkgJson), "index.js") };
          });
        },
      },
    ],
    define: {
      "process.env.NODE_ENV": JSON.stringify(isDev ? "development" : "production"),
    },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Failed to build background script");
  }

  const builtFiles = readdirSync(tmpOut).filter((name) => name.endsWith(".js"));
  if (builtFiles.length !== 1) {
    throw new Error(`Expected single background.js output, got ${builtFiles.join(", ")}`);
  }
  renameSync(join(tmpOut, builtFiles[0]!), join(stageDir, "background.js"));
}

async function buildExtensionUiPages(): Promise<void> {
  const result = await Bun.build({
    entrypoints: [
      join(rootDir, "src/ui/popup.tsx"),
      join(rootDir, "src/ui/sidepanel.tsx"),
      join(rootDir, "src/ui/options.tsx"),
    ],
    outdir: stageDir,
    target: "browser",
    format: "esm",
    splitting: true,
    sourcemap: isDev ? "inline" : "none",
    minify: !isDev,
    define: {
      "process.env.NODE_ENV": JSON.stringify(isDev ? "development" : "production"),
    },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Failed to build extension UI pages");
  }
}

function toUnicodeEscape(codeUnit: number): string {
  return `\\u${codeUnit.toString(16).padStart(4, "0")}`;
}

/**
 * Escapes Unicode noncharacters (U+FDD0..U+FDEF, U+xxFFFE, U+xxFFFF) and lone surrogates
 * back into ASCII `\uXXXX` escapes. Bun.build unescapes `\uFFFF` inside regex template
 * literals (e.g., defuddle/full), which Chromium's strict C++ IsStringUTF8 rejects in
 * `chrome.scripting.executeScript` ("It isn't UTF-8 encoded.").
 */
function escapeChromeUnsafeCodePoints(source: string): string {
  const parts: string[] = [];
  let sliceStart = 0;

  for (let i = 0; i < source.length; ) {
    const cu = source.charCodeAt(i);
    if (cu >= 0xd800 && cu <= 0xdbff && i + 1 < source.length) {
      const lo = source.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        const cp = 0x10000 + ((cu - 0xd800) << 10) + (lo - 0xdc00);
        if ((cp & 0xffff) >= 0xfffe) {
          parts.push(source.slice(sliceStart, i), toUnicodeEscape(cu), toUnicodeEscape(lo));
          sliceStart = i + 2;
        }
        i += 2;
        continue;
      }
    }

    if ((cu >= 0xd800 && cu <= 0xdfff) || (cu >= 0xfdd0 && cu <= 0xfdef) || cu >= 0xfffe) {
      parts.push(source.slice(sliceStart, i), toUnicodeEscape(cu));
      sliceStart = i + 1;
    }
    i += 1;
  }

  if (parts.length === 0) return source;
  parts.push(source.slice(sliceStart));
  return parts.join("");
}

async function buildClipperStyles(): Promise<void> {
  const inputPath = join(rootDir, "src/ui/styles.css");
  const inputCss = readFileSync(inputPath, "utf8");
  const { css } = await compileTailwindV4Css({
    deps: { compile, Scanner },
    css: inputCss,
    inputPath,
    rootDir,
    fallbackResolveFromDirs: [rootDir, packagesUiDir],
    aliases: {
      "@inkade/ui/styles.css": join(packagesUiDir, "src/theme/tokens.css"),
      "@inkade/ui/host-bridge.css": join(packagesUiDir, "src/theme/host-bridge.css"),
      "tw-animate-css": join(packagesUiDir, "node_modules/tw-animate-css/dist/tw-animate.css"),
    },
    extraSources: [
      { base: join(rootDir, "src/ui"), pattern: "**/*.{ts,tsx}", negated: false },
      { base: join(packagesUiDir, "src/primitives"), pattern: "*.tsx", negated: false },
      { base: join(packagesUiDir, "src/lib"), pattern: "*.ts", negated: false },
    ],
  });

  writeFileSync(join(stageDir, "styles.css"), css, "utf8");
}

await buildIifeScript("src/content/loader.ts", "content-loader.js");
await buildIifeScript("src/content/extractor-entry.ts", "content-extractor.js");
await buildIifeScript("src/content/page-ui-entry.tsx", "content-page-ui.js");
await buildBackgroundScript();
await buildExtensionUiPages();
await buildClipperStyles();

for (const filename of readdirSync(stageDir)) {
  if (!filename.endsWith(".js")) continue;
  const abs = join(stageDir, filename);
  const original = readFileSync(abs, "utf8");
  const sanitized = escapeChromeUnsafeCodePoints(original);
  if (sanitized !== original) {
    writeFileSync(abs, sanitized, "utf8");
  }
}

// Clean temporary build helpers from stageDir before copying into target directories
rmSync(join(stageDir, "iife-tmp"), { recursive: true, force: true });
rmSync(join(stageDir, "bg-tmp"), { recursive: true, force: true });

for (const [srcRel, destRel] of [
  ["popup.html", "popup.html"],
  ["sidepanel.html", "sidepanel.html"],
  ["options.html", "options.html"],
] as const) {
  copyFileSync(join(rootDir, srcRel), join(stageDir, destRel));
}

if (existsSync(iconsDir)) {
  cpSync(iconsDir, join(stageDir, "icons"), { recursive: true });
}

const targets: readonly ClipperBrowserTarget[] = ["chrome", "firefox"];
for (const target of targets) {
  const targetDir = join(distDir, target);
  mkdirSync(targetDir, { recursive: true });
  cpSync(stageDir, targetDir, { recursive: true });
  const manifest = buildManifestForTarget(target, version);
  writeFileSync(join(targetDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

// Mirror chrome bundle into dist/ root for backwards-compatible unpacked loading
cpSync(join(distDir, "chrome"), distDir, { recursive: true });

rmSync(stageDir, { recursive: true, force: true });

console.log(`Built @inkade/clipper MV3 bundles into ${distDir}/{chrome,firefox} (minify=${!isDev})`);
