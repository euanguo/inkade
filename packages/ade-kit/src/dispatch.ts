import type {
  AdeThreadBinding,
  AdeThreadStatus,
  ClaimThreadBindingInput,
  CreateOutlineNodeInput,
  DocumentId,
  DocumentKind,
  DocumentRecord,
  OutlineNode,
  OutlineNodeId,
  ProjectScopeRule,
  SpaceId,
  ThreadBindingId,
} from "@inkade/core";
import { buildDispatchPrompt, type DispatchReferenceContext } from "./prompts.ts";
import type { MatchedProjectScopeRule, ProjectScopeRuleCandidate } from "./scope-rules.ts";
import { truncateAssistantSummary } from "./thread-sync.ts";

export interface AdeKitDocumentStore {
  readonly documents: {
    get(documentId: DocumentId): Promise<DocumentRecord>;
    create(input: {
      readonly spaceId: SpaceId;
      readonly kind: DocumentKind;
      readonly title: string;
      readonly contentMarkdown?: string | undefined;
      readonly tags?: readonly string[] | undefined;
      readonly pinned?: boolean | undefined;
    }): Promise<DocumentRecord>;
  };
  readonly outlineNodes: {
    list(documentId: DocumentId): Promise<readonly OutlineNode[]>;
    create(input: CreateOutlineNodeInput): Promise<OutlineNode>;
  };
  readonly threadBindings: {
    claim(bindingId: ThreadBindingId, input: ClaimThreadBindingInput): Promise<AdeThreadBinding>;
  };
}

export interface OutlineNodeHierarchy {
  readonly node: OutlineNode | null;
  readonly ancestors: readonly OutlineNode[];
  readonly children: readonly OutlineNode[];
}

/**
 * Extracts the target node's ancestor chain and active direct children from an outline node list.
 */
export function buildOutlineHierarchy(
  nodes: readonly OutlineNode[],
  nodeId: OutlineNodeId | null | undefined,
): OutlineNodeHierarchy {
  if (!nodeId) {
    return { node: null, ancestors: [], children: [] };
  }
  const activeNodes = nodes.filter((n) => n.deletedAt === null);
  const byId = new Map(activeNodes.map((n) => [n.id, n] as const));
  const node = byId.get(nodeId) ?? null;
  if (!node) {
    return { node: null, ancestors: [], children: [] };
  }

  const ancestors: OutlineNode[] = [];
  const visited = new Set<OutlineNodeId>([node.id]);
  let cursor = node.parentNodeId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const parent = byId.get(cursor);
    if (!parent) break;
    ancestors.unshift(parent);
    cursor = parent.parentNodeId;
  }

  const children = activeNodes
    .filter((n) => n.parentNodeId === node.id)
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));

  return { node, ancestors, children };
}

