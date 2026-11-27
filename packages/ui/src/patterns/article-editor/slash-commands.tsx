import { extractToc, type AdeThreadBinding, type SelectionAnchor } from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import type { Editor } from "@tiptap/react";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  Code2Icon,
  Columns2Icon,
  DatabaseIcon,
  FileCodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  InfoIcon,
  LayoutTemplateIcon,
  LightbulbIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  PilcrowIcon,
  QuoteIcon,
  ShieldAlertIcon,
  SigmaIcon,
  SparklesIcon,
  TableIcon,
} from "lucide-react";
import {
  computeMentionDateCandidates,
  sanitizeSerializedMarkdown,
  scoreSlashCommand,
} from "../../editor/markdown-utils.ts";
import type {
  ActiveTriggerItem,
  BlockRefTriggerItem,
  MentionTriggerItem,
} from "../../editor/menus/TriggerCommandMenu.tsx";
import type {
  MentionDocumentCandidate,
  SlashCommandItem,
  TriggerMatch,
} from "../../editor/types.ts";
import type { GfmCalloutKind } from "../remark-inkade-wikilinks.ts";

type ArticleI18nT = ReturnType<typeof useInkadeTranslation>["t"];

export interface BuildArticleSlashCommandsOptions {
  readonly editor: Editor;
  readonly t: ArticleI18nT;
  readonly docTitle: string;
  readonly bindings: readonly AdeThreadBinding[];
  readonly onOpenImageDialog: () => void;
  readonly onOpenTemplatePicker: () => void;
  readonly onOpenChipPicker: () => void;
  readonly onInsertBindingChip: (binding: AdeThreadBinding) => void;
  readonly onDispatchAde?: ((payload: { readonly anchor: SelectionAnchor }) => void) | undefined;
}

