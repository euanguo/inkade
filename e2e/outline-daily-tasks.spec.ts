import { apiJson, expect, getTodayLocalDate, MOD_KEY, test, uniqueSuffix } from "./fixtures.ts";

test.describe("Outline, Daily & Global Tasks", () => {
  test("CJK IME composition guard, Chinese outline indent/outdent, and checkbox completion", async ({
    page,
  }) => {
    const parentText = `中文父节点-${uniqueSuffix("ime")}`;
    const childText = `中文子节点-${uniqueSuffix("child")}`;

    await page.goto("/daily");
    const editor = page.locator(".inkade-pm-outliner .ProseMirror");
    await expect(editor).toBeVisible();

    // Create a fresh root node via toolbar button
    await page.getByRole("button", { name: "新建节点" }).click();
    await expect(editor).toBeFocused();

    // Simulate CJK IME composition: Enter during composing must NOT split the node
    const countBeforeIme = await editor.locator("[data-outline-item]").count();
    await editor.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      el.dispatchEvent(
        new CompositionEvent("compositionupdate", { bubbles: true, data: "zhongwen" }),
      );
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      el.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "" }),
      );
    });
    expect(await editor.locator("[data-outline-item]").count()).toBe(countBeforeIme);

    // Type Chinese text after composition ends
    await page.keyboard.insertText(parentText);
    const parentItem = editor.locator("[data-outline-item]", { hasText: parentText }).first();
    await expect(parentItem).toBeVisible();

    // Wait for debounced batch save to flush and confirm persistence across reload
    await expect(parentItem).toHaveAttribute("data-node-id", /^nod_/);

    // Create a child sibling with Enter, type Chinese text, and Tab to indent
    await page.keyboard.press("Enter");
    await page.keyboard.insertText(childText);
    await page.keyboard.press("Tab");

    const nestedChild = parentItem.locator(`.inkade-pm-content > [data-outline-item]`, {
      hasText: childText,
    });
    await expect(nestedChild).toBeVisible();

    // Shift+Tab outdents back to root, then Tab indents again
    await page.keyboard.press("Shift+Tab");
    await expect(nestedChild).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(nestedChild).toBeVisible();

    // Toggle todo checkbox via Mod+Enter and complete it by clicking checkbox
    await page.keyboard.press(`${MOD_KEY}+Enter`);
    await expect(nestedChild).toHaveAttribute("data-checked", "false");
    const todoCheckbox = nestedChild.locator('> div [role="checkbox"]').first();
    await expect(todoCheckbox).toBeVisible();
    await todoCheckbox.dispatchEvent("mousedown");
    await expect(nestedChild).toHaveAttribute("data-checked", "true");

    // Wait for debounced batch save to flush child creation + indent + checked state to server
    await expect(nestedChild).toHaveAttribute("data-node-id", /^nod_/);
    await page.waitForTimeout(600);

    // Reload and verify server-persisted tree + checked state
    await page.reload();
    const reloadedEditor = page.locator(".inkade-pm-outliner .ProseMirror");
    await expect(reloadedEditor).toBeVisible();
    const reloadedParent = reloadedEditor
      .locator("[data-outline-item]", { hasText: parentText })
      .first();
    await expect(reloadedParent).toBeVisible();
    const reloadedChild = reloadedParent.locator(".inkade-pm-content > [data-outline-item]", {
      hasText: childText,
    });
    await expect(reloadedChild).toHaveAttribute("data-checked", "true");
  });

  test("Polymorphic views (Outline / Board / Focus Tasks), Mini Calendar Heatmap, Daily Stream, and /tasks", async ({
    page,
    request,
  }) => {
    const today = getTodayLocalDate();
    const taskTitle = `全局待办验证-${uniqueSuffix("task")}`;
    const yesterdayNote = `昨日流式节点-${uniqueSuffix("stream")}`;

    // Seed today's todo and a prior day's outline via API
    const todayDaily = await apiJson<{ document: { id: string } }>(
      request,
      "GET",
      `/api/v1/documents/daily/${today}`,
    );
    expect(todayDaily.status).toBe(200);

    const createdTodo = await apiJson<{ id: string }>(request, "POST", "/api/v1/outline-nodes", {
      data: {
        documentId: todayDaily.body.document.id,
        parentNodeId: null,
        contentMarkdown: `${taskTitle} #e2e`,
        checked: false,
      },
    });
    expect(createdTodo.status).toBe(201);

    const prevDate = "2026-11-10";
    const prevDaily = await apiJson<{ document: { id: string } }>(
      request,
      "GET",
      `/api/v1/documents/daily/${prevDate}`,
    );
    expect(prevDaily.status).toBe(200);
    await apiJson(request, "POST", "/api/v1/outline-nodes", {
      data: {
        documentId: prevDaily.body.document.id,
        parentNodeId: null,
        contentMarkdown: yesterdayNote,
        checked: false,
      },
    });

    await page.goto("/daily");
    await expect(page.locator(".inkade-pm-outliner")).toContainText(taskTitle);

    // Switch Outline -> Board (看板)
    await page.getByRole("button", { name: "看板" }).click();
    await expect(page.getByText("待办 Todo")).toBeVisible();
    await expect(page.getByText("进行中 / 等待 ADE")).toBeVisible();
    await expect(page.getByText("已完成 Done")).toBeVisible();
    await expect(page.getByRole("paragraph").filter({ hasText: taskTitle })).toBeVisible();

    // Switch Board -> Focus Tasks (待办)
    await page.getByRole("button", { name: "待办", exact: true }).click();
    await expect(page.getByRole("paragraph").filter({ hasText: taskTitle })).toBeVisible();

    // Switch back to Outline (大纲)
    await page.getByRole("button", { name: "大纲" }).click();
    await expect(page.locator(".inkade-pm-outliner")).toBeVisible();

    // Open Mini Calendar Heatmap popover
    await page.getByRole("button", { name: "切换日期与热力图" }).click();
    await expect(page.getByText("近 90 天大纲热力日历")).toBeVisible();
    await page.keyboard.press("Escape");

    // Toggle Daily Stream (单日 -> 连续流) inside More Actions menu
    const moreActionsBtn = page.getByRole("button", { name: "更多操作" });
    await moreActionsBtn.click();
    await page.getByRole("menuitem", { name: "单日" }).click();
    await moreActionsBtn.click();
    await expect(page.getByRole("menuitem", { name: "连续流" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText(yesterdayNote)).toBeVisible();

    // Navigate to Global /tasks page, filter, and toggle completion
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "全局待办中心" })).toBeVisible();

    const searchInput = page.getByPlaceholder("搜索待办内容、文档标题或 #标签…");
    await searchInput.fill(taskTitle);
    const taskCard = page.locator("div.rounded-xl", { hasText: taskTitle }).first();
    await expect(taskCard).toBeVisible();

    // Filter by Today group
    await page.getByRole("button", { name: "今日", exact: true }).click();
    await expect(taskCard).toBeVisible();

    // Complete task in /tasks
    await taskCard.getByRole("checkbox").click();
    await page.getByRole("button", { name: "已完成", exact: true }).click();
    await expect(page.locator("div.rounded-xl", { hasText: taskTitle }).first()).toBeVisible();
  });
});
