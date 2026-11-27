import type { ExtractedArticle, ExtractedHighlightAnchor } from "@inkade/clipper-core/extractor";
import type { ClipperTemplateBehavior, HighlightColor } from "@inkade/core";
import type { ClipExtractionMode } from "../shared/storage.ts";

export const MENU_CLIP_PAGE = "inkade-clip-page";
export const MENU_CLIP_LINK = "inkade-clip-link";
export const MENU_SAVE_HIGHLIGHT = "inkade-save-highlight";
export const MENU_CLIP_SELECTION = "inkade-clip-selection-only";
export const MENU_SAVE_IMAGE = "inkade-save-image";
export const MENU_REGION_PICKER = "inkade-region-picker";

export const COMMAND_QUICK_CLIP = "quick-clip";
export const COMMAND_CLIP_SELECTION = "clip-selection";
export const COMMAND_REGION_PICKER = "toggle-region-picker";
export const COMMAND_TOGGLE_READER = "toggle-reader";

export const SEMANTIC_BADGE_SUCCESS = "#059669";
export const SEMANTIC_BADGE_ERROR = "#dc2626";

export interface BackgroundRuntimeMessage {
  readonly type?: string;
  readonly url?: string;
  readonly title?: string;
  readonly method?: string;
  readonly tabId?: number;
  readonly documentId?: string;
  readonly existingDocumentId?: string;
  readonly highlightId?: string;
  readonly selectionMarkdown?: string;
  readonly selection?: ExtractedHighlightAnchor | null;
  readonly article?: ExtractedArticle;
  readonly extracted?: ExtractedArticle;
  readonly anchor?: ExtractedHighlightAnchor;
  readonly color?: HighlightColor;
  readonly noteMarkdown?: string;
  readonly prompt?: string;
  readonly patch?: { readonly color?: HighlightColor; readonly noteMarkdown?: string };
  readonly spaceId?: string;
  readonly tags?: readonly string[];
  readonly markdownOverride?: string;
  readonly properties?: Record<string, unknown> | null;
  readonly updateMetadataOnly?: boolean;
  readonly dedupeByUrl?: boolean;
  readonly preserveExistingTags?: boolean;
  readonly mode?: ClipExtractionMode;
  readonly mirrorImages?: boolean;
  readonly saveHtmlSnapshot?: boolean;
  readonly appendToDaily?: boolean;
  readonly dailyLineOverride?: string;
  readonly templateBehavior?: ClipperTemplateBehavior;
  readonly templateIdOverride?: string;
  readonly nonce?: string;
  readonly serverUrl?: string;
  readonly webAppUrl?: string;
  readonly token?: string;
}

export type SendRuntimeResponse = (response: unknown) => void;
