import TurndownService from "turndown";

function getChildrenArray(node: Node): Element[] {
  const result: Element[] = [];
  const children = node.childNodes;
  if (!children) return result;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child && child.nodeType === 1) {
      result.push(child as Element);
    }
  }
  return result;
}

function findDescendantsByTags(root: Node, tags: ReadonlySet<string>): Element[] {
  const found: Element[] = [];
  const walk = (current: Node) => {
    const children = getChildrenArray(current);
    for (const child of children) {
      if (tags.has(child.nodeName.toUpperCase())) {
        found.push(child);
      }
      walk(child);
    }
  };
  walk(root);
  return found;
}

function findFirstDescendantByTag(root: Node, tagUpper: string): Element | null {
  const children = getChildrenArray(root);
  for (const child of children) {
    if (child.nodeName.toUpperCase() === tagUpper) {
      return child;
    }
    const nested = findFirstDescendantByTag(child, tagUpper);
    if (nested) return nested;
  }
  return null;
}

function extractCodeLanguage(el: Element): string {
  const targets = [el, el.parentElement].filter((x): x is Element => Boolean(x));
  for (const target of targets) {
    const dataLang =
      target.getAttribute("data-lang") ??
      target.getAttribute("data-language") ??
      target.getAttribute("data-code-lang");
    if (dataLang?.trim()) {
      return dataLang.trim().toLowerCase();
    }
    const cls = target.getAttribute("class") ?? "";
    const langMatch = /(?:language-|lang-|highlight-source-)([a-zA-Z0-9_+-]+)/.exec(cls);
    if (langMatch?.[1]) {
      return langMatch[1].toLowerCase();
    }
  }
  return "";
}

function escapeTableCell(raw: string): string {
  return raw
    .replace(/\r?\n+/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

function serializeHtmlTableToGfm(table: Element): string {
  const rows = findDescendantsByTags(table, new Set(["TR"]));
  if (rows.length === 0) return "";

  const matrix: string[][] = [];
  let maxCols = 0;

  for (const row of rows) {
    const cells = getChildrenArray(row).filter(
      (c) => c.nodeName.toUpperCase() === "TH" || c.nodeName.toUpperCase() === "TD",
    );
    if (cells.length === 0) continue;
    const values = cells.map((cell) => escapeTableCell(cell.textContent ?? ""));
    maxCols = Math.max(maxCols, values.length);
    matrix.push(values);
  }

  if (matrix.length === 0 || maxCols === 0) return "";

  const normalizedRows = matrix.map((cells) => {
    const padded = [...cells];
    while (padded.length < maxCols) padded.push("");
    return `| ${padded.join(" | ")} |`;
  });

  const separator = `| ${Array.from({ length: maxCols }, () => "---").join(" | ")} |`;
  const [headerRow, ...bodyRows] = normalizedRows;
  return `\n\n${[headerRow, separator, ...bodyRows].join("\n")}\n\n`;
}

/**
 * Selects the highest-resolution image candidate from an HTML `srcset` attribute.
 */
export function pickBestSrcsetCandidate(srcset: string | null): string | null {
  if (!srcset) return null;
  const candidates = srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/))
    .filter((parts) => Boolean(parts[0]))
    .map((parts) => ({
      url: parts[0]!,
      weight: parts[1]?.endsWith("w")
        ? Number.parseInt(parts[1], 10) || 0
        : parts[1]?.endsWith("x")
          ? Math.round((Number.parseFloat(parts[1]) || 1) * 1000)
          : 0,
    }));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0]?.url ?? null;
}

function findLatexAnnotationText(root: Node): string {
  for (const el of findDescendantsByTags(root, new Set(["ANNOTATION"]))) {
    const encoding = el.getAttribute("encoding")?.toLowerCase() ?? "";
    if (!encoding || encoding.includes("tex")) {
      const text = el.textContent?.trim();
      if (text) return text;
    }
  }
  return "";
}

function extractMathTexPayload(node: Node): { readonly tex: string; readonly display: boolean } | null {
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  const tag = el.nodeName.toUpperCase();

  if (tag === "SCRIPT") {
    const type = el.getAttribute("type")?.toLowerCase() ?? "";
    if (type.startsWith("math/tex")) {
      const tex = el.textContent?.trim() ?? "";
      return tex ? { tex, display: type.includes("display") } : null;
    }
    return null;
  }

  const dataTex = el.getAttribute("data-tex") ?? el.getAttribute("data-latex");
  if (dataTex?.trim()) {
    const tex = dataTex.trim();
    const display =
      tag === "DIV" ||
      el.getAttribute("display") === "block" ||
      tex.includes("\\\\");
    return { tex, display };
  }

  const cls = el.getAttribute("class") ?? "";
  if (/\bkatex-display\b/.test(cls) || /\bmjx-container\b/.test(cls)) {
    const annotation = findLatexAnnotationText(el);
    if (annotation) {
      return {
        tex: annotation,
        display: /\bkatex-display\b/.test(cls) || el.getAttribute("display") === "true",
      };
    }
  }

  if (/\bkatex\b/.test(cls) || tag === "MATH") {
    const annotation = findLatexAnnotationText(el);
    if (annotation) {
      const isDisplay =
        el.getAttribute("display") === "block" ||
        /\bkatex-display\b/.test(el.parentElement?.getAttribute("class") ?? "");
      return { tex: annotation, display: isDisplay };
    }
  }

  return null;
}

