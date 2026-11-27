import { useInkadeTranslation } from "@inkade/i18n";
import {
  Button,
  cn,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  GridDisclosure,
  HoldConfirmButton,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Textarea,
} from "@inkade/ui/primitives";
import { FlaskConical, Plus, Save, Trash2 } from "lucide-react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import {
  getBehaviorLabel,
  getTriggerTypeLabel,
  type TemplateEditorFormValues,
} from "./template-utils.ts";

export interface TemplateEditorFormProps {
  readonly form: UseFormReturn<TemplateEditorFormValues>;
  readonly testerOpen: boolean;
  readonly canDelete: boolean;
  readonly onSubmitSave: () => void;
  readonly onToggleTester: () => void;
  readonly onDeleteSelected: () => void;
}

export function TemplateEditorForm({
  form,
  testerOpen,
  canDelete,
  onSubmitSave,
  onToggleTester,
  onDeleteSelected,
}: TemplateEditorFormProps) {
  const { t } = useInkadeTranslation();
  const watchedTriggers = useWatch({ control: form.control, name: "triggers" });
  const watchedBehavior = useWatch({ control: form.control, name: "behavior" });
  const watchedAppendToDaily = useWatch({ control: form.control, name: "appendToDaily" });
  const behaviorLabel = getBehaviorLabel(t, watchedBehavior);

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmitSave();
      }}
    >
      <Form {...form}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="w-full min-w-0 sm:col-span-2">
                <FormLabel className="text-xs text-muted-foreground" htmlFor="tpl-name">
                  {t("clipper.templateNameLabel")}
                </FormLabel>
                <FormControl>
                  <Input {...field} className="w-full" id="tpl-name" size="sm" type="text" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem className="w-full min-w-0">
                <FormLabel className="text-xs text-muted-foreground" htmlFor="tpl-priority">
                  {t("clipper.templatePriorityLabel")}
                </FormLabel>
                <FormControl>
                  <Input
                    className="w-full tabular-nums"
                    id="tpl-priority"
                    name={field.name}
                    onBlur={field.onBlur}
                    onChange={(e) => field.onChange(Number(e.target.value) || 0)}
                    ref={field.ref}
                    size="sm"
                    type="number"
                    value={String(field.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="behavior"
            render={({ field }) => (
              <FormItem className="w-full min-w-0">
                <FormLabel className="text-xs text-muted-foreground" htmlFor="tpl-behavior">
                  {t("clipper.templateBehaviorLabel")}
                </FormLabel>
                <FormControl>
                  <Select
                    onValueChange={(value) => {
                      if (
                        value === "create" ||
                        value === "append-existing" ||
                        value === "daily-only"
                      ) {
                        field.onChange(value);
                      }
                    }}
                    value={field.value}
                  >
                    <SelectTrigger className="w-full min-w-0" id="tpl-behavior" size="sm">
                      <SelectValue className="min-w-0 truncate">{behaviorLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="create">
                        {t("clipper.templateBehaviorCreate")}
                      </SelectItem>
                      <SelectItem value="append-existing">
                        {t("clipper.templateBehaviorAppendExisting")}
                      </SelectItem>
                      <SelectItem value="daily-only">
                        {t("clipper.templateBehaviorDailyOnly")}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="w-full min-w-0">
              <FormLabel className="text-xs text-muted-foreground" htmlFor="tpl-desc">
                {t("clipper.templateDescLabel")}
              </FormLabel>
              <FormControl>
                <Input {...field} className="w-full" id="tpl-desc" size="sm" type="text" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="titleTemplate"
            render={({ field }) => (
              <FormItem className="w-full min-w-0">
                <FormLabel className="text-xs text-muted-foreground" htmlFor="tpl-title">
                  {t("clipper.templateTitleTplLabel")}
                </FormLabel>
                <FormControl>
                  <Input {...field} className="w-full" id="tpl-title" size="sm" type="text" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="tagsTemplate"
            render={({ field }) => (
              <FormItem className="w-full min-w-0">
                <FormLabel className="text-xs text-muted-foreground" htmlFor="tpl-tags">
                  {t("clipper.templateTagsTplLabel")}
                </FormLabel>
                <FormControl>
                  <Input {...field} className="w-full" id="tpl-tags" size="sm" type="text" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("clipper.templateTriggersLabel")}
            </span>
            <Button
              onClick={() =>
                form.setValue(
                  "triggers",
                  [...watchedTriggers, { type: "url-prefix", pattern: "" }],
                  { shouldDirty: true },
                )
              }
              size="xs"
              type="button"
              variant="outline"
            >
              <Plus className="size-3" />
              <span>{t("clipper.templateAddTriggerBtn")}</span>
            </Button>
          </div>
          {watchedTriggers.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {watchedTriggers.map((trigger, idx) => (
                <div className="flex items-center gap-1.5" key={idx}>
                  <Select
                    onValueChange={(value) => {
                      if (
                        value === "url-prefix" ||
                        value === "glob" ||
                        value === "regex" ||
                        value === "schema-type"
                      ) {
                        form.setValue(
                          "triggers",
                          watchedTriggers.map((item, i) =>
                            i === idx ? { ...item, type: value } : item,
                          ),
                          { shouldDirty: true },
                        );
                      }
                    }}
                    value={trigger.type}
                  >
                    <SelectTrigger className="w-36 shrink-0" size="sm">
                      <SelectValue>{getTriggerTypeLabel(t, trigger.type)}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="url-prefix">
                        {t("clipper.triggerTypeUrlPrefix")}
                      </SelectItem>
                      <SelectItem value="glob">{t("clipper.triggerTypeGlob")}</SelectItem>
                      <SelectItem value="regex">{t("clipper.triggerTypeRegex")}</SelectItem>
                      <SelectItem value="schema-type">
                        {t("clipper.triggerTypeSchema")}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                  <Input
                    className="flex-1 font-mono text-xs"
                    onChange={(e) => {
                      const val = e.target.value;
                      form.setValue(
                        "triggers",
                        watchedTriggers.map((item, i) =>
                          i === idx ? { ...item, pattern: val } : item,
                        ),
                        { shouldDirty: true },
                      );
                    }}
                    placeholder={t("clipper.triggerPatternPlaceholder")}
                    size="sm"
                    type="text"
                    value={trigger.pattern}
                  />
                  <Button
                    aria-label={t("common.remove")}
                    onClick={() =>
                      form.setValue(
                        "triggers",
                        watchedTriggers.filter((_item, i) => i !== idx),
                        { shouldDirty: true },
                      )
                    }
                    size="icon-xs"
                    type="button"
                    variant="outline"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {t("clipper.templateNoTriggersHint")}
            </span>
          )}
        </div>

        <FormField
          control={form.control}
          name="contentTemplate"
          render={({ field }) => (
            <FormItem className="w-full min-w-0">
              <FormLabel className="text-xs text-muted-foreground" htmlFor="tpl-content">
                {t("clipper.templateContentTplLabel")}
              </FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  className="min-h-24 w-full font-mono text-xs"
                  id="tpl-content"
                  size="sm"
                />
              </FormControl>
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                {t("clipper.templateVarCheatsheet")}
              </span>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="propertiesJson"
          render={({ field }) => (
            <FormItem className="w-full min-w-0">
              <FormLabel className="text-xs text-muted-foreground" htmlFor="tpl-props">
                {t("clipper.templatePropsLabel")}
              </FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  className="min-h-18 w-full font-mono text-xs"
                  id="tpl-props"
                  size="sm"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="appendToDaily"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3 rounded-md bg-muted/45 px-3 py-2">
                  <FormLabel
                    className="flex-1 cursor-pointer text-xs font-medium text-foreground"
                    htmlFor="tpl-append-daily"
                  >
                    {t("clipper.appendDailyToggle")}
                  </FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      id="tpl-append-daily"
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="enabled"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3 rounded-md bg-muted/45 px-3 py-2">
                  <FormLabel
                    className="flex-1 cursor-pointer text-xs font-medium text-foreground"
                    htmlFor="tpl-enabled"
                  >
                    {t("clipper.templateEnabledToggle")}
                  </FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      id="tpl-enabled"
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />
        </div>

        <GridDisclosure open={watchedAppendToDaily}>
          <FormField
            control={form.control}
            name="dailyLineTemplate"
            render={({ field }) => (
              <FormItem className="w-full min-w-0">
                <FormLabel className="text-xs text-muted-foreground" htmlFor="tpl-daily-line">
                  {t("clipper.templateDailyTplLabel")}
                </FormLabel>
                <FormControl>
                  <Input {...field} className="w-full" id="tpl-daily-line" size="sm" type="text" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </GridDisclosure>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button size="sm" type="submit">
              <Save className="size-3.5" />
              <span>{t("clipper.templateSaveBtn")}</span>
            </Button>
            <Button
              aria-pressed={testerOpen}
              className={cn(
                testerOpen
                  ? "border-foreground/30 bg-foreground/8 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={onToggleTester}
              size="sm"
              type="button"
              variant="outline"
            >
              <FlaskConical className="size-3.5" />
              <span>{t("clipper.templateTesterToggleBtn")}</span>
            </Button>
          </div>
          <HoldConfirmButton disabled={!canDelete} onConfirm={onDeleteSelected} size="sm">
            <Trash2 className="size-3.5" />
            <span>{t("clipper.templateDeleteBtn")}</span>
          </HoldConfirmButton>
        </div>
      </Form>
    </form>
  );
}
