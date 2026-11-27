import {
  DOCX_MIME_TYPE,
  INKADE_ARTIFACT_FENCE_LANG,
  INKADE_PENDING_FENCE_LANG,
  parseInkadeArtifactPayload,
  parseInkadePendingPayload,
  stripMarkdownSpeakerNotes,
  type InkadeArtifactFencePayload,
  type InkadePendingPayload,
  type ReaderFontFamilyPref,
  type ReaderFontSizePref,
  type ReaderMeasurePref,
  type ReaderPaperModePref,
} from "@inkade/core";
import { t as translate } from "@inkade/i18n";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import {
  remarkInkadeCallouts,
  remarkInkadeHighlights,
  remarkInkadeWikilinks,
} from "../patterns/remark-inkade-wikilinks.ts";

export interface StandaloneHtmlExportInput {
  readonly title: string;
  readonly bodyHtml?: string | undefined;
  readonly markdown?: string | undefined;
  readonly theme?: "light" | "dark" | undefined;
  readonly paperMode?: ReaderPaperModePref | undefined;
  readonly font?: ReaderFontFamilyPref | undefined;
  readonly fontSize?: ReaderFontSizePref | undefined;
  readonly measure?: ReaderMeasurePref | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly updatedAt?: string | undefined;
}

export function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getClassList(node: Element): string[] {
  const raw: unknown = node.properties["className"];
  if (Array.isArray(raw)) {
    return raw.map(String);
  }
  if (typeof raw === "string") {
    return raw.split(/\s+/).filter(Boolean);
  }
  return [];
}

function extractHastText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(extractHastText).join("");
  return "";
}

function buildPendingExportElement(parsed: InkadePendingPayload): Element {
  const badgeText =
    parsed.status === "error"
      ? translate("inkadePending.badgeError")
      : parsed.status === "queued"
        ? translate("inkadePending.badgeQueued")
        : translate("inkadePending.exportBadge");
  const labelText = parsed.label || translate("inkadePending.defaultLabel");
  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["inkade-pending-card"],
      ...(parsed.id ? { "data-pending-id": parsed.id } : {}),
      "data-pending-status": parsed.status,
    },
    children: [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["inkade-pending-header"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["inkade-pending-badge"] },
            children: [{ type: "text", value: badgeText }],
          },
          ...(parsed.id
            ? [
                {
                  type: "element",
                  tagName: "span",
                  properties: { className: ["inkade-pending-id"] },
                  children: [{ type: "text", value: parsed.id }],
                } satisfies Element,
              ]
            : []),
        ],
      },
      {
        type: "element",
        tagName: "div",
        properties: { className: ["inkade-pending-label"] },
        children: [{ type: "text", value: labelText }],
      },
    ],
  };
}

function buildArtifactExportElement(parsed: InkadeArtifactFencePayload): Element {
  const badgeText = translate("inkadeArtifact.fallbackBadge");
  const labelText = parsed.title || translate("inkadeArtifact.titleFallback");
  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["inkade-pending-card"],
      ...(parsed.id ? { "data-artifact-id": parsed.id } : {}),
    },
    children: [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["inkade-pending-header"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["inkade-pending-badge"] },
            children: [{ type: "text", value: badgeText }],
          },
          ...(parsed.id
            ? [
                {
                  type: "element",
                  tagName: "span",
                  properties: { className: ["inkade-pending-id"] },
                  children: [{ type: "text", value: parsed.id }],
                } satisfies Element,
              ]
            : []),
        ],
      },
      {
        type: "element",
        tagName: "div",
        properties: { className: ["inkade-pending-label"] },
        children: [{ type: "text", value: labelText }],
      },
    ],
  };
}

