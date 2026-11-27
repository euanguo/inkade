import {
  type ArtifactSandboxTicket,
  type AuditBatchId,
  type BatchRollbackConflict,
  type DocumentArtifactId,
  type DocumentId,
  type DocumentRecord,
  type DocumentRevision,
  type DocumentSummary,
  isInboxArchivedDoc,
  type SendHighlightToAgentResult,
  type Space,
  type SpaceId,
  type SubmitArtifactCommentInput,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { formatLocalizedBriefingSummary } from "../../lib/briefings-i18n.ts";
import {
  ArticleReader,
  Badge,
  Button,
  DocumentKindIcon,
  InlineTrackChangesViewer,
  Kbd,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  ScrollArea,
  SpaceIcon,
} from "@inkade/ui";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderInputIcon,
  RotateCcwIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import type { DispatchAdeTarget } from "../../components/DispatchAdeDialog.tsx";
import { TrackChangesSkeleton } from "../../components/ViewSkeletons.tsx";
import type { UnifiedInboxItem } from "./types.ts";

export interface InboxDocumentDetailProps {
  readonly item: Extract<UnifiedInboxItem, { kind: "digest" | "clip" }>;
  readonly fullDoc: DocumentRecord | null;
  readonly detailPending: boolean;
  readonly reviewRevisionsPending: boolean;
  readonly latestReviewRevision: DocumentRevision | null;
  readonly previousReviewRevision: DocumentRevision | null;
  readonly hasReviewDiff: boolean;
  readonly spaces: readonly Space[];
  readonly targetSpaces: readonly Space[];
  readonly allDocs: readonly DocumentSummary[];
  readonly inboxSpaceId: SpaceId;
  readonly effectiveTheme: "light" | "dark";
  readonly metaControls: React.ReactNode;
  readonly moveMenuOpen: boolean;
  readonly onMoveMenuOpenChange: (open: boolean) => void;
  readonly shortcutsAllowed: boolean;
  readonly applyReviewPending: boolean;
  readonly markReadPending: boolean;
  readonly archiveOutPending: boolean;
  readonly convertPending: boolean;
  readonly trashPending: boolean;
  readonly undoBatchPending?: boolean | undefined;
  readonly rollbackConflictPrompt?:
    | {
        readonly batchId: AuditBatchId;
        readonly conflicts: readonly BatchRollbackConflict[];
      }
    | null
    | undefined;
  readonly onBackToQueue: () => void;
  readonly onOpenDocument: (docId: DocumentId) => void;
  readonly onOpenWikilink: (target: string) => void;
  readonly onDispatchTarget: (target: DispatchAdeTarget) => void;
  readonly onApplyReview: (doc: DocumentRecord, resolvedMarkdown: string) => void;
  readonly onMarkRead: (docId: DocumentId) => void;
  readonly onUndoBatch?: ((batchId: AuditBatchId, force?: boolean) => void) | undefined;
  readonly onDismissRollbackConflict?: (() => void) | undefined;
  readonly onArchiveOut: (doc: DocumentSummary) => void;
  readonly onMoveToSpace: (doc: DocumentSummary, spaceId: SpaceId) => void;
  readonly onConvertToArticle: (doc: DocumentSummary) => void;
  readonly onTrash: (docId: DocumentId) => void;
  readonly onIssueArtifactTicket?:
    | ((artifactId: DocumentArtifactId) => Promise<ArtifactSandboxTicket>)
    | undefined;
  readonly onSubmitArtifactComment?:
    | ((
        artifactId: DocumentArtifactId,
        input: SubmitArtifactCommentInput,
      ) => Promise<SendHighlightToAgentResult>)
    | undefined;
  readonly onOpenSecuritySettings?: (() => void) | undefined;
}

export function InboxDocumentDetail({
  item,
  fullDoc,
  detailPending,
  reviewRevisionsPending,
  latestReviewRevision,
  previousReviewRevision,
  hasReviewDiff,
  spaces,
  targetSpaces,
  allDocs,
  inboxSpaceId,
  effectiveTheme,
  metaControls,
  moveMenuOpen,
  onMoveMenuOpenChange,
  shortcutsAllowed,
  applyReviewPending,
  markReadPending,
  archiveOutPending,
  convertPending,
  trashPending,
  undoBatchPending,
  rollbackConflictPrompt,
  onBackToQueue,
  onOpenDocument,
  onOpenWikilink,
  onDispatchTarget,
  onApplyReview,
  onMarkRead,
  onUndoBatch,
  onDismissRollbackConflict,
  onArchiveOut,
  onMoveToSpace,
  onConvertToArticle,
  onTrash,
  onIssueArtifactTicket,
  onSubmitArtifactComment,
  onOpenSecuritySettings,
}: InboxDocumentDetailProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  if (item.kind === "digest") {
    const doc = item.doc;
    const canAlsoArchiveClip =
      !isInboxArchivedDoc(doc) && (doc.spaceId === inboxSpaceId || doc.kind === "clip");
    const activeBatchConflict =
      item.batchId &&
      rollbackConflictPrompt?.batchId === item.batchId &&
      rollbackConflictPrompt.conflicts.length > 0
        ? rollbackConflictPrompt
        : null;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Button className="md:hidden" onClick={onBackToQueue} size="xs" variant="ghost">
              <ArrowLeftIcon />
              {t("inbox.backToQueue")}
            </Button>
            <DocumentKindIcon kind={doc.kind} size="xs" />
            <span className="truncate text-sm font-medium text-foreground">{doc.title}</span>
            <Badge className="font-mono" size="sm" variant="outline">
              {t("common.version", { version: doc.version })}
            </Badge>
            <Badge size="sm" variant="info">
              {t("inbox.kindDigest")}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {metaControls}
            {item.batchId && onUndoBatch && (
              <Button
                aria-label={t("inbox.undoBatch")}
                loading={Boolean(undoBatchPending)}
                onClick={() => item.batchId && onUndoBatch(item.batchId)}
                size="xs"
                title={t("inbox.undoBatch")}
                variant="outline"
              >
                <RotateCcwIcon />
                <span className="hidden sm:inline">{t("inbox.undoBatch")}</span>
              </Button>
            )}
            {canAlsoArchiveClip && (
              <Button
                aria-label={t("inbox.archiveOut")}
                loading={archiveOutPending}
                onClick={() => onArchiveOut(doc)}
                size="xs"
                title={t("inbox.archiveOut")}
                variant="ghost"
              >
                <ArchiveIcon />
                <span className="hidden sm:inline">{t("inbox.archiveOut")}</span>
                <Kbd className="hidden xl:inline-flex">E</Kbd>
              </Button>
            )}
            <Button
              aria-label={t("reviewCenter.markReadAndNext")}
              loading={markReadPending}
              onClick={() => onMarkRead(doc.id)}
              size="xs"
              title={t("reviewCenter.markReadAndNext")}
              variant="outline"
            >
              <CheckIcon />
              <span className="hidden sm:inline">{t("reviewCenter.markReadAndNext")}</span>
            </Button>
            <Button onClick={() => onOpenDocument(doc.id)} size="xs" variant="secondary">
              <span>{t("inbox.openFullDoc")}</span>
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1" scrollFade>
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-5 lg:px-8">
            {activeBatchConflict && onUndoBatch && (
              <div
                className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3.5 text-xs"
                data-slot="inbox-undo-batch-conflict"
              >
                <div className="flex items-start gap-2 text-warning-foreground">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-semibold">{t("inbox.undoBatchConflictTitle")}</p>
                    <p className="text-muted-foreground">{t("inbox.undoBatchConflictDesc")}</p>
                    <ul className="list-disc pl-4 text-muted-foreground">
                      {activeBatchConflict.conflicts.map((conflict) => (
                        <li key={conflict.documentId}>
                          {conflict.documentTitle || conflict.documentId}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Button
                    onClick={() => onDismissRollbackConflict?.()}
                    size="xs"
                    variant="outline"
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    loading={Boolean(undoBatchPending)}
                    onClick={() => onUndoBatch(activeBatchConflict.batchId, true)}
                    size="xs"
                    variant="default"
                  >
                    {t("inbox.undoBatchForceConfirm")}
                  </Button>
                </div>
              </div>
            )}
            {reviewRevisionsPending || (doc.kind !== "outline" && detailPending) ? (
              <TrackChangesSkeleton />
            ) : hasReviewDiff && previousReviewRevision && fullDoc ? (
              <InlineTrackChangesViewer
                applying={applyReviewPending}
                changeSummary={
                  latestReviewRevision?.changeSummary === "Initial version"
                    ? t("inbox.initialVersion")
                    : latestReviewRevision?.changeSummary
                }
                enableKeyboardShortcuts={hasReviewDiff && shortcutsAllowed}
                navigationKeys="brackets"
                newLabel={t("document.agentVersionLabel", { version: fullDoc.version })}
                newMarkdown={fullDoc.contentMarkdown}
                oldLabel={t("common.version", { version: previousReviewRevision.version })}
                oldMarkdown={previousReviewRevision.contentMarkdown}
                onApplyResolvedMarkdown={(resolved) => onApplyReview(fullDoc, resolved)}
              />
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/25 p-4 text-xs text-muted-foreground">
                {latestReviewRevision?.changeSummary || item.batchSummary ? (
                  <p className="font-medium text-foreground">
                    {latestReviewRevision?.changeSummary === "Initial version"
                      ? t("inbox.initialVersion")
                      : (latestReviewRevision?.changeSummary ??
                        formatLocalizedBriefingSummary(item.batchSummary, item.batchSummary ?? "", t))}
                  </p>
                ) : null}
                <p>{t("reviewCenter.noDiffPreviewHint")}</p>
              </div>
            )}

            {fullDoc ? (
              <ArticleReader
                document={{ ...fullDoc, unreadAgentUpdate: false }}
                enableKeyboardNav={false}
                onAskAgent={(anchor) =>
                  onDispatchTarget({
                    documentId: fullDoc.id,
                    documentTitle: fullDoc.title,
                    selectionAnchor: anchor,
                    excerpt: anchor.quote,
                    defaultTitle: t("document.askPrefix", { quote: anchor.quote.slice(0, 60) }),
                  })
                }
                onIssueArtifactTicket={onIssueArtifactTicket}
                onMarkAgentUpdateRead={() => onMarkRead(fullDoc.id)}
                onOpenSecuritySettings={onOpenSecuritySettings}
                onOpenWikilink={onOpenWikilink}
                onSubmitArtifactComment={onSubmitArtifactComment}
                onViewDiff={() => onOpenDocument(fullDoc.id)}
                showMarginaliaRail={false}
                showToc={false}
                spaces={spaces}
                theme={effectiveTheme}
                workspaceDocs={allDocs}
              />
            ) : (
              <TrackChangesSkeleton />
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  const clipDoc = item.doc;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button className="md:hidden" onClick={onBackToQueue} size="xs" variant="ghost">
            <ArrowLeftIcon />
            {t("inbox.backToQueue")}
          </Button>

          <Menu onOpenChange={onMoveMenuOpenChange} open={moveMenuOpen}>
            <MenuTrigger
              render={
                <Button
                  aria-label={t("inbox.moveToSpace")}
                  size="xs"
                  title={t("inbox.moveToSpace")}
                  variant="outline"
                />
              }
            >
              <FolderInputIcon />
              <span className="hidden sm:inline">{t("inbox.moveToSpace")}</span>
              <Kbd className="hidden xl:inline-flex">M</Kbd>
            </MenuTrigger>
            <MenuPopup align="start">
              {targetSpaces.map((s) => (
                <MenuItem key={s.id} onClick={() => onMoveToSpace(clipDoc, s.id)}>
                  <SpaceIcon color={s.color} icon={s.icon} size="xs" tone="mono" />
                  <span>{s.name}</span>
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>

          <Button
            aria-label={t("inbox.convertToArticle")}
            loading={convertPending}
            onClick={() => onConvertToArticle(clipDoc)}
            size="xs"
            title={t("inbox.convertToArticle")}
            variant="outline"
          >
            <FileTextIcon />
            <span className="hidden sm:inline">{t("inbox.convertToArticle")}</span>
            <Kbd className="hidden xl:inline-flex">A</Kbd>
          </Button>

          <Button
            aria-label={t("inbox.dispatchAde")}
            onClick={() =>
              onDispatchTarget({
                documentId: clipDoc.id,
                documentTitle: clipDoc.title,
                excerpt: clipDoc.excerpt || fullDoc?.contentText.slice(0, 260) || "",
              })
            }
            size="xs"
            title={t("inbox.dispatchAde")}
            variant="outline"
          >
            <SendIcon />
            <span className="hidden sm:inline">{t("inbox.dispatchAde")}</span>
            <Kbd className="hidden xl:inline-flex">D</Kbd>
          </Button>

          <Button
            aria-label={t("inbox.archiveOut")}
            loading={archiveOutPending}
            onClick={() => onArchiveOut(clipDoc)}
            size="xs"
            title={t("inbox.archiveOut")}
            variant="outline"
          >
            <ArchiveIcon />
            <span className="hidden sm:inline">{t("inbox.archiveOut")}</span>
            <Kbd className="hidden xl:inline-flex">E</Kbd>
          </Button>

          {metaControls}

          <Button
            aria-label={t("inbox.trashAria")}
            loading={trashPending}
            onClick={() => onTrash(clipDoc.id)}
            size="xs"
            variant="ghost"
          >
            <Trash2Icon className="text-muted-foreground hover:text-destructive-foreground" />
            <Kbd className="hidden xl:inline-flex">⌫</Kbd>
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          {clipDoc.sourceUrl && (
            <Button
              render={<a href={clipDoc.sourceUrl} rel="noreferrer noopener" target="_blank" />}
              size="xs"
              variant="ghost"
            >
              <ExternalLinkIcon />
              <span className="hidden sm:inline">{t("inbox.sourceOriginal")}</span>
            </Button>
          )}
          <Button onClick={() => onOpenDocument(clipDoc.id)} size="xs" variant="secondary">
            <span>{t("inbox.openFullDoc")}</span>
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="mx-auto w-full max-w-4xl px-4 py-5 lg:px-8">
          {fullDoc ? (
            <ArticleReader
              document={fullDoc}
              enableKeyboardNav={false}
              onAskAgent={(anchor) =>
                onDispatchTarget({
                  documentId: fullDoc.id,
                  documentTitle: fullDoc.title,
                  selectionAnchor: anchor,
                  excerpt: anchor.quote,
                  defaultTitle: t("document.askPrefix", { quote: anchor.quote.slice(0, 60) }),
                })
              }
              onIssueArtifactTicket={onIssueArtifactTicket}
              onMarkAgentUpdateRead={() => onMarkRead(fullDoc.id)}
              onOpenSecuritySettings={onOpenSecuritySettings}
              onOpenWikilink={onOpenWikilink}
              onSubmitArtifactComment={onSubmitArtifactComment}
              onViewDiff={() => onOpenDocument(clipDoc.id)}
              showMarginaliaRail={false}
              showToc={false}
              spaces={spaces}
              theme={effectiveTheme}
              workspaceDocs={allDocs}
            />
          ) : (
            <TrackChangesSkeleton />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
