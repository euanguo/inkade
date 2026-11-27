// Utilities & Breakpoints
export * from "./lib/breakpoints.ts";
export * from "./lib/utils.ts";

// cosscom/ui Primitives
export * from "./primitives/alert-dialog.tsx";
export * from "./primitives/autocomplete.tsx";
export * from "./primitives/badge.tsx";
export * from "./primitives/bucket-meter.tsx";
export * from "./primitives/button.tsx";
export * from "./primitives/card.tsx";
export * from "./primitives/checkbox.tsx";
export * from "./primitives/clip-media.tsx";
export * from "./primitives/collapsible.tsx";
export * from "./primitives/command.tsx";
export * from "./primitives/context-menu.tsx";
export * from "./primitives/copy-button.tsx";
export * from "./primitives/dialog.tsx";
export * from "./primitives/drawer.tsx";
export * from "./primitives/empty.tsx";
export * from "./primitives/field.tsx";
export * from "./primitives/form.tsx";
export * from "./primitives/glide-highlight.tsx";
export * from "./primitives/grid-disclosure.tsx";
export * from "./primitives/hold-confirm-button.tsx";
export * from "./primitives/input.tsx";
export * from "./primitives/kbd.tsx";
export * from "./primitives/menu.tsx";
export * from "./primitives/number-ticker.tsx";
export * from "./primitives/popover.tsx";
export * from "./primitives/preview-card.tsx";
export * from "./primitives/resize-handle.tsx";
export * from "./primitives/scrub-input.tsx";
export * from "./primitives/scroll-area.tsx";
export * from "./primitives/segmented-control.tsx";
export * from "./primitives/select.tsx";
export * from "./primitives/separator.tsx";
export * from "./primitives/sheet.tsx";
export * from "./primitives/sidebar.tsx";
export * from "./primitives/skeleton.tsx";
export * from "./primitives/space-icon.tsx";
export * from "./primitives/spinner.tsx";
export * from "./primitives/stream-text.tsx";
export * from "./primitives/switch.tsx";
export * from "./primitives/table.tsx";
export * from "./primitives/tabs.tsx";
export * from "./primitives/tag-list.tsx";
export * from "./primitives/tag-pill.tsx";
export * from "./primitives/textarea.tsx";
export * from "./primitives/thinking-indicator.tsx";
export * from "./primitives/toast.tsx";
export * from "./primitives/toolbar.tsx";
export * from "./primitives/tooltip.tsx";

// Inkade Domain Patterns & Helpers
export * from "./patterns/AdeThreadChip.tsx";
export * from "./patterns/ade-thread-chip-extension.tsx";
export * from "./patterns/ArticleEditor.tsx";
export * from "./patterns/ArticleReader.tsx";
export type { ReaderWorkspaceDoc } from "./patterns/article-reader/reader-dom-helpers.ts";
export * from "./patterns/BacklinksPanel.tsx";
export * from "./patterns/command-highlight.ts";
export * from "./patterns/CommandPalette.tsx";
export * from "./patterns/DiffViewer.tsx";
export * from "./patterns/outline-helpers.ts";
export * from "./patterns/ScopeTreePicker.tsx";

// Phase 8 Exports
export * from "./patterns/outline-schema.ts";
export * from "./patterns/outline-diff-ops.ts";
export * from "./patterns/ProseMirrorOutlineEditor.tsx";
export type {
  OutlineDeferTarget,
  ProseMirrorOutlineEditorProps,
  ProseMirrorWorkspaceDocSummary,
  WorkspaceOutlineSearchMatch,
} from "./patterns/outline-editor/types.ts";
export * from "./patterns/OutlineKanbanBoard.tsx";
export * from "./patterns/kanban/pragmatic-dnd.ts";
export {
  formatTaskDurationLabel,
  getTaskPriorityLabelKey,
  getTaskRecurrenceLabelKey,
  getTaskSlotLabelKey,
  getTaskSourceEngineBadgeKey,
  type KanbanGroupMode,
  TASK_PRIORITY_STYLES,
  type TaskPriorityLabelKey,
  type TaskPriorityStyleSpec,
  type TaskRecurrenceLabelKey,
  type TaskSlotLabelKey,
  type TaskSourceEngineBadgeKey,
} from "./patterns/kanban/task-styles.ts";
export * from "./patterns/MiniCalendarHeatmap.tsx";

// Phase 9 Exports
export * from "./patterns/InlineTrackChangesViewer.tsx";
export * from "./patterns/track-changes/diff-model.ts";
export * from "./patterns/track-changes/review-session.ts";
export * from "./patterns/LocalGraphPanel.tsx";
export * from "./patterns/MarginaliaOverlay.tsx";
export * from "./patterns/remark-inkade-wikilinks.ts";
export * from "./patterns/SelectionActionBar.tsx";

// Phase 12 Exports
export * from "./patterns/yjs-collaboration.ts";

// Phase 19 Exports
export * from "./patterns/AwaySummaryCard.tsx";
export * from "./patterns/ConflictRadarBanner.tsx";
export * from "./patterns/AgentStepsLog.tsx";
export * from "./patterns/ApprovalCard.tsx";
export * from "./patterns/AgentComposerPanel.tsx";
export * from "./patterns/CitedAnswerCard.tsx";

// Phase 20 Exports
export * from "./patterns/AutonomyDial.tsx";
export * from "./patterns/AgentLedgerRow.tsx";
export * from "./patterns/DailyReviewCard.tsx";

// Phase 33 Exports
export * from "./editor/DocumentFindBar.tsx";
export * from "./editor/TypographyPopover.tsx";
export * from "./editor/document-export.ts";
export { InkadeCalloutExtension } from "./editor/extensions/callout.ts";
export { InkadeCodeBlockExtension } from "./editor/extensions/code-block.ts";
export { InkadeColumnExtension, InkadeColumnsExtension } from "./editor/extensions/columns.ts";
export { InkadeHighlightMark } from "./editor/extensions/highlight.ts";
export { InkadeImageExtension } from "./editor/extensions/image.ts";
export { InkadeInlineMathExtension, InkadeMathBlockExtension } from "./editor/extensions/math.ts";
export * from "./editor/extensions/search-replace.ts";
export { InkadeToggleExtension } from "./editor/extensions/toggle.ts";
export { InkadeWikilinkExtension } from "./editor/extensions/wikilink.ts";
export { detectEditorTrigger } from "./editor/markdown-utils.ts";
export type {
  ArticleEditorHandle,
  ArticleEditorProps,
  MentionDocumentCandidate,
  TriggerMatch,
} from "./editor/types.ts";

// Phase 42 Exports
export * from "./patterns/InkadeViewBlock.tsx";
export * from "./patterns/property-option-badge.tsx";
export { InkadeViewExtension } from "./editor/extensions/inkade-view.ts";
export {
  formatMatrixAsCsv,
  formatMatrixAsGfmMarkdown,
  type TableNumericStats,
} from "./editor/menus/table-actions.ts";

// Phase 50 Exports
export * from "./patterns/InkadePendingBlock.tsx";
export { InkadePendingExtension } from "./editor/extensions/inkade-pending.ts";

// Phase 54 Exports
export * from "./patterns/PresentationModal.tsx";
export { InkadeSpeakerNoteExtension } from "./editor/extensions/speaker-note.ts";

// Phase 51 Exports
export * from "./patterns/InkadeArtifactBlock.tsx";
export { InkadeArtifactExtension } from "./editor/extensions/inkade-artifact.ts";
