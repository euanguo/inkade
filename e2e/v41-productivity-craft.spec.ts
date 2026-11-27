import {
  apiJson,
  expect,
  MOD_KEY,
  test,
  uniqueSuffix,
} from "./fixtures.ts";

test.describe("V4.1 Productivity & Craft Workflows", () => {
  test("1. QuickCapture desktop modal + progressive disclosure, ? shortcuts search, and Cmd+K todo <text>", async ({
    page,
  }) => {
    const suffix = uniqueSuffix("v41-qc");
    const cmdTodoTitle = `CmdK快速待办-${suffix}`;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/daily");
    await expect(page.locator(".inkade-pm-outliner .ProseMirror")).toBeVisible();

    // Open QuickCapture via C -> renders centered DialogPopup on desktop with full-width textarea
    await page.keyboard.press("c");
    const quickCaptureDialog = page.getByRole("dialog");
    await expect(quickCaptureDialog).toBeVisible();

    const textarea = quickCaptureDialog.locator("textarea");
    await expect(textarea).toBeVisible();
    const box = await textarea.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(360);

    // Progressive disclosure: URL & Tags hidden by default on daily target until toggled
    const tagsInput = quickCaptureDialog.getByPlaceholder("例如：idea, research");
    await expect(tagsInput).toHaveCount(0);
    await quickCaptureDialog.getByRole("button", { name: "添加标签" }).click();
    await expect(tagsInput).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(quickCaptureDialog).toHaveCount(0);

    // Searchable `?` keyboard shortcuts dialog
    await page.keyboard.press("?");
    const shortcutsDialog = page.getByRole("dialog");
    await expect(shortcutsDialog).toBeVisible();
    const shortcutsSearch = shortcutsDialog.getByPlaceholder("搜索快捷键或功能…");
    await shortcutsSearch.fill("Snooze");
    await expect(shortcutsDialog.getByText("暂缓当前条目（Snooze）")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcutsDialog).toHaveCount(0);

    // Inline `todo <text>` inside Command Palette -> creates checked=false todo in Today's outline
    await page.keyboard.press(`${MOD_KEY}+k`);
    const paletteInput = page.getByPlaceholder("搜索文档、大纲节点，或运行快捷命令…");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill(`todo ${cmdTodoTitle}`);
    const addTodoOption = page.getByText(`新增待办至今日：「${cmdTodoTitle}」`).first();
    await expect(addTodoOption).toBeVisible();
    await addTodoOption.click();

    await page.reload();
    const outlineTodo = page.locator(".inkade-pm-outliner [data-outline-item]", {
      hasText: cmdTodoTitle,
    });
    await expect(outlineTodo.first()).toBeVisible();
    await expect(outlineTodo.first()).toHaveAttribute("data-checked", "false");
  });

  test("2. Tasks Quick-Add (N), When Evening Reschedule, Tonight Section Split, and Space Soft-Fade + Undo", async ({
    page,
  }) => {
    const suffix = uniqueSuffix("v41-tasks");
    const taskTitle = `晚间代码评审-${suffix}`;

    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "全局待办中心" })).toBeVisible();

    // Press N to focus inline Quick-Add, type inline #craft, choose Tonight, and submit
    await page.keyboard.press("n");
    const quickInput = page.getByPlaceholder("快速新增今日待办（按 N 聚焦，支持内联 #标签）…");
    await expect(quickInput).toBeFocused();
    await quickInput.fill(`${taskTitle} #craft`);
    await page.locator("form").getByRole("button", { name: "今晚", exact: true }).click();
    await page.getByRole("button", { name: "添加", exact: true }).click();

    // Verify clean title without trailing `#craft` duplication and Evening badge present
    const taskRow = page.locator("div.rounded-xl", { hasText: taskTitle }).first();
    await expect(taskRow).toBeVisible();
    await expect(taskRow.locator("p", { hasText: taskTitle }).first()).toHaveText(taskTitle);
    await expect(taskRow.getByText("今晚")).toBeVisible();

    // Switch to Today tab -> shows Tonight group heading
    await page.getByRole("button", { name: "今日", exact: true }).click();
    await expect(page.getByRole("heading", { name: /今晚/ })).toBeVisible();

    // Select row and complete with Space -> triggers Undo toast & allows undo
    await taskRow.locator("p", { hasText: taskTitle }).first().click();
    await page.keyboard.press("Space");
    await expect(page.getByText(`已完成「${taskTitle}」`)).toBeVisible();
    await page.getByRole("button", { name: "撤销" }).click();
    await expect(taskRow).toBeVisible();
  });

  test("3. Inbox Snooze (H / Snoozed Tab / Wake), Mark Unread (U), and Clear Read (Shift+Backspace)", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("v41-inb");
    const clipOneTitle = `暂缓测试一-${suffix}`;
    const clipTwoTitle = `已读清理二-${suffix}`;

    const c1 = await apiJson(request, "POST", "/api/v1/documents", {
      data: {
        spaceId: "spc_inbox",
        kind: "clip",
        title: clipOneTitle,
        contentMarkdown: `# ${clipOneTitle}\n\n测试暂缓与未读状态。`,
        sourceUrl: "https://example.org/snooze-one",
      },
    });
    expect(c1.status).toBe(201);

    const c2 = await apiJson(request, "POST", "/api/v1/documents", {
      data: {
        spaceId: "spc_inbox",
        kind: "clip",
        title: clipTwoTitle,
        contentMarkdown: `# ${clipTwoTitle}\n\n测试已读批量清空。`,
        sourceUrl: "https://example.org/clear-two",
      },
    });
    expect(c2.status).toBe(201);

    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto("/inbox?tab=clips");

    const rowOne = page.locator("button", { hasText: clipOneTitle }).first();
    await expect(rowOne).toBeVisible();
    await rowOne.click();

    // Toggle unread with U -> blue unread indicator dot appears
    await page.keyboard.press("u");
    await expect(rowOne.locator("span.bg-blue-500")).toBeVisible();

    // Open Snooze popover with H -> snooze until Tomorrow morning -> exits active queue
    await page.keyboard.press("h");
    await page.getByRole("button", { name: /明早 09:00/ }).click();
    await expect(page.locator("button", { hasText: clipOneTitle })).toHaveCount(0);

    // Switch to Snoozed tab -> wake item back to Inbox
    await page.getByRole("tab", { name: /已暂缓/ }).click();
    const snoozedRowOne = page.locator("button", { hasText: clipOneTitle }).first();
    await expect(snoozedRowOne).toBeVisible();
    await snoozedRowOne.click();
    await page.getByRole("button", { name: "立即唤醒" }).click();

    // Switch back to Captures tab -> clipOneTitle is back, clipTwoTitle is read
    await page.getByRole("tab", { name: /待归档捕获/ }).click();
    await expect(page.locator("button", { hasText: clipOneTitle }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: clipTwoTitle }).first()).toBeVisible();

    // Clear Read via Shift+Backspace -> clipTwoTitle archived while unread clipOneTitle remains!
    await page.keyboard.press("Shift+Backspace");
    await expect(page.locator("button", { hasText: clipTwoTitle })).toHaveCount(0);
    await expect(page.locator("button", { hasText: clipOneTitle }).first()).toBeVisible();
  });

  test("4. Library Multi-Select Bulk Bar & Display Options (Shift+V), plus Daily Focus Schedule & Serendipity Review", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("v41-lib");
    const noteTitle = `知识沉淀卡片-${suffix}`;
    const todoText = `时段调度验证-${suffix}`;

    const docRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: noteTitle,
          contentMarkdown: `# ${noteTitle}\n\n这是一段用于验证 Library 视图配置、多选批量栏以及 Daily 每日漫游卡片引用功能的充足正文文本内容。`,
          tags: ["v41"],
          pinned: true,
        },
      },
    );
    expect(docRes.status).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/library");
    await expect(page.getByText(noteTitle).first()).toBeVisible();

    // Multi-select item via checkbox -> floating bottom bulk bar renders
    const selectCheckbox = page.getByRole("checkbox", { name: `选中「${noteTitle}」` }).first();
    await selectCheckbox.click({ force: true });
    const bulkBar = page.getByTestId("library-bulk-bar");
    await expect(bulkBar).toBeVisible();
    await bulkBar.getByRole("button", { name: "取消选择" }).click();
    await expect(bulkBar).toHaveCount(0);

    // Toggle Display Options via Shift+V and hide excerpts -> persists across reload
    await page.keyboard.press("Shift+V");
    const excerptLabel = page.locator("label", { hasText: "显示正文摘要" });
    await expect(excerptLabel).toBeVisible();
    await excerptLabel.locator('[role="checkbox"]').click();
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(page.getByText("这是一段用于验证 Library 视图配置")).toHaveCount(0);

    // Daily Focus Rail: add a todo, assign time block + 30m, verify Serendipity Review Card & Quote to Today
    await page.goto("/daily");
    await expect(page.locator(".inkade-pm-outliner .ProseMirror")).toBeVisible();
    await page.keyboard.press(`${MOD_KEY}+k`);
    const palInput = page.getByPlaceholder("搜索文档、大纲节点，或运行快捷命令…");
    await expect(palInput).toBeVisible();
    await palInput.fill(`todo ${todoText}`);
    await page.getByText(`新增待办至今日：「${todoText}」`).first().click();
    await expect(palInput).toHaveCount(0);

    await page.keyboard.press(`${MOD_KEY}+Shift+B`);
    const focusRail = page.getByTestId("daily-focus-rail");
    await expect(focusRail).toBeVisible();

    const taskRow = focusRail.locator("div.group", { hasText: todoText }).first();
    await taskRow.getByRole("button", { name: "安排日程时段与时长" }).click({ force: true });
    await page.getByRole("button", { name: "上午", exact: true }).click();
    await expect(focusRail.getByText("上午", { exact: true })).toBeVisible();
    await taskRow.getByRole("button", { name: "安排日程时段与时长" }).click({ force: true });
    await page.getByRole("button", { name: "30m", exact: true }).click();
    await page.keyboard.press("Escape");

    await expect(focusRail.getByText("Σ 30m")).toBeVisible();

    await page.reload();
    await expect(page.locator(".inkade-pm-outliner .ProseMirror")).toBeVisible();
    // V5.6: daily.focusRailOpen is persisted across reload (avoid pressing Cmd+Shift+B which would close it)
    const reloadedRail = page.getByTestId("daily-focus-rail");
    await expect(reloadedRail).toBeVisible();
    await expect(reloadedRail.getByText("Σ 30m")).toBeVisible();

    // Daily Serendipity card visible & Quote to Today works
    const serendipityCard = reloadedRail.getByTestId("daily-serendipity-card");
    await expect(serendipityCard).toBeVisible();
    const quoteBtn = serendipityCard.getByRole("button", { name: "引用至今日" }).first();
    if ((await quoteBtn.count()) > 0) {
      await quoteBtn.click();
      await expect(page.getByText(/已引用 \[\[.*\]\] 至今日大纲/)).toBeVisible();
    }
  });
});
