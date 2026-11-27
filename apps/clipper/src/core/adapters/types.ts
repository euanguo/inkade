import type { SiteAdapterExecutionContext, SiteAdapterResult } from "@inkade/clipper-core/extractor";
import { collectImageUrlsFromDocument, resolveAbsoluteHttpUrl } from "@inkade/clipper-core/extractor";
import { htmlToInkadeMarkdown } from "@inkade/clipper-core/markdown";

export interface SiteAdapter {
  readonly id: string;
  readonly name: string;
  readonly hosts: readonly string[];
  readonly supportsFeedTarget?: boolean | undefined;
  match(url: URL): boolean;
  extract(
    doc: Document,
    pageUrl: string,
    ctx: SiteAdapterExecutionContext,
  ): Promise<SiteAdapterResult | null> | SiteAdapterResult | null;
}

export function safeParseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

export function hostMatches(hostname: string, domains: readonly string[]): boolean {
  const lower = hostname.toLowerCase();
  return domains.some((d) => lower === d || lower.endsWith(`.${d}`));
}

export function cloneCleanedFragment(
  element: Element,
  removeSelectors: readonly string[] = [],
): Element {
  const clone = element.cloneNode(true) as Element;
  const defaultNoise = ["script", "style", "noscript", "iframe", "#inkade-clipper-root"];
  for (const sel of [...defaultNoise, ...removeSelectors]) {
    for (const bad of clone.querySelectorAll(sel)) {
      bad.remove();
    }
  }
  return clone;
}

export function upgradeLazyImages(root: Element, baseUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const img of root.querySelectorAll("img")) {
    const raw =
      img.getAttribute("data-original") ??
      img.getAttribute("data-actualsrc") ??
      img.getAttribute("data-src") ??
      img.getAttribute("src");
    const resolved = resolveAbsoluteHttpUrl(raw, baseUrl);
    if (resolved) {
      img.setAttribute("src", resolved);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        urls.push(resolved);
      }
    }
  }
  return urls;
}

export function elementHtmlToCleanMarkdown(
  element: Element,
  baseUrl: string,
  removeSelectors: readonly string[] = [],
): {
  readonly html: string;
  readonly markdown: string;
  readonly imageUrls: readonly string[];
} {
  const clone = cloneCleanedFragment(element, removeSelectors);
  const upgraded = upgradeLazyImages(clone, baseUrl);
  const extra = collectImageUrlsFromDocument(clone, baseUrl);
  const imageUrls = [...new Set([...upgraded, ...extra])];
  const html = clone.innerHTML ?? "";
  const markdown = htmlToInkadeMarkdown(html);
  return { html, markdown, imageUrls };
}

export function readMetaContent(doc: Document, selectors: readonly string[]): string {
  for (const sel of selectors) {
    const val = doc.querySelector(sel)?.getAttribute("content")?.trim();
    if (val) return val;
  }
  return "";
}
