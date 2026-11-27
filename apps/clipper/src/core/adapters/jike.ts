import { resolveAbsoluteHttpUrl } from "@inkade/clipper-core/extractor";
import type { SiteAdapter } from "./types.ts";
import { elementHtmlToCleanMarkdown, hostMatches } from "./types.ts";

export const jikeAdapter: SiteAdapter = {
  id: "jike",
  name: "Jike (即刻)",
  hosts: ["okjike.com", "web.okjike.com", "m.okjike.com"],
  supportsFeedTarget: true,
  match(url) {
    return hostMatches(url.hostname, ["okjike.com"]);
  },
  extract(doc, pageUrl, ctx) {
    const card =
      ctx.pointerTargetElement?.closest?.("article, [data-testid='post-item'], .post-card") ??
      doc.querySelector("article, [data-testid='post-detail'], .post-detail, main");

    if (!card) return null;

    const author =
      card.querySelector(".author-name, [data-testid='user-name'], a[href*='/u/']")
        ?.textContent?.trim() || "";
    const topic =
      card.querySelector(".topic-tag, a[href*='/topic/']")?.textContent?.trim() || "";
    const published =
      card.querySelector("time")?.getAttribute("datetime") ||
      card.querySelector("time, .publish-time")?.textContent?.trim() ||
      "";

    const contentNode =
      card.querySelector(".post-content, [data-testid='post-content'], .content") ?? card;
    const body = elementHtmlToCleanMarkdown(contentNode, pageUrl, [
      ".comment-list",
      ".action-bar",
      "button",
    ]);

    const quoteText = card
      .querySelector(".repost-content, blockquote")
      ?.textContent?.trim();

    const imgs: string[] = [];
    for (const img of card.querySelectorAll(".post-images img, .image-grid img")) {
      const resolved = resolveAbsoluteHttpUrl(img.getAttribute("src"), pageUrl);
      if (resolved) imgs.push(resolved);
    }

    const sections: string[] = [];
    if (author || topic || published) {
      sections.push(`> ${[author, topic ? `#${topic}` : "", published].filter(Boolean).join(" · ")}`);
    }
    if (body.markdown) sections.push(body.markdown);
    if (quoteText && !body.markdown.includes(quoteText)) {
      sections.push(`> ${quoteText.replace(/\n/g, "\n> ")}`);
    }
    for (const u of imgs) {
      if (!body.markdown.includes(u)) sections.push(`![](${u})`);
    }

    const markdown = sections.join("\n\n").trim();
    if (!markdown) return null;

    return {
      id: "jike",
      title: author ? `${author} · 即刻动态` : "即刻动态",
      author,
      published,
      site: "即刻",
      contentHtml: body.html,
      markdown,
      imageUrls: [...new Set([...imgs, ...body.imageUrls])],
      variables: {
        adapter: "jike",
        ...(topic ? { topic } : {}),
      },
    };
  },
};
