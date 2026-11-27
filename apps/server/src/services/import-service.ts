import { basename, extname, posix } from "node:path";
import { unzipSync } from "fflate";
import Papa from "papaparse";
import {
  createId,
  extractExcerpt,
  extractInlineTags,
  hashTextForEmbedding,
  ID_PREFIXES,
  InkadeError,
  markdownToPlainText,
  parseDocxPackageFiles,
  parseMarkdownWithFrontmatter,
  PROPERTY_KEY_REGEX,
  rewriteObsidianWikiLinks,
  serializeMarkdownWithFrontmatter,
  slugifyTitle,
  stripLeadingDuplicateTitle,
  stripNotionUuidSuffix,
  type AttachmentId,
  type AuditBatchId,
  type DocumentId,
  type DocumentKind,
  type DocumentRecord,
  type ImportCommitInput,
  type ImportCommitResult,
  type ImportConflictPolicy,
  type ImportFormat,
  type ImportPreviewInput,
  type ImportPreviewItem,
  type ImportPreviewResult,
  type PropertyFieldDefinition,
  type PropertyFieldType,
  type Space,
  type SpaceId,
} from "@inkade/core";
import {
  DEFAULT_SPACE_IDS,
  type DocumentRepo,
  type RevisionLinkRepo,
  type SpaceRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import type { AttachmentService } from "./attachment-service.ts";
import type { AuditService } from "./audit-service.ts";
import { parseClipHtml } from "./clipper-service.ts";
import { decodeDocxArchive } from "./docx-codec.ts";
import type { DocumentService } from "./document-service.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

const MAX_ZIP_ENTRIES = 2000;
const MAX_ZIP_TOTAL_BYTES = 50 * 1024 * 1024;

interface ZipEntryFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

interface ParsedImportDocCandidate {
  readonly sourcePath: string;
  readonly folderSegments: readonly string[];
  readonly title: string;
  readonly kind: DocumentKind;
  readonly markdownBody: string;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly properties: Record<string, unknown>;
  readonly sourceUrl?: string | undefined;
  readonly sourceMeta?: Record<string, unknown> | undefined;
  readonly contentFingerprint: string;
  readonly rawWikilinksCount: number;
  readonly localAttachmentRefs: readonly string[];
  readonly notionLinkTargets?: readonly {
    readonly rawHref: string;
    readonly strippedTitle: string;
  }[] | undefined;
  readonly docxMediaRewrites?: readonly {
    readonly placeholderUrl: string;
    readonly attachmentKey: string;
  }[] | undefined;
}

interface ParsedImportAttachmentCandidate {
  readonly sourcePath: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

interface ParsedSchemaFieldPlan {
  readonly folderPath: string;
  readonly fields: readonly PropertyFieldDefinition[];
}

interface ParsedImportBundle {
  readonly docs: readonly ParsedImportDocCandidate[];
  readonly attachments: readonly ParsedImportAttachmentCandidate[];
  readonly schemas: readonly ParsedSchemaFieldPlan[];
  readonly warnings: readonly string[];
}

function guessMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".webm":
      return "audio/webm";
    default:
      return "application/octet-stream";
  }
}

function isZipBytes(bytes: Uint8Array, filename?: string): boolean {
  if (bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return true;
  }
  return Boolean(filename && filename.toLowerCase().endsWith(".zip"));
}

function isSafeArchiveEntryPath(rawPath: string): boolean {
  const norm = rawPath.replace(/\\/g, "/").trim();
  if (!norm || norm.startsWith("/") || norm.includes("\0")) return false;
  const parts = norm.split("/");
  if (parts.some((p) => p === "..")) return false;
  if (norm.startsWith("__MACOSX/") || norm.includes("/.obsidian/") || norm.startsWith(".obsidian/")) {
    return false;
  }
  if (norm.startsWith(".trash/") || norm.includes("/.trash/")) {
    return false;
  }
  if (norm.endsWith("/")) return false;
  return true;
}

