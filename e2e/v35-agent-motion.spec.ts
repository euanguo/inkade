import {
  apiJson,
  expect,
  getTodayLocalDate,
  MOD_KEY,
  test,
  uniqueSuffix,
} from "./fixtures.ts";

test.describe("Phase 17-20: V3.5 Agent Control Plane, Motion & Governance", () => {
  test("1. Daily Studio: AwaySummaryCard, ConflictRadarBanner, ApprovalCard + Undo, Agent Steering & AgentComposerPanel", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("daily-v35");
    const today = getTodayLocalDate();

    // Ensure today's daily outline exists
    const dailyRes = await apiJson<{ document: { id: string } }>(
      request,
      "GET",
      `/api/v1/documents/daily/${today}`,
    );
    expect(dailyRes.status).toBe(200);
    const dailyDocId = dailyRes.body.document.id;

    // Seed an article to test @ mention pills inside AgentComposerPanel
    const refDocRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `架构上下文-${suffix}`,
          contentMarkdown: `# 架构上下文-${suffix}\n\n用于验证 @ 引用胶囊与派发预览。`,
        },
      },
    );
    expect(refDocRes.status).toBe(201);
    const refDocId = refDocRes.body.document.id;

    // Seed waiting_input (with pendingApproval), running (same doc -> triggers ConflictRadarBanner),
    // failed, and completed bindings so AwaySummaryCard renders all categories cleanly.
    const approvalExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const waitRes = await apiJson<{ binding: { id: string } }>(
      request,
      "POST",
      "/api/v1/thread-bindings",
      {
        data: {
          documentId: dailyDocId,
          adeKind: "paseo",
          externalThreadId: `ext-wait-${suffix}`,
          title: `同步主题令牌至移动端-${suffix}`,
          status: "waiting_input",
          pendingApproval: {
            id: `apr-${suffix}`,
            action: `写入主色板与间距令牌-${suffix}`,
            risk: "medium",
            diffPreview: {
              oldSnippet: "--surface-dim: #F2EFEA",
              newSnippet: "--surface-dim: #ECEAE4",
            },
            expiresAt: approvalExpires,
          },
        },
      },
    );
    expect(waitRes.status).toBe(201);
    const waitBindingId = waitRes.body.binding.id;

    const runRes = await apiJson<{ binding: { id: string } }>(
      request,
      "POST",
      "/api/v1/thread-bindings",
      {
        data: {
          documentId: dailyDocId,
          adeKind: "bb",
          externalThreadId: `ext-run-${suffix}`,
          title: `校对流式排版动效-${suffix}`,
          status: "running",
          progressSteps: [
            {
              id: `stp1-${suffix}`,
              label: "扫描动效 Token 定义",
              status: "completed",
              durationMs: 180,
              sources: [{ label: "CSS", kind: "style" }],
            },
            {
              id: `stp2-${suffix}`,
              label: "核查滚动渐隐层次",
              status: "running",
              sources: [{ label: "TSX", kind: "code" }],
            },
          ],
        },
      },
    );
    expect(runRes.status).toBe(201);

    const failRes = await apiJson<{ binding: { id: string } }>(
      request,
      "POST",
      "/api/v1/thread-bindings",
      {
        data: {
          documentId: refDocId,
          adeKind: "cindy",
          externalThreadId: `ext-fail-${suffix}`,
          title: `剪藏解析超时-${suffix}`,
          status: "failed",
          lastSummary: "网页抓取超时",
        },
      },
    );
    expect(failRes.status).toBe(201);

    const doneRes = await apiJson<{ binding: { id: string } }>(
      request,
      "POST",
      "/api/v1/thread-bindings",
      {
        data: {
          documentId: refDocId,
          adeKind: "bb",
          externalThreadId: `ext-done-${suffix}`,
          title: `摘要梳理完成-${suffix}`,
          status: "completed",
          lastSummary: "已完成结构化输出",
        },
      },
    );
    expect(doneRes.status).toBe(201);

    // Pre-seed last-visit timestamp to 2 hours ago before opening /daily
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await page.addInitScript((ts) => {
      try {
        window.localStorage.setItem("inkade:daily:last-visit-at", ts);
      } catch {
        // ignore
      }
    }, twoHoursAgo);

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/daily");

    // 1) Calm V4 Today canvas: outline starts cleanly above fold; no AwaySummary or ConflictRadar banners
    const dailyEditor = page.locator(".inkade-pm-outliner .ProseMirror");
    await expect(dailyEditor).toBeVisible();
    const dailyBox = await dailyEditor.boundingBox();
    expect(dailyBox).not.toBeNull();
    expect(dailyBox!.y).toBeLessThan(420);
    await expect(page.locator('[data-slot="away-summary-card"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="conflict-radar-banner"]')).toHaveCount(0);

    // 2) Quiet Triage Strip surfaces async pending items cleanly in a single line
    const quietStrip = page.getByTestId("daily-quiet-triage-strip");
    await expect(quietStrip).toBeVisible();
    await expect(quietStrip).toContainText("待审批");
    await expect(quietStrip).toContainText("并发冲突");

    // 3) AgentStepsLog renders steps & sources in Daily view
    const stepsLog = page.locator('[data-slot="agent-steps-log"]').first();
    await expect(stepsLog).toBeVisible();
    await expect(stepsLog).toContainText("扫描动效 Token 定义");

    // 4) AgentComposerPanel @ mention pill + dispatch
    const composer = page.locator('[data-slot="agent-composer-panel"]').first();
    await expect(composer).toBeVisible();
    const expandBtn = composer.getByRole("button", { name: "展开派发面板" });
    if ((await expandBtn.count()) > 0) {
      await expandBtn.click();
    }
    await composer.getByRole("button", { name: "引用", exact: true }).click();
    await page
      .locator('[data-slot="popover-popup"]')
      .getByRole("button", { name: new RegExp(`架构上下文-${suffix}`) })
      .first()
      .click();
    await expect(composer.locator('[data-slot="composer-mention-pills"]')).toContainText(
      `架构上下文-${suffix}`,
    );
    const textarea = composer.locator("textarea");
    await textarea.fill(`梳理本次控制面板结构-${suffix}`);
    await composer.getByRole("button", { name: /派发线程/ }).click();
    await expect(composer.locator("textarea")).toHaveValue("");

    // 5) Toggle Focus Rail -> Agent Steering queued submission on running binding
    await page.getByRole("button", { name: "展开 / 收起今日焦点面板" }).click();
    const focusRail = page.getByTestId("daily-focus-rail");
    await expect(focusRail).toBeVisible();
    await expect(focusRail.locator('[data-slot="approval-card"]')).toHaveCount(0);
    const steerInput = focusRail.getByPlaceholder("发送引导指令给运行中的 Agent…").first();
    await expect(steerInput).toBeVisible();
    await steerInput.fill(`优先验证微脉冲降级-${suffix}`);
    await focusRail.getByRole("button", { name: "发送" }).first().click();
    await expect(focusRail).toContainText(`优先验证微脉冲降级-${suffix}`);

    // 6) Navigate from Quiet Triage Strip to Unified Linear Inbox -> Approval + Undo & Conflict Radar
    await quietStrip.getByRole("button", { name: "去 Inbox 处理" }).click();
    await expect(page).toHaveURL(/\/inbox/);

    const approvalQueueRow = page
      .locator('button[data-inbox-kind="blocking_question"]', { hasText: `写入主色板与间距令牌-${suffix}` })
      .first();
    await expect(approvalQueueRow).toBeVisible();
    await approvalQueueRow.click();

    const approvalCard = page.locator('[data-slot="approval-card"]').first();
    await expect(approvalCard).toBeVisible();
    await expect(approvalCard).toContainText(`写入主色板与间距令牌-${suffix}`);
    const [approveRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/thread-bindings/") && r.url().includes("/approve")),
      approvalCard.getByRole("button", { name: /批准/ }).click(),
    ]);
    expect(approveRes.status(), await approveRes.text()).toBe(200);
    await expect(approvalCard).toContainText("已批准并继续执行");
    await approvalCard.getByRole("button", { name: "撤销" }).click();
    await expect(approvalCard.getByRole("button", { name: /批准/ })).toBeVisible();

    const conflictQueueRow = page.locator('button[data-inbox-kind="conflict"]').first();
    await expect(conflictQueueRow).toBeVisible();
    await conflictQueueRow.click();
    const inboxConflictBanner = page.locator('[data-slot="conflict-radar-banner"]').first();
    await expect(inboxConflictBanner).toBeVisible();
    await expect(inboxConflictBanner.locator('[data-slot="conflict-host-pills"]')).toBeVisible();

    const failedQueueRow = page
      .locator('button[data-inbox-kind="failed"]', { hasText: `剪藏解析超时-${suffix}` })
      .first();
    await expect(failedQueueRow).toBeVisible();

    // Clean up seeded active conflict bindings so subsequent tests stay crisp
    await apiJson(request, "PATCH", `/api/v1/thread-bindings/${waitBindingId}`, {
      data: { status: "archived" },
    });
    await apiJson(request, "PATCH", `/api/v1/thread-bindings/${runRes.body.binding.id}`, {
      data: { status: "archived" },
    });
  });

  test("2. Threads Control Room Conflict Mode & Cross-Document Review Center (J/K/Y/N/Z)", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("review-threads");

    // Create scoped agent token to produce genuine agent-authored revisions (`unreadAgentUpdate = true`)
    const tokenRes = await apiJson<{ rawToken: string; token: { id: string } }>(
      request,
      "POST",
      "/api/v1/tokens",
      {
        data: {
          name: `Agent Review Bot-${suffix}`,
          scope: {
            permission: "write",
            spaceIds: ["spc_research"],
            includeDescendants: true,
            denyHardDelete: true,
          },
        },
      },
    );
    expect(tokenRes.status).toBe(201);
    const agentSecret = tokenRes.body.rawToken;

    const docRes = await apiJson<{ document: { id: string; version: number } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `跨文档审阅样本-${suffix}`,
          contentMarkdown: `# 审阅标题\n\n原始段落一 alpha。\n\n原始段落二 beta。`,
        },
      },
    );
    expect(docRes.status).toBe(201);
    const docId = docRes.body.document.id;

    // Agent updates doc producing v2 + unreadAgentUpdate: true
    const patchRes = await apiJson<{ document: { version: number; unreadAgentUpdate: boolean } }>(
      request,
      "PATCH",
      `/api/v1/documents/${docId}`,
      {
        token: agentSecret,
        data: {
          contentMarkdown: `# 审阅标题\n\nAgent 建议段落一 alpha-updated。\n\nAgent 建议段落二 beta-updated。`,
          baseVersion: docRes.body.document.version,
          changeSummary: `Agent 优化表述-${suffix}`,
        },
      },
    );
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.document.unreadAgentUpdate).toBe(true);

    // Seed two active bindings on the same document so /threads Conflict Radar displays conflict
    const b1 = await apiJson<{ binding: { id: string } }>(request, "POST", "/api/v1/thread-bindings", {
      data: {
        documentId: docId,
        adeKind: "bb",
        externalThreadId: `conflict-1-${suffix}`,
        title: `并发线程 A-${suffix}`,
        status: "running",
      },
    });
    const b2 = await apiJson<{ binding: { id: string } }>(request, "POST", "/api/v1/thread-bindings", {
      data: {
        documentId: docId,
        adeKind: "paseo",
        externalThreadId: `conflict-2-${suffix}`,
        title: `并发线程 B-${suffix}`,
        status: "waiting_input",
      },
    });
    expect(b1.status).toBe(201);
    expect(b2.status).toBe(201);

    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto("/threads");

    await expect(page.locator('[data-slot="conflict-radar-banner"]')).toBeVisible();
    await page.getByRole("button", { name: /冲突雷达/ }).click();
    await expect(page.getByText(`跨文档审阅样本-${suffix}`).first()).toBeVisible();

    // Quiet activity capsule replaces intrusive modal review wizard
    const quietPill = page.locator('[data-slot="topbar-quiet-activity-pill"]');
    await expect(quietPill).toBeVisible();
    await expect(page.locator('[data-slot="review-center-dialog"]')).toHaveCount(0);

    // Inspect unread agent changes calmly in Inbox -> Digest tab (single-key diff + Mark Read & Next)
    await page.goto("/inbox?tab=digest");
    const digestRow = page
      .locator('button[data-inbox-kind="digest"]', { hasText: `跨文档审阅样本-${suffix}` })
      .first();
    await expect(digestRow).toBeVisible();
    await digestRow.click();

    const inlineDiff = page.locator('[data-slot="inline-track-changes-viewer"]');
    await expect(inlineDiff).toBeVisible();
    await inlineDiff.click();
    await page.keyboard.press("y");
    await page.keyboard.press("z");
    await page.keyboard.press("n");
    await page.getByRole("button", { name: "标为已阅并继续" }).click();

    // Clean up bindings
    await apiJson(request, "PATCH", `/api/v1/thread-bindings/${b1.body.binding.id}`, {
      data: { status: "archived" },
    });
    await apiJson(request, "PATCH", `/api/v1/thread-bindings/${b2.body.binding.id}`, {
      data: { status: "archived" },
    });
  });

  test("3. Settings Governance: Typeset & Motion persistence, BucketMeter, AutonomyDial, AgentLedgerRow rollback & HoldConfirmButton", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("gov-v35");

    // Seed an article with multiple revisions by a write token so AgentLedgerRow shows v1->v2 and v2->v3 cascade
    const tokRes = await apiJson<{ rawToken: string; token: { id: string } }>(
      request,
      "POST",
      "/api/v1/tokens",
      {
        data: {
          name: `Governance Token-${suffix}`,
          scope: {
            permission: "write",
            spaceIds: ["spc_research"],
            includeDescendants: true,
            denyHardDelete: true,
          },
        },
      },
    );
    expect(tokRes.status).toBe(201);
    const tokenSecret = tokRes.body.rawToken;
    const tokenId = tokRes.body.token.id;

    const docRes = await apiJson<{ document: { id: string; version: number } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `可逆账本演示文档-${suffix}`,
          contentMarkdown: `# 初始版本 v1\n\n第一版基础段落。`,
        },
      },
    );
    expect(docRes.status).toBe(201);
    const docId = docRes.body.document.id;

    const p2 = await apiJson<{ document: { version: number } }>(
      request,
      "PATCH",
      `/api/v1/documents/${docId}`,
      {
        token: tokenSecret,
        data: {
          contentMarkdown: `# 修订版本 v2\n\n新增中间件结构定义。`,
          baseVersion: docRes.body.document.version,
          changeSummary: `v2 结构定义-${suffix}`,
        },
      },
    );
    expect(p2.status).toBe(200);

    const p3 = await apiJson<{ document: { version: number } }>(
      request,
      "PATCH",
      `/api/v1/documents/${docId}`,
      {
        token: tokenSecret,
        data: {
          contentMarkdown: `# 修订版本 v3\n\n补充多端同步与配额规则。`,
          baseVersion: p2.body.document.version,
          changeSummary: `v3 同步规则-${suffix}`,
        },
      },
    );
    expect(p3.status).toBe(200);

    // Also confirm server rejects hard delete when token has denyHardDelete: true
    const delCheck = await apiJson<{ error?: { code: string } }>(
      request,
      "DELETE",
      `/api/v1/documents/${docId}?hard=true`,
      { token: tokenSecret },
    );
    expect(delCheck.status).toBe(403);

    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto("/settings");

    // 1) Typeset & Motion persistence in Appearance
    await expect(page.locator('[data-slot="settings-workspace-status"]')).toBeVisible();
    await page.locator('[data-typeset-option="relaxed"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-typeset", "relaxed");
    await page.locator('[data-motion-option="reduced-pulse"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced-pulse");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-typeset", "relaxed");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced-pulse");

    // Reset motion profile back to comfort
    await page.locator('[data-motion-option="comfort"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "comfort");

    // 2) BucketMeter in Storage & Media
    await page.getByRole("link", { name: "标签与附件媒体" }).click();
    const bucketMeter = page.locator('[data-slot="bucket-meter"]').first();
    await expect(bucketMeter).toBeVisible();
    await expect(bucketMeter.locator('[data-slot="bucket-meter-track"]')).toBeVisible();

    // 3) AutonomyDial in Scope Rules
    await page.getByRole("link", { name: "Project Scope Rules" }).click();
    const autonomyDial = page.locator('[data-slot="autonomy-dial"]').first();
    await expect(autonomyDial).toBeVisible();
    await expect(autonomyDial.locator('[data-slot="autonomy-dial-server-lock"]')).toBeVisible();
    await autonomyDial.locator('[data-autonomy-stop="draft"]').click();
    await expect(autonomyDial).toHaveAttribute("data-level", "draft");

    // 4) AgentLedgerRow cascade hover + revision rollback
    await page.getByRole("link", { name: "Agent 审计日志" }).click();
    const ledgerTimeline = page.locator('[data-slot="audit-ledger-timeline"]');
    await expect(ledgerTimeline).toBeVisible();
    const docRows = ledgerTimeline
      .locator('[data-slot="agent-ledger-row"]')
      .filter({ hasText: `可逆账本演示文档-${suffix}` });
    // Expect at least 2 update rows (newest first: index 0 is v2->v3, index 1 is v1->v2)
    await expect(docRows.nth(1)).toBeVisible();
    const earlierRollbackBtn = docRows.nth(1).locator('[data-slot="agent-ledger-rollback"]');
    await earlierRollbackBtn.hover();
    await expect(docRows.nth(0).locator('[data-slot="agent-ledger-cascade-badge"]')).toBeVisible();
    const [rollbackRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/audit-logs/") && r.url().includes("/rollback")),
      earlierRollbackBtn.click(),
    ]);
    expect(rollbackRes.status(), await rollbackRes.text()).toBe(200);

    // Verify document content reverted to v1
    const restoredDoc = await apiJson<{ document: { contentMarkdown: string } }>(
      request,
      "GET",
      `/api/v1/documents/${docId}`,
    );
    expect(restoredDoc.body.document.contentMarkdown).toContain("初始版本 v1");

    // 5) HoldConfirmButton early-release cancel & full-hold execution in TokensSettings DangerZone
    await page.getByRole("link", { name: "API Tokens 与 MCP" }).click();
    const targetRow = page
      .getByText(`Governance Token-${suffix}`)
      .locator("xpath=ancestor::div[.//button[@data-slot='hold-confirm-button']][1]");
    const targetHoldBtn = targetRow.locator('[data-slot="hold-confirm-button"]').first();
    await expect(targetHoldBtn).toBeVisible();
    // Scroll into vertical center so fixed bottom-right toasts cannot occlude pointer hits
    await targetHoldBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = await targetHoldBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Early release after 300ms must cancel cleanly
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(300);
      await page.mouse.up();
      const stillActive = await apiJson<{ tokens: Array<{ id: string; revokedAt: string | null }> }>(
        request,
        "GET",
        "/api/v1/tokens",
      );
      const tokenRow = stillActive.body.tokens.find((t) => t.id === tokenId);
      expect(tokenRow?.revokedAt).toBeNull();

      // Hold past 1500ms triggers actual revocation
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const [revokeRes] = await Promise.all([
        page.waitForResponse((r) => r.url().includes(`/api/v1/tokens/${tokenId}/revoke`)),
        (async () => {
          await page.mouse.down();
          await page.waitForTimeout(1750);
          await page.mouse.up();
        })(),
      ]);
      expect(revokeRes.status()).toBe(200);
      const afterHold = await apiJson<{ tokens: Array<{ id: string; revokedAt: string | null }> }>(
        request,
        "GET",
        "/api/v1/tokens",
      );
      const revokedRow = afterHold.body.tokens.find((t) => t.id === tokenId);
      expect(revokedRow?.revokedAt).not.toBeNull();
    }
  });

  test("4. PublicSharePage: reading progress bar and heading TOC navigation", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("share-v35");
    const docRes = await apiJson<{ document: { id: string } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: `公开分享阅读节奏-${suffix}`,
          contentMarkdown: [
            `# 公开分享阅读节奏-${suffix}`,
            "",
            "## 第一章 背景与动机",
            "第一章节长文内容。".repeat(30),
            "",
            "## 第二章 流式安全排版",
            "第二章节长文内容。".repeat(30),
            "",
            "## 第三章 收尾验证",
            "第三章节长文内容。".repeat(30),
          ].join("\n"),
        },
      },
    );
    expect(docRes.status).toBe(201);

    const shareRes = await apiJson<{ shareLink: { token: string } }>(
      request,
      "POST",
      "/api/v1/share-links",
      {
        data: {
          documentId: docRes.body.document.id,
        },
      },
    );
    expect(shareRes.status).toBe(201);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/share/${shareRes.body.shareLink.token}`);
    await expect(page.locator('[data-slot="public-share-progress"]')).toBeVisible();
    await expect(page.locator('[data-slot="public-share-toc-trigger"]')).toBeVisible();
    await page.locator('[data-slot="public-share-toc-trigger"]').click();
    await expect(
      page.getByRole("navigation", { name: "文章目录" }).getByRole("link", {
        name: "第二章 流式安全排版",
      }),
    ).toBeVisible();
  });

  test("5. V6 Phase 40 Quiet Autonomy: NumberTicker clean DOM, Tasks Inbox isolation, Digest Undo Batch & Blocking Question", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix("p40-ui");
    const taskTitle = `静默自治待办验证-${suffix}`;

    // 1) Create a task so Tasks Inbox backing document is ensured, then verify NumberTicker DOM & system doc isolation
    const taskRes = await apiJson(request, "POST", "/api/v1/outline-nodes/tasks", {
      data: { title: taskTitle, priority: "p2" },
    });
    expect(taskRes.status).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/tasks");
    await expect(page.getByText(taskTitle).first()).toBeVisible();
    const tasksText = await page.locator("main").innerText();
    expect(tasksText).not.toContain("0123456789");

    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Tasks Inbox");

    await page.goto("/inbox?tab=clips");
    await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Tasks Inbox");
    await expect(page.locator("aside")).not.toContainText("Tasks Inbox");

    // 2) Agent writes quietly under shared X-Inkade-Batch-Id -> Digest card supports 1-click Undo Batch
    const tokenRes = await apiJson<{ rawToken: string }>(request, "POST", "/api/v1/tokens", {
      data: {
        name: `quiet-e2e-${suffix}`,
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

    const targetTitle = `静默整批测试-${suffix}`;
    const docRes = await apiJson<{ document: { id: string; version: number } }>(
      request,
      "POST",
      "/api/v1/documents",
      {
        data: {
          spaceId: "spc_research",
          kind: "article",
          title: targetTitle,
          contentMarkdown: `# ${targetTitle}\n\n原始内容基线 alpha。\n`,
        },
      },
    );
    expect(docRes.status).toBe(201);
    const docId = docRes.body.document.id;

    const batchId = `bat_e2e_${suffix}`;
    const patchRes = await request.patch(`/api/v1/documents/${docId}`, {
      headers: {
        authorization: `Bearer ${agentToken}`,
        "x-inkade-batch-id": batchId,
      },
      data: {
        contentMarkdown: `# ${targetTitle}\n\nAgent 静默写入内容 beta。\n`,
        expectedVersion: docRes.body.document.version,
        changeSummary: `Quiet batch write ${suffix}`,
      },
    });
    expect(patchRes.status()).toBe(200);

    await page.goto("/inbox?tab=digest");
    const digestRow = page
      .locator('button[data-inbox-kind="digest"]', { hasText: targetTitle })
      .first();
    await expect(digestRow).toBeVisible();
    await digestRow.click();

    await page.getByRole("button", { name: "整批撤回" }).click();
    await expect
      .poll(async () => {
        const res = await apiJson<{ document: { contentMarkdown: string } }>(
          request,
          "GET",
          `/api/v1/documents/${docId}`,
        );
        return res.body.document.contentMarkdown;
      })
      .toContain("原始内容基线 alpha。");

    // 3) Agent escalates via request-decision -> Exceptions tab & structured options submit
    const decisionRes = await request.post("/api/v1/thread-bindings/request-decision", {
      headers: { authorization: `Bearer ${agentToken}` },
      data: {
        documentId: docId,
        question: `发布前确认选项-${suffix}`,
        options: ["A. 保持内部草稿", "B. 发布外部摘要"],
        urgency: "high",
      },
    });
    expect(decisionRes.status()).toBe(201);
    const decisionBody = (await decisionRes.json()) as { binding: { id: string } };

    await page.goto("/inbox?tab=exceptions");
    const qRow = page
      .locator('button[data-inbox-kind="blocking_question"]', { hasText: `发布前确认选项-${suffix}` })
      .first();
    await expect(qRow).toBeVisible();
    await qRow.click();

    const qCard = page.locator('[data-slot="inbox-blocking-question-card"]').first();
    await expect(qCard).toBeVisible();
    await qCard.getByRole("button", { name: "B. 发布外部摘要" }).click();
    await qCard.getByRole("button", { name: "提交决策" }).click();

    await expect
      .poll(async () => {
        const res = await apiJson<{ binding: { pendingApproval?: { decision?: string | null } } }>(
          request,
          "GET",
          `/api/v1/thread-bindings/${decisionBody.binding.id}`,
        );
        return res.body.binding.pendingApproval?.decision ?? null;
      })
      .toBe("approved");

    await apiJson(request, "PATCH", `/api/v1/thread-bindings/${decisionBody.binding.id}`, {
      data: { status: "archived" },
    });
  });
});
