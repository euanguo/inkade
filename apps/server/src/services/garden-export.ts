import { zipSync, type Zippable } from "fflate";
import { strToU8 } from "fflate";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { codeToHast } from "shiki";
import { unified } from "unified";
import {
  formatPropertyScalar,
  parseMarkdownWithFrontmatter,
  renderOutlineNodesToMarkdown,
  type OutlineNode,
  type PropertyFieldDefinition,
  type PublicSiteDocDetail,
  type PublicSiteDocSummary,
  type PublicSiteMeta,
  type PublicSiteSpaceInfo,
  type ViewQueryResponse,
} from "@inkade/core";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveGardenDocFilename(doc: Pick<PublicSiteDocSummary, "slug" | "id">): string {
  const safe = doc.slug.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || doc.id}.html`;
}

function rewriteWikilinksOutsideCode(
  markdown: string,
  targetByName: ReadonlyMap<string, PublicSiteDocSummary>,
): string {
  const lines = markdown.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/`[^`\n]+`|\[\[([^[\]]+)\]\]/g, (full, inner: string | undefined) => {
        if (!inner) return full;
        const [rawTarget, rawAlias] = inner.split("|");
        const targetKey = (rawTarget ?? "").trim().toLowerCase();
        const label = (rawAlias ?? rawTarget ?? "").trim();
        const match = targetByName.get(targetKey);
        if (!match) {
          return label;
        }
        return `[${label}](./${resolveGardenDocFilename(match)})`;
      });
    })
    .join("\n");
}

function replaceInkadeViewFencesWithTables(
  markdown: string,
  embeddedViews?: Readonly<Record<string, ViewQueryResponse>>,
): string {
  return markdown.replace(/```inkade-view\s*\n([\s\S]*?)```/g, (_full, body: string) => {
    const view = embeddedViews?.[body] ?? embeddedViews?.[body.trim()];
    if (!view || view.documents.length === 0) {
      return "";
    }
    const header = "| Title | Kind | Tags | Updated |";
    const sep = "| --- | --- | --- | --- |";
    const rows = view.documents.slice(0, 50).map((doc) => {
      const tags = doc.tags.join(", ");
      return `| ${doc.title.replace(/\|/g, "\\|")} | ${doc.kind} | ${tags} | ${doc.updatedAt.slice(0, 10)} |`;
    });
    return [header, sep, ...rows].join("\n");
  });
}

interface HastTextNode {
  readonly type: "text";
  readonly value: string;
}

interface HastElementNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastChildNode[];
}

type HastChildNode = HastTextNode | HastElementNode | { readonly type: string };

function isHastText(node: HastChildNode): node is HastTextNode {
  return node.type === "text" && typeof (node as { value?: unknown }).value === "string";
}

function isHastElement(node: HastChildNode): node is HastElementNode {
  return node.type === "element" && typeof (node as { tagName?: unknown }).tagName === "string";
}

function extractCodeText(node: HastElementNode): string {
  let out = "";
  for (const child of node.children ?? []) {
    if (isHastText(child)) {
      out += child.value;
    } else if (isHastElement(child)) {
      out += extractCodeText(child);
    }
  }
  return out;
}

async function highlightCodeElement(codeEl: HastElementNode): Promise<HastChildNode | null> {
  const rawClassName = codeEl.properties?.className;
  const classNames = Array.isArray(rawClassName) ? rawClassName.map((item) => String(item)) : [];
  const langClass = classNames.find((c: string) => c.startsWith("language-"));
  const rawLang = langClass ? langClass.slice("language-".length).trim().toLowerCase() : "text";
  if (rawLang === "mermaid") {
    return null;
  }
  const codeText = extractCodeText(codeEl).replace(/\n$/, "");
  try {
    const hast = (await codeToHast(codeText, {
      lang: rawLang || "text",
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
    })) as { readonly children: readonly HastChildNode[] };
    const preNode = hast.children.find((child) => isHastElement(child));
    return preNode ?? null;
  } catch {
    return null;
  }
}

function rehypeHighlightCodeBlocks() {
  return async (tree: unknown): Promise<void> => {
    const root = tree as { children?: HastChildNode[] };
    const visitChildren = async (children: HastChildNode[]): Promise<void> => {
      for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (!node || !isHastElement(node)) continue;
        if (node.tagName === "pre" && node.children?.length === 1) {
          const codeEl = node.children[0];
          if (codeEl && isHastElement(codeEl) && codeEl.tagName === "code") {
            const replacement = await highlightCodeElement(codeEl);
            if (replacement) {
              children[i] = replacement;
              continue;
            }
          }
        }
        if (node.children) {
          await visitChildren(node.children);
        }
      }
    };
    if (Array.isArray(root?.children)) {
      await visitChildren(root.children);
    }
  };
}

