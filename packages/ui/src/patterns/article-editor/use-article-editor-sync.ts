import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDebounceCallback, type DebouncedState } from "usehooks-ts";
import type * as Y from "yjs";
import { sanitizeSerializedMarkdown } from "../../editor/markdown-utils.ts";
import type { AdeInlineActionSelection } from "../../editor/menus/AdeInlineActionMenu.tsx";
import type { TriggerMatch } from "../../editor/types.ts";

export interface UseArticleEditorSyncOptions {
  readonly docId: string;
  readonly docVersion: number;
  readonly incomingMarkdown: string;
  readonly serverSyncToken: string | number | undefined;
  readonly hasVersionConflict: boolean;
  readonly isDirty: boolean;
  readonly readOnly: boolean;
  readonly mode: "rich" | "source";
  readonly sourceDraft: string;
  readonly setSourceDraft: (next: string) => void;
  readonly yjsFragment: Y.XmlFragment | null;
  readonly editor: Editor | null;
  readonly onChangeMarkdown?: ((markdown: string) => void) | undefined;
  readonly onUploadFile?: ((file: File) => Promise<{ readonly url: string; readonly filename: string }>) | undefined;
  readonly onChangeMarkdownRef: React.RefObject<((markdown: string) => void) | undefined>;
  readonly lastEmittedMarkdownRef: React.RefObject<string>;
  readonly debouncedEmitRef: React.RefObject<DebouncedState<(activeEditor: Editor) => void> | null>;
  readonly fileInsertRef: React.RefObject<(files: File[], pos?: number) => void>;
  readonly triggerMatchRef: React.RefObject<TriggerMatch | null>;
  readonly setTriggerMatch: (next: TriggerMatch | null) => void;
  readonly setAiSelectionRange: (next: AdeInlineActionSelection | null) => void;
}

