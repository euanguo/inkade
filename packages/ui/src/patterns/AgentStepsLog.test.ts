import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { asAgentStepId, type AgentStepItem } from "@inkade/core";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentStepsLog,
  collectUniqueStepSources,
  shouldAutoCollapseSteps,
} from "./AgentStepsLog.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});
afterAll(() => {
  initInkadeI18n("zh-CN");
});

describe("AgentStepsLog", () => {
  it("deduplicates source pills and caps visible count at 3 with +N overflow", () => {
    const steps: AgentStepItem[] = [
      {
        id: asAgentStepId("s1"),
        label: "Inspect UI",
        status: "completed",
        durationMs: 180,
        sources: [{ label: "TSX" }, { label: "MD" }],
      },
      {
        id: asAgentStepId("s2"),
        label: "Query API",
        status: "completed",
        durationMs: 320,
        sources: [{ label: "tsx" }, { label: "API" }, { label: "SQL" }, { label: "CSS" }],
      },
    ];

    const result = collectUniqueStepSources(steps, 3);
    expect(result.visible.map((s) => s.label)).toEqual(["TSX", "MD", "API"]);
    expect(result.overflowCount).toBe(2);
  });

  it("auto-collapses only when transitioning from running to all completed with collapseOnComplete", () => {
    const completedSteps: AgentStepItem[] = [
      { id: asAgentStepId("s1"), label: "Step 1", status: "completed", durationMs: 120 },
      { id: asAgentStepId("s2"), label: "Step 2", status: "completed", durationMs: 240 },
    ];
    const mixedSteps: AgentStepItem[] = [
      { id: asAgentStepId("s1"), label: "Step 1", status: "completed", durationMs: 120 },
      { id: asAgentStepId("s2"), label: "Step 2", status: "failed" },
    ];

    expect(shouldAutoCollapseSteps(true, completedSteps, true)).toBe(true);
    expect(shouldAutoCollapseSteps(false, completedSteps, true)).toBe(false);
    expect(shouldAutoCollapseSteps(true, completedSteps, false)).toBe(false);
    expect(shouldAutoCollapseSteps(true, mixedSteps, true)).toBe(false);
  });

  it("renders ThinkingIndicator when running, unique source pills, and tabular-nums durations", () => {
    const steps: AgentStepItem[] = [
      {
        id: asAgentStepId("s1"),
        label: "Read daily notes",
        status: "completed",
        durationMs: 180,
        sources: [{ label: "MD" }, { label: "TSX" }],
      },
      {
        id: asAgentStepId("s2"),
        label: "Synthesize diff",
        status: "running",
        sources: [{ label: "API" }, { label: "DOC" }],
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(AgentStepsLog, { steps, defaultExpanded: true }),
      }),
    );

    expect(html).toContain('data-slot="agent-steps-log"');
    expect(html).toContain('data-slot="thinking-indicator"');
    expect(html).toContain("1 / 2");
    expect(html).toContain("180ms");
    expect(html).toContain("Running");
    expect(html).toContain("tabular-nums");
    expect(html).toContain("+1");
  });
});
