import { z } from "zod";
import {
  ID_PREFIXES,
  documentIdSchema,
  idSchema,
  outlineNodeIdSchema,
  threadBindingIdSchema,
  type DocumentId,
  type OutlineNodeId,
  type ThreadBindingId,
  type WorkspaceId,
} from "../ids.ts";
import {
  DEFAULT_HOST_KIND,
  adeKindSchema,
  adeThreadStatusSchema,
  isoTimestampSchema,
  type AdeKind,
  type AdeThreadStatus,
} from "./common.ts";
import { diffPreviewSchema } from "./document.ts";

export const selectionAnchorSchema = z.object({
  quote: z.string().min(1),
  headingSlug: z.string().min(1).optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
});
export type SelectionAnchor = z.infer<typeof selectionAnchorSchema>;

export const agentStepSourceSchema = z.object({
  label: z.string().min(1).max(300),
  kind: z.string().min(1).max(64).optional(),
});
export type AgentStepSource = z.infer<typeof agentStepSourceSchema>;

export const AGENT_STEP_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type AgentStepStatus = (typeof AGENT_STEP_STATUSES)[number];
export const agentStepStatusSchema = z.enum(AGENT_STEP_STATUSES);

export const agentStepItemSchema = z.object({
  id: idSchema(ID_PREFIXES.agentStep, { enforcePrefix: false, maxLength: 120 }),
  label: z.string().min(1).max(400),
  status: agentStepStatusSchema,
  durationMs: z.number().int().nonnegative().nullable().optional(),
  sources: z.array(agentStepSourceSchema).optional(),
});
export type AgentStepItem = z.infer<typeof agentStepItemSchema>;

export const AGENT_APPROVAL_RISKS = ["low", "medium", "high"] as const;
export type AgentApprovalRisk = (typeof AGENT_APPROVAL_RISKS)[number];
export const agentApprovalRiskSchema = z.enum(AGENT_APPROVAL_RISKS);

export const AGENT_APPROVAL_DECISIONS = ["approved", "denied", "adjusted"] as const;
export type AgentApprovalDecision = (typeof AGENT_APPROVAL_DECISIONS)[number];
export const agentApprovalDecisionSchema = z.enum(AGENT_APPROVAL_DECISIONS);

export const HUMAN_DECISION_URGENCIES = ["normal", "high"] as const;
export type HumanDecisionUrgency = (typeof HUMAN_DECISION_URGENCIES)[number];
export const humanDecisionUrgencySchema = z.enum(HUMAN_DECISION_URGENCIES);

export const AGENT_PENDING_REQUEST_KINDS = ["approval", "blocking_question"] as const;
export type AgentPendingRequestKind = (typeof AGENT_PENDING_REQUEST_KINDS)[number];
export const agentPendingRequestKindSchema = z.enum(AGENT_PENDING_REQUEST_KINDS);

export const agentPendingApprovalSchema = z.object({
  id: idSchema(ID_PREFIXES.approval, { enforcePrefix: false, maxLength: 120 }),
  action: z.string().min(1).max(300),
  risk: agentApprovalRiskSchema,
  requestKind: agentPendingRequestKindSchema.optional(),
  question: z.string().trim().min(1).max(1000).optional(),
  context: z.string().trim().max(4000).optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(8).optional(),
  urgency: humanDecisionUrgencySchema.optional(),
  diffPreview: diffPreviewSchema.nullable().optional(),
  expiresAt: isoTimestampSchema.nullable().optional(),
  decision: agentApprovalDecisionSchema.nullable().optional(),
  decisionNote: z.string().max(1000).nullable().optional(),
  decidedAt: isoTimestampSchema.nullable().optional(),
});
export type AgentPendingApproval = z.infer<typeof agentPendingApprovalSchema>;

export const AGENT_STEERING_MODES = ["queued", "interrupt"] as const;
export type AgentSteeringMode = (typeof AGENT_STEERING_MODES)[number];
export const agentSteeringModeSchema = z.enum(AGENT_STEERING_MODES);

