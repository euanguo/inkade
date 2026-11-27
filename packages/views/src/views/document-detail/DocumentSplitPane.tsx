import type React from "react";
import { WorkspaceSplitPane } from "../../components/WorkspaceSplitPane.tsx";
import type { DocumentDetailState } from "./useDocumentDetailState.ts";

export function DocumentSplitPane({
  state,
}: {
  readonly state: DocumentDetailState;
}): React.ReactElement | null {
  const {
    hostActions,
    navigation,
    doc,
    isSplitOpen,
    isViewingTodayDaily,
    splitMode,
    setSplitMode,
    splitDocId,
    setSplitDocId,
    onExternalSplitClear,
  } = state;

  if (!doc || !isSplitOpen || hostActions.workspaceSplitManaged || splitMode === "closed") {
    return null;
  }

  return (
    <WorkspaceSplitPane
      isPrimaryDailyToday={isViewingTodayDaily}
      onChangeSplitDocId={(nextId) => setSplitDocId(nextId)}
      onChangeSplitMode={(nextMode) => setSplitMode(nextMode)}
      onClose={() => {
        setSplitMode("closed");
        onExternalSplitClear?.();
      }}
      onSwapPrimary={(targetDocId) => {
        hostActions.requestOpenSplitDoc?.(doc.id);
        navigation.openDocument(targetDocId);
      }}
      primaryDocumentId={doc.id}
      splitDocId={splitDocId}
      splitMode={splitMode}
    />
  );
}
