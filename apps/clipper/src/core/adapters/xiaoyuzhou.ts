import { resolveAbsoluteHttpUrl } from "@inkade/clipper-core/extractor";
import type { SiteAdapter } from "./types.ts";
import { elementHtmlToCleanMarkdown, hostMatches, readMetaContent } from "./types.ts";

export const xiaoyuzhouAdapter: SiteAdapter = {
  id: "xiaoyuzhou",
  name: "Xiaoyuzhou Podcast (小宇宙)",
  hosts: ["xiaoyuzhoufm.com", "www.xiaoyuzhoufm.com"],
  match(url) {
    return hostMatches(url.hostname, ["xiaoyuzhoufm.com"]);
  },
  extract(doc, pageUrl) {
    const showNotesEl = doc.querySelector(
      ".sn-content, article.shownotes, [class*='shownotes'], .rich-text",
    );
    const title =
      doc.querySelector("h1")?.textContent?.trim() ||
      readMetaContent(doc, ['meta[property="og:title"]']);

    if (!title && !showNotesEl) return null;

    const podcastName =
      doc.querySelector(".podcast-title, a[href*='/podcast/']")?.textContent?.trim() || "";
    const duration =
      doc.querySelector(".duration, [class*='duration']")?.textContent?.trim() || "";
    const published =
      doc.querySelector("time")?.getAttribute("datetime") ||
      doc.querySelector("time, .pub-time")?.textContent?.trim() ||
      "";
    const audioUrl = resolveAbsoluteHttpUrl(
      doc.querySelector("audio")?.getAttribute("src") ??
        readMetaContent(doc, ['meta[property="og:audio"]']),
      pageUrl,
    );
    const coverUrl = resolveAbsoluteHttpUrl(
      doc.querySelector(".cover img, .podcast-cover img")?.getAttribute("src") ??
        readMetaContent(doc, ['meta[property="og:image"]']),
      pageUrl,
    );

    const bodyRes = showNotesEl
      ? elementHtmlToCleanMarkdown(showNotesEl, pageUrl)
      : { html: "", markdown: "", imageUrls: [] as string[] };

    const parts: string[] = [];
    if (podcastName || duration || published) {
      parts.push(`> ${[podcastName, duration, published].filter(Boolean).join(" · ")}`);
    }
    if (audioUrl) {
      parts.push(`Audio: ${audioUrl}`);
    }
    if (coverUrl && !bodyRes.markdown.includes(coverUrl)) {
      parts.push(`![Cover](${coverUrl})`);
    }
    if (bodyRes.markdown) {
      parts.push("## Show Notes\n\n" + bodyRes.markdown);
    }

    const markdown = parts.join("\n\n").trim();
    if (!markdown) return null;

    const imageUrls = [...new Set([...(coverUrl ? [coverUrl] : []), ...bodyRes.imageUrls])];

    return {
      id: "xiaoyuzhou",
      title: title || "小宇宙单集",
      author: podcastName,
      published,
      site: "小宇宙",
      image: coverUrl ?? undefined,
      contentHtml: bodyRes.html,
      markdown,
      imageUrls,
      variables: {
        adapter: "xiaoyuzhou",
        ...(podcastName ? { podcast: podcastName } : {}),
        ...(duration ? { duration } : {}),
      },
    };
  },
};
