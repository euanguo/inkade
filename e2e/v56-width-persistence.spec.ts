import type { UserPreferencesRecord } from "../packages/core/src/preferences.ts";
import { apiJson, expect, test, uniqueSuffix } from "./fixtures.ts";

test.describe("V5.6 Layout Width Unification & 3-Tier View Persistence", () => {
  test("1. Page headers stay horizontally pinned across view switches and Focus Rail toggles", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // --- /tasks header & body width stability across List -> Board -> Agenda ---
    await page.goto("/tasks");
    const tasksHeader = page.getByTestId("tasks-header");
    const tasksTitle = tasksHeader.getByRole("heading", { name: "全局待办中心" });
    const tasksBody = page.getByTestId("tasks-body-container");
    await expect(tasksHeader).toBeVisible();
    await expect(tasksBody).toBeVisible();

    const listHeaderBox = await tasksHeader.boundingBox();
    const listTitleBox = await tasksTitle.boundingBox();
    const listBodyBox = await tasksBody.boundingBox();
    expect(listHeaderBox).not.toBeNull();
    expect(listTitleBox).not.toBeNull();
    expect(listBodyBox).not.toBeNull();

    // Switch to Board
    await tasksHeader.getByRole("button", { name: "看板", exact: true }).click();
    await expect(page.getByTestId("tasks-board-view")).toBeVisible();
    const boardHeaderBox = await tasksHeader.boundingBox();
    const boardTitleBox = await tasksTitle.boundingBox();
    const boardBodyBox = await tasksBody.boundingBox();
    expect(Math.abs(boardHeaderBox!.x - listHeaderBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(boardHeaderBox!.width - listHeaderBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(boardTitleBox!.x - listTitleBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(boardBodyBox!.width - listBodyBox!.width)).toBeLessThanOrEqual(2);

    // Switch to Agenda
    await tasksHeader.getByRole("button", { name: "日程", exact: true }).click();
    await expect(page.getByTestId("tasks-agenda-view")).toBeVisible();
    const agendaHeaderBox = await tasksHeader.boundingBox();
    const agendaTitleBox = await tasksTitle.boundingBox();
    const agendaBodyBox = await tasksBody.boundingBox();
    expect(Math.abs(agendaHeaderBox!.x - listHeaderBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(agendaHeaderBox!.width - listHeaderBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(agendaTitleBox!.x - listTitleBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(agendaBodyBox!.width - listBodyBox!.width)).toBeLessThanOrEqual(2);

    // --- /daily header & 7-day ribbon stability across Focus Rail & Outline/Kanban/Tasks ---
    await page.goto("/daily");
    const dailyHeader = page.getByTestId("daily-header");
    const dailyHeading = dailyHeader.locator("h1");
    await expect(dailyHeader).toBeVisible();
    const d1HeaderBox = await dailyHeader.boundingBox();
    const d1HeadingBox = await dailyHeading.boundingBox();
    expect(d1HeaderBox).not.toBeNull();
    expect(d1HeadingBox).not.toBeNull();

    // Open Focus Rail -> header must remain pinned edge-to-edge
    await dailyHeader.getByRole("button", { name: "展开 / 收起今日焦点面板" }).click();
    await expect(page.getByTestId("daily-focus-rail")).toBeVisible();
    const d2HeaderBox = await dailyHeader.boundingBox();
    const d2HeadingBox = await dailyHeading.boundingBox();
    expect(Math.abs(d2HeaderBox!.x - d1HeaderBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(d2HeaderBox!.width - d1HeaderBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(d2HeadingBox!.x - d1HeadingBox!.x)).toBeLessThanOrEqual(1);

    // Switch to Kanban -> header still pinned edge-to-edge & view switcher doesn't shift
    const dailyKanbanBtn = dailyHeader.getByRole("button", { name: "看板", exact: true });
    const d2KanbanBtnBox = await dailyKanbanBtn.boundingBox();
    expect(d2KanbanBtnBox).not.toBeNull();
    await dailyKanbanBtn.click();
    await expect(page.getByRole("button", { name: "按优先级" })).toBeVisible();
    const d3HeaderBox = await dailyHeader.boundingBox();
    const d3KanbanBtnBox = await dailyKanbanBtn.boundingBox();
    expect(Math.abs(d3HeaderBox!.x - d1HeaderBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(d3HeaderBox!.width - d1HeaderBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(d3KanbanBtnBox!.x - d2KanbanBtnBox!.x)).toBeLessThanOrEqual(1);
  });

  test("2. 3-tier persistence survives page.reload(), clean route navigation, and syncs to GET /api/v1/preferences", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // --- /tasks: Board + Priority grouping + Centered width toggle ---
    await page.goto("/tasks");
    await page.getByTestId("tasks-header").getByRole("button", { name: "看板", exact: true }).click();
    await expect(page.getByTestId("tasks-board-view")).toBeVisible();
    await page.getByTestId("tasks-board-view").getByRole("button", { name: "按优先级" }).click();
    await expect(
      page.getByTestId("tasks-board-view").locator('[data-board-column="priority:p1"]'),
    ).toBeVisible();

    const fluidBodyBox = await page.getByTestId("tasks-body-container").boundingBox();
    expect(fluidBodyBox).not.toBeNull();
    await page.getByTestId("workspace-width-toggle").click();
    await expect(page.getByTestId("workspace-width-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const centeredBodyBox = await page.getByTestId("tasks-body-container").boundingBox();
    expect(centeredBodyBox).not.toBeNull();
    expect(centeredBodyBox!.width).toBeLessThan(fluidBodyBox!.width - 100);

    // Confirm debounced Layer 3 server sync completes
    await expect
      .poll(async () => {
        const res = await apiJson<UserPreferencesRecord>(request, "GET", "/api/v1/preferences");
        return `${res.body.preferences.tasks.viewMode}:${res.body.preferences.tasks.boardGroupBy}:${res.body.preferences.layout.workspaceCanvasWidth}`;
      })
      .toBe("board:priority:centered");

    // Reload keeps Board + Priority + Centered
    await page.reload();
    await expect(
      page.getByTestId("tasks-board-view").locator('[data-board-column="priority:p1"]'),
    ).toBeVisible();
    await expect(page.getByTestId("workspace-width-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Navigate away to clean /library and back via sidebar link -> still remembers Tasks preferences!
    await page.locator("aside").getByRole("link", { name: /Library/i }).first().click();
    await expect(page).toHaveURL(/\/library/);
    await page.locator("aside").getByRole("link", { name: /待办/i }).first().click();
    await expect(
      page.getByTestId("tasks-board-view").locator('[data-board-column="priority:p1"]'),
    ).toBeVisible();

    // --- /daily: Focus Rail open + Kanban ---
    await page.goto("/daily");
    const dailyHeader = page.getByTestId("daily-header");
    await dailyHeader.getByRole("button", { name: "展开 / 收起今日焦点面板" }).click();
    await dailyHeader.getByRole("button", { name: "看板" }).click();
    await expect(page.getByTestId("daily-focus-rail")).toBeVisible();
    await expect
      .poll(async () => {
        const res = await apiJson<UserPreferencesRecord>(request, "GET", "/api/v1/preferences");
        return `${res.body.preferences.daily.focusRailOpen}:${res.body.preferences.daily.viewMode}`;
      })
      .toBe("true:kanban");

    await page.reload();
    await expect(page.getByTestId("daily-focus-rail")).toBeVisible();
    await expect(page.getByRole("button", { name: "按优先级" })).toBeVisible();

    // --- /library: Table view + Title sort ---
    await page.goto("/library");
    await page.locator('[aria-label="视图模式"]').getByRole("button", { name: "属性表" }).click();
    const table = page.locator("table");
    await expect(table).toBeVisible();
    await table.locator("thead").getByRole("button", { name: "标题" }).click();
    await expect
      .poll(async () => {
        const res = await apiJson<UserPreferencesRecord>(request, "GET", "/api/v1/preferences");
        return `${res.body.preferences.library.viewMode}:${res.body.preferences.library.sortBy}`;
      })
      .toBe("table:title");

    await page.reload();
    await expect(page.locator("table")).toBeVisible();

    // --- /inbox: Seed a clip so Inbox queue renders tabs, verify tab written to URL & persisted across reload ---
    await apiJson(request, "POST", "/api/v1/documents", {
      data: {
        spaceId: "spc_inbox",
        kind: "clip",
        title: "V56 Inbox Tab Persist Clip",
        contentMarkdown: "Inbox clip body for persistence test",
      },
    });
    await page.goto("/inbox");
    const clipsTab = page.getByRole("tab", { name: /待归档捕获/ });
    await expect(clipsTab).toBeVisible();
    await clipsTab.click();
    await expect(page).toHaveURL(/tab=clips/);
    await page.reload();
    await expect(page.getByRole("tab", { name: /待归档捕获/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // --- /threads: Conflicts mode persists across reload ---
    await page.goto("/threads");
    await page.getByRole("button", { name: /冲突雷达/ }).click();
    await expect
      .poll(async () => {
        const res = await apiJson<UserPreferencesRecord>(request, "GET", "/api/v1/preferences");
        return res.body.preferences.threads.viewMode;
      })
      .toBe("conflicts");

    await page.reload();
    await expect(page.getByRole("button", { name: /冲突雷达/ })).toHaveAttribute(
      "data-pressed",
      "",
    );
  });

  test("3. Document 'full' reader measure & Settings Appearance width controls work cleanly", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("v56-full");
    const docRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `V56-FullWidth-${suffix}`,
          contentMarkdown: `# V56 Full Width Measure\n\nThis long paragraph checks whether enabling the full-width reading and editing measure expands the canvas beyond 88ch cleanly without artificial horizontal constraints.`,
        },
      },
    );
    expect(docRes.status).toBe(201);
    const docId = docRes.body.document.id;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/docs/${docId}`);

    const trigger = page.getByTestId("typography-popover-trigger");
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.getByTestId("typography-popover-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "全宽铺满", exact: true }).click();

    const fullHost = page.locator('[data-measure="full"]').first();
    await expect(fullHost).toBeVisible();
    const box = await fullHost.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(850);

    await expect
      .poll(async () => {
        const res = await apiJson<UserPreferencesRecord>(request, "GET", "/api/v1/preferences");
        return res.body.preferences.reader.measure;
      })
      .toBe("full");

    await page.reload();
    await expect(page.locator('[data-measure="full"]').first()).toBeVisible();

    // Check Settings Appearance exposes Full width reader measure + Workspace Canvas Width
    await page.goto("/settings/appearance");
    await expect(page.getByText("工作台画布宽度")).toBeVisible();
    await expect(page.getByRole("button", { name: "全宽", exact: true })).toHaveAttribute(
      "data-checked",
      "",
    );
    await page.getByRole("button", { name: "居中宽栏", exact: true }).click();
    await expect
      .poll(async () => {
        const res = await apiJson<UserPreferencesRecord>(request, "GET", "/api/v1/preferences");
        return res.body.preferences.layout.workspaceCanvasWidth;
      })
      .toBe("centered");
  });
});
