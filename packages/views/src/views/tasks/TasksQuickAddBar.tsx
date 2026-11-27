import { formatScheduledStartMin, type ParsedQuickTaskSyntax } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  cn,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  formatTaskDurationLabel,
  getTaskPriorityLabelKey,
  getTaskRecurrenceLabelKey,
  getTaskSlotLabelKey,
  INKADE_MEDIA_QUERIES,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  TASK_PRIORITY_STYLES,
} from "@inkade/ui";
import {
  CalendarDaysIcon,
  ClockIcon,
  FlagIcon,
  InboxIcon,
  MoonIcon,
  PlusIcon,
  RepeatIcon,
  SparklesIcon,
  SunIcon,
} from "lucide-react";
import type React from "react";
import type { UseFormReturn } from "react-hook-form";
import { useMediaQuery } from "usehooks-ts";
import type { QuickAddPreset } from "./types.ts";

export interface TasksQuickAddBarProps {
  readonly form: UseFormReturn<{ text: string }>;
  readonly hasQuickTokens: boolean;
  readonly inputRef: React.MutableRefObject<HTMLInputElement | null>;
  readonly isPending: boolean;
  readonly onPresetChange: (preset: QuickAddPreset) => void;
  readonly onSubmit: React.FormEventHandler<HTMLFormElement>;
  readonly parsedQuickSyntax: ParsedQuickTaskSyntax;
  readonly quickAddPreset: QuickAddPreset;
  readonly watchedText: string;
}

export function TasksQuickAddBar({
  form,
  hasQuickTokens,
  inputRef,
  isPending,
  onPresetChange,
  onSubmit,
  parsedQuickSyntax,
  quickAddPreset,
  watchedText,
}: TasksQuickAddBarProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const isSmUp = useMediaQuery(INKADE_MEDIA_QUERIES.sm);

  return (
    <form
      className="flex flex-col gap-1.5 rounded-lg border border-border/75 bg-card/85 p-1.5"
      noValidate
      onSubmit={onSubmit}
    >
      <Form {...form}>
        <div className="flex flex-wrap items-start gap-1.5">
          <FormField
            control={form.control}
            name="text"
            render={({ field }) => (
              <FormItem className="min-w-0 w-full gap-1 sm:w-auto sm:min-w-[200px] sm:flex-1">
                <FormControl>
                  <Input
                    {...field}
                    className="w-full"
                    placeholder={
                      isSmUp
                        ? t("tasks.quickAddPlaceholder")
                        : t("tasks.quickAddPlaceholderCompact")
                    }
                    ref={(node) => {
                      inputRef.current = node;
                      field.ref(node);
                    }}
                    size="sm"
                    startAddon={<PlusIcon />}
                    title={t("tasks.quickSyntaxHint")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <SegmentedControl size="sm">
            {(["today", "tonight", "tomorrow", "anytime"] as const).map((preset) => (
              <SegmentedControlItem
                className="text-xs sm:text-xs"
                data-checked={quickAddPreset === preset ? "" : undefined}
                key={preset}
                onClick={() => onPresetChange(preset)}
              >
                {preset === "today"
                  ? t("tasks.whenToday")
                  : preset === "tonight"
                    ? t("tasks.whenTonight")
                    : preset === "tomorrow"
                      ? t("tasks.whenTomorrow")
                      : t("tasks.whenAnytime")}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <Button disabled={!watchedText.trim() || isPending} size="sm" type="submit">
            <PlusIcon className="size-3.5" />
            <span>{t("tasks.quickAddSubmit")}</span>
          </Button>
        </div>
      </Form>

      {hasQuickTokens && (
        <div
          className="flex flex-wrap items-center gap-1.5 px-1 text-[11px]"
          data-testid="quick-syntax-preview"
        >
          <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
            <SparklesIcon className="size-3 text-primary" />
            <span>{t("tasks.quickSyntaxDetected")}</span>
          </span>
          {parsedQuickSyntax.priority && parsedQuickSyntax.priority !== "none" && (
            <span
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold",
                TASK_PRIORITY_STYLES[parsedQuickSyntax.priority].pillClass,
              )}
            >
              <FlagIcon className="size-2.5" />
              <span>{t(getTaskPriorityLabelKey(parsedQuickSyntax.priority, true))}</span>
            </span>
          )}
          {parsedQuickSyntax.scheduledDate !== undefined && (
            <Badge size="sm" variant="info">
              {parsedQuickSyntax.scheduledDate === null ? (
                <>
                  <InboxIcon className="size-3" />
                  <span>{t("tasks.anytimeBadge")}</span>
                </>
              ) : (
                <>
                  <CalendarDaysIcon className="size-3" />
                  <span className="font-mono">{parsedQuickSyntax.scheduledDate}</span>
                </>
              )}
            </Badge>
          )}
          {parsedQuickSyntax.scheduledSlot && (
            <Badge size="sm" variant="secondary">
              {parsedQuickSyntax.scheduledSlot === "morning" ? (
                <SunIcon className="size-3 text-amber-500" />
              ) : parsedQuickSyntax.scheduledSlot === "evening" ? (
                <MoonIcon className="size-3 text-indigo-500" />
              ) : (
                <ClockIcon className="size-3 text-sky-500" />
              )}
              <span>{t(getTaskSlotLabelKey(parsedQuickSyntax.scheduledSlot))}</span>
            </Badge>
          )}
          {parsedQuickSyntax.durationMin !== undefined && (
            <Badge className="font-mono tabular-nums" size="sm" variant="outline">
              <ClockIcon className="size-3" />
              <span>{formatTaskDurationLabel(parsedQuickSyntax.durationMin, t)}</span>
            </Badge>
          )}
          {parsedQuickSyntax.scheduledStartMin !== undefined && (
            <Badge className="font-mono tabular-nums" size="sm" variant="secondary">
              <ClockIcon className="size-3 text-primary" />
              <span>{formatScheduledStartMin(parsedQuickSyntax.scheduledStartMin)}</span>
            </Badge>
          )}
          {parsedQuickSyntax.dueDate && (
            <Badge className="font-mono" size="sm" variant="outline">
              <span>{t("tasks.dueBadge", { date: parsedQuickSyntax.dueDate })}</span>
            </Badge>
          )}
          {parsedQuickSyntax.recurrenceRule && (
            <Badge size="sm" variant="outline">
              <RepeatIcon className="size-3" />
              <span>{t(getTaskRecurrenceLabelKey(parsedQuickSyntax.recurrenceRule))}</span>
            </Badge>
          )}
        </div>
      )}
    </form>
  );
}
