import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const ALLOWED_SPDX = new Set([
  "MIT",
  "APACHE-2.0",
  "BSD-2-CLAUSE",
  "BSD-3-CLAUSE",
  "BSD-1-CLAUSE",
  "ISC",
  "CC0-1.0",
  "0BSD",
  "UNLICENSE",
  "BLUEOAK-1.0.0",
  "WTFPL",
  "CC-BY-4.0",
  "CC-BY-3.0",
  "PYTHON-2.0",
  "ZLIB",
]);

const FORBIDDEN_PATTERNS = [
  /AGPL/i,
  /GPL/i,
  /LGPL/i,
  /\bBSL\b/i,
  /SSPL/i,
  /MPL/i,
  /BUSL/i,
  /PROPRIETARY/i,
  /COMMERCIAL/i,
];

/**
 * Explicit human-approved build-tool-only MPL-2.0 exceptions per AGENTS.md rule #1
 * ("file-level MPL-2.0 requires explicit human approval").
 * `lightningcss` is a direct transitive dependency of `@expo/metro-config` / `@expo/cli`
 * used strictly at Metro bundler/CLI time and is never bundled into mobile runtime binaries.
 */
const APPROVED_MPL_BUILD_ONLY_PACKAGES: readonly RegExp[] = [
  /^lightningcss(?:-[a-z0-9-]+)?$/,
];

function isApprovedBuildOnlyMplPackage(
  packageName: string | undefined,
  licenseExpr: string,
): boolean {
  if (!packageName) return false;
  if (normalizeLicenseToken(licenseExpr) !== "MPL-2.0") return false;
  return APPROVED_MPL_BUILD_ONLY_PACKAGES.some((pattern) => pattern.test(packageName));
}

interface PackageManifest {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
}

interface PackageViolation {
  id: string;
  license: string;
  path: string;
  reason: string;
}

function normalizeLicenseToken(raw: string): string {
  const trimmed = raw.trim().replace(/^\(+|\)+$/g, "").trim();
  if (trimmed === "Apache 2.0" || trimmed === "Apache2" || trimmed === "Apache-2") {
    return "APACHE-2.0";
  }
  if (trimmed === "BSD" || trimmed === "BSD-3") {
    return "BSD-3-CLAUSE";
  }
  return trimmed.toUpperCase();
}

/**
 * Evaluates an SPDX license expression (handling parentheses, AND, OR).
 */
function isPermissiveExpression(expr: string): boolean {
  const cleaned = expr.trim();
  if (!cleaned) return false;

  // Strip balanced outer parentheses.
  let unwrapped = cleaned;
  while (unwrapped.startsWith("(") && unwrapped.endsWith(")")) {
    let depth = 0;
    let wrapsWhole = true;
    for (let i = 0; i < unwrapped.length; i++) {
      const ch = unwrapped[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth === 0 && i < unwrapped.length - 1) {
        wrapsWhole = false;
        break;
      }
    }
    if (!wrapsWhole) break;
    unwrapped = unwrapped.slice(1, -1).trim();
  }

  // Split top-level OR first (lower precedence than AND in SPDX, safe if at least one branch is permissive).
  const orParts = splitTopLevel(unwrapped, /\s+OR\s+/i);
  if (orParts.length > 1) {
    return orParts.some((part) => isPermissiveExpression(part));
  }

  // Split top-level AND (every branch must be permissive).
  const andParts = splitTopLevel(unwrapped, /\s+AND\s+/i);
  if (andParts.length > 1) {
    return andParts.every((part) => isPermissiveExpression(part));
  }

  // Reject explicit forbidden licenses in a single leaf token.
  if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(unwrapped))) {
    return false;
  }

  // Handle legacy slash syntax like "MIT/X11".
  if (unwrapped.includes("/") && !unwrapped.includes(" ")) {
    const slashParts = unwrapped.split("/");
    return slashParts.some((part) => ALLOWED_SPDX.has(normalizeLicenseToken(part)));
  }

  return ALLOWED_SPDX.has(normalizeLicenseToken(unwrapped));
}

function splitTopLevel(input: string, separatorRegex: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let lastIndex = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      const slice = input.slice(i);
      const match = slice.match(separatorRegex);
      if (match && match.index === 0) {
        parts.push(input.slice(lastIndex, i));
        i += match[0].length - 1;
        lastIndex = i + 1;
      }
    }
  }

  parts.push(input.slice(lastIndex));
  return parts;
}

