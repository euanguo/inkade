import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { asDocumentId, asSpaceId, asWorkspaceId, type ViewQueryResponse } from "@inkade/core";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import { Editor } from "@tiptap/react";
import { TableKit } from "@tiptap/extension-table";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { renderToStaticMarkup } from "react-dom/server";
import { InkadeCodeBlockExtension } from "../editor/extensions/code-block.ts";
import { InkadeTableCell, InkadeTableHeader } from "../editor/extensions/create-extensions.ts";
import { InkadeViewExtension } from "../editor/extensions/inkade-view.ts";
import {
  alignActiveTableColumn,
  computeActiveColumnNumericStats,
  extractActiveTableMatrix,
  formatMatrixAsCsv,
  formatMatrixAsGfmMarkdown,
  sortTableByActiveColumn,
  toggleActiveRowHighlight,
} from "../editor/menus/table-actions.ts";
import { InkadeViewBlock } from "./InkadeViewBlock.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});
afterAll(() => {
  initInkadeI18n("zh-CN");
});

describe("Phase 42 UI: InkadeView extension, InkadeViewBlock & TableFloatingToolbar actions", () => {
  it("parses and serializes ```inkade-view``` fenced blocks cleanly ahead of CodeBlock", () => {
    const manager = new MarkdownManager({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        InkadeViewExtension,
        InkadeCodeBlockExtension,
      ],
    });

    const input = [
      "# Team Tracker",
      "",
      "```inkade-view",
      "mode: board",
      "spaceId: spc_research",
      "groupBy: status",
      "limit: 20",
      "```",
    ].join("\n");

    const parsed = manager.parse(input);
    expect(parsed.content?.some((node) => node.type === "inkadeView")).toBe(true);
    const serialized = manager.serialize(parsed);
    expect(serialized).toContain("```inkade-view\nmode: board\nspaceId: spc_research");
    expect(serialized).not.toContain("\\`\\`\\`");
  });

  it("renders InkadeViewBlock table, numeric footer, and invalid YAML fallback safely", () => {
    const snapshot: ViewQueryResponse = {
      documents: [
        {
          id: asDocumentId("doc_1"),
          workspaceId: asWorkspaceId("ws_default"),
          spaceId: asSpaceId("spc_research"),
          kind: "article",
          title: "Phase 42 Spec",
          slug: "phase-42-spec",
          dailyDate: null,
          excerpt: "Enterprise Table & Board",
          tags: ["v6"],
          properties: { status: "done", budget: 3500 },
          version: 1,
          pinned: false,
          unreadAgentUpdate: false,
          lastEditedByType: "human",
          trashedAt: null,
          createdAt: "2026-11-25T00:00:00.000Z",
          updatedAt: "2026-11-25T10:00:00.000Z",
          publicShareToken: "tok_pub_1",
        },
      ],
      totalCount: 1,
      limit: 20,
      offset: 0,
      schemaFields: [
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [{ value: "done", label: "Done", color: "emerald" }],
          showInTable: true,
          showInCard: true,
          requiredByAgent: false,
        },
        {
          key: "budget",
          label: "Budget",
          type: "number",
          options: [],
          numberFormat: "currency",
          numberUnit: "USD",
          showInTable: true,
          showInCard: true,
          requiredByAgent: false,
        },
      ],
      numericAggregates: [{ field: "budget", count: 1, sum: 3500, avg: 3500 }],
    };

    const html = renderToStaticMarkup(
      <InkadeI18nProvider>
        <InkadeViewBlock
          embeddedSnapshot={snapshot}
          rawYaml={"mode: table\ncolumns:\n  - title\n  - status\n  - budget"}
          spaces={[{ id: asSpaceId("spc_research"), name: "Research", color: "indigo", icon: "Book" }]}
        />
      </InkadeI18nProvider>,
    );
    expect(html).toContain("inkade-view-block");
    expect(html).toContain("Phase 42 Spec");
    expect(html).toContain("Done");
    expect(html).toContain("3500 USD");

    const badHtml = renderToStaticMarkup(
      <InkadeI18nProvider>
        <InkadeViewBlock rawYaml="- not: [valid" />
      </InkadeI18nProvider>,
    );
    expect(badHtml).toContain("inkade-view-invalid");
  });

  it("sorts, aligns, highlights, summarizes numeric columns, and exports Markdown/CSV on ProseMirror tables", () => {
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
          StarterKit,
          TableKit.configure({
            tableCell: false,
            tableHeader: false,
          }),
          InkadeTableCell,
          InkadeTableHeader,
        ],
        content:
          "<table><tr><th>Item</th><th>Cost</th></tr><tr><td>Bravo</td><td>200</td></tr><tr><td>Alpha</td><td>50</td></tr></table>",
      });

      try {
        // Position selection inside second column ("Cost" / "200")
        let costCellPos = -1;
        editor.state.doc.descendants((node, pos) => {
          if (
            costCellPos === -1 &&
            (node.type.name === "tableCell" || node.type.name === "tableHeader") &&
            node.textContent === "200"
          ) {
            costCellPos = pos + 2;
          }
        });
        expect(costCellPos).toBeGreaterThan(0);
        editor.commands.setTextSelection(costCellPos);

        const stats = computeActiveColumnNumericStats(editor);
        expect(stats).toEqual({ count: 2, sum: 250, avg: 125 });

        expect(sortTableByActiveColumn(editor, "asc")).toBe(true);
        const afterSortAsc = extractActiveTableMatrix(editor);
        expect(afterSortAsc).toEqual([
          ["Item", "Cost"],
          ["Alpha", "50"],
          ["Bravo", "200"],
        ]);

        expect(alignActiveTableColumn(editor, "right")).toBe(true);
        expect(toggleActiveRowHighlight(editor)).toBe(true);
        const html = editor.getHTML();
        expect(html).toContain('data-align="right"');
        expect(html).toContain("data-highlight-color=");

        const md = formatMatrixAsGfmMarkdown(afterSortAsc);
        expect(md).toContain("| Item | Cost |");
        expect(md).toContain("| Alpha | 50 |");

        const csv = formatMatrixAsCsv(afterSortAsc);
        expect(csv).toContain("Item,Cost");
        expect(csv).toContain("Alpha,50");
      } finally {
        editor.destroy();
      }
    } finally {
      Object.assign(globalThis, prevGlobals);
      dom.window.close();
    }
  });
});
