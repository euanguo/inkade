import type {
  DocumentKind,
  DocumentRecord,
  OutlineNode,
  OutlineNodeId,
  ProjectScopeRule,
  SelectionAnchor,
  Space,
  SpaceId,
  TokenScope,
} from "@inkade/core";
import type {
  MatchedProjectScopeRule,
  ProjectScopeRuleCandidate,
} from "./scope-rules.ts";

export interface DispatchReferenceContext {
  readonly id: string;
  readonly kind?: DocumentKind | "node" | "thread" | undefined;
  readonly title: string;
  readonly snippet?: string | undefined;
  readonly spaceId?: SpaceId | undefined;
  readonly nodeId?: OutlineNodeId | null | undefined;
}

export interface DispatchPromptInput {
  readonly document: Pick<DocumentRecord, "id" | "spaceId" | "kind" | "title" | "dailyDate">;
  readonly node?: Pick<OutlineNode, "id" | "contentMarkdown" | "checked"> | null | undefined;
  readonly ancestors?: readonly Pick<OutlineNode, "id" | "contentMarkdown">[] | undefined;
  readonly children?: readonly Pick<OutlineNode, "id" | "contentMarkdown">[] | undefined;
  readonly selectionAnchor?: SelectionAnchor | null | undefined;
  readonly references?: readonly DispatchReferenceContext[] | undefined;
  readonly projectRule?:
    | (Pick<ProjectScopeRule, "id"> & {
        readonly defaultInboxSpaceId?: SpaceId | undefined;
        readonly defaultResearchSpaceId?: SpaceId | undefined;
        readonly extraInstructions?: string | undefined;
      })
    | null
    | undefined;
  readonly extraInstructions?: string | undefined;
}

/**
 * Formats structured `@` mention reference objects into a prompt context section.
 */
export function formatReferenceContextBlock(
  references: readonly DispatchReferenceContext[],
): string {
  if (references.length === 0) return "";
  const lines: string[] = ["## Referenced Context (@mentions)"];
  for (const ref of references) {
    const kindLabel = ref.kind ?? "document";
    const metaParts = [kindLabel, `id=${ref.id}`];
    if (ref.spaceId) metaParts.push(`spaceId=${ref.spaceId}`);
    if (ref.nodeId) metaParts.push(`nodeId=${ref.nodeId}`);
    lines.push(`- @${ref.title} (${metaParts.join(", ")})`);
    if (ref.snippet && ref.snippet.trim().length > 0) {
      const compactSnippet = ref.snippet.replace(/\s+/g, " ").trim().slice(0, 320);
      lines.push(`  > ${compactSnippet}`);
    }
  }
  return lines.join("\n");
}

/**
 * Generates concise, high-signal system instructions describing what spaces
 * and actions an agent is allowed to use in the current project context.
 */
