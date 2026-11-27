import type { QueryClient } from "@tanstack/react-query";
import type { DocumentId, InkadeEvent } from "@inkade/core";
import { useEffect, useRef, useState } from "react";
import type { FetchCredentials, FetchLike } from "../client.ts";
import { inkadeQueryKeys } from "../query-keys.ts";
import { subscribeInkadeEvents } from "../sse.ts";
import { useOptionalInkadeSdkContext } from "./provider.tsx";

export type RealtimeConnectionState = "idle" | "connecting" | "connected" | "reconnecting";

export interface ActiveAgentToolCall {
  readonly invocationId: string;
  readonly toolName: string;
  readonly tokenName: string | null;
  readonly documentId?: DocumentId | undefined;
  readonly startedAtMs: number;
}

export interface InkadeRealtimeState {
  readonly state: RealtimeConnectionState;
  readonly reconnectAttempt: number;
  readonly lastEventSeq: number | null;
  readonly activeTools: readonly ActiveAgentToolCall[];
}

export interface UseInkadeRealtimeSyncOptions {
  readonly enabled?: boolean | undefined;
  readonly baseUrl?: string | undefined;
  readonly token?: string | undefined;
  readonly credentials?: FetchCredentials | undefined;
  readonly fetch?: FetchLike | undefined;
  readonly activeToolStaleMs?: number | undefined;
  readonly onEvent?: ((event: InkadeEvent) => void) | undefined;
}

const DEFAULT_ACTIVE_TOOL_STALE_MS = 15_000;

/**
 * Pure cache-invalidation mapping for persistent Inkade SSE events.
 * Transient `agent.tool.*` activity events intentionally do not invalidate query caches.
 */
export function applyInkadeEventToQueryCache(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  event: InkadeEvent,
): void {
  const docId = event.documentId;

  switch (event.type) {
    case "agent.tool.started":
    case "agent.tool.finished":
      return;

    case "space.created":
    case "space.updated":
    case "space.archived":
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "spaces"] });
      return;

    case "space_schema.updated":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.spaceSchemas() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "space-schema"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "view-query"] });
      return;

    case "document.created":
    case "document.updated":
    case "document.trashed":
    case "document.restored":
    case "document.deleted":
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "view-query"] });
      if (docId) {
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.revisions(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.backlinks(docId) });
      }
      if (event.documentKind === "outline") {
        void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] });
      }
      return;

    case "calendar.subscription.updated":
      void queryClient.invalidateQueries({
        queryKey: inkadeQueryKeys.calendarSubscriptions(),
      });
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "calendar-events"],
      });
      return;

    case "outline.node.created":
    case "outline.node.updated":
    case "outline.node.moved":
    case "outline.node.deleted":
    case "outline.batch_mutated":
    case "outline.rolled_over":
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
      if (docId) {
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(docId) });
      }
      return;

    case "thread.binding.created":
    case "thread.binding.updated":
    case "thread.binding.claimed":
    case "thread.binding.approved":
    case "thread.binding.steered":
    case "thread.binding.deleted":
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
      });
      return;

    case "highlight.created":
    case "highlight.updated":
    case "highlight.deleted":
    case "highlight.comment.created":
    case "highlight.resolved":
      if (docId) {
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.highlights(docId) });
        void queryClient.invalidateQueries({
          queryKey: [...inkadeQueryKeys.all, "comment-threads", docId],
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "highlights"] });
        void queryClient.invalidateQueries({
          queryKey: [...inkadeQueryKeys.all, "comment-threads"],
        });
      }
      if (event.type === "highlight.comment.created") {
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.highlightComments(event.payload.comment.highlightId),
        });
      } else if (event.type === "highlight.resolved") {
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.highlightComments(event.payload.highlight.id),
        });
      }
      return;

    case "template.created":
    case "template.updated":
    case "template.deleted":
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "templates"] });
      return;

    case "share.created":
    case "share.revoked":
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "share-links"] });
      return;

    case "saved_view.created":
    case "saved_view.updated":
    case "saved_view.deleted":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.savedViews() });
      return;

    case "audit.rolled_back":
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-logs"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-batches"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.storageBuckets() });
      if (docId) {
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.revisions(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.backlinks(docId) });
        if (event.documentKind === "outline") {
          void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(docId) });
        }
      }
      if (event.documentKind === "outline") {
        void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] });
        void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
      }
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] });
      return;

    case "audit.batch_rolled_back":
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-logs"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-batches"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.storageBuckets() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
      for (const item of event.payload.items) {
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(item.documentId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.revisions(item.documentId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.backlinks(item.documentId) });
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.outlineNodes(item.documentId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] });
      return;
      return;

    case "token.updated":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.tokens() });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.whoami() });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.connectStatus() });
      return;

    case "preferences.updated":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.preferences() });
      return;

    case "context_pack.updated":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.contextPacks() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "context-pack"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.connectStatus() });
      return;

    case "document_asset.updated":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.pdfAssets() });
      void queryClient.invalidateQueries({
        queryKey: inkadeQueryKeys.pdfAsset(event.payload.assetId),
      });
      if (event.payload.companionDocumentId) {
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.pdfAssetByDocument(event.payload.companionDocumentId),
        });
      }
      return;

    case "rss_feed.updated":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.rssFeeds() });
      return;

    case "ingest_webhook.updated":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.ingestWebhooks() });
      return;

    case "import.committed":
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "spaces"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-logs"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-batches"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      return;

    case "briefing.job.updated":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] });
      return;

    case "briefing.succeeded":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-logs"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-batches"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.storageBuckets() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
      if (docId) {
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.revisions(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.backlinks(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(docId) });
      }
      return;

    case "briefing.failed":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-logs"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-batches"] });
      return;

    case "briefing.dismissed":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] });
      return;

    case "briefing.wakeup":
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "thread-bindings"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-logs"] });
      return;

    case "wake.enqueued":
    case "wake.acked":
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "thread-bindings"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "wake-events"] });
      return;

    case "bridge.session.updated":
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "bridge-sessions"] });
      return;

    case "document_artifact.updated":
      void queryClient.invalidateQueries({
        queryKey: inkadeQueryKeys.artifacts(event.payload.documentId),
      });
      void queryClient.invalidateQueries({
        queryKey: inkadeQueryKeys.artifact(event.payload.artifactId),
      });
      return;

    case "embed.shell_event":
      return;

    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function reduceActiveAgentTools(
  current: readonly ActiveAgentToolCall[],
  event: InkadeEvent,
  nowMs: number = Date.now(),
): readonly ActiveAgentToolCall[] {
  if (event.type === "agent.tool.started") {
    const { payload } = event;
    if (!payload.invocationId || !payload.toolName) {
      return current;
    }
    return [
      ...current.filter((item) => item.invocationId !== payload.invocationId),
      {
        invocationId: payload.invocationId,
        toolName: payload.toolName,
        tokenName: payload.tokenName ?? null,
        documentId: event.documentId,
        startedAtMs: nowMs,
      },
    ];
  }

  if (event.type === "agent.tool.finished") {
    const { payload } = event;
    if (!payload.invocationId) {
      return current;
    }
    return current.filter((item) => item.invocationId !== payload.invocationId);
  }

  return current;
}

