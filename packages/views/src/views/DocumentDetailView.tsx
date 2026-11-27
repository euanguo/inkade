import type { ViewQueryRequestInput } from "@inkade/core";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  ArticleEditor,
  ArticleReader,
  Button,
  cn,
  DocumentFindBar,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  MarginaliaOverlay,
  PresentationModal,
  ProseMirrorOutlineEditor,
  ScrollArea,
} from "@inkade/ui";
import { AlertTriangleIcon } from "lucide-react";
import type React from "react";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

const LazyPdfStudyViewer = lazy(() =>
  import("@inkade/ui/pdf-viewer").then((mod) => ({ default: mod.PdfStudyViewer })),
);
import { DispatchAdeDialog } from "../components/DispatchAdeDialog.tsx";
import {
  DocumentDetailSkeleton,
  OutlineTreeSkeleton,
} from "../components/ViewSkeletons.tsx";
import { DailyOutlineView } from "./DailyOutlineView.tsx";
import { DocumentHeaderBar } from "./document-detail/DocumentHeaderBar.tsx";
import { DocumentOutlineSidebarPanel } from "./document-detail/DocumentOutlineSidebarPanel.tsx";
import { DocumentReviewPanels } from "./document-detail/DocumentReviewPanels.tsx";
import {
  DocumentShareDialog,
  MobileTocDrawer,
} from "./document-detail/DocumentShareAndTocDrawers.tsx";
import { DocumentSplitPane } from "./document-detail/DocumentSplitPane.tsx";
import { OutlineTickScrubber } from "./document-detail/OutlineTickScrubber.tsx";
import {
  type DocumentDetailViewProps,
  EMPTY_BINDINGS,
  EMPTY_HIGHLIGHTS,
} from "./document-detail/types.ts";
import { useDocumentDetailState } from "./document-detail/useDocumentDetailState.ts";

export type { DocumentDetailViewProps };

