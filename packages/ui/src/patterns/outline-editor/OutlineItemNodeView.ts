import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter";
import { t as translate } from "@inkade/i18n";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import { cn } from "../../lib/utils.ts";
import { countOutlineHiddenDescendants } from "../outline-diff-ops.ts";
import { getOutlineItemAttrs } from "../outline-schema.ts";
import { getChildOutlineItems } from "./pm-helpers.ts";
import type { NodeViewActionBridge } from "./types.ts";

export class OutlineItemNodeView implements NodeView {
  readonly dom: HTMLDivElement;
  readonly contentDOM: HTMLDivElement;
  private node: PMNode;
  private readonly getPos: () => number | undefined;
  private readonly bridge: NodeViewActionBridge;

  private readonly gripBtn: HTMLButtonElement;
  private readonly chevronBtn: HTMLButtonElement;
  private readonly bulletBtn: HTMLButtonElement;
  private readonly bulletDot: HTMLSpanElement;
  private readonly hiddenBadge: HTMLSpanElement;
  private readonly todoBtn: HTMLButtonElement;
  private readonly guideBtn: HTMLButtonElement;
  private readonly dropTop: HTMLSpanElement;
  private readonly dropBottom: HTMLSpanElement;
  private readonly dropChild: HTMLSpanElement;

  private didDrag = false;
  private cleanDnd: (() => void) | null = null;