function transformExportHastChildren(children: ElementContent[]): void {
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (!child || child.type !== "element") continue;

    if (Array.isArray(child.children)) {
      transformExportHastChildren(child.children);
    }

    const rawCallout =
      child.properties["data-callout"] ?? child.properties["dataCallout"];
    if (child.tagName === "blockquote" && rawCallout) {
      const calloutType = String(rawCallout).toLowerCase();
      const rawTitle =
        child.properties["data-callout-title"] ?? child.properties["dataCalloutTitle"];
      const headerLabel =
        typeof rawTitle === "string" && rawTitle.trim().length > 0
          ? rawTitle.trim()
          : calloutType.toUpperCase();
      children[i] = {
        type: "element",
        tagName: "div",
        properties: {
          className: ["inkade-callout"],
          "data-callout-type": calloutType,
        },
        children: [
          {
            type: "element",
            tagName: "div",
            properties: { className: ["inkade-callout-header"] },
            children: [{ type: "text", value: headerLabel }],
          },
          {
            type: "element",
            tagName: "div",
            properties: { className: ["inkade-callout-body"] },
            children: child.children,
          },
        ],
      };
      continue;
    }

    if (child.tagName === "ul" && getClassList(child).includes("contains-task-list")) {
      child.properties["data-type"] = "taskList";
    }

    if (child.tagName === "li" && getClassList(child).includes("task-list-item")) {
      const checkbox = findCheckboxInput(child);
      if (checkbox) {
        child.properties["data-checked"] = String(Boolean(checkbox.properties["checked"]));
      }
    }

    if (child.tagName === "pre") {
      const codeNode = child.children.find(
        (n): n is Element => n.type === "element" && n.tagName === "code",
      );
      if (codeNode) {
        const langClass = getClassList(codeNode).find((c) => c.startsWith("language-"));
        if (langClass) {
          const lang = langClass.slice("language-".length);
          child.properties["data-language"] = lang;
          if (lang.toLowerCase() === INKADE_PENDING_FENCE_LANG) {
            const parsed = parseInkadePendingPayload(extractHastText(codeNode));
            children[i] = buildPendingExportElement(parsed);
            continue;
          }
          if (lang.toLowerCase() === INKADE_ARTIFACT_FENCE_LANG) {
            const parsed = parseInkadeArtifactPayload(extractHastText(codeNode));
            children[i] = buildArtifactExportElement(parsed);
            continue;
          }
        }
      }
    }

    if (child.tagName === "a") {
      const href = typeof child.properties["href"] === "string" ? child.properties["href"] : "";
      if (href.startsWith("wikilink:") || href.startsWith("ade-thread:")) {
        children[i] = {
          type: "element",
          tagName: "span",
          properties: { className: ["inkade-wikilink-pill"] },
          children: child.children,
        };
      }
    }
  }
}

function findCheckboxInput(node: Element): Element | null {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "input" && child.properties["type"] === "checkbox") {
      return child;
    }
    const nested = findCheckboxInput(child);
    if (nested) return nested;
  }
  return null;
}

function rehypeInkadeExportElements(): (tree: HastRoot) => void {
  return (tree: HastRoot) => {
    transformExportHastChildren(tree.children as ElementContent[]);
  };
}

/**
 * Encodes stray `>` characters outside HTML tag tokens into `&gt;` so text nodes inside
 * serialized HTML stay symmetric with `&lt;` regardless of browser/parser quirks.
 */
function encodeTextGreaterThan(html: string): string {
  let out = "";
  let inTag = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < html.length; i += 1) {
    const ch = html[i]!;
    if (inTag) {
      out += ch;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        inTag = false;
      }
      continue;
    }

    if (ch === "<") {
      inTag = true;
      out += ch;
    } else if (ch === ">") {
      out += "&gt;";
    } else {
      out += ch;
    }
  }

  return out;
}

/**
 * AST-backed Markdown-to-HTML exporter sharing remark plugins with `ArticleReader`
 * (`remark-parse` + `remark-gfm` + `remark-rehype` + `rehype-stringify`), neutralizing raw HTML.
 */
export function renderExportMarkdownToHtml(markdown: string): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkInkadeCallouts)
    .use(remarkInkadeHighlights)
    .use(remarkInkadeWikilinks)
    .use(remarkRehype, {
      handlers: {
        // Convert inline/block raw HTML into literal escaped text instead of executable markup.
        html: (_state: unknown, node: { readonly value?: unknown }) => ({
          type: "text",
          value: typeof node.value === "string" ? node.value : "",
        }),
      },
    })
    .use(rehypeInkadeExportElements)
    .use(rehypeStringify, {
      characterReferences: {
        useShortestReferences: false,
        useNamedReferences: true,
      },
    });

  const sanitizedMarkdown = stripMarkdownSpeakerNotes(markdown);
  const serialized = String(processor.processSync(sanitizedMarkdown));
  return encodeTextGreaterThan(serialized);
}

