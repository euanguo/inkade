import { Buffer } from "node:buffer";
import {
  apiJson,
  E2E_FIXTURE_URL,
  expect,
  getTodayLocalDate,
  resetClientAppearanceAndLocale,
  test,
  uniqueSuffix,
} from "./fixtures.ts";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipBytes(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, data] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const dataBuf = Buffer.from(data);
    const sum = crc32(dataBuf);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(sum, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(sum, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    localParts.push(localHeader, dataBuf);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  const count = Object.keys(entries).length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([...localParts, centralDir, eocd]));
}

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildMinimalPdfBytes(pagesText: readonly string[]): Uint8Array {
  const pageCount = Math.max(1, pagesText.length);
  const objects: string[] = [];

  const kidRefs = pagesText.map((_, idx) => `${4 + idx * 2} 0 R`).join(" ");
  objects[1] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  objects[2] = `2 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [${kidRefs}] >>\nendobj\n`;
  objects[3] =
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";

  pagesText.forEach((rawText, idx) => {
    const pageObjId = 4 + idx * 2;
    const streamObjId = 5 + idx * 2;
    const streamBody = `BT\n/F1 14 Tf\n72 720 Td\n(${escapePdfLiteral(rawText)}) Tj\nET\n`;
    objects[pageObjId] =
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamObjId} 0 R >>\nendobj\n`;
    objects[streamObjId] =
      `${streamObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamBody, "utf8")} >>\nstream\n${streamBody}endstream\nendobj\n`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, "utf8");
    pdf += objects[id]!;
  }
  const xrefPos = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]!).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "utf8"));
}

test.describe("Inkade V6 Enterprise Evolution (Phase 40-46 E2E)", () => {
  test.beforeEach(async ({ page }) => {
    await resetClientAppearanceAndLocale(page);
  });

  test("T40: Tasks Inbox isolation, NumberTicker DOM hygiene, quiet batch writes & Inbox batch rollback", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("t40");
    const standaloneTitle = `T40独立待办-${suffix}`;

    const taskRes = await apiJson<{
      node: { id: string };
      document: { id: string; title: string; properties?: Record<string, unknown> | null };
    }>(request, "POST", "/api/v1/tasks", {
      data: { title: standaloneTitle },
    });
    expect(taskRes.status).toBe(201);
    expect(taskRes.body.document.properties?.systemRole).toBe("tasks_inbox");

    const listedDocs = await apiJson<{
      documents: Array<{ id: string; title: string; properties?: Record<string, unknown> | null }>;
    }>(request, "GET", "/api/v1/documents?limit=200");
    expect(listedDocs.status).toBe(200);
    expect(
      listedDocs.body.documents.some(
        (d) => d.title === "Tasks Inbox" || d.properties?.systemRole === "tasks_inbox",
      ),
    ).toBe(false);

    const searchRes = await apiJson<{ hits: Array<{ title: string }> }>(
      request,
      "GET",
      "/api/v1/search?q=Tasks%20Inbox",
    );
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.hits.some((h) => h.title === "Tasks Inbox")).toBe(false);

    const summaryRes = await apiJson<{
      spaces: Array<{ slug: string; name: string }>;
    }>(request, "GET", "/api/v1/workspace/summary");
    expect(summaryRes.status).toBe(200);
    expect(
      summaryRes.body.spaces.some((s) => s.slug === "tasks-inbox" || s.name === "Tasks Inbox"),
    ).toBe(false);

    await page.goto("/library");
    await expect(page.getByText("Tasks Inbox")).toHaveCount(0);

    await page.goto("/inbox");
    await expect(page.getByText("Tasks Inbox")).toHaveCount(0);

    await page.goto("/tasks");
    const tasksHeader = page.getByTestId("tasks-header");
    await expect(tasksHeader).toBeVisible();
    await expect(tasksHeader.locator('[data-slot="number-ticker"]').first()).toBeVisible();
    const tickerTexts = await tasksHeader
      .locator('[data-slot="number-ticker"]')
      .allTextContents();
    for (const txt of tickerTexts) {
      expect(txt).not.toContain("0123456789");
    }

    // Seed two Research articles and run a silent multi-document batch with shared x-inkade-batch-id
    const originalBody1 = `Original body one ${suffix}`;
    const originalBody2 = `Original body two ${suffix}`;
    const doc1 = await apiJson<{ document: { id: string; title: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `QuietDocA-${suffix}`,
          contentMarkdown: originalBody1,
        },
      },
    );
    expect(doc1.status).toBe(201);
    const doc2 = await apiJson<{ document: { id: string; title: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `QuietDocB-${suffix}`,
          contentMarkdown: originalBody2,
        },
      },
    );
    expect(doc2.status).toBe(201);

    const tokenRes = await apiJson<{ rawToken: string }>(request, "POST", "/api/v1/tokens", {
      data: {
        name: `t40-quiet-agent-${suffix}`,
        scope: {
          permission: "write",
          spaceIds: ["spc_research"],
          includeDescendants: true,
          denyHardDelete: true,
        },
      },
    });
    expect(tokenRes.status).toBe(201);
    const batchId = `bat_t40_${suffix}`;

    const patch1 = await request.fetch(`/api/v1/documents/${doc1.body.document.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${tokenRes.body.rawToken}`,
        "x-inkade-batch-id": batchId,
        "content-type": "application/json",
      },
      data: { contentMarkdown: `Agent silent batch update 1 ${suffix}` },
    });
    expect(patch1.ok()).toBe(true);

    const patch2 = await request.fetch(`/api/v1/documents/${doc2.body.document.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${tokenRes.body.rawToken}`,
        "x-inkade-batch-id": batchId,
        "content-type": "application/json",
      },
      data: { contentMarkdown: `Agent silent batch update 2 ${suffix}` },
    });
    expect(patch2.ok()).toBe(true);

    // /daily shows zero blocking approval popups or topbar approval dialogs
    await page.goto("/daily");
    await expect(page.getByTestId("daily-body-container")).toBeVisible();
    await expect(page.locator('[data-slot="approval-card"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="inbox-blocking-question-card"]')).toHaveCount(0);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // /inbox -> Digest ("静默动态") attributes batch and supports one-click batch rollback
    await page.goto("/inbox");
    await page.getByRole("tab", { name: /静默动态/ }).click();
    const queueRow = page.getByText(`QuietDocA-${suffix}`).first();
    await expect(queueRow).toBeVisible();
    await queueRow.click();

    const rollbackBtn = page.getByRole("button", { name: "整批撤回" });
    await expect(rollbackBtn).toBeVisible();
    const rollbackRespPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/audit/batches/${batchId}/rollback`) && res.status() === 200,
    );
    await rollbackBtn.click();
    await rollbackRespPromise;

    const after1 = await apiJson<{ document: { contentMarkdown: string } }>(
      request,
      "GET",
      `/api/v1/documents/${doc1.body.document.id}`,
    );
    const after2 = await apiJson<{ document: { contentMarkdown: string } }>(
      request,
      "GET",
      `/api/v1/documents/${doc2.body.document.id}`,
    );
    expect(after1.body.document.contentMarkdown).toBe(originalBody1);
    expect(after2.body.document.contentMarkdown).toBe(originalBody2);
  });

  test("T41: Bidirectional Article task sync, Schedule x Deadline drawer, FullCalendar Agenda & read-only ICS overlay", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("t41");
    const today = getTodayLocalDate();
    const taskTitle = `T41双向任务-${suffix}`;
    const proseLine = `正文保留段落-${suffix}`;

    const article = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `T41-Article-${suffix}`,
          contentMarkdown: `# Task Sync Note\n\n- [ ] ${taskTitle}\n\n${proseLine}\n`,
        },
      },
    );
    expect(article.status).toBe(201);

    // Toggle task completion inside /tasks -> verify reflected in source Article with prose preserved
    await page.goto("/tasks");
    const taskCheckbox = page.getByRole("checkbox", { name: new RegExp(taskTitle) });
    await expect(taskCheckbox).toBeVisible();
    const completePatch = page.waitForResponse(
      (res) => res.url().includes("/api/v1/tasks/") && res.request().method() === "PATCH",
    );
    await taskCheckbox.click();
    await completePatch;

    await page.goto(`/docs/${article.body.document.id}`);
    await expect(page.getByText(proseLine)).toBeVisible();
    const docCheckbox = page.locator('ul[data-type="taskList"] input[type="checkbox"]').first();
    await expect(docCheckbox).toBeChecked();

    // Bidirectional reverse sync: uncheck inside Article -> verify unchecked again in /tasks
    const articleSyncPatch = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/documents/${article.body.document.id}`) &&
        res.request().method() === "PATCH",
    );
    await docCheckbox.click();
    await articleSyncPatch;

    await page.goto("/tasks");
    await expect(page.getByRole("checkbox", { name: new RegExp(taskTitle) })).not.toBeChecked();

    // Open TaskDetailDrawer to set Schedule x Deadline + duration
    const taskCard = page
      .getByRole("checkbox", { name: new RegExp(taskTitle) })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");
    await taskCard.getByRole("button", { name: "查看与编辑待办详情" }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await drawer.getByLabel("计划安排").fill(today);
    await drawer.getByLabel("开始时间").fill("10:00");
    await drawer.getByRole("button", { name: "1h", exact: true }).click();
    await drawer.getByLabel("截止日期").fill(today);

    const detailSavePatch = page.waitForResponse(
      (res) => res.url().includes("/api/v1/tasks/") && res.request().method() === "PATCH",
    );
    await drawer.getByRole("button", { name: "保存更改" }).click();
    await detailSavePatch;

    // Switch to FullCalendar Agenda view, test Week toggle & reload persistence
    await page.getByRole("button", { name: "日程", exact: true }).click();
    const agendaView = page.getByTestId("tasks-agenda-view");
    await expect(agendaView).toBeVisible();
    await expect(agendaView.locator(".inkade-fc-container").getByRole("table").first()).toBeVisible();

    await agendaView.getByRole("button", { name: "周视图" }).click();
    await expect(agendaView.locator(".inkade-fc-container").getByText(taskTitle)).toBeVisible();

    await page.reload();
    await expect(
      page.getByTestId("tasks-agenda-view").locator(".inkade-fc-container").getByText(taskTitle),
    ).toBeVisible();

    // Subscribe to mock ICS external calendar and verify read-only event overlay
    await page.getByTestId("agenda-calendars-trigger").click();
    await page.getByPlaceholder("日历名称（如：团队日程）").fill(`团队日历-${suffix}`);
    await page
      .getByPlaceholder("https://.../calendar.ics")
      .fill(`${new URL(E2E_FIXTURE_URL).origin}/calendar.ics`);
    const subResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/calendar-subscriptions") && res.status() === 201,
    );
    await page.getByRole("button", { name: "订阅", exact: true }).click();
    await subResp;
    await page.keyboard.press("Escape");

    const externalEvent = agendaView.locator(".inkade-fc-external-event", {
      hasText: "Inkade E2E External Standup",
    });
    await expect(externalEvent).toBeVisible();
    await externalEvent.click();
    await expect(agendaView.getByText("外部只读").first()).toBeVisible();
  });

  test("T42: Space schema builder, @tanstack/react-table inline editing, Board DnD & ```inkade-view``` + YAML export", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("t42");
    const docA = await apiJson<{ document: { id: string; title: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `SchemaDocA-${suffix}`,
          contentMarkdown: "Body A for schema table and board",
        },
      },
    );
    expect(docA.status).toBe(201);
    const docB = await apiJson(request, "POST", "/api/v1/documents", {
      data: {
        spaceId: "spc_research",
        kind: "article",
        title: `SchemaDocB-${suffix}`,
        contentMarkdown: "Body B for inkade-view",
      },
    });
    expect(docB.status).toBe(201);

    await page.goto("/spaces/spc_research?view=table");
    await page.getByRole("button", { name: "字段 Schema" }).click();

    const schemaDialog = page.getByRole("dialog");
    await expect(schemaDialog.getByTestId("space-schema-editor")).toBeVisible();

    // Add 4 typed schema fields: select, number, date, checkbox
    const openSelectPopup = page.locator('[data-slot="select-popup"][data-open]');
    const addFieldBtn = schemaDialog.getByRole("button", { name: "添加字段" });
    await addFieldBtn.click();
    await schemaDialog.getByLabel("显示名称").nth(0).fill("阶段");
    await schemaDialog.getByLabel("字段键名").nth(0).fill("stage");
    await schemaDialog.getByLabel("字段类型").nth(0).click();
    await openSelectPopup.getByRole("option", { name: "单选" }).click();
    await schemaDialog.locator("textarea").last().fill("draft|草稿|slate\ndone|完成|emerald");

    await addFieldBtn.click();
    await schemaDialog.getByLabel("显示名称").nth(1).fill("预算");
    await schemaDialog.getByLabel("字段键名").nth(1).fill("budget");
    await schemaDialog.getByLabel("字段类型").nth(1).click();
    await openSelectPopup.getByRole("option", { name: "数字" }).click();

    await addFieldBtn.click();
    await schemaDialog.getByLabel("显示名称").nth(2).fill("评审日");
    await schemaDialog.getByLabel("字段键名").nth(2).fill("review_date");
    await schemaDialog.getByLabel("字段类型").nth(2).click();
    await openSelectPopup.getByRole("option", { name: "日期" }).click();

    await addFieldBtn.click();
    await schemaDialog.getByLabel("显示名称").nth(3).fill("通过");
    await schemaDialog.getByLabel("字段键名").nth(3).fill("approved");
    await schemaDialog.getByLabel("字段类型").nth(3).click();
    await openSelectPopup.getByRole("option", { name: "复选框" }).click();

    const saveSchemaResp = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/spaces/spc_research/schema") && res.request().method() === "PUT",
    );
    await schemaDialog.getByRole("button", { name: "保存 Schema" }).click();
    await saveSchemaResp;
    await expect(schemaDialog).toHaveCount(0);

    // Table shows dynamic columns & inline editing persists across reload
    await expect(page.getByRole("columnheader", { name: "阶段" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "预算" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "评审日" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "通过" })).toBeVisible();

    const docARow = page.locator("tr", { hasText: `SchemaDocA-${suffix}` });
    await expect(docARow).toBeVisible();

    const selectPatch = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/documents/${docA.body.document.id}`) &&
        res.request().method() === "PATCH",
    );
    await docARow.locator("td").nth(5).getByRole("button").click();
    await page.getByRole("menuitem", { name: "完成" }).click();
    await selectPatch;

    const numPatch = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/documents/${docA.body.document.id}`) &&
        res.request().method() === "PATCH",
    );
    await docARow.locator("td").nth(6).getByRole("button").click();
    await docARow.locator('input[type="number"]').fill("4200");
    await docARow.locator('input[type="number"]').press("Enter");
    await numPatch;

    const boolPatch = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/documents/${docA.body.document.id}`) &&
        res.request().method() === "PATCH",
    );
    await docARow.locator("td").nth(8).getByRole("switch").click();
    await boolPatch;

    await page.reload();
    const reloadedRow = page.locator("tr", { hasText: `SchemaDocA-${suffix}` });
    await expect(reloadedRow).toContainText("完成");
    await expect(reloadedRow).toContainText("4200");
    await expect(reloadedRow.getByRole("switch").first()).toBeChecked();

    // Switch to Board mode and verify group column + DnD card back to Draft
    await page.getByRole("button", { name: "看板", exact: true }).click();
    const boardMode = page.getByTestId("library-board-mode");
    await expect(boardMode).toBeVisible();
    const doneCol = page.getByTestId("board-column-done");
    const draftCol = page.getByTestId("board-column-draft");
    const boardCard = page.getByTestId(`board-card-${docA.body.document.id}`);
    await expect(doneCol.getByTestId(`board-card-${docA.body.document.id}`)).toBeVisible();

    const boardMovePatch = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/documents/${docA.body.document.id}`) &&
        res.request().method() === "PATCH",
    );
    await boardCard.dragTo(draftCol);
    await boardMovePatch;
    await expect(draftCol.getByTestId(`board-card-${docA.body.document.id}`)).toBeVisible();

    // ```inkade-view``` live query block + YAML Frontmatter export round-trip
    const viewDoc = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `ViewHost-${suffix}`,
          properties: { stage: "draft", budget: 4200, approved: true },
          contentMarkdown: `# Live Database View\n\n\`\`\`inkade-view\nmode: table\nspaceId: spc_research\n\`\`\`\n`,
        },
      },
    );
    expect(viewDoc.status).toBe(201);
    await page.goto(`/docs/${viewDoc.body.document.id}`);
    const viewBlock = page.getByTestId("inkade-view-block");
    await expect(viewBlock).toBeVisible();
    await expect(viewBlock).toContainText(`SchemaDocA-${suffix}`);

    const exportedResp = await request.get(`/api/v1/documents/${viewDoc.body.document.id}/export.md`);
    expect(exportedResp.status()).toBe(200);
    const exportedMd = await exportedResp.text();
    expect(exportedMd.startsWith("---\n")).toBe(true);
    expect(exportedMd).toContain("stage: draft");
    expect(exportedMd).toContain("budget: 4200");
    expect(exportedMd).toContain("approved: true");
    expect(exportedMd).toContain("```inkade-view");
  });

  test("T43: /settings/intelligence UI, /ask Orama citations jump & /connect host switcher + Context Pack TokenScope", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("t43");
    const researchDoc = await apiJson<{ document: { id: string; title: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `OramaRagArchitecture-${suffix}`,
          contentMarkdown: `Inkade V6 OramaRetrievalAnchor${suffix} enforces TokenScope SQL pushdown and bracket citations.`,
        },
      },
    );
    expect(researchDoc.status).toBe(201);
    const inboxSecret = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_inbox",
          kind: "article",
          title: `InboxClassifiedSecret-${suffix}`,
          contentMarkdown: `TOP_SECRET_INBOX_${suffix} confidential memo.`,
        },
      },
    );
    expect(inboxSecret.status).toBe(201);
    const reindexRes = await apiJson(request, "POST", "/api/v1/search/reindex");
    expect(reindexRes.status).toBe(200);

    // /settings/intelligence renders Embedding + Chat AI forms & saves cleanly (keep fallback enabled)
    await page.goto("/settings/intelligence");
    await expect(page.getByRole("button", { name: "测试 Embedding 连通性" })).toBeVisible();
    const saveAiBtn = page.getByRole("button", { name: "保存网关配置" });
    await expect(saveAiBtn).toBeVisible();
    const saveAiResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/ai/settings") && res.request().method() === "PUT",
    );
    await saveAiBtn.click();
    await saveAiResp;

    // /ask grounded question -> [1] citation -> jump to source document
    await page.goto("/ask");
    await page
      .getByPlaceholder("向知识库提问，例如：上周会议决定的发布节奏是什么？")
      .fill(`OramaRetrievalAnchor${suffix}`);
    const askResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/ask") && res.status() === 200,
    );
    await page.getByRole("button", { name: "提问", exact: true }).click();
    await askResp;

    await page
      .getByRole("button", {
        name: new RegExp(`查看引用来源 2：`),
      })
      .click();
    await page
      .getByRole("button", {
        name: new RegExp(`查看引用来源 1：.*OramaRagArchitecture-${suffix}`),
      })
      .click();
    await expect(page.getByText(`OramaRagArchitecture-${suffix}`).first()).toBeVisible();
    await page.getByText("打开原文", { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/docs/${researchDoc.body.document.id}`));

    // /connect host switcher + Context Pack UI & TokenScope isolation
    await page.goto("/connect");
    const preBlock = page.locator("pre").first();
    await page.getByRole("button", { name: "Cursor" }).click();
    await expect(preBlock).toContainText("mcpServers");
    await page.getByRole("button", { name: "Codex" }).click();
    await expect(preBlock).toContainText("mcp_servers");
    await page.getByRole("button", { name: "Claude Code" }).click();

    await page.getByRole("button", { name: "新建 Context Pack" }).click();
    await page.getByPlaceholder("例如：Core Architecture Context").fill(`Pack-${suffix}`);
    const packSlug = `pack-${suffix}`;
    await page.getByPlaceholder("architecture-context").fill(packSlug);
    await page.getByLabel("Token 预算 (BPE cl100k)").fill("1200");
    await page.locator("form").getByRole("button", { name: "Research", exact: true }).click();

    const savePackResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/context-packs") && res.status() === 201,
    );
    await page.getByRole("button", { name: "保存 Context Pack" }).click();
    await savePackResp;
    await expect(page.getByText(`Pack-${suffix}`).first()).toBeVisible();

    const scopedToken = await apiJson<{ rawToken: string }>(request, "POST", "/api/v1/tokens", {
      data: {
        name: `t43-pack-reader-${suffix}`,
        scope: {
          permission: "read",
          spaceIds: ["spc_research"],
          includeDescendants: true,
          denyHardDelete: true,
        },
      },
    });
    expect(scopedToken.status).toBe(201);
    const scopedPackResp = await request.get(`/api/v1/context-packs/${packSlug}`, {
      headers: { authorization: `Bearer ${scopedToken.body.rawToken}` },
    });
    expect(scopedPackResp.status()).toBe(200);
    const scopedPackJson = (await scopedPackResp.json()) as {
      totalTokens: number;
      renderedMarkdown: string;
    };
    expect(scopedPackJson.totalTokens).toBeLessThanOrEqual(1200);
    expect(scopedPackJson.renderedMarkdown).toContain(`OramaRagArchitecture-${suffix}`);
    expect(scopedPackJson.renderedMarkdown).not.toContain(`TOP_SECRET_INBOX_${suffix}`);

    const crossSpaceResp = await request.get(`/api/v1/documents/${inboxSecret.body.document.id}`, {
      headers: { authorization: `Bearer ${scopedToken.body.rawToken}` },
    });
    expect(crossSpaceResp.status()).toBe(403);
  });

  test("T44: Obsidian Import Hub Dry-Run/Commit/Rollback, PDF upload/FTS/coordinate highlight & Outline Mirror sync", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("t44");

    // 1) Import Hub Dry-Run preview -> Commit -> Batch Rollback
    const vaultZip = buildZipBytes({
      [`Vault/ImportedSource-${suffix}.md`]: new TextEncoder().encode(
        `# ImportedSource-${suffix}\n\nLinked to [[ImportedTarget-${suffix}]].\n`,
      ),
      [`Vault/ImportedTarget-${suffix}.md`]: new TextEncoder().encode(
        `# ImportedTarget-${suffix}\n\nTarget body.\n`,
      ),
    });

    await page.goto("/settings/backup");
    await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({
      name: `obsidian-${suffix}.zip`,
      mimeType: "application/zip",
      buffer: Buffer.from(vaultZip),
    });

    const previewResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/import/preview") && res.status() === 200,
    );
    await page.getByRole("button", { name: "生成导入预览 (Dry-Run)" }).click();
    await previewResp;
    await expect(page.getByText("导入清单预览")).toBeVisible();
    await expect(page.getByText(`ImportedSource-${suffix}`).first()).toBeVisible();

    const commitResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/import/commit") && res.ok(),
    );
    await page.getByRole("button", { name: "确认并执行导入" }).click();
    await commitResp;

    const docsAfterImport = await apiJson<{
      documents: Array<{ id: string; title: string }>;
    }>(request, "GET", "/api/v1/documents?limit=200");
    expect(docsAfterImport.body.documents.some((d) => d.title === `ImportedSource-${suffix}`)).toBe(
      true,
    );

    const importRollbackBtn = page.getByRole("button", { name: "一键整批回滚" });
    await expect(importRollbackBtn).toBeVisible();
    const rollbackResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/audit/batches/") && res.status() === 200,
    );
    await importRollbackBtn.click();
    await rollbackResp;

    const docsAfterRollback = await apiJson<{
      documents: Array<{ id: string; title: string }>;
    }>(request, "GET", "/api/v1/documents?limit=200");
    expect(
      docsAfterRollback.body.documents.some((d) => d.title === `ImportedSource-${suffix}`),
    ).toBe(false);

    // 2) Native PDF upload -> FTS hit -> coordinate highlight persistence
    const pdfToken = `InkadePdfStudyToken${suffix}`;
    const pdfBytes = buildMinimalPdfBytes([pdfToken]);
    await page.goto("/library?view=grid");
    const uploadPdfResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/pdf/upload") && res.status() === 201,
    );
    await page.locator('input[accept=".pdf,application/pdf"]').setInputFiles({
      name: `study-${suffix}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(pdfBytes),
    });
    const uploadedPdfJson = (await (await uploadPdfResp).json()) as {
      document: { id: string };
      asset: { id: string };
    };
    await expect(page).toHaveURL(new RegExp(`/docs/${uploadedPdfJson.document.id}`));

    const pdfSearchRes = await apiJson<{ hits: Array<{ documentId: string }> }>(
      request,
      "GET",
      `/api/v1/search?q=${encodeURIComponent(pdfToken)}`,
    );
    expect(
      pdfSearchRes.body.hits.some((h) => h.documentId === uploadedPdfJson.document.id),
    ).toBe(true);

    const textSpan = page.locator('[data-pdf-page="1"] .textLayer span').first();
    await expect(textSpan).toBeVisible();
    await textSpan.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    const createAnnResp = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/pdf-assets/${uploadedPdfJson.asset.id}/annotations`) &&
        res.status() === 201,
    );
    await page.getByRole("button", { name: "琥珀高亮" }).click();
    await createAnnResp;

    await expect(page.locator("[data-pdf-annotation-id]").first()).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-pdf-annotation-id]").first()).toBeVisible();

    // 3) Outline Mirror cross-document bidirectional sync
    const mirrorSrc = await apiJson<{ document: { id: string; title: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "outline",
          title: `MirrorSource-${suffix}`,
        },
      },
    );
    const mirrorHost = await apiJson<{ document: { id: string; title: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "outline",
          title: `MirrorHost-${suffix}`,
        },
      },
    );
    const sourceNodeText = `MirrorSourceLine-${suffix}`;
    await apiJson(request, "POST", "/api/v1/outline-nodes", {
      data: {
        documentId: mirrorSrc.body.document.id,
        parentId: null,
        contentMarkdown: sourceNodeText,
      },
    });

    await page.goto(`/docs/${mirrorSrc.body.document.id}`);
    const srcNode = page.locator("[data-node-id]", { hasText: sourceNodeText }).first();
    await expect(srcNode).toBeVisible();
    await srcNode.hover();
    await srcNode.getByRole("button", { name: "节点操作（点击菜单 / 拖拽排序）" }).click();
    await page.getByRole("menuitem", { name: "创建跨文档镜像" }).click();

    const mirrorModal = page.getByRole("dialog");
    await expect(mirrorModal).toBeVisible();
    await mirrorModal.getByRole("button", { name: new RegExp(`MirrorHost-${suffix}`) }).click();
    await expect(mirrorModal).toHaveCount(0);

    await page.goto(`/docs/${mirrorHost.body.document.id}`);
    const mirroredNode = page.locator('[data-mirrored="true"]', { hasText: sourceNodeText }).first();
    await expect(mirroredNode).toBeVisible();

    const mirrorParagraph = mirroredNode.locator("p").first();
    await mirrorParagraph.click();
    const mirrorSyncBatch = page.waitForResponse(
      (res) => res.url().includes("/api/v1/outline-nodes/batch") && res.status() === 200,
    );
    await page.keyboard.type(" SyncedBack");
    await page.keyboard.press("Escape");
    await page.locator("h1, input").first().click();
    await mirrorSyncBatch;

    await page.goto(`/docs/${mirrorSrc.body.document.id}`);
    await expect(page.getByText(`${sourceNodeText} SyncedBack`)).toBeVisible();
  });

  test("T45: Desktop Multi-Tab Strip + Split View, /graph WebGL Sigma & unauthenticated Digital Garden + feed.xml", async ({
    browser,
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("t45");
    await page.setViewportSize({ width: 1440, height: 900 });

    const docA = await apiJson<{ document: { id: string; title: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `SplitTabAlpha-${suffix}`,
          contentMarkdown: `Alpha panel content ${suffix}`,
        },
      },
    );
    const docB = await apiJson<{ document: { id: string; title: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `SplitTabBeta-${suffix}`,
          contentMarkdown: `Beta panel content ${suffix}`,
        },
      },
    );

    // Enable Desktop Workspace Multi-Tab Strip
    await page.goto("/settings/appearance");
    const tabsSwitch = page.getByRole("switch", { name: "工作区多标签页" });
    await expect(tabsSwitch).toBeVisible();
    if (!(await tabsSwitch.isChecked())) {
      await tabsSwitch.click();
    }

    // Open Doc A then Doc B -> Multi-Tab Strip appears & switches cleanly
    await page.goto(`/docs/${docA.body.document.id}`);
    await expect(page.getByText(`Alpha panel content ${suffix}`)).toBeVisible();
    await page.goto(`/docs/${docB.body.document.id}`);
    await expect(page.getByText(`Beta panel content ${suffix}`)).toBeVisible();

    const tablist = page.getByRole("tablist", { name: "工作区多标签页" });
    await expect(tablist).toBeVisible();
    const tabA = tablist.getByRole("tab", { name: new RegExp(`SplitTabAlpha-${suffix}`) });
    const tabB = tablist.getByRole("tab", { name: new RegExp(`SplitTabBeta-${suffix}`) });
    await expect(tabA).toBeVisible();
    await expect(tabB).toBeVisible();

    await tabA.getByRole("button").first().click();
    await expect(page).toHaveURL(new RegExp(`/docs/${docA.body.document.id}`));

    // Open Split View side-by-side via Document Header More menu
    await page.getByRole("button", { name: "更多文档操作" }).click();
    await page.getByRole("menuitem", { name: "分屏对照" }).click();

    const splitAside = page.locator('aside[aria-label="分屏对照面板"]');
    await expect(splitAside).toBeVisible();
    await expect(page.getByRole("separator", { name: "分屏对照面板" })).toBeVisible();
    await splitAside.locator('[role="combobox"]').first().click();
    await page.getByRole("option", { name: `SplitTabBeta-${suffix}` }).click();
    await expect(splitAside).toContainText(`Beta panel content ${suffix}`);
    await expect(page.getByText(`Alpha panel content ${suffix}`)).toBeVisible();

    // Global Knowledge Graph /graph WebGL Sigma canvas mounts + filter controls
    await page.goto("/graph");
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.width).toBeGreaterThan(100);
    expect(canvasBox!.height).toBeGreaterThan(100);

    await page.getByRole("switch", { name: "显示孤立节点" }).click();

    // Digital Garden publishing + unauthenticated /site/:slug + /site/:slug/feed.xml isolation
    await apiJson(request, "PUT", "/api/v1/spaces/spc_research/schema", {
      data: {
        fields: [
          {
            key: "public_badge",
            label: "Public Badge",
            type: "text",
            options: [],
            showInTable: true,
            showInCard: true,
            requiredByAgent: false,
          },
          {
            key: "internal_note",
            label: "Internal Note",
            type: "text",
            options: [],
            showInTable: false,
            showInCard: false,
            requiredByAgent: false,
          },
        ],
      },
    });
    await apiJson(request, "POST", "/api/v1/documents", {
      data: {
        spaceId: "spc_research",
        kind: "article",
        title: `GardenPublicDoc-${suffix}`,
        contentMarkdown: `Public garden note body ${suffix}`,
        properties: {
          public_badge: `ALLOWED_FIELD_${suffix}`,
          internal_note: `PRIVATE_FIELD_LEAK_${suffix}`,
        },
      },
    });
    await apiJson(request, "POST", "/api/v1/documents", {
      data: {
        spaceId: "spc_inbox",
        kind: "article",
        title: `GardenPrivateInboxDoc-${suffix}`,
        contentMarkdown: `HIDDEN_INBOX_CONTENT_${suffix}`,
      },
    });

    await page.goto("/settings/share-links");
    await page.getByRole("button", { name: "发布新花园" }).click();
    const gardenModal = page.getByRole("dialog");
    await expect(gardenModal).toBeVisible();

    const gardenSlug = `garden-${suffix}`;
    await gardenModal.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Research" }).click();
    await gardenModal.getByPlaceholder("例如：产品与工程笔记花园").fill(`Garden ${suffix}`);
    await gardenModal.getByPlaceholder("engineering-notes").fill(gardenSlug);
    await gardenModal.getByRole("checkbox", { name: /Public Badge/ }).click();

    const createSiteResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/public-sites") && res.status() === 201,
    );
    await page.getByRole("button", { name: "保存并发布" }).click();
    await createSiteResp;

    const guestContext = await browser.newContext({ locale: "zh-CN" });
    try {
      const guestPage = await guestContext.newPage();
      await guestPage.goto(`/site/${gardenSlug}`);
      await expect(guestPage.getByText(`GardenPublicDoc-${suffix}`).first()).toBeVisible();
      await guestPage.getByText(`GardenPublicDoc-${suffix}`).first().click();
      await expect(guestPage.getByText(`Public garden note body ${suffix}`)).toBeVisible();
      await expect(guestPage.getByText(`ALLOWED_FIELD_${suffix}`)).toBeVisible();
      await expect(guestPage.getByText(`PRIVATE_FIELD_LEAK_${suffix}`)).toHaveCount(0);
      await expect(guestPage.getByText(`GardenPrivateInboxDoc-${suffix}`)).toHaveCount(0);

      const feedResp = await guestContext.request.get(`/site/${gardenSlug}/feed.xml`);
      expect(feedResp.status()).toBe(200);
      expect(feedResp.headers()["content-type"] ?? "").toContain("xml");
      const feedXml = await feedResp.text();
      expect(feedXml).toContain("<rss");
      expect(feedXml).toContain(`GardenPublicDoc-${suffix}`);
      expect(feedXml).not.toContain(`GardenPrivateInboxDoc-${suffix}`);
      expect(feedXml).not.toContain(`PRIVATE_FIELD_LEAK_${suffix}`);
    } finally {
      await guestContext.close();
    }
  });

  test("T46: Scheduled Agent Briefing cron nextRunAt, silent Daily write + rollback & Exceptions dismissal", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("t46");
    await apiJson(request, "POST", "/api/v1/documents", {
      data: {
        spaceId: "spc_research",
        kind: "article",
        title: `BriefingSourceNote-${suffix}`,
        contentMarkdown: `Key briefing research update ${suffix}.`,
      },
    });

    await page.goto("/connect");
    const briefingsPanel = page.getByTestId("briefings-panel");
    await expect(briefingsPanel).toBeVisible();

    await briefingsPanel.getByRole("button", { name: "新建简报任务" }).click();
    const jobDialog = page.getByRole("dialog");
    await expect(jobDialog).toBeVisible();

    const jobName = `E2E晨报-${suffix}`;
    await jobDialog.getByPlaceholder("例如：每日 AI 与剪藏晨报").fill(jobName);
    await jobDialog.getByPlaceholder("30 7 * * *").fill("30 7 * * *");
    await jobDialog
      .getByPlaceholder("例如：总结昨日剪藏与未完成任务，使用 [1] [2] 标注引用出处…")
      .fill("Summarize recent updates with [1] citations.");

    const createJobResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/briefings/jobs") && res.status() === 201,
    );
    await jobDialog.getByRole("button", { name: "创建简报任务" }).click();
    const createdJob = (await (await createJobResp).json()) as {
      job: { id: string; nextRunAt: string | null };
    };
    expect(createdJob.job.nextRunAt).toBeTruthy();

    const jobCard = briefingsPanel
      .locator("div", { hasText: jobName })
      .filter({ has: page.getByRole("button", { name: "立即执行" }) })
      .first();
    await expect(jobCard).toContainText("下次执行");

    // Run Now executes quietly with 0 approval popups and cites sources
    const runNowResp = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/briefings/jobs/${createdJob.job.id}/run`) &&
        res.status() === 200,
    );
    await jobCard.getByRole("button", { name: "立即执行" }).click();
    const runJson = (await (await runNowResp).json()) as {
      run: { documentId: string | null; batchId: string | null };
    };
    expect(runJson.run.batchId).toBeTruthy();
    await expect(page.locator('[data-slot="approval-card"]')).toHaveCount(0);

    // /inbox Digest attributes run -> Undo Batch reverts written Daily briefing nodes
    await page.goto("/inbox");
    await page.getByRole("tab", { name: /静默动态/ }).click();
    await page.getByRole("button", { name: "整批撤回" }).first().click();

    const today = getTodayLocalDate();
    const dailyAfterUndo = await apiJson<{
      nodes: Array<{ contentMarkdown: string }>;
    }>(request, "GET", `/api/v1/documents/daily/${today}`);
    expect(
      dailyAfterUndo.body.nodes.some((n) =>
        n.contentMarkdown.includes(`BriefingSourceNote-${suffix}`),
      ),
    ).toBe(false);

    // Trigger simulated error -> verify lands in /inbox Exceptions -> Dismiss clears cleanly
    const simErrResp = await request.post(`/api/v1/briefings/jobs/${createdJob.job.id}/run`, {
      data: { simulateError: `Simulated T46 provider failure ${suffix}` },
    });
    expect(simErrResp.status()).toBe(200);

    await page.goto("/inbox");
    await page.getByRole("tab", { name: /异常与阻塞/ }).click();
    await expect(page.getByText("简报异常").first()).toBeVisible();
    await expect(page.getByText(`Simulated T46 provider failure ${suffix}`).first()).toBeVisible();

    const dismissResp = page.waitForResponse(
      (res) => res.url().includes("/api/v1/briefings/runs/") && res.url().includes("/dismiss"),
    );
    await page.getByRole("button", { name: "忽略异常" }).first().click();
    await dismissResp;
    await expect(page.getByText(`Simulated T46 provider failure ${suffix}`)).toHaveCount(0);
  });
});
