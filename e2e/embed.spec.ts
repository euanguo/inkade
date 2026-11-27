import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { apiJson, expect, test, uniqueSuffix } from "./fixtures.ts";

function startSubpathReverseProxy(
  targetOrigin: string,
  prefix = "/proxy/inkade",
): Promise<{
  readonly origin: string;
  readonly close: () => Promise<void>;
}> {
  const target = new URL(targetOrigin);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const incomingUrl = req.url ?? "/";
        const rewrittenPath = incomingUrl.startsWith(prefix)
          ? incomingUrl.slice(prefix.length) || "/"
          : incomingUrl;
        const upstreamUrl = new URL(rewrittenPath, target);

        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (v === undefined) continue;
          const lower = k.toLowerCase();
          if (lower === "host" || lower === "content-length" || lower === "connection") {
            continue;
          }
          headers.set(k, Array.isArray(v) ? v.join(", ") : v);
        }
        headers.set("x-forwarded-prefix", prefix);

        const method = (req.method ?? "GET").toUpperCase();
        const hasBody = method !== "GET" && method !== "HEAD";
        const bodyChunks: Buffer[] = [];
        if (hasBody) {
          for await (const chunk of req) {
            bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
        }

        const upstreamRes = await fetch(upstreamUrl, {
          method,
          headers,
          ...(hasBody ? { body: Buffer.concat(bodyChunks) } : {}),
        });

        const outHeaders: Record<string, string> = {};
        upstreamRes.headers.forEach((value, key) => {
          const lower = key.toLowerCase();
          if (lower === "transfer-encoding" || lower === "content-encoding") {
            return;
          }
          outHeaders[key] = value;
        });

        res.writeHead(upstreamRes.status, outHeaders);

        if (!upstreamRes.body) {
          res.end();
          return;
        }

        const reader = upstreamRes.body.getReader();
        req.on("close", () => {
          void reader.cancel().catch(() => undefined);
        });
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "text/plain" });
        }
        res.end(err instanceof Error ? err.message : "Proxy error");
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((resClose) => {
            server.closeAllConnections?.();
            server.close(() => resClose());
          }),
      });
    });
  });
}

function startHostFrameServer(iframeSrc: string): Promise<{
  readonly origin: string;
  readonly close: () => Promise<void>;
}> {
  const escapedSrc = JSON.stringify(iframeSrc);
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Host Embed Harness</title></head>
<body>
  <iframe id="inkade-frame" src=${escapedSrc} style="width:100%;height:720px;border:0"></iframe>
  <script>
    window.__bridgeEvents = [];
    window.__spawnRequests = [];
    const iframe = document.getElementById("inkade-frame");
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.protocol !== "inkade.embed.v1") return;
      window.__bridgeEvents.push(data);
      if (data.type === "inkade.ready") {
        iframe.contentWindow.postMessage({
          protocol: "inkade.embed.v1",
          type: "host.hello",
          payload: {
            hostId: "acme-ide",
            hostName: "Acme IDE",
            capabilities: ["spawn_thread", "open_thread"],
            theme: "dark",
            cssVars: {
              "--inkade-host-primary": "rgb(14, 165, 233)"
            }
          }
        }, "*");
      } else if (data.type === "inkade.request.spawn_thread") {
        window.__spawnRequests.push(data);
        iframe.contentWindow.postMessage({
          protocol: "inkade.embed.v1",
          type: "host.response",
          requestId: data.requestId,
          payload: {
            ok: true,
            result: { externalThreadId: "thr_host_created_1" }
          }
        }, "*");
      }
    });
    window.__sendHostNav = (path) => {
      iframe.contentWindow.postMessage({
        protocol: "inkade.embed.v1",
        type: "host.navigate",
        payload: { path }
      }, "*");
    };
    window.__sendHostTheme = (theme) => {
      iframe.contentWindow.postMessage({
        protocol: "inkade.embed.v1",
        type: "host.theme_changed",
        payload: { theme }
      }, "*");
    };
  </script>
