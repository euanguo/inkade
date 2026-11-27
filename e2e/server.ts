import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInkadeApp } from "../apps/server/src/app.ts";
import { defaultDnsResolver } from "../apps/server/src/services/clipper-service.ts";

const E2E_FIXTURE_HOST = "e2e-fixture.inkade.test";

// Minimal valid 1x1 transparent PNG (67 bytes)
const TINY_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const MOCK_ARTICLE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Playwright Mock Fixture Article</title>
  <meta name="author" content="Inkade Fixture" />
  <link rel="icon" href="/favicon.png" />
  <meta property="og:image" content="https://e2e-fixture.inkade.test/hero.png" />
</head>
<body>
  <main>
    <article>
      <h1>Playwright Mock Fixture Article</h1>
      <p>This is a deterministic local fixture article fetched through Inkade's Tier-1 defuddle pipeline.</p>
      <p>Second paragraph with concrete evidence for E2E verification and image mirroring.</p>
      <img src="/cover.png" alt="Fixture Cover" />
    </article>
  </main>
</body>
</html>`;

function formatIcsUtcStamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function buildMockIcsCalendar(): string {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    11,
    30,
    0,
  );
  const dtStamp = formatIcsUtcStamp(now);
  const dtStart = formatIcsUtcStamp(start);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Inkade E2E Fixture//EN",
    "BEGIN:VEVENT",
    "UID:inkade-e2e-standup-001",
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    "DURATION:PT30M",
    "SUMMARY:Inkade E2E External Standup",
    "LOCATION:Online Room A",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, "..");
  const webDistDir = resolve(repoRoot, "apps/web/dist");
  if (!existsSync(join(webDistDir, "index.html"))) {
    throw new Error(
      `Built Web SPA not found at ${webDistDir}. Run "bun run build:web" before running E2E tests.`,
    );
  }

  const mockFixtureServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (
        url.pathname === "/cover.png" ||
        url.pathname === "/hero.png" ||
        url.pathname === "/favicon.png"
      ) {
        return new Response(TINY_PNG_BYTES, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      if (url.pathname === "/article" || url.pathname === "/") {
        return new Response(MOCK_ARTICLE_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url.pathname === "/calendar.ics") {
        return new Response(buildMockIcsCalendar(), {
          status: 200,
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            etag: '"inkade-e2e-ics-v1"',
          },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  const tempDir = mkdtempSync(join(tmpdir(), "inkade-pw-e2e-"));
  const port = Number(process.env.INKADE_E2E_PORT ?? 3457);

  const resolveFixtureDns = async (hostname: string): Promise<string[]> => {
    if (hostname === E2E_FIXTURE_HOST) {
      return ["93.184.216.34"];
    }
    return defaultDnsResolver(hostname);
  };

  const fetchFixtureOrReal = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsed = new URL(rawUrl);
    if (parsed.hostname === E2E_FIXTURE_HOST) {
      const targetUrl = `http://127.0.0.1:${mockFixtureServer.port}${parsed.pathname}${parsed.search}`;
      return fetch(targetUrl, init);
    }
    return fetch(input, init);
  };

  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade-e2e.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "inkade-playwright-e2e-secret-min-32-characters",
    webDistDir,
    clipperResolveDns: resolveFixtureDns,
    clipperFetch: fetchFixtureOrReal,
    calendarResolveDns: resolveFixtureDns,
    calendarFetch: fetchFixtureOrReal,
  });

  await instance.ready;

  instance.services.aiRewrite.setTestTransport({
    resolveDns: async (hostname) => {
      if (hostname === E2E_FIXTURE_HOST || hostname === "api.openai.com") {
        return ["93.184.216.34"];
      }
      return defaultDnsResolver(hostname);
    },
  });

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 120,
  });

  console.log(
    `[inkade-e2e-server] listening on http://127.0.0.1:${server.port} (mock fixture on :${mockFixtureServer.port}, dataDir=${tempDir})`,
  );

  let cleaned = false;
  const shutdown = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      server.stop(true);
    } catch {
      // ignore
    }
    try {
      mockFixtureServer.stop(true);
    } catch {
      // ignore
    }
    try {
      instance.close();
    } catch {
      // ignore
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

await main();
