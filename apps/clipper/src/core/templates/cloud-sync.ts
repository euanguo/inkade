import { BUILTIN_CLIPPER_TEMPLATES } from "@inkade/clipper-core/templates";
import {
  CLIPPER_TEMPLATE_MARKER,
  parseClipperTemplateFromDocumentTemplate,
  serializeClipperTemplateToDocumentTemplate,
  type ClipperTemplate,
  type TemplateId,
} from "@inkade/core";
import type { InkadeClient } from "@inkade/sdk";

/**
 * Uploads local ClipperTemplates into Inkade's `/api/v1/templates` (`kind: "clip"`),
 * updating matching cloud entries cleanly without touching unrelated templates.
 */
export async function pushTemplatesToInkade(
  client: InkadeClient,
  templates: readonly ClipperTemplate[],
): Promise<number> {
  const existingCloud = await client.templates.list("clip");
  const cloudByClipperId = new Map<string, TemplateId>();
  for (const docTpl of existingCloud) {
    const parsed = parseClipperTemplateFromDocumentTemplate(docTpl);
    if (parsed) {
      cloudByClipperId.set(parsed.id, docTpl.id);
    }
  }

  let synced = 0;
  for (const tpl of templates) {
    const payload = serializeClipperTemplateToDocumentTemplate(tpl);
    const existingDocTplId = cloudByClipperId.get(tpl.id);
    if (existingDocTplId) {
      await client.templates.update(existingDocTplId, {
        name: payload.name,
        description: payload.description,
        contentMarkdown: payload.contentMarkdown,
      });
    } else {
      await client.templates.create(payload);
    }
    synced++;
  }

  return synced;
}

/**
 * Pulls ClipperTemplates from Inkade's `/api/v1/templates` and merges them with local templates.
 */
export async function pullTemplatesFromInkade(
  client: InkadeClient,
  localTemplates: readonly ClipperTemplate[] = BUILTIN_CLIPPER_TEMPLATES,
): Promise<ClipperTemplate[]> {
  const cloudDocs = await client.templates.list("clip");
  const byId = new Map<string, ClipperTemplate>();
  for (const local of localTemplates) {
    byId.set(local.id, local);
  }

  for (const docTpl of cloudDocs) {
    if (!docTpl.contentMarkdown.includes(CLIPPER_TEMPLATE_MARKER)) continue;
    const parsed = parseClipperTemplateFromDocumentTemplate(docTpl);
    if (parsed) {
      byId.set(parsed.id, parsed);
    }
  }

  return [...byId.values()].sort((a, b) => b.priority - a.priority);
}
