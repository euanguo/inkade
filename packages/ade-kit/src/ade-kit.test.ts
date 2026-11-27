import { describe, expect, it } from "bun:test";
import {
  asAgentStepId,
  asApprovalId,
  asDocumentId,
  asOutlineNodeId,
  asProjectRuleId,
  asSpaceId,
  asSteeringNoteId,
  asThreadBindingId,
  asWorkspaceId,
  type AdeThreadBinding,
  type ProjectScopeRule,
  type Space,
  type ThreadBindingId,
  type TokenScope,
  type UpdateThreadBindingInput,
} from "@inkade/core";
import {
  appendThreadReplyToOutline,
  buildAgentContextPrompt,
  buildDispatchPrompt,
  buildOutlineHierarchy,
  buildQueuedClaimPrompt,
  claimQueuedBindingWithSpawner,
  deliverPendingSteeringNotes,
  formatReferenceContextBlock,
  formatSteeringPromptAppendix,
  getPendingSteeringNotes,
  markSteeringNotesDelivered,
  matchProjectScopeRule,
  normalizeGitRemote,
  saveThreadReplyAsArticle,
  ThreadSyncCoordinator,
  truncateAssistantSummary,
  type AdeKitDocumentStore,
  type HostThreadSnapshot,
  type ThreadBindingStore,
} from "./index.ts";

function makeRule(
  overrides: Partial<ProjectScopeRule> & Pick<ProjectScopeRule, "id" | "matchType" | "pattern">,
): ProjectScopeRule {
  return {
    workspaceId: asWorkspaceId("ws_1"),
    writableSpaceIds: [asSpaceId("spc_proj")],
    readonlySpaceIds: [asSpaceId("spc_ref")],
    priority: 0,
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    ...overrides,
  };
}

function makeBinding(overrides: Partial<AdeThreadBinding> = {}): AdeThreadBinding {
  return {
    id: asThreadBindingId("bnd_1"),
    workspaceId: asWorkspaceId("ws_1"),
    documentId: asDocumentId("doc_1"),
    nodeId: asOutlineNodeId("nod_1"),
    selectionAnchor: null,
    adeKind: "bb",
    externalWorkspaceId: "proj_1",
    externalThreadId: "thr_1",
    deepLink: "/threads/thr_1",
    title: "Investigate caching",
    status: "queued",
    lastSummary: null,
    unreadResult: false,
    lastSyncedAt: "2026-11-24T00:00:00.000Z",
    createdAt: "2026-11-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("scope-rules", () => {
  it("normalizes ssh, scp, and https git remotes equivalently", () => {
    expect(normalizeGitRemote("git@github.com:Inkade/Inkade.git")).toBe("github.com/inkade/inkade");
    expect(normalizeGitRemote("ssh://git@github.com:22/Inkade/Inkade.git")).toBe(
      "github.com/inkade/inkade",
    );
    expect(normalizeGitRemote("https://token@github.com/Inkade/Inkade/")).toBe(
      "github.com/inkade/inkade",
    );
  });

  it("picks highest-priority matching rule and computes readable space union", () => {
    const rules = [
      makeRule({
        id: asProjectRuleId("rul_path"),
        matchType: "path_glob",
        pattern: "/Users/*/work/**",
        writableSpaceIds: [asSpaceId("spc_general")],
        readonlySpaceIds: [asSpaceId("spc_docs")],
        priority: 10,
      }),
      makeRule({
        id: asProjectRuleId("rul_remote"),
        matchType: "git_remote",
        pattern: "https://github.com/acme/inkade.git",
        writableSpaceIds: [asSpaceId("spc_inkade"), asSpaceId("spc_daily")],
        readonlySpaceIds: [asSpaceId("spc_daily"), asSpaceId("spc_research")],
        defaultResearchSpaceId: asSpaceId("spc_research"),
        priority: 50,
      }),
      makeRule({
        id: asProjectRuleId("rul_name"),
        matchType: "repo_name",
        pattern: "inkade",
        writableSpaceIds: [asSpaceId("spc_name")],
        readonlySpaceIds: [],
        priority: 20,
      }),
    ];

    const matched = matchProjectScopeRule(
      {
        repoName: "inkade",
        gitRemote: "git@github.com:acme/inkade.git",
        localPath: "/Users/alice/work/inkade",
      },
      rules,
    );

    expect(matched).not.toBeNull();
    expect(matched?.rule.id).toBe(asProjectRuleId("rul_remote"));
    expect(matched?.writableSpaceIds).toEqual([asSpaceId("spc_inkade"), asSpaceId("spc_daily")]);
    expect(matched?.readonlySpaceIds).toEqual([asSpaceId("spc_daily"), asSpaceId("spc_research")]);
    expect(matched?.allReadableSpaceIds).toEqual([
      asSpaceId("spc_inkade"),
      asSpaceId("spc_daily"),
      asSpaceId("spc_research"),
    ]);
  });

  it("matches path_glob with Windows backslashes and repo_name wildcards", () => {
    const rules = [
      makeRule({
        id: asProjectRuleId("rul_win"),
        matchType: "path_glob",
        pattern: "C:/projects/inkade*",
        priority: 5,
      }),
      makeRule({
        id: asProjectRuleId("rul_repo_glob"),
        matchType: "repo_name",
        pattern: "inkade-*",
        priority: 1,
      }),
    ];

    const matchedWin = matchProjectScopeRule(
      { localPath: "C:\\projects\\inkade-core\\" },
      rules,
    );
    expect(matchedWin?.rule.id).toBe(asProjectRuleId("rul_win"));

    const matchedRepo = matchProjectScopeRule({ repoName: "Inkade-Web" }, rules);
    expect(matchedRepo?.rule.id).toBe(asProjectRuleId("rul_repo_glob"));

    expect(matchProjectScopeRule({ repoName: "other" }, rules)).toBeNull();
  });
});

