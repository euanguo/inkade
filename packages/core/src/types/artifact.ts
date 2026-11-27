import { z } from "zod";
import {
  attachmentIdSchema,
  documentArtifactIdSchema,
  documentIdSchema,
  type AttachmentId,
  type DocumentArtifactId,
  type DocumentId,
  type WorkspaceId,
} from "../ids.ts";
import {
  ARTIFACT_HTML_MAX_BYTES,
  type SandboxIsolationMode,
} from "../sandbox-origin.ts";
import type { ViewQueryResponse } from "./property-schema.ts";

export const ARTIFACT_MIN_HEIGHT_PX = 160;
export const ARTIFACT_MAX_HEIGHT_PX = 1200;
export const ARTIFACT_DEFAULT_HEIGHT_PX = 420;

export const artifactNetworkCapabilitySchema = z.union([
  z.literal("none"),
  z
    .array(
      z
        .string()
        .trim()
        .url()
        .refine((raw) => raw.startsWith("https://"), {
          message: "Allowed network origins must use https://",
        }),
    )
    .max(20),
]);

export const artifactCapabilitiesSchema = z.object({
  theme: z.boolean().optional(),
  sources: z.boolean().optional(),
  comment: z.boolean().optional(),
  network: artifactNetworkCapabilitySchema.optional(),
});

export type ArtifactCapabilities = z.infer<typeof artifactCapabilitiesSchema>;

export const artifactSourceMetaSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("inkade_view"),
    label: z.string().trim().min(1).max(200).optional(),
    query: z.record(z.string(), z.unknown()),
    refreshedAt: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({
    kind: z.literal("attachment"),
    label: z.string().trim().min(1).max(200).optional(),
    attachmentId: attachmentIdSchema,
    filename: z.string().trim().min(1).max(300).optional(),
    mimeType: z.string().trim().min(1).max(160).optional(),
    refreshedAt: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({
    kind: z.literal("document"),
    label: z.string().trim().min(1).max(200).optional(),
    documentId: documentIdSchema,
    title: z.string().trim().min(1).max(300).optional(),
    refreshedAt: z.string().trim().min(1).max(80).optional(),
  }),
]);

export type ArtifactSourceMeta = z.infer<typeof artifactSourceMetaSchema>;

export const artifactCapabilitiesArraySchema = z.array(artifactSourceMetaSchema).max(50);

export interface DocumentArtifact {
  readonly id: DocumentArtifactId;
  readonly workspaceId: WorkspaceId;
  readonly documentId: DocumentId;
  readonly title: string;
  readonly htmlSource: string;
  readonly capabilities: ArtifactCapabilities;
  readonly sources: readonly ArtifactSourceMeta[];
  readonly fallbackMarkdown: string;
  readonly heightPx: number;
  readonly sha256: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface DocumentArtifactSummary {
  readonly id: DocumentArtifactId;
  readonly workspaceId: WorkspaceId;
  readonly documentId: DocumentId;
  readonly title: string;
  readonly capabilities: ArtifactCapabilities;
  readonly sources: readonly ArtifactSourceMeta[];
  readonly fallbackMarkdown: string;
  readonly heightPx: number;
  readonly sha256: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const createDocumentArtifactInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  htmlSource: z.string().min(1).max(ARTIFACT_HTML_MAX_BYTES * 2),
  capabilities: artifactCapabilitiesSchema.default({}),
  sources: z.array(artifactSourceMetaSchema).max(50).default([]),
  fallbackMarkdown: z.string().trim().min(1).max(200000),
  heightPx: z
    .number()
    .int()
    .min(ARTIFACT_MIN_HEIGHT_PX)
    .max(ARTIFACT_MAX_HEIGHT_PX)
    .default(ARTIFACT_DEFAULT_HEIGHT_PX),
  appendFenceToDocument: z.boolean().optional(),
});

export type CreateDocumentArtifactInput = z.input<typeof createDocumentArtifactInputSchema>;
export type ParsedCreateDocumentArtifactInput = z.infer<typeof createDocumentArtifactInputSchema>;

