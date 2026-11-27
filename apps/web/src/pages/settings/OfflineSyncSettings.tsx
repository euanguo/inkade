import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueries, useInkadeClient } from "@inkade/sdk/react";
import {
  Badge,
  BucketMeter,
  type BucketMeterSegment,
  Button,
  CopyButton,
  HoldConfirmButton,
  Skeleton,
  Switch,
} from "@inkade/ui";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, DatabaseIcon, HardDriveIcon, ShieldCheckIcon } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import { useYjsOfflineEnabled } from "@inkade/views/lib/preferences-store";
import { DangerZone, SettingRow, SettingsGroup, SettingsSectionHeader } from "./SettingRow.tsx";
import { formatByteSize } from "./types.ts";

const INKADE_YJS_DB_PREFIX = "inkade-yjs:";

interface StorageSnapshot {
  readonly supported: boolean;
  readonly usage: number;
  readonly quota: number;
  readonly dbNames: readonly string[] | null;
}

async function readLocalStorageSnapshot(): Promise<StorageSnapshot> {
  let supported = false;
  let usage = 0;
  let quota = 0;
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      supported = true;
      usage = estimate.usage ?? 0;
      quota = estimate.quota ?? 0;
    } catch {
      supported = false;
    }
  }

  let dbNames: readonly string[] | null = null;
  if (typeof globalThis.indexedDB !== "undefined") {
    const idb = globalThis.indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };
    if (typeof idb.databases === "function") {
      try {
        const list = await idb.databases();
        dbNames = list
          .map((item) => item.name ?? "")
          .filter((name) => name.startsWith(INKADE_YJS_DB_PREFIX));
      } catch {
        dbNames = null;
      }
    }
  }

  return { supported, usage, quota, dbNames };
}

function deleteIndexedDbByName(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof globalThis.indexedDB === "undefined") {
      resolve();
      return;
    }
    const req = globalThis.indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Failed to delete IndexedDB store"));
    req.onblocked = () => resolve();
  });
}

