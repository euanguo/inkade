import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeAttachments,
  useInkadeStorageBuckets,
  useInkadeWorkspaceSummary,
} from "@inkade/sdk/react";
import {
  Badge,
  BucketMeter,
  type BucketMeterSegment,
  CopyButton,
  HoldConfirmButton,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TagPill,
} from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type React from "react";
import { useMemo, useState } from "react";
import { getInkadeClient } from "../../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import { SettingsTableSkeleton } from "./SettingsSkeletons.tsx";
import {
  DangerZone,
  SettingRow,
  SettingsGroup,
  SettingsSectionHeader,
} from "./SettingRow.tsx";
import { formatByteSize } from "./types.ts";

export function StorageSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const queryClient = useQueryClient();
  const [filterMode, setFilterMode] = useState<"all" | "orphans">("all");

  const attachmentsQuery = useInkadeAttachments();

  const orphansQuery = useInkadeAttachments({ orphanOnly: true });

  const summaryQuery = useInkadeWorkspaceSummary();

  const bucketsQuery = useInkadeStorageBuckets();

  const allAttachments = useMemo(
    () => attachmentsQuery.data ?? [],
    [attachmentsQuery.data],
  );
  const orphanAttachments = useMemo(
    () => orphansQuery.data ?? allAttachments.filter((a) => a.documentId === null),
    [orphansQuery.data, allAttachments],
  );
  const orphanIdSet = useMemo(
    () => new Set(orphanAttachments.map((a) => a.id)),
    [orphanAttachments],
  );

  const totalBytes = useMemo(
    () => allAttachments.reduce((sum, item) => sum + item.byteSize, 0),
    [allAttachments],
  );
  const orphanBytes = useMemo(
    () => orphanAttachments.reduce((sum, item) => sum + item.byteSize, 0),
    [orphanAttachments],
  );

  const visibleAttachments =
    filterMode === "orphans" ? orphanAttachments : allAttachments;

  const cleanupMutation = useMutation({
    mutationFn: () => getInkadeClient().attachments.cleanupOrphans(),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "attachments"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.storageBuckets() });
      showSuccessToast(
        t("settings.cleanupOrphansSuccess", {
          count: res.deletedCount,
          size: formatByteSize(res.freedBytes),
        }),
      );
    },
    onError: (err) => showErrorToast(t("settings.cleanupOrphansFailed"), err),
  });

  const bucketSegments: readonly BucketMeterSegment[] = useMemo(() => {
    const data = bucketsQuery.data;
    if (!data) return [];
    const byKey = new Map(data.buckets.map((bucket) => [bucket.key, bucket]));
    return [
      {
        id: "articles",
        label: t("settings.bucketArticles"),
        value: byKey.get("articles")?.bytes ?? 0,
        tone: "primary",
      },
      {
        id: "outlines",
        label: t("settings.bucketOutlines"),
        value: byKey.get("outlines")?.bytes ?? 0,
        tone: "info",
      },
      {
        id: "clips",
        label: t("settings.bucketClips"),
        value: byKey.get("clips")?.bytes ?? 0,
        tone: "teal",
      },
      {
        id: "attachments",
        label: t("settings.bucketAttachments"),
        value: byKey.get("attachments")?.bytes ?? 0,
        tone: "warning",
      },
    ];
  }, [bucketsQuery.data, t]);

  const storageDiagnosticsText = useMemo(
    () =>
      JSON.stringify(
        {
          totalAttachments: allAttachments.length,
          orphanAttachments: orphanAttachments.length,
          attachmentBytes: totalBytes,
          buckets: bucketsQuery.data ?? null,
        },
        null,
        2,
      ),
    [allAttachments.length, bucketsQuery.data, orphanAttachments.length, totalBytes],
  );

  const tags = summaryQuery.data?.tags ?? [];

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        actions={
          <CopyButton
            copiedLabel={t("settings.diagnosticsCopied")}
            label={t("settings.copyDiagnostics")}
            showLabel
            size="sm"
            value={storageDiagnosticsText}
            variant="outline"
          />
        }
        description={t("settings.storageDesc")}
        title={t("settings.storageTitle")}
      />

      {bucketsQuery.data ? (
        <SettingsGroup title={t("settings.storageQuotaCardTitle")}>
          <div className="flex flex-col gap-3 px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {t("settings.storageQuotaCardDesc")}
              </p>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {t("common.capacityUsed", {
                  used: formatByteSize(bucketsQuery.data.totalUsedBytes),
                  total: formatByteSize(bucketsQuery.data.quotaLimitBytes),
                })}
              </span>
            </div>
            <BucketMeter
              ariaLabel={t("settings.bucketMeterAria")}
              capacity={bucketsQuery.data.quotaLimitBytes}
              formatValue={(bytes) => formatByteSize(bytes)}
              highWatermarkRatio={0.85}
              scaleMode="auto"
              segments={bucketSegments}
            />
          </div>
        </SettingsGroup>
      ) : null}

      {/* Tags Overview */}
      <SettingsGroup title={t("settings.tagsOverviewTitle", { count: tags.length })}>
        <div className="px-4 py-3.5 sm:px-5">
          {summaryQuery.isPending ? (
            <div aria-busy="true" className="flex flex-wrap gap-1.5">
              {["w-14", "w-20", "w-16", "w-24", "w-12", "w-18", "w-14", "w-20"].map((wClass, idx) => (
                <Skeleton className={`h-5 rounded-full ${wClass}`} key={idx} />
              ))}
            </div>
          ) : tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("settings.tagsOverviewEmpty")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.slice(0, 40).map((entry) => (
                <Link
                  key={entry.tag}
                  search={{ tag: entry.tag }}
                  to="/library"
                >
                  <TagPill count={entry.count} tag={entry.tag} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </SettingsGroup>

      {/* Attachments Summary Stats */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("settings.attachmentsSummaryTitle")}
          </h2>
          <SegmentedControl size="sm">
            <SegmentedControlItem
              data-pressed={filterMode === "all" ? "" : undefined}
              onClick={() => setFilterMode("all")}
            >
              {t("settings.attachmentsFilterAll", { count: allAttachments.length })}
            </SegmentedControlItem>
            <SegmentedControlItem
              data-pressed={filterMode === "orphans" ? "" : undefined}
              onClick={() => setFilterMode("orphans")}
            >
              {t("settings.attachmentsFilterOrphans", { count: orphanAttachments.length })}
            </SegmentedControlItem>
          </SegmentedControl>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">{t("settings.totalAttachmentsStat")}</div>
            <div className="mt-1 font-heading text-xl font-semibold tabular-nums">
              {allAttachments.length}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">{t("settings.totalStorageStat")}</div>
            <div className="mt-1 font-heading text-xl font-semibold tabular-nums">
              {formatByteSize(totalBytes)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">{t("settings.orphanAttachmentsStat")}</div>
            <div className="mt-1 font-heading text-xl font-semibold tabular-nums">
              {orphanAttachments.length}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ({formatByteSize(orphanBytes)})
              </span>
            </div>
          </div>
        </div>

        {attachmentsQuery.isPending ? (
          <SettingsTableSkeleton columns={5} rows={4} />
        ) : visibleAttachments.length === 0 ? (
          <div className="rounded-xl border border-dashed py-10 text-center text-xs text-muted-foreground">
            {filterMode === "orphans"
              ? t("settings.noOrphanAttachments")
              : t("settings.noAttachments")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.attachmentColFile")}</TableHead>
                  <TableHead>{t("settings.attachmentColType")}</TableHead>
                  <TableHead>{t("settings.attachmentColSize")}</TableHead>
                  <TableHead>{t("settings.attachmentColStatus")}</TableHead>
                  <TableHead>{t("settings.attachmentColCreated")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleAttachments.map((att) => {
                  const isOrphan = att.documentId === null || orphanIdSet.has(att.id);
                  return (
                    <TableRow key={att.id}>
                      <TableCell className="max-w-52 truncate font-medium">
                        {att.filename}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {att.mimeType}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {formatByteSize(att.byteSize)}
                      </TableCell>
                      <TableCell>
                        {isOrphan ? (
                          <Badge size="sm" variant="warning">
                            {t("settings.attachmentOrphanBadge")}
                          </Badge>
                        ) : (
                          <Link
                            params={{ docId: att.documentId ?? "" }}
                            to="/docs/$docId"
                          >
                            <Badge size="sm" variant="secondary">
                              {t("settings.attachmentLinkedBadge")}
                            </Badge>
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {att.createdAt.slice(0, 10)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <DangerZone>
        <SettingRow
          description={t("settings.cleanupOrphansDesc", {
            count: orphanAttachments.length,
            size: formatByteSize(orphanBytes),
          })}
          title={t("settings.cleanupOrphansTitle")}
        >
          <HoldConfirmButton
            disabled={orphanAttachments.length === 0 || cleanupMutation.isPending}
            holdingLabel={t("settings.holdingToCleanup")}
            onConfirm={() => cleanupMutation.mutate()}
            size="sm"
          >
            {t("settings.holdToCleanupOrphans")}
          </HoldConfirmButton>
        </SettingRow>
      </DangerZone>
    </div>
  );
}
