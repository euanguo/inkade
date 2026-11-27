import { describe, expect, it } from "bun:test";
import {
  asApiTokenId,
  asAuditLogId,
  asDocumentId,
  asRevisionId,
  asSpaceId,
  asWorkspaceId,
  type AuditLogRecord,
} from "@inkade/core";
import { InkadeI18nProvider, initInkadeI18n } from "@inkade/i18n";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentLedgerRow } from "./AgentLedgerRow.tsx";

const BASE_ENTRY: AuditLogRecord = {
  id: asAuditLogId("aud_1"),
  workspaceId: asWorkspaceId("ws_1"),
  principalKind: "token",
  tokenId: asApiTokenId("tok_bb"),
  tokenName: "BB Agent",
  transport: "mcp",
  action: "outline.batch_mutate",
  resource: "document:doc_daily_today",
  spaceId: asSpaceId("spc_daily"),
  documentId: asDocumentId("doc_daily_today"),
  decision: "allowed",
  reason: null,
  summary: "Updated Today daily outline",
  createdAt: "2026-11-24T10:15:00.000Z",
  beforeRevisionId: asRevisionId("rev_017"),
  afterRevisionId: asRevisionId("rev_018"),
  diffPreview: {
    oldSnippet: "transition-all",
    newSnippet: "transition-[transform,opacity]",
  },
  reversible: true,
  irreversibleReason: null,
};

describe("AgentLedgerRow", () => {
  it("renders reversible row with compact diff preview, restore trigger, and cascade highlight", () => {
    initInkadeI18n("en-US");

    const html = renderToStaticMarkup(
      React.createElement(
        InkadeI18nProvider,
        null,
        React.createElement(AgentLedgerRow, {
          entry: BASE_ENTRY,
          cascadeStatus: "downstream_review",
          documentLabel: "Daily 2026-11-24",
        }),
      ),
    );

    expect(html).toContain('data-slot="agent-ledger-row"');
    expect(html).toContain('data-cascade-status="downstream_review"');
    expect(html).toContain('data-reversible="true"');
    expect(html).toContain("BB Agent");
    expect(html).toContain("outline.batch_mutate");
    expect(html).toContain("transition-all");
    expect(html).toContain("transition-[transform,opacity]");
    expect(html).toContain('data-slot="agent-ledger-cascade-badge"');
    expect(html).toContain('data-slot="agent-ledger-rollback"');
    expect(html).toContain("Restore rev_017");
    expect(html).not.toContain("border-l-4");
  });

  it("renders irreversible disabled lock badge when entry cannot roll back", () => {
    initInkadeI18n("en-US");

    const html = renderToStaticMarkup(
      React.createElement(
        InkadeI18nProvider,
        null,
        React.createElement(AgentLedgerRow, {
          entry: {
            ...BASE_ENTRY,
            id: asAuditLogId("aud_2"),
            action: "attachment.upload",
            beforeRevisionId: null,
            afterRevisionId: null,
            diffPreview: null,
            reversible: false,
            irreversibleReason: "Binary attachment stored externally",
          },
          cascadeStatus: "none",
        }),
      ),
    );

    expect(html).toContain('data-reversible="false"');
    expect(html).toContain('data-slot="agent-ledger-irreversible"');
    expect(html).toContain("Binary attachment stored externally");
    expect(html).not.toContain('data-slot="agent-ledger-rollback"');
  });

  it("localizes known backend irreversible reasons into zh-CN and en-US", () => {
    const initialEntry: AuditLogRecord = {
      ...BASE_ENTRY,
      id: asAuditLogId("aud_init"),
      action: "document.create",
      beforeRevisionId: null,
      afterRevisionId: asRevisionId("rev_001"),
      diffPreview: null,
      reversible: false,
      irreversibleReason: "Initial document creation has no prior revision",
    };

    initInkadeI18n("zh-CN");
    const zhHtml = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "zh-CN",
        children: React.createElement(AgentLedgerRow, {
          entry: initialEntry,
          cascadeStatus: "none",
        }),
      }),
    );
    expect(zhHtml).toContain("首次创建 · 无前置版本");

    initInkadeI18n("en-US");
    const enHtml = renderToStaticMarkup(
      React.createElement(InkadeI18nProvider, {
        locale: "en-US",
        children: React.createElement(AgentLedgerRow, {
          entry: initialEntry,
          cascadeStatus: "none",
        }),
      }),
    );
    expect(enHtml).toContain("Initial creation · no prior revision");

    initInkadeI18n("zh-CN");
  });
});