function resolveFontStack(font: "sans" | "serif" | "mono"): string {
  if (font === "serif") {
    return 'Georgia, Cambria, "Songti SC", "Noto Serif CJK SC", "Times New Roman", serif';
  }
  if (font === "mono") {
    return '"SFMono-Regular", ui-monospace, "JetBrains Mono", Menlo, Monaco, Consolas, monospace';
  }
  return '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif';
}

function resolveFontSizePx(fontSize: "sm" | "base" | "lg"): string {
  if (fontSize === "sm") return "15px";
  if (fontSize === "lg") return "18px";
  return "16px";
}

function resolveSurfacePalette(
  theme: "light" | "dark",
  paperMode: ReaderPaperModePref,
): {
  readonly bg: string;
  readonly fg: string;
  readonly muted: string;
  readonly border: string;
  readonly codeBg: string;
  readonly accent: string;
} {
  if (paperMode === "sepia") {
    if (theme === "dark") {
      return {
        bg: "#161411",
        fg: "#e6dec8",
        muted: "#a99e87",
        border: "#2c2720",
        codeBg: "#211d17",
        accent: "#d99b52",
      };
    }
    return {
      bg: "#fbf8f1",
      fg: "#2b251e",
      muted: "#6e6556",
      border: "#e8dfc9",
      codeBg: "#f2ebdc",
      accent: "#9f580a",
    };
  }
  if (theme === "dark") {
    return {
      bg: "#131316",
      fg: "#f4f4f6",
      muted: "#a1a1aa",
      border: "#27272a",
      codeBg: "#1c1c21",
      accent: "#818cf8",
    };
  }
  return {
    bg: "#ffffff",
    fg: "#18181b",
    muted: "#71717a",
    border: "#e4e4e7",
    codeBg: "#f4f4f5",
    accent: "#4f46e5",
  };
}

/**
 * Produces a complete, self-contained HTML5 document that opens identically offline
 * with Inkade callout/column/code/typography/sepia styling embedded.
 */
