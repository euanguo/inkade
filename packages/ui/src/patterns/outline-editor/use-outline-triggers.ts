import { asOutlineNodeId, type DocumentId, type OutlineNode } from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useCallback, useMemo, useRef, useState } from "react";
import { computeMentionDateCandidates } from "../../editor/markdown-utils.ts";
import { extractBlockRefTrigger, extractTagTrigger } from "../outline-diff-ops.ts";
import {
  collectSubtreeIds,
  extractSlashTrigger,
  extractWikilinkTrigger,
} from "../outline-helpers.ts";
import { getOutlineItemAttrs, outlineSchema } from "../outline-schema.ts";
import { buildOutlineSlashCommands } from "./outline-commands.tsx";
import {
  extractOutlineAtTrigger,
  findEnclosingOutlineItem,
  findNoteInItem,
} from "./pm-helpers.ts";
import type {
  ActiveTrigger,
  OutlineLatestState,
  OutlineTriggerItem,
  ProseMirrorWorkspaceDocSummary,
  SlashCommandId,
} from "./types.ts";

export interface UseOutlineTriggersOptions {
  readonly viewRef: React.RefObject<EditorView | null>;
  readonly latestRef: React.RefObject<OutlineLatestState>;
  readonly documentId: DocumentId;
  readonly activeNodes: readonly OutlineNode[];
  readonly workspaceDocs: readonly ProseMirrorWorkspaceDocSummary[];
  readonly allKnownTags: readonly string[];
  readonly t: ReturnType<typeof useInkadeTranslation>["t"];
}

