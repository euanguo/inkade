import type { ExtractedArticle } from "@inkade/clipper-core/extractor";
import {
  clipperTemplateSchema,
  type ClipperTemplate,
  type ClipperTemplateBehavior,
  type ClipperTemplateTrigger,
  type ClipperTriggerType,
} from "@inkade/core";
import { z } from "zod";
import type { ClipperTranslateFn } from "../shared/clipper-ui-helpers.ts";

export interface TemplateEditorFormValues {
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  triggers: ClipperTemplateTrigger[];
  behavior: ClipperTemplateBehavior;
  titleTemplate: string;
  tagsTemplate: string;
  contentTemplate: string;
  propertiesJson: string;
  appendToDaily: boolean;
  dailyLineTemplate: string;
}

export function createTemplateEditorSchema(t: ClipperTranslateFn) {
  return z.object({
    name: z.string().trim().min(1, t("validation.required")),
    description: z.string(),
    enabled: z.boolean(),
    priority: z.number(),
    triggers: z.array(
      z.object({
        type: z.enum(["url-prefix", "glob", "regex", "schema-type"]),
        pattern: z.string(),
      }),
    ),
    behavior: z.enum(["create", "append-existing", "daily-only"]),
    titleTemplate: z.string().trim().min(1, t("validation.required")),
    tagsTemplate: z.string(),
    contentTemplate: z.string(),
    propertiesJson: z.string().refine(
      (val) => {
        try {
          const parsed = JSON.parse(val || "[]") as unknown;
          return Array.isArray(parsed);
        } catch {
          return false;
        }
      },
      { message: t("common.unknownError") },
    ),
    appendToDaily: z.boolean(),
    dailyLineTemplate: z.string(),
  });
}

export function templateToFormValues(tpl: ClipperTemplate): TemplateEditorFormValues {
  return {
    name: tpl.name,
    description: tpl.description,
    enabled: tpl.enabled,
    priority: tpl.priority,
    triggers: [...tpl.triggers],
    behavior: tpl.behavior,
    titleTemplate: tpl.titleTemplate,
    tagsTemplate: tpl.tagsTemplate,
    contentTemplate: tpl.contentTemplate,
    propertiesJson: JSON.stringify(tpl.properties, null, 2),
    appendToDaily: tpl.appendToDaily,
    dailyLineTemplate: tpl.dailyLineTemplate,
  };
}

export function buildSampleArticleForUrl(rawUrl: string): ExtractedArticle {
  let domain = "example.com";
  try {
    domain = new URL(rawUrl).hostname || "example.com";
  } catch {
    domain = "example.com";
  }
  return {
    url: rawUrl,
    title: `Sample Article (${domain})`,
    markdown: "# Sample Article\n\nThis is a sample paragraph used to test template rendering.",
    excerpt: "Sample paragraph used to test template rendering.",
    htmlSnapshot: "<article><h1>Sample Article</h1><p>Body text</p></article>",
    cleanHtml: "<article><h1>Sample Article</h1><p>Body text</p></article>",
    imageUrls: [],
    meta: {
      domain,
      author: "Inkade Author",
      published: "2026-11-24",
      site: domain,
      wordCount: 14,
      schemaTypes: ["Article"],
    },
    variables: {},
    extractor: "sample",
  };
}

export interface DraftTemplateValues {
  name?: string | undefined;
  description?: string | undefined;
  enabled?: boolean | undefined;
  priority?: number | undefined;
  triggers?:
    | ReadonlyArray<{
        type?: ClipperTriggerType | undefined;
        pattern?: string | undefined;
      }>
    | undefined;
  behavior?: ClipperTemplateBehavior | undefined;
  titleTemplate?: string | undefined;
  tagsTemplate?: string | undefined;
  contentTemplate?: string | undefined;
  propertiesJson?: string | undefined;
  appendToDaily?: boolean | undefined;
  dailyLineTemplate?: string | undefined;
}

export function buildDraftTemplateFromValues(
  selected: ClipperTemplate | null,
  values: DraftTemplateValues,
): ClipperTemplate | null {
  if (!selected) return null;
  const rawTriggers = values.triggers ?? [];
  const cleanedTriggers = rawTriggers.filter(
    (tr): tr is ClipperTemplateTrigger =>
      typeof tr.type === "string" && typeof tr.pattern === "string" && tr.pattern.trim().length > 0,
  );
  const parsedProps = JSON.parse(values.propertiesJson || "[]") as unknown;
  const numericPriority = Number(values.priority);
  return clipperTemplateSchema.parse({
    ...selected,
    name: values.name ?? selected.name,
    description: values.description ?? "",
    enabled: values.enabled ?? true,
    priority: Number.isFinite(numericPriority) ? numericPriority : 0,
    triggers: cleanedTriggers.map((tr) => ({ type: tr.type, pattern: tr.pattern.trim() })),
    behavior: values.behavior ?? "create",
    titleTemplate: values.titleTemplate ?? "{{title}}",
    tagsTemplate: values.tagsTemplate ?? "",
    contentTemplate: values.contentTemplate ?? "{{content}}",
    properties: parsedProps,
    appendToDaily: values.appendToDaily ?? false,
    dailyLineTemplate: values.dailyLineTemplate ?? "",
  });
}

export function getBehaviorLabel(
  t: ClipperTranslateFn,
  behavior: ClipperTemplateBehavior | undefined,
): string {
  if (behavior === "append-existing") return t("clipper.templateBehaviorAppendExisting");
  if (behavior === "daily-only") return t("clipper.templateBehaviorDailyOnly");
  return t("clipper.templateBehaviorCreate");
}

export function getTriggerTypeLabel(t: ClipperTranslateFn, type: ClipperTriggerType): string {
  if (type === "url-prefix") return t("clipper.triggerTypeUrlPrefix");
  if (type === "glob") return t("clipper.triggerTypeGlob");
  if (type === "regex") return t("clipper.triggerTypeRegex");
  return t("clipper.triggerTypeSchema");
}
