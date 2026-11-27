import { describe, expect, it } from "bun:test";
import TaskList from "@tiptap/extension-task-list";
import { Editor, type Extensions, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { JSDOM } from "jsdom";
import { InkadeCodeBlockExtension } from "./code-block.ts";
import { InkadeInlineMathExtension } from "./math.ts";
import { InkadeTaskItem } from "./task-item.ts";
import { normalizeExternalUrl, normalizeImageUrl } from "../markdown-utils.ts";

function getNodeAttr(node: JSONContent | undefined, key: string): unknown {
  if (!node?.attrs) return undefined;
  return (node.attrs as Record<string, unknown>)[key];
}

function withDomEditor(extensions: Extensions, run: (editor: Editor) => void): void {
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
      extensions,
      content: "<p></p>",
    });
    try {
      run(editor);
    } finally {
      editor.destroy();
    }
  } finally {
    Object.assign(globalThis, prevGlobals);
    dom.window.close();
  }
}

function simulateTyping(editor: Editor, text: string): void {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (fn) =>
      fn(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)),
    );
    if (!handled) {
      editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
    }
  }
}

describe("URL normalization & validation", () => {
  it("rejects invalid hostnames and dangerous schemes for links and images", () => {
    expect(normalizeExternalUrl("")).toBeNull();
    expect(normalizeExternalUrl("   ")).toBeNull();
    expect(normalizeExternalUrl("not-a-valid-url")).toBeNull();
    expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalUrl("vbscript:msgbox(1)")).toBeNull();
    expect(normalizeExternalUrl("data:text/html,<script>1</script>")).toBeNull();
    expect(normalizeExternalUrl("http://missing-tld")).toBeNull();

    expect(normalizeExternalUrl("https://example.com/docs?a=1")).toBe(
      "https://example.com/docs?a=1",
    );
    expect(normalizeExternalUrl("example.com/path")).toBe("https://example.com/path");
    expect(normalizeExternalUrl("/api/v1/docs/1")).toBe("/api/v1/docs/1");
    expect(normalizeExternalUrl("mailto:team@example.com")).toBe("mailto:team@example.com");

    expect(normalizeImageUrl("not-a-valid-url")).toBeNull();
    expect(normalizeImageUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeImageUrl("mailto:team@example.com")).toBeNull();
    expect(normalizeImageUrl("https://cdn.example.com/pic.png")).toBe(
      "https://cdn.example.com/pic.png",
    );
    expect(normalizeImageUrl("/api/v1/attachments/att_1")).toBe("/api/v1/attachments/att_1");
    expect(normalizeImageUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });
});

