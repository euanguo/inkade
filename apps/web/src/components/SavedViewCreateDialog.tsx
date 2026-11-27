import {
  asSpaceId,
  SAVED_VIEW_DISPLAY_MODES,
  type SavedViewDisplayMode,
  type DocumentKind,
  type Space,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  SPACE_COLOR_NAMES,
  SPACE_COLOR_PALETTE,
  type SpaceColorName,
  Switch,
} from "@inkade/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkIcon, CheckIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { getInkadeClient } from "../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";

export interface SavedViewCreateDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spaces: readonly Space[];
  readonly existingCount: number;
}

export function SavedViewCreateDialog({
  open,
  onOpenChange,
  spaces,
  existingCount,
}: SavedViewCreateDialogProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t("validation.required")),
        spaceId: z.string(),
        kind: z.string(),
        tag: z.string(),
        pinnedOnly: z.boolean(),
        unreadOnly: z.boolean(),
        displayMode: z.enum(SAVED_VIEW_DISPLAY_MODES),
        groupByField: z.string(),
        color: z.enum(SPACE_COLOR_NAMES),
      }),
    [t],
  );

  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      spaceId: "__all__",
      kind: "__all__",
      tag: "",
      pinnedOnly: false,
      unreadOnly: false,
      displayMode: "grid",
      groupByField: "",
      color: "indigo",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: "",
        spaceId: "__all__",
        kind: "__all__",
        tag: "",
        pinnedOnly: false,
        unreadOnly: false,
        displayMode: "grid",
        groupByField: "",
        color: "indigo",
      });
    }
  }, [open, form]);

  const svColor = useWatch({ control: form.control, name: "color" });
  const svKind = useWatch({ control: form.control, name: "kind" });
  const svDisplayMode = useWatch({ control: form.control, name: "displayMode" });

  const createSavedViewMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const cleanTag = values.tag.trim().replace(/^#+/, "");
      const cleanGroupBy = values.groupByField.trim();
      return getInkadeClient().savedViews.create({
        name: values.name.trim(),
        icon: "Bookmark",
        color: values.color,
        displayMode: values.displayMode,
        groupByField: values.displayMode === "board" && cleanGroupBy ? cleanGroupBy : null,
        filter: {
          ...(values.spaceId !== "__all__" ? { spaceId: asSpaceId(values.spaceId) } : {}),
          ...(values.kind !== "__all__" ? { kind: values.kind as DocumentKind } : {}),
          ...(cleanTag ? { tag: cleanTag } : {}),
          ...(values.pinnedOnly ? { pinnedOnly: true } : {}),
          ...(values.unreadOnly ? { unreadOnly: true } : {}),
          viewMode: values.displayMode,
        },
        sortOrder: existingCount * 10,
      });
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.savedViews() });
      showSuccessToast(t("nav.savedViewCreated"), created.name);
      onOpenChange(false);
    },
    onError: (err) => showErrorToast(t("nav.savedViewCreateFailed"), err),
  });

  const handleSubmit = form.handleSubmit((values) => {
    if (createSavedViewMutation.isPending) return;
    createSavedViewMutation.mutate(values);
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkIcon className="size-4 text-primary" />
            <span>{t("nav.newSavedView")}</span>
          </DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={(e) => void handleSubmit(e)}>
          <Form {...form}>
            <DialogPanel className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("nav.savedViewNameLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        autoFocus
                        placeholder={t("nav.savedViewNamePlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-wrap items-center gap-1.5">
                {SPACE_COLOR_NAMES.map((colorName: SpaceColorName) => {
                  const swatch = SPACE_COLOR_PALETTE[colorName];
                  const selected = svColor === colorName;
                  return (
                    <button
                      aria-label={colorName}
                      aria-pressed={selected}
                      className={`inline-flex size-5 cursor-pointer items-center justify-center rounded-full ${swatch.dotBg} ${
                        selected ? "outline-2 outline-offset-2 outline-foreground/75" : ""
                      }`}
                      key={colorName}
                      onClick={() => form.setValue("color", colorName)}
                      type="button"
                    >
                      {selected ? <CheckIcon className="size-3 text-white" /> : null}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="spaceId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("nav.savedViewSpaceLabel")}</FormLabel>
                      <Select<string>
                        onValueChange={(v) =>
                          field.onChange(!v || v === "__all__" ? "__all__" : asSpaceId(v))
                        }
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue>
                              {field.value === "__all__"
                                ? t("nav.savedViewAllSpaces")
                                : (spaces.find((s) => s.id === field.value)?.name ??
                                  t("nav.savedViewAllSpaces"))}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectPopup>
                          <SelectItem value="__all__">{t("nav.savedViewAllSpaces")}</SelectItem>
                          {spaces
                            .filter((s) => s.archivedAt === null)
                            .map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                        </SelectPopup>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("nav.savedViewKindLabel")}</FormLabel>
                      <Select onValueChange={(v) => field.onChange(v ?? "__all__")} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue>
                              {svKind === "article"
                                ? t("common.kindArticle")
                                : svKind === "clip"
                                  ? t("common.kindClip")
                                  : svKind === "outline"
                                    ? t("common.kindOutline")
                                    : t("nav.savedViewAllKinds")}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectPopup>
                          <SelectItem value="__all__">{t("nav.savedViewAllKinds")}</SelectItem>
                          <SelectItem value="article">{t("common.kindArticle")}</SelectItem>
                          <SelectItem value="clip">{t("common.kindClip")}</SelectItem>
                          <SelectItem value="outline">{t("common.kindOutline")}</SelectItem>
                        </SelectPopup>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="tag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("nav.savedViewTagLabel")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("nav.savedViewTagPlaceholder")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="displayMode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("library.viewModeLabel")}</FormLabel>
                      <Select<SavedViewDisplayMode>
                        onValueChange={(v) => {
                          if (v) field.onChange(v);
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue>
                              {svDisplayMode === "board"
                                ? t("library.savedViewBoardOption")
                                : svDisplayMode === "table"
                                  ? t("library.savedViewTableOption")
                                  : t("library.savedViewGridOption")}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectPopup>
                          <SelectItem value="grid">{t("library.savedViewGridOption")}</SelectItem>
                          <SelectItem value="table">{t("library.savedViewTableOption")}</SelectItem>
                          <SelectItem value="board">{t("library.savedViewBoardOption")}</SelectItem>
                        </SelectPopup>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {svDisplayMode === "board" && (
                  <FormField
                    control={form.control}
                    name="groupByField"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("board.groupByFieldLabel")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("schema.fieldKeyPlaceholder")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <div className="flex flex-col gap-2">
                <FormField
                  control={form.control}
                  name="pinnedOnly"
                  render={({ field }) => (
                    <label className="flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <span>{t("nav.savedViewPinnedOnly")}</span>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </label>
                  )}
                />
                <FormField
                  control={form.control}
                  name="unreadOnly"
                  render={({ field }) => (
                    <label className="flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <span>{t("nav.savedViewUnreadOnly")}</span>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </label>
                  )}
                />
              </div>
            </DialogPanel>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
                {t("common.cancel")}
              </Button>
              <Button loading={createSavedViewMutation.isPending} type="submit">
                {t("common.save")}
              </Button>
            </DialogFooter>
          </Form>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
