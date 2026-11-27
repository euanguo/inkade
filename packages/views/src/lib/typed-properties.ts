import {
  extractSourceDomain,
  type DocumentKind,
  type DocumentRecord,
  type LibrarySortField,
  type SortDirection,
} from "@inkade/core";

export type PropertyValueType = "url" | "text" | "date" | "number" | "status";

export type PropertyPresetLabelKey =
  | "library.props.sourceUrl"
  | "library.props.author"
  | "library.props.publishedAt"
  | "library.props.readStatus"
  | "library.props.status"
  | "library.props.wordGoal"
  | "library.props.audience"
  | "library.props.reviewedAt"
  | "library.props.owner"
  | "library.props.cadence";

export interface PropertyPresetDescriptor {
  readonly key: string;
  readonly labelKey: PropertyPresetLabelKey;
  readonly valueType: PropertyValueType;
  readonly suggestedValues?: readonly string[] | undefined;
}

const CLIP_PROPERTY_PRESETS: readonly PropertyPresetDescriptor[] = [
  {
    key: "sourceUrl",
    labelKey: "library.props.sourceUrl",
    valueType: "url",
  },
  {
    key: "author",
    labelKey: "library.props.author",
    valueType: "text",
  },
  {
    key: "publishedAt",
    labelKey: "library.props.publishedAt",
    valueType: "date",
  },
  {
    key: "readStatus",
    labelKey: "library.props.readStatus",
    valueType: "status",
    suggestedValues: ["unread", "reading", "reviewed"],
  },
];

const ARTICLE_PROPERTY_PRESETS: readonly PropertyPresetDescriptor[] = [
  {
    key: "status",
    labelKey: "library.props.status",
    valueType: "status",
    suggestedValues: ["draft", "in_review", "published", "archived"],
  },
  {
    key: "wordGoal",
    labelKey: "library.props.wordGoal",
    valueType: "number",
  },
  {
    key: "audience",
    labelKey: "library.props.audience",
    valueType: "text",
  },
  {
    key: "reviewedAt",
    labelKey: "library.props.reviewedAt",
    valueType: "date",
  },
];

const OUTLINE_PROPERTY_PRESETS: readonly PropertyPresetDescriptor[] = [
  {
    key: "owner",
    labelKey: "library.props.owner",
    valueType: "text",
  },
  {
    key: "cadence",
    labelKey: "library.props.cadence",
    valueType: "text",
    suggestedValues: ["daily", "weekly", "sprint"],
  },
  {
    key: "reviewedAt",
    labelKey: "library.props.reviewedAt",
    valueType: "date",
  },
];

const PRESETS_BY_KIND: Readonly<Record<DocumentKind, readonly PropertyPresetDescriptor[]>> = {
  clip: CLIP_PROPERTY_PRESETS,
  article: ARTICLE_PROPERTY_PRESETS,
  outline: OUTLINE_PROPERTY_PRESETS,
};

export function getPropertyPresets(kind: DocumentKind): readonly PropertyPresetDescriptor[] {
  return PRESETS_BY_KIND[kind];
}

export interface ExtractedPropertyEntry {
  readonly key: string;
  readonly labelKey?: PropertyPresetLabelKey | undefined;
  readonly valueType: PropertyValueType;
  readonly displayValue: string;
  readonly rawValue: string | number | boolean;
  readonly isPreset: boolean;
}

export interface ExtractedDocumentProperties {
  readonly sourceUrl: string | null;
  readonly sourceDomain: string | null;
  readonly faviconUrl: string | null;
  readonly coverImageUrl: string | null;
  readonly presetEntries: readonly ExtractedPropertyEntry[];
  readonly customEntries: readonly ExtractedPropertyEntry[];
  readonly allEntries: readonly ExtractedPropertyEntry[];
  readonly primaryStatus: string | null;
}

function extractSafeDisplayMediaUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/api/v1/attachments/")) {
    return trimmed;
  }
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return null;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function asPlainRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Readonly<Record<string, unknown>>;
}

