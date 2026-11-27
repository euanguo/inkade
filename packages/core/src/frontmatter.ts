import type { Nodes } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { Document as YamlDocument, isMap, parse as parseYaml, parseDocument, stringify as stringifyYaml } from "yaml";
import {
  formatPropertyScalar,
  inkadeViewSpecSchema,
  type InkadeViewSpec,
  type PropertyFieldDefinition,
} from "./types/property-schema.ts";
import type { DocumentKind, DocumentRecord } from "./types/index.ts";

const frontmatterParser = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]);
const markdownAstParser = unified().use(remarkParse);

export const SYSTEM_FRONTMATTER_KEYS = [
  "id",
  "title",
  "kind",
  "space",
  "slug",
  "dailyDate",
  "tags",
  "sourceUrl",
  "version",
  "createdAt",
  "updatedAt",
] as const;

export const INTERNAL_HIDDEN_PROPERTY_KEYS = new Set([
  "systemRole",
  "isSystemInternal",
  "inboxArchived",
  "inboxSnoozedUntil",
  "inboxMarkedUnread",
  "taskScheduleByNodeId",
  "pdfAssetId",
  "pdfAttachmentId",
  "pdfPageCount",
]);

export interface ParsedFrontmatterResult {
  readonly hasFrontmatter: boolean;
  readonly frontmatter: Record<string, unknown>;
  readonly bodyMarkdown: string;
  readonly rawYaml: string | null;
  readonly warnings: readonly string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parses leading YAML Frontmatter from Markdown via `remark-frontmatter` AST + `yaml` (lossless).
 */
export function parseMarkdownWithFrontmatter(markdown: string): ParsedFrontmatterResult {
  const safeMarkdown = typeof markdown === "string" ? markdown : "";
  if (!safeMarkdown) {
    return {
      hasFrontmatter: false,
      frontmatter: {},
      bodyMarkdown: "",
      rawYaml: null,
      warnings: [],
    };
  }

  const tree = frontmatterParser.parse(safeMarkdown);
  const firstChild = tree.children[0] as Nodes | undefined;
  if (!firstChild || firstChild.type !== "yaml") {
    return {
      hasFrontmatter: false,
      frontmatter: {},
      bodyMarkdown: safeMarkdown,
      rawYaml: null,
      warnings: [],
    };
  }

  const rawYaml = firstChild.value ?? "";
  const endOffset = firstChild.position?.end.offset ?? 0;
  const bodyMarkdown = safeMarkdown.slice(endOffset).replace(/^(?:\r?\n){1,2}/, "");
  const warnings: string[] = [];

  try {
    const doc = parseDocument(rawYaml);
    for (const err of doc.errors) {
      warnings.push(err.message);
    }
    const parsed: unknown = doc.toJS();
    if (!isPlainRecord(parsed)) {
      return {
        hasFrontmatter: true,
        frontmatter: {},
        bodyMarkdown,
        rawYaml,
        warnings:
          parsed === null || parsed === undefined
            ? warnings
            : [...warnings, "Frontmatter root must be a YAML mapping"],
      };
    }
    return {
      hasFrontmatter: true,
      frontmatter: parsed,
      bodyMarkdown,
      rawYaml,
      warnings,
    };
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
    return {
      hasFrontmatter: true,
      frontmatter: {},
      bodyMarkdown,
      rawYaml,
      warnings,
    };
  }
}

export interface SerializeFrontmatterOptions {
  readonly bodyMarkdown: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly existingMarkdown?: string | undefined;
  readonly keyOrder?: readonly string[] | undefined;
  readonly removeAbsentKeys?: boolean | undefined;
}

/**
 * Serializes Markdown with standard YAML Frontmatter using Eemeli Aro's `yaml` AST,
 * preserving existing comments, key order, and user annotations when `existingMarkdown` is given.
 */
export function serializeMarkdownWithFrontmatter({
  bodyMarkdown,
  frontmatter,
  existingMarkdown,
  keyOrder = [],
  removeAbsentKeys = false,
}: SerializeFrontmatterOptions): string {
  const cleanBody = existingMarkdown
    ? parseMarkdownWithFrontmatter(bodyMarkdown).bodyMarkdown
    : bodyMarkdown;
  const existingParsed = existingMarkdown ? parseMarkdownWithFrontmatter(existingMarkdown) : null;

  let yamlDoc: YamlDocument;
  if (existingParsed?.hasFrontmatter && existingParsed.rawYaml !== null) {
    yamlDoc = parseDocument(existingParsed.rawYaml);
    if (!isMap(yamlDoc.contents)) {
      yamlDoc = new YamlDocument({});
    }
  } else {
    yamlDoc = new YamlDocument({});
  }

  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const key of keyOrder) {
    if (key in frontmatter && !seen.has(key)) {
      orderedKeys.push(key);
      seen.add(key);
    }
  }
  for (const key of Object.keys(frontmatter)) {
    if (!seen.has(key)) {
      orderedKeys.push(key);
      seen.add(key);
    }
  }

