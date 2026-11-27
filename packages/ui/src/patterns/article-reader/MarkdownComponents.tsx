"use client";

import {
  INKADE_ARTIFACT_FENCE_LANG,
  INKADE_PENDING_FENCE_LANG,
  parseInkadeArtifactPayload,
  parseInkadePendingPayload,
  type AdeThreadBinding,
  type ArtifactSandboxTicket,
  type DocumentArtifactId,
  type DocumentId,
  type ReaderPaperModePref,
  type SendHighlightToAgentResult,
  type Space,
  type SubmitArtifactCommentInput,
  type ViewQueryRequestInput,
  type ViewQueryResponse,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  FilePlus2Icon,
  InfoIcon,
  LightbulbIcon,
  ShieldAlertIcon,
  SparklesIcon,
} from "lucide-react";
import React, { createContext, useContext, useMemo, useRef } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from "../../primitives/preview-card.tsx";
import { SpaceIcon } from "../../primitives/space-icon.tsx";
import { DocumentKindIcon, TagPill } from "../../primitives/tag-pill.tsx";
import {
  type GfmCalloutKind,
  remarkInkadeCallouts,
  remarkInkadeHighlights,
  remarkInkadeWikilinks,
} from "../remark-inkade-wikilinks.ts";
import { InkadeArtifactBlock } from "../InkadeArtifactBlock.tsx";
import { InkadePendingBlock } from "../InkadePendingBlock.tsx";
import { InkadeViewBlock } from "../InkadeViewBlock.tsx";
import { MermaidBlock } from "./MermaidBlock.tsx";
import type { ReaderWorkspaceDoc } from "./reader-dom-helpers.ts";
import { ShikiCodeBlock } from "./ShikiCodeBlock.tsx";

export interface MemoizedProseProps {
  readonly renderedMarkdown: string;
  readonly theme: "light" | "dark";
  readonly paperMode?: ReaderPaperModePref | undefined;
  readonly docsByKey: ReadonlyMap<string, ReaderWorkspaceDoc>;
  readonly spaceById: ReadonlyMap<string, Pick<Space, "id" | "name" | "color" | "icon">>;
  readonly workspaceDocs?: readonly ReaderWorkspaceDoc[] | undefined;
  readonly spaces?: readonly Pick<Space, "id" | "name" | "color" | "icon">[] | undefined;
  readonly bindings?: readonly AdeThreadBinding[] | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onQueryInkadeView?: ((spec: ViewQueryRequestInput) => Promise<ViewQueryResponse>) | undefined;
  readonly embeddedViewSnapshots?: Readonly<Record<string, ViewQueryResponse>> | undefined;
  readonly onIssueArtifactTicket?: ((artifactId: DocumentArtifactId) => Promise<ArtifactSandboxTicket>) | undefined;
  readonly onSubmitArtifactComment?: ((artifactId: DocumentArtifactId, input: SubmitArtifactCommentInput) => Promise<SendHighlightToAgentResult>) | undefined;
  readonly onOpenSecuritySettings?: (() => void) | undefined;
  readonly onOpenDocument?: ((docId: DocumentId, publicShareToken?: string | null) => void) | undefined;
  readonly onOpenWikilink?: ((targetSlugOrTitle: string, event?: React.MouseEvent) => void) | undefined;
  readonly onCreateMissingDoc?: ((title: string) => void) | undefined;
  readonly onOpenBindingById?: ((bindingId: string) => void) | undefined;
}

const CALLOUT_META: Readonly<
  Record<GfmCalloutKind, { readonly icon: React.ComponentType<{ className?: string }>; readonly titleClass: string }>
> = {
  note: { icon: InfoIcon, titleClass: "text-info-foreground" },
  tip: { icon: LightbulbIcon, titleClass: "text-success-foreground" },
  important: { icon: AlertCircleIcon, titleClass: "text-violet-600 dark:text-violet-400" },
  warning: { icon: AlertTriangleIcon, titleClass: "text-warning-foreground" },
  caution: { icon: ShieldAlertIcon, titleClass: "text-destructive-foreground" },
};

const REMARK_PLUGINS = [
  remarkGfm,
  remarkMath,
  remarkInkadeCallouts,
  remarkInkadeHighlights,
  remarkInkadeWikilinks,
];
const REHYPE_PLUGINS = [rehypeSlug, rehypeKatex];