function extractZipEntries(bytes: Uint8Array): ZipEntryFile[] {
  let rawMap: Record<string, Uint8Array>;
  try {
    rawMap = unzipSync(bytes);
  } catch (err) {
    throw new InkadeError(
      "VALIDATION_ERROR",
      `Invalid ZIP archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const keys = Object.keys(rawMap);
  if (keys.length > MAX_ZIP_ENTRIES) {
    throw new InkadeError(
      "VALIDATION_ERROR",
      `ZIP archive exceeds maximum ${MAX_ZIP_ENTRIES} entries`,
    );
  }

  let totalBytes = 0;
  const entries: ZipEntryFile[] = [];
  for (const key of keys.sort()) {
    if (!isSafeArchiveEntryPath(key)) continue;
    const data = rawMap[key];
    if (!data) continue;
    totalBytes += data.byteLength;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        `ZIP uncompressed size exceeds ${MAX_ZIP_TOTAL_BYTES} bytes`,
      );
    }
    entries.push({ path: posix.normalize(key.replace(/\\/g, "/")), bytes: data });
  }
  return entries;
}

function decodePayload(input: ImportPreviewInput): {
  readonly bytes: Uint8Array | null;
  readonly text: string | null;
  readonly filename: string;
} {
  const filename = input.filename?.trim() || "import";
  if (input.payloadBase64) {
    const cleanB64 = input.payloadBase64.includes(",")
      ? input.payloadBase64.slice(input.payloadBase64.indexOf(",") + 1)
      : input.payloadBase64;
    const buf = Buffer.from(cleanB64, "base64");
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return {
      bytes,
      text: isZipBytes(bytes, filename) ? null : buf.toString("utf8"),
      filename,
    };
  }
  const text = input.payloadText ?? "";
  return {
    bytes: new TextEncoder().encode(text),
    text,
    filename,
  };
}

function sanitizePropertyKey(rawHeader: string, idx: number): string {
  const cleaned = rawHeader
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[^a-z_]+/, "")
    .replace(/^_+|_+$/g, "");
  if (cleaned && PROPERTY_KEY_REGEX.test(cleaned)) {
    return cleaned.slice(0, 64);
  }
  return `col_${idx + 1}`;
}

function inferCsvPropertySchema(
  headers: readonly string[],
  rows: readonly Record<string, string>[],
): {
  readonly fields: PropertyFieldDefinition[];
  readonly keyByHeader: Map<string, string>;
} {
  const keyByHeader = new Map<string, string>();
  const usedKeys = new Set<string>();
  const fields: PropertyFieldDefinition[] = [];

  headers.forEach((header, idx) => {
    const trimmed = header.trim();
    if (!trimmed) return;
    let key = sanitizePropertyKey(trimmed, idx);
    while (usedKeys.has(key)) {
      key = `${key}_${idx + 1}`.slice(0, 64);
    }
    usedKeys.add(key);
    keyByHeader.set(trimmed, key);

    if (idx === 0) return; // First column is typically Title/Name

    const samples = rows
      .map((r) => (r[header] ?? "").trim())
      .filter((v) => v.length > 0);
    let inferredType: PropertyFieldType = "text";
    let options: Array<{ value: string; label: string }> = [];

    if (samples.length > 0) {
      if (samples.every((v) => /^(true|false|yes|no|是|否)$/i.test(v))) {
        inferredType = "checkbox";
      } else if (samples.every((v) => /^-?\d+(?:\.\d+)?$/.test(v))) {
        inferredType = "number";
      } else if (samples.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) {
        inferredType = "date";
      } else if (samples.every((v) => /^https?:\/\/\S+$/i.test(v))) {
        inferredType = "url";
      } else if (samples.some((v) => v.includes(","))) {
        const distinct = [
          ...new Set(
            samples.flatMap((v) =>
              v
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean),
            ),
          ),
        ];
        if (distinct.length > 0 && distinct.length <= 20) {
          inferredType = "multi_select";
          options = distinct.map((v) => ({ value: v, label: v }));
        }
      } else {
        const distinct = [...new Set(samples)];
        if (distinct.length > 0 && distinct.length <= 12 && rows.length >= 2) {
          inferredType = "select";
          options = distinct.map((v) => ({ value: v, label: v }));
        }
      }
    }

    fields.push({
      key,
      label: trimmed.slice(0, 80),
      type: inferredType,
      options,
      showInTable: true,
      showInCard: true,
      requiredByAgent: false,
    });
  });

  return { fields, keyByHeader };
}

function coerceCsvCellValue(raw: string, type: PropertyFieldType): unknown {
  const val = raw.trim();
  if (!val) return undefined;
  switch (type) {
    case "checkbox":
      return /^(true|yes|是|1)$/i.test(val);
    case "number": {
      const n = Number(val);
      return Number.isFinite(n) ? n : val;
    }
    case "multi_select":
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    case "date": {
      const match = /^(\d{4}-\d{2}-\d{2})/.exec(val);
      return match?.[1] ?? val;
    }
    default:
      return val;
  }
}

function normalizeFrontmatterTags(rawTags: unknown): string[] {
  if (Array.isArray(rawTags)) {
    return rawTags
      .map((item) => String(item).trim().replace(/^#+/, ""))
      .filter(Boolean);
  }
  if (typeof rawTags === "string") {
    return rawTags
      .split(/[,\s]+/)
      .map((item) => item.trim().replace(/^#+/, ""))
      .filter(Boolean);
  }
  return [];
}

function parseObsidianBundle(entries: readonly ZipEntryFile[], defaultTags: readonly string[]): ParsedImportBundle {
  const docs: ParsedImportDocCandidate[] = [];
  const attachments: ParsedImportAttachmentCandidate[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const ext = extname(entry.path).toLowerCase();
    if (ext === ".md" || ext === ".markdown") {
      const rawMarkdown = new TextDecoder().decode(entry.bytes);
      const parsedFm = parseMarkdownWithFrontmatter(rawMarkdown);
      const fileStem = basename(entry.path, ext).trim() || "Untitled";
      const fmTitle =
        typeof parsedFm.frontmatter.title === "string" && parsedFm.frontmatter.title.trim()
          ? parsedFm.frontmatter.title.trim()
          : fileStem;
      const tags = [
        ...new Set([
          ...defaultTags,
          ...normalizeFrontmatterTags(parsedFm.frontmatter.tags),
          ...extractInlineTags(parsedFm.bodyMarkdown),
        ]),
      ];
      const aliases = normalizeFrontmatterTags(parsedFm.frontmatter.aliases);

      const cleanProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsedFm.frontmatter)) {
        if (k === "title" || k === "tags" || k === "aliases" || k === "id") continue;
        cleanProps[k] = v;
      }

      const dir = posix.dirname(entry.path);
      const folderSegments =
        dir === "." ? [] : dir.split("/").filter((seg) => Boolean(seg) && seg !== ".");

      const wikiLinks = parsedFm.bodyMarkdown.includes("[[")
        ? Array.from(parsedFm.bodyMarkdown.matchAll(/(!)?\[\[([^[\]]+?)\]\]/g))
        : [];
      const localAttachmentRefs = wikiLinks
        .filter((m) => Boolean(m[1]))
        .map((m) => (m[2] ?? "").split("|")[0]?.trim() ?? "")
        .filter(Boolean);

      docs.push({
        sourcePath: entry.path,
        folderSegments,
        title: fmTitle,
        kind: "article",
        markdownBody: parsedFm.bodyMarkdown.trim(),
        tags,
        aliases,
        properties: cleanProps,
        contentFingerprint: hashTextForEmbedding(`${fmTitle}\n${parsedFm.bodyMarkdown}`),
        rawWikilinksCount: wikiLinks.filter((m) => !m[1]).length,
        localAttachmentRefs,
      });
    } else if (
      [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".pdf", ".mp3", ".wav", ".m4a"].includes(
        ext,
      )
    ) {
      attachments.push({
        sourcePath: entry.path,
        filename: basename(entry.path),
        mimeType: guessMimeType(entry.path),
        bytes: entry.bytes,
      });
    }
  }

  return { docs, attachments, schemas: [], warnings };
}

function parseNotionBundle(entries: readonly ZipEntryFile[], defaultTags: readonly string[]): ParsedImportBundle {
  const docs: ParsedImportDocCandidate[] = [];
  const attachments: ParsedImportAttachmentCandidate[] = [];
  const schemas: ParsedSchemaFieldPlan[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const ext = extname(entry.path).toLowerCase();
    const dir = posix.dirname(entry.path);
    const folderSegments =
      dir === "."
        ? []
        : dir
            .split("/")
            .filter((seg) => Boolean(seg) && seg !== ".")
            .map((seg) => stripNotionUuidSuffix(seg));

    if (ext === ".md" || ext === ".markdown") {
      const rawMarkdown = new TextDecoder().decode(entry.bytes);
      const parsedFm = parseMarkdownWithFrontmatter(rawMarkdown);
      const title = stripNotionUuidSuffix(basename(entry.path));
      const tags = [
        ...new Set([
          ...defaultTags,
          ...normalizeFrontmatterTags(parsedFm.frontmatter.tags),
          ...extractInlineTags(parsedFm.bodyMarkdown),
        ]),
      ];

      // Collect relative Notion links `[Text](Some%20Page%20<32hex>.md)`
      const notionLinkTargets: Array<{ rawHref: string; strippedTitle: string }> = [];
      const linkMatches = parsedFm.bodyMarkdown.matchAll(/\[[^\]]*\]\(([^)]+\.md)\)/gi);
      for (const m of linkMatches) {
        const href = m[1] ?? "";
        const decoded = decodeURIComponent(href.split("#")[0] ?? href);
        notionLinkTargets.push({
          rawHref: href,
          strippedTitle: stripNotionUuidSuffix(basename(decoded)),
        });
      }

      docs.push({
        sourcePath: entry.path,
        folderSegments,
        title,
        kind: "article",
        markdownBody: parsedFm.bodyMarkdown.trim(),
        tags,
        aliases: [],
        properties: parsedFm.frontmatter,
        contentFingerprint: hashTextForEmbedding(`${title}\n${parsedFm.bodyMarkdown}`),
        rawWikilinksCount: notionLinkTargets.length,
        localAttachmentRefs: [],
        notionLinkTargets,
      });
    } else if (ext === ".csv") {
      const csvText = new TextDecoder().decode(entry.bytes).replace(/^\uFEFF/, "");
      const parsed = Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
      });
      if (parsed.errors.length > 0) {
        warnings.push(`CSV "${entry.path}": ${parsed.errors[0]?.message ?? "parse warning"}`);
      }
      const headers = parsed.meta.fields ?? [];
      if (headers.length === 0) continue;

      const dbName = stripNotionUuidSuffix(basename(entry.path));
      const dbFolderPath = [...folderSegments, dbName].join("/");
      const { fields, keyByHeader } = inferCsvPropertySchema(headers, parsed.data);
      const fieldByKey = new Map(fields.map((f) => [f.key, f]));
      if (fields.length > 0) {
        schemas.push({ folderPath: dbFolderPath, fields });
      }

      const titleHeader = headers[0]!;
      parsed.data.forEach((row, rowIdx) => {
        const rawTitle = (row[titleHeader] ?? "").trim();
        const title = rawTitle ? stripNotionUuidSuffix(rawTitle) : `${dbName} #${rowIdx + 1}`;
        const properties: Record<string, unknown> = {};
        const mdLines: string[] = [`# ${title}`, ""];

        for (const h of headers.slice(1)) {
          const propKey = keyByHeader.get(h);
          if (!propKey) continue;
          const fieldDef = fieldByKey.get(propKey);
          const rawVal = (row[h] ?? "").trim();
          if (!rawVal) continue;
          properties[propKey] = coerceCsvCellValue(rawVal, fieldDef?.type ?? "text");
          mdLines.push(`- **${h}**: ${rawVal}`);
        }

        const body = mdLines.join("\n");
        docs.push({
          sourcePath: `${entry.path}#row=${rowIdx + 1}`,
          folderSegments: [...folderSegments, dbName],
          title,
          kind: "article",
          markdownBody: body,
          tags: [...defaultTags],
          aliases: [],
          properties,
          contentFingerprint: hashTextForEmbedding(`${title}\n${body}`),
          rawWikilinksCount: 0,
          localAttachmentRefs: [],
        });
      });
    } else if (
      [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".pdf"].includes(ext)
    ) {
      attachments.push({
        sourcePath: entry.path,
        filename: basename(entry.path),
        mimeType: guessMimeType(entry.path),
        bytes: entry.bytes,
      });
    }
  }

  return { docs, attachments, schemas, warnings };
}

