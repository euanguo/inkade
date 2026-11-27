import { z } from "zod";
import { spaceIdSchema, type TemplateId, type WorkspaceId } from "../ids.ts";
import { dailyDateSchema, documentKindSchema, type DocumentKind } from "./common.ts";

export interface DocumentTemplate {
  readonly id: TemplateId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly kind: DocumentKind;
  readonly description: string;
  readonly contentMarkdown: string;
  readonly isDefaultDaily: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const createDocumentTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: documentKindSchema,
  description: z.string().trim().max(500).default(""),
  contentMarkdown: z.string().default(""),
  isDefaultDaily: z.boolean().default(false),
});
export type CreateDocumentTemplateInput = z.input<typeof createDocumentTemplateInputSchema>;
export type ParsedCreateDocumentTemplateInput = z.infer<typeof createDocumentTemplateInputSchema>;

export const updateDocumentTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: documentKindSchema.optional(),
  description: z.string().trim().max(500).optional(),
  contentMarkdown: z.string().optional(),
  isDefaultDaily: z.boolean().optional(),
});
export type UpdateDocumentTemplateInput = z.infer<typeof updateDocumentTemplateInputSchema>;

export const applyDocumentTemplateInputSchema = z.object({
  spaceId: spaceIdSchema.optional(),
  title: z.string().trim().min(1).max(300).optional(),
  dailyDate: dailyDateSchema.optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  variables: z.record(z.string(), z.string()).optional(),
});
export type ApplyDocumentTemplateInput = z.infer<typeof applyDocumentTemplateInputSchema>;
