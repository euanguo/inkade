import { z } from "zod";
import {
  spaceIdSchema,
  spacePropertySchemaIdSchema,
  templateIdSchema,
  type DocumentId,
  type SpaceId,
  type SpacePropertySchemaId,
  type TemplateId,
  type WorkspaceId,
} from "../ids.ts";
import {
  documentKindSchema,
  sortDirectionSchema,
  type SortDirection,
} from "./common.ts";
import type { DocumentSummary } from "./document.ts";

export const PROPERTY_FIELD_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "url",
  "relation_doc",
] as const;
export type PropertyFieldType = (typeof PROPERTY_FIELD_TYPES)[number];
export const propertyFieldTypeSchema = z.enum(PROPERTY_FIELD_TYPES);

export const PROPERTY_OPTION_COLORS = [
  "indigo",
  "blue",
  "teal",
  "emerald",
  "amber",
  "orange",
  "rose",
  "pink",
  "violet",
  "slate",
] as const;
export type PropertyOptionColor = (typeof PROPERTY_OPTION_COLORS)[number];
export const propertyOptionColorSchema = z.enum(PROPERTY_OPTION_COLORS);

export const PROPERTY_NUMBER_FORMATS = ["plain", "percent", "currency", "unit"] as const;
export type PropertyNumberFormat = (typeof PROPERTY_NUMBER_FORMATS)[number];
export const propertyNumberFormatSchema = z.enum(PROPERTY_NUMBER_FORMATS);

export const PROPERTY_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/;

export const propertyFieldOptionSchema = z.object({
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  color: propertyOptionColorSchema.optional(),
});
export type PropertyFieldOption = z.infer<typeof propertyFieldOptionSchema>;

export const propertyFieldDefaultValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
  .optional();
export type PropertyFieldDefaultValue = z.infer<typeof propertyFieldDefaultValueSchema>;

export const propertyFieldDefinitionSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      PROPERTY_KEY_REGEX,
      "Property key must start with a letter or '_' and contain only letters, digits, '_' or '-'",
    ),
  label: z.string().trim().min(1).max(80),
  type: propertyFieldTypeSchema,
  options: z.array(propertyFieldOptionSchema).max(100).default([]),
  numberFormat: propertyNumberFormatSchema.optional(),
  numberUnit: z.string().trim().max(16).optional(),
  defaultValue: propertyFieldDefaultValueSchema,
  showInTable: z.boolean().default(true),
  showInCard: z.boolean().default(true),
  requiredByAgent: z.boolean().default(false),
});
export type PropertyFieldDefinitionInput = z.input<typeof propertyFieldDefinitionSchema>;
export type PropertyFieldDefinition = z.infer<typeof propertyFieldDefinitionSchema>;

export interface SpacePropertySchema {
  readonly id: SpacePropertySchemaId;
  readonly workspaceId: WorkspaceId;
  readonly spaceId: SpaceId | null;
  readonly templateId: TemplateId | null;
  readonly fields: readonly PropertyFieldDefinition[];
  readonly updatedAt: string;
}

export const spacePropertySchemaFieldsArraySchema = z
  .array(propertyFieldDefinitionSchema)
  .max(60)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, idx) => {
      const normalizedKey = field.key.trim();
      if (seen.has(normalizedKey)) {
        ctx.addIssue({
          code: "custom",
          path: [idx, "key"],
          message: `Duplicate property schema key "${normalizedKey}"`,
        });
      }
      seen.add(normalizedKey);
    });
  });

export const upsertSpacePropertySchemaInputSchema = z.object({
  templateId: templateIdSchema.nullable().optional(),
  fields: spacePropertySchemaFieldsArraySchema,
});
export type UpsertSpacePropertySchemaInput = z.input<typeof upsertSpacePropertySchemaInputSchema>;
export type ParsedUpsertSpacePropertySchemaInput = z.infer<
  typeof upsertSpacePropertySchemaInputSchema
>;

export interface PropertyValidationIssue {
  readonly key: string;
  readonly code:
    | "invalid_type"
    | "invalid_url"
    | "invalid_date"
    | "unknown_option"
    | "missing_required";
  readonly message: string;
}

export interface PropertySchemaValidationResult {
  readonly valid: boolean;
  readonly normalizedProperties: Record<string, unknown>;
  readonly errors: readonly PropertyValidationIssue[];
  readonly warnings: readonly PropertyValidationIssue[];
  readonly missingRequired: readonly string[];
}