function parseReadwiseBundle(
  entries: readonly ZipEntryFile[],
  defaultTags: readonly string[],
): ParsedImportBundle {
  const docs: ParsedImportDocCandidate[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const ext = extname(entry.path).toLowerCase();
    const rawText = new TextDecoder().decode(entry.bytes).replace(/^\uFEFF/, "");
    if (ext === ".csv" || (!ext && rawText.includes(",") && rawText.includes("\n"))) {
      const parsed = Papa.parse<Record<string, string>>(rawText, {
        header: true,
        skipEmptyLines: true,
      });
      if (parsed.errors.length > 0) {
        warnings.push(`Readwise CSV "${entry.path}": ${parsed.errors[0]?.message ?? "warning"}`);
      }
      const grouped = new Map<
        string,
        {
          readonly title: string;
          readonly author: string;
          readonly sourceUrl?: string | undefined;
          readonly tags: Set<string>;
          readonly highlights: Array<{ text: string; note?: string; location?: string }>;
        }
      >();

      for (const row of parsed.data) {
        const title =
          (
            row["Book Title"] ??
            row["Title"] ??
            row["title"] ??
            row["Document"] ??
            ""
          ).trim() || "Untitled Highlight";
        const author = (row["Author"] ?? row["author"] ?? "").trim();
        const urlRaw = (
          row["URL"] ??
          row["Source URL"] ??
          row["url"] ??
          row["Amazon Book ID"] ??
          ""
        ).trim();
        const sourceUrl = /^https?:\/\//i.test(urlRaw) ? urlRaw : undefined;
        const highlight = (
          row["Highlight"] ??
          row["Text"] ??
          row["Quote"] ??
          row["highlight"] ??
          ""
        ).trim();
        const note = (row["Note"] ?? row["note"] ?? "").trim();
        const location = (row["Location"] ?? row["location"] ?? "").trim();
        const rowTags = normalizeFrontmatterTags(
          row["Document Tags"] ?? row["Tags"] ?? row["tags"] ?? "",
        );

        const groupKey = sourceUrl ? `url:${sourceUrl}` : `title:${title.toLowerCase()}`;
        let group = grouped.get(groupKey);
        if (!group) {
          group = {
            title,
            author,
            sourceUrl,
            tags: new Set(["readwise", ...defaultTags]),
            highlights: [],
          };
          grouped.set(groupKey, group);
        }
        for (const tg of rowTags) group.tags.add(tg);
        if (highlight || note) {
          group.highlights.push({
            text: highlight || note,
            ...(note && highlight ? { note } : {}),
            ...(location ? { location } : {}),
          });
        }
      }

      let idx = 0;
      for (const group of grouped.values()) {
        idx += 1;
        const lines: string[] = [];
        if (group.author) lines.push(`*By ${group.author}*`, "");
        for (const hl of group.highlights) {
          lines.push(`> ${hl.text.replace(/\n+/g, "\n> ")}`);
          if (hl.note) lines.push("", `- Note: ${hl.note}`);
          if (hl.location) lines.push("", `- Location: ${hl.location}`);
          lines.push("");
        }
        const markdownBody = lines.join("\n").trim() || group.title;
        docs.push({
          sourcePath: `${entry.path}#group=${idx}`,
          folderSegments: [],
          title: group.title,
          kind: "clip",
          markdownBody,
          tags: [...group.tags],
          aliases: [],
          properties: group.author ? { author: group.author } : {},
          sourceUrl: group.sourceUrl,
          sourceMeta: { importedFrom: "readwise", highlightCount: group.highlights.length },
          contentFingerprint: hashTextForEmbedding(`${group.title}\n${markdownBody}`),
          rawWikilinksCount: 0,
          localAttachmentRefs: [],
        });
      }
    } else {
      // Kindle My Clippings.txt or Markdown highlights
      const blocks = rawText
        .split(/\n==========\r?\n/)
        .map((b) => b.trim())
        .filter(Boolean);
      if (blocks.length > 1) {
        const byTitle = new Map<string, string[]>();
        for (const block of blocks) {
          const lines = block.split(/\r?\n/);
          const title = (lines[0] ?? "Kindle Clipping").trim();
          const quote = lines.slice(2).join("\n").trim();
          if (!quote) continue;
          const list = byTitle.get(title) ?? [];
          list.push(`> ${quote.replace(/\n+/g, "\n> ")}`);
          byTitle.set(title, list);
        }
        let i = 0;
        for (const [title, quotes] of byTitle.entries()) {
          i += 1;
          const markdownBody = quotes.join("\n\n");
          docs.push({
            sourcePath: `${entry.path}#kindle=${i}`,
            folderSegments: [],
            title,
            kind: "clip",
            markdownBody,
            tags: ["kindle", ...defaultTags],
            aliases: [],
            properties: {},
            sourceMeta: { importedFrom: "kindle", highlightCount: quotes.length },
            contentFingerprint: hashTextForEmbedding(`${title}\n${markdownBody}`),
            rawWikilinksCount: 0,
            localAttachmentRefs: [],
          });
        }
      } else {
        const parsedFm = parseMarkdownWithFrontmatter(rawText);
        const title =
          typeof parsedFm.frontmatter.title === "string" && parsedFm.frontmatter.title.trim()
            ? parsedFm.frontmatter.title.trim()
            : basename(entry.path, ext) || "Readwise Import";
        const sourceUrl =
          typeof parsedFm.frontmatter.url === "string" &&
          /^https?:\/\//i.test(parsedFm.frontmatter.url)
            ? parsedFm.frontmatter.url
            : undefined;
        docs.push({
          sourcePath: entry.path,
          folderSegments: [],
          title,
          kind: "clip",
          markdownBody: parsedFm.bodyMarkdown.trim(),
          tags: [
            ...new Set([
              "readwise",
              ...defaultTags,
              ...normalizeFrontmatterTags(parsedFm.frontmatter.tags),
            ]),
          ],
          aliases: [],
          properties: parsedFm.frontmatter,
          sourceUrl,
          contentFingerprint: hashTextForEmbedding(`${title}\n${parsedFm.bodyMarkdown}`),
          rawWikilinksCount: 0,
          localAttachmentRefs: [],
        });
      }
    }
  }

  return { docs, attachments: [], schemas: [], warnings };
}

