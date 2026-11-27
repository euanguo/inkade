import { describe, expect, it } from "bun:test";
import {
  asDocumentId,
  asOutlineNodeId,
  asSpaceId,
  asThreadBindingId,
  asWorkspaceId,
  parseQuickTaskSyntax,
  type OutlineNode,
  type Space,
  type WorkspaceTaskItem,
} from "@inkade/core";
import { InkadeI18nProvider, initInkadeI18n } from "@inkade/i18n";
import { createInkadeClient } from "@inkade/sdk";
import { InkadeSdkProvider } from "@inkade/sdk/react";
import { bindPragmaticDraggable, OutlineKanbanBoard, TASK_PRIORITY_STYLES, ToastProvider } from "@inkade/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  InkadeViewsProvider,
  layoutAgendaBlocks,
  slotForAgendaHour,
  TaskItemCard,
  TaskSchedulePopover,
  TasksAgendaView,
  TasksBoardView,
  TasksView,
} from "./index.ts";

function wrapWithProviders(
  node: React.ReactElement,
  locale: "zh-CN" | "en-US" = "en-US",
): string {
  initInkadeI18n(locale);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  const client = createInkadeClient({
    baseUrl: "http://127.0.0.1:0",
    fetch: () => Promise.resolve(new Response("[]", { status: 200 })),
  });

  return renderToStaticMarkup(
    <InkadeI18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <InkadeSdkProvider client={client}>
            <InkadeViewsProvider
              navigation={{
                openDocument: () => {},
                openDaily: () => {},
                openSpace: () => {},
                openLibrary: () => {},
              }}
            >
              {node}
            </InkadeViewsProvider>
          </InkadeSdkProvider>
        </ToastProvider>
      </QueryClientProvider>
    </InkadeI18nProvider>,
  );
}