export const updateDocumentArtifactInputSchema = z.object({
  ifMatchSha256: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  htmlSource: z.string().min(1).max(ARTIFACT_HTML_MAX_BYTES * 2).optional(),
  capabilities: artifactCapabilitiesSchema.optional(),
  sources: z.array(artifactSourceMetaSchema).max(50).optional(),
  fallbackMarkdown: z.string().trim().min(1).max(200000).optional(),
  heightPx: z.number().int().min(ARTIFACT_MIN_HEIGHT_PX).max(ARTIFACT_MAX_HEIGHT_PX).optional(),
});

export type UpdateDocumentArtifactInput = z.input<typeof updateDocumentArtifactInputSchema>;
export type ParsedUpdateDocumentArtifactInput = z.infer<typeof updateDocumentArtifactInputSchema>;

export const validateDocumentArtifactInputSchema = z.object({
  htmlSource: z.string().min(1).max(ARTIFACT_HTML_MAX_BYTES * 2),
  capabilities: artifactCapabilitiesSchema.default({}),
});

export type ValidateDocumentArtifactInput = z.input<typeof validateDocumentArtifactInputSchema>;
export type ParsedValidateDocumentArtifactInput = z.infer<
  typeof validateDocumentArtifactInputSchema
>;

export const submitArtifactCommentInputSchema = z.object({
  handoffNote: z.string().trim().min(1).max(4000),
  authorName: z.string().trim().min(1).max(120).optional(),
});

export type SubmitArtifactCommentInput = z.input<typeof submitArtifactCommentInputSchema>;

export interface ArtifactSandboxTicket {
  readonly ticket: string;
  readonly sandboxUrl: string;
  readonly sandboxOrigin: string;
  readonly appOrigin: string;
  readonly mode: SandboxIsolationMode;
  readonly sameSite: boolean;
  readonly expiresAt: string;
  readonly ttlSeconds: number;
  readonly artifactId: DocumentArtifactId;
  readonly documentId: DocumentId;
  readonly title: string;
  readonly heightPx: number;
  readonly capabilities: ArtifactCapabilities;
  readonly sources: readonly ArtifactSourceMeta[];
  readonly fallbackMarkdown: string;
  readonly sha256: string;
}

export type ResolvedArtifactSourceSnapshot =
  | {
      readonly kind: "inkade_view";
      readonly label?: string | undefined;
      readonly refreshedAt: string;
      readonly query: Record<string, unknown>;
      readonly data: ViewQueryResponse;
    }
  | {
      readonly kind: "attachment";
      readonly label?: string | undefined;
      readonly refreshedAt: string;
      readonly attachmentId: AttachmentId;
      readonly filename?: string | undefined;
      readonly mimeType?: string | undefined;
      readonly textContent?: string | undefined;
      readonly jsonContent?: unknown;
      readonly error?: string | undefined;
    }
  | {
      readonly kind: "document";
      readonly label?: string | undefined;
      readonly refreshedAt: string;
      readonly documentId: DocumentId;
      readonly title?: string | undefined;
      readonly excerpt?: string | undefined;
      readonly tags?: readonly string[] | undefined;
      readonly error?: string | undefined;
    };

export interface ArtifactSandboxResolvedPayload {
  readonly artifactId: DocumentArtifactId;
  readonly documentId: DocumentId;
  readonly title: string;
  readonly htmlSource: string;
  readonly capabilities: ArtifactCapabilities;
  readonly sources: readonly ResolvedArtifactSourceSnapshot[];
  readonly fallbackMarkdown: string;
  readonly heightPx: number;
  readonly sha256: string;
  readonly appOrigin: string;
  readonly sandboxOrigin: string;
  readonly cspHeader: string;
  readonly mode: SandboxIsolationMode;
  readonly sameSite: boolean;
}

export interface SandboxRuntimeConfigStatus {
  readonly mode: SandboxIsolationMode;
  readonly appOrigin: string;
  readonly sandboxOriginPattern: string;
  readonly sameSite: boolean;
  readonly allowedNetworkOrigins: readonly string[];
  readonly hostCookiePrefixEnabled: boolean;
}

export const INKADE_ARTIFACT_CHANNEL = "inkade.artifact.v1" as const;

export const artifactIdParamSchema = documentArtifactIdSchema;
