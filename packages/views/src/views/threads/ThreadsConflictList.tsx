import {
  Badge,
  Button,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@inkade/ui";
import { GitCompareIcon, ShieldCheckIcon } from "lucide-react";
import type React from "react";
import { ThreadBindingCard } from "./ThreadBindingCard.tsx";
import type { ThreadsWorkspaceState } from "./useThreadsWorkspace.ts";

export function ThreadsConflictList({
  state,
}: {
  readonly state: ThreadsWorkspaceState;
}): React.ReactElement {
  const { t, navigation, docMap, filteredConflicts } = state;

  if (filteredConflicts.length === 0) {
    return (
      <Empty className="rounded-xl border border-dashed py-14">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheckIcon />
          </EmptyMedia>
          <EmptyTitle>{t("agentControl.threadsConflictEmptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("agentControl.threadsConflictEmptyDesc")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {filteredConflicts.map((conflict) => {
        const targetDoc = docMap.get(conflict.documentId);
        const scopeBadgeLabel =
          conflict.scope === "node"
            ? t("agentControl.conflictScopeNode")
            : conflict.scope === "selection"
              ? t("agentControl.conflictScopeSelection")
              : t("agentControl.conflictScopeDocument");
        return (
          <section
            className="flex flex-col gap-3"
            key={`${conflict.documentId}:${conflict.nodeId ?? conflict.scope}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full bg-[#D97706]"
                />
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {targetDoc?.title ?? conflict.documentId}
                </h2>
                <Badge size="sm" variant="warning">
                  {scopeBadgeLabel}
                </Badge>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {targetDoc?.dailyDate && conflict.nodeId && (
                  <Button
                    onClick={() =>
                      navigation.openDaily(targetDoc.dailyDate!, {
                        nodeId: conflict.nodeId!,
                      })
                    }
                    size="xs"
                    variant="outline"
                  >
                    {t("agentControl.threadsFocusNode")}
                  </Button>
                )}
                <Button
                  onClick={() => navigation.openDocument(conflict.documentId)}
                  size="xs"
                  variant="outline"
                >
                  <GitCompareIcon className="size-3.5" />
                  <span>{t("agentControl.threadsCompareDoc")}</span>
                </Button>
              </div>
            </div>

            <div
              className={cn(
                "grid grid-cols-1 gap-3",
                conflict.bindings.length > 1 && "md:grid-cols-2",
              )}
            >
              {conflict.bindings.map((binding) => (
                <ThreadBindingCard binding={binding} key={binding.id} state={state} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
