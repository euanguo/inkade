import {
  apiJson,
  E2E_FIXTURE_URL,
  expect,
  test,
  uniqueSuffix,
} from "./fixtures.ts";

test.describe("Inbox Triage, URL Clipper Ingest & Server-Enforced Scope Matrix", () => {
  test("Two-pane Inbox j/k triage, QuickCapture URL ingest via mock server, and archive/undo", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("inb");
    const clipOneTitle = `Inbox条目一-${suffix}`;
    const clipTwoTitle = `Inbox条目二-${suffix}`;

    const clip1 = await apiJson<{ id: string }>(request, "POST", "/api/v1/documents", {
      data: {
        spaceId: "spc_inbox",
        kind: "clip",
        title: clipOneTitle,
        contentMarkdown: `# ${clipOneTitle}\n\n第一条剪藏正文用于 j/k 游标切换。`,
        tags: ["triage"],
        sourceUrl: "https://example.org/one",
      },
    });
    expect(clip1.status).toBe(201);

    const clip2 = await apiJson<{ id: string }>(request, "POST", "/api/v1/documents", {
      data: {
        spaceId: "spc_inbox",
        kind: "clip",
        title: clipTwoTitle,
        contentMarkdown: `# ${clipTwoTitle}\n\n第二条剪藏正文用于归档与撤销验证。`,
        tags: ["triage"],
        sourceUrl: "https://example.org/two",
      },
    });
    expect(clip2.status).toBe(201);

    await page.goto("/inbox?tab=clips");
    await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();

    const btnOne = page.locator("button", { hasText: clipOneTitle }).first();
    const btnTwo = page.locator("button", { hasText: clipTwoTitle }).first();
    await expect(btnOne).toBeVisible();
    await expect(btnTwo).toBeVisible();

    // Ensure item 2 (newer) starts active or navigate via j/k
    await btnTwo.click();
    await expect(btnTwo).toHaveAttribute("data-active", "true");
    await expect(page.locator(".inkade-prose")).toContainText("第二条剪藏正文用于归档与撤销验证");

    // Press j to move down to item 1, k to move back up to item 2
    await page.keyboard.press("j");
    await expect(btnOne).toHaveAttribute("data-active", "true");
    await expect(page.locator(".inkade-prose")).toContainText("第一条剪藏正文用于 j/k 游标切换");

    await page.keyboard.press("k");
    await expect(btnTwo).toHaveAttribute("data-active", "true");

    // Test QuickCapture URL ingest against local ephemeral mock HTTP fixture server
    await page.getByRole("button", { name: "新增快记" }).click();
    await expect(page.getByText("快记 Capture")).toBeVisible();

    await page.getByPlaceholder("https://...").fill(E2E_FIXTURE_URL);
    await expect(page.getByText("检测到网页链接")).toBeVisible();
    await expect(page.getByText("e2e-fixture.inkade.test", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /抓取并清洗正文 Markdown/ }).click();
    await expect(page.getByText("已清洗并保存网页剪藏")).toBeVisible();
    await page.getByRole("button", { name: "打开文章" }).click();

    await expect(page).toHaveURL(/\/docs\/doc_/);
    await expect(page.getByRole("heading", { name: "Playwright Mock Fixture Article" })).toBeVisible();
    await expect(page.locator(".inkade-prose")).toContainText(
      "deterministic local fixture article",
    );

    // Return to /inbox?tab=clips and test Archive + Undo
    await page.goto("/inbox?tab=clips");
    const ingestedCard = page.locator("button", { hasText: "Playwright Mock Fixture Article" }).first();
    await expect(ingestedCard).toBeVisible();
    await ingestedCard.click();
    await expect(ingestedCard).toHaveAttribute("data-active", "true");

    await page.keyboard.press("e");
    await expect(ingestedCard).toHaveCount(0);
    await expect(page.getByText("已归档出 Inbox")).toBeVisible();

    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(
      page.locator("button", { hasText: "Playwright Mock Fixture Article" }).first(),
    ).toBeVisible();
  });

  test("Server-enforced Scope matrix over REST & /mcp + SSRF guard", async ({ request }) => {
    const suffix = uniqueSuffix("scp");

    const allowedDoc = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `Scope允许文档-${suffix}`,
          contentMarkdown: "Authorized research note.",
          tags: ["shared"],
        },
      },
    );
    expect(allowedDoc.status).toBe(201);
    const allowedDocId = allowedDoc.body.document.id;

    const forbiddenSpaceDoc = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_inbox",
          kind: "clip",
          title: `Scope禁止文档-${suffix}`,
          contentMarkdown: "Secret inbox clip.",
          tags: ["shared"],
        },
      },
    );
    expect(forbiddenSpaceDoc.status).toBe(201);
    const forbiddenDocId = forbiddenSpaceDoc.body.document.id;

    // Create scoped token: write ONLY in spc_research with tagAllowlist=["shared"] and denyHardDelete=true
    const tokenRes = await apiJson<{ rawToken: string }>(request, "POST", "/api/v1/tokens", {
      data: {
        name: `scope-matrix-${suffix}`,
        scope: {
          permission: "write",
          spaceIds: ["spc_research"],
          includeDescendants: true,
          tagAllowlist: ["shared"],
          allowedKinds: ["article"],
          denyHardDelete: true,
        },
      },
    });
    expect(tokenRes.status).toBe(201);
    const scopedToken = tokenRes.body.rawToken;

    // 1. Authorized read succeeds
    const okRead = await apiJson<{ document: { id: string } }>(
      request,
      "GET",
      `/api/v1/documents/${allowedDocId}`,
      { token: scopedToken },
    );
    expect(okRead.status).toBe(200);
    expect(okRead.body.document.id).toBe(allowedDocId);

    // 2. Unauthorized space read is blocked (403)
    const blockedRead = await apiJson(
      request,
      "GET",
      `/api/v1/documents/${forbiddenDocId}`,
      { token: scopedToken },
    );
    expect(blockedRead.status).toBe(403);

    // 3. Unauthorized space write is blocked (403)
    const blockedWrite = await apiJson(request, "POST", "/api/v1/documents", {
      token: scopedToken,
      data: {
        spaceId: "spc_daily",
        kind: "article",
        title: "Unauthorized Write",
        contentMarkdown: "Blocked",
        tags: ["shared"],
      },
    });
    expect(blockedWrite.status).toBe(403);

    // 4. Hard delete is blocked when denyHardDelete: true (403)
    const blockedHardDelete = await apiJson(
      request,
      "DELETE",
      `/api/v1/documents/${allowedDocId}?hard=true`,
      { token: scopedToken },
    );
    expect(blockedHardDelete.status).toBe(403);

    // 5. /mcp enforces the exact same scope boundary on write & hard delete
    const mcpWriteDenied = await request.fetch("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      data: {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "create_document",
          arguments: {
            spaceId: "spc_inbox",
            kind: "article",
            title: "MCP Blocked Space",
            contentMarkdown: "nope",
            tags: ["shared"],
          },
        },
      },
    });
    expect(mcpWriteDenied.status()).toBe(200);
    const mcpWriteBody = (await mcpWriteDenied.json()) as { result?: { isError?: boolean } };
    expect(mcpWriteBody.result?.isError).toBe(true);

    // 6. SSRF still blocks loopback 127.0.0.1
    const ssrfRes = await apiJson(request, "POST", "/api/v1/clips/ingest-url", {
      data: { url: "http://127.0.0.1:9999/internal" },
    });
    expect(ssrfRes.status).toBe(403);
  });
});
