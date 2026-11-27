import { z } from "zod";
import { selectionAnchorSchema } from "./types/index.ts";

export const INKADE_EMBED_PROTOCOL = "inkade.embed.v1" as const;

export const EMBED_HOST_CAPABILITIES = [
  "spawn_thread",
  "open_thread",
  "pick_project",
  "copy_clipboard",
  "open_external_url",
] as const;

export type EmbedHostCapability = (typeof EMBED_HOST_CAPABILITIES)[number];
export const embedHostCapabilitySchema = z.enum(EMBED_HOST_CAPABILITIES);

export const embedHostThemeSchema = z.enum(["light", "dark", "system"]);
export type EmbedHostTheme = z.infer<typeof embedHostThemeSchema>;

export const embedProjectContextSchema = z.object({
  repoName: z.string().optional(),
  gitRemote: z.string().optional(),
  localPath: z.string().optional(),
});
export type EmbedProjectContext = z.infer<typeof embedProjectContextSchema>;

export const hostHelloPayloadSchema = z.object({
  hostId: z.string().trim().min(1).max(64),
  hostName: z.string().trim().min(1).max(120).optional(),
  capabilities: z.array(embedHostCapabilitySchema).default([]),
  theme: embedHostThemeSchema.optional(),
  cssVars: z.record(z.string(), z.string()).optional(),
  projectContext: embedProjectContextSchema.optional(),
});
export type HostHelloPayload = z.infer<typeof hostHelloPayloadSchema>;

export const hostNavigatePayloadSchema = z.object({
  path: z.string().trim().min(1).max(2048),
});
export type HostNavigatePayload = z.infer<typeof hostNavigatePayloadSchema>;

export const hostThemeChangedPayloadSchema = z.object({
  theme: embedHostThemeSchema,
});
export type HostThemeChangedPayload = z.infer<typeof hostThemeChangedPayloadSchema>;

export const hostContextChangedPayloadSchema = embedProjectContextSchema;
export type HostContextChangedPayload = z.infer<typeof hostContextChangedPayloadSchema>;

export const hostResponsePayloadSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type HostResponsePayload = z.infer<typeof hostResponsePayloadSchema>;

export const hostGotoAnchorPayloadSchema = z.object({
  documentId: z.string().trim().min(1),
  headingSlug: z.string().trim().min(1).optional(),
  nodeId: z.string().trim().min(1).optional(),
  highlightId: z.string().trim().min(1).optional(),
});
export type HostGotoAnchorPayload = z.infer<typeof hostGotoAnchorPayloadSchema>;

export const hostToInkadeMessageSchema = z.discriminatedUnion("type", [
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("host.hello"),
    requestId: z.string().min(1).optional(),
    payload: hostHelloPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("host.navigate"),
    requestId: z.string().min(1).optional(),
    payload: hostNavigatePayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("host.goto_anchor"),
    requestId: z.string().min(1).optional(),
    payload: hostGotoAnchorPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("host.theme_changed"),
    requestId: z.string().min(1).optional(),
    payload: hostThemeChangedPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("host.context_changed"),
    requestId: z.string().min(1).optional(),
    payload: hostContextChangedPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("host.response"),
    requestId: z.string().min(1),
    payload: hostResponsePayloadSchema,
  }),
]);
export type HostToInkadeMessage = z.infer<typeof hostToInkadeMessageSchema>;

export const inkadeReadyPayloadSchema = z.object({
  version: z.string().min(1),
  currentPath: z.string().min(1),
});
export type InkadeReadyPayload = z.infer<typeof inkadeReadyPayloadSchema>;

export const inkadeRouteChangedPayloadSchema = z.object({
  path: z.string().min(1),
  documentId: z.string().optional(),
  spaceId: z.string().optional(),
  dailyDate: z.string().optional(),
});
export type InkadeRouteChangedPayload = z.infer<typeof inkadeRouteChangedPayloadSchema>;

export const inkadeStatusChangedPayloadSchema = z.object({
  waitingCount: z.number().int().nonnegative(),
  unreadDocsCount: z.number().int().nonnegative(),
  activeToolCalls: z.number().int().nonnegative(),
});
export type InkadeStatusChangedPayload = z.infer<typeof inkadeStatusChangedPayloadSchema>;

export const inkadeRequestSpawnThreadPayloadSchema = z.object({
  documentId: z.string().min(1),
  documentTitle: z.string().min(1),
  nodeId: z.string().nullable().optional(),
  selectionAnchor: selectionAnchorSchema.nullable().optional(),
  prompt: z.string().min(1),
  title: z.string().min(1),
  projectRuleId: z.string().optional(),
});
export type InkadeRequestSpawnThreadPayload = z.infer<typeof inkadeRequestSpawnThreadPayloadSchema>;

export const inkadeBridgeBindingRefSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().optional(),
  documentId: z.string().min(1),
  nodeId: z.string().nullable().optional(),
  adeKind: z.string().min(1),
  externalWorkspaceId: z.string().nullable().optional(),
  externalThreadId: z.string().min(1),
  deepLink: z.string().nullable().optional(),
  title: z.string().min(1),
  status: z.string().min(1),
});
export type InkadeBridgeBindingRef = z.infer<typeof inkadeBridgeBindingRefSchema>;