const SAMPLE_SPACE: Space = {
  id: asSpaceId("spc_eng"),
  workspaceId: asWorkspaceId("ws_1"),
  parentId: null,
  name: "Engineering",
  slug: "engineering",
  icon: "code",
  color: "#4f46e5",
  defaultKind: "outline",
  sortOrder: 1,
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

function makeTaskItem(overrides: {
  readonly id?: string;
  readonly contentMarkdown?: string;
  readonly checked?: boolean | null;
  readonly priority?: OutlineNode["priority"];
  readonly scheduledDate?: string | null;
  readonly scheduledSlot?: OutlineNode["scheduledSlot"];
  readonly durationMin?: number | null;
  readonly recurrenceRule?: OutlineNode["recurrenceRule"];
  readonly dailyDate?: string | null;
  readonly subtasks?: WorkspaceTaskItem["subtasks"];
} = {}): WorkspaceTaskItem {
  const id = asOutlineNodeId(overrides.id ?? "node_1");
  const docId = asDocumentId("doc_1");
  const wsId = asWorkspaceId("ws_1");
  const contentMarkdown = overrides.contentMarkdown ?? "Ship enterprise telemetry #infra";
  const dailyDate = overrides.dailyDate === undefined ? null : overrides.dailyDate;
  return {
    node: {
      id,
      documentId: docId,
      parentNodeId: null,
      orderKey: "a0",
      contentMarkdown,
      contentText: contentMarkdown,
      checked: overrides.checked === undefined ? false : overrides.checked,
      collapsed: false,
      authorType: "human",
      authorId: null,
      sourceBindingId: null,
      ...(overrides.priority !== undefined ? { priority: overrides.priority } : {}),
      ...(overrides.scheduledDate !== undefined
        ? { scheduledDate: overrides.scheduledDate }
        : {}),
      ...(overrides.scheduledSlot !== undefined
        ? { scheduledSlot: overrides.scheduledSlot }
        : {}),
      ...(overrides.durationMin !== undefined
        ? { durationMin: overrides.durationMin }
        : {}),
      ...(overrides.recurrenceRule !== undefined
        ? { recurrenceRule: overrides.recurrenceRule }
        : {}),
      createdAt: "2026-11-25T08:00:00Z",
      updatedAt: "2026-11-25T08:00:00Z",
      deletedAt: null,
    },
    document: {
      id: docId,
      title: "Q4 Launch Plan",
      spaceId: asSpaceId("spc_eng"),
      dailyDate,
      tags: ["infra"],
    },
    bindings: [
      {
        id: asThreadBindingId("bnd_1"),
        workspaceId: wsId,
        documentId: docId,
        nodeId: id,
        selectionAnchor: null,
        adeKind: "codex",
        externalWorkspaceId: null,
        externalThreadId: "thr_1",
        deepLink: null,
        title: "Verify telemetry migration",
        status: "running",
        lastSummary: null,
        unreadResult: false,
        lastSyncedAt: "2026-11-25T08:00:00Z",
        createdAt: "2026-11-25T08:00:00Z",
      },
    ],
    ...(overrides.subtasks ? { subtasks: overrides.subtasks } : {}),
  };
}

describe("Phase 32 Enterprise Todo UI", () => {
  it("renders TaskItemCard with priority accent, slot/duration/recurrence/subtask metadata and a single completion checkbox", () => {
    const item = makeTaskItem({
      priority: "p1",
      scheduledDate: "2026-11-25",
      scheduledSlot: "morning",
      durationMin: 90,
      recurrenceRule: "weekly",
      subtasks: [
        { id: asOutlineNodeId("sub_1"), contentMarkdown: "Schema check", contentText: "Schema check", checked: true },
        { id: asOutlineNodeId("sub_2"), contentMarkdown: "Run benchmarks", contentText: "Run benchmarks", checked: false },
      ],
    });

    const html = wrapWithProviders(
      <TaskItemCard
        item={item}
        onToggleBatchSelect={() => {}}
        onToggleComplete={() => {}}
        onUpdateSchedule={() => {}}
        space={SAMPLE_SPACE}
        todayDate="2026-11-25"
      />,
      "en-US",
    );

    expect(html).toContain("bg-red-500");
    expect(html).toContain("P1");
    expect(html).toContain("2026-11-25");
    expect(html).toContain("Morning");
    expect(html).toContain("1.5h");
    expect(html).toContain("Weekly");
    expect(html).toContain("1/2");
    expect(html).toContain("Q4 Launch Plan");
    expect(html).toContain("Engineering");
    expect(html).toContain("Ship enterprise telemetry");
    // Completion Checkbox uses role="checkbox"; batch select uses aria-pressed button so Playwright strict checkbox selectors stay unique
    const checkboxMatches = html.match(/role="checkbox"/g) ?? [];
    expect(checkboxMatches.length).toBe(1);
    expect(html).toContain('data-slot="task-batch-select"');
  });

  it("renders Anytime badge when task has no scheduledDate", () => {
    const item = makeTaskItem({
      priority: "p3",
      scheduledDate: null,
      dailyDate: null,
    });
    const html = wrapWithProviders(
      <TaskItemCard
        item={item}
        onToggleComplete={() => {}}
        onUpdateSchedule={() => {}}
        todayDate="2026-11-25"
      />,
      "en-US",
    );
    expect(html).toContain("bg-blue-500");
    expect(html).toContain("Anytime");
    expect(html).toContain("P3");
  });

  it("renders TaskSchedulePopover trigger in both zh-CN and en-US", () => {
    const triggerZh = wrapWithProviders(
      <TaskSchedulePopover
        onUpdate={() => {}}
        todayDate="2026-11-25"
        value={{
          scheduledDate: "2026-11-25",
          scheduledSlot: "morning",
          durationMin: 30,
          priority: "p2",
          recurrenceRule: null,
        }}
      />,
      "zh-CN",
    );
    expect(triggerZh).toContain("安排日程");

    const triggerEn = wrapWithProviders(
      <TaskSchedulePopover
        onUpdate={() => {}}
        todayDate="2026-11-25"
        value={{
          scheduledDate: null,
          scheduledSlot: null,
          durationMin: null,
          priority: null,
          recurrenceRule: null,
        }}
      />,
      "en-US",
    );
    expect(triggerEn).toContain("When");
  });

  it("renders unprioritized TaskItemCard without a pale left vertical stripe", () => {
    expect(TASK_PRIORITY_STYLES.none.barClass).toBe("");
    expect(typeof bindPragmaticDraggable).toBe("function");

    const item = makeTaskItem({
      priority: undefined,
      scheduledDate: "2026-11-25",
    });
    const html = wrapWithProviders(
      <TaskItemCard
        item={item}
        onToggleComplete={() => {}}
        onUpdateSchedule={() => {}}
        todayDate="2026-11-25"
      />,
      "en-US",
    );
    expect(html).not.toContain("bg-border/55");
    expect(html).not.toContain("left-0 w-[3px]");
  });

  it("renders TasksView with slim header, group pills, filter popover trigger, and quick syntax tooltip", () => {
    const html = wrapWithProviders(<TasksView />, "en-US");
    expect(html).toContain("List");
    expect(html).toContain("Board");
    expect(html).toContain("Agenda");
    expect(html).toContain("Filters");
    expect(html).toContain("Anytime");
    expect(html).toContain("Quick syntax:");
  });

  it("renders TasksBoardView with schedule bucket columns including Overdue, Anytime, Today, Tomorrow, Week, Upcoming", () => {
    const spacesById = new Map([[SAMPLE_SPACE.id, SAMPLE_SPACE]]);
    const tasks: WorkspaceTaskItem[] = [
      makeTaskItem({ id: "t_over", contentMarkdown: "Overdue item", scheduledDate: "2026-11-24", priority: "p1" }),
      makeTaskItem({ id: "t_any", contentMarkdown: "Anytime item", scheduledDate: null, priority: "p4" }),
      makeTaskItem({ id: "t_today", contentMarkdown: "Today item", scheduledDate: "2026-11-25", scheduledSlot: "morning", durationMin: 45 }),
      makeTaskItem({ id: "t_tmw", contentMarkdown: "Tomorrow item", scheduledDate: "2026-11-26" }),
      makeTaskItem({ id: "t_week", contentMarkdown: "Week item", scheduledDate: "2026-11-29" }),
      makeTaskItem({ id: "t_up", contentMarkdown: "Upcoming item", scheduledDate: "2026-12-10" }),
    ];

    const html = wrapWithProviders(
      <TasksBoardView
        onToggleComplete={() => {}}
        onUpdateSchedule={() => {}}
        spacesById={spacesById}
        tasks={tasks}
        todayDate="2026-11-25"
      />,
      "en-US",
    );

    expect(html).toContain('data-board-column="schedule:overdue"');
    expect(html).toContain('data-board-column="schedule:anytime"');
    expect(html).toContain('data-board-column="schedule:today"');
    expect(html).toContain('data-board-column="schedule:tomorrow"');
    expect(html).toContain('data-board-column="schedule:week"');
    expect(html).toContain('data-board-column="schedule:upcoming"');
    expect(html).toContain("xl:grid");
    expect(html).toContain("xl:auto-cols-fr");
    expect(html).toContain("xl:min-w-0");
    expect(html).toContain("min-w-0 max-w-full");
    expect(html).toContain("Overdue item");
    expect(html).toContain("Anytime item");
    expect(html).toContain("Today item");
    expect(html).toContain("45m");
  });

  it("renders TasksAgendaView hourly timeline 06:00-22:00 and places non-overlapping timeblocks", () => {
    expect(slotForAgendaHour(7)).toBe("morning");
    expect(slotForAgendaHour(14)).toBe("afternoon");
    expect(slotForAgendaHour(20)).toBe("evening");

    const spacesById = new Map([[SAMPLE_SPACE.id, SAMPLE_SPACE]]);
    const tasks: WorkspaceTaskItem[] = [
      makeTaskItem({
        id: "ag_any",
        contentMarkdown: "Backlog triage",
        scheduledDate: null,
      }),
      makeTaskItem({
        id: "ag_morn_1",
        contentMarkdown: "Morning standup",
        scheduledDate: "2026-11-25",
        scheduledSlot: "morning",
        durationMin: 30,
        priority: "p1",
      }),
      makeTaskItem({
        id: "ag_morn_2",
        contentMarkdown: "Code review",
        scheduledDate: "2026-11-25",
        scheduledSlot: "morning",
        durationMin: 60,
        priority: "p2",
      }),
    ];

    const blocks = layoutAgendaBlocks(tasks, "2026-11-25", {});
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.startHour).toBe(9);
    expect(blocks[1]?.startHour).toBe(9.5);

    const html = wrapWithProviders(
      <TasksAgendaView
        onToggleComplete={() => {}}
        onUpdateSchedule={() => {}}
        spacesById={spacesById}
        tasks={tasks}
        todayDate="2026-11-25"
      />,
      "en-US",
    );

    expect(html).toContain('data-testid="agenda-anytime-rail"');
    expect(html).toContain("06:00");
    expect(html).toContain("22:00");
    expect(html).toContain("Backlog triage");
    expect(html).toContain("Morning standup");
    expect(html).toContain("Code review");
  });

  it("renders OutlineKanbanBoard with priority stripe, slot/duration/recurrence badges and priority group tab", () => {
    const nodes: OutlineNode[] = [
      {
        id: asOutlineNodeId("kb_1"),
        documentId: asDocumentId("doc_daily"),
        parentNodeId: null,
        orderKey: "a0",
        contentMarkdown: "Refactor scheduler",
        contentText: "Refactor scheduler",
        checked: false,
        collapsed: false,
        authorType: "human",
        authorId: null,
        sourceBindingId: null,
        priority: "p1",
        scheduledDate: "2026-11-26",
        scheduledSlot: "afternoon",
        durationMin: 60,
        recurrenceRule: "weekdays",
        createdAt: "2026-11-25T08:00:00Z",
        updatedAt: "2026-11-25T08:00:00Z",
        deletedAt: null,
      },
    ];

    const html = wrapWithProviders(
      <OutlineKanbanBoard currentDate="2026-11-25" documentId={asDocumentId("doc_daily")} nodes={nodes} />,
      "en-US",
    );

    expect(html).toContain("By Priority");
    expect(html).toContain("bg-red-500");
    expect(html).toContain("P1");
    expect(html).toContain("2026-11-26");
    expect(html).toContain("Afternoon");
    expect(html).toContain("1h");
    expect(html).toContain("Weekdays");
  });

  it("parses bilingual quick syntax tokens accurately for live preview", () => {
    const parsed = parseQuickTaskSyntax(
      "Ship release !1 明天 上午 1.5h 每周",
      new Date(2026, 10, 25),
    );
    expect(parsed.title).toBe("Ship release");
    expect(parsed.priority).toBe("p1");
    expect(parsed.scheduledDate).toBe("2026-11-26");
    expect(parsed.scheduledSlot).toBe("morning");
    expect(parsed.durationMin).toBe(90);
    expect(parsed.recurrenceRule).toBe("weekly");
  });
});