describe("ThreadSyncCoordinator", () => {
  it("truncates long summaries cleanly", () => {
    expect(truncateAssistantSummary("   \n  ", 240)).toBeNull();
    const longText = `Hello   world\n${"a".repeat(260)}`;
    const truncated = truncateAssistantSummary(longText, 240);
    expect(truncated).not.toBeNull();
    expect(truncated!.length).toBeLessThanOrEqual(240);
    expect(truncated!.endsWith("…")).toBe(true);
  });

  it("debounces rapid transitions and skips redundant idempotent updates", async () => {
    const calls: Array<{ bindingId: ThreadBindingId; input: UpdateThreadBindingInput }> = [];
    let current = makeBinding();
    const store: ThreadBindingStore = {
      updateThreadBinding(bindingId, input) {
        calls.push({ bindingId, input });
        current = {
          ...current,
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.lastSummary !== undefined ? { lastSummary: input.lastSummary } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.unreadResult !== undefined ? { unreadResult: input.unreadResult } : {}),
          ...(input.lastSyncedAt !== undefined ? { lastSyncedAt: input.lastSyncedAt } : {}),
        };
        return Promise.resolve(current);
      },
    };

    const coordinator = new ThreadSyncCoordinator(store, {
      debounceMs: 25,
      now: () => "2026-11-24T01:00:00.000Z",
    });

    const p1 = coordinator.recordTransition(current, { status: "running" });
    const p2 = coordinator.recordTransition(current, {
      status: "completed",
      summary: `Done: ${"x".repeat(300)}`,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(calls.length).toBe(1);
    expect(calls[0]?.input.status).toBe("completed");
    expect(calls[0]?.input.unreadResult).toBe(true);
    expect(calls[0]?.input.lastSummary?.length).toBeLessThanOrEqual(240);
    expect(r1?.status).toBe("completed");
    expect(r2?.status).toBe("completed");

    // Duplicate transition with identical summary is skipped.
    const dup = await coordinator.recordTransition(current, {
      status: "completed",
      summary: current.lastSummary,
    });
    expect(dup).toBeNull();
    expect(calls.length).toBe(1);
    coordinator.dispose();
  });

  it("reconciles missed startup transitions against host snapshots", async () => {
    const calls: Array<{ bindingId: ThreadBindingId; input: UpdateThreadBindingInput }> = [];
    const bindings: AdeThreadBinding[] = [
      makeBinding({ id: asThreadBindingId("bnd_1"), externalThreadId: "thr_1", status: "running" }),
      makeBinding({
        id: asThreadBindingId("bnd_2"),
        externalThreadId: "thr_2",
        status: "completed",
        unreadResult: true,
      }),
      makeBinding({
        id: asThreadBindingId("bnd_3"),
        externalThreadId: "thr_missing",
        status: "running",
      }),
    ];

    const store: ThreadBindingStore = {
      updateThreadBinding(bindingId, input) {
        calls.push({ bindingId, input });
        const found = bindings.find((b) => b.id === bindingId)!;
        return Promise.resolve({
          ...found,
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.lastSummary !== undefined ? { lastSummary: input.lastSummary } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.unreadResult !== undefined ? { unreadResult: input.unreadResult } : {}),
        });
      },
    };

    const snapshots: HostThreadSnapshot[] = [
      {
        externalThreadId: "thr_1",
        status: "failed",
        summary: "Tests failed on step 2",
      },
      {
        externalThreadId: "thr_2",
        status: "completed",
      },
    ];

    const coordinator = new ThreadSyncCoordinator(store, {
      now: () => "2026-11-24T01:05:00.000Z",
    });
    const report = await coordinator.reconcile(bindings, snapshots);

    expect(report.updated.length).toBe(1);
    expect(report.updated[0]?.id).toBe(asThreadBindingId("bnd_1"));
    expect(report.updated[0]?.status).toBe("failed");
    expect(report.updated[0]?.unreadResult).toBe(true);
    expect(report.skipped).toBe(1);
    expect(report.missing).toEqual([asThreadBindingId("bnd_3")]);
    expect(calls.length).toBe(1);
    coordinator.dispose();
  });
});