export function buildStandaloneDocumentHtml(input: StandaloneHtmlExportInput): string {
  const theme = input.theme ?? "light";
  const paperMode = input.paperMode ?? "default";
  const font = input.font ?? "sans";
  const fontSize = input.fontSize ?? "base";
  const measure = input.measure ?? "72ch";
  const palette = resolveSurfacePalette(theme, paperMode);
  const bodyHtml =
    input.bodyHtml !== undefined
      ? input.bodyHtml
      : renderExportMarkdownToHtml(input.markdown ?? "");

  const metaItems: string[] = [];
  if (input.updatedAt) {
    metaItems.push(`<span>${escapeHtml(input.updatedAt)}</span>`);
  }
  if (input.tags && input.tags.length > 0) {
    metaItems.push(
      input.tags.map((tag) => `<span class="inkade-tag">#${escapeHtml(tag)}</span>`).join(" "),
    );
  }

  return `<!DOCTYPE html>
<html lang="en" data-theme="${escapeHtml(theme)}" data-paper="${escapeHtml(paperMode)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(input.title || "Untitled")}</title>
  <style>
    :root {
      color-scheme: ${theme};
      --bg: ${palette.bg};
      --fg: ${palette.fg};
      --muted: ${palette.muted};
      --border: ${palette.border};
      --code-bg: ${palette.codeBg};
      --accent: ${palette.accent};
      --font-body: ${resolveFontStack(font)};
      --measure: ${measure === "full" ? "100%" : escapeHtml(measure)};
      --font-size: ${resolveFontSizePx(fontSize)};
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--font-body);
      font-size: var(--font-size);
      line-height: 1.75;
      -webkit-font-smoothing: antialiased;
    }
    main.inkade-export-sheet {
      max-width: var(--measure);
      margin: 0 auto;
      padding: 48px 28px 80px;
    }
    header.inkade-export-header {
      margin-bottom: 28px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--border);
    }
    h1.inkade-export-title {
      font-size: 2.125rem;
      line-height: 1.25;
      font-weight: 700;
      margin: 0 0 10px 0;
      letter-spacing: -0.02em;
    }
    .inkade-export-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 0.8125rem;
      color: var(--muted);
    }
    .inkade-tag, .inkade-wikilink-pill {
      display: inline-flex;
      align-items: center;
      border-radius: 5px;
      padding: 1px 6px;
      background: var(--code-bg);
      color: var(--fg);
      font-size: 0.85em;
    }
    .inkade-prose h1 { font-size: 1.75em; line-height: 1.3; margin: 1.4em 0 0.5em; }
    .inkade-prose h2 { font-size: 1.375em; line-height: 1.35; margin: 1.3em 0 0.5em; }
    .inkade-prose h3 { font-size: 1.15em; line-height: 1.4; margin: 1.1em 0 0.4em; }
    .inkade-prose p { margin: 0.85em 0; }
    .inkade-prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
    .inkade-prose blockquote {
      margin: 1.1em 0;
      padding: 0.25em 1em;
      border-left: 3px solid var(--border);
      color: var(--muted);
    }
    .inkade-prose code {
      font-family: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
      font-size: 0.875em;
      background: var(--code-bg);
      padding: 0.15em 0.35em;
      border-radius: 4px;
    }
    .inkade-prose pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      overflow-x: auto;
      font-size: 0.875em;
      line-height: 1.55;
    }
    .inkade-prose pre code { background: transparent; padding: 0; }
    .inkade-prose hr { border: 0; border-top: 1px solid var(--border); margin: 1.8em 0; }
    .inkade-prose ul, .inkade-prose ol { padding-left: 1.5em; margin: 0.75em 0; }
    .inkade-prose ul[data-type="taskList"] { list-style: none; padding-left: 0.25em; }
    .inkade-prose ul[data-type="taskList"] li { display: flex; align-items: baseline; gap: 0.5em; }
    .inkade-prose table { width: 100%; border-collapse: collapse; margin: 1.2em 0; font-size: 0.92em; }
    .inkade-prose th, .inkade-prose td { border: 1px solid var(--border); padding: 7px 10px; text-align: left; }
    .inkade-prose th { background: var(--code-bg); font-weight: 600; }
    .inkade-prose .inkade-callout {
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      background: var(--code-bg);
      border-radius: 8px;
      padding: 12px 14px;
      margin: 1.1em 0;
    }
    .inkade-prose .inkade-callout-header {
      font-size: 0.75em;
      font-weight: 700;
      letter-spacing: 0.06em;
      margin-bottom: 4px;
      color: var(--accent);
    }
    .inkade-prose .inkade-callout-body > p:first-child { margin-top: 0; }
    .inkade-prose .inkade-callout-body > p:last-child { margin-bottom: 0; }
    .inkade-prose .inkade-columns {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin: 1.2em 0;
    }
    .inkade-prose .inkade-toggle {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      margin: 1em 0;
    }
    .inkade-prose .inkade-pending-card {
      border: 1px dashed var(--border);
      background: var(--code-bg);
      border-radius: 10px;
      padding: 12px 14px;
      margin: 1.1em 0;
    }
    .inkade-prose .inkade-pending-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 0.78em;
      color: var(--muted);
    }
    .inkade-prose .inkade-pending-badge {
      font-weight: 600;
      color: var(--accent);
    }
    .inkade-prose .inkade-pending-id {
      font-family: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
      opacity: 0.8;
    }
    .inkade-prose .inkade-pending-label {
      font-size: 0.92em;
      color: var(--fg);
    }
    @media (max-width: 640px) {
      .inkade-prose .inkade-columns { grid-template-columns: 1fr; }
    }
    @media print {
      main.inkade-export-sheet { max-width: none; padding: 0; }
    }
  </style>
</head>
<body>
  <main class="inkade-export-sheet">
    <header class="inkade-export-header">
      <h1 class="inkade-export-title">${escapeHtml(input.title || "Untitled")}</h1>
      ${metaItems.length > 0 ? `<div class="inkade-export-meta">${metaItems.join("")}</div>` : ""}
    </header>
    <article class="inkade-prose">
      ${bodyHtml}
    </article>
  </main>
</body>
</html>`;
}

export function triggerHtmlFileDownload(filename: string, html: string): void {
  const safeName = filename.endsWith(".html") ? filename : `${filename}.html`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function triggerDocxFileDownload(filename: string, bytes: Uint8Array): void {
  const safeName = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: DOCX_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