function parseHtmlBundle(
  entries: readonly ZipEntryFile[],
  defaultTags: readonly string[],
): ParsedImportBundle {
  const docs: ParsedImportDocCandidate[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const ext = extname(entry.path).toLowerCase();
    if (ext && ext !== ".html" && ext !== ".htm") continue;
    const html = new TextDecoder().decode(entry.bytes);
    const parsed = parseClipHtml(html, `https://import.local/${encodeURIComponent(entry.path)}`);
    const title = parsed.title.trim() || basename(entry.path, ext) || "Imported Page";
    const markdownBody = parsed.markdown.trim() || title;
    docs.push({
      sourcePath: entry.path,
      folderSegments: [],
      title,
      kind: "clip",
      markdownBody,
      tags: [...new Set(["html-import", ...defaultTags])],
      aliases: [],
      properties: {},
      sourceMeta: { ...parsed.meta, importedFrom: "html", extractor: parsed.extractor },
      contentFingerprint: hashTextForEmbedding(`${title}\n${markdownBody}`),
      rawWikilinksCount: 0,
      localAttachmentRefs: [],
    });
  }

  return { docs, attachments: [], schemas: [], warnings };
}

function parseDocxBundle(
  entries: readonly ZipEntryFile[],
  defaultTags: readonly string[],
  rawFilename: string,
): ParsedImportBundle {
  const docs: ParsedImportDocCandidate[] = [];
  const attachments: ParsedImportAttachmentCandidate[] = [];
  const warnings: string[] = [];

  const hasWordDocumentXml = entries.some((e) => e.path.toLowerCase() === "word/document.xml");

  const appendParsedDocx = (
    filesMap: ReadonlyMap<string, Uint8Array>,
    sourcePath: string,
    folderSegments: readonly string[],
    docIndex: number,
  ): void => {
    const parsed = parseDocxPackageFiles(filesMap, { filename: sourcePath });
    warnings.push(...parsed.warnings);

    const docKey = `docx_${docIndex}`;
    const docxMediaRewrites: Array<{ readonly placeholderUrl: string; readonly attachmentKey: string }> = [];
    for (const img of parsed.images) {
      const attachmentKey = `${docKey}/${img.archivePath}`;
      attachments.push({
        sourcePath: attachmentKey,
        filename: img.filename,
        mimeType: img.mimeType,
        bytes: img.bytes,
      });
      docxMediaRewrites.push({
        placeholderUrl: img.placeholderUrl,
        attachmentKey,
      });
    }

    const trimmedParsedMarkdown = parsed.markdown.trim();
    const bodyWithoutTitle = stripLeadingDuplicateTitle(trimmedParsedMarkdown, parsed.title);
    const markdownBody = bodyWithoutTitle || (trimmedParsedMarkdown === `# ${parsed.title}` ? "" : trimmedParsedMarkdown) || `# ${parsed.title}`;
    const tags = [...new Set([...defaultTags, ...extractInlineTags(markdownBody)])];
    docs.push({
      sourcePath,
      folderSegments,
      title: parsed.title,
      kind: "article",
      markdownBody,
      tags,
      aliases: [],
      properties: {},
      sourceMeta: { importedFrom: "docx", sourceFilename: basename(sourcePath) },
      contentFingerprint: hashTextForEmbedding(`${parsed.title}\n${markdownBody}`),
      rawWikilinksCount: 0,
      localAttachmentRefs: parsed.images.map((img) => img.archivePath),
      docxMediaRewrites,
    });
  };

  if (hasWordDocumentXml) {
    const filesMap = new Map<string, Uint8Array>();
    for (const entry of entries) {
      filesMap.set(entry.path, entry.bytes);
    }
    const displayPath = rawFilename.trim() || "document.docx";
    appendParsedDocx(filesMap, displayPath, [], 0);
  } else {
    const docxEntries = entries.filter(
      (entry) =>
        entry.path.toLowerCase().endsWith(".docx") &&
        !basename(entry.path).startsWith("~$"),
    );
    if (docxEntries.length === 0) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "No valid .docx archive (word/document.xml) found in import payload",
      );
    }
    docxEntries.forEach((entry, idx) => {
      const filesMap = decodeDocxArchive(entry.bytes);
      const dir = posix.dirname(entry.path);
      const folderSegments =
        dir === "." ? [] : dir.split("/").filter((seg) => Boolean(seg) && seg !== ".");
      appendParsedDocx(filesMap, entry.path, folderSegments, idx);
    });
  }

  return { docs, attachments, schemas: [], warnings };
}

