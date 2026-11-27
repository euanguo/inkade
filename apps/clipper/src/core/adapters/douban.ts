import { resolveAbsoluteHttpUrl } from "@inkade/clipper-core/extractor";
import type { SiteAdapter } from "./types.ts";
import { elementHtmlToCleanMarkdown, hostMatches } from "./types.ts";

export const doubanAdapter: SiteAdapter = {
  id: "douban",
  name: "Douban (豆瓣)",
  hosts: ["douban.com"],
  match(url) {
    return hostMatches(url.hostname, ["douban.com"]);
  },
  extract(doc, pageUrl) {
    // 1. Long review or Douban Note
    const reviewBody = doc.querySelector(".review-content, #link-report .note, .note-container .note");
    if (reviewBody && doc.querySelector(".main-hd, .note-header, h1")) {
      const title =
        doc.querySelector("h1, .article h1")?.textContent?.trim() ||
        doc.querySelector("title")?.textContent?.trim() ||
        "";
      const author =
        doc.querySelector(".main-hd a, .note-author")?.textContent?.trim() || "";
      const published =
        doc.querySelector(".main-meta, .pub-date")?.textContent?.trim() || "";
      const { html, markdown, imageUrls } = elementHtmlToCleanMarkdown(reviewBody, pageUrl, [
        ".review-panel",
        ".main-panel-useful",
      ]);
      if (markdown.trim()) {
        return {
          id: "douban",
          title,
          author,
          published,
          site: "豆瓣",
          image: imageUrls[0],
          contentHtml: html,
          markdown,
          imageUrls,
          variables: { adapter: "douban" },
        };
      }
    }

    // 2. Book / Movie / Music subject card
    const subjectTitle = doc.querySelector("#wrapper h1")?.textContent?.trim();
    const infoEl = doc.querySelector("#info");
    if (!subjectTitle || !infoEl) return null;

    const rating = doc.querySelector(".rating_num")?.textContent?.trim() || "";
    const introEl =
      doc.querySelector("#link-report .all.hidden, #link-report .intro, #link-report") ?? null;
    const posterUrl = resolveAbsoluteHttpUrl(
      doc.querySelector("#mainpic img")?.getAttribute("src"),
      pageUrl,
    );

    const infoLines = (infoEl.textContent ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");

    const introMd = introEl
      ? elementHtmlToCleanMarkdown(introEl, pageUrl, [".a_show_full"]).markdown
      : "";

    const sections: string[] = [];
    if (rating) sections.push(`**评分**：${rating}`);
    if (posterUrl) sections.push(`![Cover](${posterUrl})`);
    if (infoLines) sections.push(`\`\`\`text\n${infoLines}\n\`\`\``);
    if (introMd) sections.push(`## 简介\n\n${introMd}`);

    const markdown = sections.join("\n\n").trim();
    if (!markdown) return null;

    return {
      id: "douban",
      title: subjectTitle,
      site: "豆瓣",
      image: posterUrl ?? undefined,
      markdown,
      imageUrls: posterUrl ? [posterUrl] : [],
      variables: {
        adapter: "douban",
        ...(rating ? { rating } : {}),
      },
    };
  },
};
