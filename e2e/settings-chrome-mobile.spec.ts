import { expect, MOD_KEY, test, uniqueSuffix } from "./fixtures.ts";

test.describe("Settings Dual-Column, Chrome Ergonomics & Mobile PWA Viewport", () => {
  test("Settings dual-column appearance presets, locale toggle, tokens & scope-rules live matcher", async ({
    page,
  }) => {
    const suffix = uniqueSuffix("set");
    const rulePattern = `inkade-repo-${suffix}`;

    // 1. Open SettingsModal via Cmd+, and navigate to /settings/appearance via Open Full Page
    await page.goto("/daily");
    await expect(page.getByRole("button", { name: /搜索或运行命令/ })).toBeVisible();
    await page.keyboard.press(`${MOD_KEY}+Comma`);

    const settingsModal = page.getByRole("dialog");
    await expect(settingsModal).toBeVisible();
    const modalNav = settingsModal.locator('aside[aria-label="设置导航"]');
    await expect(modalNav).toBeVisible();
    await expect(modalNav.getByText("个人偏好")).toBeVisible();
    await expect(modalNav.getByText("智能与离线同步")).toBeVisible();

    await settingsModal.getByRole("button", { name: "全页打开" }).click();
    await expect(page).toHaveURL(/\/settings\/appearance/);
    await expect(settingsModal).toHaveCount(0);

    // Verify dual-column layout on full page
    const settingsNav = page.locator('aside[aria-label="设置导航"]');
    await expect(settingsNav).toBeVisible();
    await expect(settingsNav.getByText("个人偏好")).toBeVisible();
    await expect(settingsNav.getByText("知识库结构")).toBeVisible();
    await expect(settingsNav.getByText("智能与离线同步")).toBeVisible();
    await expect(settingsNav.getByText("Agent 与安全治理")).toBeVisible();

    // Default V4.0 attributes: Inset shell, crisp light surface, mono accent
    await expect(page.locator("html")).toHaveAttribute("data-shell", "inset");
    await expect(page.locator("html")).toHaveAttribute("data-surface", "light");
    await expect(page.locator("html")).toHaveAttribute("data-accent", "mono");

    // 4-tier Surface Theme cards: dark-dimmed -> dark -> light-dimmed -> light
    await page.getByRole("radio", { name: "柔雾石板", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-surface", "dark-dimmed");

    await page.getByRole("radio", { name: "暗色", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-surface", "dark");

    await page.getByRole("radio", { name: "暖象牙柔光", exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-surface", "light-dimmed");

    await page.getByRole("radio", { name: "浅色", exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-surface", "light");

    // Accent presets: sage -> terracotta -> indigo -> mono
    await page.getByRole("radio", { name: "森绿 Sage" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-accent", "sage");
    await page.getByRole("radio", { name: "暖陶 Terracotta" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-accent", "terracotta");
    await page.getByRole("radio", { name: "墨靛 Indigo" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-accent", "indigo");
    await page.getByRole("radio", { name: "石墨纯素 Mono" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-accent", "mono");

    // Warm Paper / Sepia toggle
    const paperSwitch = page.getByRole("switch", { name: /Warm Paper \/ Sepia/ });
    await paperSwitch.click();
    await expect(page.locator("html")).toHaveAttribute("data-paper", "sepia");
    await expect(page.locator('[data-paper="sepia"]').first()).toBeVisible();

    // Live locale toggle: zh-CN -> en-US -> zh-CN
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByRole("heading", { name: "Appearance & Theme" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Back to Workspace/i })).toBeVisible();

    await page.getByRole("button", { name: "简体中文", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("heading", { name: "外观与主题" })).toBeVisible();

    // 2. /settings/tokens creation & one-time reveal
    await settingsNav.getByRole("link", { name: "API Tokens 与 MCP" }).click();
    await expect(page).toHaveURL(/\/settings\/tokens/);

    const tokenName = `e2e-ui-token-${suffix}`;
    await page.getByRole("button", { name: "创建 Token" }).click();
    const tokenNameInput = page.getByPlaceholder("例如：Cursor Agent - Research Only");
    await tokenNameInput.fill(tokenName);
    await tokenNameInput.press("Enter");
    await expect(page.getByText(`Token 已创建：${tokenName}`)).toBeVisible();
    await page.getByRole("button", { name: "我已保存" }).click();
    await expect(page.getByText(tokenName).first()).toBeVisible();

    // 3. /settings/scope-rules & Live Match Tester
    await settingsNav.getByRole("link", { name: "Project Scope Rules" }).click();
    await expect(page).toHaveURL(/\/settings\/scope-rules/);

    await page.getByRole("button", { name: "新建规则" }).click();
    await page.getByPlaceholder("例如：inkade 或 **/projects/inkade/**").fill(rulePattern);
    await page
      .locator("label", { hasText: "Research" })
      .first()
      .getByRole("checkbox")
      .click();
    await page.getByRole("button", { name: "保存规则" }).click();
    await expect(page.locator("code", { hasText: rulePattern }).first()).toBeVisible();

    const liveInput = page.getByLabel("实时匹配测试器（Live Match Tester）");
    await liveInput.fill(rulePattern);
    await expect(page.getByText("命中 1 条规则")).toBeVisible();
    await expect(page.getByText("最高优先级命中：")).toBeVisible();
  });

  test("3-pane ResizeHandle drag/double-click reset & Cmd+\\ collapsed sidebar Hover-Peek", async ({
    page,
  }) => {
    await page.goto("/library");
    const sidebarHandle = page.getByRole("separator").first().or(
      page.locator('[aria-label="拖拽调整左侧栏宽度，双击重置"]'),
    );
    // ResizeHandle uses div with aria-label
    const leftHandle = page.locator('[aria-label="拖拽调整左侧栏宽度，双击重置"]');
    await expect(leftHandle).toBeVisible();

    const initialVal = Number(await leftHandle.getAttribute("aria-valuenow"));
    const box = await leftHandle.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 48, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
    }
    const resizedVal = Number(await leftHandle.getAttribute("aria-valuenow"));
    expect(resizedVal).toBeGreaterThan(initialVal);

    // Double-click resets back to default (276)
    await leftHandle.dblclick();
    await expect(leftHandle).toHaveAttribute("aria-valuenow", String(initialVal));

    // Collapse sidebar via Cmd+\ and trigger left-edge Hover-Peek
    await page.keyboard.press(`${MOD_KEY}+Backslash`);
    await expect(page.getByRole("button", { name: "展开侧栏" })).toBeVisible();

    await page.mouse.move(3, 240);
    const peekSidebar = page.locator("aside.fixed");
    await expect(peekSidebar).toBeVisible();
    await expect(peekSidebar.getByText("Today · 今日")).toBeVisible();

    // Restore pinned sidebar
    await page.getByRole("button", { name: "固定展开侧栏" }).click();
    await expect(leftHandle).toBeVisible();
  });

  test("Mobile PWA viewport (390x844): drawer nav, floating Quick Capture, bottom tab bar, zero horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const [route, readyLocator] of [
      ["/daily", page.locator(".inkade-pm-outliner")],
      ["/inbox", page.locator('nav[aria-label="当前位置面包屑"]', { hasText: "Inbox" })],
      ["/library", page.getByRole("heading", { name: "Library" })],
      ["/tasks", page.getByRole("heading", { name: "全局待办中心" })],
      ["/settings/appearance", page.getByRole("heading", { name: "外观与主题" })],
    ] as const) {
      await page.goto(route);
      await expect(readyLocator).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `Expected zero horizontal overflow on ${route}`).toBeLessThanOrEqual(1);
    }

    await page.goto("/daily");
    const mobileNav = page.locator('nav[aria-label="移动端底部导航"]');
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByText("今日")).toBeVisible();
    await expect(mobileNav.getByText("收件箱")).toBeVisible();
    await expect(mobileNav.getByText("知识库")).toBeVisible();
    await expect(mobileNav.getByText("会话")).toBeVisible();

    // Floating Quick Capture button
    const fab = page.getByRole("button", { name: "快速记录" });
    await expect(fab).toBeVisible();

    // Open mobile navigation drawer
    await page.getByRole("button", { name: "打开导航菜单" }).click();
    const dialogDrawer = page.locator('[role="dialog"]').first();
    await expect(dialogDrawer).toBeVisible();
    await expect(dialogDrawer.getByText("待办中心")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
