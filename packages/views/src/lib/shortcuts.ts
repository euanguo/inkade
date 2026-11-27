export function isImeEvent(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return Boolean(event.isComposing || event.keyCode === 229);
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!target || typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  return Boolean(
    target.closest('[contenteditable="true"], .ProseMirror, [role="textbox"]'),
  );
}

export function isInsideOutlineEditor(target: EventTarget | null): boolean {
  if (!target || typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest('[role="tree"]'));
}
