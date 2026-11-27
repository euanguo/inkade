import { readFileSync } from "node:fs";
import {
  apiJson,
  E2E_FIXTURE_URL,
  expect,
  getTodayLocalDate,
  MOD_KEY,
  shiftDateString,
  test,
  uniqueSuffix,
} from "./fixtures.ts";

test.describe("Inkade V5 Enterprise Upgrade & Blind-Spot Suite (Phase 30-35)", () => {
  test("1. P0 Visuals: Opaque Cmd+K dialog, 4-theme SegmentedControl contrast, Dark Mermaid readability & ampersand diff integrity", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("v5-p0");
    const docTitle = `V5-P0-视觉与Diff-${suffix}`;

    const docRes = await apiJson<{ document: { id: string; version: number } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: docTitle,
          contentMarkdown: [
            `# ${docTitle}`,
            "",
            "Initial R&D notes for Alpha & Beta.",
            "",
            "```mermaid",
            "flowchart LR",
            "  AlphaNode --> BetaNode",
            "```",
            "",
          ].join("\n"),
        },
      },
    );
    expect(docRes.status).toBe(201);
    const docId = docRes.body.document.id;

    // 1) Command Palette opens with opaque surface (no translucent bleed-through)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/docs/${docId}`);
    await expect(page.getByTestId("document-inline-title")).toBeVisible();

    await page.keyboard.press(`${MOD_KEY}+k`);
    const dialogPopup = page.locator('[data-slot="dialog-popup"], [data-slot="command-dialog-popup"], [role="dialog"]').first();
    await expect(dialogPopup).toBeVisible();
    const opacityVal = await dialogPopup.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).opacity || "1"),
    );
    expect(opacityVal).toBeGreaterThanOrEqual(0.95);
    await page.keyboard.press("Escape");
    await expect(dialogPopup).toHaveCount(0);

    // 2) Switch to Dark surface via SettingsModal -> check Mermaid SVG uses light readable text & non-transparent backdrop
    await page.keyboard.press(`${MOD_KEY}+Comma`);
    const settingsModal = page.getByRole("dialog");
    await expect(settingsModal).toBeVisible();
    await settingsModal.getByRole("radio", { name: "暗色", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-surface", "dark");
    await page.keyboard.press("Escape");

    const mermaidCard = page.locator('[data-type="inkade-code-block"][data-language="mermaid"]');
    await expect(mermaidCard).toBeVisible();
    const mermaidSvg = mermaidCard.locator("svg").first();
    await expect(mermaidSvg).toBeVisible();

    const darkSvgTextColor = await mermaidSvg.evaluate((svg) => {
      const label = svg.querySelector("text, span, foreignObject div, .nodeLabel");
      if (!label) return "";
      const cs = getComputedStyle(label);
      return `${cs.color}|${cs.fill}`;
    });
    expect(darkSvgTextColor).not.toContain("rgb(0, 0, 0)");

    // 3) SegmentedControl active indicator contrast check in dark & light on /library
    await page.goto("/library");
    const segIndicator = page.locator('[data-slot="segmented-control-indicator"]').first();
    await expect(segIndicator).toBeVisible();
    const segStyleDark = await segIndicator.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderTopWidth };
    });
    expect(segStyleDark.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(Number.parseFloat(segStyleDark.border)).toBeGreaterThan(0);

    // Reset back to crisp light surface so remaining suite runs under default theme
    await page.keyboard.press(`${MOD_KEY}+Comma`);
    const resetModal = page.getByRole("dialog");
    await resetModal.getByRole("radio", { name: "浅色", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-surface", "light");
    await page.keyboard.press("Escape");

    // 4) Ampersand roundtrip without `&amp;` entity leakage
    const tokenRes = await apiJson<{ rawToken: string }>(request, "POST", "/api/v1/tokens", {
      data: {
        name: `amp-agent-${suffix}`,
        scope: { permission: "write", spaceIds: ["spc_research"], denyHardDelete: true },
      },
    });
    expect(tokenRes.status).toBe(201);

    const latestRes = await apiJson<{ document: { version: number; contentMarkdown: string } }>(
      request,
      "GET",
      `/api/v1/documents/${docId}`,
    );
    await apiJson(request, "PATCH", `/api/v1/documents/${docId}`, {
      token: tokenRes.body.rawToken,
      data: {
        contentMarkdown: latestRes.body.document.contentMarkdown.replace(
          "Initial R&D notes for Alpha & Beta.",
          "Updated Q&A notes for Alpha & Beta.",
        ),
        expectedVersion: latestRes.body.document.version,
        changeSummary: "Verify ampersand roundtrip",
      },
    });

    await page.goto(`/docs/${docId}`);
    await page.getByRole("button", { name: "阅读批注" }).click();
    await page.getByRole("button", { name: "查看改动" }).click();
    const diffViewer = page.locator('[data-slot="inline-track-changes-viewer"]');
    await expect(diffViewer).toBeVisible();
    await diffViewer.getByRole("button", { name: "源码 Diff" }).click();
    await expect(page.locator("main")).toContainText("Updated Q&A notes for Alpha & Beta.");
    await expect(page.locator("main")).not.toContainText("&amp;");
  });

  test("2. Editor Slash Rank (/col), /toggle & /math Focus, @Today Sticky Footer, Cmd+F Find/Replace, Craft Sepia Sheet & HTML Export", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("v5-ed");
    const today = getTodayLocalDate();
    const title = `V5编辑器能力-${suffix}`;

    const created = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title,
          contentMarkdown: [
            `# ${title}`,
            "",
            "slot-col",
            "",
            "slot-toggle",
            "",
            "slot-math",
            "",
            "slot-mention",
            "",
            "find-target-token one and find-target-token two.",
            "",
          ].join("\n"),
        },
      },
    );
    expect(created.status).toBe(201);
    const docId = created.body.document.id;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/docs/${docId}`);
    const pm = page.locator(".ProseMirror");
    await expect(pm).toBeVisible();

    // /col ranks Multi-Column BEFORE Toggle
    await pm.locator("p", { hasText: "slot-col" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /col");
    const menu = page.getByTestId("editor-trigger-menu");
    await expect(menu).toBeVisible();
    const firstOption = menu.locator("button").first();
    await expect(firstOption).toContainText("双栏");
    await page.keyboard.press("Escape");

    // /toggle auto-focuses summary input immediately
    await pm.locator("p", { hasText: "slot-toggle" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /toggle");
    await page.getByRole("button", { name: /Toggle 折叠块/ }).click();
    const toggleSummaryInput = pm.locator('.inkade-editor-toggle input[placeholder="折叠标题…"]');
    await expect(toggleSummaryInput).toBeFocused();
    await page.keyboard.type("Toggle Focus OK");
    await expect(toggleSummaryInput).toHaveValue("Toggle Focus OK");

    // /math auto-focuses LaTeX textarea & Mod+Enter renders KaTeX + exits cleanly
    await pm.locator("p", { hasText: "slot-math" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /math");
    await page.getByRole("button", { name: /KaTeX 公式块/ }).click();
    const mathTextarea = pm.locator('[data-type="inkade-math-block"] textarea');
    await expect(mathTextarea).toBeFocused();
    await page.keyboard.type("E = mc^2");
    await page.keyboard.press(`${MOD_KEY}+Enter`);
    await expect(pm.locator('[data-type="inkade-math-block"] .katex')).toBeVisible();

    // @今天 shows sticky footer quick actions unclipped + ISO date candidate
    await pm.locator("p", { hasText: "slot-mention" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" @今天");
    const mentionMenu = page.getByTestId("editor-trigger-menu");
    await expect(mentionMenu).toBeVisible();
    const stickyFooter = mentionMenu.locator('[data-slot="mention-quick-actions"]');
    await expect(stickyFooter).toBeVisible();
    const footerBox = await stickyFooter.boundingBox();
    expect(footerBox).not.toBeNull();
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(900);
    await expect(mentionMenu).toContainText(today);
    await page.keyboard.press("Escape");

    // Cmd+F Find & Replace Bar
    await page.keyboard.press(`${MOD_KEY}+f`);
    const findBar = page.getByTestId("document-find-bar");
    await expect(findBar).toBeVisible();
    await findBar.getByPlaceholder("在文档中查找…").fill("find-target-token");
    await expect(findBar.getByTestId("document-find-counter")).toContainText("/ 2");
    await findBar.getByRole("button", { name: "展开/收起替换" }).click();
    await findBar.getByPlaceholder("替换为…").fill("replaced-token-v5");
    await findBar.getByRole("button", { name: "全部替换" }).click();
    await expect(pm).toContainText("replaced-token-v5 one and replaced-token-v5 two.");
    await findBar.getByPlaceholder("在文档中查找…").press("Escape");

    // Craft Typography Popover + Whole-Sheet Sepia
    const typoTrigger = page.getByTestId("typography-popover-trigger");
    await expect(typoTrigger).toBeVisible();
    await typoTrigger.click();
    const typoPanel = page.getByTestId("typography-popover-panel");
    await expect(typoPanel).toBeVisible();
    await typoPanel.getByRole("button", { name: "暖纸护眼" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-paper", "sepia");
    await expect(page.locator(".inkade-paper-sepia").first()).toBeVisible();
    await page.keyboard.press("Escape");

    // Standalone HTML Export triggers real .html download
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await page.getByRole("button", { name: "更多文档操作" }).click();
        await page.getByRole("menuitem", { name: "导出独立网页 (.html)" }).click();
      })(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.html$/i);
    const dlPath = await download.path();
    if (dlPath) {
      const htmlContent = readFileSync(dlPath, "utf8");
      expect(htmlContent).toContain("replaced-token-v5");
    }

    // Reset Sepia paper back to default for clean downstream tests
    await page.evaluate(() => {
      const raw = window.localStorage.getItem("inkade:preferences:v1");
      const parsed = raw ? (JSON.parse(raw) as { state?: { preferences?: { reader?: { paper?: string } } } }) : null;
      if (parsed?.state?.preferences?.reader) {
        parsed.state.preferences.reader.paper = "default";
        window.localStorage.setItem("inkade:preferences:v1", JSON.stringify(parsed));
      }
    });
  });

  test("3. Enterprise Todo Multi-View (/tasks List, Board, Agenda), Quick Syntax, Recurring Spawn+Undo & Non-Destructive Reschedule", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("v5-todo");
    const today = getTodayLocalDate();
    const tomorrow = shiftDateString(today, 1);

    // Seed bound Daily task to verify reschedule preserves nodeId + AdeThreadBinding
    const dailyRes = await apiJson<{ document: { id: string } }>(
      request,
      "GET",
      `/api/v1/documents/daily/${today}`,
    );
    expect(dailyRes.status).toBe(200);
    const dailyDocId = dailyRes.body.document.id;

    const boundTaskRes = await apiJson<{ node: { id: string } }>(
      request,
      "POST",
      "/api/v1/outline-nodes",
      {
        data: {
          documentId: dailyDocId,
          contentMarkdown: `绑定会话待改期-${suffix}`,
          checked: false,
        },
      },
    );
    expect(boundTaskRes.status).toBe(201);
    const boundNodeId = boundTaskRes.body.node.id;
    expect(boundNodeId).toBeTruthy();

    const bindingRes = await apiJson<{ binding: { id: string } }>(
      request,
      "POST",
      "/api/v1/thread-bindings",
      {
        data: {
          documentId: dailyDocId,
          nodeId: boundNodeId,
          adeKind: "bb",
          externalThreadId: `ext-resched-${suffix}`,
          title: `Reschedule Keeper ${suffix}`,
          status: "waiting_input",
        },
      },
    );
    expect(bindingRes.status).toBe(201);

    // Seed weekly recurring task due today
    const recurTitle = `每周例会总结-${suffix}`;
    const recurRes = await apiJson<{ node: { id: string } }>(
      request,
      "POST",
      "/api/v1/outline-nodes/tasks",
      {
        data: {
          title: recurTitle,
          scheduledDate: today,
          priority: "p2",
          recurrenceRule: "weekly",
        },
      },
    );
    expect(recurRes.status).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "全局待办中心" })).toBeVisible();

    // Quick-syntax live preview before submit
    const quickInput = page.getByPlaceholder("快速新增今日待办（按 N 聚焦，支持内联 #标签）…");
    const syntaxTaskTitle = `企业看板任务-${suffix}`;
    await quickInput.fill(`${syntaxTaskTitle} !p1 @tomorrow ~30m #release every weekdays`);
    const previewStrip = page.getByTestId("quick-syntax-preview");
    await expect(previewStrip).toBeVisible();
    await expect(previewStrip).toContainText("P1");
    await expect(previewStrip).toContainText(tomorrow);
    await expect(previewStrip).toContainText("30m");
    await expect(previewStrip).toContainText("工作日");
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await expect(page.getByText(syntaxTaskTitle).first()).toBeVisible();

    // Complete recurring task -> spawns next week's occurrence -> Undo cleanly
    const recurCard = page.locator("div.rounded-xl", { hasText: recurTitle }).first();
    await expect(recurCard).toBeVisible();
    await recurCard.getByRole("checkbox").click();
    await expect(page.getByText(new RegExp(`已完成「${recurTitle}」并生成下一次`))).toBeVisible();

    const tasksAfterComplete = await apiJson<{
      tasks: Array<{
        node: {
          id: string;
          contentText: string;
          scheduledDate?: string | null;
          checked: boolean | null;
        };
      }>;
    }>(request, "GET", `/api/v1/outline-nodes/tasks?status=open`);
    const nextWeekDate = shiftDateString(today, 7);
    expect(
      tasksAfterComplete.body.tasks.some(
        (item) =>
          item.node.contentText.includes(recurTitle) &&
          item.node.scheduledDate === nextWeekDate &&
          item.node.checked === false,
      ),
    ).toBe(true);

    // Click Undo toast button -> restores original completion
    await page.getByRole("button", { name: "撤销" }).first().click();
    await expect(page.locator("div.rounded-xl", { hasText: recurTitle }).first()).toBeVisible();

    // Switch to Board view (看板) & toggle Priority grouping
    await page.getByRole("button", { name: "看板", exact: true }).click();
    const boardView = page.getByTestId("tasks-board-view");
    await expect(boardView).toBeVisible();
    await expect(boardView).toContainText(syntaxTaskTitle);
    await boardView.getByRole("button", { name: "按优先级" }).click();
    await expect(boardView).toContainText("P1 紧急");
    await expect(boardView).toContainText(syntaxTaskTitle);

    // Switch to Agenda timeline grid (日程) -> verify 06:00-22:00 hourly grid + Anytime rail
    await page.getByRole("button", { name: "日程", exact: true }).click();
    const agendaView = page.getByTestId("tasks-agenda-view");
    await expect(agendaView).toBeVisible();
    await expect(agendaView.getByTestId("agenda-anytime-rail")).toBeVisible();
    await expect(agendaView).toContainText("09:00");
    await expect(agendaView).toContainText("18:00");

    // Non-destructive reschedule of Daily task keeps same nodeId & AdeThreadBinding
    const reschedApi = await apiJson<{ node: { id: string; scheduledDate: string | null } }>(
      request,
      "PATCH",
      `/api/v1/outline-nodes/${boundNodeId}`,
      { data: { scheduledDate: tomorrow } },
    );
    expect(reschedApi.status).toBe(200);
    expect(reschedApi.body.node.id).toBe(boundNodeId);
    expect(reschedApi.body.node.scheduledDate).toBe(tomorrow);

    const preservedBindings = await apiJson<{ bindings: Array<{ id: string; nodeId: string | null }> }>(
      request,
      "GET",
      `/api/v1/thread-bindings?documentId=${dailyDocId}`,
    );
    expect(
      preservedBindings.body.bindings.some(
        (b) => b.id === bindingRes.body.binding.id && b.nodeId === boundNodeId,
      ),
    ).toBe(true);

    // Archive synthetic binding to keep workspace quiet
    await apiJson(request, "PATCH", `/api/v1/thread-bindings/${bindingRes.body.binding.id}`, {
      data: { status: "archived" },
    });
  });

  test("4. AI Gateway Settings + Streaming Cmd+J SSE Rewrite + Outliner / & @ Parity + SplitPane Dedupe", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("v5-ai");
    const articleTitle = `AI流式改写文章-${suffix}`;

    // 1) Configure AI Gateway on /settings/rag -> saves & masks API key
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings/rag");
    await expect(page.getByText("服务端 AI 改写网关")).toBeVisible();
    await expect(page.getByText("未启用").or(page.getByText("已启用")).first()).toBeVisible();

    const aiSwitch = page.getByRole("switch", { name: "启用 AI 改写代理" });
    if ((await aiSwitch.getAttribute("aria-checked")) !== "true") {
      await aiSwitch.click();
    }
    await expect(aiSwitch).toHaveAttribute("aria-checked", "true");
    await page.getByLabel("Base URL", { exact: true }).fill("https://api.openai.com/v1");
    await page.getByLabel("模型 ID").fill("gpt-4o-mini");
    await page.getByLabel("API 密钥与采样温度").fill("sk-v5-test-secret-8899");
    const [putRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/v1/ai/settings") && r.request().method() === "PUT"),
      page.getByRole("button", { name: "保存网关配置" }).click(),
    ]);
    expect(putRes.status()).toBe(200);
    await expect(page.getByText("已启用")).toBeVisible();
    await page.reload();
    await expect(page.getByText("已启用")).toBeVisible();
    await expect(page.getByLabel("API 密钥与采样温度")).toHaveValue("");

    // 2) Mock SSE stream & verify Cmd+J streaming rewrite preview
    await page.route("**/api/v1/ai/rewrite/stream", async (route) => {
      const sseBody = [
        `data: ${JSON.stringify({ type: "delta", text: "AI 流式精炼：" })}\n\n`,
        `data: ${JSON.stringify({ type: "delta", text: "企业级清晰表达。" })}\n\n`,
        `data: ${JSON.stringify({ type: "done", fullText: "AI 流式精炼：企业级清晰表达。" })}\n\n`,
      ].join("");
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        body: sseBody,
      });
    });

    const docRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: articleTitle,
          contentMarkdown: `# ${articleTitle}\n\n这是一句等待流式 AI 重写的原始文本段落。\n`,
        },
      },
    );
    expect(docRes.status).toBe(201);

    await page.goto(`/docs/${docRes.body.document.id}`);
    const pm = page.locator(".ProseMirror");
    await expect(pm).toBeVisible();
    await pm.locator("p", { hasText: "等待流式 AI 重写" }).first().evaluate((p) => {
      const node = p.firstChild;
      if (!node) return;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(8, node.textContent?.length ?? 0));
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    await pm.dispatchEvent("mouseup");
    await page.keyboard.press(`${MOD_KEY}+j`);
    const aiMenu = page.getByTestId("editor-ade-action-menu");
    await expect(aiMenu).toBeVisible();
    await aiMenu.getByRole("button", { name: "润色表达" }).click();
    await expect(aiMenu).toContainText("AI 流式精炼：企业级清晰表达。");
    await aiMenu.getByRole("button", { name: "关闭", exact: true }).click();

    // 3) Outliner `/` & `@` parity + SplitPane excludes duplicate Daily warning
    const today = getTodayLocalDate();
    const dailyRes = await apiJson<{ document: { id: string } }>(
      request,
      "GET",
      `/api/v1/documents/daily/${today}`,
    );
    await page.goto(`/docs/${dailyRes.body.document.id}`);
    const outliner = page.locator(".inkade-pm-outliner .ProseMirror");
    await expect(outliner).toBeVisible();
    await page.getByRole("button", { name: "新建节点" }).click();
    await page.keyboard.type("/");
    await expect(page.locator("[data-inkade-ui-overlay]")).toBeVisible();
    await expect(page.locator("[data-inkade-ui-overlay]")).toContainText(/Callout|提示/);
    await page.keyboard.press("Escape");

    await page.keyboard.press("Backspace");
    await page.keyboard.type("@今天");
    await expect(page.locator("[data-inkade-ui-overlay]")).toContainText("今天");
    await page.keyboard.press("Escape");

    // Clean up AI config key after test
    await apiJson(request, "PUT", "/api/v1/ai/settings", {
      data: { enabled: false, clearApiKey: true },
    });
  });

  test("5. Phase 34 Polish: Library Empty Dailies Hiding + Inline Tags/Priority, Rich Clip Cards, Cmd+K Tab Lock & ThinkingIndicator Live Timer", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("v5-p34");
    const articleTitle = `PowerTable文档-${suffix}`;

    // Ensure an empty past Daily exists to prove /library hides empty Dailies by default
    await apiJson(request, "GET", "/api/v1/documents/daily/2026-11-01");

    const articleRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: articleTitle,
          contentMarkdown: `# ${articleTitle}\n\nPower table inline metadata editing test.`,
          pinned: true,
        },
      },
    );
    expect(articleRes.status).toBe(201);
    const articleId = articleRes.body.document.id;

    // Ingest rich clip with favicon & cover image via fixture URL
    const clipIngestRes = await apiJson<{
      document: { id: string; sourceMeta?: Record<string, unknown> | null };
    }>(request, "POST", "/api/v1/clips/ingest-url", {
      data: { url: E2E_FIXTURE_URL, tags: ["rich-clip"] },
    });
    expect(clipIngestRes.status).toBe(201);
    expect(String(clipIngestRes.body.document.sourceMeta?.faviconUrl ?? "")).toContain("favicon.png");
    expect(String(clipIngestRes.body.document.sourceMeta?.coverImageUrl ?? "")).toContain("hero.png");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/library");
    await expect(page.getByText(articleTitle).first()).toBeVisible();

    // Empty Daily 2026-11-01 hidden by default -> toggle button reveals & hides cleanly
    await expect(page.getByText("2026-11-01")).toHaveCount(0);
    const toggleEmptyBtn = page.getByTestId("library-toggle-empty-dailies");
    await expect(toggleEmptyBtn).toBeVisible();
    await toggleEmptyBtn.click();
    await expect(page.getByText("2026-11-01").first()).toBeVisible();
    await page.getByTestId("library-toggle-empty-dailies").click();
    await expect(page.getByText("2026-11-01")).toHaveCount(0);

    // Switch to Table view -> inline edit Priority + Tags Popover & verify persistence across reload
    await page.getByRole("button", { name: "属性表" }).click();
    const priorityTrigger = page.getByTestId(`library-inline-priority-${articleId}`);
    await expect(priorityTrigger).toBeVisible();
    await priorityTrigger.click();
    await page.getByRole("button", { name: "P1", exact: true }).click();
    await expect(priorityTrigger).toContainText("P1");

    const tagsTrigger = page.getByTestId(`library-inline-tags-${articleId}`);
    await tagsTrigger.click();
    await page.getByPlaceholder("新标签名，按回车添加…").fill(`inline-tag-${suffix}`);
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(tagsTrigger).toContainText(`inline-tag-${suffix}`);

    await page.reload();
    await page.getByRole("button", { name: "属性表" }).click();
    await expect(page.getByTestId(`library-inline-priority-${articleId}`)).toContainText("P1");
    await expect(page.getByTestId(`library-inline-tags-${articleId}`)).toContainText(
      `inline-tag-${suffix}`,
    );

    // Switch to Grid view -> Rich Clip renders favicon + cover thumbnail
    await page.getByRole("button", { name: "卡片墙" }).click();
    const clipCard = page
      .locator('[data-slot="card"]', { hasText: "Playwright Mock Fixture Article" })
      .first();
    await expect(clipCard).toBeVisible();
    await expect(clipCard.locator('[data-slot="clip-cover-thumbnail"]')).toBeVisible();
    await expect(clipCard.locator('[data-slot="clip-favicon"]')).toBeVisible();

    // Command Palette RemNote-style Tab Space Scope Lock + Backspace Unlock
    await page.keyboard.press(`${MOD_KEY}+k`);
    const palInput = page.getByPlaceholder("搜索文档、大纲节点，或运行快捷命令…");
    await palInput.fill("Research");
    await palInput.press("Tab");
    const lockPill = page.getByTestId("command-scope-lock-pill");
    await expect(lockPill).toBeVisible();
    await expect(lockPill).toContainText("Research");
    await palInput.press("Backspace");
    await expect(lockPill).toHaveCount(0);
    await page.keyboard.press("Escape");

    // ThinkingIndicator live server timer using runningSince >= 75s ago
    const runningSinceIso = new Date(Date.now() - 75_000).toISOString();
    const timerBinding = await apiJson<{ binding: { id: string } }>(
      request,
      "POST",
      "/api/v1/thread-bindings",
      {
        data: {
          documentId: articleId,
          adeKind: "bb",
          externalThreadId: `ext-timer-${suffix}`,
          title: `Live Timer Agent ${suffix}`,
          status: "running",
          runningSince: runningSinceIso,
        },
      },
    );
    expect(timerBinding.status).toBe(201);

    await page.goto("/threads");
    const timerEl = page.locator('[data-slot="thinking-indicator-timer"]').first();
    await expect(timerEl).toBeVisible();
    await expect(timerEl).toHaveText(/^01:1[4-9]|01:2[0-9]/);

    await apiJson(request, "PATCH", `/api/v1/thread-bindings/${timerBinding.body.binding.id}`, {
      data: { status: "completed" },
    });
  });

  test("6. Blind Spots: ApprovalCard, InlineTrackChangesViewer, PublicShare, Scope Guard, FocusRail Amie & Mobile 390x844", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("v5-bs");
    const docTitle = `盲区闭环验证-${suffix}`;

    const docRes = await apiJson<{ document: { id: string; version: number } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: docTitle,
          contentMarkdown: `# ${docTitle}\n\n第一行原始内容。\n\n第二行原始内容。\n`,
        },
      },
    );
    expect(docRes.status).toBe(201);
    const docId = docRes.body.document.id;

    // 1) Scoped read-only token blocked by server on Tasks write & AI settings admin write (403)
    const roTokenRes = await apiJson<{ rawToken: string }>(request, "POST", "/api/v1/tokens", {
      data: {
        name: `ro-scope-${suffix}`,
        scope: { permission: "read", spaceIds: ["spc_research"], denyHardDelete: true },
      },
    });
    expect(roTokenRes.status).toBe(201);

    const deniedTask = await apiJson(request, "POST", "/api/v1/outline-nodes/tasks", {
      token: roTokenRes.body.rawToken,
      data: { title: "Should Be Blocked", documentId: docId },
    });
    expect(deniedTask.status).toBe(403);

    const deniedAi = await apiJson(request, "PUT", "/api/v1/ai/settings", {
      token: roTokenRes.body.rawToken,
      data: { enabled: true },
    });
    expect(deniedAi.status).toBe(403);

    // 2) Scoped write token creates Agent revision + ApprovalCard binding for /inbox closure
    const wrTokenRes = await apiJson<{ rawToken: string }>(request, "POST", "/api/v1/tokens", {
      data: {
        name: `wr-scope-${suffix}`,
        scope: { permission: "write", spaceIds: ["spc_research"], denyHardDelete: true },
      },
    });
    expect(wrTokenRes.status).toBe(201);

    await apiJson(request, "PATCH", `/api/v1/documents/${docId}`, {
      token: wrTokenRes.body.rawToken,
      data: {
        contentMarkdown: `# ${docTitle}\n\n第一行被 Agent 优化。\n\n第二行被 Agent 改写。\n`,
        expectedVersion: docRes.body.document.version,
        changeSummary: `Agent multi-hunk update ${suffix}`,
      },
    });

    const apprBinding = await apiJson<{ binding: { id: string } }>(
      request,
      "POST",
      "/api/v1/thread-bindings",
      {
        data: {
          documentId: docId,
          adeKind: "paseo",
          externalThreadId: `ext-appr-${suffix}`,
          title: `审批闭环-${suffix}`,
          status: "waiting_input",
          pendingApproval: {
            id: `apr-${suffix}`,
            action: `写入生产配置-${suffix}`,
            risk: "medium",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          },
        },
      },
    );
    expect(apprBinding.status).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/inbox");
    const apprRow = page
      .locator('button[data-inbox-kind="blocking_question"]', { hasText: `写入生产配置-${suffix}` })
      .first();
    await expect(apprRow).toBeVisible();
    await apprRow.click();
    const apprCard = page.locator('[data-slot="approval-card"]').first();
    await expect(apprCard).toBeVisible();
    await apprCard.getByRole("button", { name: /批准/ }).click();
    await expect(apprCard).toContainText("已批准并继续执行");

    // Non-empty InlineTrackChangesViewer per-hunk accept/reject + Apply
    await page.goto(`/docs/${docId}`);
    await page.getByRole("button", { name: "阅读批注" }).click();
    await page.getByRole("button", { name: "查看改动" }).click();
    const inlineDiff = page.locator('[data-slot="inline-track-changes-viewer"]');
    await expect(inlineDiff).toBeVisible();
    const hunks = inlineDiff.locator('[data-hunk-id]');
    expect(await hunks.count()).toBeGreaterThanOrEqual(1);
    await inlineDiff.getByRole("button", { name: "全部采纳" }).click();
    await inlineDiff.getByRole("button", { name: "应用审阅结果" }).click();
    await expect(inlineDiff).toHaveCount(0);

    // 3) PublicSharePage read-only snapshot route
    const shareRes = await apiJson<{ shareLink: { token: string } }>(
      request,
      "POST",
      "/api/v1/share-links",
      { data: { documentId: docId } },
    );
    expect(shareRes.status).toBe(201);
    await page.goto(`/share/${shareRes.body.shareLink.token}`);
    await expect(page.getByText("只读公开快照")).toBeVisible();
    await expect(page.getByRole("heading", { name: docTitle })).toBeVisible();

    // 4) Daily Focus Rail Amie scheduling & IME guard
    const today = getTodayLocalDate();
    const focusTaskTitle = `Focus时间块任务-${suffix}`;
    await apiJson(request, "POST", "/api/v1/outline-nodes/tasks", {
      data: { title: focusTaskTitle, scheduledDate: today },
    });
    await page.goto("/daily");
    const dailyProse = page.locator(".inkade-pm-outliner .ProseMirror");
    await expect(dailyProse).toBeVisible();

    // IME composition guard on /daily prevents accidental node split
    const beforeImeNodes = await dailyProse.locator("[data-outline-item]").count();
    await dailyProse.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "ceshi" }));
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
      el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
    });
    expect(await dailyProse.locator("[data-outline-item]").count()).toBe(beforeImeNodes);

    await page.getByRole("button", { name: "展开 / 收起今日焦点面板" }).click();
    const rail = page.getByTestId("daily-focus-rail");
    await expect(rail).toBeVisible();
    const row = rail.locator("div.group", { hasText: focusTaskTitle }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "安排日程时段与时长" }).click({ force: true });
    await page.getByRole("button", { name: "上午", exact: true }).click();
    await expect(rail).toContainText("上午");

    // 5) Mobile 390x844 responsive chrome across all V5 workspaces with zero overflow
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileChecks = [
      ["/daily", page.locator(".inkade-pm-outliner")],
      ["/tasks", page.getByRole("heading", { name: "全局待办中心" })],
      ["/library", page.getByRole("heading", { name: "Library" })],
      ["/inbox", page.locator('nav[aria-label="当前位置面包屑"]', { hasText: "Inbox" })],
      ["/threads", page.locator('nav[aria-label="当前位置面包屑"]', { hasText: "Threads" })],
    ] as const;
    for (const [route, readyLoc] of mobileChecks) {
      await page.goto(route);
      await expect(readyLoc.first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `Mobile overflow detected on ${route}`).toBeLessThanOrEqual(1);
    }

    await apiJson(request, "PATCH", `/api/v1/thread-bindings/${apprBinding.body.binding.id}`, {
      data: { status: "archived" },
    });
  });
});
