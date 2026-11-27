import type { ExtractedArticle, ExtractedHighlightAnchor } from "@inkade/clipper-core/extractor";
import {
  DEFAULT_HOST_KIND,
  type AdeKind,
  type ClipLookupResult,
  type DocumentHighlight,
  type HighlightId,
  type Space,
  type SpaceId,
} from "@inkade/core";
import { create } from "zustand";
import type { WebExtTab } from "../../shared/webext.ts";
import type { ClipperUiStatus } from "../shared/clipper-ui-helpers.ts";

export type SidePanelSectionTab = "capture" | "related" | "ade";
export type RelatedScope = "title" | "selection" | "clips";

export interface RelatedHitItem {
  readonly documentId: string;
  readonly title: string;
  readonly snippet: string;
  readonly matchSource?: string | undefined;
}

export type NoteSaveState = "dirty" | "saving" | "saved";

export interface SidePanelStoreState {
  readonly spaces: readonly Space[];
  readonly spaceId: SpaceId | "";
  readonly matchedTemplateName: string;

  readonly activeTab: WebExtTab | null;
  readonly extracted: ExtractedArticle | null;
  readonly selection: ExtractedHighlightAnchor | null;
  readonly lookup: ClipLookupResult | null;

  readonly sectionTab: SidePanelSectionTab;
  readonly flushingOffline: boolean;
  readonly refreshing: boolean;
  readonly clipping: boolean;
  readonly appendToDaily: boolean;
  readonly creatingHighlight: boolean;

  readonly noteDrafts: Readonly<Record<string, string>>;
  readonly noteSaveStates: Readonly<Record<string, NoteSaveState>>;
  readonly busyHlId: HighlightId | null;
  readonly pendingDeleteHl: DocumentHighlight | null;

  readonly relatedQuery: string;
  readonly relatedQueryEdited: boolean;
  readonly relatedScope: RelatedScope;
  readonly relatedHits: readonly RelatedHitItem[];
  readonly relatedLoading: boolean;

  readonly adeKind: AdeKind;
  readonly adePrompt: string;
  readonly adeIncludeSelection: boolean;
  readonly adeAppendDaily: boolean;
  readonly adeSubmitting: boolean;

  readonly status: ClipperUiStatus | null;

  setField: <K extends keyof SidePanelStoreFields>(key: K, value: SidePanelStoreFields[K]) => void;
  patch: (partial: Partial<SidePanelStoreFields>) => void;
}

type SidePanelStoreFields = Omit<SidePanelStoreState, "setField" | "patch">;

export const useSidePanelStore = create<SidePanelStoreState>((set) => ({
  spaces: [],
  spaceId: "",
  matchedTemplateName: "",

  activeTab: null,
  extracted: null,
  selection: null,
  lookup: null,

  sectionTab: "capture",
  flushingOffline: false,
  refreshing: false,
  clipping: false,
  appendToDaily: false,
  creatingHighlight: false,

  noteDrafts: {},
  noteSaveStates: {},
  busyHlId: null,
  pendingDeleteHl: null,

  relatedQuery: "",
  relatedQueryEdited: false,
  relatedScope: "title",
  relatedHits: [],
  relatedLoading: false,

  adeKind: DEFAULT_HOST_KIND,
  adePrompt: "",
  adeIncludeSelection: true,
  adeAppendDaily: false,
  adeSubmitting: false,

  status: null,

  setField: (key, value) => set({ [key]: value } as Partial<SidePanelStoreState>),
  patch: (partial) => set(partial as Partial<SidePanelStoreState>),
}));
