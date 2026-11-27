import {
  appendMarkdownTaskLine,
  asOutlineNodeId,
  computeNextRecurrenceDate,
  defaultStartMinForSlot,
  InkadeError,
  isPrefixedId,
  parseIsoToLocalCalendarDate,
  parseQuickTaskSyntax,
  slotForScheduledStartMin,
  todayLocalDateString,
  updateMarkdownTaskLine,
  type BatchUpdateTasksInput,
  type CreateTaskInput,
  type DocumentId,
  type DocumentRecord,
  type DocumentTaskRecord,
  type OutlineNode,
  type OutlineNodeId,
  type RescheduleTaskInput,
  type TaskTargetId,
  type UpdateTaskInput,
  type WorkspaceTaskItem,
} from "@inkade/core";
import type { DocumentRepo, OutlineRepo, SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";
import type { DocumentService } from "./document-service.ts";
import type { OutlineService } from "./outline-service.ts";
import { assertScope, getAllWorkspaceSpaces, resolveOutlineNodeDocumentId } from "./scope-guard.ts";

export interface TaskServiceRepos {
  readonly outlineRepo: OutlineRepo;
  readonly documentRepo: DocumentRepo;
  readonly spaceRepo: SpaceRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
}

export interface TaskMutationResult {
  readonly node: OutlineNode;
  readonly document?: DocumentRecord | undefined;
  readonly task?: DocumentTaskRecord | undefined;
  readonly spawnedNextNode?: OutlineNode | null | undefined;
  readonly deletedSpawnedNodeId?: OutlineNodeId | null | undefined;
}

function toMarkdownOutlineNode(task: DocumentTaskRecord): OutlineNode {
  return {
    id: asOutlineNodeId(task.id),
    documentId: task.docId,
    parentNodeId: null,
    orderKey: String(task.lineIndex ?? 0).padStart(6, "0"),
    contentMarkdown: task.title,
    contentText: task.title,
    noteMarkdown: "",
    noteText: "",
    checked: task.completed,
    collapsed: false,
    authorType: "human",
    authorId: null,
    sourceBindingId: null,
    ...(task.priority ? { priority: task.priority } : {}),
    ...(task.scheduledDate ? { scheduledDate: task.scheduledDate } : {}),
    ...(task.scheduledStartMin !== null
      ? {
          scheduledStartMin: task.scheduledStartMin,
          scheduledSlot: slotForScheduledStartMin(task.scheduledStartMin),
        }
      : {}),
    ...(task.durationMin !== null ? { durationMin: task.durationMin } : {}),
    ...(task.dueDate ? { dueDate: task.dueDate } : {}),
    ...(task.recurrenceRule ? { recurrenceRule: task.recurrenceRule } : {}),
    createdAt: task.updatedAt,
    updatedAt: task.updatedAt,
    deletedAt: null,
  };
}

export class TaskService {
  constructor(
    private readonly repos: TaskServiceRepos,
    private readonly outlineService: OutlineService,
    private readonly documentService: DocumentService,
  ) {}

  async createTask(
    principal: Principal,
    input: CreateTaskInput,
  ): Promise<{ readonly node: OutlineNode; readonly document: DocumentRecord; readonly task?: DocumentTaskRecord | undefined }> {
    const rawText = (input.title ?? input.contentMarkdown ?? "").trim();
    if (!rawText) {
      throw new InkadeError("VALIDATION_ERROR", "Task title or contentMarkdown is required");
    }

    if (input.documentId) {
      const targetDoc = await this.documentService.getDocument(principal, input.documentId);
      if (targetDoc.kind !== "outline") {
        const allSpaces = await getAllWorkspaceSpaces(
          this.repos.spacesCache ?? this.repos.spaceRepo,
          principal.workspaceId,
        );
        assertScope(
          principal.scope,
          "append",
          { spaceId: targetDoc.spaceId, kind: targetDoc.kind, tags: targetDoc.tags },
          allSpaces,
        );

        const useQuickSyntax = input.parseQuickSyntax !== false;
        const parsed = useQuickSyntax
          ? parseQuickTaskSyntax(rawText, parseIsoToLocalCalendarDate(input.referenceDate))
          : { title: rawText };

        const scheduledDate =
          input.scheduledDate !== undefined ? input.scheduledDate : (parsed.scheduledDate ?? null);
        const scheduledStartMin =
          input.scheduledStartMin !== undefined
            ? input.scheduledStartMin
            : parsed.scheduledStartMin !== undefined
              ? parsed.scheduledStartMin
              : input.scheduledSlot
                ? defaultStartMinForSlot(input.scheduledSlot)
                : parsed.scheduledSlot
                  ? defaultStartMinForSlot(parsed.scheduledSlot)
                  : null;
        const priority = input.priority !== undefined ? input.priority : (parsed.priority ?? null);
        const durationMin =
          input.durationMin !== undefined ? input.durationMin : (parsed.durationMin ?? null);
        const dueDate = input.dueDate !== undefined ? input.dueDate : (parsed.dueDate ?? null);
        const recurrenceRule =
          input.recurrenceRule !== undefined
            ? input.recurrenceRule
            : (parsed.recurrenceRule ?? null);

        const { markdown, createdTask } = appendMarkdownTaskLine(targetDoc.contentMarkdown, {
          title: parsed.title,
          completed: false,
          priority,
          scheduledDate,
          scheduledStartMin,
          durationMin,
          dueDate,
          recurrenceRule,
        });

        const updatedDoc = await this.documentService.updateDocument(principal, targetDoc.id, {
          contentMarkdown: markdown,
          expectedVersion: targetDoc.version,
          changeSummary: "Added task via task board",
        });

        const indexedList = await this.repos.outlineRepo.listDocumentTasks(principal.workspaceId, {
          sourceEngine: "markdown",
        });
        const indexed = indexedList.find(
          (row) => row.task.docId === updatedDoc.id && row.task.blockKey === createdTask.blockKey,
        );
        const virtualNode = indexed
          ? toMarkdownOutlineNode(indexed.task)
          : toMarkdownOutlineNode({
              id: `tsk_${createdTask.blockKey}` as DocumentTaskRecord["id"],
              workspaceId: principal.workspaceId,
              sourceEngine: "markdown",
              docId: updatedDoc.id,
              blockKey: createdTask.blockKey,
              lineIndex: createdTask.lineIndex,
              title: createdTask.title,
              completed: createdTask.completed,
              priority: createdTask.priority,
              scheduledDate: createdTask.scheduledDate,
              scheduledStartMin: createdTask.scheduledStartMin,
              durationMin: createdTask.durationMin,
              dueDate: createdTask.dueDate,
              recurrenceRule: createdTask.recurrenceRule,
              spaceId: updatedDoc.spaceId,
              tags: updatedDoc.tags,
              updatedAt: updatedDoc.updatedAt,
            });

        return {
          node: virtualNode,
          document: updatedDoc,
          ...(indexed ? { task: indexed.task } : {}),
        };
      }
    }

    return this.outlineService.createTask(principal, input);
  }

  async updateTask(
    principal: Principal,
    taskId: TaskTargetId,
    input: UpdateTaskInput,
  ): Promise<TaskMutationResult> {
    const indexed = await this.repos.outlineRepo.getDocumentTaskById(principal.workspaceId, taskId);
    if (!indexed) {
      if (isPrefixedId("nod", taskId)) {
        const res = await this.outlineService.updateNodeWithResult(principal, taskId, {
          ...(input.contentMarkdown !== undefined || input.title !== undefined
            ? { contentMarkdown: input.contentMarkdown ?? input.title }
            : {}),
          ...(input.noteMarkdown !== undefined ? { noteMarkdown: input.noteMarkdown } : {}),
          ...(input.checked !== undefined || input.completed !== undefined
            ? { checked: input.checked ?? input.completed }
            : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.scheduledDate !== undefined ? { scheduledDate: input.scheduledDate } : {}),
          ...(input.scheduledSlot !== undefined ? { scheduledSlot: input.scheduledSlot } : {}),
          ...(input.scheduledStartMin !== undefined
            ? { scheduledStartMin: input.scheduledStartMin }
            : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
          ...(input.recurrenceRule !== undefined ? { recurrenceRule: input.recurrenceRule } : {}),
        });
        return {
          node: res.node,
          ...(res.spawnedNextNode ? { spawnedNextNode: res.spawnedNextNode } : {}),
          ...(res.deletedSpawnedNodeId
            ? { deletedSpawnedNodeId: res.deletedSpawnedNodeId }
            : {}),
        };
      }
      throw new InkadeError("NOT_FOUND", `Task "${taskId}" not found`);
    }

    if (indexed.task.sourceEngine === "outline") {
      const nodeId = indexed.task.blockKey as OutlineNodeId;
      const res = await this.outlineService.updateNodeWithResult(
        principal,
        nodeId,
        {
          ...(input.contentMarkdown !== undefined || input.title !== undefined
            ? { contentMarkdown: input.contentMarkdown ?? input.title }
            : {}),
          ...(input.noteMarkdown !== undefined ? { noteMarkdown: input.noteMarkdown } : {}),
          ...(input.checked !== undefined || input.completed !== undefined
            ? { checked: input.checked ?? input.completed }
            : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.scheduledDate !== undefined ? { scheduledDate: input.scheduledDate } : {}),
          ...(input.scheduledSlot !== undefined ? { scheduledSlot: input.scheduledSlot } : {}),
          ...(input.scheduledStartMin !== undefined
            ? { scheduledStartMin: input.scheduledStartMin }
            : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
          ...(input.recurrenceRule !== undefined ? { recurrenceRule: input.recurrenceRule } : {}),
        },
        indexed.task.docId,
      );
      const latest = await this.repos.outlineRepo.getDocumentTaskById(principal.workspaceId, nodeId);
      return {
        node: res.node,
        ...(latest ? { task: latest.task } : {}),
        ...(res.spawnedNextNode ? { spawnedNextNode: res.spawnedNextNode } : {}),
        ...(res.deletedSpawnedNodeId
          ? { deletedSpawnedNodeId: res.deletedSpawnedNodeId }
          : {}),
      };
    }

    const doc = await this.documentService.getDocument(principal, indexed.task.docId);
    const nextCompleted = input.checked ?? input.completed;
    const nextTitle = input.title ?? input.contentMarkdown;
    let nextScheduledStartMin = input.scheduledStartMin;
    if (nextScheduledStartMin === undefined) {
      if (input.scheduledDate === null) {
        nextScheduledStartMin = null;
      } else if (input.scheduledSlot !== undefined) {
        nextScheduledStartMin = input.scheduledSlot
          ? defaultStartMinForSlot(input.scheduledSlot)
          : null;
      }
    }

    const patched = updateMarkdownTaskLine(
      doc.contentMarkdown,
      {
        blockKey: indexed.task.blockKey,
        lineIndex: indexed.task.lineIndex,
        title: indexed.task.title,
      },
      {
        ...(nextTitle !== undefined ? { title: nextTitle } : {}),
        ...(nextCompleted !== undefined ? { completed: nextCompleted } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.scheduledDate !== undefined ? { scheduledDate: input.scheduledDate } : {}),
        ...(nextScheduledStartMin !== undefined
          ? { scheduledStartMin: nextScheduledStartMin }
          : {}),
        ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.recurrenceRule !== undefined ? { recurrenceRule: input.recurrenceRule } : {}),
      },
    );

    if (!patched) {
      throw new InkadeError(
        "CONFLICT",
        `Markdown task line "${indexed.task.title}" was modified or removed in source document`,
      );
    }

    let finalMarkdown = patched.markdown;
    if (nextCompleted === true && !indexed.task.completed && patched.updatedTask.recurrenceRule) {
      const nextDate = computeNextRecurrenceDate(
        patched.updatedTask.scheduledDate ?? todayLocalDateString(),
        patched.updatedTask.recurrenceRule,
      );
      finalMarkdown = appendMarkdownTaskLine(finalMarkdown, {
        title: patched.updatedTask.bodyMarkdown,
        completed: false,
        priority: patched.updatedTask.priority,
        scheduledDate: nextDate,
        scheduledStartMin: patched.updatedTask.scheduledStartMin,
        durationMin: patched.updatedTask.durationMin,
        dueDate: null,
        recurrenceRule: patched.updatedTask.recurrenceRule,
      }).markdown;
    }

    const updatedDoc = await this.documentService.updateDocument(principal, doc.id, {
      contentMarkdown: finalMarkdown,
      expectedVersion: doc.version,
      changeSummary: "Updated task via task board",
    });

    const refreshedRows = await this.repos.outlineRepo.listDocumentTasks(principal.workspaceId, {
      sourceEngine: "markdown",
    });
    const refreshed =
      refreshedRows.find(
        (r) =>
          r.task.docId === doc.id &&
          (r.task.id === indexed.task.id || r.task.blockKey === patched.updatedTask.blockKey),
      ) ?? null;

    const finalTask = refreshed?.task ?? {
      ...indexed.task,
      title: patched.updatedTask.title,
      completed: patched.updatedTask.completed,
      priority: patched.updatedTask.priority,
      scheduledDate: patched.updatedTask.scheduledDate,
      scheduledStartMin: patched.updatedTask.scheduledStartMin,
      durationMin: patched.updatedTask.durationMin,
      dueDate: patched.updatedTask.dueDate,
      recurrenceRule: patched.updatedTask.recurrenceRule,
      lineIndex: patched.updatedTask.lineIndex,
      blockKey: patched.updatedTask.blockKey,
      updatedAt: updatedDoc.updatedAt,
    };

    return {
      node: toMarkdownOutlineNode(finalTask),
      document: updatedDoc,
      task: finalTask,
    };
  }

  async rescheduleTask(
    principal: Principal,
    input: RescheduleTaskInput,
  ): Promise<TaskMutationResult> {
    return this.updateTask(principal, input.nodeId, {
      scheduledDate: input.scheduledDate,
      ...(input.scheduledSlot !== undefined ? { scheduledSlot: input.scheduledSlot } : {}),
      ...(input.scheduledStartMin !== undefined
        ? { scheduledStartMin: input.scheduledStartMin }
        : {}),
      ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
    });
  }

  async batchUpdateTasks(
    principal: Principal,
    input: BatchUpdateTasksInput,
  ): Promise<{ readonly updated: readonly OutlineNode[]; readonly spawned: readonly OutlineNode[] }> {
    const uniqueIds = [...new Set(input.nodeIds)];
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );

    const outlineIds: OutlineNodeId[] = [];
    const markdownTasks: { readonly task: DocumentTaskRecord; readonly docId: DocumentId }[] = [];
    const verifiedDocs = new Set<DocumentId>();

    for (const id of uniqueIds) {
      const indexed = await this.repos.outlineRepo.getDocumentTaskById(principal.workspaceId, id);
      if (indexed && indexed.task.sourceEngine === "markdown") {
        if (!verifiedDocs.has(indexed.task.docId)) {
          const doc = await this.documentService.getDocument(principal, indexed.task.docId);
          assertScope(
            principal.scope,
            "write",
            { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
            allSpaces,
          );
          verifiedDocs.add(doc.id);
        }
        markdownTasks.push({ task: indexed.task, docId: indexed.task.docId });
      } else if (isPrefixedId("nod", id)) {
        const docId = await resolveOutlineNodeDocumentId(
          this.repos.outlineRepo,
          principal.workspaceId,
          id,
        );
        if (!verifiedDocs.has(docId)) {
          const doc = await this.documentService.getDocument(principal, docId);
          assertScope(
            principal.scope,
            "write",
            { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
            allSpaces,
          );
          verifiedDocs.add(docId);
        }
        outlineIds.push(id);
      } else {
        throw new InkadeError("NOT_FOUND", `Task "${id}" not found`);
      }
    }

    const updated: OutlineNode[] = [];
    const spawned: OutlineNode[] = [];

    if (outlineIds.length > 0) {
      const outlineResult = await this.outlineService.batchUpdateTasks(principal, {
        ...input,
        nodeIds: outlineIds,
      });
      updated.push(...outlineResult.updated);
      spawned.push(...outlineResult.spawned);
    }

    for (const mdItem of markdownTasks) {
      const res = await this.updateTask(principal, mdItem.task.id, {
        ...(input.checked !== undefined ? { checked: input.checked } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.scheduledDate !== undefined ? { scheduledDate: input.scheduledDate } : {}),
        ...(input.scheduledSlot !== undefined ? { scheduledSlot: input.scheduledSlot } : {}),
        ...(input.scheduledStartMin !== undefined
          ? { scheduledStartMin: input.scheduledStartMin }
          : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
        ...(input.recurrenceRule !== undefined ? { recurrenceRule: input.recurrenceRule } : {}),
      });
      updated.push(res.node);
    }

    return { updated, spawned };
  }

  async upsertTask(
    principal: Principal,
    input: {
      readonly taskId?: TaskTargetId | undefined;
      readonly documentId?: DocumentId | undefined;
      readonly spaceId?: CreateTaskInput["spaceId"];
      readonly title?: string | undefined;
      readonly noteMarkdown?: string | undefined;
      readonly checked?: boolean | undefined;
      readonly priority?: CreateTaskInput["priority"];
      readonly scheduledDate?: string | null | undefined;
      readonly scheduledStartMin?: number | null | undefined;
      readonly scheduledSlot?: CreateTaskInput["scheduledSlot"];
      readonly dueDate?: string | null | undefined;
      readonly durationMin?: number | null | undefined;
      readonly recurrenceRule?: CreateTaskInput["recurrenceRule"];
    },
  ): Promise<WorkspaceTaskItem | TaskMutationResult> {
    if (input.taskId) {
      return this.updateTask(principal, input.taskId, {
        title: input.title,
        noteMarkdown: input.noteMarkdown,
        checked: input.checked,
        priority: input.priority,
        scheduledDate: input.scheduledDate,
        scheduledStartMin: input.scheduledStartMin,
        scheduledSlot: input.scheduledSlot,
        dueDate: input.dueDate,
        durationMin: input.durationMin,
        recurrenceRule: input.recurrenceRule,
      });
    }
    if (!input.title) {
      throw new InkadeError("VALIDATION_ERROR", "title is required when creating a task");
    }
    const created = await this.createTask(principal, {
      title: input.title,
      documentId: input.documentId,
      spaceId: input.spaceId,
      noteMarkdown: input.noteMarkdown,
      priority: input.priority,
      scheduledDate: input.scheduledDate,
      scheduledStartMin: input.scheduledStartMin,
      scheduledSlot: input.scheduledSlot,
      dueDate: input.dueDate,
      durationMin: input.durationMin,
      recurrenceRule: input.recurrenceRule,
      parseQuickSyntax: false,
    });
    if (input.checked === true) {
      return this.updateTask(principal, created.node.id, { checked: true });
    }
    return created;
  }
}
