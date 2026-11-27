import {
  extractArticleFromDocumentAsync,
  extractSelectionHighlightAnchor,
  extractSelectionMarkdown,
  type ClipperFetchLike,
  type PageExtractionBundle,
} from "@inkade/clipper-core/extractor";
import "../core/adapters/registry.ts";
import { getWebExt } from "../shared/webext.ts";

declare global {
  interface Window {
    __inkadeExtractorAttached?: boolean;
    __inkadeLastContextTarget?: Element | null;
  }
}

export const CLIPPER_EXTRACTOR_MESSAGES = {
  extractBundle: "INKADE_EXTRACT_BUNDLE",
  extractSelection: "INKADE_EXTRACT_SELECTION",
  proxyFetch: "INKADE_PROXY_FETCH",
} as const;

function createBackgroundProxyFetch(): ClipperFetchLike {
  const ext = getWebExt();
  if (!ext?.runtime?.sendMessage) {
    return (input, init) => globalThis.fetch(input, init);
  }

  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    try {
      const result = await ext.runtime!.sendMessage!<{
        readonly ok: boolean;
        readonly status: number;
        readonly statusText: string;
        readonly contentType: string;
        readonly bodyText: string;
      }>({
        type: CLIPPER_EXTRACTOR_MESSAGES.proxyFetch,
        url,
        method: init?.method ?? "GET",
      });

      if (result && typeof result.status === "number") {
        return new Response(result.bodyText, {
          status: result.status,
          statusText: result.statusText,
          headers: result.contentType ? { "content-type": result.contentType } : {},
        });
      }
    } catch {
      // Fallback to direct page fetch
    }
    return globalThis.fetch(input, init);
  };
}

export async function captureCurrentPageBundleAsync(options?: {
  readonly usePointerTarget?: boolean | undefined;
}): Promise<PageExtractionBundle> {
  const proxyFetch = createBackgroundProxyFetch();
  const pointerTarget = options?.usePointerTarget
    ? window.__inkadeLastContextTarget ?? null
    : null;
  const article = await extractArticleFromDocumentAsync(document, window.location.href, {
    fetchFn: proxyFetch,
    useAsync: true,
    pointerTargetElement: pointerTarget,
  });
  const selection = extractSelectionHighlightAnchor(document, {
    pageUrl: article.url,
    title: article.title,
  });
  const selectionMarkdown = extractSelectionMarkdown(document, article.url);
  return {
    article,
    selection,
    ...(selectionMarkdown ? { selectionMarkdown } : {}),
  };
}

function registerExtractorListener(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__inkadeExtractorAttached) return;
  window.__inkadeExtractorAttached = true;

  const ext = getWebExt();
  ext?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    const msg = message as { readonly type?: string; readonly usePointerTarget?: boolean };

    if (msg.type === CLIPPER_EXTRACTOR_MESSAGES.extractBundle) {
      void captureCurrentPageBundleAsync({ usePointerTarget: msg.usePointerTarget })
        .then((bundle) => sendResponse(bundle))
        .catch(() => sendResponse(null));
      return true;
    }

    if (msg.type === CLIPPER_EXTRACTOR_MESSAGES.extractSelection) {
      const anchor = extractSelectionHighlightAnchor(document, {
        pageUrl: window.location.href,
        title: document.title,
      });
      const markdown = extractSelectionMarkdown(document, window.location.href);
      sendResponse({ anchor, markdown });
      return true;
    }

    return false;
  });
}

registerExtractorListener();