export function useOutlineTriggers({
  viewRef,
  latestRef,
  documentId,
  activeNodes,
  workspaceDocs,
  allKnownTags,
  t,
}: UseOutlineTriggersOptions) {
  const [activeTrigger, setActiveTrigger] = useState<ActiveTrigger | null>(null);
  const [triggerIndex, setTriggerIndex] = useState(0);
  const activeTriggerRef = useRef<ActiveTrigger | null>(null);
  activeTriggerRef.current = activeTrigger;

  const slashCommands = useMemo(() => buildOutlineSlashCommands(t), [t]);

  const updateTriggerFromView = useCallback(
    (view: EditorView) => {
      if (view.composing || latestRef.current.readOnly) {
        setActiveTrigger(null);
        return;
      }
      const { selection } = view.state;
      if (!selection.empty) {
        setActiveTrigger(null);
        return;
      }
      const info = findEnclosingOutlineItem(selection.$from);
      if (!info || info.isNote) {
        setActiveTrigger(null);
        return;
      }

      const text = info.textNode.textContent;
      const offset = selection.$from.parentOffset;
      const paraStart = info.textPos + 1;
      const coords = view.coordsAtPos(selection.from);

      const wiki = extractWikilinkTrigger(text, offset);
      if (wiki) {
        setActiveTrigger({
          kind: "wikilink",
          itemPos: info.itemPos,
          paraStart,
          startOffset: wiki.startIndex,
          endOffset: offset,
          query: wiki.query,
          coords,
        });
        setTriggerIndex(0);
        return;
      }

      const blockRef = extractBlockRefTrigger(text, offset);
      if (blockRef) {
        setActiveTrigger({
          kind: "blockref",
          itemPos: info.itemPos,
          paraStart,
          startOffset: blockRef.startIndex,
          endOffset: offset,
          query: blockRef.query,
          coords,
        });
        setTriggerIndex(0);
        return;
      }

      const atTrigger = extractOutlineAtTrigger(text, offset);
      if (atTrigger) {
        setActiveTrigger({
          kind: "at",
          itemPos: info.itemPos,
          paraStart,
          startOffset: atTrigger.startIndex,
          endOffset: offset,
          query: atTrigger.query,
          coords,
        });
        setTriggerIndex(0);
        return;
      }

      const tagTrigger = extractTagTrigger(text, offset);
      if (tagTrigger) {
        setActiveTrigger({
          kind: "tag",
          itemPos: info.itemPos,
          paraStart,
          startOffset: tagTrigger.startIndex,
          endOffset: offset,
          query: tagTrigger.query,
          coords,
        });
        setTriggerIndex(0);
        return;
      }

      const slash = extractSlashTrigger(text, offset);
      if (slash) {
        setActiveTrigger({
          kind: "slash",
          itemPos: info.itemPos,
          paraStart,
          startOffset: slash.startIndex,
          endOffset: offset,
          query: slash.query,
          coords,
        });
        setTriggerIndex(0);
        return;
      }

      setActiveTrigger(null);
    },
    [latestRef],
  );

  const filteredTriggerItems = useMemo<readonly OutlineTriggerItem[]>(() => {
    if (!activeTrigger) return [];
    const q = activeTrigger.query.trim().toLowerCase();

    if (activeTrigger.kind === "slash") {
      return slashCommands
        .filter(
          (cmd) =>
            !q ||
            cmd.label.toLowerCase().includes(q) ||
            cmd.id.includes(q) ||
            (cmd.keywords?.toLowerCase().includes(q) ?? false),
        )
        .slice(0, 10)
        .map((cmd) => ({ type: "slash" as const, cmd }));
    }

    if (activeTrigger.kind === "at") {
      const dateCandidates = computeMentionDateCandidates().map((c) => {
        const label =
          c.id === "date-today"
            ? t("editor.mentionTodayLabel")
            : c.id === "date-tomorrow"
              ? t("editor.mentionTomorrowLabel")
              : t("editor.mentionNextMondayLabel");
        const keywords =
          c.id === "date-today"
            ? "today 今天"
            : c.id === "date-tomorrow"
              ? "tomorrow 明天"
              : "monday 下周一";
        return {
          type: "at-date" as const,
          id: c.id,
          isoDate: c.isoDate,
          label,
          keywords,
        };
      });

      const items: OutlineTriggerItem[] = [];
      for (const d of dateCandidates) {
        if (
          !q ||
          d.label.toLowerCase().includes(q) ||
          d.isoDate.includes(q) ||
          d.keywords.includes(q)
        ) {
          items.push({ type: "at-date", id: d.id, isoDate: d.isoDate, label: d.label });
        }
      }

      if (
        latestRef.current.onDispatchToAde &&
        (!q || "ade agent thread 绑定派单".includes(q))
      ) {
        items.push({ type: "at-ade" });
      }

      const docs = workspaceDocs
        .filter(
          (d) =>
            d.id !== documentId &&
            (!q || d.title.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q)),
        )
        .slice(0, 6);
      for (const d of docs) {
        items.push({ type: "at-doc", doc: d });
      }

      return items;
    }

    if (activeTrigger.kind === "wikilink") {
      return workspaceDocs
        .filter((d) => d.id !== documentId && (!q || d.title.toLowerCase().includes(q)))
        .slice(0, 8)
        .map((doc) => ({ type: "wikilink" as const, doc }));
    }

    if (activeTrigger.kind === "blockref") {
      return activeNodes
        .filter(
          (n) =>
            !q ||
            n.contentText.toLowerCase().includes(q) ||
            n.id.toLowerCase().includes(q),
        )
        .slice(0, 8)
        .map((node) => ({ type: "blockref" as const, node }));
    }

    const matchingTags = allKnownTags.filter((tag) => !q || tag.toLowerCase().includes(q)).slice(0, 8);
    if (q && !matchingTags.some((tItem) => tItem.toLowerCase() === q)) {
      matchingTags.push(activeTrigger.query.trim());
    }
    return matchingTags.map((tag) => ({ type: "tag" as const, tag }));
  }, [activeNodes, activeTrigger, allKnownTags, documentId, latestRef, slashCommands, t, workspaceDocs]);

  const triggerSelectionRef = useRef<{
    items: readonly OutlineTriggerItem[];
    index: number;
    apply: (itemIndex: number) => void;
  }>({
    items: [],
    index: 0,
    apply: () => {},
  });

  const applyTriggerOption = useCallback(
    (itemIndex: number) => {
      const view = viewRef.current;
      const trig = activeTriggerRef.current;
      const entry = filteredTriggerItems[itemIndex];
      if (!view || !trig || !entry) return;

      const from = trig.paraStart + trig.startOffset;
      const to = trig.paraStart + trig.endOffset;

      if (entry.type === "at-date") {
        const tr = view.state.tr.insertText(`[[${entry.isoDate}]] `, from, to);
        view.dispatch(tr);
        view.focus();
        setActiveTrigger(null);
        return;
      }

      if (entry.type === "at-doc" || entry.type === "wikilink") {
        const tr = view.state.tr.insertText(`[[${entry.doc.title}]] `, from, to);
        view.dispatch(tr);
        view.focus();
        setActiveTrigger(null);
        return;
      }

      if (entry.type === "at-ade") {
        const itemNode = view.state.doc.nodeAt(trig.itemPos);
        const itemAttrs = itemNode ? getOutlineItemAttrs(itemNode.attrs) : null;
        const tr = view.state.tr.delete(from, to);
        view.dispatch(tr);
        setActiveTrigger(null);
        if (itemAttrs?.nodeId) {
          const node = latestRef.current.activeById.get(asOutlineNodeId(itemAttrs.nodeId));
          if (node) {
            latestRef.current.onDispatchToAde?.(node);
          }
        }
        return;
      }

      if (entry.type === "blockref") {
        const tr = view.state.tr.insertText(`((${entry.node.id})) `, from, to);
        view.dispatch(tr);
        view.focus();
        setActiveTrigger(null);
        return;
      }

      if (entry.type === "tag") {
        const clean = entry.tag.replace(/^#+/, "").trim();
        if (!clean) return;
        const tr = view.state.tr.insertText(`#${clean} `, from, to);
        view.dispatch(tr);
        view.focus();
        setActiveTrigger(null);
        return;
      }

      const itemNode = view.state.doc.nodeAt(trig.itemPos);
      const itemAttrs = itemNode ? getOutlineItemAttrs(itemNode.attrs) : null;
      const cmd = entry.cmd.id;

      if (cmd === "link" || cmd === "blockref") {
        const tr = view.state.tr.insertText(cmd === "link" ? "[[" : "((", from, to);
        view.dispatch(tr);
        view.focus();
        return;
      }

      const dateCandidates = computeMentionDateCandidates();
      if (cmd === "today" || cmd === "tomorrow") {
        const picked = dateCandidates.find(
          (c) => c.id === (cmd === "today" ? "date-today" : "date-tomorrow"),
        );
        if (picked) {
          const tr = view.state.tr.insertText(`[[${picked.isoDate}]] `, from, to);
          view.dispatch(tr);
          view.focus();
          setActiveTrigger(null);
          return;
        }
      }

      const textSnippetMap: Partial<Record<SlashCommandId, string>> = {
        heading1: "# ",
        heading2: "## ",
        heading3: "### ",
        quote: "> ",
        "callout-note": "> [!NOTE] ",
        "callout-tip": "> [!TIP] ",
        "callout-warning": "> [!WARNING] ",
        code: "`code`",
        mermaid: "[[mermaid]] ",
        divider: "---",
      };
      const snippet = textSnippetMap[cmd];
      if (snippet !== undefined) {
        const tr = view.state.tr.insertText(snippet, from, to);
        view.dispatch(tr);
        view.focus();
        setActiveTrigger(null);
        return;
      }

      let tr = view.state.tr.delete(from, to);

      if (cmd === "todo" && itemNode && itemAttrs) {
        tr = tr.setNodeMarkup(trig.itemPos, undefined, {
          ...itemNode.attrs,
          checked: itemAttrs.checked === null ? false : null,
        });
        view.dispatch(tr);
        view.focus();
        setActiveTrigger(null);
        return;
      }

      if (cmd === "note" && itemNode) {
        const mappedPos = tr.mapping.map(trig.itemPos);
        const mappedItem = tr.doc.nodeAt(mappedPos);
        if (mappedItem) {
          const existingNote = findNoteInItem(mappedItem, mappedPos);
          if (existingNote) {
            tr = tr.setSelection(
              TextSelection.create(tr.doc, existingNote.pos + 1 + existingNote.node.content.size),
            );
          } else {
            const paraEnd = mappedPos + 1 + mappedItem.child(0).nodeSize;
            const noteNode = outlineSchema.nodes["outlineNote"].create();
            tr = tr.insert(paraEnd, noteNode);
            tr = tr.setSelection(TextSelection.create(tr.doc, paraEnd + 1));
          }
        }
        view.dispatch(tr);
        view.focus();
        setActiveTrigger(null);
        return;
      }

      view.dispatch(tr);
      setActiveTrigger(null);

      if (cmd === "mirror") {
        latestRef.current.onOpenMirrorPull?.({
          itemPos: trig.itemPos,
          nodeId: itemAttrs?.nodeId ?? null,
        });
        return;
      }

      if (itemAttrs?.nodeId) {
        const node = latestRef.current.activeById.get(asOutlineNodeId(itemAttrs.nodeId));
        if (node) {
          if (cmd === "dispatch") {
            latestRef.current.onDispatchToAde?.(node);
          } else if (cmd === "promote") {
            const subtreeIds = new Set(collectSubtreeIds(latestRef.current.activeNodes, node.id));
            const subtree = latestRef.current.activeNodes.filter((n) => subtreeIds.has(n.id));
            latestRef.current.onPromoteToArticle?.(node, subtree);
          }
        }
      }
    },
    [filteredTriggerItems, latestRef, viewRef],
  );

  triggerSelectionRef.current = {
    items: filteredTriggerItems,
    index: triggerIndex,
    apply: applyTriggerOption,
  };

  return {
    activeTrigger,
    activeTriggerRef,
    setActiveTrigger,
    triggerIndex,
    setTriggerIndex,
    updateTriggerFromView,
    filteredTriggerItems,
    applyTriggerOption,
    triggerSelectionRef,
  };
}