function isBlankTrackingPixel(src: string | null): boolean {
  if (!src) return true;
  const trimmed = src.trim().toLowerCase();
  return (
    !trimmed ||
    trimmed === "about:blank" ||
    trimmed.startsWith("data:image/gif;base64,r0lgodlhaqabai")
  );
}

function isSpacerOrDataPlaceholder(src: string | null): boolean {
  if (!src) return true;
  const trimmed = src.trim().toLowerCase();
  return isBlankTrackingPixel(trimmed) || trimmed.startsWith("data:image/svg+xml");
}

function escapeMarkdownAlt(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").replace(/([[\]])/g, "\\$1").trim();
}

/**
 * Creates a clean, MIT-licensed Turndown instance enhanced with GFM tables,
 * strikethrough, task lists, LaTeX/KaTeX math preservation, lazy/srcset images,
 * fenced code language detection, and figure captions.
 * Uses pure childNodes traversal so it works identically in Browser DOM, linkedom, and Turndown Domino.
 */
export function createInkadeTurndownService(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    hr: "---",
  });

  td.addRule("inkadeMath", {
    filter(node) {
      return extractMathTexPayload(node) !== null;
    },
    replacement(_content, node) {
      const payload = extractMathTexPayload(node);
      if (!payload) return "";
      return payload.display ? `\n\n$$\n${payload.tex}\n$$\n\n` : `$${payload.tex}$`;
    },
  });

  td.remove(["script", "style", "noscript", "iframe", "template"]);

  td.addRule("inkadeStrikethrough", {
    filter(node) {
      const tag = node.nodeName.toUpperCase();
      return tag === "DEL" || tag === "S" || tag === "STRIKE";
    },
    replacement(content) {
      const trimmed = content.trim();
      return trimmed ? `~~${trimmed}~~` : "";
    },
  });

  td.addRule("inkadeTaskListCheckbox", {
    filter(node) {
      return (
        node.nodeName.toUpperCase() === "INPUT" &&
        (node as Element).getAttribute("type")?.toLowerCase() === "checkbox"
      );
    },
    replacement(_content, node) {
      const el = node as Element;
      const checked = el.hasAttribute("checked") || (el as HTMLInputElement).checked;
      return checked ? "[x] " : "[ ] ";
    },
  });

  td.addRule("inkadeFencedCodeBlock", {
    filter(node) {
      if (node.nodeName.toUpperCase() !== "PRE") return false;
      return Boolean(findFirstDescendantByTag(node, "CODE") || node.textContent);
    },
    replacement(_content, node) {
      const pre = node as Element;
      const codeEl = findFirstDescendantByTag(pre, "CODE") ?? pre;
      const lang = extractCodeLanguage(codeEl);
      const rawCode = (codeEl.textContent ?? "").replace(/\n+$/, "");
      const fence = rawCode.includes("```") ? "````" : "```";
      return `\n\n${fence}${lang}\n${rawCode}\n${fence}\n\n`;
    },
  });

  td.addRule("inkadeImage", {
    filter: "img",
    replacement(_content, node) {
      const img = node as Element;
      const lazyCandidate =
        img.getAttribute("data-original") ??
        img.getAttribute("data-actualsrc") ??
        img.getAttribute("data-src") ??
        pickBestSrcsetCandidate(img.getAttribute("srcset"));
      const rawSrc = img.getAttribute("src");
      const src =
        lazyCandidate && (!rawSrc || isSpacerOrDataPlaceholder(rawSrc))
          ? lazyCandidate.trim()
          : (rawSrc?.trim() || lazyCandidate?.trim() || "");
      if (!src || src.toLowerCase().startsWith("javascript:") || isBlankTrackingPixel(src)) {
        return "";
      }
      const alt = escapeMarkdownAlt(img.getAttribute("alt") ?? "");
      const title = img.getAttribute("title")?.replace(/"/g, '\\"').trim();
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    },
  });

  td.addRule("inkadeGfmTable", {
    filter(node) {
      if (node.nodeName.toUpperCase() !== "TABLE") return false;
      const nestedTables = findDescendantsByTags(node, new Set(["TABLE"]));
      return nestedTables.length === 0;
    },
    replacement(_content, node) {
      return serializeHtmlTableToGfm(node);
    },
  });

  td.addRule("inkadeFigure", {
    filter: "figure",
    replacement(content, node) {
      const caption = findFirstDescendantByTag(node, "FIGCAPTION")?.textContent?.trim();
      const cleaned = content.trim();
      if (!cleaned) return "";
      if (caption && !cleaned.includes(caption)) {
        return `\n\n${cleaned}\n\n*${caption}*\n\n`;
      }
      return `\n\n${cleaned}\n\n`;
    },
  });

  return td;
}

export function htmlToInkadeMarkdown(html: string): string {
  if (!html.trim()) return "";
  const td = createInkadeTurndownService();
  return td
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