export async function renderGardenMarkdownToHtml(
  markdown: string,
  options?: {
    readonly allDocs?: readonly PublicSiteDocSummary[] | undefined;
    readonly embeddedViews?: Readonly<Record<string, ViewQueryResponse>> | undefined;
  },
): Promise<string> {
  const { bodyMarkdown } = parseMarkdownWithFrontmatter(markdown);
  const targetMap = new Map<string, PublicSiteDocSummary>();
  for (const item of options?.allDocs ?? []) {
    targetMap.set(item.title.trim().toLowerCase(), item);
    targetMap.set(item.slug.trim().toLowerCase(), item);
  }

  let prepared = rewriteWikilinksOutsideCode(bodyMarkdown, targetMap);
  prepared = replaceInkadeViewFencesWithTables(prepared, options?.embeddedViews);

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeHighlightCodeBlocks)
    .use(rehypeStringify)
    .process(prepared);

  return String(file);
}

const GARDEN_STATIC_CSS = `
:root {
  color-scheme: light dark;
  --bg: #fcfbf9;
  --fg: #1c1917;
  --muted: #6b655d;
  --border: #e7e2d9;
  --surface: #f4f1ea;
  --accent: #2563eb;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141517;
    --fg: #eeeeef;
    --muted: #9b9ea8;
    --border: #262930;
    --surface: #1b1d22;
    --accent: #60a5fa;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.68;
}
.garden-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  min-height: 100vh;
}
.garden-sidebar {
  border-right: 1px solid var(--border);
  background: var(--surface);
  padding: 1.5rem 1rem;
}
.garden-brand { font-size: 1.05rem; font-weight: 600; text-decoration: none; color: inherit; display: block; }
.garden-subtitle { margin: 0.25rem 0 1rem; font-size: 0.85rem; color: var(--muted); }
.garden-nav { list-style: none; padding: 0; margin: 1rem 0 0; display: grid; gap: 0.25rem; }
.garden-nav a {
  display: block; padding: 0.35rem 0.6rem; border-radius: 6px;
  color: var(--fg); text-decoration: none; font-size: 0.88rem;
}
.garden-nav a:hover, .garden-nav a.active { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
.garden-main { padding: 2.5rem 2rem; }
.garden-article { max-width: 72ch; margin: 0 auto; }
.garden-meta { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.75rem 0 1.5rem; font-size: 0.8rem; color: var(--muted); }
.garden-badge { padding: 0.15rem 0.5rem; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); }
.garden-prose img { max-width: 100%; border-radius: 8px; }
.garden-prose a { color: var(--accent); }
.garden-prose pre { padding: 1rem; border-radius: 8px; overflow-x: auto; border: 1px solid var(--border); }
.garden-prose table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.9rem; }
.garden-prose th, .garden-prose td { border: 1px solid var(--border); padding: 0.45rem 0.65rem; text-align: left; }
.garden-backlinks { margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
@media (max-width: 820px) {
  .garden-layout { grid-template-columns: 1fr; }
  .garden-sidebar { border-right: none; border-bottom: 1px solid var(--border); }
}
`;

function renderDocumentMarkdownSource(
  doc: PublicSiteDocDetail,
  outlineNodes?: readonly OutlineNode[],
): string {
  const { bodyMarkdown } = parseMarkdownWithFrontmatter(doc.contentMarkdown);
  if (doc.kind === "outline" && outlineNodes && outlineNodes.length > 0) {
    const outlineMd = renderOutlineNodesToMarkdown(outlineNodes);
    return bodyMarkdown.trim() ? `${bodyMarkdown.trim()}\n\n${outlineMd}` : outlineMd;
  }
  return bodyMarkdown;
}

