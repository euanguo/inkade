import type { SiteAdapter } from "./types.ts";
import { elementHtmlToCleanMarkdown, hostMatches, readMetaContent } from "./types.ts";

function normalizeZhihuLatexNodes(root: Element): void {
  for (const mathEl of root.querySelectorAll(".ztext-math[data-tex], span[data-tex]")) {
    const tex = mathEl.getAttribute("data-tex")?.trim();
    if (!tex) continue;
    const isBlock = tex.includes("\\\\") || mathEl.tagName.toUpperCase() === "DIV";
    mathEl.textContent = isBlock ? `\n$$\n${tex}\n$$\n` : `$${tex}$`;
  }
}

export const zhihuAdapter: SiteAdapter = {
  id: "zhihu",
  name: "Zhihu / Zhuanlan",
  hosts: ["zhihu.com", "zhuanlan.zhihu.com"],
  supportsFeedTarget: true,
  match(url) {
    return hostMatches(url.hostname, ["zhihu.com"]);
  },
  extract(doc, pageUrl, ctx) {
    // 1. Feed / Question list item via right-click target
    const pointerCard =
      ctx.pointerTargetElement?.closest?.(".ContentItem, .AnswerItem, .Feed, .ArticleItem") ?? null;

    const targetRoot =
      pointerCard ??
      doc.querySelector(".Post-Main") ??
      doc.querySelector(".QuestionAnswer-content .ContentItem") ??
      doc.querySelector(".AnswerCard .ContentItem") ??
      doc.querySelector(".RichContent-inner");

    if (!targetRoot) return null;

    const cloned = targetRoot.cloneNode(true) as Element;
    normalizeZhihuLatexNodes(cloned);

    const cardTitle =
      cloned.querySelector(".ContentItem-title, .Post-Title")?.textContent?.trim() ||
      doc.querySelector(".Post-Title, .QuestionHeader-title")?.textContent?.trim() ||
      readMetaContent(doc, ['meta[property="og:title"]']);

    const author =
      cloned.querySelector(".AuthorInfo-name, .UserLink-link")?.textContent?.trim() ||
      doc.querySelector(".AuthorInfo-name, .UserLink-link")?.textContent?.trim() ||
      "";

    const published =
      cloned.querySelector(".ContentItem-time, .Post-time")?.textContent?.trim() || "";

    const bodyEl =
      cloned.querySelector(".RichText, .Post-RichText, .RichContent-inner") ?? cloned;

    const { html, markdown, imageUrls } = elementHtmlToCleanMarkdown(bodyEl, pageUrl, [
      ".ContentItem-actions",
      ".Comments-container",
      ".Reward",
      ".Post-SideActions",
      ".RichContent-collapsedText",
      ".Catalog",
      "button",
    ]);

    if (!markdown.trim()) return null;

    return {
      id: "zhihu",
      title: cardTitle,
      author,
      published,
      site: "知乎",
      image: imageUrls[0],
      contentHtml: html,
      markdown,
      imageUrls,
      variables: {
        adapter: "zhihu",
      },
    };
  },
};
