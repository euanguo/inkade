import { matchGlob, type ProjectScopeRule } from "@inkade/core";
import type { InkadeTranslationSchema } from "@inkade/i18n";

export type SettingsTranslationKey =
  `settings.${keyof InkadeTranslationSchema["settings"]}`;

export const SETTINGS_GROUPS = [
  "personal",
  "workspace",
  "intelligence",
  "agentSecurity",
] as const;
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number];

export const SETTINGS_SECTIONS = [
  "appearance",
  "shortcuts",
  "account",
  "spaces",
  "templates",
  "storage",
  "backup",
  "rag",
  "sync",
  "tokens",
  "scope-rules",
  "audit-logs",
  "security",
  "share-links",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

export interface SettingsSectionMeta {
  readonly id: SettingsSectionId;
  readonly group: SettingsGroupId;
  readonly labelKey: SettingsTranslationKey;
  readonly descriptionKey: SettingsTranslationKey;
  readonly keywords: readonly string[];
}

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "appearance";

export const SETTINGS_SECTION_CATALOG: readonly SettingsSectionMeta[] = [
  {
    id: "appearance",
    group: "personal",
    labelKey: "settings.sectionAppearanceLabel",
    descriptionKey: "settings.sectionAppearanceDesc",
    keywords: [
      "appearance",
      "theme",
      "dark",
      "light",
      "dimmed",
      "inset",
      "flush",
      "shell",
      "surface",
      "system",
      "accent",
      "indigo",
      "sage",
      "terracotta",
      "mono",
      "sepia",
      "paper",
      "font",
      "serif",
      "sans",
      "measure",
      "language",
      "locale",
      "外观",
      "主题",
      "壳层",
      "悬浮",
      "柔光",
      "强调色",
      "暖纸",
      "字体",
      "栏宽",
      "语言",
    ],
  },
  {
    id: "shortcuts",
    group: "personal",
    labelKey: "settings.sectionShortcutsLabel",
    descriptionKey: "settings.sectionShortcutsDesc",
    keywords: [
      "shortcuts",
      "keyboard",
      "hotkeys",
      "keybindings",
      "hover",
      "peek",
      "sidebar",
      "behavior",
      "快捷键",
      "悬停",
      "侧栏",
    ],
  },
  {
    id: "account",
    group: "personal",
    labelKey: "settings.sectionAccountLabel",
    descriptionKey: "settings.sectionAccountDesc",
    keywords: [
      "account",
      "session",
      "profile",
      "whoami",
      "principal",
      "permissions",
      "sign out",
      "logout",
      "账号",
      "会话",
      "权限",
      "退出",
    ],
  },
  {
    id: "spaces",
    group: "workspace",
    labelKey: "settings.sectionSpacesLabel",
    descriptionKey: "settings.sectionSpacesDesc",
    keywords: [
      "spaces",
      "hierarchy",
      "folders",
      "icon",
      "color",
      "palette",
      "archive",
      "空间",
      "图标",
      "配色",
      "归档",
    ],
  },
  {
    id: "templates",
    group: "workspace",
    labelKey: "settings.sectionTemplatesLabel",
    descriptionKey: "settings.sectionTemplatesDesc",
    keywords: [
      "templates",
      "daily",
      "markdown",
      "variables",
      "default",
      "模板",
      "每日",
    ],
  },
  {
    id: "storage",
    group: "workspace",
    labelKey: "settings.sectionStorageLabel",
    descriptionKey: "settings.sectionStorageDesc",
    keywords: [
      "storage",
      "attachments",
      "media",
      "tags",
      "orphan",
      "cleanup",
      "存储",
      "附件",
      "标签",
      "孤儿",
      "清理",
    ],
  },
  {
    id: "backup",
    group: "workspace",
    labelKey: "settings.sectionBackupLabel",
    descriptionKey: "settings.sectionBackupDesc",
    keywords: [
      "backup",
      "export",
      "import",
      "zip",
      "markdown",
      "备份",
      "导出",
      "导入",
    ],
  },
  {
    id: "rag",
    group: "intelligence",
    labelKey: "settings.sectionRagLabel",
    descriptionKey: "settings.sectionRagDesc",
    keywords: [
      "rag",
      "hybrid",
      "semantic",
      "search",
      "embedding",
      "vector",
      "bm25",
      "rrf",
      "reindex",
      "intelligence",
      "语义",
      "检索",
      "索引",
      "向量",
      "重建",
    ],
  },
  {
    id: "sync",
    group: "intelligence",
    labelKey: "settings.sectionSyncLabel",
    descriptionKey: "settings.sectionSyncDesc",
    keywords: [
      "sync",
      "offline",
      "yjs",
      "indexeddb",
      "crdt",
      "cache",
      "quota",
      "离线",
      "同步",
      "缓存",
      "配额",
    ],
  },
  {
    id: "tokens",
    group: "agentSecurity",
    labelKey: "settings.sectionTokensLabel",
    descriptionKey: "settings.sectionTokensDesc",
    keywords: [
      "tokens",
      "api",
      "mcp",
      "bearer",
      "scope",
      "revoke",
      "claude",
      "codex",
      "cursor",
      "agent",
      "密钥",
      "吊销",
    ],
  },
  {
    id: "scope-rules",
    group: "agentSecurity",
    labelKey: "settings.sectionScopeRulesLabel",
    descriptionKey: "settings.sectionScopeRulesDesc",
    keywords: [
      "scope",
      "rules",
      "project",
      "repo",
      "git",
      "remote",
      "glob",
      "matcher",
      "tester",
      "规则",
      "仓库",
      "匹配",
    ],
  },
  {
    id: "audit-logs",
    group: "agentSecurity",
    labelKey: "settings.sectionAuditLogsLabel",
    descriptionKey: "settings.sectionAuditLogsDesc",
    keywords: [
      "audit",
      "logs",
      "security",
      "allowed",
      "denied",
      "mcp",
      "rest",
      "审计",
      "日志",
      "拦截",
    ],
  },
  {
    id: "security",
    group: "agentSecurity",
    labelKey: "settings.sectionSecurityLabel",
    descriptionKey: "settings.sectionSecurityDesc",
    keywords: [
      "security",
      "sandbox",
      "artifact",
      "dual-origin",
      "same-site",
      "csp",
      "cookie",
      "安全",
      "沙箱",
      "隔离",
    ],
  },
  {
    id: "share-links",
    group: "agentSecurity",
    labelKey: "settings.sectionShareLinksLabel",
    descriptionKey: "settings.sectionShareLinksDesc",
    keywords: [
      "share",
      "links",
      "public",
      "readonly",
      "revoke",
      "expires",
      "分享",
      "链接",
      "公开",
      "吊销",
    ],
  },
];

const SECTION_SET: ReadonlySet<string> = new Set(SETTINGS_SECTIONS);

export function isSettingsSection(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && SECTION_SET.has(value);
}

export function resolveSettingsSection(value?: string | null): SettingsSectionId {
  if (!value) return DEFAULT_SETTINGS_SECTION;
  const normalized = value.trim().toLowerCase();
  if (normalized === "intelligence") return "rag";
  if (normalized === "mcp") return "tokens";
  if (normalized === "data") return "backup";
  return isSettingsSection(normalized) ? normalized : DEFAULT_SETTINGS_SECTION;
}

export function getSettingsSectionMeta(section: SettingsSectionId): SettingsSectionMeta {
  return (
    SETTINGS_SECTION_CATALOG.find((item) => item.id === section) ??
    SETTINGS_SECTION_CATALOG[0]!
  );
}

export function filterSettingsSections(
  query: string,
  getLocalizedText?: (meta: SettingsSectionMeta) => string,
): readonly SettingsSectionMeta[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return SETTINGS_SECTION_CATALOG;

  return SETTINGS_SECTION_CATALOG.filter((meta) => {
    if (meta.id.toLowerCase().includes(normalized)) return true;
    if (meta.keywords.some((kw) => kw.toLowerCase().includes(normalized))) return true;
    if (getLocalizedText) {
      const text = getLocalizedText(meta).toLowerCase();
      if (text.includes(normalized)) return true;
    }
    return false;
  });
}

export function groupSettingsSections(
  sections: readonly SettingsSectionMeta[],
): ReadonlyArray<{
  readonly group: SettingsGroupId;
  readonly items: readonly SettingsSectionMeta[];
}> {
  const groups: Array<{
    readonly group: SettingsGroupId;
    readonly items: readonly SettingsSectionMeta[];
  }> = [];

  for (const group of SETTINGS_GROUPS) {
    const items = sections.filter((item) => item.group === group);
    if (items.length > 0) {
      groups.push({ group, items });
    }
  }
  return groups;
}

/**
 * Evaluates whether a ProjectScopeRule matches a candidate repository name, git remote, or local path.
 */
export function evaluateScopeRuleMatch(
  rule: Pick<ProjectScopeRule, "matchType" | "pattern">,
  input: string,
): boolean {
  const candidate = input.trim();
  const pattern = rule.pattern.trim();
  if (!candidate || !pattern) return false;

  if (rule.matchType === "path_glob") {
    return matchGlob(pattern, candidate);
  }
  if (rule.matchType === "repo_name") {
    return (
      candidate.toLowerCase() === pattern.toLowerCase() ||
      matchGlob(pattern, candidate)
    );
  }
  // git_remote
  return (
    candidate.toLowerCase().includes(pattern.toLowerCase()) ||
    matchGlob(pattern, candidate)
  );
}

/**
 * Returns matching rules ordered from highest priority to lowest.
 */
export function matchScopeRules<
  T extends Pick<ProjectScopeRule, "matchType" | "pattern" | "priority">,
>(rules: readonly T[], input: string): readonly T[] {
  if (!input.trim()) return [];
  return rules
    .filter((rule) => evaluateScopeRuleMatch(rule, input))
    .sort((a, b) => b.priority - a.priority);
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}
