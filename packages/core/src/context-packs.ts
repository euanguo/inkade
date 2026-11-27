import { z } from "zod";
import { countBpeTokens, truncateToTokenBudget } from "./chunking.ts";
import {
  documentIdSchema,
  savedViewIdSchema,
  spaceIdSchema,
  type ContextPackId,
  type DocumentId,
  type SpaceId,
  type WorkspaceId,
} from "./ids.ts";
import {
  buildUntrustedDataNotice,
  deriveDocumentTrustTier,
  type ContentTrustTier,
} from "./trust.ts";
import {
  documentKindSchema,
  type DocumentKind,
  type DocumentRecord,
  type TokenScope,
} from "./types/index.ts";

export const DEFAULT_CONTEXT_PACK_MAX_TOKENS = 12_000;

export const contextPackSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9-_]*$/i, {
    message: "Slug must start with alphanumeric and contain only letters, digits, '-' or '_'",
  });

export const contextPackRulesSchema = z.object({
  spaceIds: z.array(spaceIdSchema).max(50).optional(),
  savedViewId: savedViewIdSchema.nullable().optional(),
  recentDays: z.number().int().min(1).max(3650).nullable().optional(),
  pinnedDocIds: z.array(documentIdSchema).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  allowedKinds: z.array(documentKindSchema).max(5).optional(),
  excludeSystem: z.boolean().default(true),
});
export type ContextPackRules = z.infer<typeof contextPackRulesSchema>;
export type ContextPackRulesInput = z.input<typeof contextPackRulesSchema>;

export interface ContextPack {
  readonly id: ContextPackId;
  readonly workspaceId: WorkspaceId;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly rules: ContextPackRules;
  readonly maxTokens: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const createContextPackInputSchema = z.object({
  slug: contextPackSlugSchema.optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  rules: contextPackRulesSchema.default({ excludeSystem: true }),
  maxTokens: z.number().int().min(500).max(200_000).default(DEFAULT_CONTEXT_PACK_MAX_TOKENS),
});
export type CreateContextPackInput = z.input<typeof createContextPackInputSchema>;
export type ParsedCreateContextPackInput = z.infer<typeof createContextPackInputSchema>;

export const updateContextPackInputSchema = z.object({
  slug: contextPackSlugSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  rules: contextPackRulesSchema.optional(),
  maxTokens: z.number().int().min(500).max(200_000).optional(),
});
export type UpdateContextPackInput = z.infer<typeof updateContextPackInputSchema>;

export interface ContextPackDocItem {
  readonly docId: DocumentId;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly spaceId: SpaceId;
  readonly updatedAt: string;
  readonly pinned: boolean;
  readonly truncated: boolean;
  readonly tokens: number;
  readonly content: string;
  readonly trustTier: ContentTrustTier;
}

export interface RenderedContextPack {
  readonly pack: ContextPack;
  readonly uri: string;
  readonly totalTokens: number;
  readonly budgetTokens: number;
  readonly truncated: boolean;
  readonly omittedCount: number;
  readonly items: readonly ContextPackDocItem[];
  readonly renderedMarkdown: string;
}

export function slugifyContextPackName(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length >= 2) {
    return ascii.slice(0, 80);
  }
  return `pack-${Date.now().toString(36)}`;
}

export interface AssembleContextPackCandidate {
  readonly doc: DocumentRecord;
  readonly bodyText: string;
  readonly explicitPinned?: boolean | undefined;
}

/**
 * Prioritizes pinned documents first, then most recently updated, and packs them
 * strictly within `maxTokens` BPE tokens using `gpt-tokenizer`.
 */
