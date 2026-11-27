import { apiJson, expect, MOD_KEY, test, uniqueSuffix } from "./fixtures.ts";

test.describe("Enterprise Modeless Article Editor, Rich Blocks, Inline Title & Agent Diff", () => {
  test("Modeless direct editing, seamless inline title, categorized Slash menu, Table/Mermaid/Math/Toggle roundtrip, Floating BubbleMenu, Cmd+J ADE dispatch, Agent Diff, and Split Pane", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("ed");
    const mainTitle = `企业级编辑器测试-${suffix}`;
    const updatedTitle = `原地编辑新标题-${suffix}`;
    const refTitle = `分屏参考文档-${suffix}`;

    const refDoc = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: refTitle,
          contentMarkdown: `# ${refTitle}\n\n这是右侧分屏对照的参考资料段落。\n`,
          tags: ["ref"],
        },
      },
    );
    expect(refDoc.status).toBe(201);

    const mainDoc = await apiJson<{ document: { id: string; version: number } }>(
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
            "## Executive Summary",
            "",
            "这里是一段用于选中测试的原始正文内容。",
            "",
            "block-slot-1",
            "",
            "block-slot-2",
            "",
            "block-slot-3",
            "",
            "block-slot-4",
            "",
            "block-slot-5",
            "",
          ].join("\n"),
          tags: ["editor"],
        },
      },
    );
    expect(mainDoc.status).toBe(201);
    const mainDocId = mainDoc.body.document.id;

    await page.goto(`/docs/${mainDocId}`);

    // 1. Modeless entry: ProseMirror canvas is IMMEDIATELY editable without clicking an Edit button,
    // and duplicate leading H1 is stripped cleanly.
    const titleHeading = page.getByTestId("document-inline-title");
    await expect(titleHeading).toBeVisible();
    await expect(titleHeading).toHaveText(mainTitle);

    const pm = page.locator(".ProseMirror");
    await expect(pm).toBeVisible();
    await expect(pm.locator("h1")).toHaveCount(0);

    // 2. Seamless inline title editing (no button-to-input jump, Enter focuses body directly)
    await titleHeading.click();
    await page.keyboard.press(`${MOD_KEY}+a`);
    await page.keyboard.type(updatedTitle);
    const titleSaveResp = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/documents/${mainDocId}`) && res.request().method() === "PATCH",
    );
    await page.keyboard.press("Enter");
    expect((await titleSaveResp).status()).toBe(200);
    await expect(page.getByRole("heading", { name: updatedTitle })).toBeVisible();

    // 3. Categorized Slash menu (full catalog visible without 10-item truncation)
    await pm.locator("p", { hasText: "block-slot-1" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /callout");
    await expect(page.getByTestId("editor-trigger-menu")).toBeVisible();
    await page.getByRole("button", { name: /Callout · 注解/ }).click();
    await expect(pm.locator(".inkade-callout")).toBeVisible();

    // Insert Toggle via /toggle
    await pm.locator("p", { hasText: "block-slot-2" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /toggle");
    await page.getByRole("button", { name: /Toggle 折叠块/ }).click();
    await expect(pm.locator(".inkade-editor-toggle")).toBeVisible();
    await pm
      .locator('.inkade-editor-toggle input[placeholder="折叠标题…"]')
      .fill("折叠架构说明");

    // Insert KaTeX block via /math
    await pm.locator("p", { hasText: "block-slot-3" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /math");
    await page.getByRole("button", { name: /KaTeX 公式块/ }).click();
    await expect(pm.locator('[data-type="inkade-math-block"]')).toBeVisible();

    // Insert Mermaid block via /mermaid -> renders live SVG preview right inside editor!
    await pm.locator("p", { hasText: "block-slot-4" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /mermaid");
    await page.getByRole("button", { name: /Mermaid 图表/ }).click();
    await expect(pm.locator('[data-type="inkade-code-block"][data-language="mermaid"]')).toBeVisible();

    // Insert Table via /table -> floating table toolbar appears when cursor is inside cell
    await pm.locator("p", { hasText: "block-slot-5" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /table");
    await page.getByRole("button", { name: /^表格/ }).click();
    await expect(pm.locator("table")).toBeVisible();
    await expect(page.getByTestId("editor-table-toolbar")).toBeVisible();

    // 4. Selection Floating BubbleMenu + static toolbar toggle + Cmd+J honest ADE dispatch menu
    await pm.locator("p", { hasText: "用于选中测试的原始正文内容" }).first().evaluate((p) => {
      const textNode = p.firstChild;
      if (!textNode) throw new Error("No text node in paragraph");
      const text = textNode.textContent ?? "";
      const start = text.indexOf("选中测试");
      const range = document.createRange();
      range.setStart(textNode, Math.max(0, start));
      range.setEnd(textNode, Math.max(4, start + 4));
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    await pm.dispatchEvent("mouseup");

    await expect(page.getByTestId("editor-bubble-menu")).toBeVisible();
    await expect(page.getByRole("button", { name: "加粗" })).toHaveCount(1);
    await page.getByRole("button", { name: "切换格式工具栏" }).click();
    await expect(page.getByTestId("editor-static-toolbar")).toBeVisible();
    await expect(page.getByRole("button", { name: "加粗" })).toHaveCount(2);

    // Open Cmd+J honest ADE dispatch menu
    await page.keyboard.press(`${MOD_KEY}+j`);
    const adeMenu = page.getByTestId("editor-ade-action-menu");
    await expect(adeMenu).toBeVisible();
    await expect(adeMenu.getByRole("button", { name: "润色表达" })).toBeVisible();
    await adeMenu.getByRole("button", { name: "关闭", exact: true }).click();

    // Save explicitly via Cmd+S and reload to verify 100% lossless roundtrip!
    const savePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/documents/${mainDocId}`) && res.request().method() === "PATCH",
    );
    await pm.locator("p", { hasText: "block-slot-1" }).click();
    await page.keyboard.press(`${MOD_KEY}+s`);
    expect((await savePromise).status()).toBe(200);
    await expect(page.getByText(/已(?:自动)?保存/).first()).toBeVisible();

    // Reload and prove inline title + Toggle + Callout + Math + Mermaid + Table all survived losslessly!
    await page.reload();
    await expect(page.getByRole("heading", { name: updatedTitle })).toBeVisible();
    await expect(pm.locator(".inkade-callout")).toBeVisible();
    await expect(pm.locator(".inkade-editor-toggle")).toBeVisible();
    await expect(
      pm.locator('.inkade-editor-toggle input[placeholder="折叠标题…"]'),
    ).toHaveValue("折叠架构说明");
    await expect(pm.locator('[data-type="inkade-math-block"]')).toBeVisible();
    await expect(pm.locator('[data-type="inkade-code-block"][data-language="mermaid"]')).toBeVisible();
    await expect(pm.locator("table")).toBeVisible();

    // 5. Agent-authored revision via Scoped Agent Token + /mcp patch_document_section
    const tokenRes = await apiJson<{ rawToken: string }>(request, "POST", "/api/v1/tokens", {
      data: {
        name: `diff-agent-${suffix}`,
        scope: {
          permission: "write",
          spaceIds: ["spc_research"],
          includeDescendants: true,
          denyHardDelete: true,
        },
      },
    });
    expect(tokenRes.status).toBe(201);
    const agentToken = tokenRes.body.rawToken;

    const latestDoc = await apiJson<{ document: { version: number } }>(
      request,
      "GET",
      `/api/v1/documents/${mainDocId}`,
    );
    expect(latestDoc.status).toBe(200);

    const mcpInit = await request.fetch("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "pw-e2e", version: "1.0.0" },
        },
      },
    });
    expect(mcpInit.status()).toBe(200);

    const mcpPatch = await request.fetch("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      data: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "patch_document_section",
          arguments: {
            documentId: mainDocId,
            headingPath: "Executive Summary",
            mode: "replace",
            markdown: "这是 Agent 改写后的总结内容，延迟降低至 12ms。",
            expectedVersion: latestDoc.body.document.version,
            changeSummary: "Agent 优化了摘要并补充 12ms 基准结论",
          },
        },
      },
    });
    expect(mcpPatch.status()).toBe(200);

    // Reload to inspect Agent quiet revision banner + Inline Track Changes + Hunk Diff (visible directly in modeless mode!)
    await page.reload();
    await expect(page.getByText(/Agent 已静默更新至/)).toBeVisible();
    await page.getByRole("button", { name: "查看改动" }).click();

    const inlineViewer = page.locator('[data-slot="inline-track-changes-viewer"]');
    await expect(inlineViewer).toBeVisible();
    await expect(inlineViewer).toContainText("Agent 优化了摘要并补充 12ms 基准结论");
    await expect(inlineViewer.locator("ins.inkade-suggestion-ins").first()).toBeVisible();
    await expect(inlineViewer.locator("del.inkade-suggestion-del").first()).toBeVisible();

    const firstHunk = inlineViewer.locator('[data-hunk-id="hunk-1"]');
    await firstHunk.getByRole("button", { name: "采纳" }).click();
    await expect(firstHunk).toHaveAttribute("data-hunk-decision", "accepted");
    await firstHunk.getByRole("button", { name: "驳回" }).click();
    await expect(firstHunk).toHaveAttribute("data-hunk-decision", "rejected");

    // Switch to Unified / Split Code Diff view
    await inlineViewer.getByRole("button", { name: "源码 Diff" }).click();
    await expect(page.getByRole("button", { name: "统一视图" })).toBeVisible();
    await expect(page.getByRole("button", { name: "分栏对比" })).toBeVisible();

    await page.getByRole("button", { name: "分栏对比" }).click();
    await expect(page.locator("table.table-fixed")).toBeVisible();
    await page.getByRole("button", { name: "收起对比" }).click();

    // 6. Desktop Split Pane side-by-side view
    await page.getByRole("button", { name: "更多文档操作" }).click();
    await page.getByRole("menuitem", { name: "分屏对照" }).click();
    const splitAside = page.locator("aside").filter({ hasText: "今日大纲" });
    await expect(splitAside).toBeVisible();

    await splitAside.getByRole("combobox").click();
    await page.getByRole("option", { name: refTitle }).click();
    await expect(splitAside).toContainText("这是右侧分屏对照的参考资料段落");
  });
});
