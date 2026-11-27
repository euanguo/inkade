import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { asApprovalId, type AgentPendingApproval } from "@inkade/core";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApprovalCard,
  computeRemainingApprovalMs,
  formatCountdownMmSs,
  stepApprovalCountdown,
} from "./ApprovalCard.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});
afterAll(() => {
  initInkadeI18n("zh-CN");
});

describe("ApprovalCard", () => {
  it("computes remaining countdown and pauses cleanly when hovered or focused", () => {
    const now = Date.parse("2026-11-24T06:00:00.000Z");
    const expiresAt = "2026-11-24T06:02:15.000Z";
    const remaining = computeRemainingApprovalMs(expiresAt, now);
    expect(remaining).toBe(135_000);
    expect(formatCountdownMmSs(remaining!)).toBe("02:15");

    const pausedStep = stepApprovalCountdown({ remainingMs: 135_000, paused: true }, 5000);
    expect(pausedStep).toEqual({ remainingMs: 135_000, expired: false });

    const activeStep = stepApprovalCountdown({ remainingMs: 135_000, paused: false }, 5000);
    expect(activeStep).toEqual({ remainingMs: 130_000, expired: false });

    const expiredStep = stepApprovalCountdown({ remainingMs: 500, paused: false }, 1000);
    expect(expiredStep).toEqual({ remainingMs: 0, expired: true });
  });

  it("renders nested neutral tray, risk badge, restrained diff preview, and keyboard actions", () => {
    const approval: AgentPendingApproval = {
      id: asApprovalId("apr_1"),
      action: "Update Executive Summary",
      risk: "high",
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
      diffPreview: {
        oldSnippet: "Legacy throughput was 40 req/s",
        newSnippet: "Updated throughput benchmark is 120 req/s",
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(ApprovalCard, {
          approval,
          adeKind: "bb",
          onDecision: () => {},
          onUndo: () => {},
        }),
      }),
    );

    expect(html).toContain('data-slot="approval-card"');
    expect(html).toContain('data-slot="approval-countdown"');
    expect(html).toContain('data-slot="approval-diff-preview"');
    expect(html).toContain("Update Executive Summary");
    expect(html).toContain("High");
    expect(html).toContain("Approve");
    expect(html).toContain("Adjust");
    expect(html).toContain("Deny");
    expect(html).toContain("⌘⏎");
    expect(html).toContain("Esc");
  });

  it("morphs into compact confirmation row with Undo when already resolved", () => {
    const resolved: AgentPendingApproval = {
      id: asApprovalId("apr_2"),
      action: "Patch API section",
      risk: "medium",
      decision: "adjusted",
      decisionNote: "Keep intro unchanged",
      decidedAt: "2026-11-24T06:05:00.000Z",
    };

    const html = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(ApprovalCard, {
          approval: resolved,
          onDecision: () => {},
          onUndo: () => {},
        }),
      }),
    );

    expect(html).toContain('data-approval-decision="adjusted"');
    expect(html).toContain("Adjusted");
    expect(html).toContain("Keep intro unchanged");
    expect(html).toContain("Undo");
  });
});
