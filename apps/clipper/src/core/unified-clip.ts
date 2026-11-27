import type { ExtractedArticle, ExtractedHighlightAnchor } from "@inkade/clipper-core/extractor";
import {
  BUILTIN_CLIPPER_TEMPLATES,
  matchTemplateForPage,
  renderClipTemplate,
  type RenderedClipPlan,
} from "@inkade/clipper-core/templates";
import type {
  AttachmentId,
  ClipLookupResult,
  ClipperTemplate,
  ClipperTemplateBehavior,
  DocumentHighlight,
  DocumentId,
  DocumentRecord,
  OutlineNode,
  SpaceId,
} from "@inkade/core";
import type { FetchLike, InkadeClient } from "@inkade/sdk";
import type { ClipExtractionMode, ClipperAiProviderConfig } from "../shared/storage.ts";
import { resolveTemplateAiPrompts } from "./interpreter.ts";
import {
  appendClipToDaily,
  lookupClipState,
  syncClipPage,
} from "./sync.ts";

export interface UnifiedClipTemplateResolution {
  readonly template: ClipperTemplate | null;
  readonly autoMatched: boolean;
  readonly plan: RenderedClipPlan | null;
}

export async function resolveTemplatePlanForArticle(input: {
  readonly article: ExtractedArticle;
  readonly templates?: readonly ClipperTemplate[] | undefined;
  readonly aiProvider?: ClipperAiProviderConfig | undefined;
  readonly selection?: ExtractedHighlightAnchor | null | undefined;
  readonly selectionMarkdown?: string | undefined;
  readonly highlights?: readonly DocumentHighlight[] | undefined;
  readonly templateIdOverride?: string | undefined;
  readonly fetchFn?: FetchLike | undefined;
}): Promise<UnifiedClipTemplateResolution> {
  const catalog =
    input.templates && input.templates.length > 0
      ? input.templates
      : BUILTIN_CLIPPER_TEMPLATES;

  let template: ClipperTemplate | null = null;
  let autoMatched = false;

  if (input.templateIdOverride) {
    template = catalog.find((tpl) => tpl.id === input.templateIdOverride) ?? null;
  }
  if (!template) {
    const matched = matchTemplateForPage(catalog, {
      url: input.article.url,
      schemaTypes: input.article.meta.schemaTypes,
    });
    template = matched.template;
    autoMatched = matched.autoMatched;
  }

  if (!template) {
    return { template: null, autoMatched: false, plan: null };
  }

  let plan = renderClipTemplate(template, {
    article: input.article,
    selection: input.selection,
    selectionMarkdown: input.selectionMarkdown,
    highlights: input.highlights,
  });

  if (plan.pendingPrompts.length > 0 && input.aiProvider) {
    plan = await resolveTemplateAiPrompts(
      input.aiProvider,
      input.article,
      plan,
      input.fetchFn,
    );
  }

  return { template, autoMatched, plan };
}

export interface ExecuteUnifiedClipInput {
  readonly extracted: ExtractedArticle;
  readonly spaceId?: SpaceId | undefined;
  readonly title?: string | undefined;
  readonly markdownOverride?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly properties?: Record<string, unknown> | null | undefined;
  readonly existingDocumentId?: DocumentId | undefined;
  readonly updateMetadataOnly?: boolean | undefined;
  readonly dedupeByUrl?: boolean | undefined;
  readonly preserveExistingTags?: boolean | undefined;
  readonly mode?: ClipExtractionMode | undefined;
  readonly mirrorImages?: boolean | undefined;
  readonly asyncMirror?: boolean | undefined;
  readonly fastAsyncRaceMs?: number | undefined;
  readonly compressWebp?: boolean | undefined;
  readonly saveHtmlSnapshot?: boolean | undefined;
  readonly appendToDaily?: boolean | undefined;
  readonly dailyLineOverride?: string | undefined;
  readonly templateBehavior?: ClipperTemplateBehavior | undefined;
  readonly templates?: readonly ClipperTemplate[] | undefined;
  readonly templateIdOverride?: string | undefined;
  readonly preferTemplateDefaults?: boolean | undefined;
  readonly aiProvider?: ClipperAiProviderConfig | undefined;
  readonly selection?: ExtractedHighlightAnchor | null | undefined;
  readonly selectionMarkdown?: string | undefined;
  readonly fetchFn?: FetchLike | typeof fetch | undefined;
  readonly onBackgroundTasks?: ((promise: Promise<void>) => void) | undefined;
}

