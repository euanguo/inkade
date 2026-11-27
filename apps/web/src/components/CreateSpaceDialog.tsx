import { asSpaceId, DOCUMENT_KINDS, type DocumentKind, type Space, type SpaceId } from "@inkade/core";
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
  type SpaceColorName,
  SpaceIcon,
  SpaceIconPicker,
} from "@inkade/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { getInkadeClient } from "../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";

export interface CreateSpaceDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spaces: readonly Space[];
  readonly editingSpace?: Space | null | undefined;
  readonly defaultParentId?: SpaceId | null | undefined;
}

export function CreateSpaceDialog({
  open,
  onOpenChange,
  spaces,
  editingSpace = null,
  defaultParentId = null,
}: CreateSpaceDialogProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t("validation.required")),
        parentId: z.string(),
        defaultKind: z.enum(DOCUMENT_KINDS),
        icon: z.string(),
        color: z.string(),
      }),
    [t],
  );

  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      parentId: defaultParentId ?? "__none__",
      defaultKind: "article",
      icon: "Folder",
      color: "indigo",
    },
  });

  const watchedIcon = useWatch({ control: form.control, name: "icon" });
  const watchedColor = useWatch({ control: form.control, name: "color" });
  const watchedDefaultKind = useWatch({ control: form.control, name: "defaultKind" });

  const kindOptionLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutlineLabel"),
    article: t("common.kindArticleLabel"),
    clip: t("common.kindClipLabel"),
  };

  const colorLabels = useMemo<Partial<Record<SpaceColorName, string>>>(
    () => ({
      indigo: t("common.spaceColorIndigo"),
      blue: t("common.spaceColorBlue"),
      teal: t("common.spaceColorTeal"),
      emerald: t("common.spaceColorEmerald"),
      amber: t("common.spaceColorAmber"),
      orange: t("common.spaceColorOrange"),
      rose: t("common.spaceColorRose"),
      pink: t("common.spaceColorPink"),
      violet: t("common.spaceColorViolet"),
      slate: t("common.spaceColorSlate"),
    }),
    [t],
  );

  useEffect(() => {
    if (!open) return;
    if (editingSpace) {
      form.reset({
        name: editingSpace.name,
        parentId: editingSpace.parentId ?? "__none__",
        defaultKind: editingSpace.defaultKind ?? "article",
        icon: editingSpace.icon ?? "Folder",
        color: editingSpace.color ?? "indigo",
      });
    } else {
      form.reset({
        name: "",
        parentId: defaultParentId ?? "__none__",
        defaultKind: "article",
        icon: "Folder",
        color: "indigo",
      });
    }
  }, [open, editingSpace, defaultParentId, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const client = getInkadeClient();
      const resolvedParent = values.parentId === "__none__" ? null : asSpaceId(values.parentId);
      const resolvedIcon = values.icon.trim() || undefined;
      const resolvedColor = values.color.trim() || undefined;
      if (editingSpace) {
        return client.spaces.update(editingSpace.id, {
          name: values.name.trim(),
          parentId: resolvedParent,
          defaultKind: values.defaultKind,
          icon: resolvedIcon ?? null,
          color: resolvedColor ?? null,
        });
      }
      return client.spaces.create({
        name: values.name.trim(),
        parentId: resolvedParent,
        defaultKind: values.defaultKind,
        ...(resolvedIcon ? { icon: resolvedIcon } : {}),
        ...(resolvedColor ? { color: resolvedColor } : {}),
      });
    },
    onSuccess: (space) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "spaces"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.whoami() });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      showSuccessToast(
        editingSpace ? t("dialogs.spaceUpdated") : t("dialogs.spaceCreated"),
        space.name,
      );
      onOpenChange(false);
    },
    onError: (err) => {
      showErrorToast(
        editingSpace ? t("dialogs.spaceUpdateFailed") : t("dialogs.spaceCreateFailed"),
        err,
      );
    },
  });

  const eligibleParents = spaces.filter(
    (s) => s.archivedAt === null && s.id !== editingSpace?.id,
  );

  const handleSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <SpaceIcon color={watchedColor} icon={watchedIcon} size="sm" withChip />
            <span>
              {editingSpace ? t("dialogs.editSpaceTitle") : t("dialogs.createSpaceTitle")}
            </span>
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
                    <FormLabel>{t("dialogs.spaceNameLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        autoFocus
                        placeholder={t("dialogs.spaceNamePlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <SpaceIconPicker
                color={watchedColor}
                colorLabel={t("dialogs.spaceColorLabel")}
                colorLabels={colorLabels}
                icon={watchedIcon}
                iconLabel={t("dialogs.spaceIconLabel")}
                onColorChange={(next) => form.setValue("color", next)}
                onIconChange={(next) => form.setValue("icon", next)}
              />

              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dialogs.parentSpaceLabel")}</FormLabel>
                    <Select<string>
                      onValueChange={(val) =>
                        field.onChange(!val || val === "__none__" ? "__none__" : asSpaceId(val))
                      }
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue>
                            {field.value === "__none__"
                              ? t("dialogs.noParentSpace")
                              : (eligibleParents.find((s) => s.id === field.value)?.name ??
                                t("dialogs.noParentSpace"))}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectPopup>
                        <SelectItem value="__none__">{t("dialogs.noParentSpace")}</SelectItem>
                        {eligibleParents.map((s) => (
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
                name="defaultKind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dialogs.defaultKindLabel")}</FormLabel>
                    <Select
                      onValueChange={(val) => field.onChange((val as DocumentKind) ?? "article")}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue>{kindOptionLabels[watchedDefaultKind]}</SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectPopup>
                        {DOCUMENT_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {kindOptionLabels[k]}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </DialogPanel>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
                {t("common.cancel")}
              </Button>
              <Button
                className="active:scale-[0.985] transition-[transform,colors]"
                loading={mutation.isPending}
                type="submit"
              >
                {editingSpace ? t("common.save") : t("common.create")}
              </Button>
            </DialogFooter>
          </Form>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
