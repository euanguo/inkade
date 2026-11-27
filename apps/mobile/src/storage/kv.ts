export interface KvDriver {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
  removeItemSync(key: string): boolean;
}

class MemoryKvDriver implements KvDriver {
  private readonly store = new Map<string, string>();
  getItemSync(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItemSync(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItemSync(key: string): boolean {
    return this.store.delete(key);
  }
}

const memoryFallback = new MemoryKvDriver();
let cachedDriver: KvDriver | null = null;

function resolveDriver(): KvDriver {
  if (cachedDriver) return cachedDriver;
  try {
    // Metro requires a literal synchronous require() so non-RN Bun test runs fall back when react-native Flow syntax cannot parse.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-sqlite/kv-store") as { Storage?: KvDriver };
    if (mod?.Storage && typeof mod.Storage.getItemSync === "function") {
      cachedDriver = mod.Storage;
      return cachedDriver;
    }
  } catch {
    // Fallback to memory when running in non-RN Bun unit tests
  }
  cachedDriver = memoryFallback;
  return cachedDriver;
}

export function readKvString(key: string): string | null {
  try {
    return resolveDriver().getItemSync(key);
  } catch {
    return memoryFallback.getItemSync(key);
  }
}

export function writeKvString(key: string, value: string): void {
  try {
    resolveDriver().setItemSync(key, value);
  } catch {
    memoryFallback.setItemSync(key, value);
  }
}

export function removeKvKey(key: string): void {
  try {
    resolveDriver().removeItemSync(key);
  } catch {
    memoryFallback.removeItemSync(key);
  }
}

export function readKvBoolean(key: string, defaultValue: boolean): boolean {
  const raw = readKvString(key);
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return defaultValue;
}

export function writeKvBoolean(key: string, value: boolean): void {
  writeKvString(key, value ? "true" : "false");
}
