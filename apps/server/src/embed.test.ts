import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asApiTokenId, asSpaceId, asWorkspaceId } from "@inkade/core";
import { EmbedTicketManager } from "./auth/embed-ticket.ts";
import { createInkadeApp, sanitizeForwardedPrefix } from "./app.ts";
import type { Principal } from "./types.ts";

describe("Embed server support (basePath, CSP frame-ancestors, embedTicket)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sanitizes X-Forwarded-Prefix strictly and rejects XSS / protocol-relative injections", () => {
    expect(sanitizeForwardedPrefix("/proxy/inkade")).toBe("/proxy/inkade");
    expect(sanitizeForwardedPrefix("/proxy/inkade/")).toBe("/proxy/inkade");
    expect(sanitizeForwardedPrefix("/api/v1/plugins/inkade/http")).toBe(
      "/api/v1/plugins/inkade/http",
    );
    expect(sanitizeForwardedPrefix("/")).toBe("");
    expect(sanitizeForwardedPrefix("")).toBe("");
    expect(sanitizeForwardedPrefix("//evil.com")).toBe("");
    expect(sanitizeForwardedPrefix("https://evil.com")).toBe("");
    expect(sanitizeForwardedPrefix('/bad"<script>')).toBe("");
    expect(sanitizeForwardedPrefix("/no spaces")).toBe("");
  });

  it("injects sanitized base href + __INKADE_BASE_PATH__ and frame-ancestors CSP on HTML responses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inkade-embed-html-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "index.html"),
      "<!doctype html><html><head><title>Inkade</title></head><body><div id='root'></div></body></html>",
    );

    const instance = createInkadeApp({
      dbPath: join(dir, "inkade.db"),
      dataDir: dir,
      localAutoAuth: true,
      webDistDir: dir,
      frameAncestors: "'self' https://*.inkade.example http://localhost:*",
    });

    try {
      const res = await instance.app.request("http://localhost/daily", {
        headers: {
          "x-forwarded-prefix": "/proxy/inkade/",
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toBe(
        "frame-ancestors 'self' https://*.inkade.example http://localhost:*",
      );
      const html = await res.text();
      expect(html).toContain('<base href="/proxy/inkade/" />');
      expect(html).toContain('window.__INKADE_BASE_PATH__="/proxy/inkade";');

      // Malicious prefix falls back cleanly to "/"
      const unsafeRes = await instance.app.request("http://localhost/daily", {
        headers: {
          "x-forwarded-prefix": '/"><script>alert(1)</script>',
        },
      });
      const unsafeHtml = await unsafeRes.text();
      expect(unsafeHtml).toContain('<base href="/" />');
      expect(unsafeHtml).toContain('window.__INKADE_BASE_PATH__="";');
      expect(unsafeHtml).not.toContain("alert(1)");
    } finally {
      instance.close();
    }
  });

  it("enforces single-use and TTL expiry in EmbedTicketManager", async () => {
    const manager = new EmbedTicketManager({ ticketTtlMs: 30, sessionTtlMs: 1000 });
    const principal: Principal = {
      kind: "token",
      tokenId: asApiTokenId("tok_1"),
      tokenName: "Restricted Agent",
      workspaceId: asWorkspaceId("ws_1"),
      scope: {
        permission: "read",
        spaceIds: [asSpaceId("spc_research")],
        includeDescendants: true,
        denyHardDelete: true,
      },
      actorType: "agent",
      actorId: asApiTokenId("tok_1"),
    };

    const issued = await manager.issueTicket(principal);
    expect(issued.ticket.startsWith("etk_")).toBe(true);

    const exchanged = await manager.exchangeTicket(issued.ticket);
    expect(exchanged).not.toBeNull();
    expect(exchanged?.accessToken.startsWith("ink_emb_")).toBe(true);

    // Second exchange must fail (single-use)
    const replay = await manager.exchangeTicket(issued.ticket);
    expect(replay).toBeNull();

    // Session preserves exact principal & scope
    const resolved = await manager.resolveSessionToken(exchanged!.accessToken);
    expect(resolved?.scope).toEqual(principal.scope);

    // Expiry check
    const expiring = await manager.issueTicket(principal);
    await new Promise((r) => setTimeout(r, 45));
    expect(await manager.exchangeTicket(expiring.ticket)).toBeNull();
  });

  it("bounds in-memory ticket and session capacities and evicts oldest entries", async () => {
    const manager = new EmbedTicketManager({
      ticketTtlMs: 60_000,
      sessionTtlMs: 60_000,
      maxTickets: 2,
      maxSessions: 2,
    });
    const principal: Principal = {
      kind: "token",
      tokenId: asApiTokenId("tok_cap"),
      tokenName: "Capacity Probe",
      workspaceId: asWorkspaceId("ws_1"),
      scope: { permission: "read", spaceIds: "*", includeDescendants: true, denyHardDelete: true },
      actorType: "agent",
      actorId: asApiTokenId("tok_cap"),
    };

    const t1 = await manager.issueTicket(principal);
    const t2 = await manager.issueTicket(principal);
    const t3 = await manager.issueTicket(principal);
    expect(manager.activeTicketCount).toBe(2);

    // t1 was evicted when t3 was issued; t2 and t3 remain exchangeable
    expect(await manager.exchangeTicket(t1.ticket)).toBeNull();
    const s2 = await manager.exchangeTicket(t2.ticket);
    const s3 = await manager.exchangeTicket(t3.ticket);
    expect(s2).not.toBeNull();
    expect(s3).not.toBeNull();
    expect(manager.activeSessionCount).toBe(2);

    // Touch s2 so s3 becomes least-recently-used before issuing a 3rd session
    expect(await manager.resolveSessionToken(s2!.accessToken)).not.toBeNull();
    const t4 = await manager.issueTicket(principal);
    const s4 = await manager.exchangeTicket(t4.ticket);
    expect(s4).not.toBeNull();
    expect(manager.activeSessionCount).toBe(2);
    expect(await manager.resolveSessionToken(s3!.accessToken)).toBeNull();
    expect(await manager.resolveSessionToken(s2!.accessToken)).not.toBeNull();
    expect(await manager.resolveSessionToken(s4!.accessToken)).not.toBeNull();
  });

  it("issues embedTicket over API, enforces single-use exchange, and preserves scoped token permissions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inkade-embed-api-"));
    tempDirs.push(dir);
    const instance = createInkadeApp({
      dbPath: join(dir, "inkade.db"),
      dataDir: dir,
      localAutoAuth: true,
      skipSeed: false,
    });

    try {
      await instance.ready;
      const createTokenRes = await instance.app.request("http://localhost/api/v1/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Embed Read Research Only",
          scope: {
            permission: "read",
            spaceIds: ["spc_research"],
            includeDescendants: true,
            denyHardDelete: true,
          },
        }),
      });
      expect(createTokenRes.status).toBe(201);
      const tokenBody = (await createTokenRes.json()) as {
        token: { id: string };
        rawToken: string;
      };

      const ticketRes = await instance.app.request("http://localhost/api/v1/auth/embed-ticket", {
        method: "POST",
        headers: { authorization: `Bearer ${tokenBody.rawToken}` },
      });
      expect(ticketRes.status).toBe(201);
      const ticketBody = (await ticketRes.json()) as { ticket: string };

      const exchangeRes = await instance.app.request(
        "http://localhost/api/v1/auth/embed-ticket/exchange",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ticket: ticketBody.ticket }),
        },
      );
      expect(exchangeRes.status).toBe(200);
      const { accessToken } = (await exchangeRes.json()) as { accessToken: string };
      expect(accessToken.startsWith("ink_emb_")).toBe(true);

      // Replay attempt rejected
      const replayRes = await instance.app.request(
        "http://localhost/api/v1/auth/embed-ticket/exchange",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ticket: ticketBody.ticket }),
        },
      );
      expect(replayRes.status).toBe(401);

      // Scoped whoami succeeds and preserves read-only research scope
      const whoamiRes = await instance.app.request("http://localhost/api/v1/whoami", {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(whoamiRes.status).toBe(200);
      const whoami = (await whoamiRes.json()) as {
        scope: { permission: string; spaceIds: string[] };
      };
      expect(whoami.scope.permission).toBe("read");
      expect(whoami.scope.spaceIds).toEqual(["spc_research"]);

      // Scope boundary still enforced: write attempt must be forbidden
      const writeRes = await instance.app.request("http://localhost/api/v1/documents", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          spaceId: "spc_research",
          kind: "article",
          title: "Should fail",
        }),
      });
      expect(writeRes.status).toBe(403);
    } finally {
      instance.close();
    }
  });
});
