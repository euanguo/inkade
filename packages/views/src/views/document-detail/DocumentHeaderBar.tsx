import {
  Badge,
  Button,
  cn,
  Collapsible,
  CollapsibleTrigger,
  DocumentKindIcon,
  Input,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
  SpaceIcon,
  TagPill,
  TypographyPopover,
} from "@inkade/ui";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  Code2Icon,
  Columns2Icon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileCode2Icon,
  FileTextIcon,
  FolderInputIcon,
  ListIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PresentationIcon,
  PrinterIcon,
  SaveIcon,
  SearchIcon,
  SendIcon,
  Share2Icon,
  TagIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useLayoutEffect, useRef } from "react";
import { InlineDocumentTitle } from "../../components/InlineDocumentTitle.tsx";
import { DocumentPropertiesPanel } from "./DocumentPropertiesPanel.tsx";
import type { DocumentDetailState } from "./useDocumentDetailState.ts";

export function DocumentHeaderBar({
  state,
}: {
  readonly state: DocumentDetailState;
}): React.ReactElement | null {
  const {
    t,
    navigation,
    hostActions,
    isReadOnly,
    isLgUp,
    doc,
    hideHeaderActions,
    editing,
    editorMode,
    showFormatBar,
    setShowFormatBar,
    findOpen,
    setFindOpen,
    isDirty,
    autosaveStatus,
    hasConflict,
    draftMarkdown,
    editorRef,
    titleRef,
    setViewModeOverride,
    typographyPrefs,
    handleTypographyChange,
    syncBacklinks,
    setSyncBacklinks,
    splitMode,
    setSplitMode,
    splitDocId,
    onExternalSplitClear,
    toc,
    setMobileTocOpen,
    setShareOpen,
    setPresentationOpen,
    tagInputOpen,
    setTagInputOpen,
    tagInput,
    setTagInput,
    propsOpen,
    setPropsOpen,
    addPropForm,
    editingPropKey,
    editingPropVal,
    setEditingPropKey,
    setEditingPropVal,
    spaceObj,
    spaceName,
    kindLabel,
    activeSpaces,
    customProps,
    availablePresets,
    updatedDisplay,
    openDispatch,
    shareViewerContext,
    setShareViewerContext,
    handleImmediateSave,
    handleExportMd,
    handleExportHtml,
    handleExportDocx,
    handlePrintPdf,
    saveMutation,
    updateTitleMutation,
    updateTagsMutation,
    updatePropsMutation,
    pinMutation,
    moveSpaceMutation,
    trashMutation,
  } = state;

  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagCommittedRef = useRef(false);
  const tagComposingRef = useRef(false);

  useLayoutEffect(() => {
    if (!tagInputOpen) return;
    tagCommittedRef.current = false;
    tagInputRef.current?.focus();
  }, [tagInputOpen]);

  if (!doc) return null;

  const commitInlineTag = (): void => {
    const clean = tagInput.trim().replace(/^#+/, "");
    if (clean && !doc.tags.includes(clean)) {
      updateTagsMutation.mutate([...doc.tags, clean]);
    }
    setTagInput("");
    setTagInputOpen(false);
  };

  return (
    <>
      <div
        className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b border-border/45 bg-background/95 px-4 py-2.5 backdrop-blur-sm lg:-mx-8 lg:px-8"
        data-testid="document-sticky-topbar"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <button
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground/85 transition-colors hover:bg-accent"
            onClick={() => navigation.openSpace(doc.spaceId)}
            type="button"
          >
            {spaceObj ? (
              <SpaceIcon color={spaceObj.color} icon={spaceObj.icon} size="xs" />
            ) : null}
            <span>{spaceName}</span>
          </button>
          <Badge size="sm" variant="secondary">
            <DocumentKindIcon kind={doc.kind} size="xs" />
            {kindLabel}
          </Badge>
          {doc.pinned && (
            <Badge size="sm" variant="info">
              {t("common.pinned")}
            </Badge>
          )}
          <span className="hidden tabular-nums sm:inline">
            {t("document.updatedAtLabel", { time: updatedDisplay })}
          </span>
          {editing && autosaveStatus !== "idle" && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/85"
              data-testid="document-autosave-status"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  autosaveStatus === "saving"
                    ? "animate-pulse bg-info"
                    : autosaveStatus === "saved"
                      ? "bg-success"
                      : "bg-warning",
                )}
              />
              {autosaveStatus === "saving"
                ? t("editor.autosaveSaving")
                : autosaveStatus === "saved"
                  ? t("editor.autosaveSaved")
                  : t("editor.autosaveUnsaved")}
            </span>
          )}
        </div>

        {!hideHeaderActions && (
          <div
            className="flex shrink-0 items-center gap-1.5"
            data-testid="document-header-actions"
          >
            <Button
              aria-label={t("editor.findActionAria")}
              onClick={() => setFindOpen((prev) => !prev)}
              size="icon-xs"
              title={t("editor.findActionAria")}
              type="button"
              variant={findOpen ? "secondary" : "ghost"}
            >
              <SearchIcon />
            </Button>
            {doc.kind !== "outline" && toc.length > 0 && (
              <Button
                aria-label={t("document.tocAria")}
                className="lg:hidden"
                onClick={() => setMobileTocOpen(true)}
                size="xs"
                title={t("document.tocAria")}
                type="button"
                variant="outline"
              >
                <ListIcon />
                <span className="hidden sm:inline">{t("document.tocLabel")}</span>
              </Button>
            )}
            <TypographyPopover
              onChange={handleTypographyChange}
              value={typographyPrefs}
            />
            {doc.kind !== "outline" && (
              <Button
                aria-label={t("document.presentActionAria")}
                data-testid="document-presentation-btn"
                onClick={() => setPresentationOpen(true)}
                size="xs"
                title={t("document.presentActionAria")}
                type="button"
                variant="ghost"
              >
                <PresentationIcon />
                <span className="hidden sm:inline">{t("document.presentAction")}</span>
              </Button>
            )}
            {doc.kind !== "outline" && !isReadOnly && editing && (
              <>
                {editorMode === "source" ? (
                  <Button
                    aria-label={t("editor.richModeToggle")}
                    onClick={() => editorRef.current?.setMode("rich")}
                    size="xs"
                    title={t("editor.richModeToggle")}
                    type="button"
                    variant="secondary"
                  >
                    <Code2Icon />
                    <span className="hidden sm:inline">{t("editor.richModeToggle")}</span>
                  </Button>
                ) : (
                  <Button
                    aria-label={t("editor.toggleFormatToolbar")}
                    aria-pressed={showFormatBar}
                    onClick={() => setShowFormatBar((prev) => !prev)}
                    onMouseDown={(e) => e.preventDefault()}
                    size="xs"
                    title={t("editor.toggleFormatToolbar")}
                    type="button"
                    variant={showFormatBar ? "secondary" : "ghost"}
                  >
                    <span className="font-serif text-xs font-semibold">
                      {t("editor.formatToolbarBadge")}
                    </span>
                  </Button>
                )}

                {isDirty && (
                  <Button
                    disabled={hasConflict}
                    loading={saveMutation.isPending}
                    onClick={() =>
                      handleImmediateSave(
                        editorRef.current?.flushMarkdown() ?? draftMarkdown,
                        doc.version,
                      )
                    }
                    size="xs"
                    type="button"
                    variant="default"
                  >
                    <SaveIcon />
                    {t("common.save")}
                  </Button>
                )}

                <Button
                  onClick={() => {
                    if (isDirty) {
                      handleImmediateSave(
                        editorRef.current?.flushMarkdown() ?? draftMarkdown,
                        doc.version,
                      );
                    }
                    setViewModeOverride("read");
                  }}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  <BookOpenIcon />
                  <span className="hidden sm:inline">{t("editor.readingLockMode")}</span>
                </Button>
              </>
            )}

            {doc.kind !== "outline" && !isReadOnly && !editing && (
              <Button
                aria-label={
                  doc.kind === "clip" ? t("editor.clipUnlockEdit") : t("editor.resumeDirectEdit")
                }
                onClick={() => setViewModeOverride("edit")}
                size="xs"
                title={
                  doc.kind === "clip" ? t("editor.clipUnlockEdit") : t("editor.resumeDirectEdit")
                }
                type="button"
                variant="outline"
              >
                <PencilIcon />
                <span className="hidden sm:inline">
                  {doc.kind === "clip" ? t("editor.clipUnlockEdit") : t("editor.resumeDirectEdit")}
                </span>
              </Button>
            )}

            {!isReadOnly && (
              <Button
                aria-label={t("document.shareViewerContext")}
                aria-pressed={shareViewerContext}
                data-testid="toggle-share-viewer-context"
                onClick={() => setShareViewerContext((prev) => !prev)}
                size="xs"
                title={t("document.shareViewerContextTooltip")}
                type="button"
                variant={shareViewerContext ? "secondary" : "ghost"}
              >
                {shareViewerContext ? <EyeIcon /> : <EyeOffIcon />}
                <span className="hidden sm:inline">
                  {shareViewerContext
                    ? t("document.shareViewerContextActive")
                    : t("document.shareViewerContext")}
                </span>
              </Button>
            )}

            {!isReadOnly && (
              <Button
                aria-label={t("document.dispatchAde")}
                onClick={() =>
                  openDispatch({
                    documentId: doc.id,
                    documentTitle: doc.title,
                    excerpt: doc.excerpt || doc.contentText.slice(0, 240),
                  })
                }
                size="xs"
                title={t("document.dispatchAde")}
                type="button"
                variant="ghost"
              >
                <SendIcon />
                <span className="hidden sm:inline">{t("document.dispatchAde")}</span>
              </Button>
            )}

            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label={t("document.moreActionsAria")}
                    size="icon-xs"
                    title={t("document.moreActionsAria")}
                    variant="ghost"
                  />
                }
              >
                <MoreHorizontalIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                {doc.kind !== "outline" && editing && (
                  <>
                    <MenuItem
                      onClick={() =>
                        editorRef.current?.setMode(editorMode === "rich" ? "source" : "rich")
                      }
                    >
                      <Code2Icon />
                      <span>
                        {editorMode === "rich"
                          ? t("editor.sourceModeToggle")
                          : t("editor.richModeToggle")}
                      </span>
                    </MenuItem>
                    <MenuItem onClick={() => setSyncBacklinks((prev) => !prev)}>
                      <CheckIcon
                        className={cn(
                          "size-3.5 transition-opacity",
                          syncBacklinks ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span>{t("document.syncBacklinksAuto")}</span>
                    </MenuItem>
                    <MenuSeparator />
                  </>
                )}

                {isLgUp && (
                  <MenuItem
                    onClick={() => {
                      if (splitMode === "closed") {
                        setSplitMode(splitDocId ? "doc" : "daily");
                        hostActions.setInspectorOpen?.(false);
                      } else {
                        setSplitMode("closed");
                        onExternalSplitClear?.();
                      }
                    }}
                  >
                    <Columns2Icon />
                    <span>
                      {splitMode !== "closed"
                        ? t("document.splitPaneClose")
                        : t("document.splitPaneOpen")}
                    </span>
                  </MenuItem>
                )}

                <MenuItem onClick={() => setShareOpen(true)}>
                  <Share2Icon />
                  <span>{t("document.shareAction")}</span>
                </MenuItem>

                <MenuItem onClick={() => pinMutation.mutate(!doc.pinned)}>
                  {doc.pinned ? <PinOffIcon /> : <PinIcon />}
                  <span>{doc.pinned ? t("document.unpin") : t("document.pin")}</span>
                </MenuItem>

                <MenuSub>
                  <MenuSubTrigger>
                    <FolderInputIcon />
                    <span>{t("document.move")}</span>
                  </MenuSubTrigger>
                  <MenuSubPopup>
                    {activeSpaces.map((s) => (
                      <MenuItem
                        disabled={s.id === doc.spaceId}
                        key={s.id}
                        onClick={() => moveSpaceMutation.mutate(s.id)}
                      >
                        <SpaceIcon color={s.color} icon={s.icon} size="xs" tone="mono" />
                        <span>{s.name}</span>
                      </MenuItem>
                    ))}
                  </MenuSubPopup>
                </MenuSub>

                <MenuItem onClick={() => void handleExportMd()}>
                  <DownloadIcon />
                  <span>{t("document.exportMarkdownLabel")}</span>
                </MenuItem>

                <MenuItem onClick={() => void handleExportHtml()}>
                  <FileCode2Icon />
                  <span>{t("editor.exportHtmlAction")}</span>
                </MenuItem>

                <MenuItem
                  data-testid="document-export-docx-item"
                  onClick={() => void handleExportDocx()}
                >
                  <FileTextIcon />
                  <span>{t("document.exportDocxLabel")}</span>
                </MenuItem>

                <MenuItem onClick={handlePrintPdf}>
                  <PrinterIcon />
                  <span>{t("editor.exportPdfAction")}</span>
                </MenuItem>

                <MenuSeparator />

                <MenuItem onClick={() => trashMutation.mutate()} variant="destructive">
                  <Trash2Icon />
                  <span>{t("document.trashAria")}</span>
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        )}
      </div>

      <header className="flex flex-col gap-2 pt-1 pb-1">
        <InlineDocumentTitle
          documentId={doc.id}
          onCommitTitle={(nextTitle) =>
            updateTitleMutation.mutate({ title: nextTitle, syncBacklinks })
          }
          onEnterToBody={
            doc.kind !== "outline" && editing
              ? () => editorRef.current?.focusStart()
              : undefined
          }
          ref={titleRef}
          title={doc.title}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {doc.tags.map((tag) => (
            <span className="group/tag inline-flex items-center gap-0.5" key={tag}>
              <TagPill size="sm" tag={tag} />
              {!isReadOnly && (
                <button
                  aria-label={t("document.removeTagAria", { tag })}
                  className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full text-muted-foreground opacity-65 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100"
                  onClick={() =>
                    updateTagsMutation.mutate(doc.tags.filter((item) => item !== tag))
                  }
                  type="button"
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </span>
          ))}

          {!isReadOnly &&
            (tagInputOpen ? (
              <Input
                autoFocus
                className="w-28"
                onBlur={() => {
                  if (tagCommittedRef.current || tagComposingRef.current) return;
                  tagCommittedRef.current = true;
                  commitInlineTag();
                }}
                onChange={(e) => setTagInput(e.target.value)}
                onCompositionEnd={() => {
                  tagComposingRef.current = false;
                }}
                onCompositionStart={() => {
                  tagComposingRef.current = true;
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (tagComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) {
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    tagCommittedRef.current = true;
                    commitInlineTag();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    tagCommittedRef.current = true;
                    setTagInput("");
                    setTagInputOpen(false);
                  }
                }}
                placeholder={t("document.addTagPlaceholder")}
                ref={tagInputRef}
                size="xs"
                value={tagInput}
              />
            ) : (
              <Button
                onClick={() => setTagInputOpen(true)}
                size="xs"
                type="button"
                variant="ghost"
              >
                <TagIcon className="size-3" />
                {t("document.addTagBtn")}
              </Button>
            ))}

          <Collapsible className="ml-auto" onOpenChange={setPropsOpen} open={propsOpen}>
            <CollapsibleTrigger
              render={
                <Button size="xs" type="button" variant="ghost">
                  <span>{t("document.propertiesTitle")}</span>
                  {customProps.length > 0 && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {customProps.length}
                    </span>
                  )}
                  <ChevronDownIcon
                    className={`size-3 transition-transform ${propsOpen ? "rotate-180" : ""}`}
                  />
                </Button>
              }
            />
          </Collapsible>
        </div>

        <DocumentPropertiesPanel
          addPropForm={addPropForm}
          availablePresets={availablePresets}
          customProps={customProps}
          doc={doc}
          editingPropKey={editingPropKey}
          editingPropVal={editingPropVal}
          onOpenDocument={(targetId) => navigation.openDocument(targetId)}
          onSetEditingProp={(key, val) => {
            setEditingPropKey(key);
            if (val !== undefined) setEditingPropVal(val);
          }}
          onSetEditingPropVal={setEditingPropVal}
          onUpdateProps={(next) => updatePropsMutation.mutate(next)}
          open={propsOpen}
          schemaFields={state.spaceSchemaFields}
          workspaceDocs={state.workspaceDocs}
        />
      </header>
    </>
  );
}
