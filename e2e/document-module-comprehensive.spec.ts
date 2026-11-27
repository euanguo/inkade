import { apiJson, expect, MOD_KEY, test, uniqueSuffix } from "./fixtures.ts";

test.describe("Document Module Comprehensive Audit & Responsive Contracts", () => {
  test("1. Desktop Outliner: non-occluding left-gutter handle menu, right-click menu & unclipped 1px inset highlight", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("out");
    const targetTitle = `双链参照文档-${suffix}`;
    const outlineTitle = `大纲完整度测试-${suffix}`;

    const targetRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: targetTitle,
          contentMarkdown: `# ${targetTitle}\n\n被大纲行双链引用的目标文章。\n`,
        },
      },
    );
    expect(targetRes.status).toBe(201);

    const outlineRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "outline",
          title: outlineTitle,
        },
      },
    );
    expect(outlineRes.status).toBe(201);
    const outlineId = outlineRes.body.document.id;

    await apiJson(request, "POST", "/api/v1/outline-nodes", {
      data: {
        documentId: outlineId,
        contentMarkdown: `审阅 [[${targetTitle}]] 并检查行尾绝无浮动遮挡与首尾高亮完整边框`,
      },
    });
    await apiJson(request, "POST", "/api/v1/outline-nodes", {
      data: {
        documentId: outlineId,
        contentMarkdown: `第二条待拖拽排序节点-${suffix}`,
      },
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/docs/${outlineId}`);

    const outliner = page.locator(".inkade-pm-outliner");
    await expect(outliner).toBeVisible();
    await expect(outliner.locator(".inkade-pm-actions")).toHaveCount(0);

    const row = outliner.locator("[data-outline-item]", { hasText: targetTitle }).first();
    await expect(row).toBeVisible();
    await row.hover();

    // Handle sits cleanly on left gutter without overlapping row wikilink text
    const handle = row.locator('[data-outline-handle="true"]');
    await expect(handle).toBeVisible();
    const wikilinkEl = row.getByText(targetTitle).first();
    const [handleBox, wikiBox] = await Promise.all([
      handle.boundingBox(),
      wikilinkEl.boundingBox(),
    ]);
    expect(handleBox).not.toBeNull();
    expect(wikiBox).not.toBeNull();
    if (handleBox && wikiBox) {
      expect(handleBox.x + handleBox.width).toBeLessThanOrEqual(wikiBox.x + 2);
    }

    // Left-gutter handle click opens unified menu
    await handle.click();
    const nodeMenu = page.locator('[data-inkade-node-menu="true"]');
    await expect(nodeMenu).toBeVisible();
    await nodeMenu.getByRole("menuitem", { name: /切换待办/ }).click();
    await expect(row).toHaveAttribute("data-checked", "false");

    // Right-click on handle also opens unified node menu, Escape closes
    await handle.click({ button: "right" });
    await expect(nodeMenu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nodeMenu).toHaveCount(0);

    // Focus/highlight box renders unclipped inside .inkade-pm-outliner
    await row.locator("[data-outline-paragraph]").click();
    await expect(row).toHaveAttribute("data-focused", "true");
    const [outlinerBox, rowBox] = await Promise.all([
      outliner.boundingBox(),
      row.boundingBox(),
    ]);
    expect(outlinerBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    if (outlinerBox && rowBox) {
      expect(rowBox.x).toBeGreaterThanOrEqual(outlinerBox.x);
      expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(outlinerBox.x + outlinerBox.width + 0.5);
    }

    // Dragging left-gutter handle reorders items cleanly without triggering click menu
    await row.hover();
    const row2 = outliner.locator("[data-outline-item]", { hasText: `第二条待拖拽排序节点-${suffix}` }).first();
    const [dragHandleBox, row2Box] = await Promise.all([handle.boundingBox(), row2.boundingBox()]);
    expect(dragHandleBox).not.toBeNull();
    expect(row2Box).not.toBeNull();
    if (dragHandleBox && row2Box) {
      await page.mouse.move(dragHandleBox.x + dragHandleBox.width / 2, dragHandleBox.y + dragHandleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(row2Box.x + 40, row2Box.y + row2Box.height - 4, { steps: 10 });
      await expect(nodeMenu).toHaveCount(0);
      await page.mouse.up();
      await expect(outliner.locator("[data-outline-paragraph]").first()).toContainText(
        `第二条待拖拽排序节点-${suffix}`,
      );
    }
  });

  test("2. Desktop Rich Article Editor: Callout title, Mermaid split default, Currency guard, Highlight & Source roundtrip", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("rich");
    const docTitle = `富文本综合回归-${suffix}`;

    const createRes = await apiJson<{ document: { id: string } }>(
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
            "> [!TIP] 性能调优提示",
            "> 第一段正文说明。",
            ">",
            "> 第二段正文说明。",
            "",
            "<details open>",
            "<summary>核心折叠摘要</summary>",
            "",
            "折叠内部内容。",
            "",
            "</details>",
            "",
            "<!-- inkade:image width=md align=left -->",
            "![ArchitectureDiagram](https://placehold.co/640x320/png)",
            "",
            "预算区间为 $5 to $10，公式为 $E=mc^2$，别名引用 [[设计基线|架构别名]]。",
            "",
            "请选择这段文字验证高亮与气泡工具栏能力。",
            "",
            "| Mode | Purpose | Guarantee |",
            "| --- | --- | --- |",
            "| Daily Outline | Rapid capture | Stable nodeId |",
            "| Research Articles | Long-form specs | Full revision diffs |",
            "",
            "待拖拽测试段落一。",
            "",
            "待拖拽测试段落二。",
            "",
            "## Next Steps",
            "",
            "- Open [[设计基线]] to verify bullet marker clearance",
            "",
            "> 普通引用块拖拽选区回归验证。",
            "",
            "---",
            "",
            "mermaid-insert-slot",
            "",
          ].join("\n"),
        },
      },
    );
    expect(createRes.status).toBe(201);
    const docId = createRes.body.document.id;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/docs/${docId}`);

    const pm = page.locator(".ProseMirror");
    await expect(pm).toBeVisible();
    await expect(pm.locator(".inkade-callout")).toContainText("性能调优提示");
    await expect(pm.locator('[data-type="inkade-inline-math"]')).toHaveCount(1);
    await expect(pm).toContainText("$5 to $10");
    await expect(pm).toContainText("架构别名");

    // Insert /mermaid and assert new empty Mermaid block opens in Split mode (visible editable <pre>)
    await pm.locator("p", { hasText: "mermaid-insert-slot" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /mermaid");
    await page.getByRole("button", { name: /Mermaid 图表/ }).click();
    const mermaidCard = pm.locator('[data-type="inkade-code-block"][data-language="mermaid"]').first();
    await expect(mermaidCard).toBeVisible();
    await expect(mermaidCard.locator("svg").first()).toBeVisible();
    await mermaidCard.getByRole("button", { name: "分栏" }).click();
    await expect(mermaidCard.locator("pre")).toBeVisible();

    // Select prose and create a canonical highlight (without injecting <mark> HTML into Markdown source)
    await pm.locator("p", { hasText: "请选择这段文字验证高亮与气泡工具栏能力" }).evaluate((p) => {
      const node = p.firstChild;
      if (!node) throw new Error("Missing text node");
      const text = node.textContent ?? "";
      const idx = text.indexOf("高亮与气泡");
      const range = document.createRange();
      range.setStart(node, Math.max(0, idx));
      range.setEnd(node, Math.max(5, idx + 5));
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    await pm.dispatchEvent("mouseup");

    const bubbleMenu = page.getByTestId("editor-bubble-menu");
    await expect(bubbleMenu).toBeVisible();
    await bubbleMenu.getByRole("button", { name: "高亮" }).click();
    const highlightPanel = page.locator('[data-slot="editor-bubble-highlight-panel"]');
    await expect(highlightPanel).toBeVisible();
    await highlightPanel.getByRole("button", { name: "琥珀高亮" }).click();
    await expect(pm.locator("mark[data-highlight-id]").first()).toBeVisible();

    // Table column-resize hover must show resize handle without spawning vertical/horizontal scrollbars
    const secondHeader = pm.locator("table th").nth(1);
    await secondHeader.scrollIntoViewIfNeeded();
    const headerBox = await secondHeader.boundingBox();
    expect(headerBox).not.toBeNull();
    if (headerBox) {
      await page.mouse.move(headerBox.x + headerBox.width - 1, headerBox.y + headerBox.height / 2);
      await expect(pm.locator(".column-resize-handle").first()).toBeVisible();
      const scrollMetrics = await pm.locator(".tableWrapper").first().evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(scrollMetrics.scrollHeight).toBeLessThanOrEqual(scrollMetrics.clientHeight);
      expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth + 1);
    }

    // Hovering table row 2 anchors handle at outer table top and remains visible when moving pointer onto grip
    const dragHandleHost = page.locator(".inkade-drag-handle");
    const grip = page.locator('[data-drag-handle-grip="true"]');
    const row2FirstCell = pm.locator("table tbody tr").nth(1).locator("td").first();
    await row2FirstCell.scrollIntoViewIfNeeded();
    const [cell2Box, tableWrapBox] = await Promise.all([
      row2FirstCell.boundingBox(),
      pm.locator(".tableWrapper").first().boundingBox(),
    ]);
    expect(cell2Box).not.toBeNull();
    expect(tableWrapBox).not.toBeNull();
    if (cell2Box && tableWrapBox) {
      await page.mouse.move(cell2Box.x + 24, cell2Box.y + cell2Box.height / 2);
      await expect(dragHandleHost).toHaveAttribute("data-target-kind", "table");
      await page.waitForFunction(() => {
        const r = document.querySelector('[data-drag-handle-grip="true"]')?.getBoundingClientRect();
        return Boolean(r && r.left > 0 && r.width > 0);
      });
      const tableHandleBox = await dragHandleHost.boundingBox();
      expect(tableHandleBox).not.toBeNull();
      if (tableHandleBox) {
        expect(Math.abs(tableHandleBox.y - tableWrapBox.y)).toBeLessThanOrEqual(16);
      }
      const tableGripBox = await grip.boundingBox();
      expect(tableGripBox).not.toBeNull();
      if (tableGripBox) {
        await page.mouse.move(
          tableGripBox.x + tableGripBox.width / 2,
          tableGripBox.y + tableGripBox.height / 2,
          { steps: 6 },
        );
        await expect(grip).toBeVisible();
      }
    }

    // Hovering bulleted list item places grip cleanly left of the `•` bullet marker
    const listItem = pm.locator("ul > li").first();
    await listItem.scrollIntoViewIfNeeded();
    const liBox = await listItem.boundingBox();
    expect(liBox).not.toBeNull();
    if (liBox) {
      await page.mouse.move(liBox.x + 28, liBox.y + liBox.height / 2);
      await expect(dragHandleHost).toHaveAttribute("data-target-kind", "listItem");
      await page.waitForTimeout(120);
      const liGripBox = await grip.boundingBox();
      expect(liGripBox).not.toBeNull();
      if (liGripBox) {
        expect(liGripBox.x + liGripBox.width).toBeLessThanOrEqual(liBox.x - 16);
      }
    }

    // Sidebar TOC active item preserves primary highlight color on pointer hover
    await page.getByRole("button", { name: "文档大纲" }).click();
    const sidebarTocBtn = page
      .locator("aside nav button")
      .filter({ hasText: "Next Steps" })
      .first();
    await expect(sidebarTocBtn).toBeVisible();
    await sidebarTocBtn.click();
    await expect(sidebarTocBtn).toHaveClass(/text-primary/);
    const activeTocColorBefore = await sidebarTocBtn.evaluate((el) => getComputedStyle(el).color);
    await sidebarTocBtn.hover();
    const activeTocColorAfter = await sidebarTocBtn.evaluate((el) => getComputedStyle(el).color);
    expect(activeTocColorAfter).toBe(activeTocColorBefore);
    await page.getByRole("button", { name: "空间树" }).click();

    // H2 selectednode hides bottom divider border and centers optical highlight frame
    const nextStepsH2 = pm.locator("h2", { hasText: "Next Steps" }).first();
    await nextStepsH2.scrollIntoViewIfNeeded();
    const h2SelectionStyle = await nextStepsH2.evaluate((el) => {
      el.classList.add("ProseMirror-selectednode");
      const base = getComputedStyle(el);
      const before = getComputedStyle(el, "::before");
      const result = {
        borderBottomColor: base.borderBottomColor,
        beforeBorderWidth: before.borderTopWidth,
        beforeContent: before.content,
      };
      el.classList.remove("ProseMirror-selectednode");
      return result;
    });
    expect(h2SelectionStyle.borderBottomColor).toBe("rgba(0, 0, 0, 0)");
    expect(h2SelectionStyle.beforeBorderWidth).toBe("1px");
    expect(h2SelectionStyle.beforeContent).not.toBe("none");

    // Blockquote and HR selectednode must keep straight element corners (no curved left bar) while rendering ::before halo
    const sampleQuote = pm.locator("blockquote", { hasText: "普通引用块拖拽选区回归验证" }).first();
    await sampleQuote.scrollIntoViewIfNeeded();
    const quoteSelectionStyle = await sampleQuote.evaluate((el) => {
      el.classList.add("ProseMirror-selectednode");
      const base = getComputedStyle(el);
      const before = getComputedStyle(el, "::before");
      const result = {
        borderTopLeftRadius: base.borderTopLeftRadius,
        borderBottomLeftRadius: base.borderBottomLeftRadius,
        borderLeftWidth: base.borderLeftWidth,
        beforeBorderWidth: before.borderTopWidth,
        beforeBorderRadius: before.borderTopLeftRadius,
      };
      el.classList.remove("ProseMirror-selectednode");
      return result;
    });
    expect(quoteSelectionStyle.borderTopLeftRadius).toBe("0px");
    expect(quoteSelectionStyle.borderBottomLeftRadius).toBe("0px");
    expect(quoteSelectionStyle.borderLeftWidth).toBe("2px");
    expect(quoteSelectionStyle.beforeBorderWidth).toBe("1px");
    expect(quoteSelectionStyle.beforeBorderRadius).not.toBe("0px");

    const sampleHr = pm.locator("hr").first();
    await sampleHr.scrollIntoViewIfNeeded();
    const hrSelectionStyle = await sampleHr.evaluate((el) => {
      el.classList.add("ProseMirror-selectednode");
      const base = getComputedStyle(el);
      const before = getComputedStyle(el, "::before");
      const result = {
        borderTopLeftRadius: base.borderTopLeftRadius,
        borderTopRightRadius: base.borderTopRightRadius,
        beforeBorderWidth: before.borderTopWidth,
      };
      el.classList.remove("ProseMirror-selectednode");
      return result;
    });
    expect(hrSelectionStyle.borderTopLeftRadius).toBe("0px");
    expect(hrSelectionStyle.borderTopRightRadius).toBe("0px");
    expect(hrSelectionStyle.beforeBorderWidth).toBe("1px");

    // Block DragHandle: plain click opens block menu, whereas mousedown + drag starts drag without popup
    const dragP1 = pm.locator("> p", { hasText: "待拖拽测试段落一。" });
    const dragP2 = pm.locator("> p", { hasText: "待拖拽测试段落二。" });
    await dragP2.scrollIntoViewIfNeeded();
    const [p1Box, p2Box] = await Promise.all([dragP1.boundingBox(), dragP2.boundingBox()]);
    expect(p1Box).not.toBeNull();
    expect(p2Box).not.toBeNull();
    if (p1Box && p2Box) {
      await page.mouse.move(p1Box.x + 40, p1Box.y + p1Box.height / 2);
      await page.mouse.move(p2Box.x + 40, p2Box.y + p2Box.height / 2);
      await page.waitForFunction(() => {
        const r = document.querySelector('[data-drag-handle-grip="true"]')?.getBoundingClientRect();
        return Boolean(r && r.left > 0 && r.width > 0);
      });
      const gripBox = await grip.boundingBox();
      expect(gripBox).not.toBeNull();
      if (gripBox) {
        await page.mouse.click(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
        const blockMenu = page.locator('[data-slot="menu-popup"]');
        await expect(blockMenu).toBeVisible();
        await expect(blockMenu).toContainText("上移一段");
        await expect(blockMenu).toContainText("删除该块");
        await page.keyboard.press("Escape");
        await expect(blockMenu).toHaveCount(0);

        await page.evaluate(() => {
          (window as unknown as { __e2eDragStarts?: number }).__e2eDragStarts = 0;
          document.querySelector(".inkade-drag-handle")?.addEventListener("dragstart", () => {
            const win = window as unknown as { __e2eDragStarts?: number };
            win.__e2eDragStarts = (win.__e2eDragStarts ?? 0) + 1;
          });
        });
        await page.mouse.move(p1Box.x + 40, p1Box.y + p1Box.height / 2);
        await page.waitForTimeout(150);
        await page.mouse.move(p2Box.x + 40, p2Box.y + p2Box.height / 2);
        await page.waitForFunction(() => {
          const r = document.querySelector('[data-drag-handle-grip="true"]')?.getBoundingClientRect();
          return Boolean(r && r.left > 0 && r.width > 0);
        });
        const dragGripBox = await grip.boundingBox();
        if (dragGripBox) {
          await page.mouse.move(
            dragGripBox.x + dragGripBox.width / 2,
            dragGripBox.y + dragGripBox.height / 2,
          );
          await page.mouse.down();
          await expect(blockMenu).toHaveCount(0);
          await page.mouse.move(p1Box.x + 40, p1Box.y + 4, { steps: 10 });
          await expect(blockMenu).toHaveCount(0);
          const dragStarts = await page.evaluate(
            () => (window as unknown as { __e2eDragStarts?: number }).__e2eDragStarts ?? 0,
          );
          expect(dragStarts).toBeGreaterThanOrEqual(1);
          await page.mouse.up();
        }
      }
    }

    // Toggle Source Mode -> ensure roundtrip attributes preserved & no duplicate <mark> HTML leaked
    await page.getByRole("button", { name: "更多文档操作" }).click();
    await page.getByRole("menuitem", { name: "Markdown 源码" }).click();
    const sourceTextarea = page.locator("textarea").first();
    await expect(sourceTextarea).toBeVisible();
    const sourceText = await sourceTextarea.inputValue();
    expect(sourceText).toContain("> [!TIP] 性能调优提示");
    expect(sourceText).toContain("width=md align=left");
    expect(sourceText).toContain("$5 to $10");
    expect(sourceText).toContain("[[设计基线|架构别名]]");
    expect(sourceText).not.toContain("<mark");

    // Switch back to Rich text and save cleanly
    await page.getByRole("button", { name: "返回富文本" }).click();
    await expect(pm).toBeVisible();
    await pm.locator("p", { hasText: "请选择这段文字" }).click();
    await page.keyboard.press(`${MOD_KEY}+s`);
    await expect(page.getByText(/已(?:自动)?保存/).first()).toBeVisible();
  });

  test("3. Lifecycle, Reader multi-highlight & ==highlight==, Inline Track Changes Undo & Revision Restore", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("life");
    const targetTitle = `生命周期文档-${suffix}`;
    const renamedTitle = `已重命名目标-${suffix}`;
    const sourceTitle = `双链引用源-${suffix}`;

    const targetRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: targetTitle,
          contentMarkdown: [
            `# ${targetTitle}`,
            "",
            "这是 ==源码高亮语法== 示例。",
            "",
            "第一处待高亮短语 与 同段落第二处待高亮短语 共同出现在本行。",
            "",
            "第二段等待 Agent 改写对比。",
            "",
          ].join("\n"),
        },
      },
    );
    expect(targetRes.status).toBe(201);
    const targetId = targetRes.body.document.id;

    const sourceRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: sourceTitle,
          contentMarkdown: `# ${sourceTitle}\n\n参见 [[${targetTitle}]] 获取详情。\n`,
        },
      },
    );
    expect(sourceRes.status).toBe(201);
    const sourceId = sourceRes.body.document.id;

    // Seed two highlights inside the SAME text node to verify reverse-offset DOM wrapping
    await apiJson(request, "POST", `/api/v1/documents/${targetId}/highlights`, {
      data: { quote: "第一处待高亮短语", color: "amber", prefixContext: "", suffixContext: "" },
    });
    await apiJson(request, "POST", `/api/v1/documents/${targetId}/highlights`, {
      data: { quote: "同段落第二处待高亮短语", color: "emerald", prefixContext: "", suffixContext: "" },
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/docs/${targetId}`);

    // Switch to Reader mode -> verify ==highlight== & both same-paragraph highlights render
    await page.getByRole("button", { name: "阅读批注" }).click();
    const prose = page.locator(".inkade-prose");
    await expect(prose.locator("mark[data-inkade-mark='true']", { hasText: "源码高亮语法" })).toBeVisible();
    await expect(prose.locator("mark[data-highlight-id]", { hasText: "第一处待高亮短语" })).toBeVisible();
    await expect(prose.locator("mark[data-highlight-id]", { hasText: "同段落第二处待高亮短语" })).toBeVisible();

    // Rename with syncBacklinks: true via API & verify referring source document updated cleanly
    const renameRes = await apiJson(request, "PATCH", `/api/v1/documents/${targetId}`, {
      data: { title: renamedTitle, syncBacklinks: true },
    });
    expect(renameRes.status).toBe(200);
    const updatedSource = await apiJson<{ document: { contentMarkdown: string } }>(
      request,
      "GET",
      `/api/v1/documents/${sourceId}`,
    );
    expect(updatedSource.body.document.contentMarkdown).toContain(`[[${renamedTitle}]]`);

    // Create Agent revision v2 -> test Inline Track Changes Accept All + Undo + Apply
    const tokenRes = await apiJson<{ rawToken: string }>(request, "POST", "/api/v1/tokens", {
      data: {
        name: `agent-life-${suffix}`,
        scope: { permission: "write", spaceIds: ["spc_research"], denyHardDelete: true },
      },
    });
    const latest = await apiJson<{ document: { version: number; contentMarkdown: string } }>(
      request,
      "GET",
      `/api/v1/documents/${targetId}`,
    );
    await apiJson(request, "PATCH", `/api/v1/documents/${targetId}`, {
      token: tokenRes.body.rawToken,
      data: {
        contentMarkdown: latest.body.document.contentMarkdown.replace(
          "第二段等待 Agent 改写对比。",
          "第二段已完成 Agent 权威修订。",
        ),
        expectedVersion: latest.body.document.version,
        changeSummary: "Agent 完成了第二段修订",
      },
    });

    await page.reload();
    await page.getByRole("button", { name: "阅读批注" }).click();
    await expect(page.getByText(/Agent 已静默更新至/)).toBeVisible();
    await page.getByRole("button", { name: "查看改动" }).click();

    const inlineViewer = page.locator('[data-slot="inline-track-changes-viewer"]');
    await expect(inlineViewer).toBeVisible();
    await inlineViewer.getByRole("button", { name: "全部采纳" }).click();
    await expect(inlineViewer.locator('[data-hunk-id="hunk-1"]')).toHaveAttribute(
      "data-hunk-decision",
      "accepted",
    );
    await inlineViewer.getByRole("button", { name: "撤销" }).click();
    await expect(inlineViewer.locator('[data-hunk-id="hunk-1"]')).toHaveAttribute(
      "data-hunk-decision",
      "pending",
    );
    await inlineViewer.getByRole("button", { name: "全部采纳" }).click();
    await inlineViewer.getByRole("button", { name: "应用审阅结果" }).click();
    await expect(inlineViewer).toHaveCount(0);
  });

  test("4. Mobile (390x844): Library bulk bar above tab bar, TOC trigger above nav, constrained BubbleMenu & zero overflow", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("mob");
    const doc1Title = `移动端测试一-${suffix}`;
    const doc2Title = `移动端测试二-${suffix}`;

    const doc1 = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: doc1Title,
          contentMarkdown: [
            `# ${doc1Title}`,
            "",
            "## 第一章 移动阅读与排版",
            "",
            "请在移动端测试划词选区工具栏与浮层约束能力，确认不溢出也不被底部导航栏遮挡。",
            "",
            "## 第二章 离线与性能",
            "",
            "移动端正文补充段落。",
            "",
          ].join("\n"),
        },
      },
    );
    expect(doc1.status).toBe(201);

    const doc2 = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: doc2Title,
          contentMarkdown: `# ${doc2Title}\n\n第二篇移动端多选文档。\n`,
        },
      },
    );
    expect(doc2.status).toBe(201);

    await page.setViewportSize({ width: 390, height: 844 });

    // 4a. Mobile Library multi-select bulk bar placement strictly above MobileNavChrome
    await page.goto("/library");
    await page.getByPlaceholder("过滤标题、摘要或标签…").fill(suffix);
    await page.getByLabel(`选中「${doc1Title}」`).first().click({ force: true });
    await page.getByLabel(`选中「${doc2Title}」`).first().click({ force: true });

    const bulkBar = page.getByTestId("library-bulk-bar");
    const mobileNav = page.locator('nav[aria-label="移动端底部导航"]');
    await expect(bulkBar).toBeVisible();
    await expect(mobileNav).toBeVisible();

    const [bulkBox, navBox, libOverflow] = await Promise.all([
      bulkBar.boundingBox(),
      mobileNav.boundingBox(),
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ]);
    expect(bulkBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(libOverflow).toBeLessThanOrEqual(1);
    if (bulkBox && navBox) {
      expect(bulkBox.y + bulkBox.height).toBeLessThanOrEqual(navBox.y);
      expect(bulkBox.x).toBeGreaterThanOrEqual(0);
      expect(bulkBox.x + bulkBox.width).toBeLessThanOrEqual(390);
    }

    // 4b. Mobile DocumentWorkspace: hidden desktop drag handle, TOC above nav, constrained BubbleMenu
    await page.goto(`/docs/${doc1.body.document.id}`);
    const pm = page.locator(".ProseMirror");
    await expect(pm).toBeVisible();
    await expect(page.locator(".inkade-drag-handle")).toBeHidden();

    const tocBtn = page.getByRole("button", { name: "目录 TOC" });
    await expect(tocBtn).toBeVisible();
    const [tocBox, docNavBox] = await Promise.all([
      tocBtn.boundingBox(),
      mobileNav.boundingBox(),
    ]);
    expect(tocBox).not.toBeNull();
    expect(docNavBox).not.toBeNull();
    if (tocBox && docNavBox) {
      expect(tocBox.y + tocBox.height).toBeLessThanOrEqual(docNavBox.y);
    }

    await pm.locator("p", { hasText: "请在移动端测试划词选区工具栏" }).evaluate((p) => {
      const node = p.firstChild;
      if (!node) throw new Error("Missing text node");
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 8);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    await pm.dispatchEvent("mouseup");

    const bubbleMenu = page.getByTestId("editor-bubble-menu");
    await expect(bubbleMenu).toBeVisible();
    const aiRewriteBtn = bubbleMenu.getByRole("button", { name: "AI 改写" });
    await expect(aiRewriteBtn).toBeVisible();
    const [bubbleBox, aiBox, docOverflow] = await Promise.all([
      bubbleMenu.boundingBox(),
      aiRewriteBtn.boundingBox(),
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ]);
    expect(bubbleBox).not.toBeNull();
    expect(aiBox).not.toBeNull();
    expect(docOverflow).toBeLessThanOrEqual(1);
    if (bubbleBox && aiBox) {
      expect(bubbleBox.x).toBeGreaterThanOrEqual(0);
      expect(bubbleBox.x + bubbleBox.width).toBeLessThanOrEqual(390);
      expect(aiBox.x).toBeGreaterThanOrEqual(0);
      expect(aiBox.x + aiBox.width).toBeLessThanOrEqual(bubbleBox.x + bubbleBox.width + 1);
      expect(aiBox.x + aiBox.width).toBeLessThanOrEqual(390);
    }
  });

  test("5. Desktop Article Drag-Selection: cross-block text drag, Mod+A & margin rubber-band marquee block selection", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("sel");
    const targetTitle = `框选关联目标-${suffix}`;
    const docTitle = `文章圈选全场景测试-${suffix}`;

    const targetRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: targetTitle,
          contentMarkdown: `# ${targetTitle}\n\n目标参照段落。\n`,
        },
      },
    );
    expect(targetRes.status).toBe(201);

    const docRes = await apiJson<{ document: { id: string } }>(
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
            "## 章节一 文本划选与连续性",
            "",
            `第一段核心内容，包含加粗说明与 [[${targetTitle}]] 跨块选区测试。`,
            "",
            "第二段补充内容，用于验证前向与反向跨段落划选保持原生可见高亮。",
            "",
            "## 章节二 区块框选目标",
            "",
            "> [!NOTE] 提示区块",
            "> 用于验证空白处拖拽框选多块时的统一视觉边界。",
            "",
            "第三段收尾验证文本。",
            "",
          ].join("\n"),
        },
      },
    );
    expect(docRes.status).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/docs/${docRes.body.document.id}`);

    const pm = page.locator(".ProseMirror");
    await expect(pm).toBeVisible();

    const h2 = pm.locator("h2", { hasText: "章节一" }).first();
    const p1 = pm.locator("p", { hasText: "第一段核心内容" }).first();
    const p2 = pm.locator("p", { hasText: "第二段补充内容" }).first();
    const p3 = pm.locator("p", { hasText: "第三段收尾验证文本" }).first();
    const bubbleMenu = page.getByTestId("editor-bubble-menu");

    const [pmBox, h2Box, p1Box, p2Box] = await Promise.all([
      pm.boundingBox(),
      h2.boundingBox(),
      p1.boundingBox(),
      p2.boundingBox(),
    ]);
    expect(pmBox).not.toBeNull();
    expect(h2Box).not.toBeNull();
    expect(p1Box).not.toBeNull();
    expect(p2Box).not.toBeNull();

    if (pmBox && h2Box && p1Box && p2Box) {
      // 5a. Cross-block forward text drag: preserves TextSelection & never triggers NodeRange hide-selection
      await page.mouse.move(h2Box.x + 20, h2Box.y + h2Box.height / 2);
      await page.mouse.down();
      await page.mouse.move(p1Box.x + 140, p1Box.y + p1Box.height / 2, { steps: 10 });
      await page.mouse.up();

      await expect(pm).not.toHaveClass(/ProseMirror-hideselection/);
      await expect(pm.locator(".ProseMirror-selectednoderange")).toHaveCount(0);
      const forwardText = await page.evaluate(() => window.getSelection()?.toString() ?? "");
      expect(forwardText).toContain("一");
      expect(forwardText).toContain("第一段");
      await expect(bubbleMenu).toBeVisible();

      // 5b. Cross-paragraph backward text drag: preserves non-collapsed visible TextSelection
      await page.mouse.click(pmBox.x + pmBox.width + 60, h2Box.y - 35);
      await page.mouse.move(p2Box.x + 180, p2Box.y + p2Box.height / 2);
      await page.mouse.down();
      await page.mouse.move(p1Box.x + 24, p1Box.y + p1Box.height / 2, { steps: 10 });
      await page.mouse.up();

      await expect(pm).not.toHaveClass(/ProseMirror-hideselection/);
      await expect(pm.locator(".ProseMirror-selectednoderange")).toHaveCount(0);
      const backwardText = await page.evaluate(() => window.getSelection()?.toString() ?? "");
      expect(backwardText).toContain("核心内容");
      expect(backwardText).toContain("第二段");
      await expect(bubbleMenu).toBeVisible();

      // 5c. Mod+A selects entire document cleanly without NodeRange hide-selection
      await p1.click({ position: { x: 20, y: 12 } });
      await page.keyboard.press(`${MOD_KEY}+a`);
      await expect(pm).not.toHaveClass(/ProseMirror-hideselection/);
      await expect(pm.locator(".ProseMirror-selectednoderange")).toHaveCount(0);
      const allSelectedLen = await page.evaluate(() => (window.getSelection()?.toString() ?? "").length);
      expect(allSelectedLen).toBeGreaterThan(60);

      // 5d. Right-margin rubber-band marquee drag selects multiple blocks visibly with BubbleMenu
      await page.mouse.move(pmBox.x + pmBox.width + 72, h2Box.y + 8);
      await page.mouse.down();
      await page.mouse.move(p2Box.x + 150, p2Box.y + p2Box.height - 6, { steps: 10 });

      const marqueeBox = page.getByTestId("editor-marquee-box");
      await expect(marqueeBox).toBeVisible();
      const marqueeRect = await marqueeBox.boundingBox();
      expect(marqueeRect).not.toBeNull();
      if (marqueeRect) {
        expect(marqueeRect.width).toBeGreaterThan(80);
        expect(marqueeRect.height).toBeGreaterThan(40);
      }
      const midSelectedBlocks = await pm.locator(".ProseMirror-selectednoderange").count();
      expect(midSelectedBlocks).toBeGreaterThanOrEqual(2);

      await page.mouse.up();
      await expect(marqueeBox).toHaveCount(0);
      const endSelectedBlocks = await pm.locator(".ProseMirror-selectednoderange").count();
      expect(endSelectedBlocks).toBeGreaterThanOrEqual(2);

      const h2RangeStyles = await h2.evaluate((el) => ({
        hasClass: el.classList.contains("ProseMirror-selectednoderange"),
        borderBottomColor: getComputedStyle(el).borderBottomColor,
        beforeBg: getComputedStyle(el, "::before").backgroundColor,
      }));
      expect(h2RangeStyles.hasClass).toBe(true);
      expect(h2RangeStyles.borderBottomColor).toBe("rgba(0, 0, 0, 0)");
      expect(h2RangeStyles.beforeBg).not.toBe("rgba(0, 0, 0, 0)");
      await expect(bubbleMenu).toBeVisible();

      // 5e. Bottom-margin upward marquee (including callout block) + Left-margin marquee + recovery to text drag
      const p3Box = await p3.boundingBox();
      expect(p3Box).not.toBeNull();
      if (p3Box) {
        await page.mouse.move(p3Box.x + 40, p3Box.y + p3Box.height + 24);
        await page.mouse.down();
        await page.mouse.move(p2Box.x + 120, p2Box.y + p2Box.height + 36, { steps: 10 });
        await expect(marqueeBox).toBeVisible();
        await page.mouse.up();
        await expect(marqueeBox).toHaveCount(0);
        const upwardCount = await pm.locator(".ProseMirror-selectednoderange").count();
        expect(upwardCount).toBeGreaterThanOrEqual(2);
      }

      // Collapse sidebar to expose wide left canvas gutter and verify left-margin marquee
      await p3.click({ position: { x: 20, y: 12 } });
      await page.keyboard.press(`${MOD_KEY}+Backslash`);
      await expect(page.locator('[data-slot="app-sidebar"]')).toHaveCSS("opacity", "0");
      await expect(page.locator('[data-slot="app-sidebar"]')).toHaveCSS("width", "0px");
      const h2CollapsedBox = await h2.boundingBox();
      const p1CollapsedBox = await p1.boundingBox();
      expect(h2CollapsedBox).not.toBeNull();
      expect(p1CollapsedBox).not.toBeNull();
      if (h2CollapsedBox && p1CollapsedBox) {
        await page.mouse.move(h2CollapsedBox.x - 72, h2CollapsedBox.y + 8);
        await page.mouse.down();
        await page.mouse.move(p1CollapsedBox.x + 120, p1CollapsedBox.y + p1CollapsedBox.height - 4, {
          steps: 10,
        });
        await expect(marqueeBox).toBeVisible();
        await page.mouse.up();
        await expect(marqueeBox).toHaveCount(0);
        const leftMarqueeCount = await pm.locator(".ProseMirror-selectednoderange").count();
        expect(leftMarqueeCount).toBeGreaterThanOrEqual(2);
        await expect(pm.locator(".ProseMirror-selectednode")).toHaveCount(0);
      }

      // Restore sidebar and verify immediate recovery to inline text drag selection
      await page.keyboard.press(`${MOD_KEY}+Backslash`);
      await expect(page.locator('[data-slot="app-sidebar"]')).toHaveCSS("opacity", "1");
      const p3RestoredBox = await p3.boundingBox();
      expect(p3RestoredBox).not.toBeNull();
      if (p3RestoredBox) {
        await page.mouse.move(p3RestoredBox.x + 12, p3RestoredBox.y + p3RestoredBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(p3RestoredBox.x + 130, p3RestoredBox.y + p3RestoredBox.height / 2, {
          steps: 8,
        });
        await page.mouse.up();
        await expect(pm).not.toHaveClass(/ProseMirror-hideselection/);
        await expect(pm.locator(".ProseMirror-selectednoderange")).toHaveCount(0);
        const recoveredText = await page.evaluate(() => window.getSelection()?.toString() ?? "");
        expect(recoveredText.length).toBeGreaterThan(2);
      }
    }
  });
});
