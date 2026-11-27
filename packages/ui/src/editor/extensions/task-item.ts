import { InputRule, wrappingInputRule } from "@tiptap/react";
import TaskItem from "@tiptap/extension-task-item";
import { Fragment, type Node as PmNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

const BULLET_TASK_CHECKBOX_REGEX = /^\s*\[([ xX]?)\]\s$/;
const PARAGRAPH_TASK_PREFIX_REGEX = /^\s*[-+*]\s+\[([ xX]?)\]\s$/;
const EXISTING_TASK_PREFIX_REGEX = /^\s*(?:[-+*]\s+)?\[([ xX]?)\]\s$/;
const BARE_TASK_CHECKBOX_REGEX = /^\s*(\[([ xX]?)\])\s$/;

function sliceChildren(node: PmNode, fromIndex: number, toIndex: number): PmNode[] {
  const out: PmNode[] = [];
  for (let i = fromIndex; i < toIndex; i += 1) {
    out.push(node.child(i));
  }
  return out;
}

export const InkadeTaskItem = TaskItem.extend({
  addInputRules() {
    // 1. Convert "- [ ] " or "- [x] " when BulletList's "- " rule already wrapped the line into bulletList > listItem > paragraph
    const convertBulletListItemRule = new InputRule({
      find: BULLET_TASK_CHECKBOX_REGEX,
      handler: ({ state, range, match }) => {
        const { $from } = state.selection;
        const pDepth = $from.depth;
        if (pDepth < 2) return null;
        if ($from.parent.type.name !== "paragraph") return null;
        if (range.from !== $from.start()) return null;

        const listItemDepth = pDepth - 1;
        const bulletListDepth = pDepth - 2;
        const listItemNode = $from.node(listItemDepth);
        const bulletListNode = $from.node(bulletListDepth);
        if (listItemNode.type.name !== "listItem" || bulletListNode.type.name !== "bulletList") {
          return null;
        }
        // Only trigger inside the first block (leading paragraph) of the listItem
        if ($from.index(listItemDepth) !== 0) return null;

        const taskListType = state.schema.nodes.taskList;
        const taskItemType = this.type;
        const bulletListType = bulletListNode.type;
        if (!taskListType) return null;

        const checked = /x/i.test(match[1] ?? "");
        const { tr } = state;
        tr.delete(range.from, range.to);

        const mappedFrom = tr.mapping.map(range.from);
        const $mapped = tr.doc.resolve(mappedFrom);
        const updatedListItem = $mapped.node(listItemDepth);
        const updatedBulletList = $mapped.node(bulletListDepth);
        const itemIndex = $mapped.index(bulletListDepth);
        const bulletListPos = $mapped.before(bulletListDepth);
        const bulletListEnd = $mapped.after(bulletListDepth);

        const taskItemNode = taskItemType.createAndFill({ checked }, updatedListItem.content);
        if (!taskItemNode) return null;
        const taskListNode = taskListType.create(null, taskItemNode);

        const replacements: PmNode[] = [];
        let beforeSize = 0;
        if (itemIndex > 0) {
          const beforeBullet = bulletListType.create(
            updatedBulletList.attrs,
            sliceChildren(updatedBulletList, 0, itemIndex),
          );
          beforeSize = beforeBullet.nodeSize;
          replacements.push(beforeBullet);
        }
        replacements.push(taskListNode);
        if (itemIndex + 1 < updatedBulletList.childCount) {
          replacements.push(
            bulletListType.create(
              updatedBulletList.attrs,
              sliceChildren(updatedBulletList, itemIndex + 1, updatedBulletList.childCount),
            ),
          );
        }

        tr.replaceWith(bulletListPos, bulletListEnd, Fragment.fromArray(replacements));
        const targetPos = Math.min(
          tr.doc.content.size,
          // bulletListPos -> optional beforeBullet -> taskList(+1) -> taskItem(+1) -> paragraph(+1)
          bulletListPos + beforeSize + 3,
        );
        tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos)));
        return;
      },
    });

    // 2. Convert "- [ ] " or "* [x] " typed or inserted directly in a plain paragraph
    const paragraphDashTaskRule = new InputRule({
      find: PARAGRAPH_TASK_PREFIX_REGEX,
      handler: ({ state, range, match }) => {
        const { $from } = state.selection;
        if ($from.parent.type.name !== "paragraph") return null;
        if (range.from !== $from.start()) return null;
        if ($from.depth >= 1) {
          const parentName = $from.node($from.depth - 1).type.name;
          if (parentName === "listItem" || parentName === "taskItem") {
            return null;
          }
        }

        const taskListType = state.schema.nodes.taskList;
        const paragraphType = $from.parent.type;
        if (!taskListType) return null;

        const checked = /x/i.test(match[1] ?? "");
        const { tr } = state;
        tr.delete(range.from, range.to);

        const mappedFrom = tr.mapping.map(range.from);
        const $mapped = tr.doc.resolve(mappedFrom);
        const paraPos = $mapped.before($mapped.depth);
        const paraEnd = $mapped.after($mapped.depth);
        const paraNode = $mapped.parent;

        const taskParagraph = paragraphType.create(paraNode.attrs, paraNode.content);
        const taskItemNode = this.type.createAndFill({ checked }, taskParagraph);
        if (!taskItemNode) return null;
        const taskListNode = taskListType.create(null, taskItemNode);

        tr.replaceWith(paraPos, paraEnd, taskListNode);
        const targetPos = Math.min(tr.doc.content.size, paraPos + 3);
        tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos)));
        return;
      },
    });

    // 3. Support typing "- [x] " or "[x] " inside an existing taskItem paragraph
    const existingTaskItemRule = new InputRule({
      find: EXISTING_TASK_PREFIX_REGEX,
      handler: ({ state, range, match }) => {
        const { $from } = state.selection;
        const pDepth = $from.depth;
        if (pDepth < 2 || $from.parent.type.name !== "paragraph" || range.from !== $from.start()) {
          return null;
        }
        const taskItemDepth = pDepth - 1;
        const parentNode = $from.node(taskItemDepth);
        if (parentNode.type.name !== this.type.name || $from.index(taskItemDepth) !== 0) {
          return null;
        }
        const checked = /x/i.test(match[1] ?? "");
        const taskItemPos = $from.before(taskItemDepth);
        state.tr
          .setNodeMarkup(taskItemPos, undefined, { ...parentNode.attrs, checked })
          .delete(range.from, range.to);
        return;
      },
    });

    // 4. Support bare "[ ] ", "[] ", "[x] ", and "[X] " in a plain paragraph
    const bareTaskRule = wrappingInputRule({
      find: BARE_TASK_CHECKBOX_REGEX,
      type: this.type,
      getAttributes: (match) => ({
        checked: /x/i.test(match[2] ?? ""),
      }),
    });

    return [convertBulletListItemRule, existingTaskItemRule, paragraphDashTaskRule, bareTaskRule];
  },
});