</body>
</html>`;

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((resClose) => {
            server.closeAllConnections?.();
            server.close(() => resClose());
          }),
      });
    });
  });
}

test.describe("Layer 3 Embed Mode, Reverse Proxy BasePath & Host Bridge", () => {
  test("1. Chrome trimming URL params, dark/compact/readonly modes, session persistence across navigation, and ?embed=0 reset", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("emb");
    const docTitle = `EmbedTrimDoc-${suffix}`;
    const createRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: docTitle,
          contentMarkdown: `# ${docTitle}\n\nParagraph for embed verification.\n`,
        },
      },
    );
    expect(createRes.status).toBe(201);
    const docId = createRes.body.document.id;

    await page.setViewportSize({ width: 1366, height: 860 });
    await page.goto("/library?embed=1&hide=sidebar,topbar,mobileNav");

    await expect(page.getByText(docTitle).first()).toBeVisible();
    await expect(page.locator('[data-slot="app-sidebar"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="app-topbar"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="app-mobile-nav"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.embed)).toBe("true");

    // Navigate directly without query params -> sessionStorage persists embed trimming
    await page.goto(`/docs/${docId}`);
    await expect(page.getByText("Paragraph for embed verification.")).toBeVisible();
    await expect(page.locator('[data-slot="app-sidebar"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="app-topbar"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.embed)).toBe("true");

    // chrome=none + theme=dark + density=compact + readonly=1
    await page.goto(`/docs/${docId}?embed=1&chrome=none&theme=dark&density=compact&readonly=1`);
    await expect(page.getByText("Paragraph for embed verification.")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe("compact");
    await expect(page.locator('[data-slot="app-inspector"]')).toHaveCount(0);

    // chrome=minimal -> sidebar hidden, topbar visible
    await page.goto("/daily?embed=1&chrome=minimal&theme=dark");
    await expect(page.locator('[data-slot="app-sidebar"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="app-topbar"]')).toBeVisible();

    // Reset with ?embed=0 restores full shell
    await page.goto("/daily?embed=0&theme=light");
    await expect(page.locator('[data-slot="app-sidebar"]')).toBeVisible();
    await expect(page.locator('[data-slot="app-topbar"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.embed ?? "")).toBe("");
  });

  test("2. Reverse proxy /proxy/inkade subpath, X-Forwarded-Prefix, zero SW registration, and embedTicket single-use exchange", async ({
    page,
    request,
    baseURL,
  }) => {
    const suffix = uniqueSuffix("proxy");
    const targetOrigin = baseURL ?? "http://127.0.0.1:3457";
    const proxy = await startSubpathReverseProxy(targetOrigin, "/proxy/inkade");
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    try {
      const tokenRes = await apiJson<{ rawToken: string }>(
        request,
        "POST",
        "/api/v1/tokens",
        {
          data: {
            name: `Proxy Embed ${suffix}`,
            scope: {
              permission: "write",
              spaceIds: "*",
              includeDescendants: true,
              denyHardDelete: true,
            },
          },
        },
      );
      expect(tokenRes.status).toBe(201);

      const ticketRes = await apiJson<{ ticket: string }>(
        request,
        "POST",
        "/api/v1/auth/embed-ticket",
        {
          token: tokenRes.body.rawToken,
        },
      );
      expect(ticketRes.status).toBe(201);
      const ticket = ticketRes.body.ticket;

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(
        `${proxy.origin}/proxy/inkade/daily?embed=1&chrome=minimal&embedTicket=${encodeURIComponent(ticket)}`,
      );

      await expect(page.locator('[data-slot="app-topbar"]')).toBeVisible();
      await expect(page.locator('[data-slot="app-sidebar"]')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.location.search)).not.toContain("embedTicket");
      await expect.poll(() => page.evaluate(() => window.location.search)).toContain("embed=1");
      await expect.poll(() => page.evaluate(() => window.__INKADE_BASE_PATH__)).toBe("/proxy/inkade");

      // Service worker must never register under subpath / embed mode
      const swCount = await page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) return 0;
        const regs = await navigator.serviceWorker.getRegistrations();
        return regs.length;
      });
      expect(swCount).toBe(0);
      expect(consoleErrors).toEqual([]);
    } finally {
      await proxy.close();
    }
  });

  test("3. Iframe postMessage inkade.embed.v1 handshake, host.navigate, host.theme_changed, and spawn_thread delegation", async ({
    page,
    request,
    baseURL,
  }) => {
    const suffix = uniqueSuffix("bridge");
    const docTitle = `BridgeDoc-${suffix}`;
    const createRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: docTitle,
          contentMarkdown: `# ${docTitle}\n\nHost bridge dispatch body.\n`,
        },
      },
    );
    expect(createRes.status).toBe(201);
    const docId = createRes.body.document.id;

    const appOrigin = baseURL ?? "http://127.0.0.1:3457";
    const host = await startHostFrameServer(
      `${appOrigin}/docs/${docId}?embed=1&chrome=minimal`,
    );

    try {
      await page.setViewportSize({ width: 1280, height: 820 });
      await page.goto(host.origin);

      // Verify handshake completed
      await expect
        .poll(async () =>
          page.evaluate(() =>
            (window as unknown as { __bridgeEvents: Array<{ type: string }> }).__bridgeEvents.some(
              (e) => e.type === "inkade.ready",
            ),
          ),
        )
        .toBe(true);

      const frame = page.frameLocator("#inkade-frame");
      await expect
        .poll(() =>
          frame.locator("html").evaluate((el) => ({
            dark: el.classList.contains("dark"),
            hostAttr: el.getAttribute("data-inkade-host"),
          })),
        )
        .toEqual({ dark: true, hostAttr: "acme-ide" });

      // Trigger spawn_thread via button click inside iframe -> routed to host postMessage instead of modal
      await frame.getByRole("button", { name: "派发 ADE" }).click();
      await expect
        .poll(async () =>
          page.evaluate(() =>
            (
              window as unknown as {
                __spawnRequests: Array<{ payload: { documentId: string; prompt: string } }>;
              }
            ).__spawnRequests.length,
          ),
        )
        .toBe(1);

      const spawnReq = await page.evaluate(
        () =>
          (
            window as unknown as {
              __spawnRequests: Array<{ payload: { documentId: string; prompt: string } }>;
            }
          ).__spawnRequests[0],
      );
      expect(spawnReq?.payload.documentId).toBe(docId);
      expect(spawnReq?.payload.prompt).toContain(docTitle);

      // Send host.navigate -> /daily & host.theme_changed -> light
      await page.evaluate(() => {
        (window as unknown as { __sendHostNav: (p: string) => void }).__sendHostNav("/daily");
        (window as unknown as { __sendHostTheme: (t: string) => void }).__sendHostTheme("light");
      });

      await expect
        .poll(async () =>
          page.evaluate(() =>
            (
              window as unknown as {
                __bridgeEvents: Array<{ type: string; payload?: { path?: string } }>;
              }
            ).__bridgeEvents.some(
              (e) => e.type === "inkade.route_changed" && e.payload?.path === "/daily",
            ),
          ),
        )
        .toBe(true);

      await expect
        .poll(() => frame.locator("html").evaluate((el) => el.classList.contains("dark")))
        .toBe(false);
    } finally {
      await host.close();
    }
  });
});
