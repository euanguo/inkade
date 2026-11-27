import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, defineConfig } from "@playwright/test";

const E2E_PORT = Number(process.env.INKADE_E2E_PORT ?? 3457);
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

function resolveCachedChromiumExecutable(): string | undefined {
  const defaultPath = chromium.executablePath();
  if (defaultPath && existsSync(defaultPath)) {
    return undefined;
  }

  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
  ].filter((p): p is string => Boolean(p));

  for (const root of cacheRoots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse();

    for (const dir of dirs) {
      const candidates = [
        join(
          root,
          dir,
          "chrome-mac-arm64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        join(
          root,
          dir,
          "chrome-mac",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        join(root, dir, "chrome-linux", "chrome"),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}

const cachedExecutablePath = resolveCachedChromiumExecutable();

export default defineConfig({
  testDir: resolve(import.meta.dirname),
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1360, height: 860 },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: cachedExecutablePath
      ? { executablePath: cachedExecutablePath }
      : undefined,
  },
  webServer: {
    command: `INKADE_E2E_PORT=${E2E_PORT} bun run e2e/server.ts`,
    cwd: resolve(import.meta.dirname, ".."),
    url: `${BASE_URL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
