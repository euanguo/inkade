import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const TARGET_DIRS = ["packages/ui/src", "apps/web/src", "apps/clipper/src"] as const;
const SOURCE_EXTS = new Set([".ts", ".tsx", ".css"]);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;

const APPROVED_VAR_DURATION = /^var\(--duration-[a-z0-9-]+\)$/;
const APPROVED_CALC_DURATION = /^calc\(.*var\(--duration-[a-z0-9-]+\).*\)$/;
const RAW_TIME_LITERAL = /\b\d+(?:\.\d+)?(?:ms|s)\b/i;

interface MotionViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly detail: string;
}

function collectSourceFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (TEST_FILE_PATTERN.test(entry.name)) continue;
    const dot = entry.name.lastIndexOf(".");
    if (dot !== -1 && SOURCE_EXTS.has(entry.name.slice(dot))) {
      out.push(full);
    }
  }
}

/**
 * Replaces comment characters with spaces while preserving newline counts for exact line reporting.
 */
function maskBlockComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
}

function isApprovedDurationExpr(expr: string): boolean {
  const trimmed = expr.trim();
  if (APPROVED_VAR_DURATION.test(trimmed)) return true;
  if (APPROVED_CALC_DURATION.test(trimmed) && !RAW_TIME_LITERAL.test(trimmed)) {
    return true;
  }
  return false;
}

function extractBraceBlock(css: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(openBraceIndex + 1, i);
      }
    }
  }
  return css.slice(openBraceIndex + 1);
}

function findMatchingBlockBodies(css: string, headerPattern: RegExp): string[] {
  const bodies: string[] = [];
  const flags = headerPattern.flags.includes("g")
    ? headerPattern.flags
    : `${headerPattern.flags}g`;
  const regex = new RegExp(headerPattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(css)) !== null) {
    const braceIdx = css.indexOf("{", match.index + match[0].length - 1);
    if (braceIdx !== -1) {
      bodies.push(extractBraceBlock(css, braceIdx));
    }
  }
  return bodies;
}