describe("InkadeTaskItem live input rules", () => {
  const extensions = [
    StarterKit.configure({ codeBlock: false }),
    InkadeCodeBlockExtension,
    TaskList,
    InkadeTaskItem.configure({
      nested: true,
      HTMLAttributes: { "data-type": "taskItem" },
    }),
  ];

  it("converts '- [ ] ', '* [x] ', and '[] ' into taskList > taskItem with checked attrs", () => {
    withDomEditor(extensions, (editor) => {
      editor.commands.setTextSelection(1);
      simulateTyping(editor, "- [ ] Todo A");

      const firstJson = editor.getJSON();
      expect(firstJson.content?.[0]?.type).toBe("taskList");
      expect(firstJson.content?.[0]?.content?.[0]?.type).toBe("taskItem");
      expect(getNodeAttr(firstJson.content?.[0]?.content?.[0], "checked")).toBe(false);
      expect(editor.getHTML()).toContain('data-type="taskItem"');
      expect(editor.getText()).toContain("Todo A");

      editor.commands.splitBlock();
      simulateTyping(editor, "* [x] Done B");
      const html = editor.getHTML();
      expect(html).toContain('data-checked="false"');
      expect(html).toContain('data-checked="true"');
      expect(editor.getText()).toContain("Done B");
      expect(editor.getText()).not.toContain("[x]");
    });
  });

  it("strips '- [x] ' prefix and updates checked state when typed inside an existing taskItem", () => {
    withDomEditor(extensions, (editor) => {
      editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>');
      let paraPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (paraPos === -1 && node.type.name === "paragraph") {
          paraPos = pos + 1;
        }
      });
      expect(paraPos).toBeGreaterThan(0);
      editor.commands.setTextSelection(paraPos);
      simulateTyping(editor, "- [x] Done existing");

      const json = editor.getJSON();
      expect(getNodeAttr(json.content?.[0]?.content?.[0], "checked")).toBe(true);
      expect(editor.getText()).toContain("Done existing");
      expect(editor.getText()).not.toContain("- [x]");
    });
  });

  it("splits multi-item bulletList cleanly when converting one item to a taskItem", () => {
    withDomEditor(extensions, (editor) => {
      editor.commands.setContent("<ul><li><p>Keep bullet</p></li><li><p></p></li></ul>");
      let secondItemPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "listItem" && node.textContent === "") {
          secondItemPos = pos + 2;
        }
      });
      expect(secondItemPos).toBeGreaterThan(0);
      editor.commands.setTextSelection(secondItemPos);
      simulateTyping(editor, "[x] Converted item");

      const content = editor.getJSON().content ?? [];
      expect(content[0]?.type).toBe("bulletList");
      expect(content[1]?.type).toBe("taskList");
      expect(getNodeAttr(content[1]?.content?.[0], "checked")).toBe(true);
      expect(editor.getHTML()).toContain('data-checked="true"');
      expect(editor.getText()).toContain("Keep bullet");
      expect(editor.getText()).toContain("Converted item");
    });
  });

  it("supports bare '[] ' in a standalone paragraph", () => {
    withDomEditor(extensions, (editor) => {
      editor.commands.setTextSelection(1);
      simulateTyping(editor, "[] Bare Todo");
      const json = editor.getJSON();
      expect(json.content?.[0]?.type).toBe("taskList");
      expect(getNodeAttr(json.content?.[0]?.content?.[0], "checked")).toBe(false);
      expect(editor.getText()).toContain("Bare Todo");
    });
  });
});

describe("InkadeInlineMathExtension live input rules", () => {
  const extensions = [
    StarterKit.configure({ codeBlock: false }),
    InkadeCodeBlockExtension,
    InkadeInlineMathExtension,
  ];

  it("converts '$E = mc^2$' and '$x$' into inline math nodes without eating preceding chars", () => {
    withDomEditor(extensions, (editor) => {
      editor.commands.setTextSelection(1);
      simulateTyping(editor, "Energy $E = mc^2$ and $x$");

      const para = editor.getJSON().content?.[0];
      const mathNodes = (para?.content ?? []).filter((n) => n.type === "inkadeInlineMath");
      expect(mathNodes).toHaveLength(2);
      expect(getNodeAttr(mathNodes[0], "latex")).toBe("E = mc^2");
      expect(getNodeAttr(mathNodes[1], "latex")).toBe("x");

      const html = editor.getHTML();
      expect(html).toContain("Energy ");
      expect(html).toContain('data-type="inkade-inline-math"');
    });
  });

  it("ignores currency ranges like '$5-$10' and ignores code blocks", () => {
    withDomEditor(extensions, (editor) => {
      editor.commands.setTextSelection(1);
      simulateTyping(editor, "Budget $5-$10 today");
      const para = editor.getJSON().content?.[0];
      const mathNodes = (para?.content ?? []).filter((n) => n.type === "inkadeInlineMath");
      expect(mathNodes).toHaveLength(0);

      editor.commands.setContent("<pre><code></code></pre>");
      editor.commands.setTextSelection(1);
      simulateTyping(editor, "$a+b$");
      const codeNode = editor.getJSON().content?.[0];
      expect(codeNode?.type).toBe("codeBlock");
      expect(editor.getHTML()).not.toContain('data-type="inkade-inline-math"');
    });
  });
});