function normalizePrimitiveValue(
  raw: unknown,
  valueType: PropertyValueType,
): { readonly displayValue: string; readonly rawValue: string | number | boolean } | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (valueType === "date") {
      const isoPrefix = /^(\d{4}-\d{2}-\d{2})T/.exec(trimmed);
      if (isoPrefix?.[1]) {
        return { displayValue: isoPrefix[1], rawValue: trimmed };
      }
    }
    if (valueType === "url") {
      const domain = extractSourceDomain(trimmed);
      return { displayValue: domain ?? trimmed, rawValue: trimmed };
    }
    return { displayValue: trimmed, rawValue: trimmed };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return { displayValue: String(raw), rawValue: raw };
  }
  if (typeof raw === "boolean") {
    return { displayValue: raw ? "true" : "false", rawValue: raw };
  }
  return null;
}

export function extractDisplayProperties(
  doc: Pick<DocumentRecord, "kind" | "sourceUrl" | "sourceMeta" | "properties">,
): ExtractedDocumentProperties {
  const props = asPlainRecord(doc.properties);
  const meta = asPlainRecord(doc.sourceMeta);
  const presets = getPropertyPresets(doc.kind);
  const presetKeySet = new Set(presets.map((p) => p.key));

  const candidateUrl =
    (typeof doc.sourceUrl === "string" && doc.sourceUrl.trim()) ||
    (typeof props["sourceUrl"] === "string" && props["sourceUrl"].trim()) ||
    (typeof props["source"] === "string" && props["source"].trim()) ||
    (typeof meta["url"] === "string" && meta["url"].trim()) ||
    null;

  const sourceUrl =
    candidateUrl && /^https?:\/\//i.test(candidateUrl) ? candidateUrl : null;
  const sourceDomain = extractSourceDomain(sourceUrl);

  const presetEntries: ExtractedPropertyEntry[] = [];
  for (const preset of presets) {
    const rawCandidate =
      preset.key === "sourceUrl"
        ? (props["sourceUrl"] ?? doc.sourceUrl ?? props["source"])
        : props[preset.key];
    const normalized = normalizePrimitiveValue(rawCandidate, preset.valueType);
    if (!normalized) continue;
    presetEntries.push({
      key: preset.key,
      labelKey: preset.labelKey,
      valueType: preset.valueType,
      displayValue: normalized.displayValue,
      rawValue: normalized.rawValue,
      isPreset: true,
    });
  }

  const customEntries: ExtractedPropertyEntry[] = [];
  for (const [key, raw] of Object.entries(props)) {
    if (presetKeySet.has(key)) continue;
    if (
      key === "inboxArchived" ||
      key === "inboxSnoozedUntil" ||
      key === "inboxMarkedUnread" ||
      key === "taskScheduleByNodeId"
    ) {
      continue;
    }
    const inferredType: PropertyValueType =
      typeof raw === "number"
        ? "number"
        : typeof raw === "string" && /^https?:\/\//i.test(raw.trim())
          ? "url"
          : "text";
    const normalized = normalizePrimitiveValue(raw, inferredType);
    if (!normalized) continue;
    customEntries.push({
      key,
      valueType: inferredType,
      displayValue: normalized.displayValue,
      rawValue: normalized.rawValue,
      isPreset: false,
    });
  }

  const statusEntry =
    presetEntries.find((e) => e.valueType === "status") ??
    customEntries.find((e) => e.key === "status" || e.key === "readStatus") ??
    null;

  const faviconUrl =
    extractSafeDisplayMediaUrl(meta["faviconUrl"]) ??
    extractSafeDisplayMediaUrl(meta["favicon"]) ??
    null;
  const coverImageUrl =
    extractSafeDisplayMediaUrl(meta["coverImageUrl"]) ??
    extractSafeDisplayMediaUrl(meta["image"]) ??
    extractSafeDisplayMediaUrl(props["coverImageUrl"]) ??
    null;

  return {
    sourceUrl,
    sourceDomain,
    faviconUrl,
    coverImageUrl,
    presetEntries,
    customEntries,
    allEntries: [...presetEntries, ...customEntries],
    primaryStatus: statusEntry?.displayValue ?? null,
  };
}

export type DocumentSortField = LibrarySortField | "space";

