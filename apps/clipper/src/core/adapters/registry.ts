import {
  registerSiteAdapterRunner,
  type SiteAdapterExecutionContext,
  type SiteAdapterResult,
} from "@inkade/clipper-core/extractor";
import { doubanAdapter } from "./douban.ts";
import { jikeAdapter } from "./jike.ts";
import { safeParseUrl, type SiteAdapter } from "./types.ts";
import { v2exAdapter } from "./v2ex.ts";
import { videoTranscriptAdapter } from "./video-transcript.ts";
import { wechatAdapter } from "./wechat.ts";
import { xiaohongshuAdapter } from "./xiaohongshu.ts";
import { xiaoyuzhouAdapter } from "./xiaoyuzhou.ts";
import { zhihuAdapter } from "./zhihu.ts";

export const BUILTIN_SITE_ADAPTERS: readonly SiteAdapter[] = [
  wechatAdapter,
  zhihuAdapter,
  xiaohongshuAdapter,
  jikeAdapter,
  doubanAdapter,
  v2exAdapter,
  xiaoyuzhouAdapter,
  videoTranscriptAdapter,
];

export function matchSiteAdapter(rawUrl: string): SiteAdapter | null {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return null;
  for (const adapter of BUILTIN_SITE_ADAPTERS) {
    if (adapter.match(parsed)) return adapter;
  }
  return null;
}

export async function extractWithSiteAdapters(
  doc: Document,
  pageUrl: string,
  ctx: SiteAdapterExecutionContext = {},
): Promise<SiteAdapterResult | null> {
  const adapter = matchSiteAdapter(pageUrl);
  if (!adapter) return null;
  return adapter.extract(doc, pageUrl, ctx);
}

registerSiteAdapterRunner(extractWithSiteAdapters);
