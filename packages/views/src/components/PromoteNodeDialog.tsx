import {
  asSpaceId,
  type DocumentId,
  type DocumentRecord,
  type OutlineNode,
  type Space,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import { useInkadeClient } from "@inkade/sdk/react";
import {
  Button,
  Dialog,
  DialogDescription,
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
  Switch,
} from "@inkade/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileOutputIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useInkadeViewsContext } from "../context.tsx";

export interface PromoteNodeTarget {
  readonly documentId: DocumentId;
  readonly rootNode: OutlineNode;
  readonly subtree: readonly OutlineNode[];
}

export interface PromoteNodeDialogProps {
  readonly target: PromoteNodeTarget | null;
  readonly spaces: readonly Space[];
  readonly onClose: () => void;
  readonly onPromoted?: ((article: DocumentRecord) => void) | undefined;
}

export function PromoteNodeDialog({
  target,
  spaces,
  onClose,
  onPromoted,
}: PromoteNodeDialogProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const { notifier } = useInkadeViewsContext();
  const queryClient = useQueryClient();
  const activeSpaces = useMemo(
    () => spaces.filter((s) => s.archivedAt === null),
    [spaces],
  );

  const schema = useMemo(
    () =>
      z.object({
        title: z.string().trim().min(1, t("validation.required")),
        targetSpaceId: z.string().trim().min(1, t("validation.required")),
        tagsText: z.string(),
        keepLinkInNode: z.boolean(),
      }),
    [t],
  );
  type PromoteFormValues = z.infer<typeof schema>;

  const form = useForm<PromoteFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      targetSpaceId: "",
      tagsText: "",
      keepLinkInNode: true,
    },
  });

  useEffect(() => {
    if (!target) return;
    const raw = (target.rootNode.contentText || target.rootNode.contentMarkdown).trim();
    const defaultSpace =
      activeSpaces.find((s) => s.slug === "research")?.id ??
      activeSpaces.find((s) => s.slug === "projects")?.id ??
      activeSpaces[0]?.id ??
      "";
    form.reset({
      title: raw.slice(0, 120) || t("dialogs.defaultPromotedTitle"),
      targetSpaceId: defaultSpace,
      tagsText: "",
      keepLinkInNode: true,
    });
  }, [target, activeSpaces, t, form]);

  const mutation = useMutation({
    mutationFn: async (values: PromoteFormValues) => {
      if (!target || !values.targetSpaceId) throw new Error("Missing promote target");
      const tags = values.tagsText
        .split(/[,\s]+/)
        .map((tagItem) => tagItem.trim().replace(/^#/, ""))
        .filter(Boolean);
      return client.outlineNodes.promote(target.rootNode.id, {
        documentId: target.documentId,
        targetSpaceId: asSpaceId(values.targetSpaceId),
        title: values.title.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        keepLinkInNode: values.keepLinkInNode,
      });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] });
      if (target) {
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.outlineNodes(target.documentId),
        });
      }
      notifier.success(t("dialogs.promotedToast"), res.article.title);
      onClose();
      onPromoted?.(res.article);
    },
    onError: (err) => {
      notifier.error(t("dialogs.promoteFailed"), err);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={Boolean(target)}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{t("dialogs.promoteTitle")}</DialogTitle>
          <DialogDescription>
            {t("dialogs.promoteDesc", { count: target?.subtree.length ?? 0 })}
          </DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={(e) => void handleSubmit(e)}>
          <Form {...form}>
            <DialogPanel className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dialogs.articleTitleLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        autoFocus
                        placeholder={t("dialogs.articleTitlePlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="targetSpaceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dialogs.targetSpaceLabel")}</FormLabel>
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
                name="tagsText"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dialogs.tagsOptionalLabel")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("dialogs.tagsOptionalPlaceholder")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="keepLinkInNode"
                render={({ field }) => (
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{t("dialogs.keepWikilinkTitle")}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("dialogs.keepWikilinkDesc")}
                      </span>
                    </div>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </label>
                )}
              />
            </DialogPanel>

            <DialogFooter>
              <Button onClick={onClose} type="button" variant="outline">
                {t("common.cancel")}
              </Button>
              <Button loading={mutation.isPending} type="submit">
                <FileOutputIcon />
                {t("dialogs.confirmPromote")}
              </Button>
            </DialogFooter>
          </Form>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
