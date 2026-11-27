function copyNodesFlatteningShadowRoots(
  sourceParent: Node,
  targetParent: Node,
  targetDoc: Document,
): void {
  const shadowRoot = (sourceParent as Element).shadowRoot;
  if (shadowRoot) {
    for (const shadowChild of Array.from(shadowRoot.childNodes)) {
      const cloned = cloneNodeWithShadow(shadowChild, targetDoc);
      if (cloned) targetParent.appendChild(cloned);
    }
    return;
  }

  for (const child of Array.from(sourceParent.childNodes)) {
    const cloned = cloneNodeWithShadow(child, targetDoc);
    if (cloned) targetParent.appendChild(cloned);
  }
}

function cloneNodeWithShadow(node: Node, targetDoc: Document): Node | null {
  if (node.nodeType === 1) {
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    // Never inject our own clipper Shadow DOM container into extracted output
    if (el.id === "inkade-clipper-root") {
      return null;
    }

    const clonedEl = targetDoc.createElement(tag);
    for (const attr of Array.from(el.attributes)) {
      try {
        clonedEl.setAttribute(attr.name, attr.value);
      } catch {
        // ignore invalid attribute names in synthetic DOMs
      }
    }

    if (el.shadowRoot) {
      copyNodesFlatteningShadowRoots(el, clonedEl, targetDoc);
    } else {
      for (const child of Array.from(el.childNodes)) {
        const clonedChild = cloneNodeWithShadow(child, targetDoc);
        if (clonedChild) clonedEl.appendChild(clonedChild);
      }
    }
    return clonedEl;
  }

  if (node.nodeType === 3) {
    return targetDoc.createTextNode(node.textContent ?? "");
  }

  return null;
}

/**
 * Produces a clean cloned Document with open Shadow DOM trees flattened into light DOM
 * without mutating the live host page.
 */
export function cloneDocumentWithFlattenedShadowDom(doc: Document): Document {
  if (!doc.documentElement) return doc;

  let clonedDoc: Document;
  if (doc.implementation?.createHTMLDocument) {
    clonedDoc = doc.implementation.createHTMLDocument(doc.title || "");
  } else {
    clonedDoc = doc.cloneNode(true) as Document;
  }

  try {
    const targetRoot = clonedDoc.documentElement;
    if (!targetRoot) return clonedDoc;
    while (targetRoot.firstChild) {
      targetRoot.removeChild(targetRoot.firstChild);
    }
    for (const attr of Array.from(doc.documentElement.attributes)) {
      try {
        targetRoot.setAttribute(attr.name, attr.value);
      } catch {
        // ignore
      }
    }
    for (const child of Array.from(doc.documentElement.childNodes)) {
      const cloned = cloneNodeWithShadow(child, clonedDoc);
      if (cloned) targetRoot.appendChild(cloned);
    }
    return clonedDoc;
  } catch {
    return doc.cloneNode(true) as Document;
  }
}