export function buildArticleSlashCommands({
  editor,
  t,
  docTitle,
  bindings,
  onOpenImageDialog,
  onOpenTemplatePicker,
  onOpenChipPicker,
  onInsertBindingChip,
  onDispatchAde,
}: BuildArticleSlashCommandsOptions): readonly SlashCommandItem[] {
  const insertCallout = (kind: GfmCalloutKind): void => {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "inkadeCallout",
        attrs: { kind },
        content: [{ type: "paragraph" }],
      })
      .run();
  };

  return [
    {
      id: "paragraph",
      category: "basic",
      label: t("editor.slashParagraph"),
      description: t("editor.slashParagraphDesc"),
      keywords: "text paragraph p body",
      icon: <PilcrowIcon className="size-4" />,
      run: () => editor.chain().focus().setParagraph().run(),
    },
    {
      id: "h1",
      category: "basic",
      label: t("editor.slashHeading1"),
      description: t("editor.slashHeading1Desc"),
      keywords: "heading h1 title #",
      shortcut: "#",
      icon: <Heading1Icon className="size-4" />,
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: "h2",
      category: "basic",
      label: t("editor.slashHeading2"),
      description: t("editor.slashHeading2Desc"),
      keywords: "heading h2 subtitle ##",
      shortcut: "##",
      icon: <Heading2Icon className="size-4" />,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: "h3",
      category: "basic",
      label: t("editor.slashHeading3"),
      description: t("editor.slashHeading3Desc"),
      keywords: "heading h3 ###",
      shortcut: "###",
      icon: <Heading3Icon className="size-4" />,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      id: "bullet",
      category: "basic",
      label: t("editor.slashBulletList"),
      description: t("editor.slashBulletListDesc"),
      keywords: "list bullet ul -",
      shortcut: "-",
      icon: <ListIcon className="size-4" />,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered",
      category: "basic",
      label: t("editor.slashOrderedList"),
      description: t("editor.slashOrderedListDesc"),
      keywords: "list ordered ol number 1.",
      shortcut: "1.",
      icon: <ListOrderedIcon className="size-4" />,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "task",
      category: "basic",
      label: t("editor.slashTaskList"),
      description: t("editor.slashTaskListDesc"),
      keywords: "todo task check checklist []",
      shortcut: "[]",
      icon: <CheckSquareIcon className="size-4" />,
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      id: "blockquote",
      category: "basic",
      label: t("editor.slashBlockquote"),
      description: t("editor.slashBlockquoteDesc"),
      keywords: "quote blockquote >",
      shortcut: ">",
      icon: <QuoteIcon className="size-4" />,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "code",
      category: "media",
      label: t("editor.slashCodeBlock"),
      description: t("editor.slashCodeBlockDesc"),
      keywords: "code block snippet syntax ```",
      shortcut: "```",
      icon: <Code2Icon className="size-4" />,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "mermaid",
      category: "media",
      label: t("editor.slashMermaid"),
      description: t("editor.slashMermaidDesc"),
      keywords: "mermaid diagram flowchart sequence chart",
      icon: <FileCodeIcon className="size-4" />,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "codeBlock",
            attrs: { language: "mermaid" },
            content: [{ type: "text", text: "flowchart LR\n  A[Start] --> B[Done]" }],
          })
          .run(),
    },
    {
      id: "image",
      category: "media",
      label: t("editor.slashImage"),
      description: t("editor.slashImageDesc"),
      keywords: "image photo picture upload img",
      icon: <ImageIcon className="size-4" />,
      run: onOpenImageDialog,
    },
    {
      id: "table",
      category: "media",
      label: t("editor.slashTable"),
      description: t("editor.slashTableDesc"),
      keywords: "table grid spreadsheet",
      icon: <TableIcon className="size-4" />,
      run: () =>
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: "callout-note",
      category: "layout",
      label: t("editor.slashCalloutNote"),
      description: t("editor.slashCalloutDesc"),
      keywords: "callout alert note info",
      icon: <InfoIcon className="size-4 text-info-foreground" />,
      run: () => insertCallout("note"),
    },
    {
      id: "callout-tip",
      category: "layout",
      label: t("editor.slashCalloutTip"),
      description: t("editor.slashCalloutDesc"),
      keywords: "callout alert tip",
      icon: <LightbulbIcon className="size-4 text-success-foreground" />,
      run: () => insertCallout("tip"),
    },
    {
      id: "callout-important",
      category: "layout",
      label: t("editor.slashCalloutImportant"),
      description: t("editor.slashCalloutDesc"),
      keywords: "callout alert important",
      icon: <AlertCircleIcon className="size-4 text-violet-600 dark:text-violet-400" />,
      run: () => insertCallout("important"),
    },
    {
      id: "callout-warning",
      category: "layout",
      label: t("editor.slashCalloutWarning"),
      description: t("editor.slashCalloutDesc"),
      keywords: "callout alert warning",
      icon: <AlertTriangleIcon className="size-4 text-warning-foreground" />,
      run: () => insertCallout("warning"),
    },
    {
      id: "callout-caution",
      category: "layout",
      label: t("editor.slashCalloutCaution"),
      description: t("editor.slashCalloutDesc"),
      keywords: "callout alert caution danger",
      icon: <ShieldAlertIcon className="size-4 text-destructive-foreground" />,
      run: () => insertCallout("caution"),
    },
    {
      id: "toggle",
      category: "layout",
      label: t("editor.slashToggle"),
      description: t("editor.slashToggleDesc"),
      keywords: "toggle collapse details fold accordion",
      icon: <ChevronRightIcon className="size-4" />,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "inkadeToggle",
            attrs: { summary: "", open: true },
            content: [{ type: "paragraph" }],
          })
          .run(),
    },
    {
      id: "columns",
      category: "layout",
      label: t("editor.slashColumns"),
      description: t("editor.slashColumnsDesc"),
      keywords: "columns layout grid split 2col",
      icon: <Columns2Icon className="size-4" />,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "inkadeColumns",
            content: [
              {
                type: "inkadeColumn",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: t("editor.columnLeftLabel") }],
                  },
                ],
              },
              {
                type: "inkadeColumn",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: t("editor.columnRightLabel") }],
                  },
                ],
              },
            ],
          })
          .run(),
    },
    {
      id: "math",
      category: "layout",
      label: t("editor.slashMathBlock"),
      description: t("editor.slashMathBlockDesc"),
      keywords: "math katex latex formula equation block $$",
      shortcut: "$$",
      icon: <SigmaIcon className="size-4" />,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "inkadeMathBlock",
            attrs: { latex: "" },
          })
          .run(),
    },
    {
      id: "inline-math",
      category: "layout",
      label: t("editor.slashInlineMath"),
      description: t("editor.slashInlineMathDesc"),
      keywords: "inline math katex latex formula $",
      shortcut: "$",
      icon: <SigmaIcon className="size-4" />,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "inkadeInlineMath",
            attrs: { latex: "" },
          })
          .run(),
    },
    {
      id: "inkade-view",
      category: "layout",
      label: t("editor.slashInkadeView"),
      description: t("editor.slashInkadeViewDesc"),
      keywords: "view database live query table board inkade-view",
      shortcut: "/view",
      icon: <DatabaseIcon className="size-4 text-primary" />,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "inkadeView",
            attrs: { rawYaml: "mode: table\ncolumns:\n  - title\n  - updatedAt\nlimit: 12" },
          })
          .run(),
    },
    {
      id: "inkade-artifact",
      category: "layout",
      label: t("editor.slashInkadeArtifact"),
      description: t("editor.slashInkadeArtifactDesc"),
      keywords: "artifact interactive sandbox widget chart inkade-artifact",
      shortcut: "/artifact",
      icon: <SparklesIcon className="size-4 text-primary" />,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "inkadeArtifact",
            attrs: { artifactId: "", title: "", height: 420 },
          })
          .run(),
    },
    {
      id: "divider",
      category: "layout",
      label: t("editor.slashDivider"),
      description: t("editor.slashDividerDesc"),
      keywords: "hr divider line separator ---",
      shortcut: "---",
      icon: <MinusIcon className="size-4" />,
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      id: "template",
      category: "knowledge",
      label: t("editor.slashTemplate"),
      description: t("editor.slashTemplateDesc"),
      keywords: "template snippet",
      icon: <LayoutTemplateIcon className="size-4" />,
      run: onOpenTemplatePicker,
    },
    {
      id: "embed-ade",
      category: "knowledge",
      label: t("editor.slashEmbedAde"),
      description: t("editor.slashEmbedAdeDesc"),
      keywords: "ade thread agent embed card",
      icon: <SparklesIcon className="size-4 text-primary" />,
      run: () => {
        const firstBinding = bindings[0];
        if (firstBinding) {
          onInsertBindingChip(firstBinding);
        } else if (onDispatchAde) {
          onDispatchAde({ anchor: { quote: docTitle } });
        } else {
          onOpenChipPicker();
        }
      },
    },
  ];
}

