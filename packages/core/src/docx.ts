import type {
  BlockContent,
  Code,
  List,
  ListItem,
  Nodes,
  PhrasingContent,
  Root,
  Table,
} from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";
import { InkadeError } from "./errors.ts";
import { parseInkadeViewBlock } from "./frontmatter.ts";
import { parseInkadePendingPayload, stripMarkdownSpeakerNotes } from "./markdown.ts";

const DOCX_MARKDOWN_PARSER = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: false });

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const EMU_PER_PX = 9525;
const MAX_IMAGE_WIDTH_EMU = 5_715_000; // 6 inches
const MAX_IMAGE_HEIGHT_EMU = 7_200_000;

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface DocxExportMediaAsset {
  readonly url: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly filename?: string | undefined;
}

export interface MarkdownToDocxOptions {
  readonly title?: string | undefined;
  readonly markdown: string;
  readonly creator?: string | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
  readonly media?: readonly DocxExportMediaAsset[] | undefined;
}

export interface DocxPackageOutput {
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly mediaCount: number;
  readonly hyperlinkCount: number;
}

export interface DocxExtractedImage {
  readonly archivePath: string;
  readonly placeholderUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface ParsedDocxDocument {
  readonly title: string;
  readonly markdown: string;
  readonly images: readonly DocxExtractedImage[];
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Minimal Pure-TS XML Tokenizer, DOM & Escaper
// ---------------------------------------------------------------------------

interface XmlTextNode {
  readonly type: "text";
  readonly value: string;
}

interface XmlElementNode {
  readonly type: "element";
  readonly name: string;
  readonly localName: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: XmlNode[];
}

type XmlNode = XmlElementNode | XmlTextNode;

function stripIllegalXmlChars(raw: string): string {
  // Strip XML 1.0 disallowed control bytes while preserving \t, \n, \r.
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code !== 0x7f)
    ) {
      out += raw[i]!;
    }
  }
  return out;
}

function escapeXmlText(raw: string): string {
  return stripIllegalXmlChars(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlAttr(raw: string): string {
  return escapeXmlText(raw)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXmlEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (full, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
          const code = Number.parseInt(entity.slice(2), 16);
          return Number.isFinite(code) && code > 0 && code <= 0x10ffff
            ? String.fromCodePoint(code)
            : full;
        }
        if (entity.startsWith("#")) {
          const code = Number.parseInt(entity.slice(1), 10);
          return Number.isFinite(code) && code > 0 && code <= 0x10ffff
            ? String.fromCodePoint(code)
            : full;
        }
        return full;
      }
    }
  });
}

function getLocalTagName(fullName: string): string {
  const colonIdx = fullName.indexOf(":");
  return colonIdx >= 0 ? fullName.slice(colonIdx + 1) : fullName;
}

function parseXmlAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let idx = 0;
  const len = rawAttrs.length;
  while (idx < len) {
    while (idx < len && /\s/.test(rawAttrs[idx]!)) idx += 1;
    if (idx >= len) break;
    const nameStart = idx;
    while (idx < len && !/[\s=/>]/.test(rawAttrs[idx]!)) idx += 1;
    const name = rawAttrs.slice(nameStart, idx);
    if (!name) {
      idx += 1;
      continue;
    }
    while (idx < len && /\s/.test(rawAttrs[idx]!)) idx += 1;
    if (rawAttrs[idx] !== "=") {
      attrs[name] = "";
      continue;
    }
    idx += 1;
    while (idx < len && /\s/.test(rawAttrs[idx]!)) idx += 1;
    const quote = rawAttrs[idx];
    if (quote === '"' || quote === "'") {
      idx += 1;
      const valStart = idx;
      while (idx < len && rawAttrs[idx] !== quote) idx += 1;
      attrs[name] = decodeXmlEntities(rawAttrs.slice(valStart, idx));
      if (rawAttrs[idx] === quote) idx += 1;
    } else {
      const valStart = idx;
      while (idx < len && !/[\s>]/.test(rawAttrs[idx]!)) idx += 1;
      attrs[name] = decodeXmlEntities(rawAttrs.slice(valStart, idx));
    }
  }
  return attrs;
}

function parseXml(xml: string): XmlElementNode | null {
  const clean = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  const stack: XmlElementNode[] = [];
  let root: XmlElementNode | null = null;
  let pos = 0;
  const len = clean.length;

  while (pos < len) {
    const lt = clean.indexOf("<", pos);
    if (lt === -1) {
      const tail = clean.slice(pos);
      const top = stack.at(-1);
      if (top && tail.length > 0) {
        top.children.push({ type: "text", value: decodeXmlEntities(tail) });
      }
      break;
    }

    if (lt > pos) {
      const textChunk = clean.slice(pos, lt);
      const top = stack.at(-1);
      if (top && textChunk.length > 0) {
        top.children.push({ type: "text", value: decodeXmlEntities(textChunk) });
      }
    }

    if (clean.startsWith("<!--", lt)) {
      const endComment = clean.indexOf("-->", lt + 4);
      pos = endComment === -1 ? len : endComment + 3;
      continue;
    }

    if (clean.startsWith("<![CDATA[", lt)) {
      const endCdata = clean.indexOf("]]>", lt + 9);
      const cdataVal = endCdata === -1 ? clean.slice(lt + 9) : clean.slice(lt + 9, endCdata);
      const top = stack.at(-1);
      if (top && cdataVal.length > 0) {
        top.children.push({ type: "text", value: cdataVal });
      }
      pos = endCdata === -1 ? len : endCdata + 3;
      continue;
    }

    if (clean.startsWith("<?", lt) || clean.startsWith("<!", lt)) {
      const gt = clean.indexOf(">", lt + 2);
      pos = gt === -1 ? len : gt + 1;
      continue;
    }

    // Find tag closing `>` outside attribute quotes
    let cursor = lt + 1;
    let activeQuote: '"' | "'" | null = null;
    while (cursor < len) {
      const ch = clean[cursor]!;
      if (activeQuote) {
        if (ch === activeQuote) activeQuote = null;
      } else if (ch === '"' || ch === "'") {
        activeQuote = ch;
      } else if (ch === ">") {
        break;
      }
      cursor += 1;
    }
    if (cursor >= len) break;

    const rawTag = clean.slice(lt + 1, cursor).trim();
    pos = cursor + 1;
    if (!rawTag) continue;

    if (rawTag.startsWith("/")) {
      const closeName = rawTag.slice(1).trim();
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i]!.name === closeName || stack[i]!.localName === getLocalTagName(closeName)) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const selfClosing = rawTag.endsWith("/");
    const tagBody = selfClosing ? rawTag.slice(0, -1).trimEnd() : rawTag;
    const spaceMatch = /\s/.exec(tagBody);
    const tagName = spaceMatch ? tagBody.slice(0, spaceMatch.index) : tagBody;
    const rawAttrPart = spaceMatch ? tagBody.slice(spaceMatch.index + 1) : "";
    const element: XmlElementNode = {
      type: "element",
      name: tagName,
      localName: getLocalTagName(tagName),
      attrs: rawAttrPart ? parseXmlAttributes(rawAttrPart) : {},
      children: [],
    };

    const parent = stack.at(-1);
    if (parent) {
      parent.children.push(element);
    } else if (!root) {
      root = element;
    }

    if (!selfClosing) {
      stack.push(element);
    }
  }

  return root;
}

function getElementChildren(el: XmlElementNode, localName?: string): XmlElementNode[] {
  const out: XmlElementNode[] = [];
  for (const child of el.children) {
    if (child.type !== "element") continue;
    if (!localName || child.localName === localName) {
      out.push(child);
    }
  }
  return out;
}

function findFirstChild(el: XmlElementNode, localName: string): XmlElementNode | null {
  for (const child of el.children) {
    if (child.type === "element" && child.localName === localName) {
      return child;
    }
  }
  return null;
}

function findFirstDescendant(el: XmlElementNode, localName: string): XmlElementNode | null {
  for (const child of el.children) {
    if (child.type !== "element") continue;
    if (child.localName === localName) return child;
    const nested = findFirstDescendant(child, localName);
    if (nested) return nested;
  }
  return null;
}

function getXmlAttr(el: XmlElementNode, localName: string): string | undefined {
  if (localName in el.attrs) return el.attrs[localName];
  const suffix = `:${localName}`;
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k.endsWith(suffix)) return v;
  }
  return undefined;
}