export interface SortDocumentsOptions {
  readonly pinnedFirst?: boolean | undefined;
  readonly spaceNameById?: ReadonlyMap<string, string> | undefined;
}

function compareIsoTimestamps(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) {
    return ta - tb;
  }
  return a.localeCompare(b);
}

export function sortDocuments<
  T extends Pick<
    DocumentRecord,
    "id" | "title" | "kind" | "spaceId" | "pinned" | "createdAt" | "updatedAt"
  >,
>(
  docs: readonly T[],
  sortBy: DocumentSortField = "updatedAt",
  sortDir: SortDirection = "desc",
  options: SortDocumentsOptions = {},
): readonly T[] {
  const { pinnedFirst = false, spaceNameById } = options;
  const dir = sortDir === "asc" ? 1 : -1;

  return [...docs].sort((a, b) => {
    if (pinnedFirst && a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }

    let cmp = 0;
    if (sortBy === "updatedAt") {
      cmp = compareIsoTimestamps(a.updatedAt, b.updatedAt);
    } else if (sortBy === "createdAt") {
      cmp = compareIsoTimestamps(a.createdAt, b.createdAt);
    } else if (sortBy === "title") {
      cmp = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    } else if (sortBy === "kind") {
      cmp = a.kind.localeCompare(b.kind);
    } else if (sortBy === "space") {
      const sa = spaceNameById?.get(a.spaceId) ?? a.spaceId;
      const sb = spaceNameById?.get(b.spaceId) ?? b.spaceId;
      cmp = sa.localeCompare(sb, undefined, { sensitivity: "base" });
    }

    if (cmp !== 0) return cmp * dir;
    const updatedTie = compareIsoTimestamps(b.updatedAt, a.updatedAt);
    if (updatedTie !== 0) return updatedTie;
    return a.id.localeCompare(b.id);
  });
}

export function stripMarkdownSyntax(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[^\n]*\n[\s\S]*?```/g, " ")
    .replace(/```[\s\S]*$/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[ade:[^|\]]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/(?:^|\n)\s*>?\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/gi, "\n")
    .replace(/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/gi, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[\t ]*[-*+]\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/^[\t ]*\d+\.\s+/gm, "")
    .replace(/^[-*_]{3,}$/gm, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\$\$([\s\S]*?)\$\$/g, " $1 ")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/(\*\*|__|~~|==)/g, "")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingTitlePrefix(cleanText: string, rawTitle?: string): string {
  if (!rawTitle) return cleanText;
  const cleanTitle = stripMarkdownSyntax(rawTitle).trim();
  if (!cleanTitle) return cleanText;

  let remaining = cleanText.trim();
  const titleLower = cleanTitle.toLowerCase();
  for (let pass = 0; pass < 2; pass += 1) {
    if (!remaining.toLowerCase().startsWith(titleLower)) break;
    const afterTitle = remaining.slice(cleanTitle.length);
    if (afterTitle.length > 0 && !/^[\s:：\-—·|/.,;。!?！？]/.test(afterTitle)) {
      break;
    }
    remaining = afterTitle.replace(/^[\s:：\-—·|/.,;。!?！？]+/, "").trim();
  }
  return remaining;
}

export function getDocumentExcerpt(
  doc: Partial<Pick<DocumentRecord, "title" | "contentText" | "contentMarkdown">> &
    Pick<DocumentRecord, "excerpt">,
  maxLen = 160,
): string {
  const candidates = [doc.excerpt, doc.contentText, doc.contentMarkdown];
  let clean = "";
  let firstNonEmpty = "";
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const stripped = stripMarkdownSyntax(candidate);
    if (!stripped) continue;
    if (!firstNonEmpty) firstNonEmpty = stripped;
    const deduped = stripLeadingTitlePrefix(stripped, doc.title);
    if (deduped) {
      clean = deduped;
      break;
    }
  }
  if (!clean) clean = firstNonEmpty;
  if (!clean) return "";
  if (maxLen <= 0) return "";
  if (clean.length <= maxLen) return clean;
  if (maxLen === 1) return "…";
  const slice = clean.slice(0, maxLen - 1).trimEnd();
  return `${slice}…`;
}
