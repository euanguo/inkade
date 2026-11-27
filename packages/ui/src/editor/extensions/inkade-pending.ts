import {
  parseInkadePendingPayload,
  serializeInkadePendingPayload,
  type InkadePendingStatus,
} from "@inkade/core";
import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { InkadePendingNodeView } from "../node-views/InkadePendingNodeView.tsx";

export const InkadePendingExtension = Node.create({
  name: "inkadePending",
  group: "block",
  atom: true,
  selectable: true,
  markdownTokenName: "inkadePending",

  addAttributes() {
    return {
      pendingId: { default: "" },
      label: { default: "" },
      bindingId: { default: "" },
      status: { default: "generating" satisfies InkadePendingStatus },
      rawBody: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="inkade-pending"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          const rawStatus = el.getAttribute("data-status") ?? "generating";
          const status: InkadePendingStatus =
            rawStatus === "queued" || rawStatus === "error" ? rawStatus : "generating";
          return {
            pendingId: el.getAttribute("data-pending-id") ?? "",
            label: el.getAttribute("data-label") ?? "",
            bindingId: el.getAttribute("data-binding-id") ?? "",
            status,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const pendingId = String(HTMLAttributes.pendingId ?? "");
    const label = String(HTMLAttributes.label ?? "");
    const bindingId = String(HTMLAttributes.bindingId ?? "");
    const status = String(HTMLAttributes.status ?? "generating");
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inkade-pending",
        "data-pending-id": pendingId,
        "data-label": label,
        ...(bindingId ? { "data-binding-id": bindingId } : {}),
        "data-status": status,
      }),
    ];
  },

  markdownTokenizer: {
    name: "inkadePending",
    level: "block",
    start(src: string) {
      return src.search(/^`{3,}inkade-pending(?=[ \t]*(?:\r?\n|$))/m);
    },
    tokenize(src: string) {
      const nonEmptyMatch = /^(`{3,})inkade-pending[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n+|$)/.exec(
        src,
      );
      const emptyMatch = nonEmptyMatch
        ? null
        : /^(`{3,})inkade-pending[ \t]*\r?\n\1[ \t]*(?:\r?\n+|$)/.exec(src);
      const match = nonEmptyMatch ?? emptyMatch;
      if (!match) return undefined;
      const body = nonEmptyMatch ? (nonEmptyMatch[2] ?? "") : "";
      const parsed = parseInkadePendingPayload(body);
      return {
        type: "inkadePending",
        raw: match[0],
        pendingId: parsed.id,
        label: parsed.label,
        bindingId: parsed.bindingId ?? "",
        status: parsed.status,
        rawBody: body.replace(/\r?\n$/, ""),
        tokens: [],
      };
    },
  },

  parseMarkdown(token, helpers) {
    const t = token as {
      pendingId?: string;
      label?: string;
      bindingId?: string;
      status?: InkadePendingStatus;
      rawBody?: string;
    };
    return helpers.createNode("inkadePending", {
      pendingId: String(t.pendingId ?? ""),
      label: String(t.label ?? ""),
      bindingId: String(t.bindingId ?? ""),
      status:
        t.status === "queued" || t.status === "error" || t.status === "generating"
          ? t.status
          : "generating",
      rawBody: String(t.rawBody ?? ""),
    });
  },

  renderMarkdown(node) {
    const attrs = (node.attrs ?? {}) as {
      pendingId?: string;
      label?: string;
      bindingId?: string;
      status?: InkadePendingStatus;
      rawBody?: string;
    };
    const pendingId = String(attrs.pendingId ?? "").trim();
    const label = String(attrs.label ?? "").trim();
    const bindingId = String(attrs.bindingId ?? "").trim() || undefined;
    const rawStatus = String(attrs.status ?? "generating");
    const status: InkadePendingStatus =
      rawStatus === "queued" || rawStatus === "error" ? rawStatus : "generating";
    const body = pendingId
      ? serializeInkadePendingPayload({ id: pendingId, label, bindingId, status })
      : String(attrs.rawBody ?? "").trimEnd();
    return `\`\`\`inkade-pending\n${body}\n\`\`\``;
  },

  addNodeView() {
    return ReactNodeViewRenderer(InkadePendingNodeView);
  },
});