function extractLicenseString(pkg: PackageManifest, pkgDir: string): string | null {
  if (typeof pkg.license === "string" && pkg.license.trim().length > 0) {
    return pkg.license.trim();
  }
  if (pkg.license && typeof pkg.license === "object" && typeof pkg.license.type === "string") {
    return pkg.license.type.trim();
  }
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    const types = pkg.licenses
      .map((item) => item?.type?.trim())
      .filter((value): value is string => Boolean(value));
    if (types.length > 0) {
      return types.join(" OR ");
    }
  }
  // Fallback: check LICENSE file header case-insensitively (e.g. lowercase `license` on Linux) if package.json omitted `license`.
  let licenseFiles: string[] = [];
  try {
    licenseFiles = readdirSync(pkgDir).filter((name) =>
      /^licen[cs]e(?:\.(?:md|txt))?$/i.test(name),
    );
  } catch {
    licenseFiles = [];
  }
  for (const filename of licenseFiles) {
    const candidate = join(pkgDir, filename);
    if (existsSync(candidate)) {
      const header = readFileSync(candidate, "utf8").slice(0, 800);
      if (/MIT License|Permission is hereby granted, free of charge/i.test(header)) {
        return "MIT";
      }
      if (/Apache License\s*,?\s*Version 2\.0/i.test(header)) {
        return "Apache-2.0";
      }
      if (/ISC License/i.test(header)) {
        return "ISC";
      }
      if (/Creative Commons Zero|CC0 1\.0/i.test(header)) {
        return "CC0-1.0";
      }
    }
  }
  return null;
}

function collectNodeModulesRoots(repoRoot: string): string[] {
  const roots: string[] = [];
  const rootNm = join(repoRoot, "node_modules");
  if (existsSync(rootNm)) roots.push(rootNm);

  for (const group of ["packages", "apps", "adapters"]) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nm = join(groupDir, entry.name, "node_modules");
      if (existsSync(nm)) roots.push(nm);
    }
  }
  return roots;
}

function scanNodeModulesDir(
  nmDir: string,
  visitedDirs: Set<string>,
  verifiedPackages: Map<string, string>,
  violations: PackageViolation[],
): void {
  let entries;
  try {
    entries = readdirSync(nmDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === ".bin" || entry.name === ".cache" || entry.name === ".vite") continue;
    const fullPath = join(nmDir, entry.name);

    if (entry.name === ".bun") {
      try {
        for (const bunEntry of readdirSync(fullPath, { withFileTypes: true })) {
          const nestedNm = join(fullPath, bunEntry.name, "node_modules");
          if (existsSync(nestedNm)) {
            scanNodeModulesDir(nestedNm, visitedDirs, verifiedPackages, violations);
          }
        }
      } catch {
        // ignore unreadable .bun subdirs
      }
      continue;
    }

    if (entry.name.startsWith("@")) {
      try {
        for (const scopedEntry of readdirSync(fullPath, { withFileTypes: true })) {
          if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
            inspectPackageDir(
              join(fullPath, scopedEntry.name),
              visitedDirs,
              verifiedPackages,
              violations,
            );
          }
        }
      } catch {
        // ignore
      }
      continue;
    }

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      inspectPackageDir(fullPath, visitedDirs, verifiedPackages, violations);
    }
  }
}

function inspectPackageDir(
  pkgDir: string,
  visitedDirs: Set<string>,
  verifiedPackages: Map<string, string>,
  violations: PackageViolation[],
): void {
  let realDir: string;
  try {
    realDir = realpathSync(pkgDir);
  } catch {
    return;
  }
  if (visitedDirs.has(realDir)) return;
  visitedDirs.add(realDir);

  const manifestPath = join(realDir, "package.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
      if (manifest.name && manifest.version) {
        const pkgId = `${manifest.name}@${manifest.version}`;
        const licenseStr = extractLicenseString(manifest, realDir);
        if (!licenseStr) {
          violations.push({
            id: pkgId,
            license: "<missing>",
            path: realDir,
            reason: "Missing license field and recognizable LICENSE file",
          });
        } else if (
          !isPermissiveExpression(licenseStr) &&
          !isApprovedBuildOnlyMplPackage(manifest.name, licenseStr)
        ) {
          violations.push({
            id: pkgId,
            license: licenseStr,
            path: realDir,
            reason: "License is not in the approved permissive allowlist",
          });
        } else {
          verifiedPackages.set(pkgId, licenseStr);
        }
      }
    } catch (error) {
      violations.push({
        id: realDir,
        license: "<parse-error>",
        path: realDir,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const nestedNm = join(realDir, "node_modules");
  if (existsSync(nestedNm)) {
    scanNodeModulesDir(nestedNm, visitedDirs, verifiedPackages, violations);
  }
}

function main(): void {
  const repoRoot = resolve(import.meta.dir, "..");
  const roots = collectNodeModulesRoots(repoRoot);
  const visitedDirs = new Set<string>();
  const verifiedPackages = new Map<string, string>();
  const violations: PackageViolation[] = [];

  for (const nmRoot of roots) {
    scanNodeModulesDir(nmRoot, visitedDirs, verifiedPackages, violations);
  }

  if (violations.length > 0) {
    console.error(`License check FAILED with ${violations.length} violation(s):`);
    for (const v of violations) {
      console.error(`  - ${v.id} [${v.license}] (${v.reason}) -> ${v.path}`);
    }
    process.exit(1);
  }

  console.log(`License check passed: ${verifiedPackages.size} unique packages verified.`);
}

main();