function verifyReducedMotionCoverage(
  repoRoot: string,
  cssFiles: readonly string[],
  violations: MotionViolation[],
): number {
  const tokensPath = resolve(repoRoot, "packages/ui/src/theme/tokens.css");
  if (!existsSync(tokensPath)) {
    violations.push({
      file: "packages/ui/src/theme/tokens.css",
      line: 1,
      rule: "reduced-motion-tokens",
      detail: "Missing tokens.css required for prefers-reduced-motion and [data-motion=\"reduced-pulse\"].",
    });
    return 0;
  }

  const tokensCss = maskBlockComments(readFileSync(tokensPath, "utf8"));
  const mediaBlocks = findMatchingBlockBodies(
    tokensCss,
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/,
  );
  const hasMediaSuppression = mediaBlocks.some(
    (block) =>
      block.includes("animation-duration") &&
      block.includes("transition-duration") &&
      block.includes('data-motion-essential="pulse"'),
  );
  if (!hasMediaSuppression) {
    violations.push({
      file: "packages/ui/src/theme/tokens.css",
      line: 1,
      rule: "reduced-motion-media",
      detail:
        'tokens.css must define @media (prefers-reduced-motion: reduce) suppressing animations/transitions while preserving [data-motion-essential="pulse"].',
    });
  }

  const hasDataAttrSuppression =
    tokensCss.includes('html[data-motion="reduced-pulse"]') &&
    tokensCss.includes('html[data-motion="reduced-pulse"] [data-motion-essential="pulse"]');
  if (!hasDataAttrSuppression) {
    violations.push({
      file: "packages/ui/src/theme/tokens.css",
      line: 1,
      rule: "reduced-motion-attr",
      detail:
        'tokens.css must mirror reduced-motion and [data-motion-essential="pulse"] rules under html[data-motion="reduced-pulse"].',
    });
  }

  const keyframeNames: Array<{ readonly file: string; readonly line: number; readonly name: string }> = [];

  for (const cssPath of cssFiles) {
    const rel = relative(repoRoot, cssPath);
    const masked = maskBlockComments(readFileSync(cssPath, "utf8"));
    const lines = masked.split("\n");

    lines.forEach((lineText, idx) => {
      const kfMatch = lineText.match(/@keyframes\s+([a-zA-Z0-9_-]+)/);
      if (kfMatch?.[1]) {
        keyframeNames.push({ file: rel, line: idx + 1, name: kfMatch[1] });
      }
    });

    // Guard against unlayered !important animation declarations outside reduced-motion blocks.
    const reducedBodies = [
      ...findMatchingBlockBodies(masked, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/),
      ...findMatchingBlockBodies(masked, /html\[data-motion="reduced-pulse"\][^{]*\{/),
    ].join("\n");

    lines.forEach((lineText, idx) => {
      if (
        /animation(?:-duration)?\s*:[^;]*!important/i.test(lineText) &&
        !reducedBodies.includes(lineText.trim())
      ) {
        violations.push({
          file: rel,
          line: idx + 1,
          rule: "unguarded-important-animation",
          detail: `Animation uses !important outside reduced-motion guard: ${lineText.trim()}`,
        });
      }
    });
  }

  for (const kf of keyframeNames) {
    if (kf.name === "inkade-essential-pulse") {
      if (!tokensCss.includes("inkade-essential-pulse")) {
        violations.push({
          file: kf.file,
          line: kf.line,
          rule: "keyframe-reduced-motion",
          detail: `Essential pulse @keyframes "${kf.name}" is not referenced by reduced-motion rules.`,
        });
      }
      continue;
    }

    const coveredByGlobal = hasMediaSuppression && hasDataAttrSuppression;
    if (!coveredByGlobal) {
      violations.push({
        file: kf.file,
        line: kf.line,
        rule: "keyframe-reduced-motion",
        detail: `@keyframes "${kf.name}" is missing global prefers-reduced-motion / [data-motion="reduced-pulse"] coverage.`,
      });
    }
  }

  return keyframeNames.length;
}

function main(): void {
  const repoRoot = resolve(import.meta.dir, "..");
  const files: string[] = [];
  for (const relDir of TARGET_DIRS) {
    collectSourceFiles(resolve(repoRoot, relDir), files);
  }
  files.sort();

  const violations: MotionViolation[] = [];
  const cssFiles: string[] = [];

  for (const filePath of files) {
    const rel = relative(repoRoot, filePath);
    if (filePath.endsWith(".css")) {
      cssFiles.push(filePath);
    }

    const raw = readFileSync(filePath, "utf8");
    const masked = maskBlockComments(raw);
    const lines = masked.split("\n");

    lines.forEach((lineText, idx) => {
      const lineNo = idx + 1;
      const trimmed = lineText.trim();
      if (trimmed.startsWith("//")) return;

      if (/\btransition-all\b/.test(lineText) || /\btransition\s*:\s*all\b/i.test(lineText)) {
        violations.push({
          file: rel,
          line: lineNo,
          rule: "no-transition-all",
          detail: "Use explicit composite properties (e.g. transition-[transform,opacity,...]) instead of transition-all.",
        });
      }

      const durationMatches = lineText.matchAll(/\bduration-\[([^\]]+)\]/g);
      for (const match of durationMatches) {
        const expr = match[1] ?? "";
        if (!isApprovedDurationExpr(expr)) {
          violations.push({
            file: rel,
            line: lineNo,
            rule: "no-raw-arbitrary-duration",
            detail: `Use semantic token var (e.g. duration-[var(--duration-fast)]) instead of "duration-[${expr}]".`,
          });
        }
      }
    });
  }

  const keyframesVerified = verifyReducedMotionCoverage(repoRoot, cssFiles, violations);

  if (violations.length > 0) {
    console.error(`Motion check FAILED with ${violations.length} violation(s):`);
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} [${v.rule}] ${v.detail}`);
    }
    process.exit(1);
  }

  console.log(
    `Motion check passed: ${files.length} source files and ${keyframesVerified} @keyframes verified cleanly.`,
  );
}

main();
