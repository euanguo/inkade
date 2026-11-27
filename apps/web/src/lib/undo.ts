import { t } from "@inkade/i18n";
import { toastManager } from "@inkade/ui";

export function showUndoToast(options: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly onUndo: () => Promise<void> | void;
}): string {
  let toastId = "";
  toastId = toastManager.add({
    title: options.title,
    ...(options.description ? { description: options.description } : {}),
    type: "info",
    timeout: 5000,
    actionProps: {
      children: t("common.undo"),
      onClick: () => {
        if (toastId) {
          toastManager.close(toastId);
        }
        void Promise.resolve(options.onUndo()).catch((err: unknown) => {
          toastManager.add({
            title: t("common.undoFailed"),
            description: err instanceof Error ? err.message : t("common.pleaseRetry"),
            type: "error",
            timeout: 4000,
          });
        });
      },
    },
  });
  return toastId;
}

export function showErrorToast(title: string, error?: unknown): void {
  toastManager.add({
    title,
    description: error instanceof Error ? error.message : typeof error === "string" ? error : undefined,
    type: "error",
    timeout: 5000,
  });
}

export function showSuccessToast(title: string, description?: string): void {
  toastManager.add({
    title,
    ...(description ? { description } : {}),
    type: "success",
    timeout: 3000,
  });
}
