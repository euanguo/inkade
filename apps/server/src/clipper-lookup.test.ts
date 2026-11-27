import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";

interface LookupHarness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const harnesses: LookupHarness[] = [];

async function startTestServer(): Promise<LookupHarness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-clipper-lookup-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-clipper-lookup-tests-32b",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });

  const harness: LookupHarness = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    instance,
    server,
    tempDir,
  };
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  while (harnesses.length > 0) {
    const h = harnesses.pop();
    if (!h) continue;
    void h.server.stop(true);
    h.instance.close();
    rmSync(h.tempDir, { recursive: true, force: true });
  }
});

describe("GET /api/v1/clips/lookup", () => {
  test("matches normalized URL beyond 50 clips, returns highlights & bindings, and enforces scope", async () => {
    const { baseUrl } = await startTestServer();
    const adminSdk = createInkadeClient({ baseUrl });

    const targetDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "clip",
      title: "Target Architecture Article",
      contentMarkdown: "Key insight about stable node IDs and W3C anchors.",
      tags: ["architecture"],
      sourceUrl: "https://Blog.Example.com/posts/architecture/?b=2&a=1&utm_source=x#top",
    });

    await adminSdk.highlights.create(targetDoc.id, {
      quote: "stable node IDs and W3C anchors",
      prefixContext: "Key insight about ",
      suffixContext: ".",
      color: "blue",
      noteMarkdown: "Core invariant",
    });

    await adminSdk.threadBindings.upsert({
      documentId: targetDoc.id,
      adeKind: "bb",
      externalThreadId: "thr_clip_lookup_1",
      title: "Analyze architecture notes",
      status: "queued",
    });

    // Create an Inbox clip that must remain invisible to a Research-only token
    await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Secret Inbox Clip",
      contentMarkdown: "Confidential note",
      tags: ["private"],
      sourceUrl: "https://secret.example.com/hidden",
    });

    // Seed >55 additional clips to prove lookup is not capped at 50
    for (let i = 0; i < 56; i++) {
      await adminSdk.documents.create({
        spaceId: DEFAULT_SPACE_IDS.inbox,
        kind: "clip",
        title: `Filler Clip ${i}`,
        contentMarkdown: `Content ${i}`,
        sourceUrl: `https://filler.example.com/item/${i}`,
      });
    }

    const { rawToken: researchToken } = await adminSdk.tokens.create({
      name: "research-only",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const researchSdk = createInkadeClient({ baseUrl, token: researchToken });

    // Equivalent URL with different casing, trailing slash, tracking params, and query order
    const found = await researchSdk.clips.lookup(
      "https://blog.example.com/posts/architecture?a=1&utm_medium=email&b=2#comments",
    );
    expect(found.found).toBe(true);
    expect(found.normalizedUrl).toBe("https://blog.example.com/posts/architecture?a=1&b=2");
    expect(found.document?.id).toBe(targetDoc.id);
    expect(found.highlights).toHaveLength(1);
    expect(found.highlights[0]?.quote).toBe("stable node IDs and W3C anchors");
    expect(found.threadBindings).toHaveLength(1);
    expect(found.threadBindings[0]?.externalThreadId).toBe("thr_clip_lookup_1");

    // Scope isolation: Inbox URL returns found=false for research-only token
    const blocked = await researchSdk.clips.lookup("https://secret.example.com/hidden");
    expect(blocked.found).toBe(false);
    expect(blocked.document).toBeNull();
    expect(blocked.highlights).toEqual([]);
    expect(blocked.threadBindings).toEqual([]);

    // Admin can still find Inbox URL
    const adminFound = await adminSdk.clips.lookup("https://secret.example.com/hidden/");
    expect(adminFound.found).toBe(true);
    expect(adminFound.document?.title).toBe("Secret Inbox Clip");
  });
});