function getXmlElementText(el: XmlElementNode): string {
  let out = "";
  for (const child of el.children) {
    if (child.type === "text") {
      out += child.value;
    } else {
      out += getXmlElementText(child);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image Helpers (MIME + Dimensions)
// ---------------------------------------------------------------------------

function inferImageExtension(mimeType: string, filename?: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  switch (normalized) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpeg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default: {
      const extMatch = filename ? /\.([a-z0-9]+)$/i.exec(filename) : null;
      return extMatch?.[1]?.toLowerCase() ?? "png";
    }
  }
}

function guessImageMimeFromArchivePath(archivePath: string, bytes?: Uint8Array): string {
  if (bytes && bytes.byteLength >= 8) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return "image/png";
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return "image/gif";
    }
    if (
      bytes.byteLength >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return "image/webp";
    }
  }
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) >>> 0) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function getImageDimensionsPx(
  bytes: Uint8Array,
  mimeType: string,
): { readonly width: number; readonly height: number } {
  const lowerMime = mimeType.toLowerCase();
  // PNG IHDR
  if (
    (lowerMime === "image/png" || bytes[0] === 0x89) &&
    bytes.byteLength >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const w = readUint32BE(bytes, 16);
    const h = readUint32BE(bytes, 20);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  // GIF87a / GIF89a
  if (
    bytes.byteLength >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    const w = readUint16LE(bytes, 6);
    const h = readUint16LE(bytes, 8);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  // JPEG SOF0..SOF3
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.byteLength) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1] ?? 0;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xc3) {
        const h = readUint16BE(bytes, i + 5);
        const w = readUint16BE(bytes, i + 7);
        if (w > 0 && h > 0) return { width: w, height: h };
        break;
      }
      const segLen = readUint16BE(bytes, i + 2);
      if (segLen < 2) break;
      i += 2 + segLen;
    }
  }
  return { width: 480, height: 300 };
}

function pxToDocxEmu(widthPx: number, heightPx: number): { readonly cx: number; readonly cy: number } {
  let cx = Math.max(1, Math.round(widthPx)) * EMU_PER_PX;
  let cy = Math.max(1, Math.round(heightPx)) * EMU_PER_PX;
  if (cx > MAX_IMAGE_WIDTH_EMU) {
    const ratio = MAX_IMAGE_WIDTH_EMU / cx;
    cx = MAX_IMAGE_WIDTH_EMU;
    cy = Math.max(1, Math.round(cy * ratio));
  }
  if (cy > MAX_IMAGE_HEIGHT_EMU) {
    const ratio = MAX_IMAGE_HEIGHT_EMU / cy;
    cy = MAX_IMAGE_HEIGHT_EMU;
    cx = Math.max(1, Math.round(cx * ratio));
  }
  return { cx, cy };
}

// ---------------------------------------------------------------------------
// Markdown -> DOCX OOXML Export
// ---------------------------------------------------------------------------

interface InlineStyle {
  readonly bold?: boolean | undefined;
  readonly italic?: boolean | undefined;
  readonly strike?: boolean | undefined;
  readonly code?: boolean | undefined;
  readonly color?: string | undefined;
}

interface DocxRelEntry {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly targetMode?: "External" | undefined;
}

interface EmbeddedMediaEntry {
  readonly archivePath: string;
  readonly targetInWord: string;
  readonly ext: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

function isSafeDocxHyperlinkUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("#")) return false;
  return /^(https?:|mailto:|tel:)/i.test(trimmed);
}

function normalizeMediaLookupKey(url: string): string {
  const trimmed = url.trim();
  const attMatch = /\/api\/v1\/attachments\/([^/?#]+)\/download/i.exec(trimmed);
  if (attMatch?.[1]) {
    return `/api/v1/attachments/${attMatch[1]}/download`;
  }
  return trimmed;
}

function isRasterDocxMime(mimeType: string): boolean {
  const lower = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  return (
    lower === "image/png" ||
    lower === "image/jpeg" ||
    lower === "image/jpg" ||
    lower === "image/gif" ||
    lower === "image/webp"
  );
}

interface DocxBuildState {
  nextRelNum: number;
  nextDocPrId: number;
  readonly rels: DocxRelEntry[];
  readonly mediaEntries: EmbeddedMediaEntry[];
  readonly mediaByLookupKey: ReadonlyMap<string, DocxExportMediaAsset>;
  readonly embeddedByLookupKey: Map<string, { readonly rId: string; readonly asset: DocxExportMediaAsset }>;
  readonly usedExtensions: Set<string>;
  readonly codeLanguages: Map<string, string>;
  hyperlinkCount: number;
}

function createDocxBuildState(media: readonly DocxExportMediaAsset[] = []): DocxBuildState {
  const mediaByLookupKey = new Map<string, DocxExportMediaAsset>();
  for (const item of media) {
    mediaByLookupKey.set(item.url.trim(), item);
    mediaByLookupKey.set(normalizeMediaLookupKey(item.url), item);
  }
  return {
    nextRelNum: 3, // rId1 = styles.xml, rId2 = numbering.xml
    nextDocPrId: 1,
    rels: [
      {
        id: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
        target: "styles.xml",
      },
      {
        id: "rId2",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
        target: "numbering.xml",
      },
    ],
    mediaEntries: [],
    mediaByLookupKey,
    embeddedByLookupKey: new Map(),
    usedExtensions: new Set(),
    codeLanguages: new Map(),
    hyperlinkCount: 0,
  };
}

function registerCodeStyleId(state: DocxBuildState, rawLang: string | null | undefined): string {
  const lang = (rawLang ?? "").trim();
  if (!lang) return "Code";
  const safeSlug = lang.replace(/[^a-zA-Z0-9_-]/g, "_") || "plain";
  let candidate = `InkadeCode_${safeSlug}`;
  let suffix = 2;
  while (state.codeLanguages.has(candidate) && state.codeLanguages.get(candidate) !== lang) {
    candidate = `InkadeCode_${safeSlug}_${suffix}`;
    suffix += 1;
  }
  state.codeLanguages.set(candidate, lang);
  return candidate;
}

function registerHyperlinkRel(state: DocxBuildState, url: string): string {
  const rId = `rId${state.nextRelNum++}`;
  state.hyperlinkCount += 1;
  state.rels.push({
    id: rId,
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
    target: url,
    targetMode: "External",
  });
  return rId;
}

function registerMediaAsset(
  state: DocxBuildState,
  rawUrl: string,
): { readonly rId: string; readonly asset: DocxExportMediaAsset } | null {
  const key = normalizeMediaLookupKey(rawUrl);
  const existing = state.embeddedByLookupKey.get(key);
  if (existing) return existing;

  const asset = state.mediaByLookupKey.get(rawUrl.trim()) ?? state.mediaByLookupKey.get(key);
  if (!asset || asset.bytes.byteLength === 0 || !isRasterDocxMime(asset.mimeType)) {
    return null;
  }

  const ext = inferImageExtension(asset.mimeType, asset.filename);
  const mediaIndex = state.mediaEntries.length + 1;
  const targetInWord = `media/image${mediaIndex}.${ext}`;
  const archivePath = `word/${targetInWord}`;
  const rId = `rId${state.nextRelNum++}`;

  state.mediaEntries.push({
    archivePath,
    targetInWord,
    ext,
    mimeType: asset.mimeType,
    bytes: asset.bytes,
  });
  state.usedExtensions.add(ext);
  state.rels.push({
    id: rId,
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
    target: targetInWord,
  });

  const entry = { rId, asset };
  state.embeddedByLookupKey.set(key, entry);
  return entry;
}

function buildRunXml(text: string, style: InlineStyle): string {
  if (!text) return "";
  const rPrParts: string[] = [];
  if (style.bold) rPrParts.push("<w:b/>");
  if (style.italic) rPrParts.push("<w:i/>");
  if (style.strike) rPrParts.push("<w:strike/>");
  if (style.color) {
    rPrParts.push(`<w:color w:val="${escapeXmlAttr(style.color)}"/>`);
  }
  if (style.code) {
    rPrParts.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
    rPrParts.push('<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>');
  }
  const rPr = rPrParts.length > 0 ? `<w:rPr>${rPrParts.join("")}</w:rPr>` : "";

  const lines = text.split("\n");
  const inner = lines
    .map((line, idx) => {
      const tXml = line.length > 0 ? `<w:t xml:space="preserve">${escapeXmlText(line)}</w:t>` : "";
      return idx < lines.length - 1 ? `${tXml}<w:br/>` : tXml;
    })
    .join("");
  if (!inner) return "";
  return `<w:r>${rPr}${inner}</w:r>`;
}

function buildDrawingRunXml(
  state: DocxBuildState,
  rId: string,
  asset: DocxExportMediaAsset,
  altText: string,
): string {
  const docPrId = state.nextDocPrId++;
  const dims = getImageDimensionsPx(asset.bytes, asset.mimeType);
  const { cx, cy } = pxToDocxEmu(dims.width, dims.height);
  const name = escapeXmlAttr(asset.filename || `image-${docPrId}`);
  const descr = escapeXmlAttr(altText || asset.filename || "Image");
  return (
    `<w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="${name}" descr="${descr}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A_NS}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${A_NS}">` +
    `<a:graphicData uri="${PIC_NS}">` +
    `<pic:pic xmlns:pic="${PIC_NS}">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${name}" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${escapeXmlAttr(rId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing></w:r>`
  );
}

function renderInlineNodesXml(
  nodes: readonly PhrasingContent[],
  state: DocxBuildState,
  style: InlineStyle = {},
): string {
  const parts: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        parts.push(buildRunXml(node.value, style));
        break;
      case "strong":
        parts.push(renderInlineNodesXml(node.children, state, { ...style, bold: true }));
        break;
      case "emphasis":
        parts.push(renderInlineNodesXml(node.children, state, { ...style, italic: true }));
        break;
      case "delete":
        parts.push(renderInlineNodesXml(node.children, state, { ...style, strike: true }));
        break;
      case "inlineCode":
        parts.push(buildRunXml(node.value, { ...style, code: true }));
        break;
      case "break":
        parts.push("<w:r><w:br/></w:r>");
        break;
      case "link": {
        if (isSafeDocxHyperlinkUrl(node.url)) {
          const rId = registerHyperlinkRel(state, node.url.trim());
          const linkRuns = renderInlineNodesXml(node.children, state, {
            ...style,
            color: style.color ?? "2563EB",
          });
          const styledRuns = linkRuns.replaceAll("<w:rPr>", '<w:rPr><w:rStyle w:val="Hyperlink"/>');
          const ensuredStyled = styledRuns.includes("<w:rPr>")
            ? styledRuns
            : styledRuns.replaceAll("<w:r>", '<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>');
          parts.push(`<w:hyperlink r:id="${escapeXmlAttr(rId)}">${ensuredStyled}</w:hyperlink>`);
        } else {
          parts.push(renderInlineNodesXml(node.children, state, style));
        }
        break;
      }
      case "image": {
        const embedded = registerMediaAsset(state, node.url);
        if (embedded) {
          parts.push(buildDrawingRunXml(state, embedded.rId, embedded.asset, node.alt ?? ""));
        } else if (isSafeDocxHyperlinkUrl(node.url)) {
          const rId = registerHyperlinkRel(state, node.url.trim());
          const label = node.alt?.trim() ? `[Image: ${node.alt.trim()}]` : `[Image: ${node.url}]`;
          parts.push(
            `<w:hyperlink r:id="${escapeXmlAttr(rId)}">` +
              `<w:r><w:rPr><w:rStyle w:val="Hyperlink"/><w:i/></w:rPr>` +
              `<w:t xml:space="preserve">${escapeXmlText(label)}</w:t></w:r>` +
              `</w:hyperlink>`,
          );
        } else {
          const label = node.alt?.trim() ? `[Image: ${node.alt.trim()}]` : `[Image]`;
          parts.push(buildRunXml(label, { ...style, italic: true, color: "6B7280" }));
        }
        break;
      }
      case "html": {
        // Ignore raw HTML comments; emit visible fallback text if non-comment
        const val = node.value.trim();
        if (val && !val.startsWith("<!--")) {
          parts.push(buildRunXml(val, style));
        }
        break;
      }
      default: {
        const plain = mdastToString(node);
        if (plain) parts.push(buildRunXml(plain, style));
      }
    }
  }
  return parts.join("");
}

