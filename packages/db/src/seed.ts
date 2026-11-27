import { asSpaceId, asUserId, asWorkspaceId, todayLocalDateString, type Workspace } from "@inkade/core";
import type { InkadeRepositories } from "./repositories/ports/index.ts";

export type SeedRepositories = Pick<
  InkadeRepositories,
  "workspace" | "space" | "document" | "outline"
>;

export const DEFAULT_WORKSPACE_ID = asWorkspaceId("ws_default");
export const DEFAULT_WORKSPACE_SLUG = "personal";

export const DEFAULT_SPACE_IDS = {
  daily: asSpaceId("spc_daily"),
  inbox: asSpaceId("spc_inbox"),
  research: asSpaceId("spc_research"),
  projects: asSpaceId("spc_projects"),
} as const;

export interface SeedResult {
  readonly workspace: Workspace;
  readonly seeded: boolean;
}

const WELCOME_ARTICLE_MARKDOWN = `# Welcome to Inkade

Inkade is your **ADE-native knowledge hub**, bridging daily outliner thinking with long-form agent research reports.

## How the Dual Engine Works

| Mode | Purpose | Collaboration Guarantee |
| --- | --- | --- |
| Daily Outline (\`outline\`) | Rapid thought capture & task dispatch | Stable \`nodeId\` tree prevents ADE thread link rot |
| Research Articles (\`article\`) | Long-form synthesis & specs | AST-backed section patching & full revision diffs |
| Web Clips (\`clip\`) | Triage & reference inbox | Clean Markdown + source metadata |

## Next Steps

- Open [[Daily · Today]] to capture thoughts or dispatch a thread to any MCP-compatible ADE.
- Create Scoped API Tokens for external MCP agents so every workspace rule is enforced on the server.
`;

/**
 * Idempotently seeds a fresh Inkade workspace with default spaces, a welcome article,
 * and today's daily outline.
 */
export async function seedDefaultWorkspace(
  repos: SeedRepositories,
  options?: { readonly ownerUserId?: string | undefined; readonly dailyDate?: string | undefined },
): Promise<SeedResult> {
  const workspace = await repos.workspace.ensureWorkspace({
    id: DEFAULT_WORKSPACE_ID,
    slug: DEFAULT_WORKSPACE_SLUG,
    name: "Personal Knowledge Hub",
    ownerUserId: asUserId(options?.ownerUserId ?? "usr_local_owner"),
  });

  const existingSpaces = await repos.space.listSpaces(workspace.id, { includeArchived: true });
  const existingIds = new Set(existingSpaces.map((s) => s.id));
  let seeded = false;

  const defaultSpaces = [
    {
      id: DEFAULT_SPACE_IDS.daily,
      slug: "daily",
      name: "Daily",
      icon: "CalendarDays",
      color: "amber",
      defaultKind: "outline" as const,
      sortOrder: 10,
    },
    {
      id: DEFAULT_SPACE_IDS.inbox,
      slug: "inbox",
      name: "Inbox",
      icon: "Inbox",
      color: "indigo",
      defaultKind: "clip" as const,
      sortOrder: 20,
    },
    {
      id: DEFAULT_SPACE_IDS.research,
      slug: "research",
      name: "Research",
      icon: "BookOpen",
      color: "emerald",
      defaultKind: "article" as const,
      sortOrder: 30,
    },
    {
      id: DEFAULT_SPACE_IDS.projects,
      slug: "projects",
      name: "Projects",
      icon: "FolderKanban",
      color: "blue",
      defaultKind: "article" as const,
      sortOrder: 40,
    },
  ];

  for (const spc of defaultSpaces) {
    if (!existingIds.has(spc.id)) {
      await repos.space.createSpace(
        workspace.id,
        {
          parentId: null,
          name: spc.name,
          slug: spc.slug,
          icon: spc.icon,
          color: spc.color,
          defaultKind: spc.defaultKind,
          sortOrder: spc.sortOrder,
        },
        { id: spc.id },
      );
      seeded = true;
    }
  }

  const today = options?.dailyDate ?? todayLocalDateString();
  const dailyResult = await repos.document.getOrCreateDailyOutline(
    workspace.id,
    DEFAULT_SPACE_IDS.daily,
    today,
    `Daily · ${today}`,
  );
  if (dailyResult.created) {
    seeded = true;
    await repos.outline.createOutlineNode(workspace.id, {
      documentId: dailyResult.document.id,
      parentNodeId: null,
      contentMarkdown: "",
      checked: null,
      collapsed: false,
      authorType: "human",
    });
  }

  const existingWelcome = await repos.document.getDocumentBySlug(workspace.id, "welcome-to-inkade");
  if (!existingWelcome) {
    seeded = true;
    await repos.document.createDocument(
      workspace.id,
      {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "Welcome to Inkade",
        slug: "welcome-to-inkade",
        contentMarkdown: WELCOME_ARTICLE_MARKDOWN,
        tags: ["guide", "inkade"],
        pinned: true,
      },
      { actorType: "system", unreadAgentUpdate: false, changeSummary: "Default seed document" },
    );
  }

  const existingTemplates = await repos.workspace.listDocumentTemplates(workspace.id);
  if (existingTemplates.length === 0) {
    seeded = true;
    await repos.workspace.createDocumentTemplate(workspace.id, {
      name: "Daily Focus",
      kind: "outline",
      description: "Structured daily standup and focus checklist",
      contentMarkdown: [
        "- Top Priorities ({{date}})",
        "  - [ ] Primary deep-work objective",
        "- Agent Dispatches",
        "- End-of-Day Notes ({{weekday}})",
      ].join("\n"),
      isDefaultDaily: false,
    });
    await repos.workspace.createDocumentTemplate(workspace.id, {
      name: "Research Brief",
      kind: "article",
      description: "Long-form technical synthesis template",
      contentMarkdown: [
        "# {{title}}",
        "",
        "## Context & Question",
        "",
        "## Key Findings",
        "",
        "## Decision & Next Steps",
        "",
      ].join("\n"),
      isDefaultDaily: false,
    });
  }

  return { workspace, seeded };
}