function markdownUrlTransform(url: string): string {
  return url.startsWith("wikilink:") ||
    url.startsWith("ade-thread:") ||
    /^(https?:|mailto:|tel:|#|\/)/i.test(url)
    ? url
    : "";
}

interface MarkdownCallbacks {
  readonly onOpenWikilink?: ((targetSlugOrTitle: string, event?: React.MouseEvent) => void) | undefined;
  readonly onOpenDocument?: ((docId: DocumentId, publicShareToken?: string | null) => void) | undefined;
  readonly onCreateMissingDoc?: ((title: string) => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onOpenBindingById?: ((bindingId: string) => void) | undefined;
  readonly onQueryInkadeView?: ((spec: ViewQueryRequestInput) => Promise<ViewQueryResponse>) | undefined;
  readonly onIssueArtifactTicket?: ((artifactId: DocumentArtifactId) => Promise<ArtifactSandboxTicket>) | undefined;
  readonly onSubmitArtifactComment?: ((artifactId: DocumentArtifactId, input: SubmitArtifactCommentInput) => Promise<SendHighlightToAgentResult>) | undefined;
  readonly onOpenSecuritySettings?: (() => void) | undefined;
}

interface MarkdownRenderContextValue {
  readonly theme: "light" | "dark";
  readonly paperMode: ReaderPaperModePref;
  readonly docsByKey: ReadonlyMap<string, ReaderWorkspaceDoc>;
  readonly spaceById: ReadonlyMap<string, Pick<Space, "id" | "name" | "color" | "icon">>;
  readonly bindingById: ReadonlyMap<string, AdeThreadBinding>;
  readonly workspaceDocs: readonly ReaderWorkspaceDoc[];
  readonly spaces: readonly Pick<Space, "id" | "name" | "color" | "icon">[];
  readonly embeddedViewSnapshots?: Readonly<Record<string, ViewQueryResponse>> | undefined;
  readonly calloutTitles: Readonly<Record<GfmCalloutKind, string>>;
  readonly callbacksRef: React.RefObject<MarkdownCallbacks>;
}

const MarkdownRenderContext = createContext<MarkdownRenderContextValue | null>(null);

function MarkdownPre({ children }: React.ComponentPropsWithoutRef<"pre">): React.ReactElement {
  return <>{children}</>;
}

function MarkdownBlockquote({
  children,
  ...rest
}: React.ComponentPropsWithoutRef<"blockquote">): React.ReactElement {
  const ctx = useContext(MarkdownRenderContext);
  const props = rest as Record<string, unknown>;
  const calloutKind = props["data-callout"] as GfmCalloutKind | undefined;
  const customTitle = props["data-callout-title"] as string | undefined;
  if (calloutKind && CALLOUT_META[calloutKind] && ctx) {
    const meta = CALLOUT_META[calloutKind];
    const Icon = meta.icon;
    return (
      <div className="inkade-callout" data-callout={calloutKind}>
        <div className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-semibold", meta.titleClass)}>
          <Icon className="size-4 shrink-0" />
          <span>{customTitle || ctx.calloutTitles[calloutKind]}</span>
        </div>
        <div className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0">{children}</div>
      </div>
    );
  }
  return <blockquote {...rest}>{children}</blockquote>;
}

function extractReactText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractReactText).join("");
  }
  return "";
}

function MarkdownCode({
  className: codeClassName,
  children,
  ...rest
}: React.ComponentPropsWithoutRef<"code">): React.ReactElement {
  const ctx = useContext(MarkdownRenderContext);
  const match = /language-([^\s]+)/.exec(codeClassName ?? "");
  const rawText = extractReactText(children).replace(/\n$/, "");
  const isBlock = Boolean(match) || rawText.includes("\n");

  if (!isBlock) {
    return (
      <code className={codeClassName} {...rest}>
        {children}
      </code>
    );
  }

  const theme = ctx?.theme ?? "light";
  const lang = (match?.[1] ?? "text").toLowerCase();
  if (lang === "inkade-view") {
    const snapshot =
      ctx?.embeddedViewSnapshots?.[rawText] ??
      ctx?.embeddedViewSnapshots?.[rawText.trim()] ??
      undefined;
    return (
      <InkadeViewBlock
        embeddedSnapshot={snapshot}
        onOpenDocument={(id, shareToken) => ctx?.callbacksRef.current.onOpenDocument?.(id, shareToken)}
        onOpenWikilink={(target, e) => ctx?.callbacksRef.current.onOpenWikilink?.(target, e)}
        onQueryInkadeView={
          ctx?.callbacksRef.current.onQueryInkadeView
            ? (spec) => ctx.callbacksRef.current.onQueryInkadeView!(spec)
            : undefined
        }
        rawYaml={rawText}
        spaces={ctx?.spaces}
        workspaceDocs={ctx?.workspaceDocs}
      />
    );
  }
  if (lang === INKADE_PENDING_FENCE_LANG) {
    const parsed = parseInkadePendingPayload(rawText);
    const matchedBinding = parsed.bindingId ? ctx?.bindingById.get(parsed.bindingId) : undefined;
    return (
      <InkadePendingBlock
        binding={matchedBinding}
        bindingId={parsed.bindingId}
        label={parsed.label}
        onOpenBinding={
          matchedBinding
            ? (binding) => ctx?.callbacksRef.current.onOpenBinding?.(binding)
            : undefined
        }
        pendingId={parsed.id}
        readOnly
        status={parsed.status}
      />
    );
  }
  if (lang === INKADE_ARTIFACT_FENCE_LANG) {
    const parsed = parseInkadeArtifactPayload(rawText);
    return (
      <InkadeArtifactBlock
        artifactId={parsed.id}
        heightPx={parsed.height}
        onIssueTicket={
          ctx?.callbacksRef.current.onIssueArtifactTicket
            ? (id: DocumentArtifactId) => ctx.callbacksRef.current.onIssueArtifactTicket!(id)
            : undefined
        }
        onOpenSecuritySettings={
          ctx?.callbacksRef.current.onOpenSecuritySettings
            ? () => ctx.callbacksRef.current.onOpenSecuritySettings?.()
            : undefined
        }
        onSubmitComment={
          ctx?.callbacksRef.current.onSubmitArtifactComment
            ? (id: DocumentArtifactId, input: SubmitArtifactCommentInput) =>
                ctx.callbacksRef.current.onSubmitArtifactComment!(id, input)
            : undefined
        }
        paperMode={ctx?.paperMode}
        readOnly
        theme={theme}
        title={parsed.title}
      />
    );
  }
  if (lang === "mermaid") {
    return <MermaidBlock chart={rawText} theme={theme} />;
  }
  return <ShikiCodeBlock code={rawText} language={lang} theme={theme} />;
}

