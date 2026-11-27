import { describe, expect, test } from "bun:test";
import { createSqliteDatabase, createSqliteRepositories, DEFAULT_SPACE_IDS, seedDefaultWorkspace } from "./index.ts";

describe("Phase 41 SQLite document_tasks sync and ICS calendar repositories", () => {
  test("indexes outline nodes and Markdown article/clip tasks atomically and respects scope pushdown", async () => {
    const { sqlite, db } = createSqliteDatabase(":memory:");
    try {
      const repos = createSqliteRepositories(sqlite, db);
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-25" });
      const { document: dailyDoc } = await repos.document.getOrCreateDailyOutline(
        workspace.id,
        DEFAULT_SPACE_IDS.daily,
        "2026-11-25",
      );

      const outlineNode = await repos.outline.createOutlineNode(workspace.id, {
        documentId: dailyDoc.id,
        contentMarkdown: "Write architecture spec #spec",
        checked: false,
        priority: "p1",
        scheduledDate: "2026-11-25",
        scheduledStartMin: 540,
        durationMin: 60,
        dueDate: "2026-11-27",
      });

      const articleDoc = await repos.document.createDocument(workspace.id, {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "Implementation Plan",
        contentMarkdown: [
          "# Plan",
          "```ts",
          "- [ ] Not a real task",
          "```",
          "- [ ] Review SQLite migration 📅2026-11-26 ⏰14:00-15:00 !p2",
          "- [x] Initial draft",
        ].join("\n"),
        tags: ["eng"],
        pinned: false,
      });

      const allTasks = await repos.outline.listDocumentTasks(workspace.id);
      expect(allTasks.length).toBeGreaterThanOrEqual(3);

      const mdTasks = await repos.outline.listDocumentTasks(workspace.id, {
        sourceEngine: "markdown",
      });
      expect(mdTasks).toHaveLength(2);
      expect(mdTasks[0]?.task).toMatchObject({
        sourceEngine: "markdown",
        docId: articleDoc.id,
        title: "Review SQLite migration",
        scheduledDate: "2026-11-26",
        scheduledStartMin: 840,
        durationMin: 60,
        priority: "p2",
      });

      const fetchedByOutlineId = await repos.outline.getDocumentTaskById(workspace.id, outlineNode.id);
      expect(fetchedByOutlineId?.task.scheduledStartMin).toBe(540);
      expect(fetchedByOutlineId?.task.tags).toContain("spec");

      // Scope pushdown: restrict to research space and allowedKinds: ["article"]
      const scopedTasks = await repos.outline.listDocumentTasks(workspace.id, {
        spaceIds: [DEFAULT_SPACE_IDS.research],
        allowedKinds: ["article"],
      });
      expect(scopedTasks.map((t) => t.task.docId)).toEqual([articleDoc.id, articleDoc.id]);

      // Trashing article removes its document_tasks; restoring brings them back
      await repos.document.trashDocument(workspace.id, articleDoc.id);
      expect(await repos.outline.listDocumentTasks(workspace.id, { sourceEngine: "markdown" })).toHaveLength(0);
      await repos.document.restoreDocument(workspace.id, articleDoc.id);
      expect(await repos.outline.listDocumentTasks(workspace.id, { sourceEngine: "markdown" })).toHaveLength(2);
    } finally {
      sqlite.close();
    }
  });

  test("manages calendar subscriptions and read-only events cache", async () => {
    const { sqlite, db } = createSqliteDatabase(":memory:");
    try {
      const repos = createSqliteRepositories(sqlite, db);
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-25" });

      const sub = await repos.searchConfig.createCalendarSubscription(workspace.id, {
        name: "Team Calendar",
        url: "https://calendar.example.com/team.ics",
        color: "#0ea5e9",
      });

      const cached = await repos.searchConfig.replaceCalendarEventsCache(workspace.id, sub.id, [
        {
          uid: "evt-1",
          title: "Weekly Architecture Sync",
          description: "Discuss Q4 rollout",
          location: "Room 4",
          startAt: "2026-11-25T10:00:00Z",
          endAt: "2026-11-25T11:00:00Z",
          allDay: false,
          timezone: "UTC",
          rrule: "FREQ=WEEKLY;BYDAY=WE",
          exdates: [],
        },
      ]);
      expect(cached).toHaveLength(1);

      const loaded = await repos.searchConfig.listCalendarEventsCache(workspace.id);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.subscriptionName).toBe("Team Calendar");
      expect(loaded[0]?.color).toBe("#0ea5e9");

      await repos.searchConfig.updateCalendarSubscription(workspace.id, sub.id, { enabled: false });
      expect(await repos.searchConfig.listCalendarEventsCache(workspace.id)).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  });
});
