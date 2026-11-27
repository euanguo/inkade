"use client";

import type {
  AdeThreadBinding,
  ArtifactSandboxTicket,
  DocumentArtifactId,
  DocumentId,
  DocumentRecord,
  ReaderPaperModePref,
  SendHighlightToAgentResult,
  Space,
  SubmitArtifactCommentInput,
  ViewQueryRequestInput,
  ViewQueryResponse,
} from "@inkade/core";
import type React from "react";
import { createContext, useContext } from "react";

export type EditorWorkspaceDocSummary = Pick<
  DocumentRecord,
  "id" | "title" | "slug" | "kind" | "excerpt"
> & {
  readonly spaceId?: string | undefined;
  readonly tags?: readonly string[] | undefined;
};

export interface EditorSurfaceContextValue {
  readonly theme: "light" | "dark";
  readonly paperMode?: ReaderPaperModePref | undefined;
  readonly readOnly: boolean;
  readonly workspaceDocs: readonly EditorWorkspaceDocSummary[];
  readonly spaces: readonly Pick<Space, "id" | "name" | "color" | "icon">[];
  readonly bindings?: readonly AdeThreadBinding[] | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onOpenWikilink?: ((target: string, event?: React.MouseEvent) => void) | undefined;
  readonly onOpenDocument?: ((docId: DocumentId, publicShareToken?: string | null) => void) | undefined;
  readonly onCreateMissingDoc?: ((title: string) => void) | undefined;
  readonly onQueryInkadeView?: ((spec: ViewQueryRequestInput) => Promise<ViewQueryResponse>) | undefined;
  readonly embeddedViewSnapshots?: Readonly<Record<string, ViewQueryResponse>> | undefined;
  readonly onIssueArtifactTicket?: ((artifactId: DocumentArtifactId) => Promise<ArtifactSandboxTicket>) | undefined;
  readonly onSubmitArtifactComment?: ((artifactId: DocumentArtifactId, input: SubmitArtifactCommentInput) => Promise<SendHighlightToAgentResult>) | undefined;
  readonly onOpenSecuritySettings?: (() => void) | undefined;
}

const DEFAULT_SURFACE_CTX: EditorSurfaceContextValue = {
  theme: "light",
  paperMode: "default",
  readOnly: false,
  workspaceDocs: [],
  spaces: [],
  bindings: undefined,
  onOpenBinding: undefined,
  onOpenWikilink: undefined,
  onOpenDocument: undefined,
  onCreateMissingDoc: undefined,
  onQueryInkadeView: undefined,
  embeddedViewSnapshots: undefined,
  onIssueArtifactTicket: undefined,
  onSubmitArtifactComment: undefined,
  onOpenSecuritySettings: undefined,
};

export const EditorSurfaceContext = createContext<EditorSurfaceContextValue>(DEFAULT_SURFACE_CTX);

export function useEditorSurface(): EditorSurfaceContextValue {
  return useContext(EditorSurfaceContext);
}
