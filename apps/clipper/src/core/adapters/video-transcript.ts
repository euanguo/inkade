import { resolveAbsoluteHttpUrl } from "@inkade/clipper-core/extractor";
import type { SiteAdapter } from "./types.ts";
import { hostMatches, readMetaContent } from "./types.ts";

export interface TranscriptSegment {
  readonly startSeconds: number;
  readonly text: string;
}

export function formatTimestampLabel(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function buildTimestampLink(pageUrl: string, seconds: number): string {
  try {
    const parsed = new URL(pageUrl);
    parsed.searchParams.set("t", String(Math.max(0, Math.floor(seconds))));
    return parsed.toString();
  } catch {
    return pageUrl;
  }
}

export function formatTranscriptMarkdown(
  segments: readonly TranscriptSegment[],
  pageUrl: string,
): string {
  return segments
    .filter((s) => s.text.trim().length > 0)
    .map((s) => {
      const label = formatTimestampLabel(s.startSeconds);
      const href = buildTimestampLink(pageUrl, s.startSeconds);
      return `- [${label}](${href}) ${s.text.trim()}`;
    })
    .join("\n");
}

function extractInlineJsonObject(doc: Document, marker: string): Record<string, unknown> | null {
  for (const script of doc.querySelectorAll("script")) {
    const text = script.textContent ?? "";
    const idx = text.indexOf(marker);
    if (idx === -1) continue;
    const eqIdx = text.indexOf("=", idx);
    if (eqIdx === -1) continue;
    const startBrace = text.indexOf("{", eqIdx);
    if (startBrace === -1) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startBrace; i < text.length; i++) {
      const ch = text[i]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(startBrace, i + 1)) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function parseYoutubeJson3Events(payload: unknown): TranscriptSegment[] {
  if (!payload || typeof payload !== "object") return [];
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  const segments: TranscriptSegment[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const rec = ev as { tStartMs?: number; segs?: Array<{ utf8?: string }> };
    if (typeof rec.tStartMs !== "number" || !Array.isArray(rec.segs)) continue;
    const text = rec.segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      segments.push({ startSeconds: rec.tStartMs / 1000, text });
    }
  }
  return segments;
}

function parseBilibiliSubtitleBody(payload: unknown): TranscriptSegment[] {
  if (!payload || typeof payload !== "object") return [];
  const body = (payload as { body?: unknown }).body;
  if (!Array.isArray(body)) return [];
  const segments: TranscriptSegment[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const row = item as { from?: number; content?: string };
    if (typeof row.from === "number" && typeof row.content === "string" && row.content.trim()) {
      segments.push({ startSeconds: row.from, text: row.content.trim() });
    }
  }
  return segments;
}

export const videoTranscriptAdapter: SiteAdapter = {
  id: "video-transcript",
  name: "Video & Transcript (YouTube / Bilibili)",
  hosts: ["youtube.com", "youtu.be", "bilibili.com"],
  match(url) {
    if (hostMatches(url.hostname, ["youtube.com", "youtu.be"])) {
      return url.pathname === "/watch" || url.hostname === "youtu.be" || url.pathname.startsWith("/shorts/");
    }
    if (hostMatches(url.hostname, ["bilibili.com"])) {
      return url.pathname.includes("/video/");
    }
    return false;
  },
  async extract(doc, pageUrl, ctx) {
    const parsedUrl = new URL(pageUrl);
    const isBilibili = hostMatches(parsedUrl.hostname, ["bilibili.com"]);

    let title = "";
    let author = "";
    let description = "";
    let coverUrl: string | null = null;
    let segments: TranscriptSegment[] = [];

    // Optional inline pre-loaded transcript script tag for deterministic extraction / testing
    const inlineTranscriptEl = doc.querySelector('script[type="application/json"][data-inkade-transcript]');
    if (inlineTranscriptEl?.textContent) {
      try {
        const raw = JSON.parse(inlineTranscriptEl.textContent) as unknown;
        if (Array.isArray(raw)) {
          segments = (raw as unknown[]).filter(
            (s): s is TranscriptSegment =>
              typeof s === "object" &&
              s !== null &&
              "startSeconds" in s &&
              typeof s.startSeconds === "number" &&
              "text" in s &&
              typeof s.text === "string",
          );
        }
      } catch {
        // ignore invalid inline transcript
      }
    }

    if (isBilibili) {
      title =
        doc.querySelector("h1.video-title, h1")?.textContent?.trim() ||
        readMetaContent(doc, ['meta[property="og:title"]', 'meta[name="title"]']);
      author =
        doc.querySelector(".up-name, a.username")?.textContent?.trim() ||
        readMetaContent(doc, ['meta[name="author"]']);
      description =
        doc.querySelector(".basic-desc-info, .desc-info-text")?.textContent?.trim() ||
        readMetaContent(doc, ['meta[name="description"]', 'meta[property="og:description"]']);
      coverUrl = resolveAbsoluteHttpUrl(
        readMetaContent(doc, ['meta[property="og:image"]']),
        pageUrl,
      );

      if (segments.length === 0 && ctx.fetchFn) {
        const initialState = extractInlineJsonObject(doc, "__INITIAL_STATE__");
        const videoData = (initialState?.videoData ?? {}) as {
          bvid?: string;
          cid?: number;
          subtitle?: { list?: Array<{ subtitle_url?: string }> };
        };
        const subUrl = videoData.subtitle?.list?.[0]?.subtitle_url;
        const resolvedSubUrl = subUrl
          ? subUrl.startsWith("//")
            ? `https:${subUrl}`
            : subUrl
          : null;
        if (resolvedSubUrl) {
          try {
            const res = await ctx.fetchFn(resolvedSubUrl);
            if (res.ok) {
              segments = parseBilibiliSubtitleBody(await res.json());
            }
          } catch {
            // keep without transcript
          }
        }
      }
    } else {
      const playerResponse = extractInlineJsonObject(doc, "ytInitialPlayerResponse");
      const videoDetails = (playerResponse?.videoDetails ?? {}) as {
        title?: string;
        author?: string;
        shortDescription?: string;
      };
      title =
        videoDetails.title?.trim() ||
        doc.querySelector("h1.ytd-watch-metadata, h1")?.textContent?.trim() ||
        readMetaContent(doc, ['meta[property="og:title"]', 'meta[name="title"]']);
      author =
        videoDetails.author?.trim() ||
        doc.querySelector("#channel-name a, ytd-channel-name a")?.textContent?.trim() ||
        "";
      description =
        videoDetails.shortDescription?.trim() ||
        readMetaContent(doc, ['meta[name="description"]', 'meta[property="og:description"]']);
      coverUrl = resolveAbsoluteHttpUrl(
        readMetaContent(doc, ['meta[property="og:image"]']),
        pageUrl,
      );

      if (segments.length === 0 && ctx.fetchFn) {
        const captions = (playerResponse?.captions as {
          playerCaptionsTracklistRenderer?: {
            captionTracks?: Array<{ baseUrl?: string; languageCode?: string }>;
          };
        })?.playerCaptionsTracklistRenderer?.captionTracks;
        const track =
          captions?.find((c) => c.languageCode?.startsWith("zh")) ??
          captions?.find((c) => c.languageCode?.startsWith("en")) ??
          captions?.[0];
        if (track?.baseUrl) {
          try {
            const urlObj = new URL(track.baseUrl);
            urlObj.searchParams.set("fmt", "json3");
            const res = await ctx.fetchFn(urlObj.toString());
            if (res.ok) {
              segments = parseYoutubeJson3Events(await res.json());
            }
          } catch {
            // ignore subtitle fetch error
          }
        }
      }
    }

    if (!title && !description && segments.length === 0) return null;

    const transcriptMd = formatTranscriptMarkdown(segments, pageUrl);
    const sections: string[] = [];
    if (author) {
      sections.push(`> ${isBilibili ? "UP主" : "Channel"}: ${author}`);
    }
    if (coverUrl) {
      sections.push(`![Thumbnail](${coverUrl})`);
    }
    if (description) {
      sections.push(`## Description\n\n${description}`);
    }
    if (transcriptMd) {
      sections.push(`## Transcript\n\n${transcriptMd}`);
    }

    const markdown = sections.join("\n\n").trim();
    if (!markdown) return null;

    return {
      id: "video-transcript",
      title: title || pageUrl,
      author,
      site: isBilibili ? "Bilibili" : "YouTube",
      description,
      image: coverUrl ?? undefined,
      markdown,
      imageUrls: coverUrl ? [coverUrl] : [],
      variables: {
        adapter: "video-transcript",
        platform: isBilibili ? "bilibili" : "youtube",
        transcript: transcriptMd,
      },
    };
  },
};
