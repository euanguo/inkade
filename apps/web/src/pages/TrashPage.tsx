import type { DocumentKind } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { isInkadeApiError } from "@inkade/sdk";
import {
  useDeleteDocumentMutation,
  useInkadeDocuments,
  useInkadeSpaces,
  useInkadeWhoami,
  useRestoreDocumentMutation,
} from "@inkade/sdk/react";
import { useUserPreferences } from "@inkade/views/lib/preferences-store";
import {
  Badge,
  Button,
  cn,
  DocumentKindIcon,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  HoldConfirmButton,
  Skeleton,
  SpaceIcon,
  TagPill,
} from "@inkade/ui";
import { LockIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";

export function TrashPage(): React.ReactElement {
  const { t } = useInkadeTranslation();

  const kindLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutline"),
    article: t("common.kindArticle"),
    clip: t("common.kindClip"),
  };

  const whoamiQuery = useInkadeWhoami();

  const spacesQuery = useInkadeSpaces({ includeArchived: true });

  const docsQuery = useInkadeDocuments({ includeTrashed: true, limit: 250 });

  const spaceById = useMemo(
    () => new Map((spacesQuery.data ?? []).map((s) => [s.id, s])),
    [spacesQuery.data],
  );

  const trashedDocs = useMemo(
    () =>
      (docsQuery.data ?? [])
        .filter((d) => d.trashedAt !== null)
        .sort((a, b) => (b.trashedAt ?? "").localeCompare(a.trashedAt ?? "")),
    [docsQuery.data],
  );

  const restoreMutation = useRestoreDocumentMutation({
    onSuccess: (restored) => {
      showSuccessToast(t("trash.restoredToast"), restored.title);
    },
    onError: (err) => showErrorToast(t("trash.restoreFailed"), err),
  });

  const hardDeleteMutationBase = useDeleteDocumentMutation({
    onSuccess: () => {
      showSuccessToast(t("trash.hardDeletedToast"));
    },
    onError: (err) => {
      if (isInkadeApiError(err) && err.status === 403) {
        showErrorToast(t("agentControl.hardDeleteBlockedError"), err);
        return;
      }
      showErrorToast(t("trash.hardDeleteFailed"), err);
    },
  });
  const hardDeleteMutation = {
    ...hardDeleteMutationBase,
    mutate: (documentId: import("@inkade/core").DocumentId) =>
      hardDeleteMutationBase.mutate({ documentId, hard: true }),
  };

  const canHardDelete = !(whoamiQuery.data?.effectiveSummary.denyHardDelete ?? true);
  const { preferences } = useUserPreferences();
  const canvasWidth = preferences.layout.workspaceCanvasWidth;

  return (
    <div className="flex w-full flex-col">
      <header className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background px-4 py-2.5 lg:px-6">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight">{t("trash.title")}</h1>
          <Badge className="tabular-nums" size="sm" variant="secondary">
            {trashedDocs.length}
          </Badge>
        </div>

        {!canHardDelete && (
          <Badge size="sm" variant="outline">
            <LockIcon className="size-3" />
            <span>{t("agentControl.hardDeleteBlockedPolicy")}</span>
          </Badge>
        )}
      </header>

      <div
        className={cn(
          "flex w-full flex-col gap-3.5 px-4 py-3.5 lg:px-6",
          canvasWidth === "centered" && "mx-auto max-w-[960px]",
        )}
      >

      {docsQuery.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          {["w-52", "w-44", "w-60"].map((titleW, idx) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3.5"
              key={idx}
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="size-4 shrink-0 rounded-sm" />
                  <Skeleton className={`h-4.5 max-w-full ${titleW}`} />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Skeleton className="h-5 w-20 rounded-md" />
                  <Skeleton className="h-4 w-14 rounded-full" />
                  <Skeleton className="h-3.5 w-32" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-7 w-16 rounded-md" />
                <Skeleton className="h-7 w-20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : trashedDocs.length === 0 ? (
        <Empty className="rounded-xl border border-dashed py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trash2Icon />
            </EmptyMedia>
            <EmptyTitle>{t("trash.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("trash.emptyDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {trashedDocs.map((doc) => {
            const space = spaceById.get(doc.spaceId);
            return (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-card-foreground transition-colors duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] hover:border-foreground/20"
                key={doc.id}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <DocumentKindIcon kind={doc.kind} />
                    <span className="truncate font-semibold">{doc.title}</span>
                    <Badge size="sm" variant="outline">
                      {kindLabels[doc.kind]}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {space && (
                      <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
                        <SpaceIcon color={space.color} icon={space.icon} size="xs" />
                        <span>{space.name}</span>
                      </span>
                    )}
                    {doc.tags.slice(0, 3).map((tag) => (
                      <TagPill key={tag} size="sm" tag={tag} />
                    ))}
                    {doc.trashedAt && (
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {t("trash.trashedAt", {
                          time: doc.trashedAt.slice(0, 19).replace("T", " "),
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    className="active:scale-[0.985] transition-[transform,colors] duration-[var(--duration-micro)] ease-[var(--ease-smooth-out)]"
                    loading={restoreMutation.isPending}
                    onClick={() => restoreMutation.mutate(doc.id)}
                    size="xs"
                    variant="outline"
                  >
                    <RotateCcwIcon />
                    {t("common.restore")}
                  </Button>
                  {canHardDelete ? (
                    <HoldConfirmButton
                      disabled={hardDeleteMutation.isPending}
                      holdDurationMs={1200}
                      holdingLabel={t("common.keepHolding")}
                      onConfirm={() => hardDeleteMutation.mutate(doc.id)}
                      size="sm"
                    >
                      <Trash2Icon className="size-3.5" />
                      <span>{t("trash.hardDelete")}</span>
                    </HoldConfirmButton>
                  ) : (
                    <Badge size="sm" variant="outline">
                      <LockIcon className="size-3" />
                      <span>{t("agentControl.scopeNoHardDelete")}</span>
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
