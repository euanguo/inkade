import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import {
  asDocumentId,
  asSpaceId,
  asWorkspaceId,
  type DocumentRecord,
} from "@inkade/core";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { buildStandaloneDocumentHtml, renderExportMarkdownToHtml } from "../editor/document-export.ts";
import { ArticleReader } from "./ArticleReader.tsx";
import { PresentationStage } from "./PresentationModal.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});

afterAll(() => {
  initInkadeI18n("zh-CN");
});

function setupJsdomGlobals(): {
  readonly dom: JSDOM;
  readonly cleanup: () => void;
} {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost/",
  });
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    KeyboardEvent: globalThis.KeyboardEvent,
    Event: globalThis.Event,
    MutationObserver: globalThis.MutationObserver,
    ResizeObserver: globalThis.ResizeObserver,
    matchMedia: globalThis.matchMedia,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const noopResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const noopMatchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver,
    ResizeObserver: noopResizeObserver,
    matchMedia: noopMatchMedia,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  });
  return {
    dom,
    cleanup: () => {
      Object.assign(globalThis, prev);
      dom.window.close();
    },
  };
}

describe("Phase 54 UI: PresentationModal & speaker notes isolation", () => {
  it("strips <!-- notes: ... --> from ArticleReader and standalone HTML export", () => {
    const markdown = [
      "# Quarterly Research",
      "",
      "Public insight paragraph.",
      "",
      "<!-- notes: Secret presenter cue: do not show to normal readers -->",
      "",
      "```html",
      "<!-- notes: Literal example in code block should remain -->",
      "```",
    ].join("\n");

    const doc: DocumentRecord = {
      id: asDocumentId("doc_p54_reader"),
      workspaceId: asWorkspaceId("ws_default"),
      spaceId: asSpaceId("spc_research"),
      kind: "article",
      title: "Quarterly Research",
      slug: "quarterly-research",
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
      lastEditedByType: "human",
      createdAt: "2026-11-26T10:00:00.000Z",
      updatedAt: "2026-11-26T10:00:00.000Z",
      trashedAt: null,
    };

    const readerHtml = renderToStaticMarkup(
      <InkadeI18nProvider>
        <ArticleReader document={doc} showToc={false} />
      </InkadeI18nProvider>,
    );
    expect(readerHtml).toContain("Public insight paragraph.");
    expect(readerHtml).not.toContain("Secret presenter cue");
    expect(readerHtml).toContain("Literal example in code block should remain");

    const exportFragment = renderExportMarkdownToHtml(markdown);
    expect(exportFragment).toContain("Public insight paragraph.");
    expect(exportFragment).not.toContain("Secret presenter cue");

    const standaloneHtml = buildStandaloneDocumentHtml({
      title: "Quarterly Research",
      markdown,
    });
    expect(standaloneHtml).not.toContain("Secret presenter cue");
  });

  it("navigates slides via buttons/keyboard/select, toggles speaker notes drawer (N), fullscreen (F) & Esc", async () => {
    const { dom, cleanup } = setupJsdomGlobals();
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const presentationMarkdown = [
      "# Executive Deck",
      "",
      "Opening slide content.",
      "",
      "<!-- notes: Welcome remarks for slide 1 -->",
      "",
      "---",
      "",
      "## Architecture Deep Dive",
      "",
      "```ts",
      "// divider inside code block:",
      "const sep = '---';",
      "```",
      "",
      "<!-- notes:",
      "Explain why --- inside code block does not split",
      "-->",
      "",
      "---",
      "",
      "## Next Quarter Plan",
      "",
      "- Ship Phase 54",
    ].join("\n");

    let closedCount = 0;
    let root: ReturnType<typeof createRoot> | null = null;

    try {
      const container = dom.window.document.getElementById("root")!;
      root = createRoot(container);

      act(() => {
        root?.render(
          <InkadeI18nProvider>
            <PresentationStage
              active
              markdown={presentationMarkdown}
              onRequestClose={() => {
                closedCount += 1;
              }}
              title="Executive Deck"
              typographyPrefs={{
                fontFamily: "sans",
                fontSize: "base",
                measure: "72ch",
                paper: "sepia",
              }}
            />
          </InkadeI18nProvider>,
        );
      });

      const rootEl = container.querySelector('[data-testid="presentation-stage-root"]');
      expect(rootEl).not.toBeNull();

      const stage = container.querySelector('[data-testid="presentation-slide-stage"]');
      expect(stage?.getAttribute("data-slide-index")).toBe("0");
      expect(stage?.getAttribute("data-paper")).toBe("sepia");
      expect(stage?.className).toContain("inkade-paper-sepia");
      expect(stage?.textContent).toContain("Opening slide content.");
      expect(stage?.textContent).not.toContain("Welcome remarks for slide 1");
      expect(container.textContent).toContain("Slide 1 / 3");

      // Toggle speaker notes drawer via keyboard 'n'
      act(() => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "n", bubbles: true }));
      });
      const notesDrawer = container.querySelector('[data-testid="presentation-notes-drawer"]');
      expect(notesDrawer).not.toBeNull();
      expect(notesDrawer?.textContent).toContain("Welcome remarks for slide 1");

      // Navigate to slide 2 via Space key
      act(() => {
        dom.window.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }),
        );
      });
      expect(
        container.querySelector('[data-testid="presentation-slide-stage"]')?.getAttribute("data-slide-index"),
      ).toBe("1");
      expect(container.textContent).toContain("Slide 2 / 3");
      expect(container.querySelector('[data-testid="presentation-notes-drawer"]')?.textContent).toContain(
        "Explain why --- inside code block does not split",
      );

      // Navigate to slide 3 via Next button
      const nextBtn = container.querySelector<HTMLButtonElement>('[data-testid="presentation-next"]');
      expect(nextBtn).not.toBeNull();
      act(() => {
        nextBtn?.click();
      });
      expect(
        container.querySelector('[data-testid="presentation-slide-stage"]')?.getAttribute("data-slide-index"),
      ).toBe("2");
      expect(container.textContent).toContain("Slide 3 / 3");

      // Navigate back via ArrowLeft even if a background element outside the stage is contentEditable
      const externalEditable = dom.window.document.createElement("div");
      externalEditable.setAttribute("contenteditable", "true");
      externalEditable.tabIndex = 0;
      dom.window.document.body.appendChild(externalEditable);
      Object.defineProperty(externalEditable, "isContentEditable", {
        configurable: true,
        value: true,
      });
      act(() => {
        externalEditable.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
        );
      });
      expect(
        container.querySelector('[data-testid="presentation-slide-stage"]')?.getAttribute("data-slide-index"),
      ).toBe("1");

      // Inside stage, inputs must NOT trigger presentation navigation shortcuts
      const innerInput = dom.window.document.createElement("input");
      container.querySelector('[data-testid="presentation-stage-root"]')?.appendChild(innerInput);
      act(() => {
        innerInput.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
        );
      });
      expect(
        container.querySelector('[data-testid="presentation-slide-stage"]')?.getAttribute("data-slide-index"),
      ).toBe("1");

      // ArrowRight still advances even when a dialog wrapper stops bubbling propagation
      const stageRoot = container.querySelector<HTMLElement>('[data-testid="presentation-stage-root"]')!;
      const stopBubble = (e: Event) => {
        if ((e as KeyboardEvent).key === "ArrowRight") e.stopPropagation();
      };
      stageRoot.addEventListener("keydown", stopBubble);
      act(() => {
        stageRoot.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
      });
      stageRoot.removeEventListener("keydown", stopBubble);
      expect(
        container.querySelector('[data-testid="presentation-slide-stage"]')?.getAttribute("data-slide-index"),
      ).toBe("2");
      act(() => {
        dom.window.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
        );
      });
      expect(
        container.querySelector('[data-testid="presentation-slide-stage"]')?.getAttribute("data-slide-index"),
      ).toBe("1");

      // Jump directly via page select
      const selectEl = container.querySelector<HTMLSelectElement>(
        '[data-testid="presentation-slide-select"]',
      );
      expect(selectEl).not.toBeNull();
      act(() => {
        if (selectEl) {
          selectEl.value = "0";
          selectEl.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
        }
      });
      expect(
        container.querySelector('[data-testid="presentation-slide-stage"]')?.getAttribute("data-slide-index"),
      ).toBe("0");

      // Toggle fullscreen via 'f' key
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "f", bubbles: true }));
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(
        container.querySelector('[data-testid="presentation-stage-root"]')?.getAttribute("data-fullscreen"),
      ).toBe("true");

      // Close notes drawer via button click
      const toggleNotesBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="presentation-toggle-notes"]',
      );
      act(() => {
        toggleNotesBtn?.click();
      });
      expect(container.querySelector('[data-testid="presentation-notes-drawer"]')).toBeNull();

      // Exit via Escape key
      act(() => {
        dom.window.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(closedCount).toBe(1);
    } finally {
      if (root) {
        act(() => {
          root?.unmount();
        });
      }
      if (prevActEnv === undefined) {
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined })
          .IS_REACT_ACT_ENVIRONMENT;
      } else {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined })
          .IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      }
      cleanup();
    }
  });

  it("mounts PresentationModal via Base UI Dialog portal cleanly when DOM exists at startup", () => {
    const uiPkgDir = resolve(import.meta.dir, "../..");
    const script = `
      import { JSDOM } from "jsdom";
      const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
      Object.assign(globalThis, {
        window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
        Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
        MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
        IS_REACT_ACT_ENVIRONMENT: true,
      });
      const React = await import("react");
      const { act } = React;
      const { createRoot } = await import("react-dom/client");
      const { initInkadeI18n, InkadeI18nProvider } = await import("@inkade/i18n");
      initInkadeI18n("en-US");
      const { PresentationModal } = await import("./src/patterns/PresentationModal.tsx");
      let closed = false;
      const root = createRoot(dom.window.document.getElementById("root"));
      await act(async () => {
        root.render(React.createElement(InkadeI18nProvider, null,
          React.createElement(PresentationModal, {
            open: true,
            onOpenChange: (v) => { if (!v) closed = true; },
            title: "Dialog Deck",
            markdown: "# Slide 1\\n\\n---\\n\\n## Slide 2",
          })
        ));
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
      const modal = dom.window.document.body.querySelector('[data-testid="presentation-modal"]');
      if (!modal) throw new Error("Missing dialog portal");
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      if (!closed) throw new Error("Escape did not trigger onOpenChange(false)");
      await act(async () => { root.unmount(); });
      console.log("DIALOG_PORTAL_OK");
    `;
    const res = Bun.spawnSync(["bun", "-e", script], { cwd: uiPkgDir, stdout: "pipe", stderr: "pipe" });
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("DIALOG_PORTAL_OK");
  });

  it("avoids duplicate numeric prefixes in presentation slide selector options", () => {
    const html = renderToStaticMarkup(
      <InkadeI18nProvider locale="zh-CN">
        <PresentationStage
          markdown={[
            "Overview intro",
            "",
            "---",
            "",
            "## 2. 超宽 8 列表格与嵌套示例",
            "",
            "---",
            "",
            "## 1. 手工编号错位章节",
          ].join("\n")}
          onRequestClose={() => {}}
          title="报告总览"
        />
      </InkadeI18nProvider>,
    );

    expect(html).toContain('>1. 报告总览</option>');
    expect(html).toContain(">2. 超宽 8 列表格与嵌套示例</option>");
    expect(html).not.toContain("2. 2. ");
    expect(html).toContain(">3 · 1. 手工编号错位章节</option>");
  });
});