  if (removeAbsentKeys && isMap(yamlDoc.contents)) {
    const existingKeys = yamlDoc.contents.items
      .map((pair) => {
        const k = pair.key;
        if (k && typeof k === "object" && "value" in k) {
          return formatPropertyScalar(k.value);
        }
        return formatPropertyScalar(k);
      })
      .filter(Boolean);
    for (const k of existingKeys) {
      if (!(k in frontmatter)) {
        yamlDoc.delete(k);
      }
    }
  }

  for (const key of orderedKeys) {
    const value = frontmatter[key];
    if (value === undefined || value === null) {
      yamlDoc.delete(key);
    } else {
      yamlDoc.set(key, value);
    }
  }

  const hasPairs = isMap(yamlDoc.contents) && yamlDoc.contents.items.length > 0;
  const yamlText = hasPairs
    ? yamlDoc.toString({ lineWidth: 0 }).trimEnd()
    : stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();

  const normalizedBody = cleanBody.replace(/^\n+/, "").trimEnd();
  if (!hasPairs && Object.keys(frontmatter).length === 0) {
    return normalizedBody ? `${normalizedBody}\n` : "";
  }
  return normalizedBody ? `---\n${yamlText}\n---\n\n${normalizedBody}\n` : `---\n${yamlText}\n---\n`;
}

/**
 * Builds canonical ordered Frontmatter metadata + structured Space properties for Markdown export.
 */
export function buildDocumentExportFrontmatter(
  doc: Pick<
    DocumentRecord,
    | "id"
    | "title"
    | "kind"
    | "slug"
    | "dailyDate"
    | "tags"
    | "sourceUrl"
    | "properties"
    | "version"
    | "createdAt"
    | "updatedAt"
  >,
  spacePath: string,
  schemaFields: readonly PropertyFieldDefinition[] = [],
): {
  readonly frontmatter: Record<string, unknown>;
  readonly keyOrder: readonly string[];
} {
  const frontmatter: Record<string, unknown> = {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    space: spacePath,
    slug: doc.slug,
  };
  if (doc.dailyDate) {
    frontmatter.dailyDate = doc.dailyDate;
  }
  if (doc.tags.length > 0) {
    frontmatter.tags = [...doc.tags];
  }
  if (doc.sourceUrl) {
    frontmatter.sourceUrl = doc.sourceUrl;
  }

  const schemaKeys = schemaFields.map((f) => f.key);
  const customKeys: string[] = [];
  const props = doc.properties ?? {};
  for (const key of schemaKeys) {
    if (INTERNAL_HIDDEN_PROPERTY_KEYS.has(key)) continue;
    const val = props[key];
    if (val !== undefined && val !== null && val !== "") {
      frontmatter[key] = val;
    }
  }
  for (const [key, val] of Object.entries(props)) {
    if (key in frontmatter || INTERNAL_HIDDEN_PROPERTY_KEYS.has(key)) continue;
    if (val !== undefined && val !== null && val !== "") {
      frontmatter[key] = val;
      customKeys.push(key);
    }
  }

  frontmatter.version = doc.version;
  frontmatter.createdAt = doc.createdAt;
  frontmatter.updatedAt = doc.updatedAt;

  const keyOrder = [
    "id",
    "title",
    "kind",
    "space",
    "slug",
    "dailyDate",
    "tags",
    "sourceUrl",
    ...schemaKeys,
    ...customKeys.sort(),
    "version",
    "createdAt",
    "updatedAt",
  ];

  return { frontmatter, keyOrder };
}

export interface ImportedMarkdownDocumentData {
  readonly title?: string | undefined;
  readonly kind?: DocumentKind | undefined;
  readonly space?: string | undefined;
  readonly slug?: string | undefined;
  readonly dailyDate?: string | undefined;
  readonly tags: readonly string[];
  readonly sourceUrl?: string | undefined;
  readonly properties: Record<string, unknown>;
  readonly bodyMarkdown: string;
  readonly rawYaml: string | null;
  readonly warnings: readonly string[];
}

const SYSTEM_META_SET = new Set<string>(SYSTEM_FRONTMATTER_KEYS);

/**
 * Extracts document metadata, custom structured properties, and clean body from raw Markdown + YAML Frontmatter.
 */
