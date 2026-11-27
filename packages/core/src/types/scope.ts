import { z } from "zod";
import {
  spaceIdSchema,
  type ApiTokenId,
  type AttachmentId,
  type DocumentId,
  type ProjectRuleId,
  type SpaceId,
  type WorkspaceId,
} from "../ids.ts";
import {
  documentKindSchema,
  isoTimestampSchema,
  projectScopeRuleMatchTypeSchema,
  tokenPermissionSchema,
  type DocumentKind,
  type ProjectScopeRuleMatchType,
  type TokenPermission,
} from "./common.ts";

export const tokenScopeSchema = z.object({
  permission: tokenPermissionSchema,
  spaceIds: z.union([z.literal("*"), z.array(spaceIdSchema)]),
  includeDescendants: z.boolean().default(true),
  tagAllowlist: z.array(z.string().min(1)).optional(),
  allowedKinds: z.array(documentKindSchema).optional(),
  denyHardDelete: z.boolean().default(true),
  allowGovernanceMutation: z.boolean().optional(),
});
export type TokenScope = z.infer<typeof tokenScopeSchema>;
export type TokenScopeInput = z.input<typeof tokenScopeSchema>;

export interface ScopeTarget {
  readonly spaceId: SpaceId | "*";
  readonly kind?: DocumentKind | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly resourceType?: "document" | "space" | undefined;
}

export interface ScopeDecision {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
}

export interface ScopeEffectiveSummary {
  readonly permission: TokenPermission;
  readonly allowedSpaceIds: readonly SpaceId[] | "*";
  readonly includeDescendants: boolean;
  readonly tagAllowlist: readonly string[] | null;
  readonly allowedKinds: readonly DocumentKind[] | null;
  readonly denyHardDelete: boolean;
  readonly allowGovernanceMutation?: boolean | undefined;
}

export interface ApiTokenRecord {
  readonly id: ApiTokenId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly tokenPrefix: string;
  readonly scope: TokenScope;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectScopeRule {
  readonly id: ProjectRuleId;
  readonly workspaceId: WorkspaceId;
  readonly matchType: ProjectScopeRuleMatchType;
  readonly pattern: string;
  readonly writableSpaceIds: readonly SpaceId[];
  readonly readonlySpaceIds: readonly SpaceId[];
  readonly defaultInboxSpaceId?: SpaceId | undefined;
  readonly defaultResearchSpaceId?: SpaceId | undefined;
  readonly extraInstructions?: string | undefined;
  readonly priority: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AttachmentRecord {
  readonly id: AttachmentId;
  readonly workspaceId: WorkspaceId;
  readonly documentId: DocumentId | null;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly filename: string;
  readonly createdAt: string;
}

export const createApiTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scope: tokenScopeSchema,
  expiresAt: isoTimestampSchema.nullable().optional(),
});
export type CreateApiTokenInput = z.input<typeof createApiTokenInputSchema>;
export type ParsedCreateApiTokenInput = z.infer<typeof createApiTokenInputSchema>;

export const updateApiTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  scope: tokenScopeSchema.optional(),
  expiresAt: isoTimestampSchema.nullable().optional(),
});
export type UpdateApiTokenInput = z.input<typeof updateApiTokenInputSchema>;
export type ParsedUpdateApiTokenInput = z.infer<typeof updateApiTokenInputSchema>;

export const projectScopeRuleInputSchema = z.object({
  matchType: projectScopeRuleMatchTypeSchema,
  pattern: z.string().trim().min(1).max(500),
  writableSpaceIds: z.array(spaceIdSchema).default([]),
  readonlySpaceIds: z.array(spaceIdSchema).default([]),
  defaultInboxSpaceId: spaceIdSchema.optional(),
  defaultResearchSpaceId: spaceIdSchema.optional(),
  extraInstructions: z.string().max(4000).optional(),
  priority: z.number().int().default(0),
});
export type ProjectScopeRuleInput = z.input<typeof projectScopeRuleInputSchema>;
export type ParsedProjectScopeRuleInput = z.infer<typeof projectScopeRuleInputSchema>;
