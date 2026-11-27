import type {
  DocumentSummary,
  RelatedDocumentHit,
  Space,
  UnlinkedMentionItem,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import type { useInkadeBacklinks, useInkadeDocumentGraph } from "@inkade/sdk/react";
import {
  BacklinksPanel,
  Badge,
  Button,
  DocumentKindIcon,
  LocalGraphPanel,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  TabsPanel,
} from "@inkade/ui";
import { Link2Icon, NetworkIcon, SparklesIcon } from "lucide-react";
import type React from "react";

export interface InspectorBacklinksTabProps {
  readonly backlinksView: "links" | "graph";
  readonly onChangeBacklinksView: (view: "links" | "graph") => void;
  readonly graphDepth: 1 | 2;
  readonly onChangeGraphDepth: (depth: 1 | 2) => void;
  readonly backlinksPending: boolean;
  readonly backlinksError: boolean;
  readonly onRetryBacklinks: () => void;
  readonly backlinks: NonNullable<ReturnType<typeof useInkadeBacklinks>["data"]>;
  readonly unlinkedMentions: readonly UnlinkedMentionItem[];
  readonly allDocs: readonly DocumentSummary[];
  readonly spaces: readonly Space[];
  readonly linkingMentionKey: string | null;
  readonly onLinkMention: (mention: UnlinkedMentionItem) => void;
  readonly onNavigateBacklink: (sourceDocumentId: string, sourceNodeId: string | null) => void;
  readonly graphPending: boolean;
  readonly graphData: ReturnType<typeof useInkadeDocumentGraph>["data"];
  readonly onSelectGraphDoc: (targetDocId: string) => void;
  readonly relatedPending: boolean;
  readonly relatedDocs: readonly RelatedDocumentHit[];
  readonly onOpenRelatedDoc: (hit: RelatedDocumentHit) => void;
}

export function InspectorBacklinksTab({
  backlinksView,
  onChangeBacklinksView,
  graphDepth,
  onChangeGraphDepth,
  backlinksPending,
  backlinksError,
  onRetryBacklinks,
  backlinks,
  unlinkedMentions,
  allDocs,
  spaces,
  linkingMentionKey,
  onLinkMention,
  onNavigateBacklink,
  graphPending,
  graphData,
  onSelectGraphDoc,
  relatedPending,
  relatedDocs,
  onOpenRelatedDoc,
}: InspectorBacklinksTabProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <TabsPanel className="flex flex-col gap-3" value="backlinks">
      <SegmentedControl className="w-full" size="sm">
        <SegmentedControlItem
          className="flex-1"
          data-pressed={backlinksView === "links" ? "" : undefined}
          onClick={() => onChangeBacklinksView("links")}
        >
          <Link2Icon />
          {t("reader.graphLinksTab")}
        </SegmentedControlItem>
        <SegmentedControlItem
          className="flex-1"
          data-pressed={backlinksView === "graph" ? "" : undefined}
          onClick={() => onChangeBacklinksView("graph")}
        >
          <NetworkIcon />
          {t("reader.graphViewTab")}
        </SegmentedControlItem>
      </SegmentedControl>

      {backlinksView === "links" ? (
        backlinksPending ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            {[0, 1].map((idx) => (
              <div
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
                key={idx}
              >
                <div className="flex items-center gap-2">
                  <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                  <Skeleton className="h-3.5 w-36" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : backlinksError ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
            <span className="text-destructive-foreground">{t("inspector.loadFailed")}</span>
            <Button onClick={onRetryBacklinks} size="xs" variant="outline">
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          <BacklinksPanel
            linkingMentionKey={linkingMentionKey}
            links={backlinks}
            onLinkMention={onLinkMention}
            onNavigate={onNavigateBacklink}
            sourceDocuments={allDocs}
            unlinkedMentions={unlinkedMentions}
          />
        )
      ) : graphPending ? (
        <div
          aria-busy="true"
          className="flex h-64 flex-col justify-between rounded-xl border border-border bg-card p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-20 rounded-md" />
          </div>
          <div className="flex flex-1 items-center justify-center gap-6">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-0.5 w-8" />
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-0.5 w-8" />
            <Skeleton className="size-5 rounded-full" />
          </div>
          <Skeleton className="h-3 w-32" />
        </div>
      ) : graphData ? (
        <LocalGraphPanel
          depth={graphDepth}
          graph={graphData}
          onDepthChange={onChangeGraphDepth}
          onSelectDocument={onSelectGraphDoc}
          spaces={spaces}
        />
      ) : null}

      {/* Related via Semantic Embedding */}
      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <SparklesIcon className="size-3.5 text-primary" />
            <span>{t("inspector.relatedDocsTitle")}</span>
          </span>
          {relatedDocs.length > 0 && (
            <Badge size="sm" variant="secondary">
              {relatedDocs.length}
            </Badge>
          )}
        </div>

        {relatedPending ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            {[0, 1].map((idx) => (
              <div
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5"
                key={idx}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                    <Skeleton className="h-3.5 w-32" />
                  </div>
                  <Skeleton className="h-4 w-10 shrink-0 rounded-full" />
                </div>
                <Skeleton className="h-3 w-5/6" />
              </div>
            ))}
          </div>
        ) : relatedDocs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("inspector.relatedDocsEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {relatedDocs.map((item) => {
              const similarityPercent = Math.round(
                Math.max(0, Math.min(1, item.similarity)) * 100,
              );
              return (
                <button
                  className="flex w-full cursor-pointer flex-col gap-1 rounded-lg border border-border bg-card p-2.5 text-left text-card-foreground shadow-[var(--shadow-card)] transition-colors hover:border-ring/40 hover:bg-accent/40"
                  key={item.documentId}
                  onClick={() => onOpenRelatedDoc(item)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <DocumentKindIcon kind={item.kind} size="xs" />
                      <span className="truncate text-xs font-semibold text-foreground">
                        {item.title}
                      </span>
                    </div>
                    <Badge className="shrink-0 tabular-nums" size="sm" variant="info">
                      {t("inspector.relatedSimilarity", { percent: similarityPercent })}
                    </Badge>
                  </div>
                  {item.excerpt && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {item.excerpt}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </TabsPanel>
  );
}