const ISO_DATE_PREFIX_REGEX = /^\d{4}-\d{2}-\d{2}(?:$|[T\s])/;

function isValidHttpOrAttachmentUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("/api/v1/attachments/")) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isEmptyPropertyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Validates and normalizes `properties` against ordered Space/Template schema fields.
 * Unknown extra keys are preserved so documents remain Markdown-friendly.
 */
export function validatePropertiesAgainstSchema(
  rawProperties: Readonly<Record<string, unknown>> | null | undefined,
  fields: readonly PropertyFieldDefinition[],
): PropertySchemaValidationResult {
  const source = rawProperties ? { ...rawProperties } : {};
  const normalizedProperties: Record<string, unknown> = { ...source };
  const errors: PropertyValidationIssue[] = [];
  const warnings: PropertyValidationIssue[] = [];
  const missingRequired: string[] = [];

  for (const field of fields) {
    const rawVal = source[field.key];
    if (isEmptyPropertyValue(rawVal)) {
      if (rawVal === "") {
        delete normalizedProperties[field.key];
      }
      if (field.requiredByAgent) {
        missingRequired.push(field.key);
        warnings.push({
          key: field.key,
          code: "missing_required",
          message: `Required schema field "${field.key}" (${field.label}) is missing`,
        });
      }
      continue;
    }

    switch (field.type) {
      case "text": {
        if (typeof rawVal === "string") {
          normalizedProperties[field.key] = rawVal.trim();
        } else if (typeof rawVal === "number" || typeof rawVal === "boolean") {
          normalizedProperties[field.key] = String(rawVal);
        } else {
          errors.push({
            key: field.key,
            code: "invalid_type",
            message: `Field "${field.key}" expects text`,
          });
        }
        break;
      }
      case "number": {
        if (typeof rawVal === "number") {
          if (!Number.isFinite(rawVal)) {
            errors.push({
              key: field.key,
              code: "invalid_type",
              message: `Field "${field.key}" must be a finite number`,
            });
          } else {
            normalizedProperties[field.key] = rawVal;
          }
        } else if (typeof rawVal === "string") {
          const parsed = Number(rawVal.trim());
          if (!Number.isFinite(parsed)) {
            errors.push({
              key: field.key,
              code: "invalid_type",
              message: `Field "${field.key}" expects a numeric value`,
            });
          } else {
            normalizedProperties[field.key] = parsed;
          }
        } else {
          errors.push({
            key: field.key,
            code: "invalid_type",
            message: `Field "${field.key}" expects a number`,
          });
        }
        break;
      }
      case "checkbox": {
        if (typeof rawVal === "boolean") {
          normalizedProperties[field.key] = rawVal;
        } else if (typeof rawVal === "string") {
          const lower = rawVal.trim().toLowerCase();
          if (lower === "true" || lower === "1" || lower === "yes") {
            normalizedProperties[field.key] = true;
          } else if (lower === "false" || lower === "0" || lower === "no") {
            normalizedProperties[field.key] = false;
          } else {
            errors.push({
              key: field.key,
              code: "invalid_type",
              message: `Field "${field.key}" expects a boolean checkbox value`,
            });
          }
        } else {
          errors.push({
            key: field.key,
            code: "invalid_type",
            message: `Field "${field.key}" expects a boolean`,
          });
        }
        break;
      }
      case "date": {
        if (typeof rawVal !== "string") {
          errors.push({
            key: field.key,
            code: "invalid_date",
            message: `Field "${field.key}" expects a YYYY-MM-DD or ISO date string`,
          });
          break;
        }
        const trimmed = rawVal.trim();
        if (!ISO_DATE_PREFIX_REGEX.test(trimmed) || Number.isNaN(Date.parse(trimmed))) {
          errors.push({
            key: field.key,
            code: "invalid_date",
            message: `Field "${field.key}" has invalid date "${trimmed}"`,
          });
        } else {
          normalizedProperties[field.key] = trimmed;
        }
        break;
      }
      case "url": {
        if (typeof rawVal !== "string" || !isValidHttpOrAttachmentUrl(rawVal)) {
          errors.push({
            key: field.key,
            code: "invalid_url",
            message: `Field "${field.key}" expects a valid http(s) URL`,
          });
        } else {
          normalizedProperties[field.key] = rawVal.trim();
        }
        break;
      }
      case "select": {
        if (typeof rawVal !== "string") {
          errors.push({
            key: field.key,
            code: "invalid_type",
            message: `Field "${field.key}" expects a single select string value`,
          });
          break;
        }
        const trimmed = rawVal.trim();
        const matched = field.options.find(
          (opt) =>
            opt.value.toLowerCase() === trimmed.toLowerCase() ||
            opt.label.toLowerCase() === trimmed.toLowerCase(),
        );
        const canonical = matched ? matched.value : trimmed;
        normalizedProperties[field.key] = canonical;
        if (field.options.length > 0 && !matched) {
          warnings.push({
            key: field.key,
            code: "unknown_option",
            message: `Option "${trimmed}" is not in schema options for "${field.key}": [${field.options
              .map((o) => o.value)
              .join(", ")}]`,
          });
        }
        break;
      }
      case "multi_select": {
        let items: string[];
        if (Array.isArray(rawVal)) {
          if (!rawVal.every((v) => typeof v === "string")) {
            errors.push({
              key: field.key,
              code: "invalid_type",
              message: `Field "${field.key}" expects an array of strings`,
            });
            break;
          }
          items = rawVal.map((v) => v.trim()).filter(Boolean);
        } else if (typeof rawVal === "string") {
          items = rawVal
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
        } else {
          errors.push({
            key: field.key,
            code: "invalid_type",
            message: `Field "${field.key}" expects string[]`,
          });
          break;
        }
        const normalizedItems: string[] = [];
        const seen = new Set<string>();
        for (const item of items) {
          const matched = field.options.find(
            (opt) =>
              opt.value.toLowerCase() === item.toLowerCase() ||
              opt.label.toLowerCase() === item.toLowerCase(),
          );
          const canonical = matched ? matched.value : item;
          if (!seen.has(canonical)) {
            seen.add(canonical);
            normalizedItems.push(canonical);
          }
          if (field.options.length > 0 && !matched) {
            warnings.push({
              key: field.key,
              code: "unknown_option",
              message: `Option "${item}" is not in schema options for "${field.key}"`,
            });
          }
        }
        normalizedProperties[field.key] = normalizedItems;
        break;
      }
      case "relation_doc": {
        if (typeof rawVal !== "string") {
          errors.push({
            key: field.key,
            code: "invalid_type",
            message: `Field "${field.key}" expects a document reference string`,
          });
        } else {
          normalizedProperties[field.key] = rawVal.trim();
        }
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    normalizedProperties,
    errors,
    warnings,
    missingRequired,
  };
}

// --- Inline ```inkade-view``` protocol & /api/v1/views/query contracts ---

export const INKADE_VIEW_DISPLAY_MODES = ["table", "cards", "board"] as const;
export type InkadeViewDisplayMode = (typeof INKADE_VIEW_DISPLAY_MODES)[number];
export const inkadeViewDisplayModeSchema = z.enum(INKADE_VIEW_DISPLAY_MODES);

export const inkadeViewSortRuleSchema = z.object({
  field: z.string().trim().min(1).max(64),
  dir: sortDirectionSchema.default("desc"),
});
export type InkadeViewSortRule = z.infer<typeof inkadeViewSortRuleSchema>;

export const INKADE_VIEW_FILTER_OPS = [
  "eq",
  "neq",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
] as const;
export type InkadeViewFilterOp = (typeof INKADE_VIEW_FILTER_OPS)[number];

export const inkadeViewStructuredConditionSchema = z.object({
  op: z.enum(INKADE_VIEW_FILTER_OPS),
  value: z.unknown(),
});
export type InkadeViewStructuredCondition = z.infer<typeof inkadeViewStructuredConditionSchema>;

export const inkadeViewSpecSchema = z.object({
  mode: inkadeViewDisplayModeSchema.default("table"),
  spaceId: spaceIdSchema.optional(),
  kind: documentKindSchema.optional(),
  tag: z.string().trim().min(1).optional(),
  query: z.string().trim().optional(),
  pinnedOnly: z.boolean().optional(),
  unreadOnly: z.boolean().optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
  columns: z.array(z.string().trim().min(1).max(64)).max(40).optional(),
  groupBy: z.string().trim().min(1).max(64).optional(),
  sort: z
    .union([inkadeViewSortRuleSchema, z.array(inkadeViewSortRuleSchema).max(5)])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});
export type InkadeViewSpecInput = z.input<typeof inkadeViewSpecSchema>;
export type InkadeViewSpec = z.infer<typeof inkadeViewSpecSchema>;

export const viewQueryRequestSchema = z.object({
  mode: inkadeViewDisplayModeSchema.optional(),
  spaceId: spaceIdSchema.optional(),
  kind: documentKindSchema.optional(),
  tag: z.string().trim().min(1).optional(),
  query: z.string().trim().optional(),
  pinnedOnly: z.boolean().optional(),
  unreadOnly: z.boolean().optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
  columns: z.array(z.string().trim().min(1).max(64)).max(40).optional(),
  groupBy: z.string().trim().min(1).max(64).optional(),
  sort: z
    .union([inkadeViewSortRuleSchema, z.array(inkadeViewSortRuleSchema).max(5)])
    .optional(),
  sortRules: z.array(inkadeViewSortRuleSchema).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ViewQueryRequestInput = z.input<typeof viewQueryRequestSchema>;
export type ViewQueryRequest = z.infer<typeof viewQueryRequestSchema>;

export type ViewQueryDocumentItem = DocumentSummary & {
  readonly publicShareToken?: string | null | undefined;
};

export interface ViewQueryNumericAggregate {
  readonly field: string;
  readonly count: number;
  readonly sum: number;
  readonly avg: number;
}

export interface ViewQueryResponse {
  readonly documents: readonly ViewQueryDocumentItem[];
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly schemaFields: readonly PropertyFieldDefinition[];
  readonly numericAggregates: readonly ViewQueryNumericAggregate[];
}

export const spacePropertySchemaMetaSchema = z.object({
  id: spacePropertySchemaIdSchema,
  spaceId: spaceIdSchema.nullable(),
  templateId: templateIdSchema.nullable(),
});

function readDocumentFieldValue(
  doc: Pick<
    DocumentSummary,
    | "id"
    | "title"
    | "kind"
    | "spaceId"
    | "tags"
    | "pinned"
    | "unreadAgentUpdate"
    | "sourceUrl"
    | "properties"
    | "createdAt"
    | "updatedAt"
    | "dailyDate"
  >,
  field: string,
): unknown {
  if (field === "id") return doc.id;
  if (field === "title") return doc.title;
  if (field === "kind") return doc.kind;
  if (field === "spaceId" || field === "space") return doc.spaceId;
  if (field === "tags") return doc.tags;
  if (field === "pinned") return doc.pinned;
  if (field === "unreadAgentUpdate") return doc.unreadAgentUpdate;
  if (field === "sourceUrl") return doc.sourceUrl ?? doc.properties?.["sourceUrl"] ?? null;
  if (field === "createdAt") return doc.createdAt;
  if (field === "updatedAt") return doc.updatedAt;
  if (field === "dailyDate") return doc.dailyDate;
  return doc.properties?.[field];
}

export function formatPropertyScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(formatPropertyScalar).join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function matchesCondition(actual: unknown, rawCond: unknown): boolean {
  if (
    rawCond &&
    typeof rawCond === "object" &&
    !Array.isArray(rawCond) &&
    "op" in rawCond &&
    typeof (rawCond as { op?: unknown }).op === "string"
  ) {
    const cond = inkadeViewStructuredConditionSchema.safeParse(rawCond);
    if (!cond.success) return false;
    const { op, value } = cond.data;
    switch (op) {
      case "eq":
        return matchesEquality(actual, value);
      case "neq":
        return !matchesEquality(actual, value);
      case "contains": {
        const needle = formatPropertyScalar(value).toLowerCase();
        if (!needle) return true;
        if (Array.isArray(actual)) {
          return actual.some((item) => formatPropertyScalar(item).toLowerCase().includes(needle));
        }
        return formatPropertyScalar(actual).toLowerCase().includes(needle);
      }
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const aNum = typeof actual === "number" ? actual : Number(actual);
        const bNum = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
          if (op === "gt") return aNum > bNum;
          if (op === "gte") return aNum >= bNum;
          if (op === "lt") return aNum < bNum;
          return aNum <= bNum;
        }
        const aStr = formatPropertyScalar(actual);
        const bStr = formatPropertyScalar(value);
        if (!aStr) return false;
        if (op === "gt") return aStr > bStr;
        if (op === "gte") return aStr >= bStr;
        if (op === "lt") return aStr < bStr;
        return aStr <= bStr;
      }
      case "in": {
        if (!Array.isArray(value)) return false;
        return value.some((item) => matchesEquality(actual, item));
      }
    }
  }

  if (Array.isArray(rawCond)) {
    return rawCond.some((item) => matchesEquality(actual, item));
  }
  return matchesEquality(actual, rawCond);
}

function matchesEquality(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return actual.some((item) => matchesEquality(item, expected));
  }
  if (typeof actual === "string" && typeof expected === "string") {
    return actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  return actual === expected;
}

function compareSortValues(a: unknown, b: unknown, dir: SortDirection): number {
  const mult = dir === "asc" ? 1 : -1;
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * mult;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return (Number(a) - Number(b)) * mult;
  }
  const aStr = formatPropertyScalar(a);
  const bStr = formatPropertyScalar(b);
  return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: "base" }) * mult;
}

