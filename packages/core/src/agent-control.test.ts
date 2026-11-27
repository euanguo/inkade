import { describe, expect, test } from "bun:test";
import {
  approveThreadBindingInputSchema,
  asApiTokenId,
  asAuditLogId,
  asDocumentId,
  asOutlineNodeId,
  asRevisionId,
  asSpaceId,
  asThreadBindingId,
  asWorkspaceId,
  autonomyLevelToScopePatch,
  buildCompactDiffPreview,
  computeLedgerCascade,
  createThreadBindingInputSchema,
  deriveAutonomyPolicy,
  deriveQuietGovernanceSummary,
  detectBindingConflicts,
  quietModeToScopePatch,
  renderOutlineNodesToMarkdown,
  steerThreadBindingInputSchema,
  updateThreadBindingInputSchema,
  type AdeThreadBinding,
  type AuditLogRecord,
  type OutlineNode,
  type TokenScope,
} from "./index.ts";

function makeBinding(overrides: Partial<AdeThreadBinding> = {}): AdeThreadBinding {
  return {
    id: asThreadBindingId("bnd_1"),
    workspaceId: asWorkspaceId("ws_1"),
    documentId: asDocumentId("doc_1"),
    nodeId: null,
    selectionAnchor: null,
    adeKind: "bb",
    externalWorkspaceId: null,
    externalThreadId: "thr_1",
    deepLink: null,
    title: "Agent Thread",
    status: "running",
    lastSummary: null,
    unreadResult: false,
    lastSyncedAt: "2026-11-24T10:00:00.000Z",
    createdAt: "2026-11-24T10:00:00.000Z",
    ...overrides,
  };
}

function makeAudit(overrides: Partial<AuditLogRecord> = {}): AuditLogRecord {
  return {
    id: asAuditLogId("aud_1"),
    workspaceId: asWorkspaceId("ws_1"),
    principalKind: "token",
    tokenId: asApiTokenId("tok_1"),
    tokenName: "agent-token",
    transport: "mcp",
    action: "update_document",
    resource: "mcp:update_document",
    spaceId: asSpaceId("spc_research"),
    documentId: asDocumentId("doc_1"),
    decision: "allowed",
    reason: null,
    summary: "Updated doc",
    createdAt: "2026-11-24T10:00:00.000Z",
    beforeRevisionId: asRevisionId("rev_1"),
    afterRevisionId: asRevisionId("rev_2"),
    diffPreview: { oldSnippet: "old", newSnippet: "new" },
    reversible: true,
    irreversibleReason: null,
    ...overrides,
  };
}

