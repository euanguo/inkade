import { describe, expect, it } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { InkadeCodeBlockExtension, inkadeShikiHighlightKey } from "./extensions/code-block.ts";
import {
  ensureCodeTokens,
  getCachedShikiHtml,
  highlightCodeToHtml,
  resolveShikiLanguage,
  SHIKI_SUPPORTED_LANGUAGES,
  tokenizeCodeSync,
} from "./shiki-highlighter.ts";

describe("Lazy Shiki highlighter & codeBlock extension", () => {
  it("resolves language aliases and falls back safely for unknown languages", () => {
    expect(resolveShikiLanguage("ts")).toBe("typescript");
    expect(resolveShikiLanguage("PY")).toBe("python");
    expect(resolveShikiLanguage("sh")).toBe("bash");
    expect(resolveShikiLanguage("mermaid")).toBe("mermaid");
    expect(resolveShikiLanguage("unknown-custom-lang")).toBe("plaintext");
    expect(SHIKI_SUPPORTED_LANGUAGES).toContain("typescript");
    expect(SHIKI_SUPPORTED_LANGUAGES).toContain("mermaid");
  });

  it("lazily highlights code to HTML and populates the HTML cache", async () => {
    const code = "const greeting: string = 'hello';";
    const html = await highlightCodeToHtml(code, "ts", "light");
    expect(html).not.toBeNull();
    expect(html).toContain("<pre");
    expect(html).toContain("greeting");
    expect(getCachedShikiHtml(code, "typescript", "light")).toBe(html);

    const fallbackHtml = await highlightCodeToHtml("plain text sample", "nonexistent-lang", "dark");
    expect(fallbackHtml).not.toBeNull();
    expect(fallbackHtml).toContain("plain text sample");
  });

  it("tokenizes dual-theme Shiki tokens and decorates ProseMirror codeBlock nodes", async () => {
    const code = "function add(a: number, b: number) {\n  return a + b;\n}";
    const ready = await ensureCodeTokens(code, "ts");
    expect(ready).toBe(true);

    const tokens = tokenizeCodeSync(code, "typescript");
    expect(tokens).not.toBeNull();
    expect(tokens?.length).toBe(3);

    const testSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { group: "block", content: "text*" },
        codeBlock: {
          group: "block",
          content: "text*",
          marks: "",
          code: true,
          attrs: { language: { default: "plaintext" } },
        },
        text: { group: "inline" },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("codeBlock", { language: "ts" }, [testSchema.text(code)]),
    ]);

    const rawPlugins = InkadeCodeBlockExtension.config.addProseMirrorPlugins?.call({
      name: "codeBlock",
      options: InkadeCodeBlockExtension.options,
      storage: {},
      editor: {} as never,
      type: testSchema.nodes["codeBlock"],
      parent: () => [],
    }) ?? [];

    const state = EditorState.create({
      doc,
      schema: testSchema,
      plugins: rawPlugins,
    });

    const decos = inkadeShikiHighlightKey.getState(state);
    expect(decos).toBeDefined();
    const found = decos?.find(0, doc.content.size) ?? [];
    expect(found.length).toBeGreaterThan(0);
    const firstDecoHtml = JSON.stringify(found[0]);
    expect(firstDecoHtml).toContain("inkade-shiki-token");
    expect(firstDecoHtml).toContain("--shiki-light");
    expect(firstDecoHtml).toContain("--shiki-dark");
  });
});
