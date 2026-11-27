import { describe, expect, it } from "bun:test";
import {
  asCalendarEventId,
  asCalendarSubId,
  asDocumentId,
  asDocumentTaskId,
  asOutlineNodeId,
  asSpaceId,
  asWorkspaceId,
  type CalendarEventInstance,
  type CalendarSubscription,
  type Space,
  type WorkspaceTaskItem,
} from "@inkade/core";
import { InkadeI18nProvider, initInkadeI18n } from "@inkade/i18n";
import { createInkadeClient, inkadeQueryKeys } from "@inkade/sdk";
import { InkadeSdkProvider } from "@inkade/sdk/react";
import { ToastProvider } from "@inkade/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  InkadeViewsProvider,
  layoutAgendaBlocks,
  TaskDetailDrawer,
  TaskItemCard,
  TaskSchedulePopover,
  TasksAgendaView,
  TasksView,
} from "./index.ts";

function renderWithQuerySetup(
  node: React.ReactElement,
  locale: "zh-CN" | "en-US" = "en-US",
  seedQuery?: (qc: QueryClient) => void,
): string {
  initInkadeI18n(locale);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  seedQuery?.(queryClient);
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
  id: asSpaceId("spc_p41"),
  workspaceId: asWorkspaceId("ws_1"),
  parentId: null,
  name: "Product",
  slug: "product",
  icon: "layers",
  color: "#0ea5e9",
  defaultKind: "outline",
  sortOrder: 1,
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

function makePhase41Task(overrides: {
  readonly id?: string;
  readonly sourceEngine?: "outline" | "markdown";
  readonly docKind?: "outline" | "article" | "clip";
  readonly contentMarkdown?: string;
  readonly noteMarkdown?: string | null;
  readonly checked?: boolean;
  readonly priority?: WorkspaceTaskItem["node"]["priority"];
  readonly scheduledDate?: string | null;
  readonly scheduledStartMin?: number | null;
  readonly scheduledSlot?: WorkspaceTaskItem["node"]["scheduledSlot"];
  readonly durationMin?: number | null;
  readonly dueDate?: string | null;
  readonly recurrenceRule?: WorkspaceTaskItem["node"]["recurrenceRule"];
}): WorkspaceTaskItem {
  const sourceEngine = overrides.sourceEngine ?? "outline";
  const docId = asDocumentId(sourceEngine === "markdown" ? "doc_art_1" : "doc_out_1");
  const nodeId = asOutlineNodeId(overrides.id ?? "nod_p41_1");
  const taskId = sourceEngine === "markdown" ? asDocumentTaskId(`tsk_${nodeId}`) : nodeId;
  const contentMarkdown = overrides.contentMarkdown ?? "Review API contract #api";
  return {
    sourceEngine,
    taskId,
    node: {
      id: nodeId,
      documentId: docId,
      parentNodeId: null,
      orderKey: "a0",
      contentMarkdown,
      contentText: contentMarkdown,
      ...(overrides.noteMarkdown != null ? { noteMarkdown: overrides.noteMarkdown } : {}),
      checked: overrides.checked ?? false,
      collapsed: false,
      authorType: "human",
      authorId: null,
      sourceBindingId: null,
      ...(overrides.priority !== undefined ? { priority: overrides.priority } : {}),
      ...(overrides.scheduledDate !== undefined
        ? { scheduledDate: overrides.scheduledDate }
        : {}),
      ...(overrides.scheduledStartMin !== undefined
        ? { scheduledStartMin: overrides.scheduledStartMin }
        : {}),
      ...(overrides.scheduledSlot !== undefined
        ? { scheduledSlot: overrides.scheduledSlot }
        : {}),
      ...(overrides.durationMin !== undefined ? { durationMin: overrides.durationMin } : {}),
      ...(overrides.dueDate !== undefined ? { dueDate: overrides.dueDate } : {}),
      ...(overrides.recurrenceRule !== undefined
        ? { recurrenceRule: overrides.recurrenceRule }
        : {}),
      createdAt: "2026-11-25T08:00:00Z",
      updatedAt: "2026-11-25T08:00:00Z",
      deletedAt: null,
    },
    document: {
      id: docId,
      title: sourceEngine === "markdown" ? "Architecture RFC" : "2026-11-25 Daily",
      kind: overrides.docKind ?? (sourceEngine === "markdown" ? "article" : "outline"),
      spaceId: SAMPLE_SPACE.id,
      dailyDate: null,
      tags: ["roadmap"],
    },
    bindings: [],
  };
}

describe("Phase 41 UI components & FullCalendar agenda", () => {
  it("renders source engine badge, start time HH:MM, and Schedule vs Deadline badges on TaskItemCard", () => {
    const timedOutlineTask = makePhase41Task({
      id: "timed_1",
      sourceEngine: "outline",
      contentMarkdown: "Ship release checklist",
      scheduledDate: "2026-11-25",
      scheduledStartMin: 14 * 60 + 30,
      durationMin: 45,
      dueDate: "2026-11-25",
      priority: "p1",
    });

    const articleTask = makePhase41Task({
      id: "art_1",
      sourceEngine: "markdown",
      docKind: "article",
      contentMarkdown: "Polish security section",
      scheduledDate: "2026-11-25",
      dueDate: "2026-11-23",
    });

    const clipTask = makePhase41Task({
      id: "clip_1",
      sourceEngine: "markdown",
      docKind: "clip",
      contentMarkdown: "Follow up clipped benchmark",
      scheduledDate: "2026-11-25",
      dueDate: "2026-11-28",
    });

    const htmlTimed = renderWithQuerySetup(
      <TaskItemCard
        item={timedOutlineTask}
        onOpenDetail={() => {}}
        onToggleComplete={() => {}}
        onUpdateSchedule={() => {}}
        space={SAMPLE_SPACE}
        todayDate="2026-11-25"
      />,
      "en-US",
    );
    expect(htmlTimed).toContain("14:30");
    expect(htmlTimed).toContain("Due today");
    expect(htmlTimed).toContain("Open task details");

    const htmlArticle = renderWithQuerySetup(
      <TaskItemCard
        item={articleTask}
        onToggleComplete={() => {}}
        onUpdateSchedule={() => {}}
        space={SAMPLE_SPACE}
        todayDate="2026-11-25"
      />,
      "en-US",
    );
    expect(htmlArticle).toContain("Article");
    expect(htmlArticle).toContain("Overdue 2d");

    const htmlClip = renderWithQuerySetup(
      <TaskItemCard
        item={clipTask}
        onToggleComplete={() => {}}
        onUpdateSchedule={() => {}}
        space={SAMPLE_SPACE}
        todayDate="2026-11-25"
      />,
      "en-US",
    );
    expect(htmlClip).toContain("Clip");
    expect(htmlClip).toContain("Due in 3d");
  });

  it("renders TaskSchedulePopover trigger with formatted scheduledStartMin in en-US and zh-CN", () => {
    const html = renderWithQuerySetup(
      <TaskSchedulePopover
        onUpdate={() => {}}
        todayDate="2026-11-25"
        value={{
          scheduledDate: "2026-11-25",
          scheduledSlot: "afternoon",
          scheduledStartMin: 870,
          durationMin: 60,
          priority: "p2",
          recurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
          dueDate: "2026-11-28",
        }}
      />,
      "zh-CN",
    );

    expect(html).toContain("安排");
    const htmlEn = renderWithQuerySetup(
      <TaskSchedulePopover
        onUpdate={() => {}}
        todayDate="2026-11-25"
        value={{
          scheduledDate: "2026-11-25",
          scheduledSlot: "afternoon",
          scheduledStartMin: 870,
          durationMin: 60,
          priority: "p2",
          recurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
          dueDate: "2026-11-28",
        }}
      />,
      "en-US",
    );
    expect(htmlEn).toContain("When");
  });

  it("places explicit scheduledStartMin items accurately via layoutAgendaBlocks and overlays read-only ICS events in FullCalendar", () => {
    const anytimeTask = makePhase41Task({
      id: "ag_pool",
      sourceEngine: "markdown",
      docKind: "clip",
      contentMarkdown: "Unscheduled clip review",
      scheduledDate: null,
    });
    const exactTask = makePhase41Task({
      id: "ag_exact",
      contentMarkdown: "Architecture Sync",
      scheduledDate: "2026-11-25",
      scheduledStartMin: 14 * 60 + 30,
      scheduledSlot: "afternoon",
      durationMin: 45,
      priority: "p1",
    });

    const blocks = layoutAgendaBlocks([exactTask], "2026-11-25");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.startHour).toBe(14.5);
    expect(blocks[0]?.slot).toBe("afternoon");

    const spacesById = new Map([[SAMPLE_SPACE.id, SAMPLE_SPACE]]);
    const sub: CalendarSubscription = {
      id: asCalendarSubId("csub_team"),
      workspaceId: asWorkspaceId("ws_1"),
      name: "Team Calendar",
      url: "https://example.com/team.ics",
      color: "#0284c7",
      enabled: true,
      etag: null,
      lastModified: null,
      lastSyncedAt: "2026-11-25T08:00:00Z",
      lastError: null,
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    };
    const extEvent: CalendarEventInstance = {
      id: "evt_team_1",
      eventId: asCalendarEventId("cevt_team_1"),
      subscriptionId: sub.id,
      subscriptionName: sub.name,
      uid: "ics-uid-1",
      title: "Product Design Critique",
      startAt: "2026-11-25T16:00:00Z",
      endAt: "2026-11-25T17:00:00Z",
      allDay: false,
      timezone: "UTC",
      recurring: false,
      readOnly: true,
      location: "Room B",
      description: "Weekly critique",
      color: "#0284c7",
    };

    const html = renderWithQuerySetup(
      <TasksAgendaView
        onOpenDetail={() => {}}
        onToggleComplete={() => {}}
        onUpdateSchedule={() => {}}
        spacesById={spacesById}
        tasks={[anytimeTask, exactTask]}
        todayDate="2026-11-25"
      />,
      "en-US",
      (qc) => {
        qc.setQueryData(inkadeQueryKeys.calendarSubscriptions(), [sub]);
        qc.setQueryData(
          inkadeQueryKeys.calendarEvents({
            start: "2026-11-24T00:00:00Z",
            end: "2026-12-02T23:59:59Z",
          }),
          [extEvent],
        );
      },
    );

    expect(html).toContain('data-testid="tasks-agenda-view"');
    expect(html).toContain('data-testid="agenda-anytime-rail"');
    expect(html).toContain('data-testid="agenda-calendars-trigger"');
    expect(html).toContain("Day");
    expect(html).toContain("Week");
    expect(html).toContain("Calendars");
    expect(html).toContain("Unscheduled clip review");
    expect(html).toContain("Architecture Sync");
    expect(html).toContain("Product Design Critique");
    expect(html).toContain("1 external");
  });

  it("mounts TaskDetailDrawer and TasksView cleanly in both en-US and zh-CN", () => {
    const task = makePhase41Task({
      id: "drawer_1",
      sourceEngine: "markdown",
      docKind: "article",
      contentMarkdown: "Draft release post",
      noteMarkdown: "## Acceptance\n- Verify links",
      scheduledDate: "2026-11-25",
      scheduledStartMin: 600,
      dueDate: "2026-11-29",
    });

    const drawerHtml = renderWithQuerySetup(
      <TaskDetailDrawer
        item={task}
        onOpenChange={() => {}}
        onSave={() => {}}
        open={false}
        space={SAMPLE_SPACE}
        todayDate="2026-11-25"
      />,
      "zh-CN",
    );
    expect(drawerHtml).toBe("");

    const tasksEnHtml = renderWithQuerySetup(
      <TasksView urlState={{ engine: "markdown" }} />,
      "en-US",
    );
    expect(tasksEnHtml).toContain('data-testid="tasks-filter-trigger"');
    expect(tasksEnHtml).toContain("Filter");
    expect(tasksEnHtml).toContain(">1<");

    const tasksZhHtml = renderWithQuerySetup(
      <TasksView urlState={{ engine: "markdown" }} />,
      "zh-CN",
    );
    expect(tasksZhHtml).toContain('data-testid="tasks-filter-trigger"');
    expect(tasksZhHtml).toContain("筛选");
    expect(tasksZhHtml).toContain(">1<");
  });
});
