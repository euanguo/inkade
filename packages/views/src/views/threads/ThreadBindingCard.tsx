import type { AdeThreadBinding } from "@inkade/core";
import {
  AdeThreadChip,
  AgentStepsLog,
  ApprovalCard,
  Badge,
  Button,
  CopyButton,
  Input,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  ThinkingIndicator,
} from "@inkade/ui";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  SendHorizontalIcon,
  UnlinkIcon,
} from "lucide-react";
import type React from "react";
import type { ThreadsWorkspaceState } from "./useThreadsWorkspace.ts";

export interface ThreadBindingCardProps {
  readonly binding: AdeThreadBinding;
  readonly state: ThreadsWorkspaceState;
}

export function ThreadBindingCard({
  binding,
  state,
}: ThreadBindingCardProps): React.ReactElement {
  const {
    t,
    navigation,
    hostActions,
    environment,
    docMap,
    steeringDraftById,
    setSteeringDraftById,
    steeringModeById,
    setSteeringModeById,
    recentApprovalIds,
    updateBindingMutation,
    approveBindingMutation,
    undoApprovalMutation,
    steerBindingMutation,
    deleteBindingMutation,
  } = state;

  const sourceDoc = docMap.get(binding.documentId);
  const isWaiting = binding.status === "waiting_input";
  const isRunning = binding.status === "running";
  const steeringDraft = steeringDraftById[binding.id] ?? "";
  const steeringMode = steeringModeById[binding.id] ?? "queued";
  const hasPendingApproval = Boolean(
    binding.pendingApproval &&
      (!binding.pendingApproval.decision || recentApprovalIds.has(binding.id)),
  );

  return (
    <div
      className="flex min-h-[9.5rem] flex-col justify-between gap-2.5 rounded-lg border border-border bg-card p-3.5 text-foreground shadow-[var(--shadow-card)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] hover:border-foreground/25"
      key={binding.id}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex min-h-[2rem] items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <AdeThreadChip
              binding={binding}
              onMarkRead={(item) =>
                updateBindingMutation.mutate({
                  id: item.id,
                  patch: { unreadResult: false },
                })
              }
              onOpenInAde={(item) => {
                if (hostActions.openThread && (!item.deepLink || environment.canOpenThreadHost)) {
                  void hostActions.openThread(item);
                } else if (item.deepLink) {
                  if (hostActions.openExternalUrl) {
                    hostActions.openExternalUrl(item.deepLink);
                  } else {
                    window.open(item.deepLink, "_blank", "noopener,noreferrer");
                  }
                }
              }}
              onUnbind={(item) => deleteBindingMutation.mutate(item.id)}
            />
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <CopyButton
              copiedLabel={t("inspector.copiedThreadId")}
              label={t("inspector.copyThreadId")}
              value={binding.externalThreadId}
            />
            <Menu>
              <MenuTrigger render={<Button size="icon-xs" variant="ghost" />}>
                <MoreHorizontalIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                {binding.unreadResult && (
                  <MenuItem
                    onClick={() =>
                      updateBindingMutation.mutate({
                        id: binding.id,
                        patch: { unreadResult: false },
                      })
                    }
                  >
                    <EyeIcon />
                    {t("threads.markRead")}
                  </MenuItem>
                )}
                {binding.status === "failed" && (
                  <MenuItem
                    onClick={() =>
                      updateBindingMutation.mutate({
                        id: binding.id,
                        patch: { status: "queued" },
                      })
                    }
                  >
                    <RotateCcwIcon />
                    {t("agentControl.awayActionRetry")}
                  </MenuItem>
                )}
                {binding.status !== "completed" && (
                  <MenuItem
                    onClick={() =>
                      updateBindingMutation.mutate({
                        id: binding.id,
                        patch: { status: "completed", unreadResult: false },
                      })
                    }
                  >
                    <CheckCircle2Icon />
                    {t("threads.markCompleted")}
                  </MenuItem>
                )}
                {binding.status !== "archived" && (
                  <MenuItem
                    onClick={() =>
                      updateBindingMutation.mutate({
                        id: binding.id,
                        patch: { status: "archived" },
                      })
                    }
                  >
                    <ArchiveIcon />
                    {t("threads.archiveThread")}
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => deleteBindingMutation.mutate(binding.id)}
                  variant="destructive"
                >
                  <UnlinkIcon />
                  {t("threads.unbindThread")}
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-foreground">{binding.title}</h3>

        {binding.selectionAnchor?.quote && (
          <blockquote className="line-clamp-2 rounded-md bg-muted/35 px-2.5 py-1.5 text-xs text-muted-foreground">
            {binding.selectionAnchor.quote}
          </blockquote>
        )}

        {binding.lastSummary && (
          <p className="line-clamp-3 text-xs leading-relaxed text-foreground/85">
            {binding.lastSummary}
          </p>
        )}

        {hasPendingApproval && binding.pendingApproval && (
          <ApprovalCard
            adeKind={binding.adeKind}
            approval={binding.pendingApproval}
            createdAt={binding.createdAt}
            onDecision={(decision, note) =>
              approveBindingMutation.mutateAsync({
                id: binding.id,
                decision,
                note,
              })
            }
            onUndo={() => undoApprovalMutation.mutateAsync(binding)}
            pending={approveBindingMutation.isPending}
            title={binding.title}
            variant="embedded"
          />
        )}

        {((binding.progressSteps?.length ?? 0) > 0 || isRunning) && (
          <AgentStepsLog
            collapseOnComplete
            defaultExpanded={isRunning}
            steps={binding.progressSteps ?? []}
            variant="embedded"
          />
        )}

        {isRunning && (
          <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <ThinkingIndicator
                showTimer
                size="sm"
                startedAt={binding.runningSince ?? binding.lastSyncedAt}
              />
              <div className="flex items-center gap-1">
                <Button
                  onClick={() =>
                    setSteeringModeById((prev) => ({
                      ...prev,
                      [binding.id]: steeringMode === "queued" ? "interrupt" : "queued",
                    }))
                  }
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  {steeringMode === "interrupt"
                    ? t("agentControl.steeringInterruptMode")
                    : t("agentControl.steeringQueueMode")}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                className="flex-1 text-xs"
                onChange={(e) =>
                  setSteeringDraftById((prev) => ({ ...prev, [binding.id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && steeringDraft.trim()) {
                    e.preventDefault();
                    steerBindingMutation.mutate({
                      bindingId: binding.id,
                      text: steeringDraft.trim(),
                      mode: steeringMode,
                    });
                  }
                }}
                placeholder={t("agentControl.steeringPlaceholder")}
                size="sm"
                value={steeringDraft}
              />
              <Button
                disabled={!steeringDraft.trim() || steerBindingMutation.isPending}
                onClick={() =>
                  steerBindingMutation.mutate({
                    bindingId: binding.id,
                    text: steeringDraft.trim(),
                    mode: steeringMode,
                  })
                }
                size="sm"
                type="button"
              >
                <SendHorizontalIcon className="size-3.5" />
                <span>{t("agentControl.steeringSend")}</span>
              </Button>
            </div>
            {binding.steeringQueue && binding.steeringQueue.length > 0 && (
              <div className="flex flex-col gap-1 pt-0.5">
                {binding.steeringQueue.slice(-2).map((note) => (
                  <div
                    className="flex items-center justify-between gap-2 rounded bg-muted/45 px-2 py-1 text-[11px]"
                    key={note.id}
                  >
                    <span className="truncate text-foreground/85">{note.text}</span>
                    <Badge
                      size="sm"
                      variant={note.deliveredAt ? "success" : "secondary"}
                    >
                      {note.deliveredAt
                        ? t("agentControl.steeringDeliveredBadge")
                        : note.mode === "interrupt"
                          ? t("agentControl.steeringInterruptBadge")
                          : t("agentControl.steeringQueuedBadge")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2.5 text-xs">
        <button
          className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-left text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => navigation.openDocument(binding.documentId)}
          type="button"
        >
          <FileTextIcon className="size-3.5 shrink-0" />
          <span className="max-w-44 truncate">
            {sourceDoc?.title ?? binding.documentId}
          </span>
          {binding.nodeId && (
            <span className="font-mono text-[10px] opacity-75">
              #{binding.nodeId.slice(0, 8)}
            </span>
          )}
        </button>

        <div className="flex items-center gap-1.5">
          {binding.unreadResult && (
            <Button
              className="active:scale-[0.985] transition-[transform,colors] duration-[var(--duration-micro)] ease-[var(--ease-smooth-out)]"
              onClick={() =>
                updateBindingMutation.mutate({
                  id: binding.id,
                  patch: { unreadResult: false },
                })
              }
              size="xs"
              variant="ghost"
            >
              <EyeIcon />
              {t("threads.markRead")}
            </Button>
          )}
          {isWaiting && !hasPendingApproval && (
            <Button
              className="active:scale-[0.985] transition-[transform,colors] duration-[var(--duration-micro)] ease-[var(--ease-smooth-out)]"
              onClick={() =>
                updateBindingMutation.mutate({
                  id: binding.id,
                  patch: { status: "completed", unreadResult: false },
                })
              }
              size="xs"
              variant="outline"
            >
              <CheckCircle2Icon />
              {t("threads.markCompleted")}
            </Button>
          )}
          {binding.deepLink ? (
            <Button
              className="active:scale-[0.985] transition-[transform,colors] duration-[var(--duration-micro)] ease-[var(--ease-smooth-out)]"
              render={
                <a
                  href={binding.deepLink}
                  rel="noreferrer noopener"
                  target="_blank"
                />
              }
              size="xs"
              variant="outline"
            >
              <ExternalLinkIcon />
              {t("threads.openAde")}
            </Button>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">
              {binding.externalThreadId}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