export function extractArticleDocToc(
  mode: "rich" | "source",
  sourceDraft: string,
  editor: Editor | null,
) {
  const currentMd =
    mode === "source"
      ? sourceDraft
      : editor
        ? sanitizeSerializedMarkdown(editor.getMarkdown())
        : sourceDraft;
  return extractToc(currentMd);
}

export function computeArticleTriggerItems({
  triggerMatch,
  slashCommands,
  mentionCandidates,
  docId,
  docTitle,
  docTocEntries,
  t,
}: {
  readonly triggerMatch: TriggerMatch | null;
  readonly slashCommands: readonly SlashCommandItem[];
  readonly mentionCandidates: readonly MentionDocumentCandidate[];
  readonly docId: string;
  readonly docTitle: string;
  readonly docTocEntries: ReturnType<typeof extractToc>;
  readonly t: ArticleI18nT;
}): readonly ActiveTriggerItem[] {
  if (!triggerMatch) return [];
  const rawQuery = triggerMatch.query.trim();
  const q = rawQuery.toLowerCase();

  if (triggerMatch.kind === "slash") {
    if (!q) return slashCommands;
    return slashCommands
      .map((item, idx) => ({ item, idx, score: scoreSlashCommand(item, rawQuery) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.idx - b.idx)
      .map((entry) => entry.item);
  }

  if (triggerMatch.kind === "wikilink") {
    return mentionCandidates
      .filter((d) => d.id !== docId && (!q || d.title.toLowerCase().includes(q)))
      .slice(0, 12);
  }

  if (triggerMatch.kind === "mention") {
    const effectiveTitle = rawQuery || t("common.untitled");
    const docItems: MentionTriggerItem[] = mentionCandidates
      .filter((d) => d.id !== docId && (!q || d.title.toLowerCase().includes(q)))
      .slice(0, 8)
      .map((d) => ({
        itemKind: "doc",
        id: d.id,
        title: d.title,
        docKind: d.kind,
      }));

    const datePresets: MentionTriggerItem[] = computeMentionDateCandidates()
      .map((entry) => {
        if (entry.id === "date-today") {
          return {
            itemKind: "date" as const,
            id: entry.id,
            isoDate: entry.isoDate,
            label: t("editor.mentionDateToday", { date: entry.isoDate }),
            description: t("editor.mentionDateTodayDesc", { date: entry.isoDate }),
            keywords: `today 今天 今日 ${entry.isoDate}`,
          };
        }
        if (entry.id === "date-tomorrow") {
          return {
            itemKind: "date" as const,
            id: entry.id,
            isoDate: entry.isoDate,
            label: t("editor.mentionDateTomorrow", { date: entry.isoDate }),
            description: t("editor.mentionDateTomorrowDesc", { date: entry.isoDate }),
            keywords: `tomorrow 明天 明日 ${entry.isoDate}`,
          };
        }
        return {
          itemKind: "date" as const,
          id: entry.id,
          isoDate: entry.isoDate,
          label: t("editor.mentionDateNextWeek", { date: entry.isoDate }),
          description: t("editor.mentionDateNextWeekDesc", { date: entry.isoDate }),
          keywords: `next monday nextweek 下周一 周一 ${entry.isoDate}`,
        };
      })
      .filter(
        (item) =>
          !q ||
          item.label.toLowerCase().includes(q) ||
          item.keywords.toLowerCase().includes(q),
      );

    const quickActions: MentionTriggerItem[] = [
      {
        itemKind: "create-doc",
        id: "create-article",
        docKind: "article",
        title: effectiveTitle,
      },
      {
        itemKind: "create-doc",
        id: "create-outline",
        docKind: "outline",
        title: effectiveTitle,
      },
      {
        itemKind: "bind-ade",
        id: "bind-ade",
        query: rawQuery,
      },
    ];
    return [...docItems, ...datePresets, ...quickActions];
  }

  const headingItems: BlockRefTriggerItem[] = docTocEntries
    .filter((entry) => !q || entry.text.toLowerCase().includes(q))
    .slice(0, 6)
    .map((entry) => ({
      id: `heading:${entry.slug}`,
      label: `${docTitle}#${entry.slug}`,
      display: entry.text,
    }));
  const docItems: BlockRefTriggerItem[] = mentionCandidates
    .filter((d) => d.id !== docId && (!q || d.title.toLowerCase().includes(q)))
    .slice(0, 6)
    .map((d) => ({
      id: `doc:${d.id}`,
      label: d.title,
      display: d.title,
    }));
  return [...headingItems, ...docItems];
}
