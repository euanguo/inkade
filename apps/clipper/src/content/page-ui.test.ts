import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { parseHTML } from "linkedom";
import {
  buildDocumentTextIndex,
  locateHighlightRange,
  mapOffsetSpanToRange,
  resolveHighlightNodeOffsets,
} from "./highlight-renderer.ts";
import { sanitizeReaderHtml } from "./reader-sanitizer.ts";
import {
  expandRegionToParent,
  findInitialSelectableElement,
  moveRegionToSibling,
  shrinkRegionToChild,
} from "./region-selector-core.ts";

describe("@inkade/clipper Phase C2 page UI engines", () => {
  test("buildDocumentTextIndex skips clipper Shadow root & scripts and resolves cross-node W3C anchors", () => {
    const { document } = parseHTML(`
      <html>
        <body>
          <article>
            <p>First <strong>bold anchor</strong> paragraph ends here.</p>
            <script>var ignored = "bold anchor";</script>
          </article>
          <div id="inkade-clipper-root">Clipper shadow UI text</div>
        </body>
      </html>
    `);

    const index = buildDocumentTextIndex(document.body);
    expect(index.fullText).toContain("First bold anchor paragraph ends here.");
    expect(index.fullText).not.toContain("var ignored");
    expect(index.fullText).not.toContain("Clipper shadow UI text");

    // Test cross-TextNode span resolution ("bold anchor paragraph")
    const spanStart = index.fullText.indexOf("bold anchor paragraph");
    const spanEnd = spanStart + "bold anchor paragraph".length;
    const endpoints = resolveHighlightNodeOffsets(index, spanStart, spanEnd);
    expect(endpoints).not.toBeNull();
    expect(endpoints?.startNode.textContent).toBe("bold anchor");
    expect(endpoints?.startOffset).toBe(0);
    expect(endpoints?.endNode.textContent).toBe(" paragraph ends here.");
    expect(endpoints?.endOffset).toBe(" paragraph".length);

    // Attach a browser-compliant createRange shim for verifying Range construction
    const fakeRangeCalls: Array<{ startOffset: number; endOffset: number; startText: string | null; endText: string | null }> = [];
    const rangeDoc = {
      body: document.body,
      createRange() {
        let sNode: Text | null = null;
        let eNode: Text | null = null;
        let sOff = 0;
        let eOff = 0;
        return {
          setStart(n: Node, off: number) {
            sNode = n as Text;
            sOff = off;
          },
          setEnd(n: Node, off: number) {
            eNode = n as Text;
            eOff = off;
            fakeRangeCalls.push({
              startOffset: sOff,
              endOffset: eOff,
              startText: sNode?.textContent ?? null,
              endText: eNode?.textContent ?? null,
            });
          },
        } as unknown as Range;
      },
    } as unknown as Document;

    const range = mapOffsetSpanToRange(rangeDoc, index, spanStart, spanEnd);
    expect(range).not.toBeNull();

    const located = locateHighlightRange(
      rangeDoc,
      {
        quote: "bold anchor paragraph",
        prefixContext: "First ",
        suffixContext: " ends here.",
      },
      index,
    );
    expect(located?.exact).toBe(true);
    expect(fakeRangeCalls).toHaveLength(2);
    expect(fakeRangeCalls[1]?.startText).toBe("bold anchor");
    expect(fakeRangeCalls[1]?.endText).toBe(" paragraph ends here.");
    expect(fakeRangeCalls[1]?.endOffset).toBe(" paragraph".length);
  });

  test("RegionPicker keyboard state machine navigates parent, child stack, and siblings cleanly", () => {
    const { document } = parseHTML(`
      <html>
        <body>
          <main id="main">
            <section id="sec1">
              <p id="p1">Paragraph with <span id="span1">inline</span> text.</p>
            </section>
            <section id="sec2"><p id="p2">Second section content</p></section>
          </main>
          <div id="inkade-clipper-root">HUD</div>
        </body>
      </html>
    `);

    const span1 = document.getElementById("span1") as unknown as Element;
    const p1 = document.getElementById("p1") as unknown as Element;
    const sec1 = document.getElementById("sec1") as unknown as Element;
    const sec2 = document.getElementById("sec2") as unknown as Element;
    const main = document.getElementById("main") as unknown as Element;
    const rootHud = document.getElementById("inkade-clipper-root") as unknown as Element;

    expect(findInitialSelectableElement(rootHud)).toBeNull();
    expect(findInitialSelectableElement(span1)?.id).toBe("p1");

    // ArrowLeft expands p1 -> sec1 -> main (stops before body)
    const exp1 = expandRegionToParent(p1, []);
    expect(exp1.next.id).toBe("sec1");
    expect(exp1.stack.map((e) => e.id)).toEqual(["p1"]);

    const exp2 = expandRegionToParent(exp1.next, exp1.stack);
    expect(exp2.next.id).toBe("main");
    expect(exp2.stack.map((e) => e.id)).toEqual(["p1", "sec1"]);

    const expAtBody = expandRegionToParent(main, exp2.stack);
    expect(expAtBody.next.id).toBe("main");

    // ArrowRight shrinks back along stack
    const shr1 = shrinkRegionToChild(exp2.next, exp2.stack);
    expect(shr1.next.id).toBe("sec1");
    const shr2 = shrinkRegionToChild(shr1.next, shr1.stack);
    expect(shr2.next.id).toBe("p1");

    // ArrowUp / ArrowDown moves between sec1 and sec2
    expect(moveRegionToSibling(sec1, 1)?.id).toBe("sec2");
    expect(moveRegionToSibling(sec2, -1)?.id).toBe("sec1");
    expect(moveRegionToSibling(sec2, 1)).toBeNull();
  });

  test("sanitizeReaderHtml strips XSS vectors while keeping clean article markup", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const dirty = `
      <article>
        <h1 onclick="alert(1)">Clean Title</h1>
        <p style="color:red">Safe text with <a href="javascript:alert(2)">bad link</a> and <a href="https://inkade.app">good link</a>.</p>
        <img src="https://cdn.example.com/ok.png" onerror="steal()" />
        <img src="data:image/svg+xml;base64,PHN2Zz4=" />
        <img src="data:image/png;base64,iVBORw0KGgo=" />
        <svg onload="alert(3)"><circle r="10" /></svg>
        <math><mi onclick="alert(4)">x</mi></math>
        <script>window.pwned = true;</script>
        <iframe src="https://evil.example.com"></iframe>
      </article>
    `;
    const clean = sanitizeReaderHtml(dirty, dom.window.document);
    expect(clean).toContain("Clean Title");
    expect(clean).toContain("https://inkade.app");
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain("https://cdn.example.com/ok.png");
    expect(clean).toContain("data:image/png;base64,iVBORw0KGgo=");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onload");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("data:image/svg+xml");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<svg");
    expect(clean).not.toContain("<math");
    expect(clean).not.toContain("style=");

    // Fails closed when no supported DOM window is available
    expect(sanitizeReaderHtml(dirty)).toBe("");
  });

  test("buildDocumentTextIndex and locateHighlightRange support Shadow DOM Reader article rootNode", () => {
    const { document } = parseHTML(`
      <html>
        <body>
          <div id="inkade-clipper-root">
            <article id="reader-body">
              <p>Reader mode enables focused W3C highlighting.</p>
            </article>
            <div data-inkade-ui-chrome="true">focused W3C highlighting</div>
          </div>
        </body>
      </html>
    `);

    const readerEl = document.getElementById("reader-body") as unknown as Element;
    const index = buildDocumentTextIndex(readerEl);
    expect(index.fullText.trim()).toBe("Reader mode enables focused W3C highlighting.");

    const hostIndex = buildDocumentTextIndex(document.body);
    expect(hostIndex.fullText.trim()).toBe("");

    const rangeDoc = {
      body: document.body,
      createRange() {
        return {
          setStart() {},
          setEnd() {},
        } as unknown as Range;
      },
    } as unknown as Document;

    const located = locateHighlightRange(
      rangeDoc,
      { quote: "focused W3C highlighting", prefixContext: "enables ", suffixContext: "." },
      index,
      readerEl,
    );
    expect(located?.exact).toBe(true);
  });
});
