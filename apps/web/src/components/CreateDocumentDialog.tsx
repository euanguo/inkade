import { asSpaceId, type DocumentKind, type DocumentRecord, type Space, type SpaceId } from "@inkade/core";
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
  Textarea,
} from "@inkade/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { getInkadeClient } from "../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";

export interface CreateDocumentDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spaces: readonly Space[];
  readonly defaultSpaceId?: SpaceId | undefined;
  readonly defaultKind?: DocumentKind | undefined;
  readonly onCreated?: ((doc: DocumentRecord) => void) | undefined;
}

export function CreateDocumentDialog({
  open,
  onOpenChange,
  spaces,
  defaultSpaceId,
  defaultKind = "article",
  onCreated,
}: CreateDocumentDialogProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const queryClient = useQueryClient();
  const activeSpaces = useMemo(
    () => spaces.filter((s) => s.archivedAt === null),
    [spaces],
  );

  const schema = useMemo(
    () =>
      z.object({
        title: z.string().trim().min(1, t("validation.required")),
        spaceId: z.string().trim().min(1, t("validation.required")),
        kind: z.enum(["article", "clip"]),
        tagsText: z.string(),
        contentMarkdown: z.string(),
      }),
    [t],
  );

  type FormValues = z.infer<typeof schema>;

  const fallbackSpace =
    defaultSpaceId ??
    activeSpaces.find((s) => s.slug === "research")?.id ??
    activeSpaces[0]?.id ??
    "";

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      spaceId: fallbackSpace,
      kind: defaultKind === "clip" ? "clip" : "article",
      tagsText: "",
      contentMarkdown: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      title: "",
      spaceId:
        defaultSpaceId ??
        activeSpaces.find((s) => s.slug === "research")?.id ??
        activeSpaces[0]?.id ??
        "",
      kind: defaultKind === "clip" ? "clip" : "article",
      tagsText: "",
      contentMarkdown: "",
    });
  }, [open, defaultSpaceId, defaultKind, activeSpaces, form]);

  const selectedKind = useWatch({ control: form.control, name: "kind" });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!values.spaceId) throw new Error("Missing spaceId");
      const tags = values.tagsText
        .split(/[,\s]+/)
        .map((tagItem) => tagItem.trim().replace(/^#/, ""))
        .filter(Boolean);
      return getInkadeClient().documents.create({
        spaceId: asSpaceId(values.spaceId),
        kind: values.kind,
        title: values.title.trim(),
        contentMarkdown: values.contentMarkdown.trim()
          ? values.contentMarkdown
          : `# ${values.title.trim()}\n\n`,
        tags,
      });
    },
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      showSuccessToast(t("dialogs.docCreated"), doc.title);
      onOpenChange(false);
      onCreated?.(doc);
    },
    onError: (err) => {
      showErrorToast(t("dialogs.docCreateFailed"), err);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("dialogs.createDocTitle")}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={(e) => void handleSubmit(e)}>
          <Form {...form}>
            <DialogPanel className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dialogs.docTitleLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        autoFocus
                        placeholder={t("dialogs.docTitlePlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="spaceId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("dialogs.spaceLabel")}</FormLabel>
                      <Select<string>
                        onValueChange={(val) => field.onChange(val ? asSpaceId(val) : "")}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue>
                              {activeSpaces.find((s) => s.id === field.value)?.name ?? field.value}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectPopup>
                          {activeSpaces.map((s) => (
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
                      <FormLabel>{t("dialogs.kindLabel")}</FormLabel>
                      <Select
                        onValueChange={(val) =>
                          field.onChange((val as "article" | "clip") ?? "article")
                        }
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue>
                              {selectedKind === "clip"
                                ? t("common.kindClipCreateOption")
                                : t("common.kindArticleCreateOption")}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectPopup>
                          <SelectItem value="article">
                            {t("common.kindArticleCreateOption")}
                          </SelectItem>
                          <SelectItem value="clip">{t("common.kindClipCreateOption")}</SelectItem>
                        </SelectPopup>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="tagsText"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dialogs.tagsLabel")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("dialogs.tagsPlaceholder")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contentMarkdown"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dialogs.initialMarkdownLabel")}</FormLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-28 font-mono text-xs"
                        placeholder={t("dialogs.initialMarkdownPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </DialogPanel>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
                {t("common.cancel")}
              </Button>
              <Button loading={mutation.isPending} type="submit">
                {t("dialogs.createDocAction")}
              </Button>
            </DialogFooter>
          </Form>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
