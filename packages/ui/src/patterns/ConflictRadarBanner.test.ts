import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  asDocumentId,
  asOutlineNodeId,
  asThreadBindingId,
  asWorkspaceId,
  type AdeThreadBinding,
  type DocumentId,
  type ThreadBindingId,
  type ThreadConflictItem,
} from "@inkade/core";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ConflictRadarBanner,
  getHostBadgeInitials,
  summarizeConflictHosts,
} from "./ConflictRadarBanner.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});
afterAll(() => {
  initInkadeI18n("zh-CN");
});

function makeBinding(
  overrides: Omit<Partial<AdeThreadBinding>, "id"> & { readonly id: ThreadBindingId | string },
): AdeThreadBinding {
  const { id, ...rest } = overrides;
  return {
    id: asThreadBindingId(id),
    workspaceId: asWorkspaceId("wks_1"),
    documentId: asDocumentId("doc_1"),
    nodeId: asOutlineNodeId("nod_1"),
    selectionAnchor: null,
    adeKind: "bb",
    externalWorkspaceId: null,
    externalThreadId: `ext_${id}`,
    deepLink: null,
    title: `Thread ${id}`,
    status: "running",
    lastSummary: null,
    unreadResult: false,
    lastSyncedAt: "2026-11-24T05:00:00.000Z",
    createdAt: "2026-11-24T05:00:00.000Z",
    ...rest,
  };
}

describe("ConflictRadarBanner", () => {
  it("renders nothing when conflicts list is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(ConflictRadarBanner, { conflicts: [] }),
      }),
    );
    expect(html).toBe("");
  });

  it("maps ADE hosts to compact initials and calculates overflow accurately", () => {
    const bindings = [
      makeBinding({ id: "b1", adeKind: "bb" }),
      makeBinding({ id: "b2", adeKind: "paseo" }),
      makeBinding({ id: "b3", adeKind: "cindy" }),
      makeBinding({ id: "b4", adeKind: "generic" }),
      makeBinding({ id: "b5", adeKind: "bb" }),
    ];
    expect(getHostBadgeInitials(bindings[0]!)).toBe("BB");
    expect(getHostBadgeInitials(bindings[1]!)).toBe("PA");
    expect(getHostBadgeInitials(bindings[2]!)).toBe("CI");
    expect(getHostBadgeInitials(bindings[3]!)).toBe("AG");

    const summary = summarizeConflictHosts(bindings, 3);
    expect(summary.visible.map((v) => v.initials)).toEqual(["BB", "PA", "CI"]);
    expect(summary.overflowCount).toBe(2);
  });

  it("renders crisp 1px banner with overlapping white-bordered host pills and Compare Diff CTA", () => {
    const specDocId: DocumentId = asDocumentId("doc_spec");
    const conflict: ThreadConflictItem = {
      documentId: specDocId,
      scope: "node",
      nodeId: asOutlineNodeId("nod_1"),
      bindingIds: [asThreadBindingId("b1"), asThreadBindingId("b2")],
      bindings: [
        makeBinding({ id: "b1", documentId: specDocId, adeKind: "bb", title: "BB Research" }),
        makeBinding({ id: "b2", documentId: specDocId, adeKind: "paseo", title: "Paseo Draft" }),
      ],
      reason: "2 active threads target same node",
    };

    const html = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(ConflictRadarBanner, {
          conflicts: [conflict],
          documentTitlesById: { doc_spec: "Architecture Spec" },
          onCompare: () => {},
        }),
      }),
    );

    expect(html).toContain('data-slot="conflict-radar-banner"');
    expect(html).toContain('data-conflict-count="1"');
    expect(html).toContain("Architecture Spec");
    expect(html).toContain("Same outline node");
    expect(html).toContain("BB");
    expect(html).toContain("PA");
    expect(html).toContain("border-2 border-card");
    expect(html).toContain("Compare Diff");
  });
});
