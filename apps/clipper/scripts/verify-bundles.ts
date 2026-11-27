import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = resolve(import.meta.dir, "..");
const distDir = join(rootDir, "dist");

const MAX_CONTENT_LOADER_BYTES = 15 * 1024;
const CLASSIC_CONTENT_SCRIPTS = [
  "content-loader.js",
  "content-extractor.js",
  "content-page-ui.js",
] as const;

interface ManifestShape {
  manifest_version?: number;
  name?: string;
  version?: string;
  permissions?: string[];
  icons?: Record<string, string>;
  action?: { default_popup?: string; default_icon?: Record<string, string> };
  options_ui?: { page?: string };
  side_panel?: { default_path?: string };
  sidebar_action?: { default_panel?: string; default_icon?: Record<string, string> };
  background?: { service_worker?: string; scripts?: string[]; type?: string };
  content_scripts?: Array<{ js?: string[] }>;
  commands?: Record<string, { suggested_key?: unknown }>;
  browser_specific_settings?: unknown;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Bundle verification failed: ${message}`);
  }
}

function assertClassicScriptValid(filePath: string): number {
  assertCondition(existsSync(filePath), `Missing classic script: ${filePath}`);
  const code = readFileSync(filePath, "utf8");
  assertCondition(code.trim().length > 0, `Empty classic script: ${filePath}`);
  assertCondition(
    !/^\s*export\b/m.test(code) && !/\bexport\s*\{[^}]*\}\s*;?\s*$/m.test(code),
    `Top-level export leaked into classic content script: ${filePath}`,
  );
  assertCondition(
    !/^\s*import\s+[\w*{]/m.test(code),
    `Top-level static import leaked into classic content script: ${filePath}`,
  );

  // Validate classic non-module JS parseability without executing or invoking eval/Function
  new Bun.Transpiler({ loader: "js" }).transformSync(code);
  return statSync(filePath).size;
}

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function assertChromeSafeUtf8Script(targetName: string, filename: string, filePath: string): void {
  const bytes = readFileSync(filePath);
  let text: string;
  try {
    text = STRICT_UTF8_DECODER.decode(bytes);
  } catch (error) {
    throw new Error(
      `Bundle verification failed: ${targetName}/${filename} is not strict UTF-8: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  for (let i = 0; i < text.length; ) {
    const cu = text.charCodeAt(i);
    if (cu >= 0xd800 && cu <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        const cp = 0x10000 + ((cu - 0xd800) << 10) + (lo - 0xdc00);
        assertCondition(
          (cp & 0xffff) < 0xfffe,
          `${targetName}/${filename} contains Chrome-rejected Unicode noncharacter U+${cp
            .toString(16)
            .toUpperCase()} at index ${i}`,
        );
        i += 2;
        continue;
      }
    }
    assertCondition(
      !(cu >= 0xd800 && cu <= 0xdfff),
      `${targetName}/${filename} contains lone UTF-16 surrogate 0x${cu.toString(16).toUpperCase()} at index ${i}`,
    );
    assertCondition(
      !((cu >= 0xfdd0 && cu <= 0xfdef) || cu >= 0xfffe),
      `${targetName}/${filename} contains Chrome-rejected Unicode noncharacter U+${cu
        .toString(16)
        .toUpperCase()} at index ${i}`,
    );
    i += 1;
  }
}

function extractHtmlScriptAndLinkRefs(htmlPath: string): string[] {
  const html = readFileSync(htmlPath, "utf8");
  const refs: string[] = [];
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const ref = match[1];
    if (ref && !ref.startsWith("http://") && !ref.startsWith("https://")) {
      refs.push(ref);
    }
  }
  return refs;
}