export function OfflineSyncSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const { yjsOfflineEnabled, setYjsOfflineEnabled } = useYjsOfflineEnabled();
  const [snapshot, setSnapshot] = useState<StorageSnapshot>({
    supported: false,
    usage: 0,
    quota: 0,
    dbNames: null,
  });
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const bucketsQuery = useQuery({
    ...inkadeQueries.storageBuckets(client),
    retry: false,
  });

  const refreshSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    try {
      const next = await readLocalStorageSnapshot();
      setSnapshot(next);
      return next;
    } finally {
      setLoadingSnapshot(false);
    }
  }, []);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  const handleVerifyCache = async (): Promise<void> => {
    setVerifying(true);
    try {
      const next = await refreshSnapshot();
      if (typeof globalThis.indexedDB === "undefined") {
        setVerifyMessage(t("settings.syncVerifyUnavailable"));
        return;
      }
      const count = next.dbNames?.length ?? 0;
      setVerifyMessage(t("settings.syncVerifyResult", { count }));
      showSuccessToast(t("settings.syncVerifyOkToast"));
    } finally {
      setVerifying(false);
    }
  };

  const handleClearCache = async (): Promise<void> => {
    setClearing(true);
    try {
      const current = await readLocalStorageSnapshot();
      const targets = current.dbNames ?? [];
      await Promise.all(targets.map((name) => deleteIndexedDbByName(name)));
      await refreshSnapshot();
      setVerifyMessage(null);
      showSuccessToast(t("settings.syncClearSuccessToast", { count: targets.length }));
    } catch (err) {
      showErrorToast(t("settings.syncClearFailedToast"), err);
    } finally {
      setClearing(false);
    }
  };

  const usagePercent =
    snapshot.quota > 0
      ? Math.min(100, Math.max(0, Math.round((snapshot.usage / snapshot.quota) * 1000) / 10))
      : 0;

  const syncBucketSegments: readonly BucketMeterSegment[] = useMemo(() => {
    const data = bucketsQuery.data;
    if (!data) {
      return snapshot.usage > 0
        ? [
            {
              id: "browser-sync",
              label: t("settings.syncDbCountLabel"),
              value: snapshot.usage,
              tone: "primary",
            },
          ]
        : [];
    }
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
  }, [bucketsQuery.data, snapshot.usage, t]);

  const bucketMeterCapacity = bucketsQuery.data?.quotaLimitBytes ?? snapshot.quota;

  const syncDiagnosticsText = useMemo(
    () =>
      JSON.stringify(
        {
          yjsOfflineEnabled,
          browserQuotaSupported: snapshot.supported,
          browserUsageBytes: snapshot.usage,
          browserQuotaBytes: snapshot.quota,
          yjsDatabaseCount: snapshot.dbNames?.length ?? null,
          workspaceBuckets: bucketsQuery.data ?? null,
        },
        null,
        2,
      ),
    [bucketsQuery.data, snapshot, yjsOfflineEnabled],
  );

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        description={t("settings.sectionSyncDesc")}
        title={t("settings.sectionSyncLabel")}
      />

      <SettingsGroup>
        <SettingRow
          badge={
            <Badge size="sm" variant={yjsOfflineEnabled ? "secondary" : "outline"}>
              {yjsOfflineEnabled
                ? t("settings.syncEnabledBadge")
                : t("settings.syncDisabledBadge")}
            </Badge>
          }
          description={t("settings.syncPersistenceDesc")}
          title={t("settings.syncPersistenceTitle")}
        >
          <Switch
            aria-label={t("settings.syncPersistenceTitle")}
            checked={yjsOfflineEnabled}
            onCheckedChange={setYjsOfflineEnabled}
          />
        </SettingRow>

        <SettingRow
          description={t("settings.syncQuotaDesc")}
          layout="vertical"
          title={t("settings.syncQuotaTitle")}
        >
          {loadingSnapshot ? (
            <div aria-busy="true" className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ) : !snapshot.supported ? (
            <p className="text-xs text-muted-foreground">{t("settings.syncQuotaUnavailable")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <HardDriveIcon className="size-3.5 text-muted-foreground" />
                  <span>
                    {t("settings.syncQuotaSummary", {
                      used: formatByteSize(snapshot.usage),
                      quota: formatByteSize(snapshot.quota),
                      percent: usagePercent,
                    })}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <DatabaseIcon className="size-3.5" />
                    <span>
                      {snapshot.dbNames !== null
                        ? t("settings.syncDbCountValue", { count: snapshot.dbNames.length })
                        : t("settings.syncDbCountUnsupported")}
                    </span>
                  </span>
                  <CopyButton
                    copiedLabel={t("settings.diagnosticsCopied")}
                    label={t("settings.syncCopyDiagnostics")}
                    showLabel
                    size="xs"
                    value={syncDiagnosticsText}
                    variant="outline"
                  />
                </div>
              </div>
              <BucketMeter
                ariaLabel={t("settings.bucketMeterAria")}
                capacity={bucketMeterCapacity}
                formatValue={(bytes) => formatByteSize(bytes)}
                highWatermarkRatio={0.85}
                scaleMode="auto"
                segments={syncBucketSegments}
              />
            </div>
          )}
        </SettingRow>

        <SettingRow
          description={t("settings.syncVerifyDesc")}
          layout="vertical"
          title={t("settings.syncVerifyTitle")}
        >
          <div className="flex justify-end">
            <Button
              loading={verifying}
              onClick={() => void handleVerifyCache()}
              size="sm"
              variant="outline"
            >
              <ShieldCheckIcon />
              <span>{t("settings.syncVerifyAction")}</span>
            </Button>
          </div>
          {verifyMessage ? (
            <div
              className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success-foreground"
              role="status"
            >
              <CheckCircle2Icon className="size-4 shrink-0" />
              <span>{verifyMessage}</span>
            </div>
          ) : null}
        </SettingRow>
      </SettingsGroup>

      <DangerZone>
        <SettingRow
          description={t("settings.syncClearDesc")}
          title={t("settings.syncClearTitle")}
        >
          <HoldConfirmButton
            disabled={clearing}
            holdingLabel={t("settings.holdingToClearCache")}
            onConfirm={() => void handleClearCache()}
            size="sm"
          >
            {t("settings.holdToClearCache")}
          </HoldConfirmButton>
        </SettingRow>
      </DangerZone>
    </div>
  );
}