  constructor(
    node: PMNode,
    _view: EditorView,
    getPos: () => number | undefined,
    bridge: NodeViewActionBridge,
  ) {
    this.node = node;
    this.getPos = getPos;
    this.bridge = bridge;

    this.dom = document.createElement("div");
    this.dom.className = "inkade-pm-item relative rounded-lg transition-colors";
    this.dom.setAttribute("data-outline-item", "true");
    this.dom.setAttribute("role", "treeitem");

    this.dom.addEventListener("mouseover", (e) => {
      const target = e.target;
      if (target instanceof Element && target.closest("[data-outline-item]") === this.dom) {
        this.dom.setAttribute("data-row-hover", "true");
      } else {
        this.dom.removeAttribute("data-row-hover");
      }
    });
    this.dom.addEventListener("mouseleave", () => {
      this.dom.removeAttribute("data-row-hover");
    });

    this.dropTop = document.createElement("span");
    this.dropTop.className =
      "pointer-events-none absolute inset-x-2 -top-px z-20 hidden h-0.5 rounded-full bg-primary";
    this.dropBottom = document.createElement("span");
    this.dropBottom.className =
      "pointer-events-none absolute inset-x-2 -bottom-px z-20 hidden h-0.5 rounded-full bg-primary";
    this.dropChild = document.createElement("span");
    this.dropChild.className =
      "pointer-events-none absolute inset-y-1 right-1 left-7 hidden rounded-md border-2 border-dashed border-info/70";
    this.dom.append(this.dropTop, this.dropBottom, this.dropChild);

    const gutter = document.createElement("div");
    gutter.className = "absolute top-[5px] left-0 z-10 flex items-center gap-0.5 select-none";
    gutter.contentEditable = "false";

    this.gripBtn = document.createElement("button");
    this.gripBtn.type = "button";
    this.gripBtn.tabIndex = -1;
    this.gripBtn.setAttribute("data-outline-handle", "true");
    this.gripBtn.setAttribute("aria-haspopup", "menu");
    this.gripBtn.className =
      "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/55 opacity-0 transition-[opacity,background-color,color] duration-[var(--duration-quick)] hover:bg-accent hover:text-foreground active:cursor-grabbing";
    this.gripBtn.innerHTML =
      '<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>';
    this.gripBtn.addEventListener("click", (e) => {
      if (this.didDrag || this.bridge.readOnly()) return;
      const pos = this.getPos();
      if (pos === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      const attrs = getOutlineItemAttrs(this.node.attrs);
      this.bridge.onOpenNodeMenu(
        pos,
        attrs.nodeId,
        attrs.sourceBindingId,
        this.gripBtn.getBoundingClientRect(),
      );
    });
    this.gripBtn.addEventListener("contextmenu", (e) => {
      if (this.bridge.readOnly()) return;
      const pos = this.getPos();
      if (pos === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      const attrs = getOutlineItemAttrs(this.node.attrs);
      this.bridge.onOpenNodeMenu(
        pos,
        attrs.nodeId,
        attrs.sourceBindingId,
        this.gripBtn.getBoundingClientRect(),
      );
    });

    this.chevronBtn = document.createElement("button");
    this.chevronBtn.type = "button";
    this.chevronBtn.tabIndex = -1;
    this.chevronBtn.className =
      "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-transform hover:bg-muted hover:text-foreground";
    this.chevronBtn.innerHTML =
      '<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
    this.chevronBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = this.getPos();
      if (pos !== undefined) this.bridge.onToggleCollapse(pos);
    });

    this.bulletBtn = document.createElement("button");
    this.bulletBtn.type = "button";
    this.bulletBtn.tabIndex = -1;
    this.bulletBtn.className =
      "inkade-bullet-halo inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full transition-[background-color,box-shadow,transform] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:bg-muted";
    this.bulletDot = document.createElement("span");
    this.bulletDot.className = "size-1.5 rounded-full bg-foreground/65 transition-colors";
    this.bulletBtn.appendChild(this.bulletDot);
    this.bulletBtn.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const id = getOutlineItemAttrs(this.node.attrs).nodeId;
      if (id) this.bridge.onZoomIn(id);
    });
    this.bulletBtn.addEventListener("contextmenu", (e) => {
      if (this.bridge.readOnly()) return;
      const pos = this.getPos();
      if (pos === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      const attrs = getOutlineItemAttrs(this.node.attrs);
      this.bridge.onOpenNodeMenu(
        pos,
        attrs.nodeId,
        attrs.sourceBindingId,
        this.bulletBtn.getBoundingClientRect(),
      );
    });

    this.hiddenBadge = document.createElement("span");
    this.hiddenBadge.className =
      "hidden shrink-0 rounded-full border border-primary/25 bg-brand-subtle px-1 py-0 text-[10px] font-medium tabular-nums text-brand-subtle-foreground";

    this.todoBtn = document.createElement("button");
    this.todoBtn.type = "button";
    this.todoBtn.tabIndex = -1;
    this.todoBtn.setAttribute("role", "checkbox");
    this.todoBtn.className =
      "ml-1 hidden size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-input bg-background transition-colors hover:border-primary";
    this.todoBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = this.getPos();
      if (pos !== undefined && !this.bridge.readOnly()) {
        this.bridge.onToggleTodo(pos);
      }
    });

    gutter.append(this.gripBtn, this.chevronBtn, this.bulletBtn, this.hiddenBadge, this.todoBtn);

    this.guideBtn = document.createElement("button");
    this.guideBtn.type = "button";
    this.guideBtn.tabIndex = -1;
    this.guideBtn.contentEditable = "false";
    this.guideBtn.className =
      "group/guide absolute top-6 bottom-1 left-[38px] z-10 hidden w-3 cursor-pointer items-stretch justify-center select-none";
    const guideLine = document.createElement("span");
    guideLine.className =
      "h-full w-px bg-border/80 transition-[width,background-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] group-hover/guide:w-[1.5px] group-hover/guide:bg-primary/65";
    this.guideBtn.appendChild(guideLine);
    this.guideBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = this.getPos();
      if (pos !== undefined) this.bridge.onToggleCollapse(pos);
    });

    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "inkade-pm-content min-w-0 flex flex-col";

    this.dom.append(gutter, this.guideBtn, this.contentDOM);
    this.syncDomFromNode(node);
    this.setupDnd();
  }

  private setupDnd(): void {
    const attrs = getOutlineItemAttrs(this.node.attrs);
    if (!attrs.nodeId || this.bridge.readOnly()) return;
    const nodeId = attrs.nodeId;

    const cleanDrag = draggable({
      element: this.dom,
      dragHandle: this.gripBtn,
      getInitialData: () => ({ type: "inkade-pm-outline-node", nodeId }),
      onDragStart: () => {
        this.didDrag = true;
        this.dom.style.opacity = "0.45";
      },
      onDrop: () => {
        this.dom.style.opacity = "";
        requestAnimationFrame(() => {
          this.didDrag = false;
        });
      },
    });

    const cleanDrop = dropTargetForElements({
      element: this.dom,
      canDrop: ({ source }) =>
        source.data["type"] === "inkade-pm-outline-node" &&
        source.data["nodeId"] !== nodeId,
      onDrag: ({ location }) => {
        const rect = this.dom.getBoundingClientRect();
        const relY = location.current.input.clientY - rect.top;
        const ratio = rect.height > 0 ? relY / rect.height : 0.5;
        this.dropTop.classList.toggle("hidden", ratio >= 0.25);
        this.dropBottom.classList.toggle("hidden", ratio <= 0.75);
        this.dropChild.classList.toggle("hidden", ratio < 0.25 || ratio > 0.75);
      },
      onDragLeave: () => {
        this.dropTop.classList.add("hidden");
        this.dropBottom.classList.add("hidden");
        this.dropChild.classList.add("hidden");
      },
      onDrop: ({ source, location }) => {
        this.dropTop.classList.add("hidden");
        this.dropBottom.classList.add("hidden");
        this.dropChild.classList.add("hidden");
        const draggedId = source.data["nodeId"];
        if (typeof draggedId !== "string") return;
        const rect = this.dom.getBoundingClientRect();
        const relY = location.current.input.clientY - rect.top;
        const ratio = rect.height > 0 ? relY / rect.height : 0.5;
        const pos: "above" | "below" | "child" =
          ratio < 0.25 ? "above" : ratio > 0.75 ? "below" : "child";
        this.bridge.onDropMove(draggedId, nodeId, pos);
      },
    });

    this.cleanDnd = () => {
      cleanDrag();
      cleanDrop();
    };
  }

  private syncDomFromNode(node: PMNode): void {
    this.node = node;
    const attrs = getOutlineItemAttrs(node.attrs);
    const childItems = getChildOutlineItems(node);
    const hasChildren = childItems.length > 0;
    const hiddenCount = attrs.collapsed ? countOutlineHiddenDescendants(node) : 0;

    if (attrs.nodeId) this.dom.setAttribute("data-node-id", attrs.nodeId);
    else this.dom.removeAttribute("data-node-id");

    this.dom.setAttribute("data-collapsed", String(attrs.collapsed));
    this.dom.setAttribute("data-checked", attrs.checked === null ? "null" : String(attrs.checked));
    this.dom.setAttribute("data-author-type", attrs.authorType);
    if (attrs.sourceBindingId) {
      this.dom.setAttribute("data-source-binding-id", attrs.sourceBindingId);
    } else {
      this.dom.removeAttribute("data-source-binding-id");
    }

    this.dom.setAttribute("aria-expanded", hasChildren ? String(!attrs.collapsed) : "false");

    this.gripBtn.style.display = this.bridge.readOnly() ? "none" : "inline-flex";
    this.gripBtn.title = translate("outline.nodeActionsMenu");
    this.gripBtn.setAttribute("aria-label", translate("outline.nodeActionsMenu"));

    this.chevronBtn.style.visibility = hasChildren ? "visible" : "hidden";
    this.chevronBtn.style.transform = hasChildren && !attrs.collapsed ? "rotate(90deg)" : "";
    this.chevronBtn.setAttribute(
      "aria-label",
      attrs.collapsed ? translate("outline.expandSubtree") : translate("outline.collapseSubtree"),
    );

    const isMirrored = Boolean(attrs.mirrorOfNodeId);
    this.dom.setAttribute("data-mirrored", isMirrored ? "true" : "false");
    this.bulletBtn.title = translate("outline.zoomIntoNode");
    this.bulletBtn.setAttribute("aria-label", translate("outline.zoomIntoNode"));
    this.bulletBtn.setAttribute("data-collapsed", String(attrs.collapsed && hasChildren));
    this.bulletBtn.classList.toggle("bg-brand-subtle", attrs.collapsed && hasChildren);
    this.bulletBtn.classList.toggle("border", isMirrored);
    this.bulletBtn.classList.toggle("border-dashed", isMirrored);
    this.bulletBtn.classList.toggle("border-teal-500/75", isMirrored);
    this.bulletDot.className = cn(
      "transition-colors",
      isMirrored
        ? "size-1.5 rotate-45 rounded-[1px] bg-teal-500"
        : cn(
            "size-1.5 rounded-full",
            attrs.authorType === "agent"
              ? "bg-info"
              : attrs.collapsed && hasChildren
                ? "bg-primary"
                : "bg-foreground/65",
          ),
    );

    if (attrs.collapsed && hiddenCount > 0) {
      this.hiddenBadge.classList.remove("hidden");
      this.hiddenBadge.textContent = translate("outline.hiddenDescendantsBadge", {
        count: hiddenCount,
      });
      this.hiddenBadge.title = translate("outline.hiddenDescendantsTitle", {
        count: hiddenCount,
      });
    } else {
      this.hiddenBadge.classList.add("hidden");
    }

    if (attrs.checked === null) {
      this.todoBtn.classList.add("hidden");
      this.todoBtn.classList.remove("inline-flex");
    } else {
      this.todoBtn.classList.remove("hidden");
      this.todoBtn.classList.add("inline-flex");
      this.todoBtn.setAttribute("aria-checked", String(attrs.checked));
      if (attrs.checked) {
        this.todoBtn.className =
          "ml-1 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-primary bg-primary text-primary-foreground transition-colors";
        this.todoBtn.innerHTML =
          '<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 6.5"/></svg>';
      } else {
        this.todoBtn.className =
          "ml-1 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-input bg-background text-transparent transition-colors hover:border-primary";
        this.todoBtn.innerHTML = "";
      }
    }

    this.guideBtn.setAttribute("aria-label", translate("outline.collapseGuideAria"));
    const isReadOnly = this.bridge.readOnly();
    this.guideBtn.style.left = isReadOnly ? "20px" : "38px";
    if (hasChildren && !attrs.collapsed) {
      this.guideBtn.classList.remove("hidden");
      this.guideBtn.classList.add("flex");
    } else {
      this.guideBtn.classList.add("hidden");
      this.guideBtn.classList.remove("flex");
    }

    const gutterBase = isReadOnly ? 34 : 52;
    const todoExtra = attrs.checked !== null ? 22 : 0;
    const badgeExtra = attrs.collapsed && hiddenCount > 0 ? 28 : 0;
    const contentPad = gutterBase + todoExtra + badgeExtra + 10;
    this.dom.style.setProperty("--inkade-content-pad", `${contentPad}px`);
    this.contentDOM.style.paddingLeft = `${contentPad}px`;
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const prevId = getOutlineItemAttrs(this.node.attrs).nodeId;
    const nextId = getOutlineItemAttrs(node.attrs).nodeId;
    this.syncDomFromNode(node);
    if (prevId !== nextId) {
      this.cleanDnd?.();
      this.cleanDnd = null;
      this.setupDnd();
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-outline-handle="true"]')) {
      return true;
    }
    if (
      event.type === "dragstart" ||
      event.type === "drag" ||
      event.type === "dragenter" ||
      event.type === "dragover" ||
      event.type === "dragleave" ||
      event.type === "drop" ||
      event.type === "dragend"
    ) {
      return true;
    }
    return false;
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }): boolean {
    if (mutation.type === "selection") return false;
    const target = mutation.target;
    if (target instanceof Node && !this.contentDOM.contains(target)) {
      return true;
    }
    return false;
  }

  destroy(): void {
    this.cleanDnd?.();
    this.cleanDnd = null;
  }
}