export function useArticleEditorSync({
  docId,
  docVersion,
  incomingMarkdown,
  serverSyncToken,
  hasVersionConflict,
  isDirty,
  readOnly,
  mode,
  sourceDraft,
  setSourceDraft,
  yjsFragment,
  editor,
  onChangeMarkdown,
  onUploadFile,
  onChangeMarkdownRef,
  lastEmittedMarkdownRef,
  debouncedEmitRef,
  fileInsertRef,
  triggerMatchRef,
  setTriggerMatch,
  setAiSelectionRange,
}: UseArticleEditorSyncOptions) {
  const [uploading, setUploading] = useState(false);

  const lastDocIdRef = useRef<string>(docId);
  const lastVersionRef = useRef<number>(docVersion);
  const lastSyncedServerTokenRef = useRef<string | number | undefined>(serverSyncToken);
  const lastSyncedServerMarkdownRef = useRef<string>(incomingMarkdown);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const handleDebouncedEmit = useCallback(
    (activeEditor: Editor) => {
      if (activeEditor.isDestroyed) return;
      const md = sanitizeSerializedMarkdown(activeEditor.getMarkdown());
      if (md !== lastEmittedMarkdownRef.current) {
        lastEmittedMarkdownRef.current = md;
        onChangeMarkdownRef.current?.(md);
      }
    },
    [lastEmittedMarkdownRef, onChangeMarkdownRef],
  );

  const debouncedEmit = useDebounceCallback(handleDebouncedEmit, 260);
  debouncedEmitRef.current = debouncedEmit;

  const flushMarkdown = useCallback((): string => {
    debouncedEmit.cancel();
    if (mode === "source") {
      lastEmittedMarkdownRef.current = sourceDraft;
      return sourceDraft;
    }
    if (!editor) return lastEmittedMarkdownRef.current;
    const md = sanitizeSerializedMarkdown(editor.getMarkdown());
    if (md !== lastEmittedMarkdownRef.current) {
      lastEmittedMarkdownRef.current = md;
      setSourceDraft(md);
      onChangeMarkdownRef.current?.(md);
    }
    return md;
  }, [debouncedEmit, editor, lastEmittedMarkdownRef, mode, onChangeMarkdownRef, setSourceDraft, sourceDraft]);

  const handleFileInsert = useCallback(
    async (file: File, pos?: number): Promise<void> => {
      if (!editor || editor.isDestroyed || readOnlyRef.current) return;
      setUploading(true);
      try {
        if (onUploadFile) {
          const uploaded = await onUploadFile(file);
          if (!editor || editor.isDestroyed || readOnlyRef.current) return;
          const isImage = file.type.startsWith("image/");
          const clampedPos =
            typeof pos === "number"
              ? Math.min(Math.max(0, pos), editor.state.doc.content.size)
              : undefined;
          if (isImage) {
            const chain = editor.chain().focus();
            if (typeof clampedPos === "number") {
              chain.insertContentAt(clampedPos, {
                type: "image",
                attrs: { src: uploaded.url, alt: uploaded.filename },
              });
            } else {
              chain.setImage({ src: uploaded.url, alt: uploaded.filename });
            }
            chain.run();
          } else {
            const snippet = `[${uploaded.filename}](${uploaded.url})`;
            const chain = editor.chain().focus();
            if (typeof clampedPos === "number") {
              chain.insertContentAt(clampedPos, snippet, { contentType: "markdown" }).run();
            } else {
              chain.insertContent(snippet, { contentType: "markdown" }).run();
            }
          }
        } else if (file.type.startsWith("image/")) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
            reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
            reader.readAsDataURL(file);
          });
          if (!editor || editor.isDestroyed || readOnlyRef.current || !dataUrl) return;
          if (typeof pos === "number") {
            const clampedPos = Math.min(Math.max(0, pos), editor.state.doc.content.size);
            editor
              .chain()
              .focus()
              .insertContentAt(clampedPos, {
                type: "image",
                attrs: { src: dataUrl, alt: file.name },
              })
              .run();
          } else {
            editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
          }
        }
      } catch {
        // Upload failure is surfaced by host upload handler if provided
      } finally {
        setUploading(false);
      }
    },
    [editor, onUploadFile],
  );

  fileInsertRef.current = (files, pos) => {
    if (files.length === 0 || readOnlyRef.current) return;
    void (async () => {
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        if (!f) continue;
        await handleFileInsert(f, i === 0 ? pos : undefined);
      }
    })();
  };

  // Sync document switches & external server updates WITHOUT jumping cursor on own autosave
  useEffect(() => {
    const switchedDoc = lastDocIdRef.current !== docId;
    const versionChanged = lastVersionRef.current !== docVersion;
    const syncTokenChanged =
      serverSyncToken !== undefined && lastSyncedServerTokenRef.current !== serverSyncToken;
    const contentChangedExternally = incomingMarkdown !== lastSyncedServerMarkdownRef.current;

    if (!switchedDoc && !versionChanged && !syncTokenChanged && !contentChangedExternally) {
      return;
    }

    lastDocIdRef.current = docId;
    lastVersionRef.current = docVersion;
    lastSyncedServerTokenRef.current = serverSyncToken;

    if (yjsFragment && yjsFragment.length > 0) return;

    if (switchedDoc) {
      debouncedEmit.cancel();
      lastEmittedMarkdownRef.current = incomingMarkdown;
      lastSyncedServerMarkdownRef.current = incomingMarkdown;
      setSourceDraft(incomingMarkdown);
      triggerMatchRef.current = null;
      setTriggerMatch(null);
      setAiSelectionRange(null);
      if (editor && !editor.isDestroyed) {
        editor.commands.setContent(incomingMarkdown, {
          contentType: "markdown",
          emitUpdate: false,
        });
      }
      return;
    }

    if (hasVersionConflict || isDirtyRef.current || debouncedEmit.isPending()) return;
    if (incomingMarkdown === lastEmittedMarkdownRef.current) {
      lastSyncedServerMarkdownRef.current = incomingMarkdown;
      return;
    }

    if (editor && !editor.isDestroyed) {
      const liveMd = sanitizeSerializedMarkdown(editor.getMarkdown());
      if (liveMd === incomingMarkdown) {
        lastEmittedMarkdownRef.current = incomingMarkdown;
        lastSyncedServerMarkdownRef.current = incomingMarkdown;
        return;
      }
      if (
        liveMd !== lastEmittedMarkdownRef.current &&
        liveMd !== lastSyncedServerMarkdownRef.current
      ) {
        return;
      }
      lastEmittedMarkdownRef.current = incomingMarkdown;
      lastSyncedServerMarkdownRef.current = incomingMarkdown;
      setSourceDraft(incomingMarkdown);
      editor.commands.setContent(incomingMarkdown, {
        contentType: "markdown",
        emitUpdate: false,
      });
    } else {
      lastEmittedMarkdownRef.current = incomingMarkdown;
      lastSyncedServerMarkdownRef.current = incomingMarkdown;
      setSourceDraft(incomingMarkdown);
    }
  }, [
    debouncedEmit,
    docId,
    docVersion,
    editor,
    hasVersionConflict,
    incomingMarkdown,
    lastEmittedMarkdownRef,
    serverSyncToken,
    setAiSelectionRange,
    setSourceDraft,
    setTriggerMatch,
    triggerMatchRef,
    yjsFragment,
  ]);

  const handleSourceChange = useCallback(
    (next: string): void => {
      setSourceDraft(next);
      lastEmittedMarkdownRef.current = next;
      onChangeMarkdown?.(next);
    },
    [lastEmittedMarkdownRef, onChangeMarkdown, setSourceDraft],
  );

  return {
    uploading,
    debouncedEmit,
    flushMarkdown,
    handleFileInsert,
    handleSourceChange,
  };
}
