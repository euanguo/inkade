import type { ActorType, DocumentRevision } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import type { useInkadeRevisionDiff } from "@inkade/sdk/react";
import {
  Badge,
  Button,
  DiffViewer,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  TabsPanel,
} from "@inkade/ui";
import { TrackChangesSkeleton } from "@inkade/views/components/ViewSkeletons";
import { HistoryIcon } from "lucide-react";
import type React from "react";

export interface InspectorRevisionsTabProps {
  readonly docVersion: number;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly revisions: readonly DocumentRevision[];
  readonly selectedRevision: DocumentRevision | null;
  readonly actorLabels: Readonly<Record<ActorType, string>>;
  readonly diffPending: boolean;
  readonly diffData: ReturnType<typeof useInkadeRevisionDiff>["data"];
  readonly restoring: boolean;
  readonly onRetry: () => void;
  readonly onSelectRevision: (rev: DocumentRevision) => void;
  readonly onRestore: (version: number) => void;
}

export function InspectorRevisionsTab({
  docVersion,
  isPending,
  isError,
  revisions,
  selectedRevision,
  actorLabels,
  diffPending,
  diffData,
  restoring,
  onRetry,
  onSelectRevision,
  onRestore,
}: InspectorRevisionsTabProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <TabsPanel className="flex flex-col gap-3" value="revisions">
      {isPending ? (
        <div aria-busy="true" className="flex flex-col gap-1.5">
          {[0, 1, 2].map((idx) => (
            <div
              className="flex flex-col gap-1.5 rounded-lg border bg-card px-3 py-2"
              key={idx}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-3.5 w-8" />
                  <Skeleton className="h-4 w-12 rounded-full" />
                </div>
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          <span className="text-destructive-foreground">{t("inspector.loadFailed")}</span>
          <Button onClick={onRetry} size="xs" variant="outline">
            {t("common.retry")}
          </Button>
        </div>
      ) : revisions.length === 0 ? (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>{t("inspector.noRevisionsTitle")}</EmptyTitle>
            <EmptyDescription>{t("inspector.noRevisionsDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {revisions.map((rev) => {
              const isSelected = selectedRevision?.id === rev.id;
              const isCurrent = rev.version === docVersion;
              return (
                <button
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? "border-ring bg-accent"
                      : "bg-card shadow-[var(--shadow-card)] hover:bg-accent/50"
                  }`}
                  key={rev.id}
                  onClick={() => onSelectRevision(rev)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold">
                        {t("common.version", { version: rev.version })}
                      </span>
                      <Badge size="sm" variant={rev.actorType === "agent" ? "info" : "outline"}>
                        {actorLabels[rev.actorType]}
                      </Badge>
                      {isCurrent && (
                        <Badge size="sm" variant="secondary">
                          {t("common.current")}
                        </Badge>
                      )}
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {rev.createdAt.slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                  {rev.changeSummary && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {rev.changeSummary}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {selectedRevision && selectedRevision.version !== docVersion && (
            <div className="pt-2">
              {diffPending ? (
                <TrackChangesSkeleton compact />
              ) : diffData ? (
                <DiffViewer
                  diff={diffData.diff}
                  newLabel={t("common.version", { version: docVersion })}
                  oldLabel={t("common.version", { version: selectedRevision.version })}
                  onRestore={() => onRestore(selectedRevision.version)}
                  restoring={restoring}
                />
              ) : null}
            </div>
          )}
        </>
      )}
    </TabsPanel>
  );
}
