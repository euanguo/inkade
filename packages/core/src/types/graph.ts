import { z } from "zod";
import { documentIdSchema, spaceIdSchema, type DocumentId, type SpaceId } from "../ids.ts";
import { documentKindSchema, type DocumentKind } from "./common.ts";

export const WORKSPACE_GRAPH_EDGE_KINDS = ["explicit", "mirror", "semantic"] as const;
export type WorkspaceGraphEdgeKind = (typeof WORKSPACE_GRAPH_EDGE_KINDS)[number];
export const workspaceGraphEdgeKindSchema = z.enum(WORKSPACE_GRAPH_EDGE_KINDS);

export interface WorkspaceGraphNode {
  readonly id: DocumentId;
  readonly title: string;
  readonly slug: string;
  readonly kind: DocumentKind;
  readonly spaceId: SpaceId;
  readonly tags: readonly string[];
  readonly updatedAt: string;
  readonly degree: number;
}

export interface WorkspaceGraphEdge {
  readonly id: string;
  readonly source: DocumentId;
  readonly target: DocumentId;
  readonly kind: WorkspaceGraphEdgeKind;
  readonly weight: number;
}

export interface WorkspaceGraph {
  readonly nodes: readonly WorkspaceGraphNode[];
  readonly edges: readonly WorkspaceGraphEdge[];
}

const queryBooleanSchema = z.preprocess((val) => {
  if (typeof val === "string") {
    const lower = val.trim().toLowerCase();
    if (lower === "false" || lower === "0" || lower === "no") return false;
    if (lower === "true" || lower === "1" || lower === "yes") return true;
  }
  return val;
}, z.boolean());

export const workspaceGraphQuerySchema = z.object({
  spaceId: spaceIdSchema.optional(),
  kind: documentKindSchema.optional(),
  tag: z.string().trim().min(1).optional(),
  includeSemantic: queryBooleanSchema.optional(),
  includeIsolated: queryBooleanSchema.optional(),
  semanticThreshold: z.coerce.number().min(0.1).max(0.99).optional(),
});
export type WorkspaceGraphQuery = z.infer<typeof workspaceGraphQuerySchema>;

export const linkDocumentTargetInputSchema = z.object({
  targetDocumentId: documentIdSchema,
});
export type LinkDocumentTargetInput = z.infer<typeof linkDocumentTargetInputSchema>;
