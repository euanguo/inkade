import { useInkadeTranslation } from "@inkade/i18n";
import { Button, Input, Kbd, Popover, PopoverPopup, PopoverTrigger } from "@inkade/ui";
import { BellRingIcon, ClockIcon, MailIcon, MailOpenIcon, MoonIcon, SunIcon } from "lucide-react";
import type React from "react";
import { computeDeferTargetDate } from "../../lib/daily-studio.ts";
import { buildLocalPresetIso, type UnifiedInboxItem } from "./types.ts";

export interface InboxTriageMetaControlsProps {
  readonly item: UnifiedInboxItem;
  readonly todayStr: string;
  readonly snoozePopoverOpen: boolean;
  readonly onSnoozePopoverOpenChange: (open: boolean) => void;
  readonly customSnoozeDate: string;
  readonly onCustomSnoozeDateChange: (date: string) => void;
  readonly onResetCustomSnoozeDate: () => void;
  readonly snoozePending: boolean;
  readonly unreadPending: boolean;
  readonly onSnooze: (untilIso: string | null) => void;
  readonly onToggleUnread: () => void;
}

export function InboxTriageMetaControls({
  item,
  todayStr,
  snoozePopoverOpen,
  onSnoozePopoverOpenChange,
  customSnoozeDate,
  onCustomSnoozeDateChange,
  onResetCustomSnoozeDate,
  snoozePending,
  unreadPending,
  onSnooze,
  onToggleUnread,
}: InboxTriageMetaControlsProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const tomorrowDate = computeDeferTargetDate(todayStr, "tomorrow");
  const nextMondayDate = computeDeferTargetDate(todayStr, "next_monday");

  return (
    <>
      {item.snoozedUntil && (
        <Button
          loading={snoozePending}
          onClick={() => onSnooze(null)}
          size="xs"
          variant="outline"
        >
          <BellRingIcon />
          <span>{t("inbox.wakeUp")}</span>
        </Button>
      )}

      <Popover
        onOpenChange={(open) => {
          if (open) onResetCustomSnoozeDate();
          onSnoozePopoverOpenChange(open);
        }}
        open={snoozePopoverOpen}
      >
        <PopoverTrigger render={<Button size="xs" variant="outline" />}>
          <ClockIcon />
          <span>{t("inbox.snoozeAction")}</span>
          <Kbd className="hidden xl:inline-flex">H</Kbd>
        </PopoverTrigger>
        <PopoverPopup align="start" className="w-64" viewportClassName="p-2.5">
          <p className="mb-1 px-1.5 text-[11px] font-medium text-muted-foreground">
            {t("inbox.snoozePresetsLabel")}
          </p>
          <div className="flex flex-col gap-1">
            <Button
              className="justify-start"
              onClick={() => onSnooze(new Date(Date.now() + 3 * 3_600_000).toISOString())}
              size="xs"
              variant="ghost"
            >
              <ClockIcon className="size-3.5 text-amber-500" />
              <span className="flex-1 text-left">{t("inbox.snoozeLaterToday")}</span>
            </Button>
            <Button
              className="justify-start"
              onClick={() => onSnooze(buildLocalPresetIso(tomorrowDate, 9))}
              size="xs"
              variant="ghost"
            >
              <SunIcon className="size-3.5 text-sky-500" />
              <span className="flex-1 text-left">{t("inbox.snoozeTomorrowMorning")}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {tomorrowDate.slice(5)}
              </span>
            </Button>
            <Button
              className="justify-start"
              onClick={() => onSnooze(buildLocalPresetIso(nextMondayDate, 9))}
              size="xs"
              variant="ghost"
            >
              <MoonIcon className="size-3.5 text-indigo-500" />
              <span className="flex-1 text-left">{t("inbox.snoozeNextMonday")}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {nextMondayDate.slice(5)}
              </span>
            </Button>
            <div className="mt-1 flex items-center gap-1.5 border-t border-border/60 pt-2">
              <Input
                aria-label={t("inbox.snoozeCustomDate")}
                className="flex-1 text-xs"
                onChange={(e) => onCustomSnoozeDateChange(e.target.value)}
                size="sm"
                type="date"
                value={customSnoozeDate}
              />
              <Button
                disabled={!customSnoozeDate}
                onClick={() => onSnooze(buildLocalPresetIso(customSnoozeDate, 9))}
                size="sm"
                variant="secondary"
              >
                {t("common.confirm")}
              </Button>
            </div>
          </div>
        </PopoverPopup>
      </Popover>

      <Button
        loading={unreadPending}
        onClick={onToggleUnread}
        size="xs"
        variant="ghost"
      >
        {item.unread ? <MailOpenIcon /> : <MailIcon />}
        <span className="hidden md:inline">
          {item.unread ? t("inbox.markRead") : t("inbox.markUnread")}
        </span>
        <Kbd className="hidden xl:inline-flex">U</Kbd>
      </Button>
    </>
  );
}