export interface QueuedClaimPromptInput {
  readonly binding: Pick<
    AdeThreadBinding,
    "id" | "title" | "lastSummary" | "selectionAnchor" | "documentId" | "nodeId"
  >;
  readonly document: Pick<DocumentRecord, "id" | "spaceId" | "kind" | "title" | "dailyDate">;
  readonly node?: Pick<OutlineNode, "id" | "contentMarkdown" | "checked"> | null | undefined;
  readonly ancestors?: readonly Pick<OutlineNode, "id" | "contentMarkdown">[] | undefined;
  readonly children?: readonly Pick<OutlineNode, "id" | "contentMarkdown">[] | undefined;
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
 * Builds the dispatch prompt used when an ADE claims a `queued` `AdeThreadBinding`.
 */
export function buildQueuedClaimPrompt(input: QueuedClaimPromptInput): string {
  const {
    binding,
    document,
    node,
    ancestors,
    children,
    references,
    projectRule,
    extraInstructions,
  } = input;
  const combinedExtra = [
    binding.lastSummary && binding.lastSummary !== node?.contentMarkdown
      ? `Queued note: ${binding.lastSummary}`
      : null,
    extraInstructions ?? null,
  ]
    .filter((item): item is string => Boolean(item && item.trim()))
    .join(" | ");

  return buildDispatchPrompt({
    document,
    node: node ?? null,
    ancestors,
    children,
    selectionAnchor: binding.selectionAnchor ?? null,
    references,
    projectRule: projectRule ?? null,
    ...(combinedExtra ? { extraInstructions: combinedExtra } : {}),
  });
}

export interface QueuedThreadSpawnResult {
  readonly externalThreadId: string;
  readonly externalWorkspaceId?: string | null | undefined;
  readonly deepLink?: string | null | undefined;
  readonly status?: AdeThreadStatus | undefined;
  readonly lastSummary?: string | null | undefined;
}

export interface ClaimQueuedBindingOptions<
  TRule extends ProjectScopeRuleCandidate = ProjectScopeRuleCandidate,
> {
  readonly matchedRule?: MatchedProjectScopeRule<TRule> | null | undefined;
  readonly promptOverride?: string | undefined;
  readonly extraInstructions?: string | undefined;
  readonly references?: readonly DispatchReferenceContext[] | undefined;
  readonly fallbackDocument?: DocumentRecord | undefined;
}

export interface ClaimQueuedBindingContext<
  TRule extends ProjectScopeRuleCandidate = ProjectScopeRuleCandidate,
> {
  readonly binding: AdeThreadBinding;
  readonly document: DocumentRecord;
  readonly node: OutlineNode | null;
  readonly prompt: string;
  readonly title: string;
  readonly matchedRule: MatchedProjectScopeRule<TRule> | null;
}

/**
 * Resolves outline/document context for a `queued` `AdeThreadBinding`, spawns a live host
 * thread via `spawner`, and atomically claims the binding on the Inkade server.
 */
export async function claimQueuedBindingWithSpawner<
  TRule extends ProjectScopeRuleCandidate = ProjectScopeRuleCandidate,
>(
  store: Pick<AdeKitDocumentStore, "documents" | "outlineNodes" | "threadBindings">,
  binding: AdeThreadBinding,
  spawner: (ctx: ClaimQueuedBindingContext<TRule>) => Promise<QueuedThreadSpawnResult>,
  options: ClaimQueuedBindingOptions<TRule> = {},
): Promise<{
  readonly binding: AdeThreadBinding;
  readonly threadId: string;
  readonly prompt: string;
}> {
  const document =
    options.fallbackDocument ?? (await store.documents.get(binding.documentId));

  let hierarchy: OutlineNodeHierarchy = { node: null, ancestors: [], children: [] };
  if (document.kind === "outline" && binding.nodeId) {
    const nodes = await store.outlineNodes.list(document.id);
    hierarchy = buildOutlineHierarchy(nodes, binding.nodeId);
  }

  const matchedRule = options.matchedRule ?? null;
  const prompt =
    options.promptOverride?.trim() ||
    buildQueuedClaimPrompt({
      binding,
      document,
      node: hierarchy.node,
      ancestors: hierarchy.ancestors,
      children: hierarchy.children,
      references: options.references,
      projectRule: matchedRule?.rule ?? null,
      extraInstructions: options.extraInstructions,
    });

  const derivedTitle =
    binding.title.trim() ||
    hierarchy.node?.contentText.trim().slice(0, 80) ||
    hierarchy.node?.contentMarkdown.trim().slice(0, 80) ||
    document.title;

  const spawned = await spawner({
    binding,
    document,
    node: hierarchy.node,
    prompt,
    title: derivedTitle,
    matchedRule,
  });

  const claimed = await store.threadBindings.claim(binding.id, {
    externalThreadId: spawned.externalThreadId,
    ...(spawned.externalWorkspaceId !== undefined
      ? { externalWorkspaceId: spawned.externalWorkspaceId }
      : {}),
    ...(spawned.deepLink !== undefined ? { deepLink: spawned.deepLink } : {}),
    status: spawned.status ?? "running",
    ...(spawned.lastSummary !== undefined
      ? { lastSummary: truncateAssistantSummary(spawned.lastSummary) }
      : {}),
  });

  return {
    binding: claimed,
    threadId: spawned.externalThreadId,
    prompt,
  };
}

export interface AppendReplyToOutlineInput {
  readonly documentId: DocumentId;
  readonly parentNodeId?: OutlineNodeId | null | undefined;
  readonly replyMarkdown: string;
  readonly sourceBindingId?: ThreadBindingId | null | undefined;
  readonly maxNodeChars?: number | undefined;
}

/**
 * Formats an agent thread's latest reply and appends it as a child outline node
 * without disturbing sibling nodes or existing `AdeThreadBinding` references.
 */
export async function appendThreadReplyToOutline(
  store: Pick<AdeKitDocumentStore, "outlineNodes">,
  input: AppendReplyToOutlineInput,
): Promise<OutlineNode> {
  const cleaned = input.replyMarkdown.trim();
  if (!cleaned) {
    throw new Error("Thread reply content is empty.");
  }

  const maxChars = input.maxNodeChars ?? 1_500;
  const compact = cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars - 1).trimEnd()}…`;

  return store.outlineNodes.create({
    documentId: input.documentId,
    parentNodeId: input.parentNodeId ?? null,
    contentMarkdown: compact,
    checked: null,
    authorType: "agent",
    ...(input.sourceBindingId ? { sourceBindingId: input.sourceBindingId } : {}),
  });
}

export interface SaveReplyAsArticleInput {
  readonly spaceId: SpaceId;
  readonly title: string;
  readonly replyMarkdown: string;
  readonly tags?: readonly string[] | undefined;
  readonly sourceDocumentId?: DocumentId | null | undefined;
  readonly sourceNodeId?: OutlineNodeId | null | undefined;
  readonly sourceBindingId?: ThreadBindingId | null | undefined;
  readonly linkFromOutline?: boolean | undefined;
}

/**
 * Publishes an agent thread's latest reply as a clean Markdown `article` document,
 * and optionally attaches a `[[Title]]` child node back to the originating outline node.
 */
export async function saveThreadReplyAsArticle(
  store: Pick<AdeKitDocumentStore, "documents" | "outlineNodes">,
  input: SaveReplyAsArticleInput,
): Promise<{
  readonly document: DocumentRecord;
  readonly linkedNode: OutlineNode | null;
}> {
  const cleaned = input.replyMarkdown.trim();
  if (!cleaned) {
    throw new Error("Thread reply content is empty.");
  }

  const title = input.title.trim().slice(0, 300) || "Thread Research Note";
  const document = await store.documents.create({
    spaceId: input.spaceId,
    kind: "article",
    title,
    contentMarkdown: cleaned,
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
  });

  let linkedNode: OutlineNode | null = null;
  if (input.linkFromOutline && input.sourceDocumentId) {
    const summary = truncateAssistantSummary(cleaned, 120);
    const linkMarkdown = summary
      ? `[[${document.title}]] — ${summary}`
      : `[[${document.title}]]`;
    linkedNode = await store.outlineNodes.create({
      documentId: input.sourceDocumentId,
      parentNodeId: input.sourceNodeId ?? null,
      contentMarkdown: linkMarkdown,
      checked: null,
      authorType: "agent",
      ...(input.sourceBindingId ? { sourceBindingId: input.sourceBindingId } : {}),
    });
  }

  return { document, linkedNode };
}
