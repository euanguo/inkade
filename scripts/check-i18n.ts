import { enUS, zhCN } from "../packages/i18n/src/index.ts";

function flattenCatalog(
  node: Record<string, unknown>,
  prefix = "",
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, val] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof val === "string") {
      result.set(full, val);
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      for (const [k, v] of flattenCatalog(val as Record<string, unknown>, full)) {
        result.set(k, v);
      }
    } else {
      throw new Error(`Invalid i18n catalog entry at "${full}": expected string or nested object`);
    }
  }
  return result;
}

function extractPlaceholders(value: string): string[] {
  const found = value.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) ?? [];
  return [...new Set(found.map((m) => m.replace(/^\{\{\s*|\s*\}\}$/g, "")))].sort();
}

function main(): void {
  const zh = flattenCatalog(zhCN as unknown as Record<string, unknown>);
  const en = flattenCatalog(enUS as unknown as Record<string, unknown>);
  const errors: string[] = [];

  for (const [key, zhVal] of zh.entries()) {
    if (!zhVal.trim()) {
      errors.push(`[zh-CN] Empty translation value for key "${key}"`);
    }
    const enVal = en.get(key);
    if (enVal === undefined) {
      errors.push(`[en-US] Missing key "${key}"`);
      continue;
    }
    if (!enVal.trim()) {
      errors.push(`[en-US] Empty translation value for key "${key}"`);
    }
    const zhVars = extractPlaceholders(zhVal);
    const enVars = extractPlaceholders(enVal);
    if (zhVars.join(",") !== enVars.join(",")) {
      errors.push(
        `Placeholder mismatch for "${key}": zh-CN=[${zhVars.join(", ")}] vs en-US=[${enVars.join(", ")}]`,
      );
    }
  }

  for (const key of en.keys()) {
    if (!zh.has(key)) {
      errors.push(`[zh-CN] Missing key "${key}" (present in en-US)`);
    }
  }

  if (errors.length > 0) {
    console.error(`i18n check FAILED with ${errors.length} issue(s):`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(`i18n check passed: ${zh.size} keys verified symmetrically across zh-CN and en-US.`);
}

main();
