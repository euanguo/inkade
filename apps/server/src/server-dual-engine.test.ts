import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InkadeEvent } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, subscribeInkadeEvents } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";

interface TestHarness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: TestHarness[] = [];

async function startTestServer(options?: { localAutoAuth?: boolean }): Promise<TestHarness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-dual-engine-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: options?.localAutoAuth ?? false,
    authSecret: "test-secret-key-for-inkade-integration-suite-32bytes",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });

  const harness: TestHarness = {
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
    const h = activeHarnesses.pop();
    if (!h) continue;
    void h.server.stop(true);
    h.instance.close();
    rmSync(h.tempDir, { recursive: true, force: true });
  }
});

async function waitFor<T>(
  predicate: () => T | undefined | null | false,
  timeoutMs = 3000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await Bun.sleep(20);
  }
  throw new Error("Timed out waiting for condition");
}

describe("DocumentService dual-engine guards", () => {
  test("guards outline dual-engine integrity, trashed states, daily restore collisions, subtree notes, and scoped backlink SSE", async () => {
    const { baseUrl } = await startTestServer({ localAutoAuth: true });
    const adminSdk = createInkadeClient({ baseUrl });

    const outlineCreated = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "outline",
      title: "Architecture Outline Guard",
      tags: ["shared"],
    });
    const outlineId = outlineCreated.id;

    const n1 = await adminSdk.outlineNodes.create({
      documentId: outlineId,
      contentMarkdown: "Root milestone note check",
      noteMarkdown: "Detailed rationale on root node",
    });
    const n2 = await adminSdk.outlineNodes.create({
      documentId: outlineId,
      parentNodeId: n1.id,
      contentMarkdown: "Sub-task item",
      noteMarkdown: "Child note preserved during promote",
    });
    expect(n2.parentNodeId).toBe(n1.id);

    const directOverwriteRes = await fetch(`${baseUrl}/api/v1/documents/${outlineId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentMarkdown: "Raw markdown overwrite attempt" }),
    });
    expect(directOverwriteRes.status).toBe(400);

    const patchSectionOutlineRes = await fetch(`${baseUrl}/api/v1/documents/${outlineId}/patch-section`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        headingPath: "Root",
        mode: "replace",
        markdown: "Blocked",
      }),
    });
    expect(patchSectionOutlineRes.status).toBe(400);

    const promoteRes = await fetch(`${baseUrl}/api/v1/outline-nodes/${n1.id}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetSpaceId: DEFAULT_SPACE_IDS.research,
        title: "Promoted Architecture Spec",
        keepLinkInNode: false,
      }),
    });
    expect(promoteRes.status).toBe(201);
    const promoted = (await promoteRes.json()) as { article: { contentMarkdown: string } };
    expect(promoted.article.contentMarkdown).toContain("Detailed rationale on root node");
    expect(promoted.article.contentMarkdown).toContain("Child note preserved during promote");

    const docBeforeUpdate = await adminSdk.documents.get(outlineId);
    await adminSdk.outlineNodes.update(n2.id, { contentMarkdown: "Modified sub-task v3" });
    const afterUpdateNodes = await adminSdk.outlineNodes.list(outlineId);
    expect(afterUpdateNodes.some((n) => n.contentMarkdown.includes("Modified sub-task v3"))).toBe(true);

    const revRestoreRes = await fetch(
      `${baseUrl}/api/v1/documents/${outlineId}/revisions/${docBeforeUpdate.version}/restore`,
      { method: "POST" },
    );
    expect(revRestoreRes.status).toBe(200);
    const restoredNodes = await adminSdk.outlineNodes.list(outlineId);
    expect(restoredNodes.some((n) => n.contentMarkdown === "Sub-task item")).toBe(true);

    await adminSdk.documents.trash(outlineId);
    const trashedPatchRes = await fetch(`${baseUrl}/api/v1/documents/${outlineId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Should fail while trashed" }),
    });
    expect(trashedPatchRes.status).toBe(409);

    const trashedRevRestoreRes = await fetch(
      `${baseUrl}/api/v1/documents/${outlineId}/revisions/1/restore`,
      { method: "POST" },
    );
    expect(trashedRevRestoreRes.status).toBe(409);
    await adminSdk.documents.restore(outlineId);

    const dailyFirst = await adminSdk.documents.getDaily("2026-12-01");
    await adminSdk.documents.trash(dailyFirst.document.id);
    const dailySecond = await adminSdk.documents.getDaily("2026-12-01");
    expect(dailySecond.document.id).not.toBe(dailyFirst.document.id);

    const dailyCollisionRestore = await fetch(
      `${baseUrl}/api/v1/documents/${dailyFirst.document.id}/restore`,
      { method: "POST" },
    );
    expect(dailyCollisionRestore.status).toBe(409);

    const targetDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Original Scope Target",
      contentMarkdown: "# Original Scope Target\n\nCanonical doc.",
      tags: ["public"],
    });
    const allowedSrc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Allowed Backlink Source",
      contentMarkdown: "# Allowed Backlink Source\n\nSee [[Original Scope Target]].",
      tags: ["public"],
    });
    const forbiddenSrc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Forbidden Inbox Backlink",
      contentMarkdown: "# Forbidden Inbox Backlink\n\nSee [[Original Scope Target]].",
      tags: ["public"],
    });

    const { rawToken } = await adminSdk.tokens.create({
      name: "research-writer",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const scopedSdk = createInkadeClient({ baseUrl, token: rawToken });

    const sseEvents: InkadeEvent[] = [];
    let sseOpen = false;
    const sub = subscribeInkadeEvents(
      { baseUrl },
      {
        onOpen: () => {
          sseOpen = true;
        },
        onEvent: (evt) => {
          sseEvents.push(evt);
        },
      },
    );
    await waitFor(() => sseOpen);

    try {
      await scopedSdk.documents.update(targetDoc.id, {
        title: "Renamed Scope Target",
        syncBacklinks: true,
      });

      const allowedAfter = await adminSdk.documents.get(allowedSrc.id);
      const forbiddenAfter = await adminSdk.documents.get(forbiddenSrc.id);
      expect(allowedAfter.contentMarkdown).toContain("[[Renamed Scope Target]]");
      expect(forbiddenAfter.contentMarkdown).toContain("[[Original Scope Target]]");

      await waitFor(() =>
        sseEvents.find((e) => e.type === "document.updated" && e.documentId === allowedSrc.id),
      );
      expect(
        sseEvents.some((e) => e.type === "document.updated" && e.documentId === allowedSrc.id),
      ).toBe(true);
    } finally {
      sub.unsubscribe();
    }
  });
});
