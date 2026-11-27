import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type MdastLinkNode,
  type MdastRoot,
  parseWikilinkInner,
  remarkInkadeCallouts,
  remarkInkadeWikilinks,
} from "./remark-inkade-wikilinks.ts";

describe("remarkInkadeWikilinks", () => {
  it("parses [[Title]], [[Title#Heading]], and [[Title#Heading|Alias]]", () => {
    expect(parseWikilinkInner("Architecture Notes")).toMatchObject({
      target: "Architecture Notes",
      heading: null,
      alias: null,
      displayText: "Architecture Notes",
      fullTarget: "Architecture Notes",
      isAdeThread: false,
    });

    expect(parseWikilinkInner("ADR-009#Plate Patterns|Plate UX")).toMatchObject({
      target: "ADR-009",
      heading: "Plate Patterns",
      alias: "Plate UX",
      displayText: "Plate UX",
      fullTarget: "ADR-009#Plate Patterns",
      isAdeThread: false,
    });

    expect(parseWikilinkInner("ade:bnd_123:bb|Fix Reader")).toMatchObject({
      isAdeThread: true,
      adeBindingId: "bnd_123",
      adeKind: "bb",
      displayText: "Fix Reader",
    });
  });

  it("transforms wikilinks in prose AST while skipping inlineCode and code blocks", () => {
    const tree: MdastRoot = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "See [[Design Doc#Math|Math Section]] and " },
            { type: "inlineCode", value: "[[Ignored Inline]]" },
            { type: "text", value: "." },
          ],
        },
        {
          type: "code",
          value: "const raw = '[[Ignored Fenced]]';",
        },
      ],
    };

    remarkInkadeWikilinks()(tree);
    const paraChildren = tree.children[0]?.children ?? [];
    const link = paraChildren.find((n): n is MdastLinkNode => n.type === "link");
    expect(link?.url).toBe("wikilink:Design%20Doc%23Math");
    expect(link?.children[0]?.value).toBe("Math Section");

    const inlineCode = paraChildren.find((n) => n.type === "inlineCode");
    expect(inlineCode?.value).toBe("[[Ignored Inline]]");
    expect(tree.children[1]?.value).toContain("[[Ignored Fenced]]");
  });

  it("renders wikilinks and GFM callouts cleanly through react-markdown", () => {
    const md = [
      "See [[Design Doc#Math|Math Section]] and `[[Code Ignored]]`.",
      "",
      "> [!WARNING] Breaking Change",
      "> Check [[Migration Guide]] before upgrading.",
    ].join("\n");

    const html = renderToStaticMarkup(
      React.createElement(
        Markdown,
        {
          remarkPlugins: [remarkGfm, remarkInkadeCallouts, remarkInkadeWikilinks],
          urlTransform: (url: string) => url,
        },
        md,
      ),
    );

    expect(html).toContain('href="wikilink:Design%20Doc%23Math"');
    expect(html).toContain("Math Section");
    expect(html).toContain("<code>[[Code Ignored]]</code>");
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain('data-callout-title="Breaking Change"');
    expect(html).toContain('href="wikilink:Migration%20Guide"');
  });
});
