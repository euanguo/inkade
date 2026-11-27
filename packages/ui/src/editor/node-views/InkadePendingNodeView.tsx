"use client";

import type { InkadePendingStatus } from "@inkade/core";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type React from "react";
import { useCallback, useMemo } from "react";
import { InkadePendingBlock } from "../../patterns/InkadePendingBlock.tsx";
import { useEditorSurface } from "../context.tsx";

export function InkadePendingNodeView({
  deleteNode,
  editor,
  getPos,
  node,
  selected,
}: ReactNodeViewProps): React.ReactElement {
  const { readOnly, bindings, onOpenBinding } = useEditorSurface();
  const pendingId = String(node.attrs?.pendingId ?? "");
  const label = String(node.attrs?.label ?? "");
  const bindingId = String(node.attrs?.bindingId ?? "");
  const rawStatus = String(node.attrs?.status ?? "generating");
  const status: InkadePendingStatus =
    rawStatus === "queued" || rawStatus === "error" ? rawStatus : "generating";

  const matchedBinding = useMemo(
    () => (bindingId ? bindings?.find((b) => b.id === bindingId) : undefined),
    [bindingId, bindings],
  );

  const handleConvertToProse = useCallback(() => {
    if (readOnly) return;
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (typeof pos === "number" && editor) {
      const paragraphType = editor.state.schema.nodes.paragraph;
      if (paragraphType) {
        const tr = editor.state.tr.replaceWith(
          pos,
          pos + node.nodeSize,
          paragraphType.create(),
        );
        editor.view.dispatch(tr);
        editor.chain().focus(pos + 1).run();
        return;
      }
    }
    deleteNode();
  }, [deleteNode, editor, getPos, node.nodeSize, readOnly]);

  return (
    <NodeViewWrapper
      className={selected ? "rounded-[var(--radius-card)] ring-2 ring-primary/35 ring-offset-1" : undefined}
      contentEditable={false}
      data-pending-id={pendingId}
      data-type="inkade-pending"
    >
      <InkadePendingBlock
        binding={matchedBinding}
        bindingId={bindingId || undefined}
        label={label}
        onConvertToProse={readOnly ? undefined : handleConvertToProse}
        onOpenBinding={onOpenBinding}
        onRemovePlaceholder={readOnly ? undefined : deleteNode}
        pendingId={pendingId}
        readOnly={readOnly}
        status={status}
      />
    </NodeViewWrapper>
  );
}
