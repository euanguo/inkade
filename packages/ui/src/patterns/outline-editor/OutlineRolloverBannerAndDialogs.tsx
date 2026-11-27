"use client";

import type { OutlineNode, OutlineNodeId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import type React from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../primitives/alert-dialog.tsx";
import { Button } from "../../primitives/button.tsx";
import { Checkbox } from "../../primitives/checkbox.tsx";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../primitives/dialog.tsx";
import type { PendingDeleteGuard } from "./types.ts";

export interface OutlineRolloverBannerProps {
  readonly rolloverCount: number;
  readonly onRolloverAll?: (() => void) | undefined;
  readonly onOpenSelectDialog?: (() => void) | undefined;
  readonly onDismissRollover?: (() => void) | undefined;
}

export function OutlineRolloverBanner({
  rolloverCount,
  onRolloverAll,
  onOpenSelectDialog,
  onDismissRollover,
}: OutlineRolloverBannerProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  if (rolloverCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/75 bg-muted/35 px-3 py-1.5 text-xs">
      <span className="text-foreground/90">
        {t("outline.rolloverBanner", { count: rolloverCount })}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {onRolloverAll && (
          <Button onClick={onRolloverAll} size="xs" variant="default">
            {t("outline.rolloverAll")}
          </Button>
        )}
        {onOpenSelectDialog && (
          <Button onClick={onOpenSelectDialog} size="xs" variant="outline">
            {t("outline.rolloverSelect")}
          </Button>
        )}
        {onDismissRollover && (
          <Button onClick={onDismissRollover} size="xs" variant="ghost">
            {t("outline.rolloverDismiss")}
          </Button>
        )}
      </div>
    </div>
  );
}

export interface OutlineRolloverAndDeleteDialogsProps {
  readonly deleteGuard: PendingDeleteGuard | null;
  readonly onCloseDeleteGuard: () => void;
  readonly onConfirmProtectedDelete: () => void;
  readonly rolloverDialogOpen: boolean;
  readonly onRolloverDialogOpenChange: (open: boolean) => void;
  readonly rolloverTodos: readonly OutlineNode[];
  readonly rolloverSelection: ReadonlySet<OutlineNodeId>;
  readonly onToggleRolloverItem: (id: OutlineNodeId, checked: boolean) => void;
  readonly onConfirmRolloverSelected: () => void;
}

export function OutlineRolloverAndDeleteDialogs({
  deleteGuard,
  onCloseDeleteGuard,
  onConfirmProtectedDelete,
  rolloverDialogOpen,
  onRolloverDialogOpenChange,
  rolloverTodos,
  rolloverSelection,
  onToggleRolloverItem,
  onConfirmRolloverSelected,
}: OutlineRolloverAndDeleteDialogsProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) onCloseDeleteGuard();
        }}
        open={Boolean(deleteGuard)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("outline.deleteProtectedTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("outline.deleteProtectedDescription", {
                count: deleteGuard?.bindingCount ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common.cancel")}
            </AlertDialogClose>
            <Button onClick={onConfirmProtectedDelete} variant="destructive">
              {t("outline.deleteAnyway")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <Dialog onOpenChange={onRolloverDialogOpenChange} open={rolloverDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("outline.rolloverDialogTitle")}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-2">
              {rolloverTodos.map((todo) => {
                const checked = rolloverSelection.has(todo.id);
                return (
                  <label
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50"
                    key={todo.id}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => onToggleRolloverItem(todo.id, Boolean(next))}
                    />
                    <span className="leading-snug">{todo.contentText || todo.contentMarkdown}</span>
                  </label>
                );
              })}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button onClick={() => onRolloverDialogOpenChange(false)} variant="outline">
              {t("common.cancel")}
            </Button>
            <Button disabled={rolloverSelection.size === 0} onClick={onConfirmRolloverSelected}>
              {t("outline.rolloverConfirm", { count: rolloverSelection.size })}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
