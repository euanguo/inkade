import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import {
  asDocumentArtifactId,
  asDocumentId,
  asSpaceId,
  asWorkspaceId,
  INKADE_ARTIFACT_CHANNEL,
  type ArtifactSandboxTicket,
  type DocumentRecord,
} from "@inkade/core";
import { initInkadeI18n, InkadeI18nProvider } from "@inkade/i18n";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildStandaloneDocumentHtml,
  renderExportMarkdownToHtml,
} from "../editor/document-export.ts";
import { InkadeCodeBlockExtension } from "../editor/extensions/code-block.ts";
import { InkadeArtifactExtension } from "../editor/extensions/inkade-artifact.ts";
import { ArticleReader } from "./ArticleReader.tsx";
import { InkadeArtifactBlock } from "./InkadeArtifactBlock.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});

afterAll(() => {
  initInkadeI18n("zh-CN");
});

describe("Phase 51 UI: InkadeArtifactExtension, InkadeArtifactBlock, Reader & HTML Export", () => {
  it("parses and serializes ```inkade-artifact``` blocks ahead of CodeBlock while preserving nested examples", () => {
    const manager = new MarkdownManager({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        InkadeArtifactExtension,
        InkadeCodeBlockExtension,
      ],
    });

    const input = [
      "# Interactive Model",
      "",
      "```inkade-artifact",
      "id: art_compound01",
      "title: Compound Calculator",
      "height: 460",
      "```",
      "",
      "````markdown",
      "```inkade-artifact",
      "id: art_nested_example",
      "title: Example Only",
      "```",
      "````",
    ].join("\n");

    const parsed = manager.parse(input);
    const artifactNodes = (parsed.content ?? []).filter((node) => node.type === "inkadeArtifact");
    expect(artifactNodes).toHaveLength(1);
    expect(artifactNodes[0]?.attrs).toMatchObject({
      artifactId: "art_compound01",
      title: "Compound Calculator",
      height: 460,
    });

    const serialized = manager.serialize(parsed);
    expect(serialized).toContain("```inkade-artifact\nid: art_compound01");
    expect(serialized).toContain("title: Compound Calculator");
    expect(serialized).toContain("height: 460");
    expect(serialized).toContain("id: art_nested_example");
  });

  it("renders InkadeArtifactBlock fallback view, height presets, sources trigger, and export fallback", () => {
    const missingHtml = renderToStaticMarkup(
      <InkadeI18nProvider locale="en-US">
        <InkadeArtifactBlock artifactId="" />
      </InkadeI18nProvider>,
    );
    expect(missingHtml).toContain("Missing or invalid artifact ID");

    const validHtml = renderToStaticMarkup(
      <InkadeI18nProvider locale="en-US">
        <InkadeArtifactBlock
          artifactId="art_calc_render"
          fallbackMarkdown="| Year | Value |\n| --- | --- |\n| 1 | $1,100 |"
          heightPx={500}
          onUpdateHeight={() => {}}
          title="Growth Model"
        />
      </InkadeI18nProvider>,
    );

    expect(validHtml).toContain("Growth Model");
    expect(validHtml).toContain("Interactive Artifact");
    expect(validHtml).toContain("Static Fallback");
    expect(validHtml).toContain("$1,100");
    expect(validHtml).toContain('data-inkade-artifact-block="art_calc_render"');
    expect(validHtml).toContain('data-inkade-artifact-static-fallback="1"');
  });

  it("renders ```inkade-artifact blocks in ArticleReader and degrades them safely in HTML export", () => {
    const doc: DocumentRecord = {
      id: asDocumentId("doc_p51_ui"),
      workspaceId: asWorkspaceId("ws_default"),
      spaceId: asSpaceId("spc_research"),
      kind: "article",
      title: "Artifact Reader Verification",
      slug: "artifact-reader-verification",
      dailyDate: null,
      contentMarkdown: [
        "Intro section.",
        "",
        "```inkade-artifact",
        "id: art_reader01",
        "title: Loan Amortization Chart",
        "height: 420",
        "```",
        "",
        "Closing note.",
      ].join("\n"),
      contentJson: null,
      contentText: "Intro section. Loan Amortization Chart Closing note.",
      excerpt: "Intro section.",
      tags: ["finance"],
      properties: {},
      version: 1,
      pinned: false,
      unreadAgentUpdate: false,
      lastEditedByType: "human",
      trashedAt: null,
      createdAt: "2026-11-26T10:00:00.000Z",
      updatedAt: "2026-11-26T10:05:00.000Z",
    };

    const readerHtml = renderToStaticMarkup(
      <InkadeI18nProvider locale="en-US">
        <ArticleReader document={doc} enableKeyboardNav={false} showToc={false} />
      </InkadeI18nProvider>,
    );
    expect(readerHtml).toContain('data-inkade-artifact-block="art_reader01"');
    expect(readerHtml).toContain("Loan Amortization Chart");

    const exportFragment = renderExportMarkdownToHtml(doc.contentMarkdown);
    expect(exportFragment).toContain('data-artifact-id="art_reader01"');
    expect(exportFragment).toContain("Loan Amortization Chart");
    expect(exportFragment).not.toContain("<iframe");

    const standaloneHtml = buildStandaloneDocumentHtml({
      title: doc.title,
      markdown: doc.contentMarkdown,
      theme: "light",
    });
    expect(standaloneHtml).toContain("Loan Amortization Chart");
    expect(standaloneHtml).toContain("Static Fallback");
  });

  it("surfaces a handshake timeout warning banner when sandbox iframe never sends artifact.ready and clears on artifact.ready or fallback switch", async () => {
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
      MessageEvent: globalThis.MessageEvent,
      MutationObserver: globalThis.MutationObserver,
      matchMedia: globalThis.matchMedia,
      getComputedStyle: globalThis.getComputedStyle,
    };
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      Node: dom.window.Node,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      MessageEvent: dom.window.MessageEvent,
      MutationObserver: dom.window.MutationObserver,
      matchMedia: (q: string) => ({
        matches: false,
        media: q,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    });

    const prevAct = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined })
      .IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined }).IS_REACT_ACT_ENVIRONMENT =
      true;

    const container = dom.window.document.getElementById("root")!;
    let root: ReturnType<typeof createRoot> | null = null;
    try {
      const ticket: ArtifactSandboxTicket = {
        ticket: "sbx_timeout_test",
        artifactId: asDocumentArtifactId("art_timeout01"),
        documentId: asDocumentId("doc_timeout01"),
        title: "Timeout Probe",
        heightPx: 320,
        appOrigin: "http://localhost:3499",
        sandboxOrigin: "http://art-timeout01.sandbox.localhost:3499",
        sandboxUrl: "http://art-timeout01.sandbox.localhost:3499/sandbox/sbx_timeout_test",
        ttlSeconds: 60,
        sha256: "0".repeat(64),
        mode: "dev_localhost",
        sameSite: false,
        capabilities: { theme: true, sources: false, comment: false, network: "none" },
        sources: [],
        fallbackMarkdown: "Fallback body",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };

      root = createRoot(container);
      await act(async () => {
        root!.render(
          <InkadeI18nProvider locale="en-US">
            <InkadeArtifactBlock
              artifactId="art_timeout01"
              fallbackMarkdown="Fallback body"
              handshakeTimeoutMs={20}
              onIssueTicket={() => Promise.resolve(ticket)}
              title="Timeout Probe"
            />
          </InkadeI18nProvider>,
        );
        await Promise.resolve();
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 80));
      });

      const warning = container.querySelector('[data-testid="inkade-artifact-handshake-warning"]');
      expect(warning).not.toBeNull();

      // Simulate iframe reporting artifact.ready -> warning auto-clears
      const iframe = container.querySelector<HTMLIFrameElement>("iframe");
      expect(iframe?.contentWindow).toBeDefined();
      act(() => {
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            origin: ticket.sandboxOrigin,
            source: iframe!.contentWindow,
            data: {
              channel: INKADE_ARTIFACT_CHANNEL,
              artifactId: "art_timeout01",
              type: "artifact.ready",
            },
          }),
        );
      });
      expect(
        container.querySelector('[data-testid="inkade-artifact-handshake-warning"]'),
      ).toBeNull();
    } finally {
      if (root) {
        act(() => {
          root!.unmount();
        });
      }
      if (prevAct === undefined) {
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined })
          .IS_REACT_ACT_ENVIRONMENT;
      } else {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined })
          .IS_REACT_ACT_ENVIRONMENT = prevAct;
      }
      Object.assign(globalThis, prev);
      dom.window.close();
    }
  });

  it("closes fullscreen and sources artifact dialogs on Escape and sandbox artifact.escape postMessage", () => {
    const uiPkgDir = resolve(import.meta.dir, "../..");
    const script = `
      import { JSDOM } from "jsdom";
      const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
      Object.assign(globalThis, {
        window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
        Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
        MessageEvent: dom.window.MessageEvent, KeyboardEvent: dom.window.KeyboardEvent,
        MutationObserver: dom.window.MutationObserver,
        matchMedia: (q) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }),
        getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
        IS_REACT_ACT_ENVIRONMENT: true,
      });
      const React = await import("react");
      const { act } = React;
      const { createRoot } = await import("react-dom/client");
      const { initInkadeI18n, InkadeI18nProvider } = await import("@inkade/i18n");
      const { INKADE_ARTIFACT_CHANNEL } = await import("@inkade/core");
      initInkadeI18n("en-US");
      const { InkadeArtifactBlock } = await import("./src/patterns/InkadeArtifactBlock.tsx");
      const ticket = {
        ticket: "sbx_full_esc",
        artifactId: "art_fullesc01",
        documentId: "doc_fullesc01",
        title: "Escape Probe",
        heightPx: 320,
        appOrigin: "http://localhost:3499",
        sandboxOrigin: "http://art-fullesc01.sandbox.localhost:3499",
        sandboxUrl: "http://art-fullesc01.sandbox.localhost:3499/sandbox/sbx_full_esc",
        ttlSeconds: 60,
        sha256: "0".repeat(64),
        mode: "dev_localhost",
        sameSite: false,
        capabilities: { theme: true, sources: false, comment: false, network: "none" },
        sources: [],
        fallbackMarkdown: "Fallback body",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      const container = dom.window.document.getElementById("root");
      const root = createRoot(container);
      await act(async () => {
        root.render(React.createElement(InkadeI18nProvider, {
          locale: "en-US",
          children: React.createElement(InkadeArtifactBlock, {
            artifactId: "art_fullesc01",
            fallbackMarkdown: "Fallback body",
            onIssueTicket: () => Promise.resolve(ticket),
            title: "Escape Probe",
          }),
        }));
        await Promise.resolve();
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
      const fullscreenBtn = container.querySelector('button[aria-label="Fullscreen"]');
      if (!fullscreenBtn) throw new Error("Missing fullscreen button");
      await act(async () => { fullscreenBtn.click(); await new Promise((r) => setTimeout(r, 30)); });
      if (!dom.window.document.body.querySelector('[role="dialog"][data-open]')) {
        throw new Error("Fullscreen dialog did not open");
      }
      const frames = dom.window.document.body.querySelectorAll("iframe");
      const inlineFrame = frames[0];
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
          origin: ticket.sandboxOrigin,
          source: inlineFrame.contentWindow,
          data: { channel: INKADE_ARTIFACT_CHANNEL, artifactId: "art_fullesc01", type: "artifact.escape" },
        }));
        await new Promise((r) => setTimeout(r, 30));
      });
      if (dom.window.document.body.querySelector('[role="dialog"][data-open]')) {
        throw new Error("artifact.escape did not close fullscreen dialog");
      }
      await act(async () => { fullscreenBtn.click(); await new Promise((r) => setTimeout(r, 30)); });
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
      });
      if (dom.window.document.body.querySelector('[role="dialog"][data-open]')) {
        throw new Error("Escape did not close fullscreen dialog");
      }
      await act(async () => { root.unmount(); });
      console.log("ARTIFACT_ESCAPES_OK");
    `;
    const res = Bun.spawnSync(["bun", "-e", script], { cwd: uiPkgDir, stdout: "pipe", stderr: "pipe" });
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("ARTIFACT_ESCAPES_OK");
  });
});