function MarkdownTable({
  children,
  ...rest
}: React.ComponentPropsWithoutRef<"table">): React.ReactElement {
  return (
    <div className="inkade-table-wrap">
      <table {...rest}>{children}</table>
    </div>
  );
}

function MarkdownAnchor({
  href,
  children,
  ...rest
}: React.ComponentPropsWithoutRef<"a">): React.ReactElement {
  const { t } = useInkadeTranslation();
  const ctx = useContext(MarkdownRenderContext);

  if (href?.startsWith("ade-thread:")) {
    const [idPart] = href.slice("ade-thread:".length).split("?");
    const bindingId = decodeURIComponent(idPart ?? "");
    return (
      <button
        className="mx-0.5 inline-flex cursor-pointer items-center gap-1 rounded-full border border-primary/25 bg-brand-subtle px-2 py-0.5 text-xs font-medium text-brand-subtle-foreground hover:bg-brand-subtle/80"
        onClick={() => ctx?.callbacksRef.current.onOpenBindingById?.(bindingId)}
        type="button"
      >
        <SparklesIcon className="size-3" />
        <span>{children}</span>
      </button>
    );
  }

  if (href?.startsWith("wikilink:") && ctx) {
    const fullTarget = decodeURIComponent(href.slice("wikilink:".length));
    const baseTarget = (fullTarget.split("#")[0] ?? fullTarget).trim().toLowerCase();
    const matchedDoc = ctx.docsByKey.get(baseTarget);
    const matchedSpace = matchedDoc ? ctx.spaceById.get(matchedDoc.spaceId) : undefined;

    if (matchedDoc) {
      return (
        <PreviewCard>
          <PreviewCardTrigger
            render={
              <button
                className="inline cursor-pointer rounded bg-brand-subtle/60 px-1 py-0.5 font-medium text-brand-subtle-foreground underline decoration-primary/40 underline-offset-3 [box-decoration-break:clone] hover:bg-brand-subtle hover:decoration-primary"
                onClick={(e) => ctx.callbacksRef.current.onOpenWikilink?.(fullTarget, e)}
                type="button"
              />
            }
          >
            {children}
          </PreviewCardTrigger>
          <PreviewCardPopup align="start" className="w-80 flex-col gap-2.5 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <DocumentKindIcon kind={matchedDoc.kind} size="xs" />
                <span className="truncate text-sm font-semibold text-foreground">
                  {matchedDoc.title}
                </span>
              </div>
              {matchedSpace && (
                <Badge className="shrink-0" size="sm" variant="outline">
                  <SpaceIcon
                    color={matchedSpace.color}
                    icon={matchedSpace.icon}
                    size="xs"
                  />
                  <span>{matchedSpace.name}</span>
                </Badge>
              )}
            </div>

            {matchedDoc.excerpt && (
              <div className="max-h-36 overflow-y-auto rounded-md border bg-muted/35 p-2 text-xs leading-relaxed text-muted-foreground">
                {matchedDoc.excerpt}
              </div>
            )}

            {matchedDoc.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {matchedDoc.tags.slice(0, 4).map((tag) => (
                  <TagPill key={tag} size="sm" tag={tag} />
                ))}
              </div>
            )}

            {ctx.callbacksRef.current.onOpenWikilink && (
              <div className="flex justify-end">
                <Button
                  onClick={(e) => ctx.callbacksRef.current.onOpenWikilink?.(fullTarget, e)}
                  size="xs"
                  variant="default"
                >
                  {t("reader.openDocumentAction")}
                </Button>
              </div>
            )}
          </PreviewCardPopup>
        </PreviewCard>
      );
    }

    const targetTitle = (fullTarget.split("#")[0] ?? fullTarget).trim();
    return (
      <PreviewCard>
        <PreviewCardTrigger
          render={
            <button
              className="inline cursor-pointer rounded border-b border-dashed border-muted-foreground/60 px-0.5 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              onClick={(e) => {
                if (ctx.callbacksRef.current.onCreateMissingDoc) {
                  ctx.callbacksRef.current.onCreateMissingDoc(targetTitle);
                } else {
                  ctx.callbacksRef.current.onOpenWikilink?.(fullTarget, e);
                }
              }}
              type="button"
            />
          }
        >
          {children}
        </PreviewCardTrigger>
        <PreviewCardPopup align="start" className="w-72 flex-col gap-2 p-3">
          <p className="text-xs text-muted-foreground">
            {t("reader.missingDocHint", { title: targetTitle })}
          </p>
          {ctx.callbacksRef.current.onCreateMissingDoc && (
            <Button
              onClick={() => ctx.callbacksRef.current.onCreateMissingDoc?.(targetTitle)}
              size="xs"
              variant="outline"
            >
              <FilePlus2Icon />
              {t("reader.createMissingDoc")}
            </Button>
          )}
        </PreviewCardPopup>
      </PreviewCard>
    );
  }

  return (
    <a href={href} rel="noreferrer noopener" target="_blank" {...rest}>
      {children}
    </a>
  );
}