export function importMarkdownWithFrontmatter(rawMarkdown: string): ImportedMarkdownDocumentData {
  const parsed = parseMarkdownWithFrontmatter(rawMarkdown);
  const fm = parsed.frontmatter;
  const tags: string[] = [];
  if (Array.isArray(fm.tags)) {
    for (const item of fm.tags) {
      if (typeof item === "string" && item.trim()) {
        tags.push(item.trim().replace(/^#+/, ""));
      }
    }
  } else if (typeof fm.tags === "string") {
    for (const item of fm.tags.split(",")) {
      if (item.trim()) {
        tags.push(item.trim().replace(/^#+/, ""));
      }
    }
  }

  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (SYSTEM_META_SET.has(key) || INTERNAL_HIDDEN_PROPERTY_KEYS.has(key)) continue;
    if (value !== undefined && value !== null) {
      properties[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    }
  }

  const kindRaw = typeof fm.kind === "string" ? fm.kind.trim().toLowerCase() : undefined;
  const kind: DocumentKind | undefined =
    kindRaw === "article" || kindRaw === "clip" || kindRaw === "outline" ? kindRaw : undefined;

  return {
    title: typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : undefined,
    kind,
    space: typeof fm.space === "string" && fm.space.trim() ? fm.space.trim() : undefined,
    slug: typeof fm.slug === "string" && fm.slug.trim() ? fm.slug.trim() : undefined,
    dailyDate:
      typeof fm.dailyDate === "string" && fm.dailyDate.trim() ? fm.dailyDate.trim() : undefined,
    tags: [...new Set(tags)],
    sourceUrl:
      typeof fm.sourceUrl === "string" && fm.sourceUrl.trim() ? fm.sourceUrl.trim() : undefined,
    properties,
    bodyMarkdown: parsed.bodyMarkdown,
    rawYaml: parsed.rawYaml,
    warnings: parsed.warnings,
  };
}

// --- ```inkade-view``` YAML block parser & serializer ---

export type ParseInkadeViewBlockResult =
  | { readonly ok: true; readonly spec: InkadeViewSpec }
  | { readonly ok: false; readonly error: string };

/**
 * Parses YAML inside a ```inkade-view``` fenced block into a validated `InkadeViewSpec`.
 */
export function parseInkadeViewBlock(yamlSource: string): ParseInkadeViewBlockResult {
  const trimmed = typeof yamlSource === "string" ? yamlSource.trim() : "";
  if (!trimmed) {
    return { ok: true, spec: inkadeViewSpecSchema.parse({}) };
  }
  try {
    const raw: unknown = parseYaml(trimmed);
    if (raw === null || raw === undefined) {
      return { ok: true, spec: inkadeViewSpecSchema.parse({}) };
    }
    if (!isPlainRecord(raw)) {
      return { ok: false, error: "inkade-view YAML block must evaluate to a key/value object" };
    }
    const parsed = inkadeViewSpecSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        error: issue ? `${issue.path.join(".") || "view"}: ${issue.message}` : "Invalid inkade-view config",
      };
    }
    return { ok: true, spec: parsed.data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid YAML in inkade-view block",
    };
  }
}

/**
 * Serializes an `InkadeViewSpec` into clean, readable YAML for ```inkade-view``` fenced blocks.
 */
export function serializeInkadeViewBlock(spec: Partial<InkadeViewSpec>): string {
  const clean: Record<string, unknown> = {
    mode: spec.mode ?? "table",
  };
  if (spec.spaceId) clean.spaceId = spec.spaceId;
  if (spec.kind) clean.kind = spec.kind;
  if (spec.tag) clean.tag = spec.tag;
  if (spec.query) clean.query = spec.query;
  if (spec.pinnedOnly) clean.pinnedOnly = true;
  if (spec.unreadOnly) clean.unreadOnly = true;
  if (spec.filter && Object.keys(spec.filter).length > 0) clean.filter = spec.filter;
  if (spec.columns && spec.columns.length > 0) clean.columns = [...spec.columns];
  if (spec.groupBy) clean.groupBy = spec.groupBy;
  if (spec.sort) clean.sort = spec.sort;
  if (spec.limit !== undefined) clean.limit = spec.limit;
  if (spec.offset) clean.offset = spec.offset;
  return stringifyYaml(clean, { lineWidth: 0 }).trimEnd();
}

export interface ExtractedInkadeViewBlock {
  readonly raw: string;
  readonly parsed: ParseInkadeViewBlockResult;
}

/**
 * Extracts all ```inkade-view``` fenced code blocks from Markdown via remark AST.
 */
export function extractInkadeViewBlocks(markdown: string): readonly ExtractedInkadeViewBlock[] {
  if (!markdown || !markdown.includes("inkade-view")) return [];
  const tree = markdownAstParser.parse(markdown);
  const blocks: ExtractedInkadeViewBlock[] = [];

  function walk(node: Nodes): void {
    if (node.type === "code") {
      if ((node.lang ?? "").trim().toLowerCase() === "inkade-view") {
        const raw = node.value ?? "";
        blocks.push({
          raw,
          parsed: parseInkadeViewBlock(raw),
        });
      }
      return;
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return blocks;
}
