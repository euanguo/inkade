import CodeBlock from "@tiptap/extension-code-block";
import { findChildren, ReactNodeViewRenderer } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { ThemedToken } from "shiki/core";
import { CodeBlockNodeView } from "../node-views/CodeBlockNodeView.tsx";
import {
  ensureCodeTokens,
  resolveShikiLanguage,
  tokenizeCodeSync,
} from "../shiki-highlighter.ts";

export const inkadeShikiHighlightKey = new PluginKey<DecorationSet>("inkadeShikiHighlight");

function formatTokenStyle(token: ThemedToken): string | null {
  const htmlStyle = token.htmlStyle;
  if (!htmlStyle) return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(htmlStyle)) {
    if (value) {
      parts.push(`${key}:${value}`);
    }
  }
  return parts.length > 0 ? parts.join(";") : null;
}

function appendCodeBlockDecorations(
  blockNode: PMNode,
  blockPos: number,
  tokens: readonly (readonly ThemedToken[])[],
  decorations: Decoration[],
): void {
  const text = blockNode.textContent;
  // ProseMirror codeBlock schema has content "text*", so text length equals content size.
  if (blockNode.content.size !== text.length) return;

  const blockFrom = blockPos + 1;
  const blockEnd = blockFrom + blockNode.content.size;
  let offset = 0;

  for (let lineIdx = 0; lineIdx < tokens.length; lineIdx += 1) {
    const lineTokens = tokens[lineIdx] ?? [];
    for (const token of lineTokens) {
      const len = token.content.length;
      if (len > 0) {
        const from = blockFrom + offset;
        const to = Math.min(blockEnd, from + len);
        const style = formatTokenStyle(token);
        if (style && to > from) {
          decorations.push(
            Decoration.inline(from, to, {
              class: "inkade-shiki-token",
              style,
            }),
          );
        }
        offset += len;
      }
    }

    if (offset < text.length) {
      if (text.charCodeAt(offset) === 13 && text.charCodeAt(offset + 1) === 10) {
        offset += 2;
      } else if (text.charCodeAt(offset) === 10) {
        offset += 1;
      }
    }
  }
}

function createShikiHighlightPlugin(options: {
  readonly name: string;
  readonly defaultLanguage: string | null | undefined;
}): Plugin {
  let activeView: EditorView | null = null;
  const pendingBlockLoads = new Set<string>();

  const requestLanguageHighlight = (code: string, language: string): void => {
    const canonical = resolveShikiLanguage(language);
    if (canonical === "plaintext" || canonical === "mermaid" || !code) return;
    const dedupeKey = `${canonical}\0${code}`;
    if (pendingBlockLoads.has(dedupeKey)) return;
    pendingBlockLoads.add(dedupeKey);

    void ensureCodeTokens(code, canonical)
      .then((ready) => {
        if (!ready || !activeView || activeView.isDestroyed) return;
        const tr = activeView.state.tr
          .setMeta(inkadeShikiHighlightKey, true)
          .setMeta("addToHistory", false);
        activeView.dispatch(tr);
      })
      .finally(() => {
        pendingBlockLoads.delete(dedupeKey);
      });
  };

  const buildDecorations = (doc: PMNode): DecorationSet => {
    const decorations: Decoration[] = [];
    const blocks = findChildren(doc, (node) => node.type.name === options.name);

    for (const block of blocks) {
      const rawLanguage =
        (typeof block.node.attrs["language"] === "string" && block.node.attrs["language"]) ||
        options.defaultLanguage ||
        "plaintext";
      const canonical = resolveShikiLanguage(rawLanguage);
      if (canonical === "plaintext" || canonical === "mermaid") continue;

      const text = block.node.textContent;
      if (!text) continue;

      const tokens = tokenizeCodeSync(text, canonical);
      if (tokens) {
        appendCodeBlockDecorations(block.node, block.pos, tokens, decorations);
      } else {
        requestLanguageHighlight(text, canonical);
      }
    }

    return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
  };

  return new Plugin<DecorationSet>({
    key: inkadeShikiHighlightKey,
    view(editorView) {
      activeView = editorView;
      return {
        update(view) {
          activeView = view;
        },
        destroy() {
          if (activeView === editorView) {
            activeView = null;
          }
        },
      };
    },
    state: {
      init: (_, { doc }) => buildDecorations(doc),
      apply: (transaction, decorationSet, oldState, newState) => {
        if (transaction.getMeta(inkadeShikiHighlightKey)) {
          return buildDecorations(newState.doc);
        }
        if (!transaction.docChanged) {
          return decorationSet;
        }

        const oldBlocks = findChildren(oldState.doc, (node) => node.type.name === options.name);
        const newBlocks = findChildren(newState.doc, (node) => node.type.name === options.name);
        const blocksChanged =
          oldBlocks.length !== newBlocks.length ||
          oldBlocks.some((oldBlock, index) => oldBlock.node !== newBlocks[index]?.node);

        if (blocksChanged) {
          return buildDecorations(newState.doc);
        }
        return decorationSet.map(transaction.mapping, transaction.doc);
      },
    },
    props: {
      decorations(state) {
        return inkadeShikiHighlightKey.getState(state);
      },
    },
  });
}

export function pickBacktickFence(codeBody: string): string {
  let maxRun = 2;
  const matches = codeBody.match(/`+/g);
  if (matches) {
    for (const run of matches) {
      if (run.length > maxRun) {
        maxRun = run.length;
      }
    }
  }
  return "`".repeat(maxRun + 1);
}

export const InkadeCodeBlockExtension = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },

  renderMarkdown(node, h) {
    const language =
      typeof node.attrs?.language === "string" && node.attrs.language.trim()
        ? node.attrs.language.trim()
        : "";
    if (!node.content || node.content.length === 0) {
      return `\`\`\`${language}\n\n\`\`\``;
    }
    const body = h.renderChildren(node.content);
    const fence = pickBacktickFence(body);
    return `${fence}${language}\n${body}\n${fence}`;
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      createShikiHighlightPlugin({
        name: this.name,
        defaultLanguage: this.options.defaultLanguage,
      }),
    ];
  },
}).configure({
  defaultLanguage: "plaintext",
  exitOnTripleEnter: true,
  exitOnArrowDown: true,
});