function buildParagraphXml(innerXml: string, pPrXml = ""): string {
  const pPr = pPrXml ? `<w:pPr>${pPrXml}</w:pPr>` : "";
  return `<w:p>${pPr}${innerXml}</w:p>`;
}

function renderSummaryBoxParagraphs(
  headingLabel: string,
  lines: readonly string[],
  state: DocxBuildState,
  fillHex = "F4F4F5",
  borderHex = "6366F1",
): string {
  const runs: string[] = [
    buildRunXml(headingLabel, { bold: true, color: "312E81" }),
  ];
  for (const line of lines) {
    if (!line.trim()) continue;
    runs.push("<w:r><w:br/></w:r>");
    runs.push(buildRunXml(line, { color: "3F3F46" }));
  }
  void state;
  return buildParagraphXml(
    runs.join(""),
    `<w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="${borderHex}"/></w:pBdr>` +
      `<w:shd w:val="clear" w:color="auto" w:fill="${fillHex}"/>` +
      `<w:ind w:left="240" w:right="160"/>` +
      `<w:spacing w:before="120" w:after="140"/>`,
  );
}

function renderCodeBlockXml(node: Code, state: DocxBuildState): string {
  const lang = (node.lang ?? "").trim().toLowerCase();

  if (lang === "inkade-pending") {
    const payload = parseInkadePendingPayload(node.value ?? "");
    const title = payload.label || payload.id || "Pending Section";
    const meta = [
      payload.id ? `id: ${payload.id}` : "",
      `status: ${payload.status}`,
      payload.bindingId ? `binding: ${payload.bindingId}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    return renderSummaryBoxParagraphs(
      `[Pending Section] ${title}`,
      meta ? [meta] : [],
      state,
      "FEF3C7",
      "D97706",
    );
  }

  if (lang === "inkade-view" || lang === "inkade_view") {
    const parsed = parseInkadeViewBlock(node.value ?? "");
    if (parsed.ok) {
      const spec = parsed.spec;
      const summaryLines = [
        `mode: ${spec.mode}`,
        spec.spaceId ? `spaceId: ${spec.spaceId}` : "",
        spec.kind ? `kind: ${spec.kind}` : "",
        spec.tag ? `tag: ${spec.tag}` : "",
        spec.columns && spec.columns.length > 0 ? `columns: ${spec.columns.join(", ")}` : "",
        spec.groupBy ? `groupBy: ${spec.groupBy}` : "",
      ].filter(Boolean);
      return renderSummaryBoxParagraphs("[Inkade Live View]", summaryLines, state, "EEF2FF", "4F46E5");
    }
    return renderSummaryBoxParagraphs(
      "[Inkade Live View]",
      [(node.value ?? "").trim()].filter(Boolean),
      state,
      "EEF2FF",
      "4F46E5",
    );
  }

  if (lang === "inkade-artifact") {
    let parsedObj: Record<string, unknown> | null = null;
    try {
      const raw: unknown = parseYaml(node.value ?? "");
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        parsedObj = raw as Record<string, unknown>;
      }
    } catch {
      parsedObj = null;
    }

    const title =
      parsedObj && typeof parsedObj.title === "string" && parsedObj.title.trim()
        ? parsedObj.title.trim()
        : "Interactive Artifact";
    const kind =
      parsedObj && typeof parsedObj.kind === "string" && parsedObj.kind.trim()
        ? parsedObj.kind.trim()
        : parsedObj && typeof parsedObj.type === "string" && parsedObj.type.trim()
          ? parsedObj.type.trim()
          : "";
    const fallbackMd =
      parsedObj && typeof parsedObj.fallbackMarkdown === "string" && parsedObj.fallbackMarkdown.trim()
        ? parsedObj.fallbackMarkdown.trim()
        : parsedObj && typeof parsedObj.summary === "string" && parsedObj.summary.trim()
          ? parsedObj.summary.trim()
          : "";

    const headerBox = renderSummaryBoxParagraphs(
      `[Interactive Artifact] ${title}`,
      [kind ? `type: ${kind}` : "", !fallbackMd ? (node.value ?? "").trim() : ""].filter(Boolean),
      state,
      "F0FDFA",
      "0D9488",
    );
    if (fallbackMd) {
      const fallbackTree = DOCX_MARKDOWN_PARSER.parse(fallbackMd);
      return `${headerBox}${renderBlocksXml(fallbackTree.children as readonly BlockContent[], state)}`;
    }
    return headerBox;
  }

  const codeText = (node.value ?? "").replace(/\r\n?/g, "\n");
  const lines = codeText.split("\n");
  const runs = lines
    .map((line, idx) => {
      const textXml =
        line.length > 0 ? `<w:t xml:space="preserve">${escapeXmlText(line)}</w:t>` : "";
      const brXml = idx < lines.length - 1 ? "<w:br/>" : "";
      return `<w:r>${textXml}${brXml}</w:r>`;
    })
    .join("");
  const codeStyleId = registerCodeStyleId(state, node.lang);
  return buildParagraphXml(runs, `<w:pStyle w:val="${escapeXmlAttr(codeStyleId)}"/>`);
}

function renderListXml(
  list: List,
  state: DocxBuildState,
  depth: number,
  blockquoteIndent: boolean,
): string {
  const numId = list.ordered ? "2" : "1";
  const clampedDepth = Math.min(8, Math.max(0, depth));
  const out: string[] = [];

  for (const item of list.children as readonly ListItem[]) {
    let usedTaskPrefix = false;
    for (const child of item.children) {
      if (child.type === "paragraph") {
        const prefixRun =
          !usedTaskPrefix && typeof item.checked === "boolean"
            ? buildRunXml(item.checked ? "☑ " : "☐ ", {})
            : "";
        usedTaskPrefix = true;
        const pPr =
          `<w:numPr><w:ilvl w:val="${clampedDepth}"/><w:numId w:val="${numId}"/></w:numPr>` +
          (blockquoteIndent
            ? '<w:pBdr><w:left w:val="single" w:sz="16" w:space="10" w:color="9CA3AF"/></w:pBdr>'
            : "");
        out.push(buildParagraphXml(`${prefixRun}${renderInlineNodesXml(child.children, state)}`, pPr));
      } else if (child.type === "list") {
        out.push(renderListXml(child, state, clampedDepth + 1, blockquoteIndent));
      } else {
        out.push(renderBlockNodeXml(child, state, blockquoteIndent));
      }
    }
  }

  return out.join("");
}

function renderTableXml(table: Table, state: DocxBuildState): string {
  const rows = table.children;
  if (rows.length === 0) return "";
  const colCount = Math.max(1, ...rows.map((r) => r.children.length));
  const totalWidthDxa = 9000;
  const colWidthDxa = Math.max(600, Math.floor(totalWidthDxa / colCount));

  const gridCols = Array.from({ length: colCount }, () => `<w:gridCol w:w="${colWidthDxa}"/>`).join("");
  const tblPr =
    `<w:tblPr>` +
    `<w:tblW w="${totalWidthDxa}" type="dxa"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="6" w:space="0" w:color="D4D4D8"/>` +
    `<w:left w:val="single" w:sz="6" w:space="0" w:color="D4D4D8"/>` +
    `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="D4D4D8"/>` +
    `<w:right w:val="single" w:sz="6" w:space="0" w:color="D4D4D8"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E4E4E7"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="E4E4E7"/>` +
    `</w:tblBorders>` +
    `<w:tblCellMar>` +
    `<w:top w:w="100" w:type="dxa"/>` +
    `<w:left w:w="140" w:type="dxa"/>` +
    `<w:bottom w:w="100" w:type="dxa"/>` +
    `<w:right w:w="140" w:type="dxa"/>` +
    `</w:tblCellMar>` +
    `</w:tblPr>`;

  const trXmlList: string[] = [];
  rows.forEach((row, rowIdx) => {
    const isHeader = rowIdx === 0;
    const trPr = isHeader ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
    const cellsXml: string[] = [];
    for (let colIdx = 0; colIdx < colCount; colIdx += 1) {
      const cell = row.children[colIdx];
      const align = table.align?.[colIdx];
      const jcXml =
        align === "center" || align === "right" || align === "left"
          ? `<w:jc w:val="${align}"/>`
          : "";
      const tcPr =
        `<w:tcPr>` +
        `<w:tcW w="${colWidthDxa}" type="dxa"/>` +
        (isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="F4F4F5"/>' : "") +
        `</w:tcPr>`;
      const contentXml = cell
        ? renderInlineNodesXml(cell.children, state, isHeader ? { bold: true } : {})
        : "";
      const pXml = buildParagraphXml(contentXml, `${jcXml}<w:spacing w:before="0" w:after="0"/>`);
      cellsXml.push(`<w:tc>${tcPr}${pXml}</w:tc>`);
    }
    trXmlList.push(`<w:tr>${trPr}${cellsXml.join("")}</w:tr>`);
  });

  return `<w:tbl>${tblPr}<w:tblGrid>${gridCols}</w:tblGrid>${trXmlList.join("")}</w:tbl>`;
}

function renderBlockNodeXml(
  node: BlockContent | Nodes,
  state: DocxBuildState,
  insideQuote = false,
): string {
  switch (node.type) {
    case "yaml":
      return "";
    case "heading": {
      const level = Math.min(6, Math.max(1, node.depth));
      const pPr = `<w:pStyle w:val="Heading${level}"/>`;
      return buildParagraphXml(renderInlineNodesXml(node.children, state), pPr);
    }
    case "paragraph": {
      const pPr = insideQuote ? '<w:pStyle w:val="Quote"/>' : "";
      return buildParagraphXml(renderInlineNodesXml(node.children, state), pPr);
    }
    case "blockquote": {
      return node.children
        .map((child) => renderBlockNodeXml(child, state, true))
        .join("");
    }
    case "list":
      return renderListXml(node, state, 0, insideQuote);
    case "code":
      return renderCodeBlockXml(node, state);
    case "table":
      return renderTableXml(node, state);
    case "thematicBreak":
      return buildParagraphXml(
        "",
        '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D4D4D8"/></w:pBdr><w:spacing w:before="140" w:after="140"/>',
      );
    case "html": {
      const raw = (node.value ?? "").trim();
      if (!raw || raw.startsWith("<!--")) return "";
      return buildParagraphXml(buildRunXml(raw, {}));
    }
    default: {
      const fallback = mdastToString(node).trim();
      if (!fallback) return "";
      return buildParagraphXml(buildRunXml(fallback, {}));
    }
  }
}

function renderBlocksXml(nodes: readonly BlockContent[], state: DocxBuildState): string {
  return nodes.map((node) => renderBlockNodeXml(node, state, false)).join("");
}

function buildContentTypesXml(state: DocxBuildState): string {
  const mimeByExt: Record<string, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  const mediaDefaults = [...state.usedExtensions]
    .sort()
    .map((ext) => {
      const mime = mimeByExt[ext] ?? "application/octet-stream";
      return `<Default Extension="${escapeXmlAttr(ext)}" ContentType="${escapeXmlAttr(mime)}"/>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="${CT_NS}">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    mediaDefaults +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `</Types>`
  );
}

function buildRootRelsXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `</Relationships>`
  );
}

function buildCorePropsXml(options: {
  readonly title: string;
  readonly creator: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="${CP_NS}" xmlns:dc="${DC_NS}" xmlns:dcterms="${DCTERMS_NS}" xmlns:xsi="${XSI_NS}">` +
    `<dc:title>${escapeXmlText(options.title)}</dc:title>` +
    `<dc:creator>${escapeXmlText(options.creator)}</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${escapeXmlText(options.createdAt)}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXmlText(options.updatedAt)}</dcterms:modified>` +
    `</cp:coreProperties>`
  );
}

function buildDocumentRelsXml(state: DocxBuildState): string {
  const items = state.rels
    .map((rel) => {
      const targetModeAttr = rel.targetMode ? ` TargetMode="${rel.targetMode}"` : "";
      return `<Relationship Id="${escapeXmlAttr(rel.id)}" Type="${escapeXmlAttr(rel.type)}" Target="${escapeXmlAttr(rel.target)}"${targetModeAttr}/>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${PKG_REL_NS}">${items}</Relationships>`
  );
}

function buildStylesXml(codeLanguages?: ReadonlyMap<string, string>): string {
  const headingSpec: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly sz: number;
    readonly before: number;
    readonly after: number;
    readonly outlineLvl: number;
  }> = [
    { id: "Heading1", name: "heading 1", sz: 36, before: 280, after: 120, outlineLvl: 0 },
    { id: "Heading2", name: "heading 2", sz: 30, before: 240, after: 100, outlineLvl: 1 },
    { id: "Heading3", name: "heading 3", sz: 25, before: 200, after: 80, outlineLvl: 2 },
    { id: "Heading4", name: "heading 4", sz: 22, before: 160, after: 60, outlineLvl: 3 },
    { id: "Heading5", name: "heading 5", sz: 21, before: 140, after: 60, outlineLvl: 4 },
    { id: "Heading6", name: "heading 6", sz: 20, before: 120, after: 60, outlineLvl: 5 },
  ];

  const headingStyles = headingSpec
    .map(
      (h) =>
        `<w:style w:type="paragraph" w:styleId="${h.id}">` +
        `<w:name w:val="${h.name}"/>` +
        `<w:basedOn w:val="Normal"/>` +
        `<w:next w:val="Normal"/>` +
        `<w:pPr><w:keepNext/><w:spacing w:before="${h.before}" w:after="${h.after}"/><w:outlineLvl w:val="${h.outlineLvl}"/></w:pPr>` +
        `<w:rPr><w:b/><w:sz w:val="${h.sz}"/><w:szCs w:val="${h.sz}"/><w:color w:val="111827"/></w:rPr>` +
        `</w:style>`,
    )
    .join("");

  const customCodeStyles = codeLanguages
    ? [...codeLanguages.entries()]
        .map(
          ([styleId, lang]) =>
            `<w:style w:type="paragraph" w:styleId="${escapeXmlAttr(styleId)}">` +
            `<w:name w:val="${escapeXmlAttr(`Code (${lang})`)}"/>` +
            `<w:basedOn w:val="Code"/>` +
            `<w:next w:val="Normal"/>` +
            `</w:style>`,
        )
        .join("")
    : "";

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="${W_NS}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC" w:cs="Calibri"/>` +
    `<w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="18181B"/>` +
    `</w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
    `</w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="80" w:after="200"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/><w:color w:val="111827"/></w:rPr></w:style>` +
    headingStyles +
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="12" w:color="6366F1"/></w:pBdr><w:ind w:left="360"/><w:spacing w:before="100" w:after="120"/></w:pPr>` +
    `<w:rPr><w:color w:val="4B5563"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr>` +
    `<w:pBdr>` +
    `<w:top w:val="single" w:sz="4" w:space="6" w:color="E4E4E7"/>` +
    `<w:left w:val="single" w:sz="4" w:space="8" w:color="E4E4E7"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="6" w:color="E4E4E7"/>` +
    `<w:right w:val="single" w:sz="4" w:space="8" w:color="E4E4E7"/>` +
    `</w:pBdr>` +
    `<w:shd w:val="clear" w:color="auto" w:fill="F4F4F5"/>` +
    `<w:ind w:left="140" w:right="140"/>` +
    `<w:spacing w:before="120" w:after="140" w:line="240" w:lineRule="auto"/>` +
    `</w:pPr>` +
    `<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:color w:val="18181B"/></w:rPr></w:style>` +
    customCodeStyles +
    `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2563EB"/><w:u w:val="single"/></w:rPr></w:style>` +
    `</w:styles>`
  );
}

function buildNumberingXml(): string {
  const bulletChars = ["•", "◦", "▪"];
  const bulletLvls = Array.from({ length: 9 }, (_, lvl) => {
    const ch = bulletChars[lvl % bulletChars.length] ?? "•";
    const indent = (lvl + 1) * 360;
    return (
      `<w:lvl w:ilvl="${lvl}">` +
      `<w:start w:val="1"/>` +
      `<w:numFmt w:val="bullet"/>` +
      `<w:lvlText w:val="${escapeXmlAttr(ch)}"/>` +
      `<w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${indent}" w:hanging="240"/></w:pPr>` +
      `</w:lvl>`
    );
  }).join("");

  const decimalLvls = Array.from({ length: 9 }, (_, lvl) => {
    const numFmt = lvl % 3 === 1 ? "lowerLetter" : lvl % 3 === 2 ? "lowerRoman" : "decimal";
    const indent = (lvl + 1) * 360;
    return (
      `<w:lvl w:ilvl="${lvl}">` +
      `<w:start w:val="1"/>` +
      `<w:numFmt w:val="${numFmt}"/>` +
      `<w:lvlText w:val="%${lvl + 1}."/>` +
      `<w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${indent}" w:hanging="240"/></w:pPr>` +
      `</w:lvl>`
    );
  }).join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:numbering xmlns:w="${W_NS}">` +
    `<w:abstractNum w:abstractNumId="1">${bulletLvls}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="2">${decimalLvls}</w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>` +
    `<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>` +
    `</w:numbering>`
  );
}

/**
 * Pure OOXML generator converting Inkade Markdown (with optional embedded media bytes)
 * into a standards-compliant `.docx` ZIP file map ready for `fflate.zipSync`.
 */
export function markdownToDocxFiles(options: MarkdownToDocxOptions): DocxPackageOutput {
  const cleanedMarkdown = stripMarkdownSpeakerNotes(options.markdown ?? "");
  const tree: Root = DOCX_MARKDOWN_PARSER.parse(cleanedMarkdown);
  const state = createDocxBuildState(options.media ?? []);

  const blocks = tree.children.filter((n) => n.type !== "yaml") as readonly BlockContent[];
  const trimmedTitle = options.title?.trim() ?? "";

  let titleXml = "";
  if (trimmedTitle) {
    const firstBlock = blocks[0];
    const alreadyStartsWithSameH1 =
      firstBlock?.type === "heading" &&
      firstBlock.depth === 1 &&
      mdastToString(firstBlock).trim().toLowerCase() === trimmedTitle.toLowerCase();
    if (!alreadyStartsWithSameH1) {
      titleXml = buildParagraphXml(
        buildRunXml(trimmedTitle, {}),
        '<w:pStyle w:val="Title"/>',
      );
    }
  }

  const bodyContentXml = `${titleXml}${renderBlocksXml(blocks, state)}`;
  const safeBodyXml = bodyContentXml || buildParagraphXml("");

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}" xmlns:xml="${XML_NS}">` +
    `<w:body>` +
    safeBodyXml +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
    `</w:body>` +
    `</w:document>`;

  const nowIso = new Date().toISOString();
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": textEncoder.encode(buildContentTypesXml(state)),
    "_rels/.rels": textEncoder.encode(buildRootRelsXml()),
    "docProps/core.xml": textEncoder.encode(
      buildCorePropsXml({
        title: trimmedTitle || "Inkade Document",
        creator: options.creator?.trim() || "Inkade",
        createdAt: options.createdAt ?? nowIso,
        updatedAt: options.updatedAt ?? nowIso,
      }),
    ),
    "word/styles.xml": textEncoder.encode(buildStylesXml(state.codeLanguages)),
    "word/numbering.xml": textEncoder.encode(buildNumberingXml()),
    "word/_rels/document.xml.rels": textEncoder.encode(buildDocumentRelsXml(state)),
    "word/document.xml": textEncoder.encode(documentXml),
  };

  for (const media of state.mediaEntries) {
    files[media.archivePath] = media.bytes;
  }

  return {
    files,
    mediaCount: state.mediaEntries.length,
    hyperlinkCount: state.hyperlinkCount,
  };
}

// ---------------------------------------------------------------------------
// DOCX OOXML -> Inkade Markdown Import
// ---------------------------------------------------------------------------

interface DocxRelTarget {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly targetMode?: string | undefined;
}

interface DocxStyleInfo {
  readonly headingLevel?: number | undefined;
  readonly isTitle?: boolean | undefined;
  readonly isCode?: boolean | undefined;
  readonly codeLang?: string | undefined;
  readonly isQuote?: boolean | undefined;
}

interface DocxRunFormatting {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strike: boolean;
  readonly code: boolean;
}

type InlineToken =
  | { readonly kind: "run"; readonly text: string; readonly fmt: DocxRunFormatting }
  | { readonly kind: "raw"; readonly markdown: string };

const MONOSPACE_FONT_PATTERN = /(consolas|courier|menlo|monaco|sf\s*mono|jetbrains\s*mono|fira\s*code|monospace)/i;

function normalizeArchiveMap(
  input: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const entries: ReadonlyArray<readonly [string, Uint8Array]> =
    input instanceof Map ? [...input.entries()] : Object.entries(input);
  for (const [rawKey, bytes] of entries) {
    const norm = rawKey.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!norm) continue;
    out.set(norm.toLowerCase(), bytes);
  }
  return out;
}

function resolveWordTargetPath(rawTarget: string): string | null {
  const cleaned = rawTarget.replace(/\\/g, "/").trim();
  if (!cleaned || cleaned.includes("\0")) return null;
  const parts = (cleaned.startsWith("/") ? cleaned.slice(1) : `word/${cleaned}`).split("/");
  const resolved: string[] = [];
  for (const seg of parts) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  return resolved.join("/");
}

function parseDocxRelsXml(xmlBytes: Uint8Array | undefined): Map<string, DocxRelTarget> {
  const map = new Map<string, DocxRelTarget>();
  if (!xmlBytes) return map;
  const root = parseXml(textDecoder.decode(xmlBytes));
  if (!root) return map;
  for (const rel of getElementChildren(root, "Relationship")) {
    const id = getXmlAttr(rel, "Id");
    const type = getXmlAttr(rel, "Type") ?? "";
    const target = getXmlAttr(rel, "Target") ?? "";
    const targetMode = getXmlAttr(rel, "TargetMode");
    if (!id || !target) continue;
    map.set(id, { id, type, target, targetMode });
  }
  return map;
}

function matchHeadingLevelFromLabel(rawLabel: string): number | undefined {
  const m = /^(?:heading|h)\s*([1-6])$/i.exec(rawLabel.trim()) ?? /^标题\s*([1-6])$/.exec(rawLabel.trim());
  if (!m?.[1]) return undefined;
  return Number.parseInt(m[1], 10);
}

function parseDocxStylesXml(xmlBytes: Uint8Array | undefined): Map<string, DocxStyleInfo> {
  const map = new Map<string, DocxStyleInfo>();
  if (!xmlBytes) return map;
  const root = parseXml(textDecoder.decode(xmlBytes));
  if (!root) return map;

  for (const styleEl of getElementChildren(root, "style")) {
    const styleId = getXmlAttr(styleEl, "styleId")?.trim();
    if (!styleId) continue;
    const nameEl = findFirstChild(styleEl, "name");
    const styleName = (nameEl ? getXmlAttr(nameEl, "val") : undefined)?.trim() ?? "";

    const pPr = findFirstChild(styleEl, "pPr");
    const outlineEl = pPr ? findFirstChild(pPr, "outlineLvl") : null;
    const outlineVal = outlineEl ? getXmlAttr(outlineEl, "val") : undefined;
    const parsedOutline =
      outlineVal !== undefined && /^[0-5]$/.test(outlineVal.trim())
        ? Number.parseInt(outlineVal.trim(), 10) + 1
        : undefined;

    const headingLevel =
      matchHeadingLevelFromLabel(styleId) ??
      matchHeadingLevelFromLabel(styleName) ??
      parsedOutline;

    const codeLang =
      /^code\s*\(([^)]+)\)$/i.exec(styleName)?.[1]?.trim() ??
      /^InkadeCode_(.+)$/i.exec(styleId)?.[1]?.trim() ??
      undefined;
    const isTitle = /^(?:title|标题)$/i.test(styleId) || /^(?:title|标题)$/i.test(styleName);
    const isCode =
      Boolean(codeLang) ||
      /^(?:code|sourcecode|codeblock|code\s*block|verbatim|macrotext|preformatted|代码块)$/i.test(styleId) ||
      /^(?:code|source\s*code|code\s*block|verbatim|preformatted|代码块)$/i.test(styleName);
    const isQuote =
      /^(?:quote|intense\s*quote|block\s*text|blockquote|引用)$/i.test(styleId) ||
      /^(?:quote|intense\s*quote|block\s*text|blockquote|引用)$/i.test(styleName);

    map.set(styleId.toLowerCase(), { headingLevel, isTitle, isCode, codeLang, isQuote });
  }

  return map;
}