describe("prompts", () => {
  it("builds dispatch prompt with Inkade callback coordinates and hierarchy", () => {
    const prompt = buildDispatchPrompt({
      document: {
        id: asDocumentId("doc_daily_1"),
        spaceId: asSpaceId("spc_daily"),
        kind: "outline",
        title: "Daily · 2026-11-24",
        dailyDate: "2026-11-24",
      },
      node: {
        id: asOutlineNodeId("nod_task"),
        contentMarkdown: "Benchmark FTS5 prefix queries",
        checked: false,
      },
      ancestors: [{ id: asOutlineNodeId("nod_root"), contentMarkdown: "Today Focus" }],
      children: [{ id: asOutlineNodeId("nod_sub"), contentMarkdown: "Measure 10k docs" }],
      projectRule: {
        id: asProjectRuleId("rul_1"),
        defaultInboxSpaceId: asSpaceId("spc_inbox"),
        defaultResearchSpaceId: asSpaceId("spc_research"),
        extraInstructions: "Prefer reproducible scripts.",
      },
    });

    expect(prompt).toContain("Benchmark FTS5 prefix queries");
    expect(prompt).toContain("documentId: doc_daily_1");
    expect(prompt).toContain("nodeId: nod_task");
    expect(prompt).toContain("spaceId: spc_daily");
    expect(prompt).toContain("defaultResearchSpaceId: spc_research");
    expect(prompt).toContain("Today Focus");
    expect(prompt).toContain("Measure 10k docs");
    expect(prompt).toContain('parentNodeId="nod_task"');
  });

  it("builds agent context prompt with scope and matched rule annotations", () => {
    const scope: TokenScope = {
      permission: "write",
      spaceIds: [asSpaceId("spc_proj"), asSpaceId("spc_res")],
      includeDescendants: true,
      allowedKinds: ["outline", "article"],
      denyHardDelete: true,
    };
    const spaces: Array<Pick<Space, "id" | "name" | "slug">> = [
      { id: asSpaceId("spc_proj"), name: "Inkade", slug: "inkade" },
      { id: asSpaceId("spc_res"), name: "Research", slug: "research" },
    ];
    const matched = matchProjectScopeRule(
      { repoName: "inkade" },
      [
        makeRule({
          id: asProjectRuleId("rul_1"),
          matchType: "repo_name",
          pattern: "inkade",
          writableSpaceIds: [asSpaceId("spc_proj")],
          readonlySpaceIds: [asSpaceId("spc_res")],
          defaultResearchSpaceId: asSpaceId("spc_res"),
          extraInstructions: "Cite file paths.",
        }),
      ],
    );

    const text = buildAgentContextPrompt(scope, spaces, undefined, matched);
    expect(text).toContain("Permission level: write (hard delete: blocked)");
    expect(text).toContain("Inkade (inkade, id=spc_proj) [writable]");
    expect(text).toContain("Research (research, id=spc_res) [read-only]");
    expect(text).toContain("Default research spaceId: spc_res");
    expect(text).toContain("Cite file paths.");
  });
});

