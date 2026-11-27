import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_HOST_KIND } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";

interface OpenHostHarness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: OpenHostHarness[] = [];

async function startOpenHostServer(): Promise<OpenHostHarness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-open-host-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-open-host-suite-32b",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });

  const harness: OpenHostHarness = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    instance,
    server,
    tempDir,
  };
  activeHarnesses.push(harness);
  return harness;
}

afterEach(() => {
  while (activeHarnesses.length > 0) {
    const h = activeHarnesses.pop()!;
    void h.server.stop(true);
    h.instance.close();
    rmSync(h.tempDir, { recursive: true, force: true });
  }
});

describe("Phase 1 open host model and atomic claiming", () => {
  test("creates queued bindings with neutral host and atomically claims into concrete host slugs", async () => {
    const { baseUrl } = await startOpenHostServer();
    const client = createInkadeClient({ baseUrl });

    const doc = await client.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Open Host Dispatch Spec",
      contentMarkdown: "# Open Host\nReady for any host.",
    });

    const pendingOne = await client.threadBindings.upsert({
      documentId: doc.id,
      nodeId: null,
      adeKind: DEFAULT_HOST_KIND,
      externalThreadId: "thr_pending_open_1",
      title: "Pending task 1",
      status: "queued",
      unreadResult: false,
    });
    expect(pendingOne.adeKind).toBe("any");

    const claimedCursor = await client.threadBindings.claim(pendingOne.id, {
      adeKind: "Cursor",
      externalThreadId: "cur_1",
      deepLink: "cursor://thread/cur_1",
    });
    expect(claimedCursor.adeKind).toBe("cursor");
    expect(claimedCursor.externalThreadId).toBe("cur_1");
    expect(claimedCursor.deepLink).toBe("cursor://thread/cur_1");
    expect(claimedCursor.status).toBe("running");

    const pendingTwo = await client.threadBindings.upsert({
      documentId: doc.id,
      nodeId: null,
      adeKind: DEFAULT_HOST_KIND,
      externalThreadId: "thr_pending_open_2",
      title: "Pending task 2",
      status: "queued",
      unreadResult: false,
    });

    // Claiming duplicate (cursor, cur_1) must return 409 CONFLICT
    const dupRes = await fetch(
      `${baseUrl}/api/v1/thread-bindings/${encodeURIComponent(pendingTwo.id)}/claim`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          adeKind: "cursor",
          externalThreadId: "cur_1",
        }),
      },
    );
    expect(dupRes.status).toBe(409);

    // Same externalThreadId under a different open host slug ("opencode") succeeds
    const claimedOpencode = await client.threadBindings.claim(pendingTwo.id, {
      adeKind: "opencode",
      externalThreadId: "cur_1",
    });
    expect(claimedOpencode.adeKind).toBe("opencode");
    expect(claimedOpencode.externalThreadId).toBe("cur_1");

    // Arbitrary dotted/hyphenated host slug is also accepted directly
    const customBinding = await client.threadBindings.upsert({
      documentId: doc.id,
      nodeId: null,
      adeKind: "custom.ade-1",
      externalThreadId: "ext_custom_1",
      title: "Custom ADE run",
      status: "running",
      unreadResult: false,
    });
    expect(customBinding.adeKind).toBe("custom.ade-1");

    const listed = await client.threadBindings.list({ documentId: doc.id });
    expect(listed.map((b) => b.adeKind).sort()).toEqual(["cursor", "custom.ade-1", "opencode"]);
  });
});
