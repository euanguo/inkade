import { renderOutlineNodesToMarkdown, type OutlineNode } from "@inkade/core";

export function buildSubtreeMarkdown(
  root: OutlineNode,
  allNodes: readonly OutlineNode[],
  explicitTitle?: string,
): { readonly title: string; readonly markdown: string } {
  const plainRoot = root.contentText.replace(/\s+/g, " ").trim();
  const title =
    explicitTitle && explicitTitle.trim().length > 0
      ? explicitTitle.trim()
      : plainRoot.length > 0
        ? plainRoot.slice(0, 120)
        : "Promoted Note";

  const lines: string[] = [`# ${title}`, ""];
  if (root.contentMarkdown.trim().length > 0) {
    lines.push(root.contentMarkdown.trim());
  }
  const rootNote = (root.noteMarkdown ?? "").trim();
  if (rootNote.length > 0) {
    lines.push("", rootNote);
  }
  lines.push("");

  const normalizedNodes = allNodes.map((node) => ({
    ...node,
    contentMarkdown: node.contentMarkdown.trim() || node.contentText.trim(),
  }));
  const subtreeMarkdown = renderOutlineNodesToMarkdown(normalizedNodes, {
    rootParentId: root.id,
    notePrefix: "",
  });
  if (subtreeMarkdown.length > 0) {
    lines.push(subtreeMarkdown);
  }

  return {
    title,
    markdown: lines.join("\n").trimEnd() + "\n",
  };
}