function isSortRuleArray(
  value: InkadeViewSortRule | readonly InkadeViewSortRule[],
): value is readonly InkadeViewSortRule[] {
  return Array.isArray(value);
}

export function normalizeSortRules(
  sort?: InkadeViewSortRule | readonly InkadeViewSortRule[] | null,
  sortRules?: readonly InkadeViewSortRule[] | null,
): readonly InkadeViewSortRule[] {
  if (sortRules && sortRules.length > 0) return sortRules;
  if (!sort) return [{ field: "updatedAt", dir: "desc" }];
  return isSortRuleArray(sort) ? sort : [sort];
}

/**
 * Pure deterministic evaluator for SavedView / ```inkade-view``` queries across already-authorized documents.
 */
export function evaluateViewQueryOnDocuments<T extends ViewQueryDocumentItem>(
  authorizedDocs: readonly T[],
  schemaFields: readonly PropertyFieldDefinition[],
  request: ViewQueryRequest,
  options?: {
    readonly matchingSpaceIds?: ReadonlySet<SpaceId> | null | undefined;
    readonly relatedDocIdFilter?: DocumentId | undefined;
  },
): Omit<ViewQueryResponse, "documents"> & { readonly documents: readonly T[] } {
  const queryNeedle = request.query?.trim().toLowerCase() ?? "";
  const filterEntries = Object.entries(request.filter ?? {});
  const tagFilter = request.tag?.trim().toLowerCase();

  const filtered = authorizedDocs.filter((doc) => {
    if (options?.matchingSpaceIds) {
      if (!options.matchingSpaceIds.has(doc.spaceId)) return false;
    } else if (request.spaceId && doc.spaceId !== request.spaceId) {
      return false;
    }
    if (request.kind && doc.kind !== request.kind) return false;
    if (tagFilter) {
      const hasTag = doc.tags.some(
        (tag) => tag.toLowerCase() === tagFilter || tag.toLowerCase().startsWith(`${tagFilter}/`),
      );
      if (!hasTag) return false;
    }
    if (request.pinnedOnly && !doc.pinned) return false;
    if (request.unreadOnly && !doc.unreadAgentUpdate) return false;
    if (queryNeedle) {
      const hit =
        doc.title.toLowerCase().includes(queryNeedle) ||
        doc.excerpt.toLowerCase().includes(queryNeedle) ||
        doc.tags.some((t) => t.toLowerCase().includes(queryNeedle));
      if (!hit) return false;
    }
    for (const [field, cond] of filterEntries) {
      const actual = readDocumentFieldValue(doc, field);
      if (!matchesCondition(actual, cond)) return false;
    }
    return true;
  });

  const effectiveSortRules = normalizeSortRules(request.sort, request.sortRules);
  const sorted = [...filtered].sort((a, b) => {
    for (const rule of effectiveSortRules) {
      const cmp = compareSortValues(
        readDocumentFieldValue(a, rule.field),
        readDocumentFieldValue(b, rule.field),
        rule.dir,
      );
      if (cmp !== 0) return cmp;
    }
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });

  const numericAggregates: ViewQueryNumericAggregate[] = [];
  for (const field of schemaFields) {
    if (field.type !== "number") continue;
    let count = 0;
    let sum = 0;
    for (const doc of sorted) {
      const raw = doc.properties?.[field.key];
      const num = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
      if (Number.isFinite(num)) {
        count += 1;
        sum += num;
      }
    }
    numericAggregates.push({
      field: field.key,
      count,
      sum,
      avg: count > 0 ? sum / count : 0,
    });
  }

  const limit = Math.max(1, Math.min(200, request.limit ?? 50));
  const offset = Math.max(0, request.offset ?? 0);

  return {
    documents: sorted.slice(offset, offset + limit),
    totalCount: sorted.length,
    limit,
    offset,
    schemaFields,
    numericAggregates,
  };
}