function parseDocxNumberingXml(xmlBytes: Uint8Array | undefined): {
  readonly isOrdered: (numId: string, ilvl: string) => boolean;
} {
  const abstractFormats = new Map<string, Map<string, string>>();
  const numToAbstract = new Map<string, string>();
  const numOverrides = new Map<string, Map<string, string>>();

  if (xmlBytes) {
    const root = parseXml(textDecoder.decode(xmlBytes));
    if (root) {
      for (const abs of getElementChildren(root, "abstractNum")) {
        const absId = getXmlAttr(abs, "abstractNumId");
        if (!absId) continue;
        const lvls = new Map<string, string>();
        for (const lvl of getElementChildren(abs, "lvl")) {
          const ilvl = getXmlAttr(lvl, "ilvl") ?? "0";
          const numFmtEl = findFirstChild(lvl, "numFmt");
          const numFmt = numFmtEl ? getXmlAttr(numFmtEl, "val") : undefined;
          if (numFmt) lvls.set(ilvl, numFmt);
        }
        abstractFormats.set(absId, lvls);
      }

      for (const num of getElementChildren(root, "num")) {
        const numId = getXmlAttr(num, "numId");
        if (!numId) continue;
        const absRef = findFirstChild(num, "abstractNumId");
        const absId = absRef ? getXmlAttr(absRef, "val") : undefined;
        if (absId) numToAbstract.set(numId, absId);

        for (const ov of getElementChildren(num, "lvlOverride")) {
          const ilvl = getXmlAttr(ov, "ilvl") ?? "0";
          const lvl = findFirstChild(ov, "lvl");
          const numFmtEl = lvl ? findFirstChild(lvl, "numFmt") : null;
          const numFmt = numFmtEl ? getXmlAttr(numFmtEl, "val") : undefined;
          if (numFmt) {
            const byLvl = numOverrides.get(numId) ?? new Map<string, string>();
            byLvl.set(ilvl, numFmt);
            numOverrides.set(numId, byLvl);
          }
        }
      }
    }
  }

  return {
    isOrdered: (numId: string, ilvl: string) => {
      const overrideFmt = numOverrides.get(numId)?.get(ilvl);
      const absId = numToAbstract.get(numId);
      const absFmt = absId ? abstractFormats.get(absId)?.get(ilvl) : undefined;
      const fmt = (overrideFmt ?? absFmt ?? "bullet").toLowerCase();
      return fmt !== "bullet" && fmt !== "none";
    },
  };
}

