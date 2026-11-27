import type { SiteAdapter } from "./types.ts";
import { elementHtmlToCleanMarkdown, hostMatches, readMetaContent } from "./types.ts";

export const wechatAdapter: SiteAdapter = {
  id: "wechat",
  name: "WeChat Official Account",
  hosts: ["mp.weixin.qq.com"],
  match(url) {
    return hostMatches(url.hostname, ["mp.weixin.qq.com"]);
  },
  extract(doc, pageUrl) {
    const contentEl = doc.querySelector("#js_content") ?? doc.querySelector(".rich_media_content");
    if (!contentEl) return null;

    const title =
      doc.querySelector("#activity-name")?.textContent?.trim() ||
      doc.querySelector(".rich_media_title")?.textContent?.trim() ||
      readMetaContent(doc, ['meta[property="og:title"]']);

    const author =
      doc.querySelector("#js_name")?.textContent?.trim() ||
      doc.querySelector(".rich_media_meta_nickname")?.textContent?.trim() ||
      readMetaContent(doc, ['meta[name="author"]']);

    const published =
      doc.querySelector("#publish_time")?.textContent?.trim() ||
      doc.querySelector(".rich_media_meta_text")?.textContent?.trim() ||
      "";

    const description = readMetaContent(doc, [
      'meta[name="description"]',
      'meta[property="og:description"]',
    ]);

    const { html, markdown, imageUrls } = elementHtmlToCleanMarkdown(contentEl, pageUrl, [
      ".qr_code_pc",
      ".rich_media_tool",
      ".reward_area",
      "#js_tags",
      ".wx_follow_card",
      ".mp_profile_iframe_wrp",
    ]);

    if (!markdown.trim()) return null;

    return {
      id: "wechat",
      title,
      author,
      published,
      site: "微信公众号",
      description,
      image: imageUrls[0],
      contentHtml: html,
      markdown,
      imageUrls,
      variables: {
        adapter: "wechat",
        ...(author ? { account: author } : {}),
      },
    };
  },
};