export const agentSteeringNoteSchema = z.object({
  id: idSchema(ID_PREFIXES.steeringNote, { enforcePrefix: false, maxLength: 120 }),
  text: z.string().trim().min(1).max(4000),
  mode: agentSteeringModeSchema,
  createdAt: isoTimestampSchema,
  deliveredAt: isoTimestampSchema.nullable().optional(),
});
export type AgentSteeringNote = z.infer<typeof agentSteeringNoteSchema>;

export interface AdeThreadBinding {
  readonly id: ThreadBindingId;
  readonly workspaceId: WorkspaceId;
  readonly documentId: DocumentId;
  readonly nodeId: OutlineNodeId | null;
  readonly selectionAnchor: SelectionAnchor | null;
  readonly adeKind: AdeKind;
  readonly externalWorkspaceId: string | null;
  readonly externalThreadId: string;
  readonly deepLink: string | null;
  readonly title: string;
  readonly status: AdeThreadStatus;
  readonly lastSummary: string | null;
  readonly unreadResult: boolean;
  readonly lastSyncedAt: string;
  readonly createdAt: string;
  readonly runningSince?: string | null | undefined;
  readonly parentBindingId?: ThreadBindingId | null | undefined;
  readonly progressSteps?: readonly AgentStepItem[] | undefined;
  readonly pendingApproval?: AgentPendingApproval | null | undefined;
  readonly steeringQueue?: readonly AgentSteeringNote[] | undefined;
}

export const createThreadBindingInputSchema = z.object({
  documentId: documentIdSchema,
  nodeId: outlineNodeIdSchema.nullable().default(null),
  selectionAnchor: selectionAnchorSchema.nullable().optional(),
  adeKind: adeKindSchema.default(DEFAULT_HOST_KIND),
  externalWorkspaceId: z.string().min(1).nullable().optional(),
  externalThreadId: z.string().min(1),
  deepLink: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(300),
  status: adeThreadStatusSchema.default("queued"),
  runningSince: isoTimestampSchema.nullable().optional(),
  lastSummary: z.string().nullable().optional(),
  unreadResult: z.boolean().default(false),
  parentBindingId: threadBindingIdSchema.nullable().optional(),
  progressSteps: z.array(agentStepItemSchema).max(100).optional(),
  pendingApproval: agentPendingApprovalSchema.nullable().optional(),
  steeringQueue: z.array(agentSteeringNoteSchema).max(100).optional(),
});
export type CreateThreadBindingInput = z.input<typeof createThreadBindingInputSchema>;
export type ParsedCreateThreadBindingInput = z.infer<typeof createThreadBindingInputSchema>;

export const updateThreadBindingInputSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  status: adeThreadStatusSchema.optional(),
  runningSince: isoTimestampSchema.nullable().optional(),
  deepLink: z.string().min(1).nullable().optional(),
  lastSummary: z.string().nullable().optional(),
  unreadResult: z.boolean().optional(),
  lastSyncedAt: isoTimestampSchema.optional(),
  parentBindingId: threadBindingIdSchema.nullable().optional(),
  progressSteps: z.array(agentStepItemSchema).max(100).optional(),
  pendingApproval: agentPendingApprovalSchema.nullable().optional(),
  steeringQueue: z.array(agentSteeringNoteSchema).max(100).optional(),
});
export type UpdateThreadBindingInput = z.infer<typeof updateThreadBindingInputSchema>;

export const claimThreadBindingInputSchema = z.object({
  adeKind: adeKindSchema.optional(),
  externalThreadId: z.string().min(1),
  externalWorkspaceId: z.string().min(1).nullable().optional(),
  deepLink: z.string().min(1).nullable().optional(),
  status: adeThreadStatusSchema.optional(),
  lastSummary: z.string().nullable().optional(),
});
export type ClaimThreadBindingInput = z.infer<typeof claimThreadBindingInputSchema>;
