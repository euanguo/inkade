import type { AttachmentId, DocumentId } from "@inkade/core";
import { isInkadeApiError, type FetchLike, type InkadeClient } from "@inkade/sdk";

export const MAX_MIRRORED_IMAGES = 30;
export const MAX_SINGLE_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_MIRROR_BYTES = 60 * 1024 * 1024;
export const IMAGE_MIRROR_CONCURRENCY = 4;

export interface MirrorImagesInput {
  readonly documentId: DocumentId;
  readonly expectedVersion?: number | undefined;
  readonly originalMarkdown: string;
  readonly imageUrls: readonly string[];
  readonly baseSourceMeta?: Record<string, unknown> | undefined;
  readonly snapshotAttachmentId?: AttachmentId | undefined;
  readonly compressWebp?: boolean | undefined;
  readonly fetchFn?: FetchLike | typeof fetch | undefined;
}

export interface MirrorImagesResult {
  readonly mirroredImages: number;
  readonly failedImages: number;
  readonly totalBytes: number;
  readonly conflictSkipped: boolean;
  readonly updatedMarkdown: string;
}

export function inferClipImageFilename(imageUrl: string, mimeType: string, idx: number): string {
  try {
    const pathname = new URL(imageUrl).pathname;
    const last = pathname.split("/").filter(Boolean).pop();
    if (last && /\.[a-zA-Z0-9]{2,5}$/.test(last)) {
      if (mimeType === "image/webp" && !last.toLowerCase().endsWith(".webp")) {
        return `${last.replace(/\.[^.]+$/, "")}.webp`.slice(0, 120);
      }
      return last.slice(0, 120);
    }
  } catch {
    // ignore malformed URL
  }
  const ext = mimeType.includes("webp")
    ? "webp"
    : mimeType.includes("png")
      ? "png"
      : mimeType.includes("gif")
        ? "gif"
        : mimeType.includes("svg")
          ? "svg"
          : "jpg";
  return `clip-image-${idx + 1}.${ext}`;
}

async function tryCompressToWebp(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
  if (
    mimeType === "image/webp" ||
    mimeType === "image/svg+xml" ||
    mimeType === "image/gif" ||
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas !== "function"
  ) {
    return { bytes, mimeType };
  }

  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { bytes, mimeType };
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const webpBlob = await canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
    if (webpBlob.size > 0 && webpBlob.size < bytes.byteLength) {
      return {
        bytes: new Uint8Array(await webpBlob.arrayBuffer()),
        mimeType: "image/webp",
      };
    }
  } catch {
    // Graceful fallback to original image bytes
  }
  return { bytes, mimeType };
}

/**
 * Concurrently downloads up to 30 external images, uploads them as document attachments,
 * and patches Markdown links using optimistic locking (`expectedVersion`) so concurrent user edits
 * are never overwritten on 409 conflict.
 */
export async function mirrorImagesAndPatchDocument(
  client: InkadeClient,
  input: MirrorImagesInput,
): Promise<MirrorImagesResult> {
  const uniqueUrls = [...new Set(input.imageUrls)].slice(0, MAX_MIRRORED_IMAGES);
  const fetchImpl =
    input.fetchFn ?? ((u: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(u, init));

  if (uniqueUrls.length === 0) {
    return {
      mirroredImages: 0,
      failedImages: 0,
      totalBytes: 0,
      conflictSkipped: false,
      updatedMarkdown: input.originalMarkdown,
    };
  }

  const replacements = new Map<string, string>();
  let totalBytes = 0;
  let failedImages = 0;
  let nextIdx = 0;
  let uploadCounter = 0;

  const worker = async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= uniqueUrls.length) return;
      const imgUrl = uniqueUrls[idx]!;
      try {
        const res = await fetchImpl(imgUrl, { method: "GET" });
        if (!res.ok) {
          failedImages++;
          continue;
        }
        const rawMime =
          res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
        if (!rawMime.startsWith("image/")) {
          failedImages++;
          continue;
        }
        const rawBytes = new Uint8Array(await res.arrayBuffer());
        if (rawBytes.byteLength === 0 || rawBytes.byteLength > MAX_SINGLE_IMAGE_BYTES) {
          failedImages++;
          continue;
        }

        const processed = input.compressWebp
          ? await tryCompressToWebp(rawBytes, rawMime)
          : { bytes: rawBytes, mimeType: rawMime };

        if (totalBytes + processed.bytes.byteLength > MAX_TOTAL_MIRROR_BYTES) {
          failedImages++;
          continue;
        }

        const seq = uploadCounter++;
        const uploaded = await client.attachments.upload({
          documentId: input.documentId,
          filename: inferClipImageFilename(imgUrl, processed.mimeType, seq),
          mimeType: processed.mimeType,
          data: processed.bytes,
        });
        totalBytes += processed.bytes.byteLength;
        replacements.set(imgUrl, uploaded.downloadUrl);
      } catch {
        failedImages++;
      }
    }
  };

  const workerCount = Math.min(IMAGE_MIRROR_CONCURRENCY, uniqueUrls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  let updatedMarkdown = input.originalMarkdown;
  for (const [originalUrl, localUrl] of replacements.entries()) {
    updatedMarkdown = updatedMarkdown.split(originalUrl).join(localUrl);
  }

  const mirroredImages = replacements.size;
  if (mirroredImages === 0 && !input.snapshotAttachmentId) {
    return {
      mirroredImages: 0,
      failedImages,
      totalBytes,
      conflictSkipped: false,
      updatedMarkdown,
    };
  }

  const hasMarkdownChanges = updatedMarkdown !== input.originalMarkdown;
  try {
    await client.documents.update(input.documentId, {
      ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
      ...(hasMarkdownChanges
        ? { contentMarkdown: updatedMarkdown, changeSummary: "Mirrored clip images" }
        : {}),
      sourceMeta: {
        ...(input.baseSourceMeta ?? {}),
        ...(input.snapshotAttachmentId ? { snapshotAttachmentId: input.snapshotAttachmentId } : {}),
        mirroredImages,
      },
    });
    return {
      mirroredImages,
      failedImages,
      totalBytes,
      conflictSkipped: false,
      updatedMarkdown,
    };
  } catch (error) {
    if (isInkadeApiError(error) && (error.status === 409 || error.code === "VERSION_CONFLICT")) {
      return {
        mirroredImages,
        failedImages,
        totalBytes,
        conflictSkipped: true,
        updatedMarkdown: input.originalMarkdown,
      };
    }
    throw error;
  }
}
