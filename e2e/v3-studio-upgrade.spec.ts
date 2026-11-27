import {
  apiJson,
  expect,
  getTodayLocalDate,
  MOD_KEY,
  shiftDateString,
  test,
  uniqueSuffix,
} from "./fixtures.ts";

test.describe("Phase 16E: V3 Studio Upgrade Verification", () => {
  test("1. Shell Architecture (Inset vs Flush), 4-Tier Surface Themes, Reader Typography & Geometric Topbar Alignment", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("shell");
    const docRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `壳层几何对齐验证-${suffix}`,
          contentMarkdown: `# 壳层几何对齐验证-${suffix}\n\n用于验证桌面端、平板端与移动端零水平溢出及 3 栏顶部几何对齐。`,
          tags: ["v3", "shell"],
        },
      },
    );
    expect(docRes.status).toBe(201);
    const docId = docRes.body.document.id;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/docs/${docId}`);
    await expect(page.getByRole("heading", { name: `壳层几何对齐验证-${suffix}` })).toBeVisible();

    // Open Inspector so all 3 panes (Sidebar, TopHeaderBar, Inspector) are mounted
    await page.keyboard.press(`${MOD_KEY}+.`);
    const inspectorCloseBtn = page.getByRole("button", { name: "关闭 Inspector" });
    await expect(inspectorCloseBtn).toBeVisible();

    const assertTopbarAlignment = async (): Promise<void> => {
      const sidebarHeader = page
        .locator("aside")
        .filter({ has: page.getByRole("button", { name: "工作区菜单" }) })
        .locator("> div > div")
        .first();
      const mainTopbar = page
        .locator("header")
        .filter({ has: page.locator('nav[aria-label="当前位置面包屑"]') });
      const inspectorHeader = page
        .locator("aside")
        .filter({ has: page.getByRole("button", { name: "关闭 Inspector" }) })
        .locator("> div > div")
        .first();

      await expect(sidebarHeader).toBeVisible();
      await expect(mainTopbar).toBeVisible();
      await expect(inspectorHeader).toBeVisible();

      const [sbBox, topBox, insBox] = await Promise.all([
        sidebarHeader.boundingBox(),
        mainTopbar.boundingBox(),
        inspectorHeader.boundingBox(),
      ]);
      expect(sbBox).not.toBeNull();
      expect(topBox).not.toBeNull();
      expect(insBox).not.toBeNull();

      if (sbBox && topBox && insBox) {
        expect(Math.abs(sbBox.y - topBox.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(topBox.y - insBox.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(sbBox.y - insBox.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(sbBox.height - topBox.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(topBox.height - insBox.height)).toBeLessThanOrEqual(1);
      }

      const borders = await Promise.all([
        sidebarHeader.evaluate((el) => getComputedStyle(el).borderBottomWidth),
        mainTopbar.evaluate((el) => getComputedStyle(el).borderBottomWidth),
        inspectorHeader.evaluate((el) => getComputedStyle(el).borderBottomWidth),
      ]);
      expect(borders).toEqual(["0px", "0px", "0px"]);
    };

    // Default shell is Inset Studio
    await expect(page.locator("html")).toHaveAttribute("data-shell", "inset");
    await assertTopbarAlignment();

    // Open SettingsModal to switch shell, all 4 surface tiers, ReaderFont & ReaderMeasure
    await page.keyboard.press(`${MOD_KEY}+Comma`);
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    await modal.getByRole("radio", { name: /Classic Flush/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-shell", "flush");

    await modal.getByRole("radio", { name: "浅色", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-surface", "light");
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await modal.getByRole("radio", { name: "暗色", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-surface", "dark");
    await expect(page.locator("html")).toHaveClass(/dark/);

    await modal.getByRole("radio", { name: "柔雾石板", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-surface", "dark-dimmed");
    await expect(page.locator("html")).toHaveClass(/dark/);

    await modal.getByRole("radio", { name: "暖象牙柔光", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-surface", "light-dimmed");
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    // ReaderFont & ReaderMeasure controls
    await modal.getByRole("button", { name: "衬线 Serif" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-reader-font", "serif");
    await modal.getByRole("button", { name: "无衬线 Sans" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-reader-font", "sans");

    await modal.getByRole("button", { name: "65ch 窄版" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-reader-measure", "65ch");
    await modal.getByRole("button", { name: "88ch 宽版" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-reader-measure", "88ch");
    await modal.getByRole("button", { name: "72ch 标准" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-reader-measure", "72ch");

    // Close modal and check alignment under Classic Flush
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await assertTopbarAlignment();

    // Switch back to Inset Studio
    await page.keyboard.press(`${MOD_KEY}+Comma`);
    await expect(modal).toBeVisible();
    await modal.getByRole("radio", { name: /Inset Studio/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-shell", "inset");
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);

    // Zero horizontal overflow across Desktop (1440x900), Tablet (768x1024), Mobile (390x844)
    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "mobile", width: 390, height: 844 },
    ] as const;

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of ["/daily", "/library", `/docs/${docId}`]) {
        await page.goto(route);
        await expect(page.locator("main h1").first()).toBeVisible();
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `Overflow on ${route} at ${vp.name}`).toBeLessThanOrEqual(1);
      }
    }
  });

  test("2. Settings Modal: Search Filter, Intelligence Hybrid RAG Reindex & Offline Sync Toggle", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/daily");
    await expect(page.getByRole("button", { name: /搜索或运行命令/ })).toBeVisible();
    await expect(page.locator(".inkade-pm-outliner .ProseMirror")).toBeVisible();

    await page.keyboard.press(`${MOD_KEY}+Comma`);
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    // Search settings sidebar to filter sections
    const settingsNav = modal.locator('aside[aria-label="设置导航"]');
    const filterInput = settingsNav.getByPlaceholder("搜索设置项…");
    await filterInput.fill("rag");
    await expect(settingsNav.getByRole("button", { name: "语义检索与索引" })).toBeVisible();
    await expect(settingsNav.getByRole("button", { name: "外观与主题" })).toHaveCount(0);

    // Open Intelligence / Hybrid RAG section
    await settingsNav.getByRole("button", { name: "语义检索与索引" }).click();
    await expect(modal.getByRole("heading", { name: "语义检索与索引" })).toBeVisible();
    await expect(modal.getByText("Orama 混合检索引擎")).toBeVisible();
    await expect(modal.getByText(/\d+ 篇文档 · \d+ 个 Space · \d+ 个标签/)).toBeVisible();

    // Trigger POST /api/v1/search/reindex
    const reindexPromise = page.waitForResponse(
      (res) => res.url().includes("/api/v1/search/reindex") && res.request().method() === "POST",
    );
    await modal.getByRole("button", { name: "立即重建索引" }).click();
    const reindexResponse = await reindexPromise;
    expect(reindexResponse.status()).toBe(200);
    await expect(modal.locator('[role="status"]', { hasText: "已完成索引：写入" })).toBeVisible();

    // Clear filter and switch to Offline Sync section
    await modal.getByRole("button", { name: "清除筛选" }).click();
    await expect(settingsNav.getByRole("button", { name: "外观与主题" })).toBeVisible();
    await settingsNav.getByRole("button", { name: "离线缓存与同步" }).click();
    await expect(modal.getByRole("heading", { name: "离线缓存与同步" })).toBeVisible();

    const offlineSwitch = modal.getByRole("switch", { name: "Yjs + IndexedDB 离线持久化" });
    await expect(offlineSwitch).toBeVisible();
    await expect(offlineSwitch).toBeChecked();
    await expect(modal.getByText("已启用", { exact: true })).toBeVisible();

    await offlineSwitch.click();
    await expect(offlineSwitch).not.toBeChecked();
    await expect(modal.getByText("已暂停", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => {
        const raw = window.localStorage.getItem("inkade:preferences:v1");
        const parsed = raw ? (JSON.parse(raw) as { state?: { yjsOfflineEnabled?: boolean } }) : null;
        return parsed?.state?.yjsOfflineEnabled;
      }),
    ).toBe(false);

    await offlineSwitch.click();
    await expect(offlineSwitch).toBeChecked();
    expect(
      await page.evaluate(() => {
        const raw = window.localStorage.getItem("inkade:preferences:v1");
        const parsed = raw ? (JSON.parse(raw) as { state?: { yjsOfflineEnabled?: boolean } }) : null;
        return parsed?.state?.yjsOfflineEnabled;
      }),
    ).toBe(true);

    // Esc closes SettingsModal cleanly
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
  });

  test("3. Super Cmd+K Hybrid Semantic Hub: Mode Toggle, URL Clip Ingest & Shift+Enter Split-Pane", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("cmdk");
    const docATitle = `混合语义主文档-${suffix}`;
    const docBTitle = `分屏对照目标文档-${suffix}`;

    const docARes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: docATitle,
          contentMarkdown: [
            `# ${docATitle}`,
            "",
            "采用混合语义向量索引与本地图谱关联架构，实现低延迟知识召回。",
          ].join("\n"),
          tags: ["rag", "hybrid"],
        },
      },
    );
    expect(docARes.status).toBe(201);
    const docAId = docARes.body.document.id;

    const docBRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: docBTitle,
          contentMarkdown: `# ${docBTitle}\n\n这是通过 Cmd+K Shift+Enter 直接打开的分屏对照内容。`,
          tags: ["split"],
        },
      },
    );
    expect(docBRes.status).toBe(201);

    const reindexRes = await apiJson(request, "POST", "/api/v1/search/reindex");
    expect(reindexRes.status).toBe(200);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/docs/${docAId}`);
    await expect(page.getByRole("heading", { name: docATitle })).toBeVisible();

    // Open Cmd+K and test Hybrid <-> Keyword toggle + semantic search result badge
    await page.keyboard.press(`${MOD_KEY}+k`);
    const cmdInput = page.getByPlaceholder("搜索文档、大纲节点，或运行快捷命令…");
    await expect(cmdInput).toBeVisible();

    const modeBtn = page.getByRole("button", { name: "切换检索模式（⌘⇧K）" });
    await expect(modeBtn).toContainText("Hybrid 语义");

    await modeBtn.click();
    await expect(modeBtn).toContainText("关键词");

    await page.keyboard.press(`${MOD_KEY}+Shift+k`);
    await expect(modeBtn).toContainText("Hybrid 语义");

    await cmdInput.fill("混合语义向量");
    const hybridHitOption = page.getByRole("option", { name: new RegExp(docATitle) }).first();
    await expect(hybridHitOption).toBeVisible();
    await expect(hybridHitOption).toContainText(/混合匹配|语义相似/);

    // Paste URL into Cmd+K -> trigger URL clip ingest banner
    await cmdInput.fill("http://e2e-fixture.inkade.test/article");
    const clipActionOption = page
      .getByRole("option", { name: /剪藏此链接至 Inbox/ })
      .first();
    await expect(clipActionOption).toBeVisible();
    await expect(clipActionOption).toContainText("http://e2e-fixture.inkade.test/article");

    await clipActionOption.click();
    await expect(page).toHaveURL(/\/docs\/doc_/);
    await expect(page.getByRole("heading", { name: "Playwright Mock Fixture Article" })).toBeVisible();
    await expect(page.locator(".inkade-prose")).toContainText("deterministic local fixture article");

    // Return to docA, open Inspector, then press Cmd+K -> search docB -> Shift+Enter opens Split-Pane and collapses Inspector
    await page.goto(`/docs/${docAId}`);
    await expect(page.getByRole("heading", { name: docATitle })).toBeVisible();
    await page.keyboard.press(`${MOD_KEY}+.`);
    await expect(page.getByRole("button", { name: "关闭 Inspector" })).toBeVisible();

    const workspaceInspectorBtn = page.getByRole("button", { name: "切换右侧上下文 Inspector" });
    await expect(workspaceInspectorBtn).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press(`${MOD_KEY}+k`);
    const cmdInputSplit = page.getByPlaceholder("搜索文档、大纲节点，或运行快捷命令…");
    await cmdInputSplit.fill(docBTitle);
    const docBOption = page.getByRole("option", { name: new RegExp(docBTitle) }).first();
    await expect(docBOption).toBeVisible();

    await page.keyboard.press("Shift+Enter");

    // Inspector automatically collapsed and Split-Pane opened with docB
    await expect(page.getByRole("button", { name: "关闭 Inspector" })).toHaveCount(0);
    await expect(workspaceInspectorBtn).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "关闭分栏" }).first()).toBeVisible();
    await expect(
      page.locator("aside", { hasText: "这是通过 Cmd+K Shift+Enter 直接打开的分屏对照内容" }),
    ).toBeVisible();
  });

  test("4. Daily-as-Inbox Studio: Week Ribbon, Reviewed Persistence, Focus Rail, Node Defer & Onboarding", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("daily");
    const today = getTodayLocalDate();
    const tomorrow = shiftDateString(today, 1);
    const createdTodayTitle = `今日新建聚焦文档-${suffix}`;
    const deferMenuTask = `菜单推迟任务-${suffix}`;
    const deferShortcutTask = `快捷键推迟节点-${suffix}`;

    const createdDoc = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: createdTodayTitle,
          contentMarkdown: `# ${createdTodayTitle}\n\n当日新建文档应自动出现在 Daily Focus Rail。`,
          tags: ["focus"],
        },
      },
    );
    expect(createdDoc.status).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/daily");
    const outlineEditor = page.locator(".inkade-pm-outliner .ProseMirror");
    await expect(outlineEditor).toBeVisible();
    const outlineBox = await outlineEditor.boundingBox();
    expect(outlineBox).not.toBeNull();
    expect(outlineBox!.y).toBeLessThan(420);

    // Compact sidebar OnboardingGuideCard: opens Checklist Popover, updates progress, dismiss persists
    const onboardingCard = page.locator('[data-slot="onboarding-guide-card"]');
    await expect(onboardingCard).toBeVisible();
    await expect(onboardingCard).toContainText("0/4 已完成");
    await onboardingCard.getByRole("button", { name: "展开工作区快速上手清单" }).click();

    const onboardingPopover = page.locator('[data-slot="popover-popup"]');
    await expect(onboardingPopover).toBeVisible();
    await onboardingPopover
      .getByRole("checkbox", { name: /标记步骤.*体验今日大纲工作流/ })
      .click();
    await expect(onboardingCard).toContainText("1/4 已完成");

    await onboardingPopover.getByRole("button", { name: "关闭新手引导卡片" }).click();
    await expect(onboardingCard).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("inkade:onboarding:dismissed"))).toBe(
      "true",
    );

    await page.reload();
    await expect(page.locator(".inkade-pm-outliner .ProseMirror")).toBeVisible();
    await expect(page.locator('[data-slot="onboarding-guide-card"]')).toHaveCount(0);

    // 7-day Mon-Sun Week Ribbon promoted directly onto Daily header + Calendar Heatmap Popover
    const weekRibbon = page.getByTestId("daily-week-ribbon");
    await expect(weekRibbon).toBeVisible();
    const ribbonButtons = weekRibbon.locator("button[data-date]");
    await expect(ribbonButtons).toHaveCount(7);
    await expect(weekRibbon.locator(`button[data-date="${today}"]`)).toHaveAttribute(
      "aria-current",
      "date",
    );

    const otherWeekBtn = weekRibbon.locator('button[data-date]:not([aria-current="date"])').first();
    const otherDate = await otherWeekBtn.getAttribute("data-date");
    expect(otherDate).toBeTruthy();
    await otherWeekBtn.click();
    await expect(page).toHaveURL(new RegExp(`/daily/${otherDate}`));
    await expect(
      page.getByTestId("daily-week-ribbon").locator(`button[data-date="${otherDate}"]`),
    ).toHaveAttribute("aria-current", "date");

    const calendarTrigger = page.getByRole("button", { name: "切换日期与热力图" });
    await calendarTrigger.click();
    await expect(page.getByText("近 90 天大纲热力日历")).toBeVisible();
    await calendarTrigger.click();
    await expect(page.getByText("近 90 天大纲热力日历")).toHaveCount(0);

    await page.locator("header").getByRole("button", { name: "今天", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/daily/${today}`));

    // Toggle promoted header Reviewed button and verify persistence across reload
    const reviewedToggle = page.getByTestId("daily-reviewed-toggle");
    await expect(reviewedToggle).toBeVisible();
    if ((await reviewedToggle.getAttribute("aria-pressed")) !== "true") {
      await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/v1/documents/") && res.request().method() === "PATCH",
        ),
        reviewedToggle.click(),
      ]);
    }
    await page.reload();
    await expect(page.locator(".inkade-pm-outliner .ProseMirror")).toBeVisible();
    await expect(page.getByTestId("daily-reviewed-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const dailyApiRes = await apiJson<{ document: { properties: Record<string, unknown> | null } }>(
      request,
      "GET",
      `/api/v1/documents/daily/${today}`,
    );
    expect(dailyApiRes.status).toBe(200);
    expect(typeof dailyApiRes.body.document.properties?.["reviewedAt"]).toBe("string");

    // Focus Rail starts collapsed by default; toggle open -> displays Created Today docs + open tasks
    await expect(page.getByTestId("daily-focus-rail")).toHaveCount(0);
    await page.getByRole("button", { name: "展开 / 收起今日焦点面板" }).click();
    const focusRail = page.getByTestId("daily-focus-rail");
    await expect(focusRail).toBeVisible();
    await expect(focusRail).toContainText(createdTodayTitle);

    const editor = page.locator(".inkade-pm-outliner .ProseMirror");
    await page.getByRole("button", { name: "新建节点" }).click();
    await page.keyboard.insertText(deferMenuTask);
    await page.keyboard.press(`${MOD_KEY}+Enter`);

    const menuNode = editor.locator("[data-outline-item]", { hasText: deferMenuTask }).first();
    await expect(menuNode).toHaveAttribute("data-node-id", /^nod_/);
    const sourceNodeId = await menuNode.getAttribute("data-node-id");
    expect(sourceNodeId).toMatch(/^nod_/);

    await expect(focusRail).toContainText(deferMenuTask);

    // Defer via left-gutter handle action menu -> "推迟至明日"
    await menuNode.hover();
    await menuNode.locator('[data-outline-handle="true"]').click();
    const deferMenu = page.locator('[data-inkade-node-menu="true"]');
    await expect(deferMenu).toBeVisible();
    await deferMenu.getByRole("menuitem", { name: /推迟至明日/ }).click();

    await expect(menuNode).toHaveAttribute("data-node-id", sourceNodeId!);
    await expect(menuNode).toContainText(`已推迟 → ${tomorrow}`);

    // Also test Alt+Enter quick defer on a second node
    await page.getByRole("button", { name: "新建节点" }).click();
    await page.keyboard.insertText(deferShortcutTask);
    const shortcutNode = editor.locator("[data-outline-item]", { hasText: deferShortcutTask }).first();
    await expect(shortcutNode).toHaveAttribute("data-node-id", /^nod_/);
    const shortcutNodeId = await shortcutNode.getAttribute("data-node-id");
    await page.keyboard.press("Alt+Enter");

    await expect(shortcutNode).toHaveAttribute("data-node-id", shortcutNodeId!);
    await expect(shortcutNode).toContainText(`已推迟 → ${tomorrow}`);

    // Navigate to tomorrow's daily view -> verify both deferred clones appear
    await page.goto(`/daily/${tomorrow}`);
    const tomorrowEditor = page.locator(".inkade-pm-outliner .ProseMirror");
    await expect(tomorrowEditor).toContainText(deferMenuTask);
    await expect(tomorrowEditor).toContainText(deferShortcutTask);
  });

  test("5. Object Studio Multi-View Library: List/Grid/Table, Column Sort, Typed Properties & SavedView", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("lib");
    const alphaTitle = `Alpha对象文档-${suffix}`;
    const zetaTitle = `Zeta对象文档-${suffix}`;
    const viewName = `对象表格视图-${suffix}`;

    const alphaRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: alphaTitle,
          contentMarkdown: `# ${alphaTitle}\n\n带结构化属性的 Alpha 文档。`,
          tags: [`studio-${suffix}`, "props"],
          properties: {
            status: "in_review",
            wordGoal: 3200,
            audience: "engineers",
          },
        },
      },
    );
    expect(alphaRes.status).toBe(201);

    const zetaRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: zetaTitle,
          contentMarkdown: `# ${zetaTitle}\n\n用于验证列头排序与 SavedView 持久化。`,
          tags: [`studio-${suffix}`],
          properties: {
            status: "published",
            wordGoal: 1500,
          },
        },
      },
    );
    expect(zetaRes.status).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    // Filter to isolate our 2 deterministic docs
    await page.getByPlaceholder("过滤标题、摘要或标签…").fill(suffix);
    await expect(page.getByText(alphaTitle).first()).toBeVisible();
    await expect(page.getByText(zetaTitle).first()).toBeVisible();

    // Switch List -> Grid
    const viewSwitcher = page.locator('[aria-label="视图模式"]');
    await viewSwitcher.getByRole("button", { name: "卡片墙" }).click();
    await expect(page.locator("main").getByText("in_review").first()).toBeVisible();
    await expect(page.locator("main").getByText("3200").first()).toBeVisible();

    // Switch Grid -> Table
    await viewSwitcher.getByRole("button", { name: "属性表" }).click();
    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(table.getByText("in_review").first()).toBeVisible();
    await expect(table.getByText("3200").first()).toBeVisible();

    // Click sortable Title column header -> ascending (Alpha before Zeta), then descending (Zeta before Alpha)
    const titleHeaderBtn = table.locator("thead").getByRole("button", { name: "标题" });
    await titleHeaderBtn.click();
    await expect(table.locator("tbody tr").nth(0)).toContainText(alphaTitle);
    await expect(table.locator("tbody tr").nth(1)).toContainText(zetaTitle);

    await titleHeaderBtn.click();
    await expect(table.locator("tbody tr").nth(0)).toContainText(zetaTitle);
    await expect(table.locator("tbody tr").nth(1)).toContainText(alphaTitle);

    // Click sortable Updated column header
    await table.locator("thead").getByRole("button", { name: "更新于" }).click();
    await expect(table.locator("tbody tr")).toHaveCount(2);

    // Create a SavedView via sidebar + and persist viewMode + sort into SavedView
    await page.getByRole("button", { name: "新建视图" }).click();
    const svDialog = page.getByRole("dialog");
    await expect(svDialog).toBeVisible();
    await svDialog.getByPlaceholder("例如：未读调研文章").fill(viewName);
    await svDialog.getByPlaceholder("例如：research 或 eng/ai").fill(`studio-${suffix}`);
    await svDialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(svDialog).toHaveCount(0);

    // Open the SavedView from the left sidebar
    const sidebarViewBtn = page.locator("aside").getByRole("button", { name: viewName }).first();
    await expect(sidebarViewBtn).toBeVisible();
    await sidebarViewBtn.click();
    await expect(page).toHaveURL(/\/library\?viewId=/);

    // Ensure Table + Title asc is configured, then save layout to SavedView
    await page.locator('[aria-label="视图模式"]').getByRole("button", { name: "属性表" }).click();
    const savedTable = page.locator("table");
    await expect(savedTable).toBeVisible();
    await savedTable.locator("thead").getByRole("button", { name: "标题" }).click();
    await expect(savedTable.locator("tbody tr").nth(0)).toContainText(alphaTitle);

    const saveLayoutBtn = page.getByRole("button", { name: "保存视图布局" });
    await expect(saveLayoutBtn).toBeVisible();
    await saveLayoutBtn.click();
    await expect(page.getByText("视图布局已更新").first()).toBeVisible();

    // Reset local viewMode to list, leave to /daily, then reopen SavedView -> table + title asc persists
    await page.evaluate(() => {
      const raw = window.localStorage.getItem("inkade:preferences:v1");
      const parsed = raw ? (JSON.parse(raw) as { state?: { preferences?: { library?: { viewMode?: string } } } }) : null;
      if (parsed?.state?.preferences?.library) {
        parsed.state.preferences.library.viewMode = "list";
        window.localStorage.setItem("inkade:preferences:v1", JSON.stringify(parsed));
      }
    });
    await page.goto("/daily");
    await page.locator("aside").getByRole("button", { name: viewName }).first().click();

    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator("table tbody tr").nth(0)).toContainText(alphaTitle);
    await expect(page.locator("table tbody tr").nth(1)).toContainText(zetaTitle);
  });

  test("6. Long-Form Reading: Sidebar Outline, Tick Scrubber, Status Bar, Inspector Related/Attachments & @ Inline Creation", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("read");
    const mainTitle = `长文研读工作室-${suffix}`;
    const siblingTitle = `语义关联架构指南-${suffix}`;
    const quickLinkTitle = `QuickLinkedDoc_${suffix}`;
    const attachmentName = `spec-notes-${suffix}.txt`;

    const siblingRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: siblingTitle,
          contentMarkdown: [
            `# ${siblingTitle}`,
            "",
            "深入剖析 Inkade 双引擎架构、SQLite FTS5 词法评分与 128 维语义向量倒排融合索引机制。",
          ].join("\n"),
          tags: ["architecture", "rag"],
        },
      },
    );
    expect(siblingRes.status).toBe(201);

    const fillerParagraph =
      "Inkade 采用双引擎存储模型，同时保障大纲节点的稳定引用与长文 Markdown 修订快照的可追溯性。".repeat(
        4,
      );

    const mainRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: mainTitle,
          contentMarkdown: [
            `# ${mainTitle}`,
            "",
            "## 第一章 双引擎架构总览",
            "",
            "深入剖析 Inkade 双引擎架构、SQLite FTS5 词法评分与 128 维语义向量倒排融合索引机制。",
            "",
            fillerParagraph,
            "",
            "### 1.1 节点与修订隔离",
            "",
            fillerParagraph,
            "",
            "## 第二章 混合检索与图谱验证",
            "",
            fillerParagraph,
            "",
            "末尾编辑占位段落。",
          ].join("\n"),
          tags: ["architecture", "rag"],
        },
      },
    );
    expect(mainRes.status).toBe(201);
    const mainDocId = mainRes.body.document.id;

    // Upload an attachment linked to mainDocId
    const attachRes = await apiJson<{ attachment: { id: string } }>(
      request,
      "POST",
      "/api/v1/attachments",
      {
        data: {
          documentId: mainDocId,
          filename: attachmentName,
          mimeType: "text/plain",
          contentBase64: Buffer.from(`Attachment content for ${suffix}`, "utf8").toString("base64"),
        },
      },
    );
    expect(attachRes.status).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/docs/${mainDocId}`);
    await expect(page.getByRole("heading", { name: mainTitle })).toBeVisible();

    // Left sidebar [Workspace Tree | Document Outline] switcher
    const sidebarModeGroup = page.locator('[aria-label="侧栏视图模式"]');
    await expect(sidebarModeGroup).toBeVisible();
    await sidebarModeGroup.getByRole("button", { name: "文档大纲" }).click();

    const sidebarAside = page
      .locator("aside")
      .filter({ has: page.getByRole("button", { name: "工作区菜单" }) });
    await expect(sidebarAside.getByText("本页目录")).toBeVisible();
    const outlineHeadingBtn = sidebarAside.getByRole("button", { name: "第二章 混合检索与图谱验证" });
    await expect(outlineHeadingBtn).toBeVisible();
    await outlineHeadingBtn.click();

    const targetHeading = page.getByRole("heading", { name: "第二章 混合检索与图谱验证" });
    await expect(targetHeading).toBeInViewport();

    // Right-edge outline-tick-scrubber (>= 2 ticks + hover TOC card)
    const scrubber = page.getByTestId("outline-tick-scrubber");
    await expect(scrubber).toBeVisible();
    const ticks = scrubber.locator("> div").first().locator("button");
    expect(await ticks.count()).toBeGreaterThanOrEqual(2);

    await scrubber.hover();
    const floatingToc = scrubber.locator("> div").nth(1);
    await expect(floatingToc).toBeVisible();
    await expect(floatingToc).toContainText("第一章 双引擎架构总览");
    await expect(floatingToc).toContainText("第二章 混合检索与图谱验证");

    // Bottom document-status-bar (word/char count, reading time, Yjs status, vN button opens Inspector Revisions)
    const statusBar = page.getByTestId("document-status-bar");
    await expect(statusBar).toBeVisible();
    await expect(statusBar).toContainText(/\d+ 词 · \d+ 字符/);
    await expect(statusBar).toContainText(/约 \d+ 分钟阅读/);
    await expect(statusBar).toContainText("Yjs/IndexedDB 本地同步");

    await statusBar.getByRole("button", { name: "v1" }).click();
    const revisionsTab = page.getByRole("tab", { name: "版本" });
    await expect(revisionsTab).toBeVisible();
    await expect(revisionsTab).toHaveAttribute("aria-selected", "true");

    // Switch Inspector to Backlinks tab -> verify Related via Semantic Embedding & Attachments
    await page.getByRole("tab", { name: "双链" }).click();
    const inspectorAside = page
      .locator("aside")
      .filter({ has: page.getByRole("button", { name: "关闭 Inspector" }) });
    await expect(inspectorAside.getByText("相关语义推荐")).toBeVisible();
    await expect(inspectorAside.getByText(siblingTitle).first()).toBeVisible({ timeout: 10_000 });
    await expect(inspectorAside.getByText(/\d+%/).first()).toBeVisible();

    const attachmentsTrigger = inspectorAside.getByRole("button", { name: /文档附件/ });
    await expect(attachmentsTrigger).toBeVisible();
    await attachmentsTrigger.click();
    await expect(inspectorAside.getByText(attachmentName)).toBeVisible();

    // Close Inspector before editing
    await page.getByRole("button", { name: "关闭 Inspector" }).click();

    // Modeless editing: ProseMirror is directly active -> type @QuickLinkedDoc -> click "+ 新建文章并嵌入引用"
    const pm = page.locator(".ProseMirror");
    await expect(pm).toBeVisible();

    await pm.locator("p", { hasText: "末尾编辑占位段落" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(` @${quickLinkTitle}`);

    await expect(page.getByText("引用或新建对象")).toBeVisible();
    const createArticleOption = page.getByRole("button", { name: /新建文章并嵌入引用/ }).first();
    await expect(createArticleOption).toBeVisible();

    const createDocPromise = page.waitForResponse(
      (res) => res.url().endsWith("/api/v1/documents") && res.request().method() === "POST",
    );
    await createArticleOption.click();
    const createDocResp = await createDocPromise;
    expect(createDocResp.status()).toBe(201);

    await expect(
      pm.locator(`span[data-type="inkade-wikilink"][data-target="${quickLinkTitle}"]`),
    ).toBeVisible();

    // Save explicitly via Save button or Cmd+S, then click the inline wikilink directly to navigate
    const saveBtn = page.getByRole("button", { name: "保存", exact: true });
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await expect(page.getByText("已保存").first()).toBeVisible();
    }

    const renderedLink = page.locator(".inkade-prose button", { hasText: quickLinkTitle }).first();
    await expect(renderedLink).toBeVisible();
    await renderedLink.click();
    await expect(page).toHaveURL(/\/docs\/doc_/);
    await expect(page.getByRole("heading", { name: quickLinkTitle, exact: true })).toBeVisible();
  });
});
