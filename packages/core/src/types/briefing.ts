import { z } from "zod";
import {
  apiTokenIdSchema,
  contextPackIdSchema,
  spaceIdSchema,
  threadBindingIdSchema,
  type ApiTokenId,
  type AuditBatchId,
  type BriefingJobId,
  type BriefingRunId,
  type ContextPackId,
  type DocumentId,
  type OutlineNodeId,
  type SpaceId,
  type ThreadBindingId,
  type WorkspaceId,
} from "../ids.ts";
import { documentKindSchema, type DocumentKind } from "./common.ts";

export const BRIEFING_EXECUTION_PATHS = ["builtin_rag", "external_ade"] as const;
export type BriefingExecutionPath = (typeof BRIEFING_EXECUTION_PATHS)[number];
export const briefingExecutionPathSchema = z.enum(BRIEFING_EXECUTION_PATHS);

export const BRIEFING_TARGET_MODES = ["daily_section", "space_article"] as const;
export type BriefingTargetMode = (typeof BRIEFING_TARGET_MODES)[number];
export const briefingTargetModeSchema = z.enum(BRIEFING_TARGET_MODES);

export const BRIEFING_RUN_STATUSES = ["succeeded", "dispatched", "failed"] as const;
export type BriefingRunStatus = (typeof BRIEFING_RUN_STATUSES)[number];
export const briefingRunStatusSchema = z.enum(BRIEFING_RUN_STATUSES);

export const BRIEFING_TRIGGER_KINDS = ["schedule", "manual"] as const;
export type BriefingTriggerKind = (typeof BRIEFING_TRIGGER_KINDS)[number];
export const briefingTriggerKindSchema = z.enum(BRIEFING_TRIGGER_KINDS);

export const DEFAULT_BRIEFING_SOURCES_CONFIG = {
  spaceIds: "*" as const,
  includeClipsLastDays: 1,
  includeRssFeeds: true,
  includeTasks: true,
  contextPackIds: [] as ContextPackId[],
  maxItemsPerSource: 10,
};

export const briefingSourcesConfigSchema = z.object({
  spaceIds: z.union([z.literal("*"), z.array(spaceIdSchema).max(50)]).default("*"),
  includeClipsLastDays: z.number().int().min(0).max(365).default(1),
  includeRssFeeds: z.boolean().default(true),
  includeTasks: z.boolean().default(true),
  contextPackIds: z.array(contextPackIdSchema).max(20).default([]),
  maxItemsPerSource: z.number().int().min(1).max(50).default(10),
});
export type BriefingSourcesConfig = z.infer<typeof briefingSourcesConfigSchema>;
export type BriefingSourcesConfigInput = z.input<typeof briefingSourcesConfigSchema>;

export const DEFAULT_BRIEFING_TARGET_CONFIG = {
  mode: "daily_section" as const,
  sectionHeading: "## Agent Briefing",
  targetSpaceId: null as SpaceId | null,
  titleTemplate: "Agent Briefing · {{date}}",
  tags: ["briefing"] as string[],
};

export const briefingTargetConfigSchema = z.object({
  mode: briefingTargetModeSchema.default("daily_section"),
  sectionHeading: z.string().trim().min(1).max(200).default("## Agent Briefing"),
  targetSpaceId: spaceIdSchema.nullable().default(null),
  titleTemplate: z.string().trim().min(1).max(200).default("Agent Briefing · {{date}}"),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).default(["briefing"]),
});
export type BriefingTargetConfig = z.infer<typeof briefingTargetConfigSchema>;
export type BriefingTargetConfigInput = z.input<typeof briefingTargetConfigSchema>;

export const briefingCitationSchema = z.object({
  index: z.number().int().positive(),
  docId: z.string().min(1) as unknown as z.ZodType<DocumentId, DocumentId>,
  title: z.string().min(1),
  kind: documentKindSchema,
  spaceId: spaceIdSchema,
  nodeId: (z.string().min(1) as unknown as z.ZodType<OutlineNodeId, OutlineNodeId>)
    .nullable()
    .optional(),
  excerpt: z.string(),
  url: z.string().optional(),
});

export const briefingCitationsArraySchema = z.array(briefingCitationSchema);

export interface BriefingCitation {
  readonly index: number;
  readonly docId: DocumentId;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly spaceId: SpaceId;
  readonly nodeId?: OutlineNodeId | null | undefined;
  readonly excerpt: string;
  readonly url?: string | undefined;
}