describe("Phase 18 agent control & autonomy core primitives", () => {
  test("autonomy presets always deny hard_delete and round-trip cleanly", () => {
    const baseScope: TokenScope = {
      permission: "read",
      spaceIds: [asSpaceId("spc_research")],
      includeDescendants: true,
      denyHardDelete: false,
    };

    const autoScope: TokenScope = { ...baseScope, ...autonomyLevelToScopePatch("auto") };
    expect(autoScope.permission).toBe("write");
    expect(autoScope.denyHardDelete).toBe(true);
    const autoPolicy = deriveAutonomyPolicy(autoScope);
    expect(autoPolicy.level).toBe("auto");
    expect(autoPolicy.lockedActions).toContain("hard_delete");
    expect(autoPolicy.autoActions).toContain("write");

    const draftScope: TokenScope = { ...baseScope, ...autonomyLevelToScopePatch("draft") };
    expect(draftScope.permission).toBe("append");
    expect(draftScope.denyHardDelete).toBe(true);
    const draftPolicy = deriveAutonomyPolicy(draftScope);
    expect(draftPolicy.level).toBe("draft");
    expect(draftPolicy.autoActions).toEqual(["read", "append"]);
    expect(draftPolicy.approvalRequiredActions).toEqual([]);
    expect(draftPolicy.lockedActions).toContain("write");
    expect(draftPolicy.lockedActions).toContain("hard_delete");

    const askScope: TokenScope = { ...baseScope, ...autonomyLevelToScopePatch("ask") };
    expect(askScope.permission).toBe("read");
    expect(askScope.denyHardDelete).toBe(true);
    const askPolicy = deriveAutonomyPolicy(askScope);
    expect(askPolicy.level).toBe("ask");
    expect(askPolicy.autoActions).toEqual(["read"]);
    expect(askPolicy.approvalRequiredActions).toEqual([]);
    expect(askPolicy.lockedActions).toContain("append");
    expect(askPolicy.lockedActions).toContain("hard_delete");

    const quietAutonomous = deriveQuietGovernanceSummary({
      ...baseScope,
      ...quietModeToScopePatch("autonomous"),
    });
    expect(quietAutonomous.mode).toBe("autonomous");
    expect(quietAutonomous.rollbackGuaranteed).toBe(true);
    expect(quietAutonomous.blockedActions).toContain("hard_delete");

    const quietSandbox = deriveQuietGovernanceSummary({
      ...baseScope,
      ...quietModeToScopePatch("sandbox_only"),
    });
    expect(quietSandbox.mode).toBe("sandbox_only");
    expect(quietSandbox.allowedActions).toEqual(["read", "append"]);

    const quietReadOnly = deriveQuietGovernanceSummary({
      ...baseScope,
      ...quietModeToScopePatch("read_only"),
    });
    expect(quietReadOnly.mode).toBe("read_only");
    expect(quietReadOnly.blockedActions).toContain("append");

    const adminPolicy = deriveAutonomyPolicy({
      permission: "admin",
      spaceIds: "*",
      includeDescendants: true,
      denyHardDelete: true,
    });
    expect(adminPolicy.level).toBe("auto");
    expect(adminPolicy.lockedActions).toContain("hard_delete");
  });

  test("validates extended thread binding schemas and control inputs", () => {
    const created = createThreadBindingInputSchema.parse({
      documentId: "doc_1",
      nodeId: "nod_1",
      adeKind: "bb",
      externalThreadId: "thr_1",
      title: "Refactor auth",
      parentBindingId: "bnd_parent",
      progressSteps: [
        {
          id: "stp_1",
          label: "Read schema",
          status: "completed",
          durationMs: 420,
          sources: [{ label: "packages/core/src/types.ts", kind: "file" }],
        },
        {
          id: "stp_2",
          label: "Await approval",
          status: "running",
        },
      ],
      pendingApproval: {
        id: "apr_1",
        action: "Update Architecture spec",
        risk: "medium",
        diffPreview: { oldSnippet: "v1", newSnippet: "v2" },
        expiresAt: "2026-11-24T12:00:00.000Z",
      },
      steeringQueue: [
        {
          id: "str_1",
          text: "Focus on SQLite invariants",
          mode: "queued",
          createdAt: "2026-11-24T10:05:00.000Z",
          deliveredAt: null,
        },
      ],
    });
    expect(created.progressSteps).toHaveLength(2);
    expect(created.pendingApproval?.risk).toBe("medium");

    const updated = updateThreadBindingInputSchema.parse({
      pendingApproval: {
        id: "apr_1",
        action: "Update Architecture spec",
        risk: "medium",
        decision: "approved",
        decisionNote: "Looks good",
        decidedAt: "2026-11-24T10:10:00.000Z",
      },
    });
    expect(updated.pendingApproval?.decision).toBe("approved");

    expect(
      approveThreadBindingInputSchema.parse({
        decision: "adjusted",
        note: "Keep headings concise",
        alwaysAllow: false,
      }).decision,
    ).toBe("adjusted");

    expect(
      steerThreadBindingInputSchema.parse({
        text: "  Switch to outline mode  ",
        mode: "interrupt",
      }),
    ).toEqual({
      text: "Switch to outline mode",
      mode: "interrupt",
    });

    expect(() =>
      steerThreadBindingInputSchema.parse({ text: "   ", mode: "queued" }),
    ).toThrow();
  });

  test("detectBindingConflicts identifies node, selection, and document concurrency deterministically", () => {
    const bindings: AdeThreadBinding[] = [
      // Completed thread on doc_clean -> no conflict
      makeBinding({ id: asThreadBindingId("bnd_done"), documentId: asDocumentId("doc_clean"), status: "completed" }),
      makeBinding({ id: asThreadBindingId("bnd_run"), documentId: asDocumentId("doc_clean"), status: "running" }),

      // Node-level overlap on doc_b (declared before doc_a to check deterministic sort)
      makeBinding({
        id: asThreadBindingId("bnd_b2"),
        documentId: asDocumentId("doc_b"),
        nodeId: asOutlineNodeId("nod_shared"),
        status: "waiting_input",
        createdAt: "2026-11-24T10:02:00.000Z",
      }),
      makeBinding({
        id: asThreadBindingId("bnd_b1"),
        documentId: asDocumentId("doc_b"),
        nodeId: asOutlineNodeId("nod_shared"),
        status: "running",
        createdAt: "2026-11-24T10:01:00.000Z",
      }),

      // Selection-level overlap on doc_a
      makeBinding({
        id: asThreadBindingId("bnd_a1"),
        documentId: asDocumentId("doc_a"),
        selectionAnchor: { quote: "Dual engine write integrity", startOffset: 10, endOffset: 37 },
        status: "running",
      }),
      makeBinding({
        id: asThreadBindingId("bnd_a2"),
        documentId: asDocumentId("doc_a"),
        selectionAnchor: { quote: "write integrity", startOffset: 22, endOffset: 45 },
        status: "running",
      }),

      // Document-level concurrency on doc_c (distinct nodes, non-overlapping)
      makeBinding({ id: asThreadBindingId("bnd_c1"), documentId: asDocumentId("doc_c"), nodeId: asOutlineNodeId("nod_1"), status: "running" }),
      makeBinding({ id: asThreadBindingId("bnd_c2"), documentId: asDocumentId("doc_c"), nodeId: asOutlineNodeId("nod_2"), status: "waiting_input" }),
    ];

    const conflicts = detectBindingConflicts(bindings);
    expect(conflicts.map((c) => [c.documentId, c.scope, c.nodeId])).toEqual([
      [asDocumentId("doc_a"), "selection", null],
      [asDocumentId("doc_b"), "node", asOutlineNodeId("nod_shared")],
      [asDocumentId("doc_c"), "document", null],
    ]);
    expect(conflicts[1]?.bindingIds).toEqual([asThreadBindingId("bnd_b1"), asThreadBindingId("bnd_b2")]);
  });

  test("computeLedgerCascade returns downstream document mutations excluding reads, denials, and already-rolled-back edits", () => {
    const entries: AuditLogRecord[] = [
      // Descending order (as returned from DB)
      makeAudit({
        id: asAuditLogId("aud_6_later_edit"),
        documentId: asDocumentId("doc_1"),
        action: "PATCH /api/v1/documents/doc_1",
        beforeRevisionId: asRevisionId("rev_5"),
        afterRevisionId: asRevisionId("rev_6"),
        createdAt: "2026-11-24T10:05:00.000Z",
      }),
      makeAudit({
        id: asAuditLogId("aud_5_rollback_of_4"),
        documentId: asDocumentId("doc_1"),
        action: "audit.rollback",
        resource: "audit:aud_4_rolled_back",
        beforeRevisionId: asRevisionId("rev_4"),
        afterRevisionId: asRevisionId("rev_5"),
        createdAt: "2026-11-24T10:04:00.000Z",
      }),
      makeAudit({
        id: asAuditLogId("aud_4_rolled_back"),
        documentId: asDocumentId("doc_1"),
        action: "patch_document_section",
        beforeRevisionId: asRevisionId("rev_3"),
        afterRevisionId: asRevisionId("rev_4"),
        createdAt: "2026-11-24T10:03:00.000Z",
      }),
      makeAudit({
        id: asAuditLogId("aud_other_doc"),
        documentId: asDocumentId("doc_2"),
        action: "update_document",
        beforeRevisionId: asRevisionId("rev_x1"),
        afterRevisionId: asRevisionId("rev_x2"),
        createdAt: "2026-11-24T10:02:30.000Z",
      }),
      makeAudit({
        id: asAuditLogId("aud_denied"),
        documentId: asDocumentId("doc_1"),
        decision: "denied",
        reversible: false,
        beforeRevisionId: null,
        afterRevisionId: null,
        createdAt: "2026-11-24T10:02:15.000Z",
      }),
      makeAudit({
        id: asAuditLogId("aud_read"),
        documentId: asDocumentId("doc_1"),
        action: "get_document",
        beforeRevisionId: null,
        afterRevisionId: null,
        reversible: false,
        createdAt: "2026-11-24T10:02:05.000Z",
      }),
      makeAudit({
        id: asAuditLogId("aud_3_live"),
        documentId: asDocumentId("doc_1"),
        action: "update_document",
        beforeRevisionId: asRevisionId("rev_2"),
        afterRevisionId: asRevisionId("rev_3"),
        createdAt: "2026-11-24T10:02:00.000Z",
      }),
      makeAudit({
        id: asAuditLogId("aud_2_target"),
        documentId: asDocumentId("doc_1"),
        action: "patch_document_section",
        beforeRevisionId: asRevisionId("rev_1"),
        afterRevisionId: asRevisionId("rev_2"),
        createdAt: "2026-11-24T10:01:00.000Z",
      }),
      makeAudit({
        id: asAuditLogId("aud_1_earlier"),
        documentId: asDocumentId("doc_1"),
        action: "POST /api/v1/documents",
        beforeRevisionId: null,
        afterRevisionId: asRevisionId("rev_1"),
        reversible: false,
        createdAt: "2026-11-24T10:00:00.000Z",
      }),
    ];

    const cascade = computeLedgerCascade(entries, asAuditLogId("aud_2_target"));
    expect(cascade.targetFound).toBe(true);
    expect(cascade.reversible).toBe(true);
    expect(cascade.documentId).toBe(asDocumentId("doc_1"));
    expect(cascade.affectedAuditIds).toEqual([asAuditLogId("aud_3_live"), asAuditLogId("aud_6_later_edit")]);
    expect(cascade.totalAffectedCount).toBe(2);

    const missing = computeLedgerCascade(entries, asAuditLogId("aud_missing"));
    expect(missing.targetFound).toBe(false);
    expect(missing.affectedAuditIds).toEqual([]);
  });

  test("buildCompactDiffPreview and renderOutlineNodesToMarkdown format cleanly", () => {
    const preview = buildCompactDiffPreview(
      "# Title\n\nUnchanged intro\nOld finding line\nFooter",
      "# Title\n\nUnchanged intro\nNew finding line\nFooter",
    );
    expect(preview.oldSnippet).toBe("Old finding line");
    expect(preview.newSnippet).toBe("New finding line");

    const nodes: OutlineNode[] = [
      {
        id: asOutlineNodeId("nod_1"),
        documentId: asDocumentId("doc_1"),
        parentNodeId: null,
        orderKey: "a0",
        contentMarkdown: "Root item",
        contentText: "Root item",
        noteMarkdown: "Extra note",
        noteText: "Extra note",
        checked: false,
        collapsed: false,
        authorType: "human",
        authorId: null,
        sourceBindingId: null,
        createdAt: "2026-11-24T10:00:00.000Z",
        updatedAt: "2026-11-24T10:00:00.000Z",
        deletedAt: null,
      },
      {
        id: asOutlineNodeId("nod_2"),
        documentId: asDocumentId("doc_1"),
        parentNodeId: asOutlineNodeId("nod_1"),
        orderKey: "a0",
        contentMarkdown: "Child done",
        contentText: "Child done",
        checked: true,
        collapsed: false,
        authorType: "agent",
        authorId: null,
        sourceBindingId: asThreadBindingId("bnd_1"),
        createdAt: "2026-11-24T10:00:00.000Z",
        updatedAt: "2026-11-24T10:00:00.000Z",
        deletedAt: null,
      },
    ];
    expect(renderOutlineNodesToMarkdown(nodes)).toBe(
      "- [ ] Root item\n  > Extra note\n  - [x] Child done",
    );
  });
});