export function assembleContextPack(options: {
  readonly pack: ContextPack;
  readonly candidates: readonly AssembleContextPackCandidate[];
  readonly maxTokensOverride?: number | undefined;
}): RenderedContextPack {
  const budgetTokens = Math.max(
    100,
    Math.min(200_000, options.maxTokensOverride ?? options.pack.maxTokens),
  );
  const pinnedIdSet = new Set(options.pack.rules.pinnedDocIds ?? []);

  const sorted = [...options.candidates].sort((a, b) => {
    const aPinned = Boolean(a.explicitPinned || pinnedIdSet.has(a.doc.id) || a.doc.pinned);
    const bPinned = Boolean(b.explicitPinned || pinnedIdSet.has(b.doc.id) || b.doc.pinned);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return b.doc.updatedAt.localeCompare(a.doc.updatedAt);
  });

  const headerLines = [
    `# Context Pack: ${options.pack.name}`,
    `URI: inkade://pack/${options.pack.slug}`,
    ...(options.pack.description ? [options.pack.description] : []),
    "",
  ];
  const headerText = headerLines.join("\n");
  let usedTokens = countBpeTokens(headerText);

  const items: ContextPackDocItem[] = [];
  const markdownBlocks: string[] = [headerText];
  let truncated = false;
  let omittedCount = 0;

  for (const candidate of sorted) {
    const { doc, bodyText } = candidate;
    const isPinned = Boolean(candidate.explicitPinned || pinnedIdSet.has(doc.id) || doc.pinned);
    const trustTier = deriveDocumentTrustTier(doc);
    const untrustedNotice = buildUntrustedDataNotice(trustTier, doc.sourceMeta);
    const metaLine = `Kind: ${doc.kind} | Space: ${doc.spaceId} | Updated: ${doc.updatedAt}${doc.tags.length > 0 ? ` | Tags: ${doc.tags.map((t) => `#${t}`).join(" ")}` : ""}`;
    const sectionHeader = [
      `## ${doc.title} (${doc.id})`,
      trustTier === "owner_authored" ? metaLine : `${metaLine} | Trust: ${trustTier}`,
      ...(untrustedNotice ? [`> [DATA ISOLATION / ${trustTier}] ${untrustedNotice}`] : []),
      "",
    ].join("\n");
    const sectionHeaderTokens = countBpeTokens(sectionHeader);
    const remaining = budgetTokens - usedTokens;

    if (remaining <= sectionHeaderTokens + 24) {
      omittedCount += 1;
      truncated = true;
      continue;
    }

    const cleanBody = bodyText.trim();
    const bodyBudget = remaining - sectionHeaderTokens - 2;
    const rawBodyTokens = countBpeTokens(cleanBody);

    let finalBody = cleanBody;
    let docTruncated = false;
    if (rawBodyTokens > bodyBudget) {
      finalBody = truncateToTokenBudget(cleanBody, Math.max(16, bodyBudget - 4));
      if (finalBody) {
        finalBody = `${finalBody}\n…`;
      }
      docTruncated = true;
      truncated = true;
    }

    const block = `${sectionHeader}${finalBody}\n\n`;
    const blockTokens = countBpeTokens(block);
    if (usedTokens + blockTokens > budgetTokens) {
      // Final safety trim if marker pushed tokens over budget
      const tighter = truncateToTokenBudget(
        finalBody,
        Math.max(8, budgetTokens - usedTokens - sectionHeaderTokens - 6),
      );
      if (!tighter) {
        omittedCount += 1;
        truncated = true;
        continue;
      }
      const safeBlock = `${sectionHeader}${tighter}\n`;
      const safeTokens = countBpeTokens(safeBlock);
      if (usedTokens + safeTokens > budgetTokens) {
        omittedCount += 1;
        truncated = true;
        continue;
      }
      usedTokens += safeTokens;
      markdownBlocks.push(safeBlock);
      items.push({
        docId: doc.id,
        title: doc.title,
        kind: doc.kind,
        spaceId: doc.spaceId,
        updatedAt: doc.updatedAt,
        pinned: isPinned,
        truncated: true,
        tokens: safeTokens,
        content: tighter,
        trustTier,
      });
      truncated = true;
      continue;
    }

    usedTokens += blockTokens;
    markdownBlocks.push(block);
    items.push({
      docId: doc.id,
      title: doc.title,
      kind: doc.kind,
      spaceId: doc.spaceId,
      updatedAt: doc.updatedAt,
      pinned: isPinned,
      truncated: docTruncated,
      tokens: blockTokens,
      content: finalBody,
      trustTier,
    });
  }

  const renderedMarkdown = markdownBlocks.join("");
  const totalTokens = countBpeTokens(renderedMarkdown);

  return {
    pack: options.pack,
    uri: `inkade://pack/${options.pack.slug}`,
    totalTokens,
    budgetTokens,
    truncated,
    omittedCount,
    items,
    renderedMarkdown,
  };
}

export const CONNECT_PRESET_IDS = [
  "daily_partner",
  "research_assistant",
  "silent_triage",
  "readonly_oracle",
] as const;
export type ConnectPresetId = (typeof CONNECT_PRESET_IDS)[number];

export interface ConnectPresetTemplate {
  readonly id: ConnectPresetId;
  readonly defaultTokenName: string;
  readonly defaultSpaceSlugs: readonly string[] | "*";
  readonly scopeTemplate: Omit<TokenScope, "spaceIds"> & {
    readonly spaceIds: "*" | readonly SpaceId[];
  };
  readonly requiresSpaceSelection?: boolean | undefined;
  readonly quietAutonomy: true;
  readonly boundaryBullets: readonly string[];
}