export interface AgentBriefingJobRecord {
  readonly id: BriefingJobId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly description: string;
  readonly cronExpr: string;
  readonly timezone: string;
  readonly executionPath: BriefingExecutionPath;
  readonly bindingId: ThreadBindingId | null;
  readonly tokenRuleId: ApiTokenId | null;
  readonly promptTemplate: string;
  readonly sources: BriefingSourcesConfig;
  readonly target: BriefingTargetConfig;
  readonly enabled: boolean;
  readonly lastRunAt: string | null;
  readonly lastStatus: BriefingRunStatus | null;
  readonly nextRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentBriefingRunRecord {
  readonly id: BriefingRunId;
  readonly jobId: BriefingJobId;
  readonly jobName: string;
  readonly workspaceId: WorkspaceId;
  readonly triggerKind: BriefingTriggerKind;
  readonly status: BriefingRunStatus;
  readonly batchId: AuditBatchId | null;
  readonly documentId: DocumentId | null;
  readonly summary: string | null;
  readonly citations: readonly BriefingCitation[];
  readonly errorMessage: string | null;
  readonly dismissedAt: string | null;
  readonly durationMs: number | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export const createBriefingJobInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).default(""),
  cronExpr: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(80).default("UTC"),
  executionPath: briefingExecutionPathSchema.default("builtin_rag"),
  bindingId: threadBindingIdSchema.nullable().optional(),
  tokenRuleId: apiTokenIdSchema.nullable().optional(),
  promptTemplate: z.string().trim().min(1).max(8000),
  sources: briefingSourcesConfigSchema.default(DEFAULT_BRIEFING_SOURCES_CONFIG),
  target: briefingTargetConfigSchema.default(DEFAULT_BRIEFING_TARGET_CONFIG),
  enabled: z.boolean().default(true),
});
export type CreateBriefingJobInput = z.input<typeof createBriefingJobInputSchema>;
export type ParsedCreateBriefingJobInput = z.infer<typeof createBriefingJobInputSchema>;

export const updateBriefingJobInputSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(500).optional(),
  cronExpr: z.string().trim().min(1).max(120).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  executionPath: briefingExecutionPathSchema.optional(),
  bindingId: threadBindingIdSchema.nullable().optional(),
  tokenRuleId: apiTokenIdSchema.nullable().optional(),
  promptTemplate: z.string().trim().min(1).max(8000).optional(),
  sources: briefingSourcesConfigSchema.optional(),
  target: briefingTargetConfigSchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateBriefingJobInput = z.infer<typeof updateBriefingJobInputSchema>;

export const runBriefingJobInputSchema = z.object({
  simulateError: z.string().trim().min(1).max(500).optional(),
});
export type RunBriefingJobInput = z.input<typeof runBriefingJobInputSchema>;

export const BRIEFING_PRESET_IDS = ["morning_clips_rss", "weekly_review"] as const;
export type BriefingPresetId = (typeof BRIEFING_PRESET_IDS)[number];

export interface BriefingPresetTemplate {
  readonly id: BriefingPresetId;
  readonly cronExpr: string;
  readonly executionPath: BriefingExecutionPath;
  readonly promptTemplate: string;
  readonly sources: BriefingSourcesConfig;
  readonly target: BriefingTargetConfig;
}

export const BRIEFING_PRESET_TEMPLATES: readonly BriefingPresetTemplate[] = [
  {
    id: "morning_clips_rss",
    cronExpr: "30 7 * * *",
    executionPath: "builtin_rag",
    promptTemplate:
      "Synthesize yesterday's captured web clips, RSS articles, and open tasks due today into a concise morning briefing with inline citations [1], [2] and clear action items.",
    sources: {
      spaceIds: "*",
      includeClipsLastDays: 1,
      includeRssFeeds: true,
      includeTasks: true,
      contextPackIds: [],
      maxItemsPerSource: 10,
    },
    target: {
      mode: "daily_section",
      sectionHeading: "## Morning Clips & RSS Briefing",
      targetSpaceId: null,
      titleTemplate: "Morning Briefing · {{date}}",
      tags: ["briefing", "morning"],
    },
  },
  {
    id: "weekly_review",
    cronExpr: "0 17 * * 5",
    executionPath: "builtin_rag",
    promptTemplate:
      "Compile a weekly knowledge synthesis across recent notes, clips, RSS feeds, and remaining open tasks with inline citations [1], [2] and next-week priorities.",
    sources: {
      spaceIds: "*",
      includeClipsLastDays: 7,
      includeRssFeeds: true,
      includeTasks: true,
      contextPackIds: [],
      maxItemsPerSource: 15,
    },
    target: {
      mode: "space_article",
      sectionHeading: "## Weekly Knowledge Review",
      targetSpaceId: null,
      titleTemplate: "Weekly Knowledge Review · {{date}}",
      tags: ["briefing", "weekly-review"],
    },
  },
];
