import { apiJson, expect, MOD_KEY, test, uniqueSuffix } from "./fixtures.ts";

test.describe("Search, Wikilinks, Highlights, Local Graph & Public Share", () => {
  test("Chinese 1/2/3+ char FTS5 search, super filters, wikilink hover/click, highlights, graph, and share page", async ({
    page,
    request,
    browser,
  }) => {
    const suffix = uniqueSuffix("slg");
    const targetTitle = `图谱目标文章-${suffix}`;
    const sourceTitle = `龙猫增量索引测试-${suffix}`;
    const highlightQuote = `用于持久高亮和页边批注验证的核心段落-${suffix}`;
    const marginaliaNote = `E2E页边批注内容-${suffix}`;

    const targetRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: targetTitle,
          contentMarkdown: `# ${targetTitle}\n\n这里记录了图谱节点的目标正文摘要。`,
          tags: ["graph", "spec"],
        },
      },
    );
    expect(targetRes.status).toBe(201);
    const targetDocId = targetRes.body.document.id;

    const sourceRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: sourceTitle,
          contentMarkdown: [
            `# ${sourceTitle}`,
            "",
            `龙猫系统在增量索引与 [[${targetTitle}]] 之间保持毫秒级一致性。`,
            "",
            highlightQuote,
          ].join("\n"),
          tags: ["research", "graph"],
        },
      },
    );
    expect(sourceRes.status).toBe(201);
    const sourceDocId = sourceRes.body.document.id;

    await page.goto("/daily");
    await expect(page.getByRole("button", { name: /搜索或运行命令/ })).toBeVisible();

    // 1. Open Super Command Palette (⌘K) and verify Chinese 1, 2, and 3+ char FTS5 search
    await page.keyboard.press(`${MOD_KEY}+k`);
    const cmdInput = page.getByPlaceholder("搜索文档、大纲节点，或运行快捷命令…");
    await expect(cmdInput).toBeVisible();

    // 1-char Chinese search ("龙")
    await cmdInput.fill("龙");
    await expect(page.getByRole("option", { name: new RegExp(sourceTitle) }).first()).toBeVisible();

    // 2-char Chinese search ("龙猫")
    await cmdInput.fill("龙猫");
    await expect(page.getByRole("option", { name: new RegExp(sourceTitle) }).first()).toBeVisible();

    // 3+-char Chinese search ("增量索引")
    await cmdInput.fill("增量索引");
    await expect(page.getByRole("option", { name: new RegExp(sourceTitle) }).first()).toBeVisible();

    // Super filter syntax: #tag + space: + kind:
    await cmdInput.fill("#research space:research kind:article 龙猫");
    await expect(page.getByText("#research", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("space:Research", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("kind:article", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("option", { name: new RegExp(sourceTitle) }).first()).toBeVisible();

    // Natural date jump
    await cmdInput.fill("today");
    await expect(page.getByText(/跳转每日大纲：/)).toBeVisible();
    await page.keyboard.press("Escape");

    // 2. Navigate to source article, verify wikilink Hover PreviewCard & click navigation
    await page.goto(`/docs/${sourceDocId}`);
    await expect(page.getByRole("heading", { name: sourceTitle })).toBeVisible();

    const wikilinkBtn = page.locator(".inkade-prose button", { hasText: targetTitle }).first();
    await expect(wikilinkBtn).toBeVisible();
    await wikilinkBtn.hover();
    const previewCard = page.locator('[data-slot="preview-card-content"]');
    await expect(previewCard).toBeVisible();
    await expect(previewCard).toContainText(targetTitle);

    await wikilinkBtn.click();
    await expect(page).toHaveURL(new RegExp(`/docs/${targetDocId}`));
    await expect(page.getByRole("heading", { name: targetTitle })).toBeVisible();

    // 3. Navigate back to source article, create persistent highlight + Marginalia note
    await page.goto(`/docs/${sourceDocId}`);
    await expect(page.locator(".inkade-prose")).toContainText(highlightQuote);

    // Ensure Inspector is closed so Marginalia right rail renders on 1360px wide viewport
    const inspectorClose = page.getByRole("button", { name: "关闭 Inspector" });
    if (await inspectorClose.isVisible()) {
      await inspectorClose.click();
    }

    await page.locator(".inkade-prose").evaluate((container, quoteText) => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? "";
        const idx = text.indexOf(quoteText);
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + quoteText.length);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return;
        }
      }
      throw new Error("Could not locate highlight quote text node");
    }, highlightQuote);

    await page.getByRole("button", { name: "添加批注" }).click();
    await page.getByPlaceholder("写下边注思考（支持 Markdown）…").fill(marginaliaNote);
    await page.getByRole("button", { name: "保存批注" }).click();

    await expect(page.locator("mark[data-highlight-id]").first()).toBeVisible();
    await expect(page.getByText(marginaliaNote).first()).toBeVisible();

    // Reload to prove highlight + Marginalia persist in SQLite
    await page.reload();
    await expect(page.locator("mark[data-highlight-id]").first()).toBeVisible();
    await expect(page.getByText(marginaliaNote).first()).toBeVisible();

    // 4. Open Inspector -> Backlinks -> Local Graph SVG
    await page.getByRole("button", { name: "切换右侧上下文 Inspector" }).click();
    await page.getByRole("tab", { name: "双链" }).click();
    await page.getByRole("button", { name: "局部图谱" }).click();

    const graphPanel = page.locator("svg").filter({ hasText: sourceTitle.slice(0, 12) }).first();
    await expect(graphPanel).toBeVisible();
    await expect(graphPanel.locator("circle").first()).toBeVisible();
    expect(await graphPanel.locator("line").count()).toBeGreaterThanOrEqual(1);
    await expect(graphPanel).toContainText(targetTitle.slice(0, 12));

    // 5. Create Public Share Link and verify in a clean unauthenticated browser context
    await page.getByRole("button", { name: /只读分享链接/ }).click();
    await page.getByRole("button", { name: "创建分享链接" }).click();

    const openShareLink = page.locator('a[href*="/share/"]').first();
    await expect(openShareLink).toBeVisible();
    const shareHref = await openShareLink.getAttribute("href");
    expect(shareHref).toBeTruthy();

    const shareContext = await browser.newContext({ locale: "zh-CN" });
    const sharePage = await shareContext.newPage();
    try {
      await sharePage.goto(shareHref!);
      await expect(sharePage.getByText("公开只读分享")).toBeVisible();
      await expect(sharePage.getByRole("heading", { name: sourceTitle })).toBeVisible();
      await expect(sharePage.locator(".inkade-prose")).toContainText("龙猫系统在增量索引");
    } finally {
      await shareContext.close();
    }
  });
});
