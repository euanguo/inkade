import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const distDir = join(rootDir, "dist");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(rootDir, "src/quick-capture-main.tsx")],
  outdir: distDir,
  naming: "quick-capture.js",
  target: "browser",
  format: "esm",
  splitting: false,
  sourcemap: "none",
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  throw new Error("Failed to bundle @inkade/desktop quick-capture mini app");
}

copyFileSync(join(rootDir, "quick-capture.html"), join(distDir, "quick-capture.html"));
console.log(`Built @inkade/desktop quick-capture shell into ${distDir}`);
