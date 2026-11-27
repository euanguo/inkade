import { getWebExt, type WebExtDnrRule } from "../shared/webext.ts";

export const INKADE_DNR_RULE_BASE_ID = 91001;

interface ImageRefererTarget {
  readonly id: number;
  readonly requestDomains: readonly string[];
  readonly referer: string;
}

const ANTI_HOTLINK_TARGETS: readonly ImageRefererTarget[] = [
  {
    id: INKADE_DNR_RULE_BASE_ID,
    requestDomains: ["qpic.cn", "qlogo.cn"],
    referer: "https://mp.weixin.qq.com/",
  },
  {
    id: INKADE_DNR_RULE_BASE_ID + 1,
    requestDomains: ["doubanio.com"],
    referer: "https://www.douban.com/",
  },
  {
    id: INKADE_DNR_RULE_BASE_ID + 2,
    requestDomains: ["cdnfile.sspai.com"],
    referer: "https://sspai.com/",
  },
  {
    id: INKADE_DNR_RULE_BASE_ID + 3,
    requestDomains: ["zhimg.com"],
    referer: "https://www.zhihu.com/",
  },
  {
    id: INKADE_DNR_RULE_BASE_ID + 4,
    requestDomains: ["xhscdn.com"],
    referer: "https://www.xiaohongshu.com/",
  },
  {
    id: INKADE_DNR_RULE_BASE_ID + 5,
    requestDomains: ["hdslb.com"],
    referer: "https://www.bilibili.com/",
  },
];

export function buildAntiHotlinkDnrRules(): WebExtDnrRule[] {
  return ANTI_HOTLINK_TARGETS.map((target) => ({
    id: target.id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Referer",
          operation: "set",
          value: target.referer,
        },
      ],
    },
    condition: {
      requestDomains: target.requestDomains,
      resourceTypes: ["xmlhttprequest", "other", "image"],
    },
  }));
}

/**
 * Idempotently installs declarativeNetRequest Referer rules for strict Chinese image CDNs.
 */
export async function installImageRefererRules(): Promise<boolean> {
  const ext = getWebExt();
  if (!ext?.declarativeNetRequest?.updateDynamicRules) return false;
  const rules = buildAntiHotlinkDnrRules();
  try {
    await ext.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rules.map((r) => r.id),
      addRules: rules,
    });
    return true;
  } catch {
    return false;
  }
}