export interface ExecuteUnifiedClipResult {
  readonly document: DocumentRecord | null;
  readonly mirroredImages: number;
  readonly mirrorPending: boolean;
  readonly conflictSkipped: boolean;
  readonly snapshotAttachmentId?: AttachmentId | undefined;
  readonly dailyNode?: OutlineNode | undefined;
  readonly dailyOnly: boolean;
  readonly mode: ClipExtractionMode;
  readonly updatedExisting: boolean;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeUnifiedClip(
  client: InkadeClient,
  input: ExecuteUnifiedClipInput,
): Promise<ExecuteUnifiedClipResult> {
  let existingLookup: ClipLookupResult | null = null;
  let existingDocId = input.existingDocumentId;
  let existingTags: readonly string[] = [];

  if (!existingDocId && (input.dedupeByUrl ?? false)) {
    try {
      existingLookup = await lookupClipState(client, input.extracted.url);
      if (existingLookup.found && existingLookup.document) {
        existingDocId = existingLookup.document.id;
        existingTags = existingLookup.document.tags;
      }
    } catch {
      // Proceed without dedupe metadata if lookup fails transiently
    }
  } else if (existingDocId && input.preserveExistingTags) {
    try {
      const existingDoc = await client.documents.get(existingDocId);
      existingTags = existingDoc.tags;
    } catch {
      // ignore
    }
  }

  let plan: RenderedClipPlan | null = null;
  let matchedTemplate: ClipperTemplate | null = null;
  if (input.markdownOverride === undefined && input.templates !== undefined) {
    const resolved = await resolveTemplatePlanForArticle({
      article: input.extracted,
      templates: input.templates,
      aiProvider: input.aiProvider,
      selection: input.selection,
      selectionMarkdown: input.selectionMarkdown,
      highlights: existingLookup?.highlights,
      templateIdOverride: input.templateIdOverride,
      fetchFn: input.fetchFn,
    });
    matchedTemplate = resolved.template;
    plan = resolved.plan;
  }

  const effectiveBehavior: ClipperTemplateBehavior =
    input.templateBehavior ?? matchedTemplate?.behavior ?? "create";
  const finalTitle = input.title?.trim() || plan?.title || input.extracted.title;
  const finalTags = [
    ...new Set([
      ...(input.preserveExistingTags ? existingTags : []),
      ...(input.tags ?? []),
      ...(plan?.tags ?? []),
    ]),
  ];

  if (effectiveBehavior === "daily-only") {
    const dailyNode = await appendClipToDaily(client, {
      title: finalTitle,
      url: input.extracted.url,
      documentId: existingDocId ?? "daily",
      customMarkdown: input.dailyLineOverride ?? plan?.dailyLine,
    });
    return {
      document: existingLookup?.document ?? null,
      mirroredImages: 0,
      mirrorPending: false,
      conflictSkipped: false,
      dailyNode,
      dailyOnly: true,
      mode: input.mode ?? "client-dom",
      updatedExisting: false,
    };
  }

  const shouldUseExisting =
    Boolean(existingDocId) &&
    (input.existingDocumentId !== undefined ||
      effectiveBehavior === "append-existing" ||
      Boolean(input.dedupeByUrl));

  const planSpaceId = plan?.targetSpaceId || undefined;
  const targetSpaceId = input.preferTemplateDefaults
    ? (planSpaceId ?? input.spaceId)
    : (input.spaceId ?? planSpaceId);
  const effectiveMarkdown = input.markdownOverride ?? plan?.contentMarkdown;
  const effectiveProperties = input.properties ?? plan?.properties;
  const effectiveMirrorImages = input.preferTemplateDefaults
    ? (plan?.mirrorImages ?? input.mirrorImages ?? true)
    : (input.mirrorImages ?? plan?.mirrorImages ?? true);
  const effectiveSaveSnapshot = input.preferTemplateDefaults
    ? (plan?.saveHtmlSnapshot ?? input.saveHtmlSnapshot ?? true)
    : (input.saveHtmlSnapshot ?? plan?.saveHtmlSnapshot ?? true);
  const effectiveAppendDaily = input.preferTemplateDefaults
    ? (Boolean(input.appendToDaily) || Boolean(plan?.appendToDaily))
    : (input.appendToDaily ?? plan?.appendToDaily ?? false);
  const effectiveDailyLine = input.dailyLineOverride ?? plan?.dailyLine;

  const fastRaceMs = input.fastAsyncRaceMs ?? 1500;
  let trackedAssetPromise: Promise<void> | null = null;
  const captureBackgroundTask = (promise: Promise<void>) => {
    trackedAssetPromise = promise;
    input.onBackgroundTasks?.(promise);
  };

  const result = await syncClipPage(client, {
    extracted: input.extracted,
    spaceId: targetSpaceId,
    title: finalTitle,
    markdownOverride: effectiveMarkdown,
    tags: finalTags,
    properties: effectiveProperties,
    existingDocumentId: shouldUseExisting ? existingDocId : undefined,
    updateMetadataOnly: input.updateMetadataOnly,
    mode: input.mode,
    mirrorImages: effectiveMirrorImages,
    asyncMirror: Boolean(input.asyncMirror && input.onBackgroundTasks),
    compressWebp: input.compressWebp,
    saveHtmlSnapshot: effectiveSaveSnapshot,
    appendToDaily: effectiveAppendDaily,
    dailyLineOverride: effectiveDailyLine,
    fetchFn: input.fetchFn,
    onBackgroundTasks: input.onBackgroundTasks ? captureBackgroundTask : undefined,
  });

  if (result.mirrorPending && trackedAssetPromise && fastRaceMs > 0) {
    const raceOutcome = await Promise.race([
      (trackedAssetPromise as Promise<void>).then(() => "done" as const).catch(() => "done" as const),
      sleepMs(fastRaceMs).then(() => "pending" as const),
    ]);
    if (raceOutcome === "done") {
      try {
        const refreshed = await client.documents.get(result.document.id);
        const mirroredCount =
          typeof refreshed.sourceMeta?.mirroredImages === "number"
            ? refreshed.sourceMeta.mirroredImages
            : result.mirroredImages;
        return {
          document: refreshed,
          mirroredImages: mirroredCount,
          mirrorPending: false,
          conflictSkipped: result.conflictSkipped,
          snapshotAttachmentId: result.snapshotAttachmentId,
          dailyNode: result.dailyNode,
          dailyOnly: false,
          mode: result.mode,
          updatedExisting: Boolean(shouldUseExisting && existingDocId),
        };
      } catch {
        // return original result cleanly if refresh fails
      }
    }
  }

  return {
    document: result.document,
    mirroredImages: result.mirroredImages,
    mirrorPending: result.mirrorPending,
    conflictSkipped: result.conflictSkipped,
    snapshotAttachmentId: result.snapshotAttachmentId,
    dailyNode: result.dailyNode,
    dailyOnly: false,
    mode: result.mode,
    updatedExisting: Boolean(shouldUseExisting && existingDocId),
  };
}
