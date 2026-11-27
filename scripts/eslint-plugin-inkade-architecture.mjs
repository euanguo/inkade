import fs from "node:fs";
import path from "node:path";

const packageExportsCache = new Map();

function collectExportTargets(exportsField, pkgDir, out) {
  if (!exportsField) return;
  if (typeof exportsField === "string") {
    out.add(path.resolve(pkgDir, exportsField));
    return;
  }
  if (typeof exportsField === "object") {
    for (const value of Object.values(exportsField)) {
      collectExportTargets(value, pkgDir, out);
    }
  }
}

function getDeclaredPackageExportTargets(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  while (true) {
    const pkgJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      if (packageExportsCache.has(pkgJsonPath)) {
        return packageExportsCache.get(pkgJsonPath);
      }
      const targets = new Set();
      try {
        const raw = fs.readFileSync(pkgJsonPath, "utf8");
        const parsed = JSON.parse(raw);
        collectExportTargets(parsed.exports, dir, targets);
      } catch {
        // Ignore unreadable package.json; treat as no declared exports.
      }
      packageExportsCache.set(pkgJsonPath, targets);
      return targets;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return new Set();
    }
    dir = parent;
  }
}

function isDeclaredPackageExportEntrypoint(filePath) {
  if (!filePath || filePath === "<input>") return false;
  const resolved = path.resolve(filePath);
  return getDeclaredPackageExportTargets(resolved).has(resolved);
}

export const inkadeArchitecturePlugin = {
  meta: {
    name: "inkade-arch",
    version: "0.1.0",
  },
  rules: {
    "no-reexport-shim": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow pure re-export shim files outside legitimate package/subpath index entrypoints.",
        },
        schema: [],
        messages: {
          noReexportShim:
            "Pure re-export shim files are forbidden outside package entrypoints; import the canonical module directly.",
        },
      },
      create(context) {
        const filename = context.filename ?? context.getFilename?.() ?? "";
        const normalized = filename.replace(/\\/g, "/");
        if (
          /(?:^|\/)index\.[cm]?tsx?$/.test(normalized) ||
          /\.test\.[cm]?tsx?$/.test(normalized) ||
          isDeclaredPackageExportEntrypoint(filename)
        ) {
          return {};
        }

        return {
          Program(node) {
            if (!node.body || node.body.length === 0) return;

            let hasReexport = false;
            for (const stmt of node.body) {
              if (stmt.type === "ExportAllDeclaration") {
                hasReexport = true;
                continue;
              }
              if (stmt.type === "ExportNamedDeclaration" && stmt.source !== null) {
                hasReexport = true;
                continue;
              }
              if (stmt.type === "ImportDeclaration") {
                continue;
              }
              return;
            }

            if (hasReexport) {
              context.report({
                node,
                messageId: "noReexportShim",
              });
            }
          },
        };
      },
    },
  },
};