export function pruneStaleAgentTools(
  current: readonly ActiveAgentToolCall[],
  staleAfterMs: number = DEFAULT_ACTIVE_TOOL_STALE_MS,
  nowMs: number = Date.now(),
): readonly ActiveAgentToolCall[] {
  const cutoff = nowMs - staleAfterMs;
  const filtered = current.filter((item) => item.startedAtMs >= cutoff);
  return filtered.length === current.length ? current : filtered;
}

/**
 * Headless zero-DOM React hook subscribing to Inkade SSE events, updating TanStack Query caches,
 * tracking reconnection attempts, and surfacing active MCP tool calls.
 */
export function useInkadeRealtimeSync(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  options: UseInkadeRealtimeSyncOptions = {},
): InkadeRealtimeState {
  const sdkContext = useOptionalInkadeSdkContext();
  const conn = sdkContext?.client.getConnectionConfig();
  const defaults = sdkContext?.sseConfig;

  const enabled = options.enabled ?? defaults?.enabled ?? true;
  const baseUrl = options.baseUrl ?? defaults?.baseUrl ?? conn?.baseUrl ?? "";
  const token = options.token ?? defaults?.token ?? conn?.token;
  const credentials = options.credentials ?? defaults?.credentials ?? conn?.credentials;
  const fetchImpl = options.fetch ?? defaults?.fetch ?? conn?.fetch;
  const staleAfterMs = options.activeToolStaleMs ?? DEFAULT_ACTIVE_TOOL_STALE_MS;

  const [state, setState] = useState<RealtimeConnectionState>(enabled ? "connecting" : "idle");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastEventSeq, setLastEventSeq] = useState<number | null>(null);
  const [activeTools, setActiveTools] = useState<readonly ActiveAgentToolCall[]>([]);
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  useEffect(() => {
    if (activeTools.length === 0) return;
    const timer = setInterval(() => {
      setActiveTools((prev) => pruneStaleAgentTools(prev, staleAfterMs));
    }, 3_000);
    return () => clearInterval(timer);
  }, [activeTools.length, staleAfterMs]);

  useEffect(() => {
    if (!enabled) {
      setState("idle");
      setActiveTools([]);
      return;
    }

    setState("connecting");
    const sub = subscribeInkadeEvents(
      {
        baseUrl,
        ...(token ? { token } : {}),
        ...(credentials !== undefined ? { credentials } : {}),
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
        ...(defaults?.initialRetryDelayMs !== undefined
          ? { initialRetryDelayMs: defaults.initialRetryDelayMs }
          : {}),
        ...(defaults?.maxRetryDelayMs !== undefined
          ? { maxRetryDelayMs: defaults.maxRetryDelayMs }
          : {}),
      },
      {
        onOpen: () => {
          setState("connected");
          setReconnectAttempt(0);
        },
        onReconnect: (attempt) => {
          setState("reconnecting");
          setReconnectAttempt(attempt);
        },
        onError: () => {
          setState((prev) => (prev === "connected" ? "reconnecting" : prev));
        },
        onEvent: (event: InkadeEvent) => {
          onEventRef.current?.(event);
          if (event.type === "agent.tool.started" || event.type === "agent.tool.finished") {
            setActiveTools((prev) => reduceActiveAgentTools(prev, event));
            return;
          }
          setLastEventSeq(event.seq);
          applyInkadeEventToQueryCache(queryClient, event);
        },
      },
    );

    return () => {
      sub.unsubscribe();
    };
  }, [
    baseUrl,
    credentials,
    defaults?.initialRetryDelayMs,
    defaults?.maxRetryDelayMs,
    enabled,
    fetchImpl,
    queryClient,
    token,
  ]);

  return { state, reconnectAttempt, lastEventSeq, activeTools };
}