function parseCoreTitleXml(xmlBytes: Uint8Array | undefined): string {
  if (!xmlBytes) return "";
  const root = parseXml(textDecoder.decode(xmlBytes));
  if (!root) return "";
  const titleEl = findFirstDescendant(root, "title");
  return titleEl ? getXmlElementText(titleEl).trim() : "";
}

function isBooleanPropOn(el: XmlElementNode | null): boolean {
  if (!el) return false;
  const val = getXmlAttr(el, "val")?.trim().toLowerCase();
  return val !== "0" && val !== "false" && val !== "off";
}

function formatRunTextToken(text: string, fmt: DocxRunFormatting): string {
  if (!text) return "";
  if (fmt.code) {
    const maxTicks = Math.max(
      0,
      ...(text.match(/`+/g) ?? []).map((s) => s.length),
    );
    const ticks = "`".repeat(maxTicks + 1);
    const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
    return `${ticks}${pad}${text}${pad}${ticks}`;
  }

  let prefix = "";
  let core = text;
  let suffix = "";
  if (fmt.bold || fmt.italic || fmt.strike) {
    const leadMatch = /^(\s+)/.exec(core);
    if (leadMatch?.[1]) {
      prefix = leadMatch[1];
      core = core.slice(prefix.length);
    }
    const trailMatch = /(\s+)$/.exec(core);
    if (trailMatch?.[1]) {
      suffix = trailMatch[1];
      core = core.slice(0, core.length - suffix.length);
    }
  }
  if (!core) return text;
  if (fmt.strike) core = `~~${core}~~`;
  if (fmt.italic) core = `*${core}*`;
  if (fmt.bold) core = `**${core}**`;
  return `${prefix}${core}${suffix}`;
}

function mergeAndRenderInlineTokens(tokens: readonly InlineToken[]): string {
  const merged: InlineToken[] = [];
  for (const tok of tokens) {
    if (tok.kind === "raw") {
      merged.push(tok);
      continue;
    }
    const prev = merged.at(-1);
    if (
      prev &&
      prev.kind === "run" &&
      prev.fmt.bold === tok.fmt.bold &&
      prev.fmt.italic === tok.fmt.italic &&
      prev.fmt.strike === tok.fmt.strike &&
      prev.fmt.code === tok.fmt.code
    ) {
      merged[merged.length - 1] = {
        kind: "run",
        text: `${prev.text}${tok.text}`,
        fmt: prev.fmt,
      };
    } else {
      merged.push(tok);
    }
  }

  return merged
    .map((tok) => (tok.kind === "raw" ? tok.markdown : formatRunTextToken(tok.text, tok.fmt)))
    .join("");
}

/**
 * Parses an extracted OOXML `.docx` file map into clean Inkade Markdown, extracted embedded images,
 * and document title metadata.
 */
export function parseDocxPackageFiles(
  inputFiles: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
  options?: { readonly filename?: string | undefined },
): ParsedDocxDocument {
  const files = normalizeArchiveMap(inputFiles);
  const documentXmlBytes = files.get("word/document.xml");
  if (!documentXmlBytes) {
    throw new InkadeError("VALIDATION_ERROR", "Invalid DOCX archive: missing word/document.xml");
  }

  const root = parseXml(textDecoder.decode(documentXmlBytes));
  if (!root) {
    throw new InkadeError("VALIDATION_ERROR", "Malformed XML in word/document.xml");
  }

  const bodyEl = findFirstChild(root, "body");
  if (!bodyEl) {
    throw new InkadeError("VALIDATION_ERROR", "Invalid DOCX archive: missing w:body element");
  }

  const relsMap = parseDocxRelsXml(files.get("word/_rels/document.xml.rels"));
  const stylesMap = parseDocxStylesXml(files.get("word/styles.xml"));
  const numbering = parseDocxNumberingXml(files.get("word/numbering.xml"));
  const coreTitle = parseCoreTitleXml(files.get("docProps/core.xml"));

  const warnings: string[] = [];
  const extractedImagesByPath = new Map<string, DocxExtractedImage>();

  const registerImageFromRel = (rId: string | undefined, altText: string): string | null => {
    if (!rId) return null;
    const rel = relsMap.get(rId);
    if (!rel) return null;
    if (rel.targetMode?.toLowerCase() === "external") {
      return `![${altText.replace(/[\[\]]/g, "")}](${rel.target})`;
    }
    const resolvedPath = resolveWordTargetPath(rel.target);
    if (!resolvedPath) return null;
    const bytes = files.get(resolvedPath.toLowerCase());
    if (!bytes) {
      warnings.push(`Embedded image "${resolvedPath}" not found in DOCX archive`);
      return null;
    }
    const lowerPath = resolvedPath.toLowerCase();
    let img = extractedImagesByPath.get(lowerPath);
    if (!img) {
      const slashIdx = resolvedPath.lastIndexOf("/");
      const filename = slashIdx >= 0 ? resolvedPath.slice(slashIdx + 1) : resolvedPath;
      img = {
        archivePath: resolvedPath,
        placeholderUrl: `docx-media://${resolvedPath}`,
        filename,
        mimeType: guessImageMimeFromArchivePath(resolvedPath, bytes),
        bytes,
      };
      extractedImagesByPath.set(lowerPath, img);
    }
    const safeAlt = (altText || img.filename).replace(/[\[\]]/g, "");
    return `![${safeAlt}](${img.placeholderUrl})`;
  };

  const collectRunTokens = (
    container: XmlElementNode,
    optionsRun: { readonly preserveRawText: boolean },
    out: InlineToken[],
  ): void => {
    for (const child of container.children) {
      if (child.type !== "element") continue;

      if (child.localName === "r") {
        const rPr = findFirstChild(child, "rPr");
        const rStyleEl = rPr ? findFirstChild(rPr, "rStyle") : null;
        const rStyle = rStyleEl ? getXmlAttr(rStyleEl, "val") : undefined;
        const rFonts = rPr ? findFirstChild(rPr, "rFonts") : null;
        const fontName = rFonts
          ? (getXmlAttr(rFonts, "ascii") ?? getXmlAttr(rFonts, "hAnsi") ?? getXmlAttr(rFonts, "cs") ?? "")
          : "";
        const hasCodeStyle = Boolean(rStyle && /^(?:code|verbatim)/i.test(rStyle));
        const hasMonospaceShading =
          Boolean(fontName && MONOSPACE_FONT_PATTERN.test(fontName)) &&
          Boolean(rPr && findFirstChild(rPr, "shd"));

        const fmt: DocxRunFormatting = optionsRun.preserveRawText
          ? { bold: false, italic: false, strike: false, code: false }
          : {
              bold: Boolean(rPr && isBooleanPropOn(findFirstChild(rPr, "b"))),
              italic: Boolean(rPr && isBooleanPropOn(findFirstChild(rPr, "i"))),
              strike: Boolean(
                rPr &&
                  (isBooleanPropOn(findFirstChild(rPr, "strike")) ||
                    isBooleanPropOn(findFirstChild(rPr, "dstrike"))),
              ),
              code: hasCodeStyle || hasMonospaceShading,
            };

        for (const rChild of child.children) {
          if (rChild.type !== "element") continue;
          if (rChild.localName === "t") {
            const text = getXmlElementText(rChild);
            if (text) {
              out.push({ kind: "run", text, fmt });
            }
          } else if (rChild.localName === "tab") {
            out.push({ kind: "run", text: optionsRun.preserveRawText ? "\t" : " ", fmt });
          } else if (rChild.localName === "br" || rChild.localName === "cr") {
            out.push({ kind: "run", text: "\n", fmt: { bold: false, italic: false, strike: false, code: false } });
          } else if (rChild.localName === "drawing" || rChild.localName === "pict") {
            const blip = findFirstDescendant(rChild, "blip");
            const vImage = findFirstDescendant(rChild, "imagedata");
            const docPr = findFirstDescendant(rChild, "docPr");
            const altText =
              (docPr ? getXmlAttr(docPr, "descr") ?? getXmlAttr(docPr, "title") ?? getXmlAttr(docPr, "name") : undefined) ??
              "";
            const rId =
              (blip ? getXmlAttr(blip, "embed") ?? getXmlAttr(blip, "link") : undefined) ??
              (vImage ? getXmlAttr(vImage, "id") : undefined);
            const imgMd = registerImageFromRel(rId, altText);
            if (imgMd) {
              out.push({ kind: "raw", markdown: imgMd });
            }
          }
        }
        continue;
      }

      if (child.localName === "hyperlink") {
        const innerTokens: InlineToken[] = [];
        collectRunTokens(child, optionsRun, innerTokens);
        const linkText = mergeAndRenderInlineTokens(innerTokens).trim();
        const rId = getXmlAttr(child, "id");
        const anchor = getXmlAttr(child, "anchor");
        const rel = rId ? relsMap.get(rId) : undefined;
        if (rel?.target && linkText) {
          out.push({ kind: "raw", markdown: `[${linkText}](${rel.target})` });
        } else if (anchor && linkText) {
          out.push({ kind: "raw", markdown: `[${linkText}](#${anchor})` });
        } else if (linkText) {
          out.push({ kind: "raw", markdown: linkText });
        }
        continue;
      }

      if (child.localName === "ins" || child.localName === "smartTag" || child.localName === "fldSimple") {
        collectRunTokens(child, optionsRun, out);
      }
    }
  };

  const renderParagraphInline = (pEl: XmlElementNode, preserveRawText = false): string => {
    const tokens: InlineToken[] = [];
    collectRunTokens(pEl, { preserveRawText }, tokens);
    return preserveRawText
      ? tokens.map((t) => (t.kind === "raw" ? t.markdown : t.text)).join("")
      : mergeAndRenderInlineTokens(tokens);
  };

  const mdBlocks: string[] = [];
  let codeLinesBuffer: string[] = [];
  let codeLangBuffer: string | undefined;
  let titleFromParagraph = "";
  let firstH1Text = "";

  const flushCodeBuffer = (): void => {
    if (codeLinesBuffer.length === 0) return;
    const joined = codeLinesBuffer.join("\n").replace(/\n+$/, "");
    const lang = codeLangBuffer?.trim() ?? "";
    codeLinesBuffer = [];
    codeLangBuffer = undefined;
    let maxRun = 2;
    for (const m of joined.match(/`+/g) ?? []) {
      if (m.length > maxRun) maxRun = m.length;
    }
    const fence = "`".repeat(Math.max(3, maxRun + 1));
    mdBlocks.push(`${fence}${lang}\n${joined}\n${fence}`);
  };

  for (const child of bodyEl.children) {
    if (child.type !== "element") continue;

    if (child.localName === "p") {
      const pPr = findFirstChild(child, "pPr");
      const pStyleEl = pPr ? findFirstChild(pPr, "pStyle") : null;
      const pStyleId = pStyleEl ? getXmlAttr(pStyleEl, "val")?.trim() ?? "" : "";
      const styleInfo = pStyleId ? stylesMap.get(pStyleId.toLowerCase()) : undefined;
      const fallbackCodeLang = /^InkadeCode_(.+)$/i.exec(pStyleId)?.[1]?.trim() || undefined;
      const isCodeStyleFallback =
        Boolean(fallbackCodeLang) ||
        /^(?:code|sourcecode|codeblock|code\s*block|verbatim|macrotext|preformatted|代码块)$/i.test(pStyleId);
      const isQuoteStyleFallback =
        /^(?:quote|intense\s*quote|block\s*text|blockquote|引用)$/i.test(pStyleId);

      if (styleInfo?.isCode || isCodeStyleFallback) {
        const nextLang = styleInfo?.codeLang ?? fallbackCodeLang;
        if (codeLinesBuffer.length > 0 && (codeLangBuffer ?? "") !== (nextLang ?? "")) {
          flushCodeBuffer();
        }
        if (codeLinesBuffer.length === 0) {
          codeLangBuffer = nextLang;
        }
        codeLinesBuffer.push(renderParagraphInline(child, true));
        continue;
      }
      flushCodeBuffer();

      const outlineEl = pPr ? findFirstChild(pPr, "outlineLvl") : null;
      const outlineVal = outlineEl ? getXmlAttr(outlineEl, "val")?.trim() : undefined;
      const directOutlineLevel =
        outlineVal !== undefined && /^[0-5]$/.test(outlineVal)
          ? Number.parseInt(outlineVal, 10) + 1
          : undefined;
      const headingLevel =
        styleInfo?.headingLevel ?? matchHeadingLevelFromLabel(pStyleId) ?? directOutlineLevel;

      const numPr = pPr ? findFirstChild(pPr, "numPr") : null;
      const numIdEl = numPr ? findFirstChild(numPr, "numId") : null;
      const ilvlEl = numPr ? findFirstChild(numPr, "ilvl") : null;
      const numId = numIdEl ? getXmlAttr(numIdEl, "val")?.trim() : undefined;
      const ilvl = ilvlEl ? getXmlAttr(ilvlEl, "val")?.trim() ?? "0" : "0";

      const pBdr = pPr ? findFirstChild(pPr, "pBdr") : null;
      const hasLeftBorder = Boolean(pBdr && findFirstChild(pBdr, "left"));
      const hasBottomBorder = Boolean(pBdr && findFirstChild(pBdr, "bottom"));

      const inlineMd = renderParagraphInline(child, false).trim();

      if (!inlineMd && hasBottomBorder && !headingLevel && !numId) {
        mdBlocks.push("---");
        continue;
      }
      if (!inlineMd) {
        continue;
      }

      if (styleInfo?.isTitle || /^(?:title|标题)$/i.test(pStyleId)) {
        const plainTitle = inlineMd.replace(/[*_`~]/g, "").trim();
        if (!titleFromParagraph && plainTitle) {
          titleFromParagraph = plainTitle;
        }
        mdBlocks.push(`# ${inlineMd}`);
        continue;
      }

      if (headingLevel && headingLevel >= 1 && headingLevel <= 6) {
        if (headingLevel === 1 && !firstH1Text) {
          firstH1Text = inlineMd.replace(/[*_`~]/g, "").trim();
        }
        mdBlocks.push(`${"#".repeat(headingLevel)} ${inlineMd}`);
        continue;
      }

      if (numId && numId !== "0") {
        const depth = Math.min(8, Math.max(0, Number.parseInt(ilvl, 10) || 0));
        const indent = "  ".repeat(depth);
        const normalizedTaskLine = inlineMd.replace(/^\*{1,2}(☑|☐|✅)\*{1,2}\s+/, "$1 ");
        if (/^(?:\[x\]|☑|✅)\s+/i.test(normalizedTaskLine)) {
          const rest = normalizedTaskLine.replace(/^(?:\[x\]|☑|✅)\s+/i, "");
          mdBlocks.push(`${indent}- [x] ${rest}`);
        } else if (/^(?:\[\s*\]|☐)\s+/i.test(normalizedTaskLine)) {
          const rest = normalizedTaskLine.replace(/^(?:\[\s*\]|☐)\s+/i, "");
          mdBlocks.push(`${indent}- [ ] ${rest}`);
        } else {
          const marker = numbering.isOrdered(numId, ilvl) ? "1." : "-";
          mdBlocks.push(`${indent}${marker} ${inlineMd}`);
        }
        continue;
      }

      if (styleInfo?.isQuote || isQuoteStyleFallback || hasLeftBorder) {
        const quoteLines = inlineMd.split("\n").map((line) => `> ${line}`);
        mdBlocks.push(quoteLines.join("\n"));
        continue;
      }

      mdBlocks.push(inlineMd.replace(/\n/g, "  \n"));
      continue;
    }

    if (child.localName === "tbl") {
      flushCodeBuffer();
      const rawRows: string[][] = [];
      for (const tr of getElementChildren(child, "tr")) {
        const rowCells: string[] = [];
        for (const tc of getElementChildren(tr, "tc")) {
          const cellParts: string[] = [];
          for (const tcPara of getElementChildren(tc, "p")) {
            const pText = renderParagraphInline(tcPara, false).trim();
            if (pText) cellParts.push(pText);
          }
          const cellText = cellParts
            .join(" ")
            .replace(/\s*\n+\s*/g, " ")
            .replace(/\|/g, "\\|")
            .trim();
          rowCells.push(cellText);
        }
        if (rowCells.length > 0) {
          rawRows.push(rowCells);
        }
      }
      if (rawRows.length > 0) {
        const colCount = Math.max(1, ...rawRows.map((r) => r.length));
        const headerCells = rawRows[0]!.map((cell) => {
          const wholeBold = /^\*\*([^*]+)\*\*$/.exec(cell);
          return wholeBold?.[1] ? wholeBold[1].trim() : cell;
        });
        const padRow = (r: string[]): string => {
          const cells = Array.from({ length: colCount }, (_, idx) => r[idx] ?? "");
          return `| ${cells.join(" | ")} |`;
        };
        const headerLine = padRow(headerCells);
        const sepLine = `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`;
        const bodyLines = rawRows.slice(1).map(padRow);
        mdBlocks.push([headerLine, sepLine, ...bodyLines].join("\n"));
      }
    }
  }

  flushCodeBuffer();

  // Merge consecutive list lines cleanly without blank lines between consecutive list items
  const joinedBlocks: string[] = [];
  for (let i = 0; i < mdBlocks.length; i += 1) {
    const current = mdBlocks[i]!;
    const prev = joinedBlocks.at(-1);
    const isListLine = (s: string): boolean => /^\s*(?:[-*+]|\d+\.)\s+/.test(s) && !s.includes("\n");
    const isQuoteLine = (s: string): boolean => s.startsWith("> ") && !s.includes("\n");
    if (prev && ((isListLine(prev) && isListLine(current)) || (isQuoteLine(prev) && isQuoteLine(current)))) {
      joinedBlocks[joinedBlocks.length - 1] = `${prev}\n${current}`;
    } else {
      joinedBlocks.push(current);
    }
  }

  const filenameStem = options?.filename
    ? options.filename
        .replace(/^.*[\\/]/, "")
        .replace(/\.docx$/i, "")
        .trim()
    : "";

  const resolvedTitle =
    titleFromParagraph || coreTitle || firstH1Text || filenameStem || "Imported Document";

  return {
    title: resolvedTitle,
    markdown: joinedBlocks.join("\n\n"),
    images: [...extractedImagesByPath.values()],
    warnings,
  };
}
