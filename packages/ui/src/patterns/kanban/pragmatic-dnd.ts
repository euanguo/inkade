import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter";
import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";

export interface PragmaticDraggableOptions {
  readonly element: HTMLElement;
  readonly getInitialData: () => Record<string, unknown>;
  readonly canDrag?: (() => boolean) | undefined;
  readonly onDragStart?: (() => void) | undefined;
  readonly onDrop?: (() => void) | undefined;
}

export function bindPragmaticDraggable({
  element,
  getInitialData,
  canDrag,
  onDragStart,
  onDrop,
}: PragmaticDraggableOptions): () => void {
  return draggable({
    element,
    getInitialData,
    ...(canDrag ? { canDrag } : {}),
    onGenerateDragPreview: ({ nativeSetDragImage }) => {
      setCustomNativeDragPreview({
        nativeSetDragImage,
        getOffset: pointerOutsideOfPreview({ x: "14px", y: "10px" }),
        render({ container }) {
          const rect = element.getBoundingClientRect();
          const widthPx = Math.min(Math.max(Math.round(rect.width || 260), 200), 300);
          const clone = element.cloneNode(true) as HTMLElement;
          clone.removeAttribute("id");
          for (const descendant of clone.querySelectorAll("[id]")) {
            descendant.removeAttribute("id");
          }
          clone.style.position = "static";
          clone.style.left = "auto";
          clone.style.top = "auto";
          clone.style.margin = "0";
          clone.style.width = `${widthPx}px`;
          clone.style.maxWidth = "300px";
          clone.style.maxHeight = "148px";
          clone.style.overflow = "hidden";
          clone.style.opacity = "0.96";
          clone.style.pointerEvents = "none";
          clone.style.boxShadow = "0 12px 28px rgba(0, 0, 0, 0.18)";
          clone.style.transform = "rotate(1deg)";
          container.style.padding = "8px";
          container.appendChild(clone);
          return () => {
            container.replaceChildren();
          };
        },
      });
    },
    ...(onDragStart ? { onDragStart } : {}),
    ...(onDrop ? { onDrop } : {}),
  });
}

export interface PragmaticDropTargetOptions {
  readonly element: HTMLElement;
  readonly canDrop?: ((args: { readonly sourceData: Record<string, unknown> }) => boolean) | undefined;
  readonly onDragEnter?: (() => void) | undefined;
  readonly onDragLeave?: (() => void) | undefined;
  readonly onDrop: (args: { readonly sourceData: Record<string, unknown> }) => void;
}

export function bindPragmaticDropTarget({
  element,
  canDrop,
  onDragEnter,
  onDragLeave,
  onDrop,
}: PragmaticDropTargetOptions): () => void {
  return dropTargetForElements({
    element,
    ...(canDrop
      ? {
          canDrop: ({ source }) => canDrop({ sourceData: source.data }),
        }
      : {}),
    ...(onDragEnter ? { onDragEnter } : {}),
    ...(onDragLeave ? { onDragLeave } : {}),
    onDrop: ({ source }) => onDrop({ sourceData: source.data }),
  });
}
