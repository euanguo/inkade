import { extractArticleFromDocumentAsync } from "@inkade/clipper-core/extractor";
import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { extractWithSiteAdapters, BUILTIN_SITE_ADAPTERS } from "./registry.ts";

describe("@inkade/clipper 8 Chinese & Video SiteAdapters", () => {
  test("registry registers all 8 specialized adapters", () => {
    expect(BUILTIN_SITE_ADAPTERS).toHaveLength(8);
  });

  test("wechatAdapter extracts title, account, time, content, and upgrades data-src images", async () => {
    const { document } = parseHTML(`
      <html>
        <body>
          <h1 id="activity-name">深入理解 Local-First 架构</h1>
          <a id="js_name">架构师笔记</a>
          <em id="publish_time">2026-11-24</em>
          <div id="js_content">
            <p>第一段核心观点。</p>
            <img data-src="https://mmbiz.qpic.cn/mmbiz_png/demo/0?wx_fmt=png" />
            <div class="qr_code_pc">扫码关注公众号</div>
          </div>
        </body>
      </html>
    `);

    const extracted = await extractArticleFromDocumentAsync(
      document,
      "https://mp.weixin.qq.com/s?__biz=MzA1&mid=100&idx=1&sn=xyz",
      { adapterOverride: extractWithSiteAdapters },
    );

    expect(extracted.extractor).toBe("adapter:wechat");
    expect(extracted.title).toBe("深入理解 Local-First 架构");
    expect(extracted.meta.author).toBe("架构师笔记");
    expect(extracted.markdown).toContain("第一段核心观点。");
    expect(extracted.markdown).toContain("https://mmbiz.qpic.cn/mmbiz_png/demo/0?wx_fmt=png");
    expect(extracted.markdown).not.toContain("扫码关注公众号");
    expect(extracted.imageUrls).toContain("https://mmbiz.qpic.cn/mmbiz_png/demo/0?wx_fmt=png");
  });

  test("zhihuAdapter resolves feed pointer target item, upgrades data-original, and converts data-tex math", async () => {
    const { document } = parseHTML(`
      <html>
        <body>
          <div class="ContentItem" id="feed-1">
            <h2 class="ContentItem-title">第一个回答标题</h2>
            <span class="AuthorInfo-name">张三</span>
            <div class="RichContent-inner">
              <p>第一条无关回答内容。</p>
            </div>
          </div>
          <div class="ContentItem" id="feed-2">
            <h2 class="ContentItem-title">为什么选择 ProseMirror？</h2>
            <span class="AuthorInfo-name">李四</span>
            <div class="RichContent-inner">
              <p id="target-p">事务模型保障中文 IME 稳定，复杂度为 <span class="ztext-math" data-tex="O(n)">O(n)</span>。</p>
              <img data-original="https://pic1.zhimg.com/v2-abc.jpg" src="/placeholder.png" />
              <div class="ContentItem-actions"><button>赞同 999</button></div>
            </div>
          </div>
        </body>
      </html>
    `);

    const targetP = document.getElementById("target-p") as unknown as Element;
    const extracted = await extractArticleFromDocumentAsync(
      document,
      "https://www.zhihu.com/",
      { pointerTargetElement: targetP, adapterOverride: extractWithSiteAdapters },
    );

    expect(extracted.extractor).toBe("adapter:zhihu");
    expect(extracted.title).toBe("为什么选择 ProseMirror？");
    expect(extracted.meta.author).toBe("李四");
    expect(extracted.markdown).toContain("$O(n)$");
    expect(extracted.markdown).toContain("https://pic1.zhimg.com/v2-abc.jpg");
    expect(extracted.markdown).not.toContain("第一条无关回答");
    expect(extracted.markdown).not.toContain("赞同 999");
  });

  test("xiaohongshuAdapter extracts note text, tags, and deduplicated carousel images without comments", async () => {
    const { document } = parseHTML(`
      <html><body>
        <div id="noteContainer">
          <h1 id="detail-title">极简桌面工作流搭配</h1>
          <div class="author-wrapper"><span class="username">Momo</span></div>
          <div class="bottom-container"><span class="date">2026-11-20 上海</span></div>
          <div id="detail-desc">分享三个提高编码专注度的小技巧。</div>
          <a id="hash-tag">#效率工具</a>
          <div class="swiper-slide"><img src="https://sns-webpic-qc.xhscdn.com/a.webp" /></div>
          <div class="swiper-slide"><img src="https://sns-webpic-qc.xhscdn.com/b.webp" /></div>
          <div class="comments-container"><div class="comment-item">评论噪声</div></div>
        </div>
      </body></html>
    `);

    const res = await extractWithSiteAdapters(
      document,
      "https://www.xiaohongshu.com/explore/abc123",
    );
    expect(res?.id).toBe("xiaohongshu");
    expect(res?.title).toBe("极简桌面工作流搭配");
    expect(res?.markdown).toContain("分享三个提高编码专注度的小技巧");
    expect(res?.markdown).toContain("#效率工具");
    expect(res?.markdown).not.toContain("评论噪声");
    expect(res?.imageUrls).toHaveLength(2);
  });

  test("jikeAdapter, doubanAdapter, v2exAdapter, and xiaoyuzhouAdapter extract structured content", async () => {
    const { document: jikeDoc } = parseHTML(`
      <html><body><article>
        <span class="author-name">即刻用户</span>
        <a href="/topic/ai">AI 研究</a>
        <div class="post-content"><p>今天测试了本地向量检索效果很好。</p></div>
        <blockquote>引用原文要点</blockquote>
      </article></body></html>
    `);
    const jikeRes = await extractWithSiteAdapters(
      jikeDoc,
      "https://web.okjike.com/originalPost/123",
    );
    expect(jikeRes?.id).toBe("jike");
    expect(jikeRes?.markdown).toContain("今天测试了本地向量检索效果很好");
    expect(jikeRes?.markdown).toContain("> 引用原文要点");

    const { document: doubanDoc } = parseHTML(`
      <html><body><div id="wrapper">
        <h1>设计心理学</h1>
        <div id="mainpic"><img src="https://img2.doubanio.com/view/subject/l/public/s123.jpg" /></div>
        <div id="info">作者: 唐纳德·诺曼\n出版年: 2015</div>
        <strong class="rating_num">9.1</strong>
        <div id="link-report"><div class="intro"><p>探讨日常物品中的示能与心智模型。</p></div></div>
      </div></body></html>
    `);
    const doubanRes = await extractWithSiteAdapters(
      doubanDoc,
      "https://book.douban.com/subject/26430833/",
    );
    expect(doubanRes?.id).toBe("douban");
    expect(doubanRes?.title).toBe("设计心理学");
    expect(doubanRes?.markdown).toContain("9.1");
    expect(doubanRes?.markdown).toContain("示能与心智模型");

    const { document: v2exDoc } = parseHTML(`
      <html><body>
        <div class="header">
          <a href="/go/programmer">程序员</a>
          <h1>如何设计可扩展的浏览器剪藏插件</h1>
          <small class="gray">by <a href="/member/alice">alice</a></small>
        </div>
        <div class="topic_content"><p>主帖探讨了 MV3 IIFE 打包规范。</p></div>
        <div class="subtle"><span class="fade">第 1 条附言 · 1 小时前</span><div class="topic_content">补充了 DNR 防盗链方案。</div></div>
      </body></html>
    `);
    const v2exRes = await extractWithSiteAdapters(
      v2exDoc,
      "https://www.v2ex.com/t/100001",
    );
    expect(v2exRes?.id).toBe("v2ex");
    expect(v2exRes?.markdown).toContain("MV3 IIFE 打包规范");
    expect(v2exRes?.markdown).toContain("补充了 DNR 防盗链方案");

    const { document: xyzDoc } = parseHTML(`
      <html><body>
        <h1>EP42: Local-First 软件的黄金时代</h1>
        <a href="/podcast/1">技术电台</a>
        <div class="duration">58:30</div>
        <audio src="https://media.xyzcdn.net/ep42.mp3"></audio>
        <article class="shownotes"><ul><li>00:00 开场介绍</li><li>12:30 CRDT 同步原理</li></ul></article>
      </body></html>
    `);
    const xyzRes = await extractWithSiteAdapters(
      xyzDoc,
      "https://www.xiaoyuzhoufm.com/episode/xyz42",
    );
    expect(xyzRes?.id).toBe("xiaoyuzhou");
    expect(xyzRes?.markdown).toContain("https://media.xyzcdn.net/ep42.mp3");
    expect(xyzRes?.markdown).toContain("12:30 CRDT 同步原理");
  });

  test("videoTranscriptAdapter extracts YouTube captions via proxy fetch and formats clickable timestamps", async () => {
    const { document } = parseHTML(`
      <html>
        <head><meta property="og:image" content="https://i.ytimg.com/vi/abc123/maxresdefault.jpg" /></head>
        <body>
          <script>
            var ytInitialPlayerResponse = {
              "videoDetails": {
                "title": "Deep Dive into Inkade",
                "author": "Inkade Lab",
                "shortDescription": "Walkthrough of architecture."
              },
              "captions": {
                "playerCaptionsTracklistRenderer": {
                  "captionTracks": [
                    { "baseUrl": "https://www.youtube.com/api/timedtext?v=abc123&lang=en", "languageCode": "en" }
                  ]
                }
              }
            };
          </script>
        </body>
      </html>
    `);

    const mockFetch = (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain("fmt=json3");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            events: [
              { tStartMs: 0, segs: [{ utf8: "Welcome to Inkade." }] },
              { tStartMs: 135000, segs: [{ utf8: "Let's inspect the outliner." }] },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };

    const res = await extractWithSiteAdapters(
      document,
      "https://www.youtube.com/watch?v=abc123",
      { fetchFn: mockFetch },
    );

    expect(res?.id).toBe("video-transcript");
    expect(res?.title).toBe("Deep Dive into Inkade");
    expect(res?.markdown).toContain("[00:00](https://www.youtube.com/watch?v=abc123&t=0) Welcome to Inkade.");
    expect(res?.markdown).toContain("[02:15](https://www.youtube.com/watch?v=abc123&t=135) Let's inspect the outliner.");
    expect(res?.variables?.transcript).toContain("[02:15]");
  });
});