function verifyTargetBundle(targetName: string, targetDir: string): void {
  const manifestPath = join(targetDir, "manifest.json");
  assertCondition(existsSync(manifestPath), `Missing manifest.json in ${targetDir}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestShape;

  assertCondition(manifest.manifest_version === 3, `${targetName}: manifest_version must be 3`);
  assertCondition(Boolean(manifest.name && manifest.version), `${targetName}: missing name/version`);

  const suggestedKeyCount = Object.values(manifest.commands ?? {}).filter(
    (cmd) => cmd.suggested_key !== undefined,
  ).length;
  assertCondition(
    suggestedKeyCount <= 4,
    `${targetName}: Chrome MV3 allows at most 4 commands with suggested_key (got ${suggestedKeyCount})`,
  );

  if (targetName === "chrome" || targetName === "root") {
    assertCondition(
      Boolean(manifest.background?.service_worker),
      `${targetName}: missing background.service_worker`,
    );
    assertCondition(
      !manifest.background?.scripts,
      `${targetName}: Chrome manifest must not include Firefox background.scripts`,
    );
    assertCondition(
      !manifest.browser_specific_settings,
      `${targetName}: Chrome manifest must not include browser_specific_settings`,
    );
    assertCondition(
      Boolean(manifest.side_panel?.default_path),
      `${targetName}: missing side_panel.default_path`,
    );
  } else if (targetName === "firefox") {
    assertCondition(
      Array.isArray(manifest.background?.scripts) && manifest.background.scripts.length > 0,
      "firefox: missing background.scripts",
    );
    assertCondition(
      !manifest.background?.service_worker,
      "firefox: Firefox manifest must not include Chrome background.service_worker",
    );
    assertCondition(
      !(manifest.permissions ?? []).includes("sidePanel"),
      "firefox: Firefox manifest must not request Chrome sidePanel permission",
    );
    assertCondition(
      Boolean(manifest.sidebar_action?.default_panel),
      "firefox: missing sidebar_action.default_panel",
    );
  }

  // Check referenced files exist
  const filesToCheck = new Set<string>();
  for (const iconPath of Object.values(manifest.icons ?? {})) filesToCheck.add(iconPath);
  for (const iconPath of Object.values(manifest.action?.default_icon ?? {})) {
    filesToCheck.add(iconPath);
  }
  if (manifest.action?.default_popup) filesToCheck.add(manifest.action.default_popup);
  if (manifest.options_ui?.page) filesToCheck.add(manifest.options_ui.page);
  if (manifest.side_panel?.default_path) filesToCheck.add(manifest.side_panel.default_path);
  if (manifest.sidebar_action?.default_panel) {
    filesToCheck.add(manifest.sidebar_action.default_panel);
  }
  if (manifest.background?.service_worker) filesToCheck.add(manifest.background.service_worker);
  for (const bgScript of manifest.background?.scripts ?? []) filesToCheck.add(bgScript);
  for (const cs of manifest.content_scripts ?? []) {
    for (const jsFile of cs.js ?? []) filesToCheck.add(jsFile);
  }

  for (const rel of filesToCheck) {
    const abs = join(targetDir, rel);
    assertCondition(existsSync(abs), `${targetName}: missing manifest asset "${rel}"`);
    if (rel.endsWith(".html")) {
      for (const htmlRef of extractHtmlScriptAndLinkRefs(abs)) {
        assertCondition(
          existsSync(join(targetDir, htmlRef)),
          `${targetName}: missing asset "${htmlRef}" referenced by ${rel}`,
        );
      }
    }
  }

  const sizes: Record<string, number> = {};
  for (const csName of CLASSIC_CONTENT_SCRIPTS) {
    sizes[csName] = assertClassicScriptValid(join(targetDir, csName));
  }
  const loaderBytes = sizes["content-loader.js"] ?? 0;
  assertCondition(
    loaderBytes <= MAX_CONTENT_LOADER_BYTES,
    `${targetName}: content-loader.js (${loaderBytes} B) exceeds ${MAX_CONTENT_LOADER_BYTES} B budget`,
  );

  for (const pageScript of ["background.js", "popup.js", "sidepanel.js", "options.js"] as const) {
    const abs = join(targetDir, pageScript);
    assertCondition(existsSync(abs), `${targetName}: missing ${pageScript}`);
    sizes[pageScript] = statSync(abs).size;
  }

  for (const entry of readdirSync(targetDir)) {
    if (!entry.endsWith(".js")) continue;
    assertChromeSafeUtf8Script(targetName, entry, join(targetDir, entry));
  }

  console.log(
    `[verify] ${targetName}: OK (${Object.entries(sizes)
      .map(([k, v]) => `${k}=${(v / 1024).toFixed(1)}KB`)
      .join(", ")})`,
  );
}

function assertServiceWorkerBootsWithoutDom(targetName: string, bgPath: string): void {
  const probeScript = `
    let onMsgCount = 0;
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: () => { onMsgCount++; } },
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
      },
      storage: { onChanged: { addListener: () => {} } },
      contextMenus: { onClicked: { addListener: () => {} }, removeAll: async () => {}, create: () => {} },
      commands: { onCommand: { addListener: () => {} } },
    };
    await import(${JSON.stringify(pathToFileURL(bgPath).href)});
    if (onMsgCount === 0) throw new Error("background.js registered zero runtime.onMessage listeners");
  `;
  const proc = spawnSync(process.execPath, ["-e", probeScript], {
    encoding: "utf8",
  });
  assertCondition(
    proc.status === 0,
    `${targetName}: background.js failed Service Worker boot check (no window/document): ${
      proc.stderr || proc.stdout || `exit=${proc.status}`
    }`,
  );
}

verifyTargetBundle("chrome", join(distDir, "chrome"));
verifyTargetBundle("firefox", join(distDir, "firefox"));
verifyTargetBundle("root", distDir);
assertServiceWorkerBootsWithoutDom("chrome", join(distDir, "chrome/background.js"));
