import {
  normalizeHostKind,
  type HarnessWakeProfile,
  type InkadeEvent,
  type WakeEnvelope,
} from "@inkade/core";
import { createInkadeClient, subscribeInkadeEvents, type InkadeClient } from "@inkade/sdk";
import { executeNudge } from "./nudge.ts";

export interface WatchSessionTarget {
  readonly profile: HarnessWakeProfile;
  readonly sessionId?: string | undefined;
  readonly workspacePath?: string | undefined;
}

export function shouldHandleWatchWake(
  wake: WakeEnvelope,
  target: WatchSessionTarget,
): boolean {
  if (
    wake.targetAdeKind &&
    wake.targetAdeKind !== "any" &&
    wake.targetAdeKind !== normalizeHostKind(target.profile.name)
  ) {
    return false;
  }
  if (wake.targetExternalThreadId) {
    if (!target.sessionId || wake.targetExternalThreadId !== target.sessionId) {
      return false;
    }
  } else if (wake.targetWorkspacePath && target.workspacePath) {
    if (wake.targetWorkspacePath !== target.workspacePath) {
      return false;
    }
  } else if (!wake.targetExternalThreadId && !wake.targetWorkspacePath) {
    return false;
  }
  return true;
}

export type WatchWakeAction =
  | { readonly action: "ignored"; readonly reason: string }
  | { readonly action: "monitor_emitted"; readonly wakeId: string }
  | { readonly action: "nudged"; readonly wakeId: string }
  | { readonly action: "nudge_failed"; readonly wakeId: string; readonly error: string };

export async function processWatchWakeEvent(options: {
  readonly wake: WakeEnvelope;
  readonly target: WatchSessionTarget;
  readonly client: Pick<InkadeClient, "threadBindings">;
  readonly output?: NodeJS.WritableStream | undefined;
  readonly executeNudgeFn?: typeof executeNudge | undefined;
}): Promise<WatchWakeAction> {
  const { wake, target, client } = options;

  if (!shouldHandleWatchWake(wake, target)) {
    return { action: "ignored", reason: "session_mismatch" };
  }

  // Strictly block non-owner wakes (collaborator / system) from waking idle sessions or running nudge.
  if (wake.senderKind !== "owner") {
    return { action: "ignored", reason: `non_owner_sender:${wake.senderKind}` };
  }

  if (!target.profile.wakesIdle) {
    return { action: "ignored", reason: "harness_does_not_wake_idle" };
  }

  if (target.profile.nudge) {
    if (!target.sessionId) {
      return { action: "ignored", reason: "missing_session_id" };
    }
    const nudgeFn = options.executeNudgeFn ?? executeNudge;
    try {
      const res = await nudgeFn({
        profile: target.profile,
        wake,
        sessionId: target.sessionId,
      });
      if (!res.executed) {
        return { action: "ignored", reason: res.skippedReason ?? "nudge_skipped" };
      }
      await client.threadBindings.ackWakeEvent(wake.id, { status: "acked" }).catch(() => {});
      return { action: "nudged", wakeId: wake.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await client.threadBindings
        .ackWakeEvent(wake.id, { status: "failed", error: message.slice(0, 500) })
        .catch(() => {});
      return { action: "nudge_failed", wakeId: wake.id, error: message };
    }
  }

  const out = options.output ?? process.stdout;
  out.write(
    `${JSON.stringify({
      type: "inkade.wake",
      wakeId: wake.id,
      reason: wake.reason,
      summary: wake.summary,
      documentId: wake.documentId,
      formattedPromptText: wake.formattedPromptText,
    })}\n`,
  );
  await client.threadBindings.ackWakeEvent(wake.id, { status: "acked" }).catch(() => {});
  return { action: "monitor_emitted", wakeId: wake.id };
}

export interface RunWatchCommandOptions {
  readonly baseUrl: string;
  readonly token?: string | undefined;
  readonly profile: HarnessWakeProfile;
  readonly sessionId?: string | undefined;
  readonly workspacePath?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly output?: NodeJS.WritableStream | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
}

export function startWatchBridge(options: RunWatchCommandOptions): {
  readonly stop: () => void;
  readonly done: Promise<void>;
} {
  const client = createInkadeClient({
    baseUrl: options.baseUrl,
    ...(options.token ? { token: options.token } : {}),
  });
  const adeKind = normalizeHostKind(options.profile.name);
  const sendHeartbeat = () => {
    if (!options.sessionId) return;
    void client.threadBindings
      .heartbeatBridgeSession({
        harnessName: options.profile.name,
        adeKind,
        externalThreadId: options.sessionId,
        workspacePath: options.workspacePath ?? null,
        pid: process.ppid ?? process.pid,
        capabilities: {
          hookDialect: options.profile.hookDialect ?? null,
          wakesIdle: options.profile.wakesIdle,
          watch: true,
        },
        status: "online",
      })
      .catch(() => {});
  };

  sendHeartbeat();
  const intervalMs = options.heartbeatIntervalMs ?? 30_000;
  const heartbeatTimer = setInterval(sendHeartbeat, intervalMs);
  heartbeatTimer.unref?.();

  const sub = subscribeInkadeEvents(
    {
      baseUrl: options.baseUrl,
      ...(options.token ? { token: options.token } : {}),
    },
    {
      onEvent: (event: InkadeEvent) => {
        if (event.type !== "wake.enqueued") return;
        void processWatchWakeEvent({
          wake: event.payload.wake,
          target: {
            profile: options.profile,
            sessionId: options.sessionId,
            workspacePath: options.workspacePath,
          },
          client,
          output: options.output,
        });
      },
    },
  );

  let resolved = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const stop = () => {
    if (resolved) return;
    resolved = true;
    clearInterval(heartbeatTimer);
    sub.unsubscribe();
    resolveDone();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      stop();
    } else {
      options.signal.addEventListener("abort", stop, { once: true });
    }
  }

  return { stop, done };
}