export const inkadeRequestOpenThreadPayloadSchema = z.object({
  binding: inkadeBridgeBindingRefSchema,
});
export type InkadeRequestOpenThreadPayload = z.infer<typeof inkadeRequestOpenThreadPayloadSchema>;

export const inkadeRequestCopyPayloadSchema = z.object({
  text: z.string(),
});
export type InkadeRequestCopyPayload = z.infer<typeof inkadeRequestCopyPayloadSchema>;

export const inkadeRequestOpenUrlPayloadSchema = z.object({
  url: z.string().min(1),
});
export type InkadeRequestOpenUrlPayload = z.infer<typeof inkadeRequestOpenUrlPayloadSchema>;

export const EMBED_SAVE_STATES = [
  "saved",
  "saving",
  "unsaved",
  "reconnecting",
  "readonly",
] as const;
export type EmbedSaveState = (typeof EMBED_SAVE_STATES)[number];
export const embedSaveStateSchema = z.enum(EMBED_SAVE_STATES);

export const inkadeSaveStateChangedPayloadSchema = z.object({
  state: embedSaveStateSchema,
  leaveLosesWork: z.boolean(),
});
export type InkadeSaveStateChangedPayload = z.infer<typeof inkadeSaveStateChangedPayloadSchema>;

export const inkadePlaceChangedPayloadSchema = z.object({
  documentId: z.string().min(1),
  headingSlug: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  highlightId: z.string().min(1).optional(),
});
export type InkadePlaceChangedPayload = z.infer<typeof inkadePlaceChangedPayloadSchema>;

export const inkadeToHostMessageSchema = z.discriminatedUnion("type", [
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("inkade.ready"),
    requestId: z.string().min(1).optional(),
    payload: inkadeReadyPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("inkade.route_changed"),
    requestId: z.string().min(1).optional(),
    payload: inkadeRouteChangedPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("inkade.status_changed"),
    requestId: z.string().min(1).optional(),
    payload: inkadeStatusChangedPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("inkade.save_state_changed"),
    requestId: z.string().min(1).optional(),
    payload: inkadeSaveStateChangedPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("inkade.place_changed"),
    requestId: z.string().min(1).optional(),
    payload: inkadePlaceChangedPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("inkade.request.spawn_thread"),
    requestId: z.string().min(1),
    payload: inkadeRequestSpawnThreadPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("inkade.request.open_thread"),
    requestId: z.string().min(1),
    payload: inkadeRequestOpenThreadPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("inkade.request.copy"),
    requestId: z.string().min(1),
    payload: inkadeRequestCopyPayloadSchema,
  }),
  z.object({
    protocol: z.literal(INKADE_EMBED_PROTOCOL),
    type: z.literal("inkade.request.open_url"),
    requestId: z.string().min(1),
    payload: inkadeRequestOpenUrlPayloadSchema,
  }),
]);
export type InkadeToHostMessage = z.infer<typeof inkadeToHostMessageSchema>;

export const embedTicketResponseSchema = z.object({
  ticket: z.string().min(1),
  expiresAt: z.string().min(1),
  ttlSeconds: z.number().int().positive(),
  embedSessionId: z.string().min(1).optional(),
});
export type EmbedTicketResponse = z.infer<typeof embedTicketResponseSchema>;

export const embedTicketExchangeInputSchema = z.object({
  ticket: z.string().trim().min(1).max(512),
});
export type EmbedTicketExchangeInput = z.infer<typeof embedTicketExchangeInputSchema>;

export const embedTicketExchangeResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
  embedSessionId: z.string().min(1).optional(),
});
export type EmbedTicketExchangeResponse = z.infer<typeof embedTicketExchangeResponseSchema>;

export const embedCommandInputSchema = z.object({
  embedSessionId: z.string().trim().min(1).max(160).optional(),
  message: hostToInkadeMessageSchema,
});
export type EmbedCommandInput = z.infer<typeof embedCommandInputSchema>;

export const embedShellEventInputSchema = z.object({
  embedSessionId: z.string().trim().min(1).max(160).optional(),
  message: inkadeToHostMessageSchema,
});
export type EmbedShellEventInput = z.infer<typeof embedShellEventInputSchema>;

export function parseHostToInkadeMessage(raw: unknown): HostToInkadeMessage | null {
  if (!raw || typeof raw !== "object") return null;
  if ((raw as Record<string, unknown>)["protocol"] !== INKADE_EMBED_PROTOCOL) return null;
  const parsed = hostToInkadeMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseInkadeToHostMessage(raw: unknown): InkadeToHostMessage | null {
  if (!raw || typeof raw !== "object") return null;
  if ((raw as Record<string, unknown>)["protocol"] !== INKADE_EMBED_PROTOCOL) return null;
  const parsed = inkadeToHostMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
