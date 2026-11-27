import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import {
  asDocumentId,
  asSpaceId,
  asThreadBindingId,
  asWorkspaceId,
  createId,
  ID_PREFIXES,
  type AdeThreadBinding,
  type DocumentRecord,
} from "@inkade/core";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { renderToStaticMarkup } from "react-dom/server";
import { buildStandaloneDocumentHtml, renderExportMarkdownToHtml } from "../editor/document-export.ts";
import { InkadeCodeBlockExtension } from "../editor/extensions/code-block.ts";
import { InkadePendingExtension } from "../editor/extensions/inkade-pending.ts";
import { ArticleReader } from "./ArticleReader.tsx";
import { InkadePendingBlock } from "./InkadePendingBlock.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});

afterAll(() => {
  initInkadeI18n("zh-CN");
});

describe("Phase 50 UI: InkadePendingExtension, InkadePendingBlock, Reader & HTML Export", () => {
  it("parses and serializes ```inkade-pending``` blocks ahead of CodeBlock while ignoring nested code fences", () => {
    const manager = new MarkdownManager({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        InkadePendingExtension,
        InkadeCodeBlockExtension,
      ],
    });

    const input = [
      "# Research Draft",
      "",
      "```inkade-pending",
      "id: sec_arch_flow",
      "label: Analyzing 10-port layering...",
      "bindingId: bnd_01JXYZ99ABCD",
      "status: generating",
      "```",
      "",
      "````markdown",
      "```inkade-pending",
      "id: sec_nested_example",
      "label: Example snippet inside markdown block",
      "status: queued",
      "```",
      "````",
    ].join("\n");

    const parsed = manager.parse(input);
    const pendingNodes = (parsed.content ?? []).filter((node) => node.type === "inkadePending");
    expect(pendingNodes).toHaveLength(1);
    expect(pendingNodes[0]?.attrs).toMatchObject({
      pendingId: "sec_arch_flow",
      label: "Analyzing 10-port layering...",
      bindingId: "bnd_01JXYZ99ABCD",
      status: "generating",
    });

    const serialized = manager.serialize(parsed);
    expect(serialized).toContain("```inkade-pending\nid: sec_arch_flow");
    expect(serialized).toContain("bindingId: bnd_01JXYZ99ABCD");
    expect(serialized).toContain("id: sec_nested_example");
  });

  it("renders InkadePendingBlock with live AdeThreadBinding status, steps, timer & action controls", () => {
    const binding: AdeThreadBinding = {
      id: asThreadBindingId("bnd_p50_1"),
      workspaceId: asWorkspaceId("ws_default"),
      documentId: asDocumentId("doc_p50_1"),
      nodeId: null,
      selectionAnchor: null,
      adeKind: "codex",
      externalWorkspaceId: null,
      externalThreadId: "thr_abc",
      deepLink: null,
      title: "Architecture Writer",
      status: "running",
      lastSummary: null,
      unreadResult: false,
      lastSyncedAt: "2026-11-26T10:00:00.000Z",
      createdAt: "2026-11-26T09:59:00.000Z",
      runningSince: "2026-11-26T09:59:30.000Z",
      progressSteps: [
        { id: createId(ID_PREFIXES.agentStep), label: "Scan DB ports", status: "completed", durationMs: 320 },
        { id: createId(ID_PREFIXES.agentStep), label: "Drafting section 1", status: "running" },
      ],
    };

    const editableHtml = renderToStaticMarkup(
      <InkadeI18nProvider>
        <InkadePendingBlock
          binding={binding}
          label="Drafting system architecture..."
          onConvertToProse={() => {}}
          onOpenBinding={() => {}}
          onRemovePlaceholder={() => {}}
          pendingId="sec_arch"
          status="queued"
        />
      </InkadeI18nProvider>,
    );

    expect(editableHtml).toContain('data-testid="inkade-pending-block"');
    expect(editableHtml).toContain('data-pending-id="sec_arch"');
    expect(editableHtml).toContain('data-pending-status="generating"');
    expect(editableHtml).toContain("Drafting system architecture...");
    expect(editableHtml).toContain("Architecture Writer");
    expect(editableHtml).toContain("Drafting section 1");
    expect(editableHtml).toContain("Convert to Prose");
    expect(editableHtml).toContain("Remove Placeholder");
    expect(editableHtml).toContain('data-motion-essential="pulse"');

    const readOnlyHtml = renderToStaticMarkup(
      <InkadeI18nProvider>
        <InkadePendingBlock
          label="Queued section"
          pendingId="sec_queued"
          readOnly
          status="queued"
        />
      </InkadeI18nProvider>,
    );
    expect(readOnlyHtml).toContain('data-pending-status="queued"');
    expect(readOnlyHtml).not.toContain("Convert to Prose");
    expect(readOnlyHtml).not.toContain("Remove Placeholder");
  });

  it("supports ProseMirror paragraph conversion in Editor so serialized Markdown drops the pending fence", () => {
    const dom = new JSDOM("<!doctype html><body><div id='editor'></div></body>");
    const prevGlobals = {
      window: globalThis.window,
      document: globalThis.document,
      Node: globalThis.Node,
      Element: globalThis.Element,
      HTMLElement: globalThis.HTMLElement,
      DOMParser: globalThis.DOMParser,
      MutationObserver: globalThis.MutationObserver,
    };
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      DOMParser: dom.window.DOMParser,
      MutationObserver: dom.window.MutationObserver,
    });

    try {
      const mount = dom.window.document.getElementById("editor");
      const editor = new Editor({
        element: mount,
        extensions: [
          StarterKit.configure({ codeBlock: false }),
          Markdown,
          InkadePendingExtension,
          InkadeCodeBlockExtension,
        ],
        content: [
          "## Architecture",
          "",
          "```inkade-pending",
          "id: sec_arch",
          "label: Drafting architecture...",
          "status: generating",
          "```",
        ].join("\n"),
        contentType: "markdown",
      });

      try {
        let pendingPos = -1;
        let pendingSize = 0;
        editor.state.doc.descendants((node, pos) => {
          if (pendingPos === -1 && node.type.name === "inkadePending") {
            pendingPos = pos;
            pendingSize = node.nodeSize;
          }
        });
        expect(pendingPos).toBeGreaterThanOrEqual(0);
        expect(pendingSize).toBeGreaterThan(0);

        const paragraphType = editor.state.schema.nodes.paragraph;
        expect(paragraphType).toBeDefined();
        if (paragraphType) {
          const tr = editor.state.tr.replaceWith(
            pendingPos,
            pendingPos + pendingSize,
            paragraphType.create(null, editor.state.schema.text("Human handwritten paragraph.")),
          );
          editor.view.dispatch(tr);
        }

        const serialized = editor.getMarkdown();
        expect(serialized).toContain("Human handwritten paragraph.");
        expect(serialized).not.toContain("inkade-pending");
        expect(serialized).not.toContain("sec_arch");
      } finally {
        editor.destroy();
      }
    } finally {
      Object.assign(globalThis, prevGlobals);
      dom.window.close();
    }
  });

  it("renders inkade-pending cleanly in ArticleReader and standalone HTML export", () => {
    const markdown = [
      "## Overview",
      "",
      "```inkade-pending",
      "id: sec_overview",
      "label: Synthesizing findings...",
      "bindingId: bnd_reader_1",
      "status: generating",
      "```",
    ].join("\n");

    const doc: DocumentRecord = {
      id: asDocumentId("doc_p50_reader"),
      workspaceId: asWorkspaceId("ws_default"),
      spaceId: asSpaceId("spc_research"),
      kind: "article",
      title: "Streaming Report",
      slug: "streaming-report",
      dailyDate: null,
      excerpt: "",
      contentMarkdown: markdown,
      contentJson: null,
      contentText: "",
      tags: [],
      sourceUrl: undefined,
      sourceMeta: null,
      properties: {},
      pinned: false,
      version: 1,
      unreadAgentUpdate: false,
      lastEditedByType: "agent",
      createdAt: "2026-11-26T10:00:00.000Z",
      updatedAt: "2026-11-26T10:00:00.000Z",
      trashedAt: null,
    };

    const binding: AdeThreadBinding = {
      id: asThreadBindingId("bnd_reader_1"),
      workspaceId: asWorkspaceId("ws_default"),
      documentId: doc.id,
      nodeId: null,
      selectionAnchor: null,
      adeKind: "claude-code",
      externalWorkspaceId: null,
      externalThreadId: "thr_cc_1",
      deepLink: null,
      title: "Report Synthesizer",
      status: "running",
      lastSummary: "Reading specs",
      unreadResult: false,
      lastSyncedAt: "2026-11-26T10:00:00.000Z",
      createdAt: "2026-11-26T09:59:00.000Z",
    };

    const readerHtml = renderToStaticMarkup(
      <InkadeI18nProvider>
        <ArticleReader
          bindings={[binding]}
          document={doc}
          showToc={false}
        />
      </InkadeI18nProvider>,
    );
    expect(readerHtml).toContain('data-testid="inkade-pending-block"');
    expect(readerHtml).toContain("Synthesizing findings...");
    expect(readerHtml).toContain("Report Synthesizer");
    expect(readerHtml).not.toContain("<pre");

    const exportFragment = renderExportMarkdownToHtml(markdown);
    expect(exportFragment).toContain('class="inkade-pending-card"');
    expect(exportFragment).toContain('data-pending-id="sec_overview"');
    expect(exportFragment).toContain("Synthesizing findings...");
    expect(exportFragment).not.toContain("<pre");

    const standaloneHtml = buildStandaloneDocumentHtml({
      title: "Streaming Report",
      markdown,
    });
    expect(standaloneHtml).toContain(".inkade-prose .inkade-pending-card");
    expect(standaloneHtml).toContain("Synthesizing findings...");
  });
});
