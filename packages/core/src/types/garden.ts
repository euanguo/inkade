import { z } from "zod";
import type {
  DocumentId,
  PublicSiteId,
  SpaceId,
  WorkspaceId,
} from "../ids.ts";
import type { DocumentKind } from "./common.ts";
import type { OutlineNode } from "./outline.ts";
import type { PropertyFieldDefinition, ViewQueryResponse } from "./property-schema.ts";

export const PUBLIC_SITE_SOURCE_TYPES = ["space", "saved_view"] as const;
export type PublicSiteSourceType = (typeof PUBLIC_SITE_SOURCE_TYPES)[number];
export const publicSiteSourceTypeSchema = z.enum(PUBLIC_SITE_SOURCE_TYPES);

export const publicSiteSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Site slug must contain lowercase letters, numbers, and single hyphens only",
  });

export interface PublicSite {
  readonly id: PublicSiteId;
  readonly workspaceId: WorkspaceId;
  readonly slug: string;
  readonly title: string;
  readonly subtitle: string;
  readonly sourceType: PublicSiteSourceType;
  readonly sourceId: string;
  readonly exposedFields: readonly string[];
  readonly enableRss: boolean;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const createPublicSiteInputSchema = z.object({
  slug: publicSiteSlugSchema.optional(),
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(400).default(""),
  sourceType: publicSiteSourceTypeSchema,
  sourceId: z.string().trim().min(1).max(120),
  exposedFields: z.array(z.string().trim().min(1).max(64)).max(60).default([]),
  enableRss: z.boolean().default(true),
  enabled: z.boolean().default(true),
});
export type CreatePublicSiteInput = z.input<typeof createPublicSiteInputSchema>;
export type ParsedCreatePublicSiteInput = z.infer<typeof createPublicSiteInputSchema>;

export const updatePublicSiteInputSchema = z.object({
  slug: publicSiteSlugSchema.optional(),
  title: z.string().trim().min(1).max(160).optional(),
  subtitle: z.string().trim().max(400).optional(),
  sourceType: publicSiteSourceTypeSchema.optional(),
  sourceId: z.string().trim().min(1).max(120).optional(),
  exposedFields: z.array(z.string().trim().min(1).max(64)).max(60).optional(),
  enableRss: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
export type UpdatePublicSiteInput = z.infer<typeof updatePublicSiteInputSchema>;

export interface PublicSiteSpaceInfo {
  readonly id: SpaceId;
  readonly parentId: SpaceId | null;
  readonly name: string;
  readonly slug: string;
}

export interface PublicSiteDocSummary {
  readonly id: DocumentId;
  readonly spaceId: SpaceId;
  readonly kind: DocumentKind;
  readonly slug: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly excerpt: string;
  readonly sourceUrl?: string | null | undefined;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PublicSiteBacklinkRef {
  readonly id: DocumentId;
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
}

export interface PublicSiteDocDetail extends PublicSiteDocSummary {
  readonly contentMarkdown: string;
  readonly outlineNodes?: readonly OutlineNode[] | undefined;
  readonly backlinks: readonly PublicSiteBacklinkRef[];
  readonly embeddedViews?: Readonly<Record<string, ViewQueryResponse>> | undefined;
}

export interface PublicSiteMeta {
  readonly id: PublicSiteId;
  readonly slug: string;
  readonly title: string;
  readonly subtitle: string;
  readonly sourceType: PublicSiteSourceType;
  readonly sourceId: string;
  readonly exposedFields: readonly string[];
  readonly enableRss: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PublicSitePayload {
  readonly site: PublicSiteMeta;
  readonly spaces: readonly PublicSiteSpaceInfo[];
  readonly schemaFields: readonly PropertyFieldDefinition[];
  readonly documents: readonly PublicSiteDocSummary[];
  readonly activeDocument?: PublicSiteDocDetail | undefined;
}

export interface PublicSiteDocumentPayload {
  readonly site: PublicSiteMeta;
  readonly spaces: readonly PublicSiteSpaceInfo[];
  readonly schemaFields: readonly PropertyFieldDefinition[];
  readonly documents: readonly PublicSiteDocSummary[];
  readonly document: PublicSiteDocDetail;
}
