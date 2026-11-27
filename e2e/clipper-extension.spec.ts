import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { apiJson, expect, test, uniqueSuffix } from "./fixtures.ts";

function createPngChunk(type: string, data: Uint8Array): Buffer {
  const buf = Buffer.alloc(12 + data.length);
  buf.writeUInt32BE(data.length, 0);
  buf.write(type, 4, 4, "ascii");
  Buffer.from(data).copy(buf, 8);
  // Compute IEEE 802.3 CRC32 over type + data
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) {
    crc ^= buf[i]!;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  buf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return buf;
}

function createSolidPng(width: number, height: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * rowSize;
    raw[rowOff] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const px = rowOff + 1 + x * 3;
      raw[px] = 79;
      raw[px + 1] = 70;
      raw[px + 2] = 229;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    createPngChunk("IHDR", ihdr),
    createPngChunk("IDAT", idat),
    createPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const DIAGRAM_PNG_BYTES = createSolidPng(120, 80);

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

async function startMockWebpageServer(title: string, highlightQuote: string): Promise<{
  readonly port: number;
  close(): Promise<void>;
}> {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="author" content="Inkade E2E Suite" />
</head>
<body>
  <header><nav><a href="/">Home</a></nav></header>
  <main>
    <article>
      <h1>${title}</h1>
      <p>Inkade Flagship Web Clipper converts rich HTML semantics into local-first Markdown documents.</p>
      <p>${highlightQuote}</p>
      <table>
        <thead>
          <tr><th>Engine</th><th>License</th></tr>
        </thead>
        <tbody>
          <tr><td>defuddle/full</td><td>MIT</td></tr>
        </tbody>
      </table>
      <pre><code class="language-ts">export const clipperVersion = 2;</code></pre>
      <p><img src="/diagram.png" alt="Architecture Diagram" width="120" height="80" /></p>
    </article>
  </main>
</body>
</html>`;

  const server: Server = createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (reqUrl.pathname === "/diagram.png") {
      res.writeHead(200, {
        "content-type": "image/png",
        "access-control-allow-origin": "*",
      });
      res.end(DIAGRAM_PNG_BYTES);
      return;
    }
    if (reqUrl.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (reqUrl.pathname === "/article") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      }),
  };
}

test.describe("Real Chromium MV3 Inkade Web Clipper E2E", () => {
  test("configures extension, clips article with image mirror, restores W3C highlight on reload, and dispatches ADE binding", async ({
    request,
    baseURL,
  }) => {
    const serverBaseUrl = (baseURL ?? "http://127.0.0.1:3457").replace(/\/+$/, "");
    const suffix = uniqueSuffix("clipext");
    const articleTitle = `Inkade Flagship Clipper E2E ${suffix}`;
    const highlightQuote = `Inkade MV3 extension verifies cross-node W3C highlight restoration ${suffix}.`;

    const extensionDir = resolve(import.meta.dirname, "../apps/clipper/dist/chrome");
    if (!existsSync(join(extensionDir, "manifest.json"))) {
      throw new Error(
        `Built Chrome MV3 bundle missing at ${extensionDir}. Run "bun run --filter @inkade/clipper build" first.`,
      );
    }

    // 1. Mint a scoped write token via real Inkade server
    const tokenRes = await apiJson<{ readonly rawToken: string }>(
      request,
      "POST",
      "/api/v1/tokens",
      {
        data: {
          name: `clipper-ext-${suffix}`,
          scope: {
            permission: "write",
            spaceIds: "*",
            includeDescendants: true,
            denyHardDelete: false,
          },
        },
      },
    );
    expect(tokenRes.status).toBe(201);
    const rawToken = tokenRes.body.rawToken;
    expect(rawToken.startsWith("ink_")).toBe(true);

    const mockWeb = await startMockWebpageServer(articleTitle, highlightQuote);
    const articleUrl = `http://127.0.0.1:${mockWeb.port}/article`;
    const userDataDir = mkdtempSync(join(tmpdir(), "inkade-clipper-ext-e2e-"));
    const executablePath = resolveCachedChromiumExecutable();

    const context = await chromium.launchPersistentContext(userDataDir, {
      ...(executablePath ? { executablePath } : {}),
      headless: false,
      args: [
        "--headless=new",
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    try {
      let [serviceWorker] = context.serviceWorkers();
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
      }
      const extensionId = new URL(serviceWorker.url()).host;
      expect(extensionId.length).toBeGreaterThan(10);

      const pageErrors: string[] = [];

      // 2. Configure Options page & verify live connection test
      const optionsPage = await context.newPage();
      optionsPage.on("pageerror", (err) => pageErrors.push(`options:${err.message}`));
      await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: "domcontentloaded",
      });
      await optionsPage.locator("#opt-server").fill(serverBaseUrl);
      await optionsPage.locator("#opt-token").fill(rawToken);
      await optionsPage.getByRole("button", { name: /测试连接|Test Connection/ }).click();
      await expect(optionsPage.locator(".ink-status.success")).toBeVisible();
      await optionsPage.locator('button[type="submit"]').click();
      await expect(optionsPage.locator(".ink-status.success")).toBeVisible();

      // Switch to Capture & Reader nav item and verify 4-tier surface theme switching
      await optionsPage.getByRole("button", { name: /采集与阅读|Capture & Reader/ }).click();
      await optionsPage.locator("#opt-surface-theme").click();
      await optionsPage.getByRole("option", { name: /柔雾石板|Dark Dimmed/ }).click();
      await expect
        .poll(() =>
          optionsPage.evaluate(() => ({
            surface: document.documentElement.dataset.surface,
            isDark: document.documentElement.classList.contains("dark"),
          })),
        )
        .toEqual({ surface: "dark-dimmed", isDark: true });
      await optionsPage.locator("#opt-surface-theme").click();
      await optionsPage.getByRole("option", { name: /跟随系统|Follow System/ }).click();
      await optionsPage.close();

      // 3. Visit live mock webpage & ensure clean zero-error loader injection
      const articlePage = await context.newPage();
      articlePage.on("pageerror", (err) => pageErrors.push(`article:${err.message}`));
      await articlePage.goto(articleUrl, { waitUntil: "networkidle" });
      await expect(articlePage.locator("h1")).toHaveText(articleTitle);

      // 4. Open Popup, confirm extracted DOM metadata, and clip to Inkade
      const popupPage = await context.newPage();
      popupPage.on("pageerror", (err) => pageErrors.push(`popup:${err.message}`));
      await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
        waitUntil: "domcontentloaded",
      });
      await expect(popupPage.locator("#clip-title")).toHaveValue(articleTitle, { timeout: 12_000 });
      await popupPage.getByRole("button", { name: /剪藏整页到 Inkade|Clip Page to Inkade/ }).click();
      await expect(popupPage.locator(".ink-status.success")).toBeVisible({ timeout: 15_000 });
      await popupPage.close();

      // 5. Verify exact URL lookup, rich Markdown (table + code), and attachment image mirror
      const lookupRes = await apiJson<{
        readonly found: boolean;
        readonly document: {
          readonly id: string;
          readonly kind: string;
          readonly contentMarkdown: string;
        } | null;
      }>(
        request,
        "GET",
        `/api/v1/clips/lookup?url=${encodeURIComponent(articleUrl)}`,
        { token: rawToken },
      );
      expect(lookupRes.status).toBe(200);
      expect(lookupRes.body.found).toBe(true);
      expect(lookupRes.body.document).toBeTruthy();
      const clippedDoc = lookupRes.body.document!;
      expect(clippedDoc.kind).toBe("clip");
      expect(clippedDoc.contentMarkdown).toContain("/api/v1/attachments/");
      expect(clippedDoc.contentMarkdown).toContain("defuddle/full");
      expect(clippedDoc.contentMarkdown).toContain("clipperVersion");
      const docId = clippedDoc.id;

      // 6. Create a persisted W3C highlight and verify Shadow DOM overlay renders on page reload
      const hlRes = await apiJson<{ readonly highlight: { readonly id: string } }>(
        request,
        "POST",
        `/api/v1/documents/${docId}/highlights`,
        {
          token: rawToken,
          data: {
            quote: highlightQuote,
            prefixContext: "clean HTML semantics into local-first Markdown documents.",
            suffixContext: "",
            color: "amber",
            noteMarkdown: "Playwright extension verification note",
          },
        },
      );
      expect(hlRes.status).toBe(201);

      await articlePage.reload({ waitUntil: "load" });
      await expect
        .poll(
          async () =>
            articlePage.evaluate(() => {
              const host = document.querySelector("#inkade-clipper-root");
              const rects = host?.shadowRoot?.querySelectorAll(".ink-hl-rect") ?? [];
              return rects.length;
            }),
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0);

      // 7. Open Side Panel, verify clipped state & highlight card, and dispatch queued ADE thread
      const sidePanelPage = await context.newPage();
      sidePanelPage.on("pageerror", (err) => pageErrors.push(`sidepanel:${err.message}`));
      await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
        waitUntil: "domcontentloaded",
      });
      await expect(sidePanelPage.locator(".ink-badge.ok")).toBeVisible({ timeout: 12_000 });
      await expect(sidePanelPage.locator(".ink-quote-preview")).toContainText(highlightQuote);

      await sidePanelPage.getByRole("tab", { name: /ADE/ }).click();
      await sidePanelPage.locator("#sp-ade-prompt").fill(`Inspect clipped doc ${suffix}`);
      await sidePanelPage.getByRole("button", { name: /派发到 ADE 队列|Dispatch to ADE Queue/ }).click();
      await expect(sidePanelPage.locator(".ink-status.success")).toBeVisible({ timeout: 12_000 });

      // Verify Recall tab shows search box and excludes self docId
      await sidePanelPage.getByRole("tab", { name: /知识回忆|Recall/ }).click();
      await expect(sidePanelPage.locator("#sp-related-query")).toBeVisible();
      await expect(
        sidePanelPage
          .getByRole("tabpanel", { name: /知识回忆|Recall/ })
          .locator("strong", { hasText: articleTitle }),
      ).toHaveCount(0);
      await sidePanelPage.close();

      // 8. Reopen Popup on clipped page: verify Markdown preview & metadata-only tag update
      const popupRevisit = await context.newPage();
      popupRevisit.on("pageerror", (err) => pageErrors.push(`popup-revisit:${err.message}`));
      await popupRevisit.goto(`chrome-extension://${extensionId}/popup.html`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        popupRevisit.locator(".ink-badge.ok", { hasText: /已入库|Saved in Inkade/ }),
      ).toBeVisible({
        timeout: 12_000,
      });
      await popupRevisit.getByRole("button", { name: /预览|Preview/ }).click();
      await expect(popupRevisit.locator("pre")).toContainText("defuddle/full");
      await popupRevisit.locator("#clip-tags").fill(`e2e-chip-${suffix}`);
      await popupRevisit.locator("#clip-tags").press("Enter");
      await popupRevisit.getByRole("button", { name: /仅更新标签与标题|Update Tags & Title/ }).click();
      await expect(popupRevisit.locator(".ink-status.success")).toBeVisible({ timeout: 12_000 });
      await popupRevisit.close();

      const updatedLookup = await apiJson<{
        readonly document: { readonly tags: readonly string[] } | null;
      }>(
        request,
        "GET",
        `/api/v1/clips/lookup?url=${encodeURIComponent(articleUrl)}`,
        { token: rawToken },
      );
      expect(updatedLookup.body.document?.tags).toContain(`e2e-chip-${suffix}`);

      const afterAdeLookup = await apiJson<{
        readonly found: boolean;
        readonly threadBindings: ReadonlyArray<{
          readonly adeKind: string;
          readonly status: string;
        }>;
      }>(
        request,
        "GET",
        `/api/v1/clips/lookup?url=${encodeURIComponent(articleUrl)}`,
        { token: rawToken },
      );
      expect(afterAdeLookup.status).toBe(200);
      expect(afterAdeLookup.body.found).toBe(true);
      expect(afterAdeLookup.body.threadBindings.length).toBeGreaterThanOrEqual(1);
      expect(afterAdeLookup.body.threadBindings[0]?.adeKind).toBe("any");
      expect(afterAdeLookup.body.threadBindings[0]?.status).toBe("queued");

      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
      await mockWeb.close();
    }
  });

  test("supports one-click pairing from Web /clipper/pair to Clipper extension", async ({ baseURL }) => {
    const serverBaseUrl = (baseURL ?? "http://127.0.0.1:3457").replace(/\/+$/, "");
    const extensionDir = resolve(import.meta.dirname, "../apps/clipper/dist/chrome");
    const userDataDir = mkdtempSync(join(tmpdir(), "inkade-clipper-pair-e2e-"));
    const executablePath = resolveCachedChromiumExecutable();

    const context = await chromium.launchPersistentContext(userDataDir, {
      ...(executablePath ? { executablePath } : {}),
      headless: false,
      args: [
        "--headless=new",
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    try {
      let [serviceWorker] = context.serviceWorkers();
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
      }
      const extensionId = new URL(serviceWorker.url()).host;
      const pageErrors: string[] = [];

      const optionsPage = await context.newPage();
      optionsPage.on("pageerror", (err) => pageErrors.push(`options:${err.message}`));
      await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: "domcontentloaded",
      });
      await optionsPage.locator("#opt-server").fill(serverBaseUrl);
      await optionsPage.locator("#opt-webapp").fill(serverBaseUrl);

      const pairPopupPromise = context.waitForEvent("page", { timeout: 15_000 });
      await optionsPage.getByRole("button", { name: /一键授权配对|One-Click Pair/ }).click();
      const pairPage = await pairPopupPromise;
      pairPage.on("pageerror", (err) => pageErrors.push(`pair:${err.message}`));

      await expect(pairPage.getByText(/授权连接 Inkade Web Clipper|Connect Inkade Web Clipper/)).toBeVisible({
        timeout: 15_000,
      });
      await expect(pairPage.getByText(/插件握手就绪|Extension Handshake Ready/)).toBeVisible();

      await pairPage.getByRole("button", { name: /授权并自动连接插件|Authorize & Connect Extension/ }).click();
      await expect(pairPage.getByText(/配对完成，插件已可立即使用|Paired & Verified Successfully/)).toBeVisible({
        timeout: 15_000,
      });
      await pairPage.close();

      await expect(optionsPage.locator("#opt-token")).toHaveValue(/^ink_/, { timeout: 10_000 });
      await expect(optionsPage.locator(".ink-badge.ok")).toBeVisible({ timeout: 10_000 });
      await optionsPage.close();

      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
