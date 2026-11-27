import { z } from "zod";
import {
  adeKindSchema,
  adeThreadStatusSchema,
  asDocumentId,
  asOutlineNodeId,
  asSpaceId,
  asThreadBindingId,
  bridgeSessionStatusSchema,
  documentKindSchema,
  searchQueryInputSchema,
  templateIdSchema,
} from "@inkade/core";

export const booleanQuerySchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const listSpacesQuerySchema = z.object({
  includeArchived: booleanQuerySchema.optional(),
});

export const listDocumentsQuerySchema = z.object({
  spaceId: z.string().min(1).transform(asSpaceId).optional(),
  kind: documentKindSchema.optional(),
  tag: z.string().min(1).optional(),
  pinnedOnly: booleanQuerySchema.optional(),
  includeTrashed: booleanQuerySchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const deleteDocumentQuerySchema = z.object({
  hard: booleanQuerySchema.optional(),
});

export const exportDocumentQuerySchema = z.object({
  format: z.enum(["markdown", "md", "docx"]).default("markdown"),
});

export const revisionDiffQuerySchema = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

export const listThreadBindingsQuerySchema = z.object({
  documentId: z.string().min(1).transform(asDocumentId).optional(),
  nodeId: z.string().min(1).transform(asOutlineNodeId).optional(),
  status: adeThreadStatusSchema.optional(),
});

export const searchRouteQuerySchema = z.object({
  q: searchQueryInputSchema.shape.q,
  spaceId: z.string().min(1).transform(asSpaceId).optional(),
  kind: documentKindSchema.optional(),
  tag: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const rolloverOutlineNodesBodySchema = z.object({
  fromDocumentId: z.string().min(1).transform(asDocumentId),
  toDocumentId: z.string().min(1).transform(asDocumentId),
});

export const promoteOutlineNodeBodySchema = z.object({
  documentId: z.string().min(1).transform(asDocumentId).optional(),
  targetSpaceId: z.string().min(1).transform(asSpaceId),
  title: z.string().trim().min(1).max(300).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  keepLinkInNode: z.boolean().optional(),
});

export const setupOwnerBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
});

export const attachmentJsonBodySchema = z.object({
  documentId: z.string().min(1).transform(asDocumentId).nullable().optional(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160).default("application/octet-stream"),
  contentBase64: z.string().min(1),
});

export const listAttachmentsQuerySchema = z.object({
  documentId: z.string().min(1).transform(asDocumentId).optional(),
  orphanOnly: booleanQuerySchema.optional(),
});

export const documentGraphQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(2).default(2),
});

export const relatedDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const listTemplatesQuerySchema = z.object({
  kind: documentKindSchema.optional(),
});

export const listShareLinksQuerySchema = z.object({
  documentId: z.string().min(1).transform(asDocumentId).optional(),
});

export const spaceSchemaQuerySchema = z.object({
  templateId: templateIdSchema.optional(),
});

export const listBridgeSessionsQuerySchema = z.object({
  status: bridgeSessionStatusSchema.optional(),
  harnessName: z.string().trim().min(1).max(120).optional(),
  adeKind: adeKindSchema.optional(),
  includeOffline: booleanQuerySchema.optional(),
});

export const waitWakeEventsQuerySchema = z.object({
  adeKind: adeKindSchema.optional(),
  externalThreadId: z.string().trim().min(1).max(300).optional(),
  workspacePath: z.string().trim().min(1).max(1000).optional(),
  bindingId: z.string().min(1).transform(asThreadBindingId).optional(),
  documentId: z.string().min(1).transform(asDocumentId).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  timeoutMs: z.coerce.number().int().min(0).max(30000).optional(),
  markDelivered: booleanQuerySchema.optional(),
});
