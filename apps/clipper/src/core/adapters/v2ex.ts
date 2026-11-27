import type { SiteAdapter } from "./types.ts";
import { elementHtmlToCleanMarkdown, hostMatches } from "./types.ts";

export const v2exAdapter: SiteAdapter = {
  id: "v2ex",
  name: "V2EX",
  hosts: ["v2ex.com", "www.v2ex.com"],
  match(url) {
    return hostMatches(url.hostname, ["v2ex.com"]);
  },
  extract(doc, pageUrl) {
    const title = doc.querySelector(".header h1")?.textContent?.trim();
    const topicContent = doc.querySelector(".topic_content");
    const subtles = Array.from(doc.querySelectorAll(".subtle"));

    if (!title && !topicContent && subtles.length === 0) return null;

    const author =
      doc.querySelector(".header small.gray a[href^='/member/']")?.textContent?.trim() || "";
    const nodeName =
      doc.querySelector(".header a[href^='/go/']")?.textContent?.trim() || "";

    const bodyRes = topicContent
      ? elementHtmlToCleanMarkdown(topicContent, pageUrl)
      : { html: "", markdown: "", imageUrls: [] as string[] };

    const subtleSections: string[] = [];
    const allImages = [...bodyRes.imageUrls];

    subtles.forEach((subtleEl, idx) => {
      const fadeHeader = subtleEl.querySelector(".fade")?.textContent?.trim() || `附言 ${idx + 1}`;
      const subtleContentEl = subtleEl.querySelector(".topic_content") ?? subtleEl;
      const sub = elementHtmlToCleanMarkdown(subtleContentEl, pageUrl, [".fade"]);
      allImages.push(...sub.imageUrls);
      if (sub.markdown) {
        subtleSections.push(`### ${fadeHeader}\n\n${sub.markdown}`);
      }
    });

    const parts: string[] = [];
    if (author || nodeName) {
      parts.push(`> ${[author, nodeName].filter(Boolean).join(" · ")}`);
    }
    if (bodyRes.markdown) parts.push(bodyRes.markdown);
    if (subtleSections.length > 0) parts.push(...subtleSections);

    const markdown = parts.join("\n\n").trim();
    if (!markdown) return null;

    return {
      id: "v2ex",
      title: title || "V2EX Topic",
      author,
      site: "V2EX",
      contentHtml: bodyRes.html,
      markdown,
      imageUrls: [...new Set(allImages)],
      variables: {
        adapter: "v2ex",
        ...(nodeName ? { node: nodeName } : {}),
      },
    };
  },
};