export function DocumentDetailView(props: DocumentDetailViewProps): React.ReactElement {
  const state = useDocumentDetailState(props);
  const {
    t,
    client,
    navigation,
    hostActions,
    hostActionsRef,
    notifier,
    queryClient,
    isReadOnly,
    inspectorOpen,
    effectiveTheme,
    yjsOfflineEnabled,
    typographyPrefs,
    readerMeasure,
    isLgUp,
    isXlUp,
    editorMode,
    setEditorMode,
    showFormatBar,
    setShowFormatBar,
    findOpen,
    setFindOpen,
    highlightedNodeId,
    activeHighlightId,
    setActiveHighlightId,
    highlightStatusFilter,
    setHighlightStatusFilter,
    setSelectedReaderQuote,
    commentsByHighlightId,
    onlineBridgeSessions,
    showAgentDiff,
    setShowAgentDiff,
    setReviewMode,
    hasConflict,
    dispatchTarget,
    setDispatchTarget,
    mobileTocOpen,
    setMobileTocOpen,
    shareOpen,
    setShareOpen,
    primaryScrollRef,
    primaryContentRef,
    editorRef,
    titleRef,
    activeHeadingStore,
    latestDraftRef,
    setDraftMarkdown,
    isDirty,
    setIsDirty,
    autosaveStatus,
    editorHostRef,
    editorAnchorPositions,
    splitMode,
    spaces,
    workspaceDocs,
    docQuery,
    doc,
    pdfAsset,
    activePdfPage,
    activePdfAnnotationId,
    distillingPdfPage,
    fetchPdfBytes,
    handleCreatePdfAnnotation,
    handleDeletePdfAnnotation,
    handleDistillPdfPage,
    handleOpenPdfCitation,
    handleSearchWorkspaceNodes,
    handleCreateOutlineMirror,
    handleCopyBlockLink,
    handleOpenBlockDeepLink,
    handleOpenMirroredSource,
    editing,
    bindingsQuery,
    highlightsQuery,
    templatesQuery,
    primaryOutlineNodesQuery,
    shareLinksQuery,
    canonicalEditorBody,
    toc,
    readingStats,
    isSplitOpen,
    activeShareLinks,
    buildPublicShareUrl,
    revisionCount,
    openDispatch,
    openBindingTarget,
    handleTypographyChange,
    handleImmediateSave,
    handleOpenWikilink,
    scrollToHeading,
    scrollToHighlight,
    handleOpenThreadsTab,
    quickShareMutation,
    revokeShareLinkMutation,
    handlePrimaryOutlineBatch,
    saveMutation,
    markAgentReadMutation,
    createHighlightMutation,
    updateHighlightMutation,
    deleteHighlightMutation,
    deliveryReceipts,
    addCommentMutation,
    sendHighlightToAgentMutation,
    handleAddHighlightComment,
    handleSendHighlightToAgent,
    resolveHighlightMutation,
    reopenHighlightMutation,
    createMissingDocMutation,
    handleExcerptToDaily,
  } = state;

  const handleQueryInkadeView = useCallback(
    (spec: ViewQueryRequestInput) => client.views.query(spec),
    [client],
  );

  const handleIssueArtifactTicket = useCallback(
    (artifactId: Parameters<typeof client.artifacts.issueSandboxTicket>[0]) =>
      client.artifacts.issueSandboxTicket(artifactId),
    [client],
  );

  const handleSubmitArtifactComment = useCallback(
    (
      artifactId: Parameters<typeof client.artifacts.submitComment>[0],
      input: Parameters<typeof client.artifacts.submitComment>[1],
    ) => client.artifacts.submitComment(artifactId, input),
    [client],
  );

  const handleOpenSecuritySettings = useCallback(() => {
    navigation.openSettings?.("security");
  }, [navigation]);

  useEffect(() => {
    const actions = hostActionsRef.current;
    if (!doc) {
      actions.registerDocSidebarPanel?.(null);
      return;
    }
    const docHighlights = highlightsQuery.data ?? EMPTY_HIGHLIGHTS;
    const docBindings = bindingsQuery.data ?? EMPTY_BINDINGS;
    actions.registerDocSidebarPanel?.(
      <DocumentOutlineSidebarPanel
        bindings={docBindings}
        highlights={docHighlights}
        onOpenThreadsTab={handleOpenThreadsTab}
        onScrollToHeading={scrollToHeading}
        onScrollToHighlight={scrollToHighlight}
        store={activeHeadingStore}
        toc={toc}
      />,
    );
  }, [
    doc,
    toc,
    highlightsQuery.data,
    bindingsQuery.data,
    scrollToHeading,
    scrollToHighlight,
    handleOpenThreadsTab,
    activeHeadingStore,
    hostActionsRef,
  ]);

  useEffect(() => {
    const actions = hostActionsRef.current;
    return () => {
      actions.registerDocSidebarPanel?.(null);
      actions.setSidebarMode?.("tree");
    };
  }, [hostActionsRef]);

  if (docQuery.isPending) {
    return <DocumentDetailSkeleton isSplitOpen={isLgUp && splitMode !== "closed"} />;
  }

  if (docQuery.isError) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center justify-center p-8">
        <Empty className="w-full rounded-xl border border-dashed py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertTriangleIcon />
            </EmptyMedia>
            <EmptyTitle>{t("document.loadFailedTitle")}</EmptyTitle>
            <EmptyDescription>
              {docQuery.error instanceof Error
                ? docQuery.error.message
                : t("document.loadFailedDesc")}
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => void docQuery.refetch()} size="sm">
            {t("common.retry")}
          </Button>
        </Empty>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {t("document.notFoundOrForbidden")}
      </div>
    );
  }

  if (doc.kind === "outline" && doc.dailyDate) {
    return (
      <ScrollArea className="h-full min-h-0" overscrollContain>
        <div className="pb-4 md:pb-6">
          <DailyOutlineView date={doc.dailyDate} readonly={isReadOnly} />
        </div>
      </ScrollArea>
    );
  }

  const useStandaloneSplitGroup =
    Boolean(isSplitOpen) && !hostActions.workspaceSplitManaged && doc !== null;

  const primaryScrollContent = (
    <ScrollArea className="h-full min-h-0 min-w-0 flex-1" overscrollContain viewportRef={primaryScrollRef}>
        <div
          className={cn(
            "min-h-full w-full",
            typographyPrefs.paper === "sepia" && "inkade-paper-sepia",
          )}
          data-paper={typographyPrefs.paper === "sepia" ? "sepia" : undefined}
          data-slot="document-canvas"
        >
          <div
            className={cn(
              "mx-auto flex w-full flex-col gap-3 px-4 pt-0 pb-3.5 lg:px-8",
              pdfAsset
                ? "max-w-none"
                : isSplitOpen
                  ? "max-w-4xl"
                  : readerMeasure === "full"
                    ? "max-w-none"
                    : "max-w-6xl",
            )}
          >
            <DocumentHeaderBar state={state} />

            <DocumentReviewPanels state={state} />

            <div className="relative flex items-start gap-4">
              <div
                className="min-w-0 flex-1"
                data-reader-font={typographyPrefs.fontFamily}
                data-reader-measure={typographyPrefs.measure}
                ref={primaryContentRef}
                style={{
                  fontFamily:
                    typographyPrefs.fontFamily === "serif"
                      ? "var(--font-serif)"
                      : typographyPrefs.fontFamily === "mono"
                        ? "var(--font-mono)"
                        : undefined,
                }}
              >
                {(doc.kind === "outline" || !editing) && (
                  <DocumentFindBar
                    canReplace={false}
                    containerRef={primaryContentRef}
                    onClose={() => setFindOpen(false)}
                    open={findOpen}
                  />
                )}
                {doc.kind === "outline" ? (
                  primaryOutlineNodesQuery.isPending ? (
                    <OutlineTreeSkeleton rows={6} showToolbar />
                  ) : pdfAsset ? (
                    <div
                      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
                      data-slot="pdf-study-split"
                    >
                      <div className="flex h-[65vh] min-h-[420px] flex-col overflow-hidden rounded-xl border border-border/80 bg-muted/20 lg:sticky lg:top-3 lg:h-[calc(100vh-10.5rem)]">
                        <Suspense
                          fallback={
                            <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
                              {t("pdfStudy.loadingPdf")}
                            </div>
                          }
                        >
                          <LazyPdfStudyViewer
                            annotations={pdfAsset.annotations}
                            assetId={pdfAsset.id}
                            distillingPage={distillingPdfPage}
                            fetchPdfBytes={fetchPdfBytes}
                            focusAnnotationId={activePdfAnnotationId}
                            focusPage={activePdfPage}
                            onCreateAnnotation={handleCreatePdfAnnotation}
                            onDeleteAnnotation={handleDeletePdfAnnotation}
                            onDistillPage={handleDistillPdfPage}
                            readOnly={isReadOnly}
                          />
                        </Suspense>
                      </div>
                      <div className="min-w-0">
                        <ProseMirrorOutlineEditor
                          bindings={bindingsQuery.data ?? []}
                          documentId={doc.id}
                          hideRootBreadcrumbTitle
                          highlightedNodeId={highlightedNodeId}
                          nodes={primaryOutlineNodesQuery.data ?? []}
                          onBatchMutate={handlePrimaryOutlineBatch}
                          onClickTag={(tag) => navigation.openLibrary({ tag })}
                          onCopyBlockLink={(nodeId, deepLink) =>
                            handleCopyBlockLink(nodeId, deepLink)
                          }
                          onCreateMirror={handleCreateOutlineMirror}
                          onDispatchToAde={(node) =>
                            openDispatch({
                              documentId: doc.id,
                              documentTitle: doc.title,
                              nodeId: node.id,
                              excerpt: node.contentText || node.contentMarkdown,
                            })
                          }
                          onOpenBlockDeepLink={handleOpenBlockDeepLink}
                          onOpenDocument={(targetSlugOrId) => handleOpenWikilink(targetSlugOrId)}
                          onOpenMirroredSource={(mirrorId) => void handleOpenMirroredSource(mirrorId)}
                          onOpenPdfCitation={handleOpenPdfCitation}
                          onSearchWorkspaceNodes={handleSearchWorkspaceNodes}
                          readOnly={isReadOnly}
                          rootTitle={doc.title}
                          workspaceDocs={workspaceDocs}
                        />
                        {(primaryOutlineNodesQuery.data ?? []).length <= 1 ? (
                          <p className="mt-3 rounded-lg border border-dashed border-border/75 bg-muted/15 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                            {t("pdfStudy.outlineCompanionHint")}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <ProseMirrorOutlineEditor
                      bindings={bindingsQuery.data ?? []}
                      documentId={doc.id}
                      hideRootBreadcrumbTitle
                      highlightedNodeId={highlightedNodeId}
                      nodes={primaryOutlineNodesQuery.data ?? []}
                      onBatchMutate={handlePrimaryOutlineBatch}
                      onClickTag={(tag) => navigation.openLibrary({ tag })}
                      onCopyBlockLink={(nodeId, deepLink) =>
                        handleCopyBlockLink(nodeId, deepLink)
                      }
                      onCreateMirror={handleCreateOutlineMirror}
                      onDispatchToAde={(node) =>
                        openDispatch({
                          documentId: doc.id,
                          documentTitle: doc.title,
                          nodeId: node.id,
                          excerpt: node.contentText || node.contentMarkdown,
                        })
                      }
                      onOpenBlockDeepLink={handleOpenBlockDeepLink}
                      onOpenDocument={(targetSlugOrId) => handleOpenWikilink(targetSlugOrId)}
                      onOpenMirroredSource={(mirrorId) => void handleOpenMirroredSource(mirrorId)}
                      onOpenPdfCitation={handleOpenPdfCitation}
                      onSearchWorkspaceNodes={handleSearchWorkspaceNodes}
                      readOnly={isReadOnly}
                      rootTitle={doc.title}
                      workspaceDocs={workspaceDocs}
                    />
                  )
                ) : editing ? (
                  <div className="flex items-start gap-6">
                    <div className="min-w-0 flex-1" ref={editorHostRef}>
                      <ArticleEditor
                        activeHighlightId={activeHighlightId}
                        autosaveStatus={autosaveStatus}
                        bindings={bindingsQuery.data ?? EMPTY_BINDINGS}
                        borderless
                        defaultShowToolbar={false}
                        document={doc}
                        findOpen={findOpen}
                        fontSize={typographyPrefs.fontSize}
                        hasVersionConflict={hasConflict}
                        hideTopChrome
                        highlights={highlightsQuery.data ?? EMPTY_HIGHLIGHTS}
                        isDirty={isDirty}
                        mentionDocuments={workspaceDocs}
                        mode={editorMode}
                        onAiRewriteStream={({
                          action,
                          prompt,
                          selectedText,
                          fullMarkdown,
                          onDelta,
                          signal,
                        }) =>
                          client.ai.rewriteStream(
                            {
                              documentId: doc.id,
                              docTitle: doc.title,
                              action,
                              ...(prompt ? { prompt } : {}),
                              selectedText,
                              contextMarkdown: fullMarkdown,
                            },
                            { onDelta, signal },
                          )
                        }
                        onAskAgent={(anchor) =>
                          openDispatch({
                            documentId: doc.id,
                            documentTitle: doc.title,
                            selectionAnchor: anchor,
                            excerpt: anchor.quote,
                            defaultTitle: t("document.askPrefix", {
                              quote: anchor.quote.slice(0, 60),
                            }),
                          })
                        }
                        onBindAdeThread={(query) =>
                          openDispatch({
                            documentId: doc.id,
                            documentTitle: doc.title,
                            excerpt: query.trim() || doc.title,
                            defaultTitle: query.trim() || doc.title,
                          })
                        }
                        onChangeMarkdown={(next) => {
                          latestDraftRef.current = next;
                          setDraftMarkdown(next);
                          setIsDirty(next !== canonicalEditorBody);
                        }}
                        onCreateHighlight={(input) =>
                          createHighlightMutation.mutate({
                            quote: input.quote,
                            prefixContext: input.prefixContext,
                            suffixContext: input.suffixContext,
                            color: input.color,
                            ...(input.noteMarkdown !== undefined
                              ? { noteMarkdown: input.noteMarkdown }
                              : {}),
                          })
                        }
                        onCreateLinkedDocument={async ({ title, kind }) => {
                          try {
                            const created = await client.documents.create({
                              spaceId: doc.spaceId,
                              kind,
                              title,
                              contentMarkdown: kind === "article" ? `# ${title}\n\n` : undefined,
                            });
                            await queryClient.refetchQueries({
                              queryKey: [...inkadeQueryKeys.all, "documents"],
                            });
                            void queryClient.invalidateQueries({
                              queryKey: inkadeQueryKeys.workspaceSummary(),
                            });
                            notifier.success(
                              t("document.createdFromWikilink", { title: created.title }),
                            );
                            return { id: created.id, title: created.title };
                          } catch (err) {
                            notifier.error(t("document.createDocFailed"), err);
                            return null;
                          }
                        }}
                        onCreateMissingDoc={(title) => createMissingDocMutation.mutate(title)}
                        onDispatchAde={({ anchor, instruction }) =>
                          openDispatch({
                            documentId: doc.id,
                            documentTitle: doc.title,
                            selectionAnchor: anchor,
                            excerpt: instruction ? `${anchor.quote}\n\n${instruction}` : anchor.quote,
                            defaultTitle: instruction
                              ? instruction.slice(0, 72)
                              : t("document.askPrefix", { quote: anchor.quote.slice(0, 60) }),
                          })
                        }
                        onFindOpenChange={setFindOpen}
                        onFocusTitle={() => titleRef.current?.focusEnd()}
                        onHighlightSelection={({ quote, color }) =>
                          createHighlightMutation.mutate({
                            quote,
                            prefixContext: "",
                            suffixContext: "",
                            color,
                          })
                        }
                        onIssueArtifactTicket={handleIssueArtifactTicket}
                        onModeChange={setEditorMode}
                        onOpenAiSettings={() => navigation.openSettings?.("rag")}
                        onOpenBinding={(binding) => {
                          openBindingTarget(binding);
                        }}
                        onOpenDocument={(targetId) => navigation.openDocument(targetId)}
                        onOpenSecuritySettings={handleOpenSecuritySettings}
                        onOpenWikilink={handleOpenWikilink}
                        onQueryInkadeView={handleQueryInkadeView}
                        onSubmitArtifactComment={handleSubmitArtifactComment}
                        onResolveConflict={() => hostActions.openInspectorTab?.("revisions")}
                        onSave={handleImmediateSave}
                        onSelectHighlight={(hlId) => setActiveHighlightId(hlId)}
                        onShowToolbarChange={setShowFormatBar}
                        onUploadFile={async (file) => {
                          const bytes = new Uint8Array(await file.arrayBuffer());
                          const uploaded = await client.attachments.upload({
                            documentId: doc.id,
                            filename: file.name,
                            mimeType: file.type || "application/octet-stream",
                            data: bytes,
                          });
                          return {
                            url: uploaded.downloadUrl,
                            filename: uploaded.attachment.filename,
                          };
                        }}
                        paperMode={typographyPrefs.paper}
                        readerFont={typographyPrefs.fontFamily}
                        readerMeasure={typographyPrefs.measure}
                        ref={editorRef}
                        saving={saveMutation.isPending}
                        serverSyncToken={doc.updatedAt}
                        showToolbar={showFormatBar}
                        spaces={spaces}
                        stripDuplicateTitle
                        suppressInnerSepiaBox
                        templates={templatesQuery.data ?? []}
                        theme={effectiveTheme}
                        workspaceDocs={workspaceDocs}
                      />

                      {(inspectorOpen || isSplitOpen || !isXlUp) &&
                        ((highlightsQuery.data ?? EMPTY_HIGHLIGHTS).length > 0 ||
                          (bindingsQuery.data ?? EMPTY_BINDINGS).some((b) =>
                            Boolean(b.selectionAnchor?.quote),
                          )) && (
                          <MarginaliaOverlay
                            activeHighlightId={activeHighlightId}
                            anchorPositions={editorAnchorPositions}
                            bindings={bindingsQuery.data ?? EMPTY_BINDINGS}
                            bridgeSessions={onlineBridgeSessions}
                            commentsByHighlightId={commentsByHighlightId}
                            deliveryReceipts={deliveryReceipts}
                            highlights={highlightsQuery.data ?? EMPTY_HIGHLIGHTS}
                            mode="inline"
                            onAddComment={handleAddHighlightComment}
                            onAskFromHighlight={(hl) =>
                              openDispatch({
                                documentId: doc.id,
                                documentTitle: doc.title,
                                selectionAnchor: { quote: hl.quote },
                                excerpt: hl.quote,
                                defaultTitle: t("document.askPrefix", {
                                  quote: hl.quote.slice(0, 60),
                                }),
                              })
                            }
                            onDeleteHighlight={(id) => deleteHighlightMutation.mutate(id)}
                            onOpenBinding={(binding) => {
                              openBindingTarget(binding);
                            }}
                            onReopenHighlight={(highlightId) =>
                              reopenHighlightMutation.mutate({ highlightId, documentId: doc.id })
                            }
                            onResolveHighlight={(highlightId) =>
                              resolveHighlightMutation.mutate({ highlightId, documentId: doc.id })
                            }
                            onSelectHighlight={scrollToHighlight}
                            onSendToAgent={handleSendHighlightToAgent}
                            onStatusFilterChange={setHighlightStatusFilter}
                            onUpdateHighlight={(highlightId, patch) =>
                              updateHighlightMutation.mutate({ highlightId, patch })
                            }
                            readOnly={isReadOnly}
                            replyingHighlightId={
                              addCommentMutation.isPending
                                ? (addCommentMutation.variables?.highlightId ?? null)
                                : null
                            }
                            sendingHighlightId={
                              sendHighlightToAgentMutation.isPending
                                ? (sendHighlightToAgentMutation.variables?.highlightId ?? null)
                                : null
                            }
                            statusFilter={highlightStatusFilter}
                          />
                        )}
                    </div>

                    {!inspectorOpen &&
                      !isSplitOpen &&
                      ((highlightsQuery.data ?? EMPTY_HIGHLIGHTS).length > 0 ||
                        (bindingsQuery.data ?? EMPTY_BINDINGS).some((b) =>
                          Boolean(b.selectionAnchor?.quote),
                        )) && (
                        <div className="hidden flex-col gap-6 xl:flex">
                          <MarginaliaOverlay
                            activeHighlightId={activeHighlightId}
                            anchorPositions={editorAnchorPositions}
                            bindings={bindingsQuery.data ?? EMPTY_BINDINGS}
                            bridgeSessions={onlineBridgeSessions}
                            commentsByHighlightId={commentsByHighlightId}
                            deliveryReceipts={deliveryReceipts}
                            highlights={highlightsQuery.data ?? EMPTY_HIGHLIGHTS}
                            mode="rail"
                            onAddComment={handleAddHighlightComment}
                            onAskFromHighlight={(hl) =>
                              openDispatch({
                                documentId: doc.id,
                                documentTitle: doc.title,
                                selectionAnchor: { quote: hl.quote },
                                excerpt: hl.quote,
                                defaultTitle: t("document.askPrefix", {
                                  quote: hl.quote.slice(0, 60),
                                }),
                              })
                            }
                            onDeleteHighlight={(id) => deleteHighlightMutation.mutate(id)}
                            onOpenBinding={(binding) => {
                              openBindingTarget(binding);
                            }}
                            onReopenHighlight={(highlightId) =>
                              reopenHighlightMutation.mutate({ highlightId, documentId: doc.id })
                            }
                            onResolveHighlight={(highlightId) =>
                              resolveHighlightMutation.mutate({ highlightId, documentId: doc.id })
                            }
                            onSelectHighlight={scrollToHighlight}
                            onSendToAgent={handleSendHighlightToAgent}
                            onStatusFilterChange={setHighlightStatusFilter}
                            onUpdateHighlight={(highlightId, patch) =>
                              updateHighlightMutation.mutate({ highlightId, patch })
                            }
                            readOnly={isReadOnly}
                            replyingHighlightId={
                              addCommentMutation.isPending
                                ? (addCommentMutation.variables?.highlightId ?? null)
                                : null
                            }
                            sendingHighlightId={
                              sendHighlightToAgentMutation.isPending
                                ? (sendHighlightToAgentMutation.variables?.highlightId ?? null)
                                : null
                            }
                            statusFilter={highlightStatusFilter}
                          />
                        </div>
                      )}
                  </div>
                ) : (
                  <ArticleReader
                    activeHighlightId={activeHighlightId}
                    bindings={bindingsQuery.data ?? EMPTY_BINDINGS}
                    bridgeSessions={onlineBridgeSessions}
                    commentsByHighlightId={commentsByHighlightId}
                    deliveryReceipts={deliveryReceipts}
                    document={{ ...doc, unreadAgentUpdate: false }}
                    enableKeyboardNav={!showAgentDiff}
                    hideTitleHeader
                    highlights={highlightsQuery.data ?? EMPTY_HIGHLIGHTS}
                    onAddComment={handleAddHighlightComment}
                    onAskAgent={(anchor) =>
                      openDispatch({
                        documentId: doc.id,
                        documentTitle: doc.title,
                        selectionAnchor: anchor,
                        excerpt: anchor.quote,
                        defaultTitle: t("document.askPrefix", { quote: anchor.quote.slice(0, 60) }),
                      })
                    }
                    onChangeTypographyPrefs={handleTypographyChange}
                    onCreateHighlight={(input) => createHighlightMutation.mutate(input)}
                    onCreateMissingDoc={(title) => createMissingDocMutation.mutate(title)}
                    onDeleteHighlight={(id) => deleteHighlightMutation.mutate(id)}
                    onExcerptToDaily={(anchor, mdQuote) =>
                      void handleExcerptToDaily(anchor, mdQuote)
                    }
                    onIssueArtifactTicket={handleIssueArtifactTicket}
                    onMarkAgentUpdateRead={() => markAgentReadMutation.mutate()}
                    onOpenBinding={(binding) => {
                      openBindingTarget(binding);
                    }}
                    onOpenDocument={(targetId) => navigation.openDocument(targetId)}
                    onOpenSecuritySettings={handleOpenSecuritySettings}
                    onOpenWikilink={handleOpenWikilink}
                    onQueryInkadeView={handleQueryInkadeView}
                    onReopenHighlight={(highlightId) =>
                      reopenHighlightMutation.mutate({ highlightId, documentId: doc.id })
                    }
                    onResolveHighlight={(highlightId) =>
                      resolveHighlightMutation.mutate({ highlightId, documentId: doc.id })
                    }
                    onSelectHighlight={(hlId) => setActiveHighlightId(hlId)}
                    onSelectionQuoteChange={setSelectedReaderQuote}
                    onSendToAgent={handleSendHighlightToAgent}
                    onStatusFilterChange={setHighlightStatusFilter}
                    onSubmitArtifactComment={handleSubmitArtifactComment}
                    onUpdateHighlight={(highlightId, patch) =>
                      updateHighlightMutation.mutate({ highlightId, patch })
                    }
                    onViewDiff={() => {
                      setReviewMode("inline");
                      setShowAgentDiff((prev) => !prev);
                    }}
                    readOnly={isReadOnly}
                    readerFont={typographyPrefs.fontFamily}
                    readerFontSize={typographyPrefs.fontSize}
                    readerMeasure={typographyPrefs.measure}
                    replyingHighlightId={
                      addCommentMutation.isPending
                        ? (addCommentMutation.variables?.highlightId ?? null)
                        : null
                    }
                    sendingHighlightId={
                      sendHighlightToAgentMutation.isPending
                        ? (sendHighlightToAgentMutation.variables?.highlightId ?? null)
                        : null
                    }
                    showMarginaliaRail={!inspectorOpen && !isSplitOpen}
                    showToc={false}
                    spaces={spaces}
                    statusFilter={highlightStatusFilter}
                    suppressInnerSepiaBox
                    theme={effectiveTheme}
                    typographyPrefs={typographyPrefs}
                    workspaceDocs={workspaceDocs}
                  />
                )}
              </div>

              {doc.kind !== "outline" && toc.length >= 2 && (
                <OutlineTickScrubber
                  ariaLabel={t("reader.tickScrubberAria")}
                  isSplitOpen={isSplitOpen}
                  onScrollToHeading={scrollToHeading}
                  outlineTitle={t("reader.sidebarOutlineTitle")}
                  store={activeHeadingStore}
                  toc={toc}
                />
              )}
            </div>

            <footer
              className={cn(
                "mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3 text-[11px] text-foreground/70",
                "pb-6 md:pb-2",
              )}
              data-testid="document-status-bar"
            >
              <div className="flex flex-wrap items-center gap-2.5 tabular-nums">
                {doc.kind !== "outline" && (
                  <>
                    <span>
                      {t("document.statusWordCharCount", {
                        words: readingStats.wordCount,
                        chars: readingStats.charCount,
                      })}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{t("reader.readingTime", { minutes: readingStats.minutes })}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      yjsOfflineEnabled ? "bg-success-foreground" : "bg-muted-foreground/50",
                    )}
                  />
                  <span>
                    {yjsOfflineEnabled
                      ? t("document.statusYjsLocalEnabled")
                      : t("document.statusYjsLocalDisabled")}
                  </span>
                </span>
              </div>

              <button
                className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 font-mono transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => hostActions.openInspectorTab?.("revisions")}
                title={t("document.statusRevisionsCount", { count: revisionCount })}
                type="button"
              >
                <span>{t("common.version", { version: doc.version })}</span>
              </button>
            </footer>
          </div>
        </div>
      </ScrollArea>
  );

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      {useStandaloneSplitGroup ? (
        <Group
          className="flex h-full min-h-0 w-full"
          defaultLayout={{ primary: 62, split: 38 }}
          orientation="horizontal"
        >
          <Panel className="flex min-h-0 min-w-0 flex-col" defaultSize="62%" id="primary" minSize="35%">
            {primaryScrollContent}
          </Panel>
          <Separator
            aria-label={t("document.splitPaneHeader")}
            className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40 focus-visible:outline-none"
          />
          <Panel
            className="flex min-h-0 min-w-0 flex-col"
            defaultSize="38%"
            id="split"
            maxSize="65%"
            minSize="25%"
          >
            <DocumentSplitPane state={state} />
          </Panel>
        </Group>
      ) : (
        primaryScrollContent
      )}

      <MobileTocDrawer
        onOpenChange={setMobileTocOpen}
        onScrollToHeading={scrollToHeading}
        open={mobileTocOpen}
        toc={toc}
        visible={doc.kind !== "outline"}
      />

      <DocumentShareDialog
        activeShareLinks={activeShareLinks}
        buildPublicShareUrl={buildPublicShareUrl}
        creatingLink={quickShareMutation.isPending}
        docTitle={doc.title}
        isPendingLinks={shareLinksQuery.isPending}
        onCreateShareLink={() => quickShareMutation.mutate()}
        onOpenChange={setShareOpen}
        onOpenInspector={() => {
          setShareOpen(false);
          hostActions.openInspectorTab?.("backlinks");
        }}
        onRevokeShareLink={(shareLinkId) => revokeShareLinkMutation.mutate(shareLinkId)}
        open={shareOpen}
        revokingShareLinkId={
          revokeShareLinkMutation.isPending ? (revokeShareLinkMutation.variables ?? null) : null
        }
      />

      <DispatchAdeDialog onClose={() => setDispatchTarget(null)} target={dispatchTarget} />

      {doc.kind !== "outline" && (
        <PresentationModal
          bindings={bindingsQuery.data ?? EMPTY_BINDINGS}
          markdown={editing ? state.draftMarkdown || doc.contentMarkdown : doc.contentMarkdown}
          onIssueArtifactTicket={handleIssueArtifactTicket}
          onOpenChange={state.setPresentationOpen}
          onOpenDocument={(targetId) => {
            state.setPresentationOpen(false);
            navigation.openDocument(targetId);
          }}
          onOpenSecuritySettings={handleOpenSecuritySettings}
          onOpenWikilink={(targetSlugOrTitle, event) => {
            state.setPresentationOpen(false);
            handleOpenWikilink(targetSlugOrTitle, event);
          }}
          onQueryInkadeView={handleQueryInkadeView}
          onSubmitArtifactComment={handleSubmitArtifactComment}
          open={state.presentationOpen}
          spaces={spaces}
          theme={effectiveTheme}
          title={doc.title}
          typographyPrefs={typographyPrefs}
          workspaceDocs={workspaceDocs}
        />
      )}
    </div>
  );
}
