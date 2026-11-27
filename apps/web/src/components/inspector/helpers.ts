import { getApiBaseUrl } from "../../lib/api.ts";

export type ShareExpiryPreset = "never" | "24h" | "7d" | "30d";

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function computeExpiryIso(preset: ShareExpiryPreset): string | null {
  if (preset === "never") return null;
  const hours = preset === "24h" ? 24 : preset === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function insertWikilinkOnce(text: string, targetTitle: string): string | null {
  const escaped = escapeRegExp(targetTitle);
  const protectedOrTarget = new RegExp(
    "(```[\\s\\S]*?```|`[^`\\n]*`|\\[\\[[^[\\]]*\\]\\]|\\[[^\\]\\n]*\\]\\([^)\\n]*\\))|(" +
      escaped +
      ")",
    "gi",
  );
  let replaced = false;
  const next = text.replace(protectedOrTarget, (full, protectedSpan, matchedTarget) => {
    if (protectedSpan || replaced || !matchedTarget) return full;
    replaced = true;
    return matchedTarget === targetTitle
      ? `[[${targetTitle}]]`
      : `[[${targetTitle}|${matchedTarget}]]`;
  });
  return replaced ? next : null;
}

export function buildPublicUrl(token: string): string {
  const base = getApiBaseUrl();
  const path = `/share/${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

export function buildAttachmentDownloadUrl(attachmentId: string): string {
  const base = getApiBaseUrl();
  const path = `/api/v1/attachments/${encodeURIComponent(attachmentId)}/download`;
  return base ? `${base}${path}` : path;
}
