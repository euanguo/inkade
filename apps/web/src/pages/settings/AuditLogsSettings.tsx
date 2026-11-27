import {
  type ApiTokenId,
  asApiTokenId,
  AUDIT_DECISIONS,
  AUDIT_TRANSPORTS,
  type AuditDecision,
  type AuditLogId,
  type AuditLogRecord,
  type AuditTransport,
  computeLedgerCascade,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeAuditLogs,
  useInkadeDocuments,
  useInkadeTokens,
} from "@inkade/sdk/react";
import {
  AgentLedgerRow,
  type AgentLedgerCascadeStatus,
  Badge,
  Button,
  CopyButton,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@inkade/ui";
import {
  SettingsTableSkeleton,
  SettingsTimelineSkeleton,
} from "./SettingsSkeletons.tsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon, SearchIcon } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { getInkadeClient } from "../../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import { SettingsSectionHeader } from "./SettingRow.tsx";

export function AuditLogsSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<"timeline" | "table">("timeline");
  const [hoveredAuditId, setHoveredAuditId] = useState<AuditLogId | null>(null);
  const [transportFilter, setTransportFilter] = useState<"__all__" | AuditTransport>("__all__");
  const [decisionFilter, setDecisionFilter] = useState<"__all__" | AuditDecision>("__all__");
  const [tokenFilter, setTokenFilter] = useState<ApiTokenId | "__all__">("__all__");
  const [actionFilter, setActionFilter] = useState("");

  const tokensQuery = useInkadeTokens();

  const docsQuery = useInkadeDocuments({ limit: 300 });

  const filterParams = useMemo(
    () => ({
      ...(transportFilter !== "__all__" ? { transport: transportFilter } : {}),
      ...(decisionFilter !== "__all__" ? { decision: decisionFilter } : {}),
      ...(tokenFilter !== "__all__" ? { tokenId: tokenFilter } : {}),
      ...(actionFilter.trim() ? { action: actionFilter.trim() } : {}),
      limit: 100,
    }),
    [actionFilter, decisionFilter, tokenFilter, transportFilter],
  );

  const logsQuery = useInkadeAuditLogs(filterParams);

  const rollbackMutation = useMutation({
    mutationFn: (auditLogId: AuditLogId) => getInkadeClient().auditLogs.rollback(auditLogId),
    onSuccess: (result) => {
      setHoveredAuditId(null);
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-logs"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.storageBuckets() });
      showSuccessToast(
        t("settings.ledgerRollbackSuccessTitle", {
          rev: result.restoredRevisionId.slice(0, 8),
        }),
        t("settings.ledgerRollbackSuccessDesc", {
          count: result.affectedAuditIds.length,
        }),
      );
    },
    onError: (err) => showErrorToast(t("settings.ledgerRollbackFailedToast"), err),
  });

  const tokens = tokensQuery.data ?? [];
  const logs = useMemo(() => logsQuery.data ?? [], [logsQuery.data]);

  const docTitleById = useMemo(
    () => new Map((docsQuery.data ?? []).map((doc) => [doc.id, doc.title])),
    [docsQuery.data],
  );

  const cascadePreview = useMemo(
    () => (hoveredAuditId ? computeLedgerCascade(logs, hoveredAuditId) : null),
    [hoveredAuditId, logs],
  );

  const affectedCascadeIdSet = useMemo(
    () => new Set(cascadePreview?.affectedAuditIds ?? []),
    [cascadePreview],
  );

  const ledgerSummaryText = useMemo(
    () =>
      logs
        .slice(0, 20)
        .map(
          (entry) =>
            `${entry.createdAt} | ${entry.tokenName ?? entry.principalKind} | ${entry.action} | ${entry.resource} | ${entry.decision}`,
        )
        .join("\n"),
    [logs],
  );

  const decisionLabels: Readonly<Record<AuditDecision, string>> = {
    allowed: t("settings.decisionAllowed"),
    denied: t("settings.decisionDenied"),
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {logs.length > 0 ? (
              <CopyButton
                copiedLabel={t("settings.diagnosticsCopied")}
                label={t("settings.auditCopyLedger")}
                showLabel
                size="sm"
                value={ledgerSummaryText}
                variant="outline"
              />
            ) : null}
            <Button
              loading={logsQuery.isFetching}
              onClick={() => void logsQuery.refetch()}
              size="sm"
              variant="outline"
            >
              <RefreshCwIcon />
              {t("common.refresh")}
            </Button>
          </div>
        }
        description={t("settings.auditLogsDesc")}
        title={t("settings.auditLogsTitle")}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl size="sm">
          <SegmentedControlItem
            data-audit-view="timeline"
            data-pressed={viewMode === "timeline" ? "" : undefined}
            onClick={() => setViewMode("timeline")}
          >
            {t("settings.auditViewTimeline")}
          </SegmentedControlItem>
          <SegmentedControlItem
            data-audit-view="table"
            data-pressed={viewMode === "table" ? "" : undefined}
            onClick={() => setViewMode("table")}
          >
            {t("settings.auditViewTable")}
          </SegmentedControlItem>
        </SegmentedControl>

        {viewMode === "timeline" ? (
          <p className="text-xs text-muted-foreground">{t("settings.auditLedgerHint")}</p>
        ) : null}
      </div>

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_1fr_1fr_1.45fr]">
        <Select
          onValueChange={(val) =>
            setDecisionFilter((val as "__all__" | AuditDecision) ?? "__all__")
          }
          value={decisionFilter}
        >
          <SelectTrigger size="sm">
            <SelectValue>
              {decisionFilter === "__all__"
                ? `${t("settings.filterDecision")}: ${t("common.all")}`
                : decisionLabels[decisionFilter]}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="__all__">
              {t("settings.filterDecision")}: {t("common.all")}
            </SelectItem>
            {AUDIT_DECISIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {decisionLabels[d]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <Select
          onValueChange={(val) =>
            setTransportFilter((val as "__all__" | AuditTransport) ?? "__all__")
          }
          value={transportFilter}
        >
          <SelectTrigger size="sm">
            <SelectValue>
              {transportFilter === "__all__"
                ? `${t("settings.filterTransport")}: ${t("common.all")}`
                : transportFilter.toUpperCase()}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="__all__">
              {t("settings.filterTransport")}: {t("common.all")}
            </SelectItem>
            {AUDIT_TRANSPORTS.map((tr) => (
              <SelectItem key={tr} value={tr}>
                {tr.toUpperCase()}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <Select<ApiTokenId | "__all__">
          onValueChange={(val) =>
            setTokenFilter(!val || val === "__all__" ? "__all__" : asApiTokenId(val))
          }
          value={tokenFilter}
        >
          <SelectTrigger size="sm">
            <SelectValue>
              {tokenFilter === "__all__"
                ? `${t("settings.filterToken")}: ${t("common.all")}`
                : (tokens.find((tok) => tok.id === tokenFilter)?.name ?? tokenFilter)}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="__all__">
              {t("settings.filterToken")}: {t("common.all")}
            </SelectItem>
            {tokens.map((tok) => (
              <SelectItem key={tok.id} value={tok.id}>
                {tok.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <Input
          aria-label={t("settings.filterActionPlaceholder")}
          onChange={(e) => setActionFilter(e.target.value)}
          placeholder={t("settings.filterActionPlaceholder")}
          size="sm"
          startAddon={<SearchIcon />}
          value={actionFilter}
        />
      </div>

      {logsQuery.isPending ? (
        viewMode === "timeline" ? (
          <SettingsTimelineSkeleton rows={4} />
        ) : (
          <SettingsTableSkeleton columns={5} rows={5} />
        )
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-xs text-muted-foreground">
          {t("settings.noAuditLogs")}
        </div>
      ) : viewMode === "timeline" ? (
        <div
          className="overflow-hidden rounded-xl border border-border bg-card"
          data-slot="audit-ledger-timeline"
        >
          {logs.map((entry: AuditLogRecord) => {
            const cascadeStatus: AgentLedgerCascadeStatus =
              hoveredAuditId === entry.id
                ? "target"
                : affectedCascadeIdSet.has(entry.id)
                  ? "downstream_review"
                  : "none";
            const docLabel = entry.documentId ? docTitleById.get(entry.documentId) : undefined;
            const isThisRollbackPending =
              rollbackMutation.isPending && rollbackMutation.variables === entry.id;

            return (
              <AgentLedgerRow
                cascadeStatus={cascadeStatus}
                documentLabel={docLabel}
                entry={entry}
                key={entry.id}
                onHoverRollback={(id) => setHoveredAuditId(id)}
                onRollback={(targetEntry) => rollbackMutation.mutate(targetEntry.id)}
                rollingBack={isThisRollbackPending}
              />
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("settings.auditColDecision")}</TableHead>
                <TableHead>{t("settings.auditColTransport")}</TableHead>
                <TableHead>{t("settings.auditColPrincipal")}</TableHead>
                <TableHead>{t("settings.auditColAction")}</TableHead>
                <TableHead>{t("settings.auditColDetail")}</TableHead>
                <TableHead>{t("settings.auditColTime")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <Badge
                      size="sm"
                      variant={entry.decision === "allowed" ? "success" : "error"}
                    >
                      {decisionLabels[entry.decision]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge size="sm" variant="outline">
                      <span className="font-mono uppercase">{entry.transport}</span>
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {entry.tokenName ?? entry.principalKind}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <code className="font-mono text-xs font-medium text-foreground">
                        {entry.action}
                      </code>
                      <span className="max-w-44 truncate font-mono text-[11px] text-muted-foreground">
                        {entry.resource}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-52 truncate text-xs text-muted-foreground whitespace-normal">
                    {entry.reason ?? entry.summary ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {entry.createdAt.slice(0, 19).replace("T", " ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
