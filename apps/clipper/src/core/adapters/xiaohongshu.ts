import { resolveAbsoluteHttpUrl } from "@inkade/clipper-core/extractor";
import type { SiteAdapter } from "./types.ts";
import { elementHtmlToCleanMarkdown, hostMatches, readMetaContent } from "./types.ts";

export const xiaohongshuAdapter: SiteAdapter = {
  id: "xiaohongshu",
  name: "Xiaohongshu (RED)",
  hosts: ["xiaohongshu.com"],
  supportsFeedTarget: true,
  match(url) {
    return hostMatches(url.hostname, ["xiaohongshu.com"]);
  },
  extract(doc, pageUrl) {
    const noteContainer =
      doc.querySelector("#noteContainer, .note-detail-mask, .note-container, .detail-wrapper") ??
      doc.querySelector("#detail-desc")?.closest("div, section") ??
      null;

    const descEl =
      doc.querySelector("#detail-desc") ??
      noteContainer?.querySelector(".desc, .note-text, .note-content") ??
      null;

    if (!descEl && !noteContainer) return null;

    const title =
      doc.querySelector("#detail-title")?.textContent?.trim() ||
      noteContainer?.querySelector(".title")?.textContent?.trim() ||
      readMetaContent(doc, ['meta[property="og:title"]']);

    const author =
      doc.querySelector(".author-wrapper .username, .user-nickname, .author .name")
        ?.textContent?.trim() || "";

    const dateInfo =
      doc.querySelector(".bottom-container .date, .date")?.textContent?.trim() || "";

    const galleryImgs: string[] = [];
    const seenImgs = new Set<string>();
    const mediaScope = noteContainer ?? doc;
    for (const img of mediaScope.querySelectorAll(
      ".swiper-slide img, .media-container img, .note-slider-img, .carousel img",
    )) {
      const resolved = resolveAbsoluteHttpUrl(
        img.getAttribute("src") ?? img.getAttribute("data-src"),
        pageUrl,
      );
      if (resolved && !seenImgs.has(resolved)) {
        seenImgs.add(resolved);
        galleryImgs.push(resolved);
      }
    }

    const bodyResult = descEl
      ? elementHtmlToCleanMarkdown(descEl, pageUrl, [".comments-container", ".comment-item"])
      : { html: "", markdown: "", imageUrls: [] as string[] };

    const tags = Array.from(doc.querySelectorAll("#hash-tag, a.tag"))
      .map((el) => el.textContent?.trim().replace(/^#+/, ""))
      .filter((t): t is string => Boolean(t));

    const parts: string[] = [];
    if (author || dateInfo) {
      parts.push(`> ${[author, dateInfo].filter(Boolean).join(" · ")}`);
    }
    if (bodyResult.markdown) {
      parts.push(bodyResult.markdown);
    }
    if (tags.length > 0) {
      parts.push(tags.map((tag) => `#${tag}`).join(" "));
    }
    for (const imgUrl of galleryImgs) {
      if (!bodyResult.markdown.includes(imgUrl)) {
        parts.push(`![](${imgUrl})`);
      }
    }

    const markdown = parts.join("\n\n").trim();
    if (!markdown) return null;

    const allImages = [...new Set([...galleryImgs, ...bodyResult.imageUrls])];

    return {
      id: "xiaohongshu",
      title: title || markdown.slice(0, 60),
      author,
      published: dateInfo,
      site: "小红书",
      image: allImages[0],
      contentHtml: bodyResult.html,
      markdown,
      imageUrls: allImages,
      variables: {
        adapter: "xiaohongshu",
        ...(tags.length > 0 ? { tags: tags.join(", ") } : {}),
      },
    };
  },
};
