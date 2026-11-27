import { asDocumentId } from "@inkade/core";
import { YjsDocumentSyncClient, type YjsSyncConnectionStatus } from "@inkade/sdk/sync";
import type { Command, Plugin } from "@tiptap/pm/state";
import { Extension } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  prosemirrorToYXmlFragment,
  redo as yProseMirrorRedo,
  redoCommand as yProseMirrorRedoCommand,
  undo as yProseMirrorUndo,
  undoCommand as yProseMirrorUndoCommand,
  ySyncPlugin,
  ySyncPluginKey,
  yUndoPlugin,
  yUndoPluginKey,
} from "y-prosemirror";
import * as Y from "yjs";

export type InkadeYjsSyncStatus = YjsSyncConnectionStatus;

export interface UseInkadeYjsSyncOptions {
  readonly docId: string;
  readonly ydoc?: Y.Doc | undefined;
  readonly baseUrl?: string | undefined;
  readonly token?: string | undefined;
  readonly enableIndexedDb?: boolean | undefined;
  readonly autoConnect?: boolean | undefined;
}

export interface UseInkadeYjsSyncResult {
  readonly ydoc: Y.Doc;
  readonly status: InkadeYjsSyncStatus;
  readonly synced: boolean;
  readonly error: string | null;
  readonly connect: () => void;
  readonly disconnect: () => void;
}

export {
  prosemirrorToYXmlFragment,
  ySyncPlugin,
  ySyncPluginKey,
  yUndoPlugin,
  yUndoPluginKey,
};

export const yjsUndoCommand: Command = (state, dispatch) => {
  if (!dispatch) {
    return yProseMirrorUndo(state);
  }
  return yProseMirrorUndoCommand(state, dispatch);
};

export const yjsRedoCommand: Command = (state, dispatch) => {
  if (!dispatch) {
    return yProseMirrorRedo(state);
  }
  return yProseMirrorRedoCommand(state, dispatch);
};

/**
 * Isolated `y-prosemirror` / `@tiptap/pm` Plugin type bridge: `y-prosemirror` bundles
 * `prosemirror-state` type definitions that differ structurally from `@tiptap/pm/state`'s `Plugin`.
 */
const createSyncPlugin = ySyncPlugin as (yXmlFragment: Y.XmlFragment) => Plugin;
const createUndoPlugin = yUndoPlugin as () => Plugin;

export function createInkadeYjsProseMirrorPlugins(fragment: Y.XmlFragment): Plugin[] {
  return [createSyncPlugin(fragment), createUndoPlugin()];
}

export interface InkadeYjsCollaborationOptions {
  readonly fragment: Y.XmlFragment | null;
}

export const InkadeYjsCollaborationExtension = Extension.create<InkadeYjsCollaborationOptions>({
  name: "inkadeYjsCollaboration",

  addOptions() {
    return {
      fragment: null,
    };
  },

  addProseMirrorPlugins() {
    if (!this.options.fragment) {
      return [];
    }
    return createInkadeYjsProseMirrorPlugins(this.options.fragment);
  },

  addKeyboardShortcuts() {
    return {
      "Mod-z": () => (this.options.fragment ? yProseMirrorUndo(this.editor.state) : false),
      "Mod-Shift-z": () =>
        this.options.fragment ? yProseMirrorRedo(this.editor.state) : false,
      "Mod-y": () => (this.options.fragment ? yProseMirrorRedo(this.editor.state) : false),
    };
  },
});

export function useInkadeYjsSync(options: UseInkadeYjsSyncOptions): UseInkadeYjsSyncResult {
  const {
    docId,
    ydoc: externalDoc,
    baseUrl,
    token,
    enableIndexedDb = true,
    autoConnect = true,
  } = options;

  const ydoc = useMemo(
    () => externalDoc ?? new Y.Doc({ meta: { docId } }),
    [externalDoc, docId],
  );
  const [status, setStatus] = useState<InkadeYjsSyncStatus>("disconnected");
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<YjsDocumentSyncClient | null>(null);

  const client = useMemo(
    () =>
      new YjsDocumentSyncClient({
        docId: asDocumentId(docId),
        ydoc,
        baseUrl,
        token,
        enableIndexedDb,
        onSync: () => setSynced(true),
        onError: (err) => setError(err.message),
      }),
    [baseUrl, docId, enableIndexedDb, token, ydoc],
  );
  clientRef.current = client;

  const disconnect = useCallback(() => {
    void clientRef.current?.disconnect();
  }, []);

  const connect = useCallback(() => {
    setError(null);
    void clientRef.current?.connect();
  }, []);

  useEffect(() => {
    setStatus(client.getStatus());
    setSynced(client.synced);
    const unsub = client.subscribeStatus(setStatus);

    if (autoConnect) {
      setError(null);
      void client.connect();
    }

    return () => {
      unsub();
      void client.disconnect();
      if (!externalDoc) {
        ydoc.destroy();
      }
    };
  }, [autoConnect, client, externalDoc, ydoc]);

  return {
    ydoc,
    status,
    synced,
    error,
    connect,
    disconnect,
  };
}
