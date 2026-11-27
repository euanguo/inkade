import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_USER_PREFERENCES } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, InkadeApiError } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";

interface Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Harness[] = [];

async function startTestServer(): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase36-prefs-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase36-suite-32bytes",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });

  const h: Harness = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    instance,
    server,
    tempDir,
  };
  activeHarnesses.push(h);
  return h;
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

describe("Phase 36 — User Preferences Server Persistence & SSE Sync", () => {
  test("reads defaults, deep-merges PATCH updates, validates payload, and isolates principals", async () => {
    const { baseUrl } = await startTestServer();
    const ownerClient = createInkadeClient({ baseUrl });

    const initial = await ownerClient.preferences.get();
    expect(initial.updatedAt).toBeNull();
    expect(initial.preferences).toEqual(DEFAULT_USER_PREFERENCES);

    const updated1 = await ownerClient.preferences.update({
      tasks: { viewMode: "board", boardGroupBy: "priority" },
      daily: { focusRailOpen: true, viewMode: "kanban" },
      layout: { workspaceCanvasWidth: "centered", sidebarMode: "doc" },
      reader: { measure: "full", paper: "sepia" },
    });
    expect(updated1.updatedAt).not.toBeNull();
    expect(updated1.preferences.tasks.viewMode).toBe("board");
    expect(updated1.preferences.tasks.boardGroupBy).toBe("priority");
    expect(updated1.preferences.daily.focusRailOpen).toBe(true);
    expect(updated1.preferences.daily.viewMode).toBe("kanban");
    expect(updated1.preferences.layout.workspaceCanvasWidth).toBe("centered");
    expect(updated1.preferences.layout.sidebarMode).toBe("doc");
    expect(updated1.preferences.reader.measure).toBe("full");

    // Second partial patch keeps untouched nested fields intact
    const updated2 = await ownerClient.preferences.update({
      library: { viewMode: "table", sortBy: "title", sortDir: "asc" },
      inbox: { defaultTab: "clips" },
    });
    expect(updated2.preferences.tasks.viewMode).toBe("board");
    expect(updated2.preferences.library.viewMode).toBe("table");
    expect(updated2.preferences.library.sortBy).toBe("title");
    expect(updated2.preferences.inbox.defaultTab).toBe("clips");
    expect(updated2.preferences.reader.measure).toBe("full");

    // Invalid preference enum value is rejected cleanly with 400
    let validationErr: unknown = null;
    try {
      await ownerClient.preferences.update({
        // @ts-expect-error testing server Zod rejection on invalid measure literal
        reader: { measure: "999ch" },
      });
    } catch (err) {
      validationErr = err;
    }
    expect(validationErr).toBeInstanceOf(InkadeApiError);
    expect((validationErr as InkadeApiError).status).toBe(400);

    // Scoped token gets its own isolated preference record
    const tokenRes = await ownerClient.tokens.create({
      name: "Scoped Agent Prefs",
      scope: {
        spaceIds: [DEFAULT_SPACE_IDS.daily],
        allowedKinds: ["outline"],
        permission: "write",
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const tokenClient = createInkadeClient({ baseUrl, token: tokenRes.rawToken });
    const tokenInitial = await tokenClient.preferences.get();
    expect(tokenInitial.preferences.tasks.viewMode).toBe("list");

    const tokenUpdated = await tokenClient.preferences.update({
      threads: { viewMode: "conflicts" },
    });
    expect(tokenUpdated.preferences.threads.viewMode).toBe("conflicts");

    const ownerStillBoard = await ownerClient.preferences.get();
    expect(ownerStillBoard.preferences.tasks.viewMode).toBe("board");
    expect(ownerStillBoard.preferences.threads.viewMode).toBe("status");
  });
});
