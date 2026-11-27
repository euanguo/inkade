import { describe, expect, test } from "bun:test";
import { asUserId } from "@inkade/core";
import { DEFAULT_SPACE_IDS, DEFAULT_WORKSPACE_ID } from "@inkade/db";
import { createInkadeApp } from "./app.ts";

describe("Phase 41 Cross-Engine Tasks & Read-Only ICS Calendar API", () => {
  test("indexes Markdown article tasks into /api/v1/tasks, writes back via AST without clobbering prose, and creates revision", async () => {
    const customDocBody = [
      "# Backend Specs",
      "",
      "Intro prose line must remain verbatim.",
      "",
      "```markdown",
      "- [ ] Ignored code block item",
      "```",
      "",
      "- [ ] Migrate SQLite indexes !p1",
      "- [x] Ship Phase 40",
    ].join("\n");

    const { app, repos, ready } = createInkadeApp({ dbPath: ":memory:", localAutoAuth: true });
    await ready;

    const createDocRes = await app.request("/api/v1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "Storage Migration RFC",
        contentMarkdown: customDocBody,
        tags: ["eng"],
      }),
    });
    expect(createDocRes.status).toBe(201);
    const { document: doc } = (await createDocRes.json()) as {
      document: { id: string; version: number };
    };

    const mdTasksRes = await app.request("/api/v1/tasks?sourceEngine=markdown");
    expect(mdTasksRes.status).toBe(200);
    const { tasks: mdTasks } = (await mdTasksRes.json()) as {
      tasks: Array<{
        taskId: string;
        sourceEngine: string;
        node: { id: string; contentText: string; checked: boolean; priority?: string };
        document: { id: string; kind: string };
      }>;
    };
    expect(mdTasks).toHaveLength(2);
    const openMd = mdTasks.find((t) => t.node.contentText === "Migrate SQLite indexes");
    expect(openMd).toBeDefined();
    expect(openMd!.sourceEngine).toBe("markdown");
    expect(openMd!.document.kind).toBe("article");
    expect(openMd!.node.priority).toBe("p1");

    // Drag / update via PATCH /api/v1/tasks/:taskId (schedule timeblock + dueDate + complete toggle)
    const patchRes = await app.request(`/api/v1/tasks/${openMd!.taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checked: true,
        scheduledDate: "2026-11-26",
        scheduledStartMin: 14 * 60 + 30,
        durationMin: 90,
        dueDate: "2026-11-29",
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchPayload = (await patchRes.json()) as {
      node: { checked: boolean; scheduledStartMin: number; durationMin: number; dueDate: string };
      document: { version: number; contentMarkdown: string };
    };
    expect(patchPayload.node.checked).toBe(true);
    expect(patchPayload.node.scheduledStartMin).toBe(870);
    expect(patchPayload.node.durationMin).toBe(90);
    expect(patchPayload.node.dueDate).toBe("2026-11-29");
    expect(patchPayload.document.version).toBe(2);
    expect(patchPayload.document.contentMarkdown).toContain(
      "Intro prose line must remain verbatim.",
    );
    expect(patchPayload.document.contentMarkdown).toContain(
      "- [x] Migrate SQLite indexes 📅2026-11-26 ⏰14:30-16:00 ⏳2026-11-29 !p1",
    );

    const revs = await repos.revisionLink.listRevisions(doc.id);
    expect(revs.some((r) => r.changeSummary === "Updated task via task board")).toBe(true);
  });

  test("enforces TokenScope on cross-engine /api/v1/tasks queries and mutations", async () => {
    const { app, repos, services, ready } = createInkadeApp({
      dbPath: ":memory:",
      localAutoAuth: false,
    });
    const defaultWorkspaceId = DEFAULT_WORKSPACE_ID;
    await ready;
    await repos.document.createDocument(defaultWorkspaceId, {
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Secret Research Doc",
      contentMarkdown: "- [ ] Confidential item\n",
      tags: ["secret"],
      pinned: false,
    });
    await repos.document.createDocument(defaultWorkspaceId, {
      spaceId: DEFAULT_SPACE_IDS.projects,
      kind: "outline",
      title: "Public Project Plan",
      contentMarkdown: "",
      tags: ["public"],
      pinned: false,
    });

    const ownerUserId = asUserId("usr_local_owner");
    const tokenRes = await services.token.createToken(
      {
        kind: "user",
        userId: ownerUserId,
        workspaceId: defaultWorkspaceId,
        scope: {
          permission: "admin",
          spaceIds: "*",
          includeDescendants: true,
          denyHardDelete: false,
        },
        actorType: "human",
        actorId: ownerUserId,
      },
      {
        name: "Projects Read Token",
        scope: {
          permission: "read",
          spaceIds: [DEFAULT_SPACE_IDS.projects],
          includeDescendants: true,
          denyHardDelete: true,
        },
      },
    );

    const scopedListRes = await app.request("/api/v1/tasks", {
      headers: { Authorization: `Bearer ${tokenRes.rawToken}` },
    });
    expect(scopedListRes.status).toBe(200);
    const { tasks } = (await scopedListRes.json()) as {
      tasks: Array<{ node: { contentText: string } }>;
    };
    expect(tasks.some((t) => t.node.contentText === "Confidential item")).toBe(false);

    // Get secret task ID with unrestricted doc lookup
    const mdRows = await repos.outline.listDocumentTasks(defaultWorkspaceId, {
      sourceEngine: "markdown",
    });
    const secretTaskId = mdRows[0]!.task.id;

    const deniedPatchRes = await app.request(`/api/v1/tasks/${secretTaskId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenRes.rawToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scheduledDate: "2026-11-27" }),
    });
    expect(deniedPatchRes.status).toBe(403);
  });

  test("parses ICS calendar subscription, honors 304 ETag cache, expands RRULE with EXDATE, and exposes read-only events", async () => {
    let fetchCount = 0;
    const sampleIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Inkade Test//EN",
      "BEGIN:VEVENT",
      "UID:weekly-sync-1",
      "DTSTAMP:20261125T000000Z",
      "DTSTART;TZID=UTC:20261124T100000Z",
      "DURATION:PT1H",
      "SUMMARY:Weekly Sync",
      "LOCATION:Zoom",
      "RRULE:FREQ=DAILY;COUNT=4",
      "EXDATE:20261125T100000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const { app, ready } = createInkadeApp({
      dbPath: ":memory:",
      localAutoAuth: true,
      calendarResolveDns: () => Promise.resolve(["93.184.216.34"]),
      calendarFetch: (_url, init) => {
        fetchCount++;
        const hdrs = (init?.headers ?? {}) as Record<string, string>;
        if (hdrs["If-None-Match"] === '"v1"') {
          return Promise.resolve(new Response(null, { status: 304 }));
        }
        return Promise.resolve(
          new Response(sampleIcs, {
            status: 200,
            headers: {
              "Content-Type": "text/calendar",
              ETag: '"v1"',
              "Last-Modified": "Wed, 25 Nov 2026 00:00:00 GMT",
            },
          }),
        );
      },
    });
    await ready;

    const createSubRes = await app.request("/api/v1/calendar-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Work ICS",
        url: "https://calendar.example.com/work.ics",
        color: "#0ea5e9",
      }),
    });
    expect(createSubRes.status).toBe(201);
    const { subscription, syncedCount } = (await createSubRes.json()) as {
      subscription: { id: string; etag: string | null; lastError: string | null };
      syncedCount: number;
    };
    expect(syncedCount).toBe(1);
    expect(subscription.etag).toBe('"v1"');
    expect(subscription.lastError).toBeNull();

    // Refresh again -> hits 304 Not Modified cleanly
    const refreshRes = await app.request(`/api/v1/calendar-subscriptions/${subscription.id}/refresh`, {
      method: "POST",
    });
    expect(refreshRes.status).toBe(200);
    expect(fetchCount).toBe(2);

    // List events across Nov 24 - Nov 27 -> 4 days minus Nov 25 EXDATE = 3 events!
    const eventsRes = await app.request(
      "/api/v1/calendar-events?start=2026-11-24&end=2026-11-27",
    );
    expect(eventsRes.status).toBe(200);
    const { events } = (await eventsRes.json()) as {
      events: Array<{ title: string; startAt: string; readOnly: boolean; recurring: boolean }>;
    };
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.readOnly === true && e.recurring === true)).toBe(true);
    expect(events.map((e) => e.startAt)).toEqual([
      "2026-11-24T10:00:00Z",
      "2026-11-26T10:00:00Z",
      "2026-11-27T10:00:00Z",
    ]);
  });
});