function rewriteDocxMediaReferences(
  markdown: string,
  candidate: ParsedImportDocCandidate,
  attachmentDownloadByKey: ReadonlyMap<string, { url: string; filename: string }>,
): string {
  if (!candidate.docxMediaRewrites || candidate.docxMediaRewrites.length === 0) {
    return markdown;
  }
  let next = markdown;
  for (const rewrite of candidate.docxMediaRewrites) {
    const uploaded = attachmentDownloadByKey.get(rewrite.attachmentKey.toLowerCase());
    if (!uploaded) continue;
    next = next.replaceAll(rewrite.placeholderUrl, uploaded.url);
  }
  return next;
}

export class ImportService {
  constructor(
    private readonly deps: {
      readonly documentRepo: DocumentRepo;
      readonly revisionLinkRepo: RevisionLinkRepo;
      readonly spaceRepo: SpaceRepo;
      readonly spacesCache?: WorkspaceSpacesCache | undefined;
      readonly documentService: DocumentService;
      readonly attachmentService: AttachmentService;
      readonly auditService: AuditService;
      readonly sseHub: SseHub;
      readonly onDocumentChanged?: (workspaceId: Principal["workspaceId"], docId: DocumentId) => void;
    },
  ) {}

  private parseBundle(input: ImportPreviewInput): ParsedImportBundle {
    const { bytes, text, filename } = decodePayload(input);
    const defaultTags = input.defaultTags ?? [];

    let entries: ZipEntryFile[];
    if (bytes && isZipBytes(bytes, filename)) {
      entries = extractZipEntries(bytes);
    } else {
      const contentBytes = bytes ?? new TextEncoder().encode(text ?? "");
      const defaultExt =
        input.format === "html"
          ? ".html"
          : input.format === "readwise" && (text ?? "").includes(",")
            ? ".csv"
            : ".md";
      const safeName = filename.includes(".") ? basename(filename) : `${filename}${defaultExt}`;
      entries = [{ path: safeName, bytes: contentBytes }];
    }

    switch (input.format) {
      case "obsidian":
        return parseObsidianBundle(entries, defaultTags);
      case "notion":
        return parseNotionBundle(entries, defaultTags);
      case "readwise":
        return parseReadwiseBundle(entries, defaultTags);
      case "html":
        return parseHtmlBundle(entries, defaultTags);
      case "docx":
        return parseDocxBundle(entries, defaultTags, filename);
      default: {
        const _exhaustive: never = input.format;
        return _exhaustive;
      }
    }
  }

