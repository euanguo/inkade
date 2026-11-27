"use client";

import {
  type AdeKind,
  type AdeThreadBinding,
  type AdeThreadStatus,
  asDocumentId,
  asThreadBindingId,
  asWorkspaceId,
  DEFAULT_HOST_KIND,
  normalizeHostKind,
} from "@inkade/core";
import { t as translate } from "@inkade/i18n";
import {
  mergeAttributes,
  Node,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type React from "react";
import { AdeThreadChip } from "./AdeThreadChip.tsx";

export interface AdeThreadChipExtensionOptions {
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly getBindingById?: ((id: string) => AdeThreadBinding | undefined) | undefined;
}

function normalizeAdeKind(raw: unknown): AdeKind {
  return normalizeHostKind(raw);
}

function AdeThreadChipNodeView({
  node,
  extension,
}: ReactNodeViewProps): React.ReactElement {
  const attrs = node.attrs as {
    bindingId?: string;
    adeKind?: AdeKind;
    status?: AdeThreadStatus;
    title?: string;
    externalThreadId?: string;
  };
  const opts = extension.options as AdeThreadChipExtensionOptions;
  const resolved = attrs.bindingId ? opts.getBindingById?.(attrs.bindingId) : undefined;

  const binding: AdeThreadBinding = resolved ?? {
    id: asThreadBindingId(attrs.bindingId ?? "ade_inline"),
    workspaceId: asWorkspaceId("ws_inline"),
    documentId: asDocumentId("doc_inline"),
    nodeId: null,
    selectionAnchor: null,
    adeKind: attrs.adeKind ?? "bb",
    externalWorkspaceId: null,
    externalThreadId: attrs.externalThreadId ?? attrs.bindingId ?? "thread",
    deepLink: null,
    title: attrs.title ?? translate("editor.defaultThreadTitle"),
    status: attrs.status ?? "queued",
    lastSummary: null,
    unreadResult: false,
    lastSyncedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  return (
    <NodeViewWrapper as="span" className="mx-1 inline-flex align-middle" contentEditable={false}>
      <AdeThreadChip binding={binding} compact onOpenInAde={opts.onOpenBinding} />
    </NodeViewWrapper>
  );
}

/**
 * Custom Tiptap inline Node extension embedding interactive `AdeThreadChip`s
 * directly inside rich-text articles with 100% lossless Markdown roundtrip.
 */
export const AdeThreadChipExtension = Node.create<AdeThreadChipExtensionOptions>({
  name: "adeThreadChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  markdownTokenName: "adeThreadChip",

  addOptions() {
    return {
      onOpenBinding: undefined,
      getBindingById: undefined,
    };
  },

  addAttributes() {
    return {
      bindingId: { default: "" },
      adeKind: { default: DEFAULT_HOST_KIND satisfies AdeKind },
      status: { default: "queued" satisfies AdeThreadStatus },
      title: { default: "" },
      externalThreadId: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="ade-thread-chip"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return {
            bindingId: el.getAttribute("data-binding-id") ?? "",
            adeKind: normalizeAdeKind(el.getAttribute("data-ade-kind")),
            title: el.getAttribute("data-title") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "ade-thread-chip",
        "data-binding-id": String(HTMLAttributes.bindingId ?? ""),
        "data-ade-kind": normalizeAdeKind(HTMLAttributes.adeKind),
        "data-title": String(HTMLAttributes.title ?? "") || translate("editor.defaultThreadTitle"),
      }),
    ];
  },

  markdownTokenizer: {
    name: "adeThreadChip",
    level: "inline",
    start(src: string) {
      return src.indexOf("[[ade:");
    },
    tokenize(src: string) {
      const match = /^\[\[ade:([^:|\]]+):([^|\]]+)\|([^\]]+)\]\]/.exec(src);
      if (!match || !match[1] || !match[2] || !match[3]) return undefined;
      return {
        type: "adeThreadChip",
        raw: match[0],
        bindingId: match[1].trim(),
        adeKind: normalizeAdeKind(match[2].trim()),
        title: match[3].trim(),
        tokens: [],
      };
    },
  },

  parseMarkdown(token, helpers) {
    const t = token as { bindingId?: string; adeKind?: AdeKind; title?: string };
    return helpers.createNode("adeThreadChip", {
      bindingId: String(t.bindingId ?? ""),
      adeKind: normalizeAdeKind(t.adeKind),
      title: String(t.title ?? ""),
    });
  },

  renderMarkdown(node) {
    const bindingId = String(node.attrs?.bindingId ?? "");
    const title = (String(node.attrs?.title ?? "").trim() || translate("editor.defaultThreadTitle")).replace(
      /\]/g,
      "",
    );
    const adeKind = normalizeAdeKind(node.attrs?.adeKind);
    return `[[ade:${bindingId}:${adeKind}|${title}]]`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(AdeThreadChipNodeView);
  },
});