export function buildAgentContextPrompt(
  scope: TokenScope,
  visibleSpaces: readonly Pick<Space, "id" | "name" | "slug">[],
  extraInstructions?: string,
  matchedRule?: MatchedProjectScopeRule<ProjectScopeRuleCandidate> | null,
): string {
  const writableSet = new Set(matchedRule?.writableSpaceIds ?? []);
  const readonlySet = new Set(matchedRule?.readonlySpaceIds ?? []);

  const spaceSummary =
    visibleSpaces.length === 0
      ? "none"
      : visibleSpaces
          .map((s) => {
            const access = writableSet.has(s.id)
              ? " [writable]"
              : readonlySet.has(s.id)
                ? " [read-only]"
                : "";
            return `${s.name} (${s.slug}, id=${s.id})${access}`;
          })
          .join(", ");

  const lines = [
    "Inkade note workspace is connected.",
    `- Permission level: ${scope.permission} (hard delete: ${scope.denyHardDelete ? "blocked" : "allowed"})`,
    `- Visible spaces: ${spaceSummary}`,
    scope.allowedKinds ? `- Allowed document kinds: ${scope.allowedKinds.join(", ")}` : null,
    scope.tagAllowlist && scope.tagAllowlist.length > 0
      ? `- Required tag allowlist: ${scope.tagAllowlist.join(", ")}`
      : null,
    matchedRule?.rule.defaultInboxSpaceId
      ? `- Default inbox spaceId: ${matchedRule.rule.defaultInboxSpaceId}`
      : null,
    matchedRule?.rule.defaultResearchSpaceId
      ? `- Default research spaceId: ${matchedRule.rule.defaultResearchSpaceId}`
      : null,
    "- Mutate daily outlines via node-level tools; write long-form research reports as article documents.",
    matchedRule?.rule.extraInstructions
      ? `- Matched project rule (${matchedRule.rule.id}): ${matchedRule.rule.extraInstructions}`
      : null,
    extraInstructions ? `- Project rule: ${extraInstructions}` : null,
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}

/**
 * Builds an agent dispatch prompt with full Inkade callback coordinates so the spawned
 * thread knows which outline node or article section to update with its findings.
 */
export function buildDispatchPrompt(input: DispatchPromptInput): string {
  const {
    document,
    node,
    ancestors,
    children,
    selectionAnchor,
    references,
    projectRule,
    extraInstructions,
  } = input;

  const taskSummary = node
    ? node.contentMarkdown.trim()
    : selectionAnchor
      ? selectionAnchor.quote.trim()
      : document.title;

  const lines: string[] = [
    `Work on this task dispatched from Inkade (${document.kind}: "${document.title}"):`,
    "",
    `> ${taskSummary || "(empty item)"}`,
  ];

  if (ancestors && ancestors.length > 0) {
    lines.push("", "## Outline Context (Ancestors)");
    for (const ancestor of ancestors) {
      lines.push(`- ${ancestor.contentMarkdown.trim()} (nodeId: ${ancestor.id})`);
    }
  }

  if (children && children.length > 0) {
    lines.push("", "## Existing Sub-items");
    for (const child of children) {
      lines.push(`- ${child.contentMarkdown.trim()} (nodeId: ${child.id})`);
    }
  }

  if (selectionAnchor) {
    lines.push("", "## Selection Anchor");
    lines.push(`- Quote: ${JSON.stringify(selectionAnchor.quote)}`);
    if (selectionAnchor.headingSlug) {
      lines.push(`- Heading slug: ${selectionAnchor.headingSlug}`);
    }
  }

  if (references && references.length > 0) {
    const refBlock = formatReferenceContextBlock(references);
    if (refBlock) {
      lines.push("", refBlock);
    }
  }

  lines.push("", "## Inkade Callback Coordinates");
  lines.push(`- documentId: ${document.id}`);
  lines.push(`- spaceId: ${document.spaceId}`);
  lines.push(`- kind: ${document.kind}`);
  if (document.dailyDate) {
    lines.push(`- dailyDate: ${document.dailyDate}`);
  }
  if (node) {
    lines.push(`- nodeId: ${node.id}`);
  }
  if (projectRule?.defaultResearchSpaceId) {
    lines.push(`- defaultResearchSpaceId: ${projectRule.defaultResearchSpaceId}`);
  }
  if (projectRule?.defaultInboxSpaceId) {
    lines.push(`- defaultInboxSpaceId: ${projectRule.defaultInboxSpaceId}`);
  }

  lines.push(
    "",
    "## Reporting Back",
    node
      ? `- Append concise conclusions as child nodes under parentNodeId="${node.id}" on documentId="${document.id}".`
      : `- Write findings back to documentId="${document.id}" via section patch or create a linked article.`,
    "- For long-form research reports, create an article document and link it using `[[Document Title]]`.",
  );

  if (projectRule?.extraInstructions) {
    lines.push(`- Project rule guidance: ${projectRule.extraInstructions}`);
  }
  if (extraInstructions) {
    lines.push(`- Additional instructions: ${extraInstructions}`);
  }

  return lines.join("\n");
}