  private async resolveTargetSpace(
    principal: Principal,
    targetSpaceId: SpaceId | undefined,
    format: ImportFormat,
  ): Promise<{ readonly space: Space; readonly allSpaces: readonly Space[] }> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    const active = allSpaces.filter((s) => s.archivedAt === null);
    const fallbackSlug = format === "readwise" || format === "html" ? "inbox" : "research";
    const resolved =
      (targetSpaceId ? active.find((s) => s.id === targetSpaceId) : undefined) ??
      active.find((s) => s.slug === fallbackSlug) ??
      active.find((s) => s.id === DEFAULT_SPACE_IDS.research) ??
      active[0];
    if (!resolved) {
      throw new InkadeError("NOT_FOUND", "No active target Space found for import");
    }
    assertScope(
      principal.scope,
      "write",
      { spaceId: resolved.id, resourceType: "space" },
      allSpaces,
    );
    return { space: resolved, allSpaces };
  }

  private findExistingMatch(
    candidate: ParsedImportDocCandidate,
    existingDocs: readonly DocumentRecord[],
    targetSpaceId: SpaceId,
  ): DocumentRecord | null {
    if (candidate.sourceUrl) {
      const byUrl = existingDocs.find(
        (d) => d.sourceUrl && d.sourceUrl.trim().toLowerCase() === candidate.sourceUrl!.toLowerCase(),
      );
      if (byUrl) return byUrl;
    }

    const cleanTitle = candidate.title.trim().toLowerCase();
    const byTitleInSpace = existingDocs.find(
      (d) => d.spaceId === targetSpaceId && d.title.trim().toLowerCase() === cleanTitle,
    );
    if (byTitleInSpace) return byTitleInSpace;

    const byFingerprint = existingDocs.find(
      (d) =>
        hashTextForEmbedding(`${d.title}\n${d.contentMarkdown}`) === candidate.contentFingerprint,
    );
    return byFingerprint ?? null;
  }

  async previewImport(
    principal: Principal,
    input: ImportPreviewInput,
  ): Promise<ImportPreviewResult> {
    const bundle = this.parseBundle(input);
    const { space: rootSpace } = await this.resolveTargetSpace(
      principal,
      input.targetSpaceId,
      input.format,
    );
    const policy: ImportConflictPolicy = input.conflictPolicy ?? "rename";
    const existingDocs = await this.deps.documentRepo.listDocuments(principal.workspaceId, {
      includeTrashed: false,
      includeSystem: false,
      limit: null,
    });
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );

    const plannedSpaces = new Set<string>();
    const items: ImportPreviewItem[] = [];
    let documentsToCreate = 0;
    let documentsToUpdate = 0;
    let documentsSkipped = 0;
    let wikilinksToRebind = 0;

    for (const doc of bundle.docs) {
      const folderPath = doc.folderSegments.join("/");
      const matchedSpace = folderPath
        ? allSpaces.find(
            (s) =>
              s.archivedAt === null &&
              s.parentId === rootSpace.id &&
              s.name.toLowerCase() === doc.folderSegments[0]?.toLowerCase(),
          )
        : rootSpace;
      if (folderPath && !matchedSpace) {
        plannedSpaces.add(folderPath);
      }

      const existing = this.findExistingMatch(
        doc,
        existingDocs,
        matchedSpace?.id ?? rootSpace.id,
      );
      let action: ImportPreviewItem["action"] = "create";
      if (existing) {
        if (policy === "skip") {
          action = "skip";
          documentsSkipped += 1;
        } else if (policy === "overwrite") {
          action = "overwrite";
          documentsToUpdate += 1;
        } else {
          action = "rename";
          documentsToCreate += 1;
        }
      } else {
        documentsToCreate += 1;
      }

      wikilinksToRebind += doc.rawWikilinksCount;
      items.push({
        sourcePath: doc.sourcePath,
        title: doc.title,
        kind: doc.kind,
        targetSpaceName: doc.folderSegments.at(-1) ?? rootSpace.name,
        action,
        wikilinksCount: doc.rawWikilinksCount,
        attachmentCount: doc.localAttachmentRefs.length,
        tags: doc.tags,
        schemaFieldsCount: Object.keys(doc.properties).length,
        dedupeMatchedDocId: existing?.id ?? null,
      });
    }

    const schemaFieldsToAdd = bundle.schemas.reduce((acc, s) => acc + s.fields.length, 0);

    return {
      format: input.format,
      targetSpaceId: rootSpace.id,
      conflictPolicy: policy,
      totalFiles: bundle.docs.length + bundle.attachments.length,
      documentsToCreate,
      documentsToUpdate,
      documentsSkipped,
      spacesToCreate: plannedSpaces.size,
      schemaFieldsToAdd,
      attachmentsToImport: bundle.attachments.length,
      wikilinksToRebind,
      warnings: bundle.warnings,
      items,
    };
  }

  async commitImport(
    principal: Principal,
    input: ImportCommitInput,
  ): Promise<ImportCommitResult> {
    return this.commitImportInternal(principal, input);
  }

  async importSingleDocx(
    principal: Principal,
    options: {
      readonly filename: string;
      readonly bytes: Uint8Array;
      readonly spaceId?: SpaceId | undefined;
      readonly title?: string | undefined;
      readonly tags?: readonly string[] | undefined;
      readonly conflictPolicy?: ImportConflictPolicy | undefined;
    },
  ): Promise<{
    readonly document: DocumentRecord;
    readonly attachmentIds: readonly AttachmentId[];
    readonly batchId: AuditBatchId;
    readonly warnings: readonly string[];
  }> {
    const cleanFilename = options.filename.trim() || "document.docx";
    const payloadBase64 = Buffer.from(options.bytes).toString("base64");
    const result = await this.commitImportInternal(
      principal,
      {
        format: "docx",
        filename: cleanFilename,
        payloadBase64,
        ...(options.spaceId ? { targetSpaceId: options.spaceId } : {}),
        conflictPolicy: options.conflictPolicy ?? "rename",
        ...(options.tags && options.tags.length > 0 ? { defaultTags: [...options.tags] } : {}),
      },
      options.title?.trim() || undefined,
    );
    const targetDocId = result.createdDocumentIds[0] ?? result.updatedDocumentIds[0];
    if (!targetDocId) {
      throw new InkadeError("CONFLICT", "DOCX import was skipped due to conflict policy");
    }
    const document = await this.deps.documentService.getDocument(principal, targetDocId);
    return {
      document,
      attachmentIds: result.attachmentIds,
      batchId: result.batchId,
      warnings: result.warnings,
    };
  }

  private async commitImportInternal(
    principal: Principal,
    input: ImportCommitInput,
    titleOverride?: string,
  ): Promise<ImportCommitResult> {
    const bundle = this.parseBundle(input);
    const { space: rootSpace } = await this.resolveTargetSpace(
      principal,
      input.targetSpaceId,
      input.format,
    );
    const policy: ImportConflictPolicy = input.conflictPolicy ?? "rename";
    const batchId: AuditBatchId = createId(ID_PREFIXES.auditBatch);

    const existingDocs = [
      ...(await this.deps.documentRepo.listDocuments(principal.workspaceId, {
        includeTrashed: false,
        includeSystem: false,
        limit: null,
      })),
    ];
    const allSpaces = [
      ...(await getAllWorkspaceSpaces(
        this.deps.spacesCache ?? this.deps.spaceRepo,
        principal.workspaceId,
      )),
    ];

    const createdSpaceIds: SpaceId[] = [];
    const createdDocumentIds: DocumentId[] = [];
    const updatedDocumentIds: DocumentId[] = [];
    const attachmentIds: AttachmentId[] = [];
    const schemaUpdatedSpaceIds: SpaceId[] = [];
    let skippedCount = 0;
    let wikilinksReboundCount = 0;

    // 1. Resolve/create nested Spaces for folder paths
    const spaceByFolderPath = new Map<string, Space>([["", rootSpace]]);
    const ensureFolderSpace = async (segments: readonly string[]): Promise<Space> => {
      if (segments.length === 0) return rootSpace;
      let parent = rootSpace;
      const prefix: string[] = [];
      for (const rawSeg of segments) {
        const seg = rawSeg.trim() || "Imported";
        prefix.push(seg);
        const key = prefix.join("/");
        const cached = spaceByFolderPath.get(key);
        if (cached) {
          parent = cached;
          continue;
        }
        const existingChild = allSpaces.find(
          (s) =>
            s.archivedAt === null &&
            s.parentId === parent.id &&
            s.name.trim().toLowerCase() === seg.toLowerCase(),
        );
        if (existingChild) {
          spaceByFolderPath.set(key, existingChild);
          parent = existingChild;
          continue;
        }

        const created = await this.deps.spaceRepo.createSpace(principal.workspaceId, {
          parentId: parent.id,
          name: seg,
          slug: slugifyTitle(seg),
          defaultKind: "article",
        });
        allSpaces.push(created);
        this.deps.spacesCache?.invalidate(principal.workspaceId);
        spaceByFolderPath.set(key, created);
        createdSpaceIds.push(created.id);

        await this.deps.auditService.recordPrincipalEvent(principal, {
          transport: "rest",
          action: "import.space.create",
          resource: `space:${created.id}`,
          spaceId: created.id,
          decision: "allowed",
          summary: `Imported folder space "${created.name}" (${input.format})`,
          reversible: true,
          batchId,
          executionMode: "autonomous",
        });
        this.deps.sseHub.publish({
          type: "space.created",
          workspaceId: principal.workspaceId,
          spaceId: created.id,
          actorType: principal.actorType,
          payload: { space: created },
        });
        parent = created;
      }
      return parent;
    };

    // Pre-create folder spaces needed by docs or CSV database schemas
    for (const schemaPlan of bundle.schemas) {
      const segs = schemaPlan.folderPath.split("/").filter(Boolean);
      const targetSpace = await ensureFolderSpace(segs);
      const priorSchema = await this.deps.spaceRepo.getSpacePropertySchema(
        principal.workspaceId,
        { spaceId: targetSpace.id },
      );
      const priorFields = priorSchema?.fields ?? [];
      const mergedFields = [...priorFields];
      const existingKeys = new Set(priorFields.map((f) => f.key));
      for (const f of schemaPlan.fields) {
        if (!existingKeys.has(f.key)) {
          mergedFields.push(f);
          existingKeys.add(f.key);
        }
      }
      const savedSchema = await this.deps.spaceRepo.upsertSpacePropertySchema(
        principal.workspaceId,
        { spaceId: targetSpace.id, fields: mergedFields },
      );
      schemaUpdatedSpaceIds.push(targetSpace.id);
      await this.deps.auditService.recordPrincipalEvent(principal, {
        transport: "rest",
        action: "import.schema.update",
        resource: `space-schema:${targetSpace.id}`,
        spaceId: targetSpace.id,
        decision: "allowed",
        diffPreview: {
          oldSnippet: JSON.stringify(priorFields),
          newSnippet: JSON.stringify(savedSchema.fields),
        },
        summary: `Imported schema (${schemaPlan.fields.length} fields) into "${targetSpace.name}"`,
        reversible: true,
        batchId,
        executionMode: "autonomous",
      });
      this.deps.sseHub.publish({
        type: "space_schema.updated",
        workspaceId: principal.workspaceId,
        spaceId: targetSpace.id,
        actorType: principal.actorType,
        payload: { spaceId: targetSpace.id, schema: savedSchema },
      });
    }

    // 2. Upload imported attachments first so Obsidian ![[img]] / assets can bind cleanly
    const attachmentDownloadByKey = new Map<string, { url: string; filename: string }>();
    for (const att of bundle.attachments) {
      const uploaded = await this.deps.attachmentService.uploadAttachment(principal, {
        filename: att.filename,
        mimeType: att.mimeType,
        bytes: att.bytes,
      });
      attachmentIds.push(uploaded.attachment.id);
      const entry = { url: uploaded.downloadUrl, filename: uploaded.attachment.filename };
      attachmentDownloadByKey.set(att.sourcePath.toLowerCase(), entry);
      attachmentDownloadByKey.set(att.filename.toLowerCase(), entry);
    }

    // 3. Pass 1: Create / update documents and record title lookup maps
    const importedDocMap = new Map<
      DocumentId,
      { readonly doc: DocumentRecord; readonly candidate: ParsedImportDocCandidate }
    >();
    const titleByLookupKey = new Map<string, string>();
    for (const d of existingDocs) {
      titleByLookupKey.set(d.title.trim().toLowerCase(), d.title);
      titleByLookupKey.set(d.slug.trim().toLowerCase(), d.title);
    }

    const activeTitleSet = new Set(existingDocs.map((d) => d.title.trim().toLowerCase()));

    await this.deps.auditService.runSuppressed(async () => {
      for (const candidate of bundle.docs) {
        const effectiveCandidate =
          titleOverride && bundle.docs.length === 1
            ? { ...candidate, title: titleOverride }
            : candidate;
        const resolvedBody = rewriteDocxMediaReferences(
          effectiveCandidate.markdownBody,
          effectiveCandidate,
          attachmentDownloadByKey,
        );
        const targetSpace = await ensureFolderSpace(effectiveCandidate.folderSegments);
        const existing = this.findExistingMatch(
          effectiveCandidate,
          existingDocs,
          targetSpace.id,
        );

        if (existing && policy === "skip") {
          skippedCount += 1;
          titleByLookupKey.set(effectiveCandidate.title.toLowerCase(), existing.title);
          titleByLookupKey.set(effectiveCandidate.sourcePath.toLowerCase(), existing.title);
          continue;
        }

        if (existing && policy === "overwrite") {
          const preRev = await this.deps.revisionLinkRepo.getLatestRevision(existing.id);
          const mergedContent =
            Object.keys(effectiveCandidate.properties).length > 0
              ? serializeMarkdownWithFrontmatter({
                  bodyMarkdown: resolvedBody,
                  frontmatter: effectiveCandidate.properties,
                  existingMarkdown: existing.contentMarkdown,
                })
              : resolvedBody;
          const updated = await this.deps.documentService.updateDocument(principal, existing.id, {
            contentMarkdown: mergedContent,
            tags: [...new Set([...existing.tags, ...effectiveCandidate.tags])],
            properties: { ...(existing.properties ?? {}), ...effectiveCandidate.properties },
            ...(effectiveCandidate.sourceUrl ? { sourceUrl: effectiveCandidate.sourceUrl } : {}),
            changeSummary: `Imported overwrite (${input.format})`,
          });
          const postRev = await this.deps.revisionLinkRepo.getLatestRevision(updated.id);
          await this.deps.auditService.recordPrincipalEvent(principal, {
            transport: "rest",
            action: "import.document.update",
            resource: `document:${updated.id}`,
            spaceId: updated.spaceId,
            documentId: updated.id,
            decision: "allowed",
            beforeRevisionId: preRev?.id ?? null,
            afterRevisionId: postRev?.id ?? null,
            summary: `Imported overwrite "${updated.title}" (${input.format})`,
            reversible: Boolean(preRev),
            batchId,
            executionMode: "autonomous",
          });
          updatedDocumentIds.push(updated.id);
          importedDocMap.set(updated.id, { doc: updated, candidate: effectiveCandidate });
          const cleanStem = basename(effectiveCandidate.sourcePath, extname(effectiveCandidate.sourcePath));
          titleByLookupKey.set(cleanStem.toLowerCase(), updated.title);
          titleByLookupKey.set(effectiveCandidate.sourcePath.toLowerCase(), updated.title);
          titleByLookupKey.set(effectiveCandidate.title.toLowerCase(), updated.title);
          continue;
        }

        // Create new (with unique title if policy === "rename")
        let finalTitle = effectiveCandidate.title;
        if (existing && policy === "rename") {
          let counter = 2;
          while (activeTitleSet.has(`${effectiveCandidate.title} (${counter})`.toLowerCase())) {
            counter += 1;
          }
          finalTitle = `${effectiveCandidate.title} (${counter})`;
        }
        activeTitleSet.add(finalTitle.toLowerCase());

        const bodyWithFrontmatter =
          Object.keys(effectiveCandidate.properties).length > 0
            ? serializeMarkdownWithFrontmatter({
                bodyMarkdown: resolvedBody,
                frontmatter: effectiveCandidate.properties,
              })
            : resolvedBody;

        const created = await this.deps.documentRepo.createDocument(
          principal.workspaceId,
          {
            spaceId: targetSpace.id,
            kind: effectiveCandidate.kind,
            title: finalTitle,
            contentMarkdown: bodyWithFrontmatter,
            tags: [...effectiveCandidate.tags],
            properties:
              Object.keys(effectiveCandidate.properties).length > 0
                ? effectiveCandidate.properties
                : undefined,
            sourceUrl: effectiveCandidate.sourceUrl,
            sourceMeta: effectiveCandidate.sourceMeta,
          },
          {
            actorType: principal.actorType,
            actorId: principal.actorId,
            batchId,
            executionMode: "autonomous",
            changeSummary: `Imported (${input.format})`,
          },
        );
        const afterRev = await this.deps.revisionLinkRepo.getRevision(created.id, created.version);
        await this.deps.auditService.recordPrincipalEvent(principal, {
          transport: "rest",
          action: "import.document.create",
          resource: `document:${created.id}`,
          spaceId: created.spaceId,
          documentId: created.id,
          decision: "allowed",
          beforeRevisionId: null,
          afterRevisionId: afterRev?.id ?? null,
          summary: `Imported "${created.title}" (${input.format})`,
          reversible: true,
          batchId,
          executionMode: "autonomous",
        });

        this.deps.sseHub.publish({
          type: "document.created",
          workspaceId: principal.workspaceId,
          spaceId: created.spaceId,
          documentId: created.id,
          documentKind: created.kind,
          tags: created.tags,
          actorType: principal.actorType,
          payload: { document: created },
        });

        createdDocumentIds.push(created.id);
        importedDocMap.set(created.id, { doc: created, candidate: effectiveCandidate });
        existingDocs.push(created);

        const cleanStem = basename(effectiveCandidate.sourcePath, extname(effectiveCandidate.sourcePath));
        const noExtPath = effectiveCandidate.sourcePath.replace(/\.(md|markdown)$/i, "");
        titleByLookupKey.set(cleanStem.toLowerCase(), created.title);
        titleByLookupKey.set(noExtPath.toLowerCase(), created.title);
        titleByLookupKey.set(effectiveCandidate.sourcePath.toLowerCase(), created.title);
        titleByLookupKey.set(effectiveCandidate.title.toLowerCase(), created.title);
        for (const alias of effectiveCandidate.aliases) {
          titleByLookupKey.set(alias.toLowerCase(), created.title);
        }
      }

      // 4. Pass 2: Rebind Obsidian [[WikiLink]] AST & embeds, and Notion relative links
      for (const { doc, candidate } of importedDocMap.values()) {
        let nextMarkdown = doc.contentMarkdown;
        let docRebound = 0;

        if (input.format === "obsidian" && nextMarkdown.includes("[[")) {
          const rewritten = rewriteObsidianWikiLinks(nextMarkdown, (link) => {
            if (link.isEmbed) {
              const targetKey = link.target.toLowerCase();
              const baseKey = basename(link.target).toLowerCase();
              const att =
                attachmentDownloadByKey.get(targetKey) ?? attachmentDownloadByKey.get(baseKey);
              if (!att) return null;
              return `![${att.filename}](${att.url})`;
            }
            const rawTarget = link.target;
            const noExt = rawTarget.replace(/\.(md|markdown)$/i, "");
            const base = basename(noExt);
            const resolvedTitle =
              titleByLookupKey.get(rawTarget.toLowerCase()) ??
              titleByLookupKey.get(noExt.toLowerCase()) ??
              titleByLookupKey.get(base.toLowerCase());
            if (!resolvedTitle) return null;
            const anchorPart = link.anchor ? `#${link.anchor}` : "";
            const aliasPart = link.alias ? `|${link.alias}` : "";
            return `[[${resolvedTitle}${anchorPart}${aliasPart}]]`;
          });
          nextMarkdown = rewritten.markdown;
          docRebound += rewritten.rewrittenCount;
        }

        if (
          input.format === "notion" &&
          candidate.notionLinkTargets &&
          candidate.notionLinkTargets.length > 0
        ) {
          for (const target of candidate.notionLinkTargets) {
            const resolvedTitle =
              titleByLookupKey.get(target.strippedTitle.toLowerCase()) ?? target.strippedTitle;
            const escaped = target.rawHref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(`\\[([^\\]]*)\\]\\(${escaped}\\)`, "g");
            const replaced = nextMarkdown.replace(re, `[[${resolvedTitle}]]`);
            if (replaced !== nextMarkdown) {
              nextMarkdown = replaced;
              docRebound += 1;
            }
          }
        }

        if (nextMarkdown !== doc.contentMarkdown) {
          await this.deps.documentRepo.updateDocumentContentDirect(
            principal.workspaceId,
            doc.id,
            {
              contentMarkdown: nextMarkdown,
              contentText: markdownToPlainText(nextMarkdown),
              excerpt: extractExcerpt(nextMarkdown),
              version: doc.version,
              updatedAt: new Date().toISOString(),
            },
          );
          await this.deps.revisionLinkRepo.syncOutgoingLinks(
            principal.workspaceId,
            doc.id,
            null,
            nextMarkdown,
          );
          wikilinksReboundCount += docRebound;
        }

        this.deps.onDocumentChanged?.(principal.workspaceId, doc.id);
      }
    });

    this.deps.sseHub.publish({
      type: "import.committed",
      workspaceId: principal.workspaceId,
      spaceId: rootSpace.id,
      actorType: principal.actorType,
      payload: {
        batchId,
        createdCount: createdDocumentIds.length,
        updatedCount: updatedDocumentIds.length,
      },
    });

    return {
      batchId,
      format: input.format,
      createdDocumentIds,
      updatedDocumentIds,
      skippedCount,
      createdSpaceIds,
      attachmentIds,
      schemaUpdatedSpaceIds,
      wikilinksReboundCount,
      warnings: bundle.warnings,
    };
  }
}
