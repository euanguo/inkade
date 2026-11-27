import { z } from "zod";
import { spaceIdSchema, type SpaceId, type UserId, type WorkspaceId } from "../ids.ts";
import { documentKindSchema, type DocumentKind } from "./common.ts";

export interface Workspace {
  readonly id: WorkspaceId;
  readonly slug: string;
  readonly name: string;
  readonly ownerUserId: UserId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Space {
  readonly id: SpaceId;
  readonly workspaceId: WorkspaceId;
  readonly parentId: SpaceId | null;
  readonly slug: string;
  readonly name: string;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
  readonly defaultKind?: DocumentKind | undefined;
  readonly sortOrder: number;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const createSpaceInputSchema = z.object({
  parentId: spaceIdSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).optional(),
  icon: z.string().trim().min(1).max(64).optional(),
  color: z.string().trim().min(1).max(32).optional(),
  defaultKind: documentKindSchema.optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateSpaceInput = z.input<typeof createSpaceInputSchema>;
export type ParsedCreateSpaceInput = z.infer<typeof createSpaceInputSchema>;

export const updateSpaceInputSchema = z.object({
  parentId: spaceIdSchema.nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(120).optional(),
  icon: z.string().trim().min(1).max(64).nullable().optional(),
  color: z.string().trim().min(1).max(32).nullable().optional(),
  defaultKind: documentKindSchema.nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateSpaceInput = z.infer<typeof updateSpaceInputSchema>;
