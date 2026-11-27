import type {
  AdeThreadBinding,
  ArtifactSandboxTicket,
  DocumentArtifactId,
  DocumentHighlight,
  DocumentId,
  DocumentKind,
  DocumentRecord,
  DocumentTemplate,
  HighlightColor,
  HighlightId,
  ReaderFontFamilyPref,
  ReaderMeasurePref,
  ReaderPaperModePref,
  SelectionAnchor,
  SendHighlightToAgentResult,
  Space,
  SubmitArtifactCommentInput,
  ViewQueryRequestInput,
  ViewQueryResponse,
} from "@inkade/core";
import type React from "react";
import type * as Y from "yjs";

export interface MentionDocumentCandidate {
  readonly id: string;
  readonly title: string;
  readonly kind: DocumentKind;
}

export interface TriggerMatch {
  readonly kind: "slash" | "wikilink" | "blockref" | "mention";
  readonly query: string;
  readonly rangeFrom: number;
  readonly rangeTo: number;
}

export type SlashCommandCategory = "basic" | "media" | "layout" | "knowledge";

export interface SlashCommandItem {
  readonly id: string;
  readonly category: SlashCommandCategory;
  readonly label: string;
  readonly description: string;
  readonly keywords: string;
  readonly shortcut?: string | undefined;
  readonly icon: React.ReactElement;
  readonly run: () => void;
}

export type BlockTurnIntoTarget =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "task"
  | "blockquote"
  | "code"
  | "callout"
  | "toggle";

export type ImageWidthPreset = "sm" | "md" | "lg" | "full";
export type ImageAlignPreset = "left" | "center" | "right";

export interface ArticleEditorHandle {
  readonly focusStart: () => void;
  readonly focusEnd: () => void;
  readonly flushMarkdown: () => string;
  readonly getMode: () => "rich" | "source";
  readonly setMode: (mode: "rich" | "source") => void;
  readonly toggleToolbar: () => void;
}

export interface ArticleEditorProps {
  readonly document: Pick<DocumentRecord, "id" | "title" | "version" | "contentMarkdown" | "kind">;
  readonly bindings?: readonly AdeThreadBinding[] | undefined;
  readonly workspaceDocs?: readonly (Pick<
    DocumentRecord,
    "id" | "title" | "slug" | "kind" | "excerpt"
  > & {
    readonly spaceId?: string | undefined;
    readonly tags?: readonly string[] | undefined;
  })[] | undefined;
  readonly spaces?: readonly Pick<Space, "id" | "name" | "color" | "icon">[] | undefined;
  readonly highlights?: readonly DocumentHighlight[] | undefined;
  readonly activeHighlightId?: HighlightId | null | undefined;
  readonly onSelectHighlight?: ((highlightId: HighlightId) => void) | undefined;
  readonly onCreateHighlight?: ((input: {
    readonly quote: string;
    readonly prefixContext: string;
    readonly suffixContext: string;
    readonly color: HighlightColor;
    readonly noteMarkdown?: string | undefined;
  }) => void) | undefined;
  readonly onCreateMissingDoc?: ((title: string) => void) | undefined;
  readonly mentionDocuments?: readonly MentionDocumentCandidate[] | undefined;
  readonly templates?: readonly DocumentTemplate[] | undefined;
  readonly hasVersionConflict?: boolean | undefined;
  readonly isDirty?: boolean | undefined;
  readonly serverSyncToken?: string | number | undefined;
  readonly saving?: boolean | undefined;
  readonly autosaveStatus?: "idle" | "saving" | "saved" | "unsaved" | undefined;
  readonly onChangeMarkdown?: ((markdown: string) => void) | undefined;
  readonly onSave?: ((markdown: string, expectedVersion: number) => void) | undefined;
  readonly onResolveConflict?: (() => void) | undefined;
  readonly onUploadFile?: ((file: File) => Promise<{ readonly url: string; readonly filename: string }>) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onOpenWikilink?: ((target: string, event?: React.MouseEvent) => void) | undefined;
  readonly onOpenDocument?: ((docId: DocumentId, publicShareToken?: string | null) => void) | undefined;
  readonly onQueryInkadeView?: ((spec: ViewQueryRequestInput) => Promise<ViewQueryResponse>) | undefined;
  readonly embeddedViewSnapshots?: Readonly<Record<string, ViewQueryResponse>> | undefined;
  readonly onIssueArtifactTicket?: ((artifactId: DocumentArtifactId) => Promise<ArtifactSandboxTicket>) | undefined;
  readonly onSubmitArtifactComment?: ((artifactId: DocumentArtifactId, input: SubmitArtifactCommentInput) => Promise<SendHighlightToAgentResult>) | undefined;
  readonly onOpenSecuritySettings?: (() => void) | undefined;
  readonly onAskAgent?: ((anchor: SelectionAnchor) => void) | undefined;
  readonly onDispatchAde?: ((payload: {
    readonly anchor: SelectionAnchor;
    readonly instruction?: string | undefined;
  }) => void) | undefined;
  readonly onCreateLinkedDocument?: ((params: {
    readonly title: string;
    readonly kind: "article" | "outline";
  }) => Promise<{ readonly id: string; readonly title: string } | null>) | undefined;
  readonly onBindAdeThread?: ((query: string) => void) | undefined;
  readonly onHighlightSelection?: ((input: {
    readonly quote: string;
    readonly color: HighlightColor;
  }) => void) | undefined;
  readonly onAiRewrite?: ((payload: {
    readonly action: string;
    readonly prompt: string;
    readonly selectedText: string;
    readonly fullMarkdown: string;
  }) => Promise<string>) | undefined;
  readonly onExitEdit?: (() => void) | undefined;
  /** Called when user presses ArrowUp or Backspace at position 0 to return focus to inline title. */
  readonly onFocusTitle?: (() => void) | undefined;
  /** Strips a leading `# <doc.title>` H1 when rendering inside a workspace that displays an inline title above the canvas. */
  readonly stripDuplicateTitle?: boolean | undefined;
  /** Hide the heavy top chrome bar (mode/version/save strip) for modeless seamless writing. */
  readonly hideTopChrome?: boolean | undefined;
  /** Controlled rich/source mode (optional; falls back to uncontrolled state). */
  readonly mode?: "rich" | "source" | undefined;
  readonly onModeChange?: ((mode: "rich" | "source") => void) | undefined;
  /** Controlled formatting toolbar visibility. */
  readonly showToolbar?: boolean | undefined;
  readonly onShowToolbarChange?: ((show: boolean) => void) | undefined;
  readonly borderless?: boolean | undefined;
  readonly defaultShowToolbar?: boolean | undefined;
  readonly readerFont?: ReaderFontFamilyPref | undefined;
  readonly readerMeasure?: ReaderMeasurePref | undefined;
  readonly paperMode?: ReaderPaperModePref | undefined;
  readonly theme?: "light" | "dark" | undefined;
  readonly readOnly?: boolean | undefined;
  readonly collaborativeDoc?: Y.Doc | undefined;
  readonly syncFragmentName?: string | undefined;
  readonly className?: string | undefined;
}
