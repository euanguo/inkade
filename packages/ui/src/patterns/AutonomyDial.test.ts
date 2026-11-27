import { describe, expect, it } from "bun:test";
import {
  asSpaceId,
  autonomyLevelToScopePatch,
  deriveAutonomyPolicy,
  deriveQuietGovernanceSummary,
} from "@inkade/core";
import { InkadeI18nProvider, initInkadeI18n } from "@inkade/i18n";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AutonomyDial } from "./AutonomyDial.tsx";

describe("AutonomyDial", () => {
  it("renders 3 Quiet Autonomy execution stops, safety locks, and batch rollback guarantee", () => {
    initInkadeI18n("en-US");

    const draftScope = {
      ...autonomyLevelToScopePatch("draft"),
      spaceIds: "*" as const,
      includeDescendants: true,
    };
    const draftPolicy = deriveAutonomyPolicy(draftScope);
    const draftQuiet = deriveQuietGovernanceSummary(draftScope);

    const html = renderToStaticMarkup(
      React.createElement(
        InkadeI18nProvider,
        null,
        React.createElement(AutonomyDial, {
          value: "draft",
          policy: draftPolicy,
          quietSummary: draftQuiet,
        }),
      ),
    );

    expect(html).toContain('data-slot="autonomy-dial"');
    expect(html).toContain('data-level="draft"');
    expect(html).toContain('data-autonomy-stop="auto"');
    expect(html).toContain('data-autonomy-stop="draft"');
    expect(html).toContain('data-autonomy-stop="ask"');
    expect(html).toContain('data-slot="autonomy-dial-auto-matrix"');
    expect(html).toContain('data-slot="autonomy-dial-safety-locks"');
    expect(html).toContain('data-slot="autonomy-dial-server-lock"');
    expect(html).toContain("Autonomous (Quiet)");
    expect(html).toContain("Sandbox Only (Append)");
    expect(html).toContain("Read Only");
    expect(html).toContain("Batch Rollback Guarantee: Always Reversible");
    expect(html).toContain("Hard Delete: Server-locked (non-overridable)");
  });

  it("maps auto/draft/ask levels without pre-write approval blockers", () => {
    initInkadeI18n("en-US");

    const askScope = {
      ...autonomyLevelToScopePatch("ask"),
      spaceIds: [asSpaceId("spc_1")],
      includeDescendants: true,
    };
    const askPolicy = deriveAutonomyPolicy(askScope);
    expect(askPolicy.level).toBe("ask");
    expect(askPolicy.autoActions).toEqual(["read"]);
    expect(askPolicy.approvalRequiredActions).toEqual([]);
    expect(askPolicy.lockedActions).toContain("hard_delete");

    const html = renderToStaticMarkup(
      React.createElement(
        InkadeI18nProvider,
        null,
        React.createElement(AutonomyDial, {
          value: "ask",
          policy: askPolicy,
          readOnly: true,
        }),
      ),
    );

    expect(html).toContain('data-level="ask"');
    expect(html).toContain("disabled");
  });
});
