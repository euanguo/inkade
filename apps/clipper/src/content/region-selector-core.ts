const SKIP_REGION_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "META",
  "LINK",
  "BR",
  "HR",
  "HTML",
]);

const INLINE_DECORATIVE_TAGS = new Set([
  "SPAN",
  "EM",
  "STRONG",
  "B",
  "I",
  "U",
  "SMALL",
  "SUB",
  "SUP",
  "SVG",
  "PATH",
  "CIRCLE",
  "RECT",
  "LINE",
  "A",
  "CODE",
  "MARK",
]);

function isExcludedElement(el: Element | null): boolean {
  if (!el) return true;
  if (el.id === "inkade-clipper-root" || el.closest?.("#inkade-clipper-root")) {
    return true;
  }
  return SKIP_REGION_TAGS.has(el.tagName.toUpperCase());
}

function hasMeaningfulContent(el: Element): boolean {
  if ((el.textContent ?? "").trim().length > 0) return true;
  if (el.querySelector("img, video, pre, table, canvas")) return true;
  return false;
}

/**
 * Resolves a sensible selectable block element under the user's pointer.
 */
export function findInitialSelectableElement(target: Element | null): Element | null {
  if (!target || isExcludedElement(target)) return null;
  let current: Element | null = target;

  // Step out of tiny inline text decorations to their parent block when appropriate
  while (
    current &&
    current.parentElement &&
    current.parentElement.tagName.toUpperCase() !== "BODY" &&
    INLINE_DECORATIVE_TAGS.has(current.tagName.toUpperCase())
  ) {
    if (current.tagName.toUpperCase() === "CODE" && current.parentElement.tagName.toUpperCase() === "PRE") {
      current = current.parentElement;
      break;
    }
    current = current.parentElement;
  }

  if (!current || isExcludedElement(current) || current.tagName.toUpperCase() === "BODY") {
    return null;
  }
  return current;
}

/**
 * ArrowLeft: expands region selection up to its parent container while tracking child history.
 */
export function expandRegionToParent(
  current: Element,
  historyStack: readonly Element[],
): { readonly next: Element; readonly stack: Element[] } {
  const parent = current.parentElement;
  if (
    !parent ||
    isExcludedElement(parent) ||
    parent.tagName.toUpperCase() === "BODY" ||
    parent.tagName.toUpperCase() === "HTML"
  ) {
    return { next: current, stack: [...historyStack] };
  }
  return {
    next: parent,
    stack: [...historyStack, current],
  };
}

/**
 * ArrowRight: shrinks region selection back down the history stack or into the first meaningful child.
 */
export function shrinkRegionToChild(
  current: Element,
  historyStack: readonly Element[],
): { readonly next: Element; readonly stack: Element[] } {
  if (historyStack.length > 0) {
    const nextStack = [...historyStack];
    const popped = nextStack.pop();
    if (popped && current.contains(popped) && !isExcludedElement(popped)) {
      return { next: popped, stack: nextStack };
    }
  }

  const children = Array.from(current.children).filter(
    (child) => !isExcludedElement(child) && hasMeaningfulContent(child),
  );
  if (children.length > 0) {
    return { next: children[0]!, stack: [] };
  }

  return { next: current, stack: [] };
}

/**
 * ArrowUp / ArrowDown: moves region selection to previous or next meaningful sibling element.
 */
export function moveRegionToSibling(
  current: Element,
  direction: -1 | 1,
): Element | null {
  let cursor: Element | null =
    direction === -1 ? current.previousElementSibling : current.nextElementSibling;
  while (cursor) {
    if (!isExcludedElement(cursor) && hasMeaningfulContent(cursor)) {
      return cursor;
    }
    cursor = direction === -1 ? cursor.previousElementSibling : cursor.nextElementSibling;
  }
  return null;
}