const MARKDOWN_COMPONENTS = {
  pre: MarkdownPre,
  blockquote: MarkdownBlockquote,
  code: MarkdownCode,
  table: MarkdownTable,
  a: MarkdownAnchor,
};

export const MemoizedMarkdownProse = React.memo(function MemoizedMarkdownProse({
  renderedMarkdown,
  theme,
  paperMode = "default",
  docsByKey,
  spaceById,
  workspaceDocs = [],
  spaces = [],
  bindings = [],
  onOpenBinding,
  onQueryInkadeView,
  embeddedViewSnapshots,
  onIssueArtifactTicket,
  onSubmitArtifactComment,
  onOpenSecuritySettings,
  onOpenDocument,
  onOpenWikilink,
  onCreateMissingDoc,
  onOpenBindingById,
}: MemoizedProseProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const callbacksRef = useRef<MarkdownCallbacks>({
    onOpenWikilink,
    onOpenDocument,
    onCreateMissingDoc,
    onOpenBinding,
    onOpenBindingById,
    onQueryInkadeView,
    onIssueArtifactTicket,
    onSubmitArtifactComment,
    onOpenSecuritySettings,
  });
  callbacksRef.current = {
    onOpenWikilink,
    onOpenDocument,
    onCreateMissingDoc,
    onOpenBinding,
    onOpenBindingById,
    onQueryInkadeView,
    onIssueArtifactTicket,
    onSubmitArtifactComment,
    onOpenSecuritySettings,
  };

  const bindingById = useMemo(
    () => new Map<string, AdeThreadBinding>(bindings.map((b) => [b.id, b])),
    [bindings],
  );

  const calloutTitles = useMemo<Readonly<Record<GfmCalloutKind, string>>>(
    () => ({
      note: t("reader.calloutNote"),
      tip: t("reader.calloutTip"),
      important: t("reader.calloutImportant"),
      warning: t("reader.calloutWarning"),
      caution: t("reader.calloutCaution"),
    }),
    [t],
  );

  const contextValue = useMemo<MarkdownRenderContextValue>(
    () => ({
      theme,
      paperMode,
      docsByKey,
      spaceById,
      bindingById,
      workspaceDocs,
      spaces,
      embeddedViewSnapshots,
      calloutTitles,
      callbacksRef,
    }),
    [theme, paperMode, docsByKey, spaceById, bindingById, workspaceDocs, spaces, embeddedViewSnapshots, calloutTitles],
  );

  return (
    <MarkdownRenderContext.Provider value={contextValue}>
      <Markdown
        components={MARKDOWN_COMPONENTS}
        rehypePlugins={REHYPE_PLUGINS}
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={markdownUrlTransform}
      >
        {renderedMarkdown}
      </Markdown>
    </MarkdownRenderContext.Provider>
  );
});
