import type {
  AckWakeEventInput,
  AdeThreadBinding,
  ApproveThreadBindingInput,
  BridgeSessionRecord,
  ClaimThreadBindingInput,
  CreateThreadBindingInput,
  HeartbeatBridgeSessionInput,
  InkadeToolArgsMap,
  ListBridgeSessionsInput,
  PollWakeEventsInput,
  SteerThreadBindingRequestInput,
  ThreadBindingId,
  UpdateThreadBindingInput,
  WakeEnvelope,
  WakeEventId,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";
import type { ThreadBindingListFilter } from "../query-keys.ts";

export type ListThreadBindingsParams = ThreadBindingListFilter;

export interface ThreadBindingsResource {
  list(params?: ListThreadBindingsParams): Promise<readonly AdeThreadBinding[]>;
  get(
    bindingId: ThreadBindingId,
    options?: { readonly consumeSteering?: boolean | undefined },
  ): Promise<AdeThreadBinding>;
  upsert(input: CreateThreadBindingInput): Promise<AdeThreadBinding>;
  update(bindingId: ThreadBindingId, input: UpdateThreadBindingInput): Promise<AdeThreadBinding>;
  claim(bindingId: ThreadBindingId, input: ClaimThreadBindingInput): Promise<AdeThreadBinding>;
  approve(bindingId: ThreadBindingId, input: ApproveThreadBindingInput): Promise<AdeThreadBinding>;
  steer(
    bindingId: ThreadBindingId,
    input: SteerThreadBindingRequestInput,
  ): Promise<AdeThreadBinding>;
  requestDecision(
    input: InkadeToolArgsMap["request_human_decision"],
  ): Promise<{ readonly binding: AdeThreadBinding; readonly questionId: string }>;
  delete(bindingId: ThreadBindingId): Promise<void>;
  heartbeatBridgeSession(input: HeartbeatBridgeSessionInput): Promise<BridgeSessionRecord>;
  listBridgeSessions(params?: ListBridgeSessionsInput): Promise<readonly BridgeSessionRecord[]>;
  pollWakeEvents(input?: PollWakeEventsInput): Promise<readonly WakeEnvelope[]>;
  waitWakeEvents(
    input?: PollWakeEventsInput,
    options?: { readonly signal?: AbortSignal | undefined },
  ): Promise<readonly WakeEnvelope[]>;
  ackWakeEvent(wakeId: WakeEventId, input?: AckWakeEventInput): Promise<WakeEnvelope>;
}

export function createThreadBindingsResource(
  transport: InkadeHttpTransport,
): ThreadBindingsResource {
  return {
    async list(params = {}) {
      const query = buildQuery({
        documentId: params.documentId,
        nodeId: params.nodeId,
        status: params.status,
      });
      const res = await transport.requestJson<{ readonly bindings: readonly AdeThreadBinding[] }>(
        `/api/v1/thread-bindings${query}`,
      );
      return res.bindings;
    },

    async get(bindingId, options) {
      const query = buildQuery({
        consumeSteering: options?.consumeSteering ? "true" : undefined,
      });
      const res = await transport.requestJson<{ readonly binding: AdeThreadBinding }>(
        `/api/v1/thread-bindings/${encodeURIComponent(bindingId)}${query}`,
      );
      return res.binding;
    },

    async upsert(input) {
      const res = await transport.requestJson<{ readonly binding: AdeThreadBinding }>(
        "/api/v1/thread-bindings",
        {
          method: "POST",
          body: JSON.stringify({
            nodeId: null,
            status: "queued",
            unreadResult: false,
            ...input,
          }),
        },
      );
      return res.binding;
    },

    async update(bindingId, input) {
      const res = await transport.requestJson<{ readonly binding: AdeThreadBinding }>(
        `/api/v1/thread-bindings/${encodeURIComponent(bindingId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.binding;
    },

    async claim(bindingId, input) {
      const res = await transport.requestJson<{ readonly binding: AdeThreadBinding }>(
        `/api/v1/thread-bindings/${encodeURIComponent(bindingId)}/claim`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.binding;
    },

    async approve(bindingId, input) {
      const res = await transport.requestJson<{ readonly binding: AdeThreadBinding }>(
        `/api/v1/thread-bindings/${encodeURIComponent(bindingId)}/approve`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.binding;
    },

    async steer(bindingId, input) {
      const res = await transport.requestJson<{ readonly binding: AdeThreadBinding }>(
        `/api/v1/thread-bindings/${encodeURIComponent(bindingId)}/steer`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.binding;
    },

    requestDecision(input) {
      return transport.requestJson<{ readonly binding: AdeThreadBinding; readonly questionId: string }>(
        "/api/v1/thread-bindings/request-decision",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    async delete(bindingId) {
      await transport.requestJson<{ readonly deleted: boolean }>(
        `/api/v1/thread-bindings/${encodeURIComponent(bindingId)}`,
        { method: "DELETE" },
      );
    },

    async heartbeatBridgeSession(input) {
      const res = await transport.requestJson<{ readonly session: BridgeSessionRecord }>(
        "/api/v1/wake/sessions/heartbeat",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.session;
    },

    async listBridgeSessions(params = {}) {
      const query = buildQuery({
        status: params.status,
        harnessName: params.harnessName,
        adeKind: params.adeKind,
        includeOffline: params.includeOffline,
      });
      const res = await transport.requestJson<{
        readonly sessions: readonly BridgeSessionRecord[];
      }>(`/api/v1/wake/sessions${query}`);
      return res.sessions;
    },

    async pollWakeEvents(input = {}) {
      const res = await transport.requestJson<{ readonly wakes: readonly WakeEnvelope[] }>(
        "/api/v1/wake/poll",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.wakes;
    },

    async waitWakeEvents(input = {}, options) {
      const query = buildQuery({
        adeKind: input.adeKind,
        externalThreadId: input.externalThreadId,
        workspacePath: input.workspacePath,
        bindingId: input.bindingId,
        documentId: input.documentId,
        limit: input.limit,
        timeoutMs: input.timeoutMs,
        markDelivered: input.markDelivered,
      });
      const res = await transport.requestJson<{ readonly wakes: readonly WakeEnvelope[] }>(
        `/api/v1/wake/wait${query}`,
        options?.signal ? { signal: options.signal } : {},
      );
      return res.wakes;
    },

    async ackWakeEvent(wakeId, input = {}) {
      const res = await transport.requestJson<{ readonly wake: WakeEnvelope }>(
        `/api/v1/wake/${encodeURIComponent(wakeId)}/ack`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.wake;
    },
  };
}
