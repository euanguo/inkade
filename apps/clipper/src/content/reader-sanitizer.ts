import createDOMPurify, { type DOMPurify, type WindowLike } from "dompurify";

const FORBIDDEN_READER_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "meta",
  "link",
  "base",
  "noscript",
  "svg",
  "math",
];

const FORBIDDEN_READER_ATTRS = ["style", "srcdoc"];

const URL_ATTR_NAMES = new Set(["href", "src", "xlink:href", "action"]);

const purifyByWindow = new WeakMap<object, DOMPurify>();

function isSafeUrlAttrValue(attrName: string, rawVal: string): boolean {
  const val = rawVal.trim().toLowerCase();
  if (!val) return true;
  if (val.startsWith("#") || val.startsWith("/")) return true;
  if (val.startsWith("http://") || val.startsWith("https://")) return true;
  if (
    attrName === "src" &&
    /^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(val)
  ) {
    return true;
  }
  return false;
}

function getReaderPurifier(win: WindowLike): DOMPurify | null {
  const cached = purifyByWindow.get(win);
  if (cached) return cached;

  const purify = createDOMPurify(win);
  if (!purify.isSupported) {
    return null;
  }

  purify.addHook("uponSanitizeAttribute", (_node, data) => {
    const attrName = data.attrName.toLowerCase();
    if (URL_ATTR_NAMES.has(attrName) && !isSafeUrlAttrValue(attrName, data.attrValue)) {
      data.keepAttr = false;
    }
  });

  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName.toUpperCase() === "A") {
      node.setAttribute("rel", "noopener noreferrer");
      node.setAttribute("target", "_blank");
    }
  });

  purifyByWindow.set(win, purify);
  return purify;
}

/**
 * Sanitizes extracted HTML via DOMPurify before rendering inside the Shadow DOM Reader View,
 * stripping scripts, SVG/MathML, inline event handlers, styles, and unsafe URI schemes.
 */
export function sanitizeReaderHtml(rawHtml: string, doc?: Document): string {
  if (!rawHtml.trim()) return "";
  const targetWin =
    (doc?.defaultView as WindowLike | null | undefined) ??
    (typeof window !== "undefined" ? window : undefined);
  if (!targetWin) return "";

  const purify = getReaderPurifier(targetWin);
  if (!purify) return "";

  return purify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_READER_TAGS,
    FORBID_ATTR: FORBIDDEN_READER_ATTRS,
  });
}
