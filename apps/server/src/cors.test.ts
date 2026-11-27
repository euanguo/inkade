import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInkadeApp, isAllowedCorsOrigin } from "./app.ts";

describe("Server CORS allowlist security", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches loopback origins and configured allowlists strictly while rejecting spoofs", () => {
    const defaults = ["http://localhost:*", "http://127.0.0.1:*", "https://*.inkade.example"];
    expect(isAllowedCorsOrigin("http://localhost:5173", defaults)).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:3457", defaults)).toBe(true);
    expect(isAllowedCorsOrigin("https://app.inkade.example", defaults)).toBe(true);

    // Reject subdomain lookalikes, userinfo spoofs, null origin, and unconfigured extensions
    expect(isAllowedCorsOrigin("https://evilinkade.example", defaults)).toBe(false);
    expect(isAllowedCorsOrigin("https://inkade.example.evil.com", defaults)).toBe(false);
    expect(isAllowedCorsOrigin("https://user@app.inkade.example", defaults)).toBe(false);
    expect(isAllowedCorsOrigin("null", defaults)).toBe(false);
    expect(isAllowedCorsOrigin("chrome-extension://abcdefghijklmnop", defaults)).toBe(false);

    // Explicit extension allowlist works only when configured
    expect(
      isAllowedCorsOrigin("chrome-extension://abcdefghijklmnop", [
        ...defaults,
        "chrome-extension://abcdefghijklmnop",
      ]),
    ).toBe(true);
    expect(
      isAllowedCorsOrigin("chrome-extension://otherextensionid", [
        ...defaults,
        "chrome-extension://abcdefghijklmnop",
      ]),
    ).toBe(false);
  });

  it("allows loopback & configured origins, rejects evil cross-origin ACAO/ACAC, and passes Origin-less requests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inkade-cors-test-"));
    tempDirs.push(dir);
    const prevEnv = process.env.INKADE_CORS_ORIGINS;
    process.env.INKADE_CORS_ORIGINS = "https://*.inkade.example,chrome-extension://allowedext123";

    const instance = createInkadeApp({
      dbPath: join(dir, "inkade.db"),
      dataDir: dir,
      localAutoAuth: true,
    });

    try {
      await instance.ready;

      // 1. No Origin header (CLI / server-to-server) succeeds without reflecting wildcard ACAO
      const cliRes = await instance.app.request("http://localhost/api/v1/health");
      expect(cliRes.status).toBe(200);
      expect(cliRes.headers.get("access-control-allow-origin")).toBeNull();

      // 2. Local dev loopback origin is allowed with credentials
      const localRes = await instance.app.request("http://localhost/api/v1/health", {
        headers: { origin: "http://localhost:5173" },
      });
      expect(localRes.status).toBe(200);
      expect(localRes.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      expect(localRes.headers.get("access-control-allow-credentials")).toBe("true");

      // 3. Configured wildcard subdomain & explicit extension origin are allowed
      const embedRes = await instance.app.request("http://localhost/api/v1/health", {
        headers: { origin: "https://app.inkade.example" },
      });
      expect(embedRes.status).toBe(200);
      expect(embedRes.headers.get("access-control-allow-origin")).toBe("https://app.inkade.example");

      const extRes = await instance.app.request("http://localhost/api/v1/health", {
        headers: { origin: "chrome-extension://allowedext123" },
      });
      expect(extRes.status).toBe(200);
      expect(extRes.headers.get("access-control-allow-origin")).toBe(
        "chrome-extension://allowedext123",
      );

      // 4. Disallowed third-party origin & unapproved extension must not echo ACAO or credentials
      const evilGet = await instance.app.request("http://localhost/api/v1/health", {
        headers: { origin: "https://evil.example.com" },
      });
      expect(evilGet.headers.get("access-control-allow-origin")).toBeNull();
      expect(evilGet.headers.get("access-control-allow-credentials")).toBeNull();

      const evilPreflight = await instance.app.request("http://localhost/api/v1/documents", {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.example.com",
          "access-control-request-method": "POST",
        },
      });
      expect(evilPreflight.status).toBe(403);
      expect(evilPreflight.headers.get("access-control-allow-origin")).toBeNull();
      expect(evilPreflight.headers.get("access-control-allow-credentials")).toBeNull();

      const unapprovedExtPreflight = await instance.app.request(
        "http://localhost/api/v1/documents",
        {
          method: "OPTIONS",
          headers: {
            origin: "chrome-extension://randomuntrustedext",
            "access-control-request-method": "POST",
          },
        },
      );
      expect(unapprovedExtPreflight.status).toBe(403);
      expect(unapprovedExtPreflight.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      if (prevEnv === undefined) {
        delete process.env.INKADE_CORS_ORIGINS;
      } else {
        process.env.INKADE_CORS_ORIGINS = prevEnv;
      }
      instance.close();
    }
  });
});
