import type { ExtractedArticle, ExtractedHighlightAnchor } from "@inkade/clipper-core/extractor";
import { BUILTIN_CLIPPER_TEMPLATES } from "@inkade/clipper-core/templates";
import type { ClipLookupResult, ClipperTemplate, HighlightColor, Space, SpaceId } from "@inkade/core";
import { create } from "zustand";
import type { ClipExtractionMode } from "../../shared/storage.ts";
import type { WebExtTab } from "../../shared/webext.ts";
import type { TagSuggestionItem } from "../TagChipsInput.tsx";
import type { ClipperUiStatus } from "../shared/clipper-ui-helpers.ts";

export interface PopupStoreState {
  readonly spaces: readonly Space[];
  readonly tagSuggestions: readonly TagSuggestionItem[];
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly connectionError: string | null;

  readonly activeTab: WebExtTab | null;
  readonly extracting: boolean;
  readonly extractFailed: boolean;
  readonly extracted: ExtractedArticle | null;
  readonly selection: ExtractedHighlightAnchor | null;
  readonly selectionMarkdown: string;
  readonly tabRestricted: boolean;
  readonly existingLookup: ClipLookupResult | null;
  readonly missingHostPermission: boolean;

  readonly activeMode: "clip" | "highlight";
  readonly showMarkdownPreview: boolean;
  readonly showAdvanced: boolean;

  readonly title: string;
  readonly spaceId: SpaceId | "";
  readonly tagsList: string[];
  readonly clipMode: ClipExtractionMode;
  readonly mirrorImages: boolean;
  readonly saveSnapshot: boolean;
  readonly appendToDaily: boolean;

  readonly highlightColor: HighlightColor;
  readonly highlightNote: string;

  readonly templates: readonly ClipperTemplate[];
  readonly selectedTemplateId: string;
  readonly autoMatchedTemplateId: string;
  readonly aiEnriching: boolean;
  readonly aiSummaryText: string;
  readonly flushingOffline: boolean;
  readonly submittingClip: boolean;
  readonly submittingHighlight: boolean;
  readonly status: ClipperUiStatus | null;

  setField: <K extends keyof PopupStoreFields>(key: K, value: PopupStoreFields[K]) => void;
  patch: (partial: Partial<PopupStoreFields>) => void;
}

type PopupStoreFields = Omit<PopupStoreState, "setField" | "patch">;

export const usePopupStore = create<PopupStoreState>((set) => ({
  spaces: [],
  tagSuggestions: [],
  connected: false,
  connecting: false,
  connectionError: null,

  activeTab: null,
  extracting: true,
  extractFailed: false,
  extracted: null,
  selection: null,
  selectionMarkdown: "",
  tabRestricted: false,
  existingLookup: null,
  missingHostPermission: false,

  activeMode: "clip",
  showMarkdownPreview: false,
  showAdvanced: false,

  title: "",
  spaceId: "",
  tagsList: [],
  clipMode: "client-dom",
  mirrorImages: true,
  saveSnapshot: true,
  appendToDaily: false,

  highlightColor: "amber",
  highlightNote: "",

  templates: BUILTIN_CLIPPER_TEMPLATES,
  selectedTemplateId: "",
  autoMatchedTemplateId: "",
  aiEnriching: false,
  aiSummaryText: "",
  flushingOffline: false,
  submittingClip: false,
  submittingHighlight: false,
  status: null,

  setField: (key, value) => set({ [key]: value } as Partial<PopupStoreState>),
  patch: (partial) => set(partial as Partial<PopupStoreState>),
}));