export async function buildStaticGardenZip(input: {
  readonly site: PublicSiteMeta;
  readonly spaces: readonly PublicSiteSpaceInfo[];
  readonly schemaFields: readonly PropertyFieldDefinition[];
  readonly docs: readonly {
    readonly detail: PublicSiteDocDetail;
    readonly outlineNodes?: readonly OutlineNode[] | undefined;
  }[];
  readonly feedXml?: string | undefined;
}): Promise<{ readonly filename: string; readonly bytes: Uint8Array }> {
  const summaries = input.docs.map((item) => item.detail);
  const files: Zippable = {
    "styles.css": strToU8(GARDEN_STATIC_CSS.trimStart()),
  };

  if (input.feedXml) {
    files["feed.xml"] = strToU8(input.feedXml);
  }

  const fieldLabelMap = new Map(input.schemaFields.map((field) => [field.key, field.label]));

  const renderSidebar = (activeDocId?: string) => {
    const spaceNameById = new Map(input.spaces.map((s) => [s.id, s.name]));
    const navItems = summaries
      .map((doc) => {
        const href = `./${resolveGardenDocFilename(doc)}`;
        const activeClass = doc.id === activeDocId ? ' class="active"' : "";
        const spaceHint = spaceNameById.get(doc.spaceId);
        return `<li><a${activeClass} href="${escapeHtml(href)}">${escapeHtml(doc.title)}${spaceHint ? ` <small style="opacity:.6">(${escapeHtml(spaceHint)})</small>` : ""}</a></li>`;
      })
      .join("\n");
    const rssLink = input.feedXml
      ? `<p style="margin-top:1.25rem;font-size:0.8rem"><a href="./feed.xml">RSS Feed</a></p>`
      : "";
    return `<aside class="garden-sidebar">
  <a class="garden-brand" href="./index.html">${escapeHtml(input.site.title)}</a>
  ${input.site.subtitle ? `<p class="garden-subtitle">${escapeHtml(input.site.subtitle)}</p>` : ""}
  <ul class="garden-nav">${navItems}</ul>
  ${rssLink}
</aside>`;
  };

  const indexCards = summaries
    .map(
      (doc) => `<article style="padding:1rem 0;border-bottom:1px solid var(--border)">
  <h2 style="margin:0 0 0.35rem;font-size:1.15rem"><a href="./${escapeHtml(resolveGardenDocFilename(doc))}">${escapeHtml(doc.title)}</a></h2>
  <p style="margin:0 0 0.5rem;color:var(--muted);font-size:0.9rem">${escapeHtml(doc.excerpt || "")}</p>
  <div class="garden-meta">
    <span>${escapeHtml(doc.updatedAt.slice(0, 10))}</span>
    ${doc.tags.map((tag) => `<span class="garden-badge">#${escapeHtml(tag)}</span>`).join("")}
  </div>
</article>`,
    )
    .join("\n");

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.site.title)}</title>
  <link rel="stylesheet" href="./styles.css" />
  ${input.feedXml ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(input.site.title)}" href="./feed.xml" />` : ""}
</head>
<body>
  <div class="garden-layout">
    ${renderSidebar()}
    <main class="garden-main">
      <section class="garden-article">
        <header>
          <h1>${escapeHtml(input.site.title)}</h1>
          ${input.site.subtitle ? `<p style="color:var(--muted)">${escapeHtml(input.site.subtitle)}</p>` : ""}
        </header>
        ${indexCards || "<p>No published notes yet.</p>"}
      </section>
    </main>
  </div>
</body>
</html>
`;
  files["index.html"] = strToU8(indexHtml);

  for (const item of input.docs) {
    const doc = item.detail;
    const rawMd = renderDocumentMarkdownSource(doc, item.outlineNodes);
    const bodyHtml = await renderGardenMarkdownToHtml(rawMd, {
      allDocs: summaries,
      embeddedViews: doc.embeddedViews,
    });
    const propertyEntries = Object.entries(doc.properties)
      .filter(([key]) => input.site.exposedFields.includes(key))
      .map(([key, val]) => {
        const label = fieldLabelMap.get(key) ?? key;
        const formatted = formatPropertyScalar(val);
        return formatted ? `<span class="garden-badge">${escapeHtml(label)}: ${escapeHtml(formatted)}</span>` : "";
      })
      .filter(Boolean)
      .join("");
    const backlinksHtml =
      doc.backlinks.length > 0
        ? `<section class="garden-backlinks">
  <h2>Backlinks</h2>
  <ul>
    ${doc.backlinks.map((b) => `<li><a href="./${escapeHtml(resolveGardenDocFilename(b))}">${escapeHtml(b.title)}</a></li>`).join("\n")}
  </ul>
</section>`
        : "";

    const pageHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(doc.title)} — ${escapeHtml(input.site.title)}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <div class="garden-layout">
    ${renderSidebar(doc.id)}
    <main class="garden-main">
      <article class="garden-article">
        <header>
          <h1>${escapeHtml(doc.title)}</h1>
          <div class="garden-meta">
            <span>${escapeHtml(doc.updatedAt.slice(0, 10))}</span>
            ${doc.tags.map((tag) => `<span class="garden-badge">#${escapeHtml(tag)}</span>`).join("")}
            ${propertyEntries}
          </div>
        </header>
        <div class="garden-prose">${bodyHtml}</div>
        ${backlinksHtml}
      </article>
    </main>
  </div>
</body>
</html>
`;
    files[resolveGardenDocFilename(doc)] = strToU8(pageHtml);
  }

  return {
    filename: `${input.site.slug}-garden.zip`,
    bytes: zipSync(files, { level: 6 }),
  };
}