export const CONNECT_PRESET_TEMPLATES: readonly ConnectPresetTemplate[] = [
  {
    id: "daily_partner",
    defaultTokenName: "Daily & Tasks Partner",
    defaultSpaceSlugs: ["daily", "inbox"],
    scopeTemplate: {
      permission: "write",
      spaceIds: "*",
      includeDescendants: true,
      allowedKinds: ["outline"],
      denyHardDelete: true,
    },
    quietAutonomy: true,
    boundaryBullets: [
      "quiet_autonomy",
      "outline_only",
      "daily_inbox_spaces",
      "deny_hard_delete",
    ],
  },
  {
    id: "research_assistant",
    defaultTokenName: "Space Research Assistant",
    defaultSpaceSlugs: ["research"],
    scopeTemplate: {
      permission: "write",
      spaceIds: "*",
      includeDescendants: true,
      denyHardDelete: true,
    },
    requiresSpaceSelection: true,
    quietAutonomy: true,
    boundaryBullets: [
      "quiet_autonomy",
      "scoped_space_descendants",
      "all_kinds_in_space",
      "deny_hard_delete",
    ],
  },
  {
    id: "silent_triage",
    defaultTokenName: "Silent Inbox & Tag Triage",
    defaultSpaceSlugs: ["inbox"],
    scopeTemplate: {
      permission: "append",
      spaceIds: "*",
      includeDescendants: true,
      allowedKinds: ["clip", "article"],
      denyHardDelete: true,
    },
    quietAutonomy: true,
    boundaryBullets: [
      "quiet_autonomy",
      "append_only",
      "clips_and_articles",
      "deny_hard_delete",
    ],
  },
  {
    id: "readonly_oracle",
    defaultTokenName: "Read-Only Workspace Oracle",
    defaultSpaceSlugs: "*",
    scopeTemplate: {
      permission: "read",
      spaceIds: "*",
      includeDescendants: true,
      denyHardDelete: true,
    },
    quietAutonomy: true,
    boundaryBullets: [
      "read_only_oracle",
      "all_spaces_read",
      "context_packs_rag",
      "deny_hard_delete",
    ],
  },
];

export const CONNECT_HOST_KINDS = [
  "claude_code",
  "cursor",
  "codex",
  "antigravity",
  "copilot",
  "opencode",
  "pi",
  "bb_paseo",
  "http_url",
] as const;
export type ConnectHostKind = (typeof CONNECT_HOST_KINDS)[number];

export function connectHostToHarnessName(host: ConnectHostKind): string {
  switch (host) {
    case "claude_code":
      return "claude-code";
    case "cursor":
      return "cursor";
    case "codex":
      return "codex";
    case "antigravity":
      return "antigravity";
    case "copilot":
      return "copilot";
    case "opencode":
      return "opencode";
    case "pi":
      return "pi";
    case "bb_paseo":
    case "http_url":
      return "any";
    default: {
      const _exhaustive: never = host;
      return _exhaustive;
    }
  }
}

export function buildHostConnectConfig(options: {
  readonly host: ConnectHostKind;
  readonly baseUrl: string;
  readonly token: string;
  readonly serverName?: string | undefined;
}): string {
  const cleanBase = options.baseUrl.replace(/\/+$/, "");
  const mcpUrl = `${cleanBase}/mcp`;
  const token = options.token || "<YOUR_INKADE_TOKEN>";
  const name = options.serverName?.trim() || "inkade";

  switch (options.host) {
    case "claude_code":
      return `claude mcp add --transport http ${name} ${mcpUrl} --header "Authorization: Bearer ${token}"`;
    case "cursor":
      return JSON.stringify(
        {
          mcpServers: {
            [name]: {
              url: mcpUrl,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        },
        null,
        2,
      );
    case "codex":
      return [
        `[mcp_servers.${name}]`,
        `url = "${mcpUrl}"`,
        `http_headers = { Authorization = "Bearer ${token}" }`,
      ].join("\n");
    case "antigravity":
      return JSON.stringify(
        {
          mcpServers: {
            [name]: {
              serverUrl: mcpUrl,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        },
        null,
        2,
      );
    case "copilot":
    case "pi":
    case "bb_paseo":
      return JSON.stringify(
        {
          mcpServers: {
            [name]: {
              type: "http",
              url: mcpUrl,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        },
        null,
        2,
      );
    case "opencode":
      return JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            [name]: {
              type: "remote",
              url: mcpUrl,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        },
        null,
        2,
      );
    case "http_url":
      return mcpUrl;
    default: {
      const _exhaustive: never = options.host;
      return _exhaustive;
    }
  }
}

export interface ConnectPingStatus {
  readonly ok: boolean;
  readonly serverVersion: string;
  readonly mcpEndpoint: string;
  readonly totalTools: number;
  readonly principalKind: "user" | "token";
  readonly activeTokensCount: number;
  readonly contextPacksCount: number;
  readonly recentMcpCalls: readonly {
    readonly id: string;
    readonly action: string;
    readonly resource: string;
    readonly decision: "allowed" | "denied";
    readonly tokenName: string | null;
    readonly createdAt: string;
  }[];
}