describe("dispatch & companion reply helpers", () => {
  it("builds outline hierarchy and claims queued bindings with spawner", async () => {
    const doc = {
      id: asDocumentId("doc_daily_2"),
      workspaceId: asWorkspaceId("ws_1"),
      spaceId: asSpaceId("spc_daily"),
      kind: "outline" as const,
      title: "Daily · 2026-11-24",
      slug: "daily-2026-11-24",
      dailyDate: "2026-11-24",
      contentMarkdown: "",
      contentJson: null,
      contentText: "",
      excerpt: "",
      tags: [],
      version: 1,
      pinned: false,
      unreadAgentUpdate: false,
      lastEditedByType: "system" as const,
      trashedAt: null,
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
    };
    const nodes = [
      {
        id: asOutlineNodeId("nod_root"),
        documentId: asDocumentId("doc_daily_2"),
        parentNodeId: null,
        orderKey: "a0",
        contentMarkdown: "Backend",
        contentText: "Backend",
        checked: null,
        collapsed: false,
        authorType: "human" as const,
        authorId: null,
        sourceBindingId: null,
        createdAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
        deletedAt: null,
      },
      {
        id: asOutlineNodeId("nod_target"),
        documentId: asDocumentId("doc_daily_2"),
        parentNodeId: asOutlineNodeId("nod_root"),
        orderKey: "a1",
        contentMarkdown: "Optimize SQLite WAL checkpoints",
        contentText: "Optimize SQLite WAL checkpoints",
        checked: false,
        collapsed: false,
        authorType: "human" as const,
        authorId: null,
        sourceBindingId: null,
        createdAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
        deletedAt: null,
      },
    ];

    const hierarchy = buildOutlineHierarchy(nodes, asOutlineNodeId("nod_target"));
    expect(hierarchy.node?.id).toBe(asOutlineNodeId("nod_target"));
    expect(hierarchy.ancestors.map((a) => a.id)).toEqual([asOutlineNodeId("nod_root")]);

    const queued = makeBinding({
      id: asThreadBindingId("bnd_q"),
      documentId: asDocumentId("doc_daily_2"),
      nodeId: asOutlineNodeId("nod_target"),
      externalThreadId: "thr_pending_123",
      status: "queued",
      lastSummary: "Captured from mobile",
    });

    const promptPreview = buildQueuedClaimPrompt({
      binding: queued,
      document: doc,
      node: hierarchy.node,
      ancestors: hierarchy.ancestors,
    });
    expect(promptPreview).toContain("Captured from mobile");
    expect(promptPreview).toContain("Optimize SQLite WAL checkpoints");

    let claimedArgs: unknown = null;
    const store: AdeKitDocumentStore = {
      documents: {
        get: () => Promise.resolve(doc),
        create: (input) =>
          Promise.resolve({
            ...doc,
            id: asDocumentId("doc_art_1"),
            spaceId: input.spaceId,
            kind: input.kind,
            title: input.title,
            contentMarkdown: input.contentMarkdown ?? "",
            contentText: input.contentMarkdown ?? "",
            tags: [...(input.tags ?? [])],
          }),
      },
      outlineNodes: {
        list: () => Promise.resolve(nodes),
        create: (input) =>
          Promise.resolve({
            id: asOutlineNodeId("nod_created"),
            documentId: input.documentId,
            parentNodeId: input.parentNodeId ?? null,
            orderKey: "a2",
            contentMarkdown: input.contentMarkdown,
            contentText: input.contentMarkdown,
            checked: input.checked ?? null,
            collapsed: false,
            authorType: input.authorType ?? "agent",
            authorId: null,
            sourceBindingId: input.sourceBindingId ?? null,
            createdAt: "2026-11-24T00:00:00.000Z",
            updatedAt: "2026-11-24T00:00:00.000Z",
            deletedAt: null,
          }),
      },
      threadBindings: {
        claim: (bindingId, input) => {
          claimedArgs = { bindingId, input };
          return Promise.resolve({
            ...queued,
            externalThreadId: input.externalThreadId,
            externalWorkspaceId: input.externalWorkspaceId ?? null,
            deepLink: input.deepLink ?? null,
            status: input.status ?? "running",
          });
        },
      },
    };

    const claimed = await claimQueuedBindingWithSpawner(store, queued, (ctx) => {
      expect(ctx.prompt).toContain("nodeId: nod_target");
      return Promise.resolve({
        externalThreadId: "thr_live_9",
        externalWorkspaceId: "proj_1",
        deepLink: "/threads/thr_live_9",
        status: "running",
      });
    });

    expect(claimed.threadId).toBe("thr_live_9");
    expect(claimed.binding.status).toBe("running");
    expect(claimedArgs).toEqual({
      bindingId: asThreadBindingId("bnd_q"),
      input: {
        externalThreadId: "thr_live_9",
        externalWorkspaceId: "proj_1",
        deepLink: "/threads/thr_live_9",
        status: "running",
      },
    });

    const childNode = await appendThreadReplyToOutline(store, {
      documentId: asDocumentId("doc_daily_2"),
      parentNodeId: asOutlineNodeId("nod_target"),
      replyMarkdown: "WAL autocheckpoint 1000 pages works best.",
      sourceBindingId: asThreadBindingId("bnd_q"),
    });
    expect(childNode.parentNodeId).toBe(asOutlineNodeId("nod_target"));
    expect(childNode.authorType).toBe("agent");

    const saved = await saveThreadReplyAsArticle(store, {
      spaceId: asSpaceId("spc_research"),
      title: "SQLite WAL Notes",
      replyMarkdown: "# WAL Notes\n\nDetails here.",
      tags: ["sqlite"],
      sourceDocumentId: asDocumentId("doc_daily_2"),
      sourceNodeId: asOutlineNodeId("nod_target"),
      sourceBindingId: asThreadBindingId("bnd_q"),
      linkFromOutline: true,
    });
    expect(saved.document.kind).toBe("article");
    expect(saved.linkedNode?.contentMarkdown).toContain("[[SQLite WAL Notes]]");
  });

  it("formats @ mention reference context blocks without breaking legacy prompt output", () => {
    const baseInput = {
      document: {
        id: asDocumentId("doc_1"),
        spaceId: asSpaceId("spc_daily"),
        kind: "outline" as const,
        title: "Daily · 2026-11-24",
        dailyDate: "2026-11-24",
      },
      node: {
        id: asOutlineNodeId("nod_1"),
        contentMarkdown: "Compare architectures",
        checked: false,
      },
    };
    const withoutRefs = buildDispatchPrompt(baseInput);
    const withEmptyRefs = buildDispatchPrompt({ ...baseInput, references: [] });
    expect(withEmptyRefs).toBe(withoutRefs);
    expect(withoutRefs).not.toContain("Referenced Context (@mentions)");

    const block = formatReferenceContextBlock([
      {
        id: "doc_ref_1",
        kind: "article",
        title: "SQLite Architecture",
        spaceId: asSpaceId("spc_research"),
        snippet: "Uses WAL mode and FTS5 unicode61 tokenization.",
      },
    ]);
    expect(block).toContain("## Referenced Context (@mentions)");
    expect(block).toContain("@SQLite Architecture (article, id=doc_ref_1, spaceId=spc_research)");
    expect(block).toContain("Uses WAL mode and FTS5 unicode61 tokenization.");

    const withRefs = buildDispatchPrompt({
      ...baseInput,
      references: [
        {
          id: "doc_ref_1",
          kind: "article",
          title: "SQLite Architecture",
          snippet: "Uses WAL mode.",
        },
      ],
    });
    expect(withRefs).toContain("@SQLite Architecture");
    expect(withRefs).toContain("Uses WAL mode.");
  });

  it("syncs progressSteps/pendingApproval and delivers steering notes prioritizing interrupts", async () => {
    let binding = makeBinding({
      status: "running",
      steeringQueue: [
        {
          id: asSteeringNoteId("str_q1"),
          text: "Include benchmark numbers",
          mode: "queued",
          createdAt: "2026-11-24T10:01:00.000Z",
          deliveredAt: null,
        },
        {
          id: asSteeringNoteId("str_old"),
          text: "Already read",
          mode: "interrupt",
          createdAt: "2026-11-24T10:00:00.000Z",
          deliveredAt: "2026-11-24T10:00:30.000Z",
        },
        {
          id: asSteeringNoteId("str_int"),
          text: "Stop touching config files",
          mode: "interrupt",
          createdAt: "2026-11-24T10:02:00.000Z",
          deliveredAt: null,
        },
      ],
    });

    const store: ThreadBindingStore = {
      updateThreadBinding(_id, input) {
        binding = {
          ...binding,
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.progressSteps !== undefined ? { progressSteps: input.progressSteps } : {}),
          ...(input.pendingApproval !== undefined
            ? { pendingApproval: input.pendingApproval }
            : {}),
          ...(input.steeringQueue !== undefined ? { steeringQueue: input.steeringQueue } : {}),
          ...(input.unreadResult !== undefined ? { unreadResult: input.unreadResult } : {}),
        };
        return Promise.resolve(binding);
      },
    };

    const coordinator = new ThreadSyncCoordinator(store, {
      debounceMs: 0,
      now: () => "2026-11-24T10:03:00.000Z",
    });

    const updated = await coordinator.recordTransition(binding, {
      status: "waiting_input",
      progressSteps: [
        { id: asAgentStepId("stp_1"), label: "Analyzing", status: "completed", durationMs: 50 },
      ],
      pendingApproval: {
        id: asApprovalId("apr_1"),
        action: "Apply refactor",
        risk: "medium",
      },
    });
    expect(updated?.status).toBe("waiting_input");
    expect(updated?.progressSteps).toHaveLength(1);
    expect(updated?.pendingApproval?.action).toBe("Apply refactor");

    const pending = getPendingSteeringNotes(binding);
    expect(pending.map((n) => n.id)).toEqual([
      asSteeringNoteId("str_int"),
      asSteeringNoteId("str_q1"),
    ]);
    const appendix = formatSteeringPromptAppendix(pending);
    expect(appendix).toContain("[INTERRUPT]");
    expect(appendix).toContain("[QUEUED]");

    const deliveredTexts: string[] = [];
    const delivery = await deliverPendingSteeringNotes(
      store,
      binding,
      (_notes, prompt) => {
        deliveredTexts.push(prompt);
        return Promise.resolve();
      },
      { now: () => "2026-11-24T10:04:00.000Z" },
    );
    expect(delivery.delivered.map((n) => n.id)).toEqual([
      asSteeringNoteId("str_int"),
      asSteeringNoteId("str_q1"),
    ]);
    expect(deliveredTexts).toHaveLength(1);
    expect(getPendingSteeringNotes(delivery.binding!)).toEqual([]);

    // Idempotent second delivery does nothing
    const noOp = await markSteeringNotesDelivered(store, binding, [asSteeringNoteId("str_int")]);
    expect(noOp).toBeNull();
    coordinator.dispose();
  });
});
