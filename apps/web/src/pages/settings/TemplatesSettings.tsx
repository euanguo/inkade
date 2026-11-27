import {
  DOCUMENT_KINDS,
  type DocumentKind,
  type DocumentTemplate,
  type TemplateId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeSpaces,
  useInkadeSpaceSchema,
  useInkadeTemplates,
  useUpsertSpaceSchemaMutation,
} from "@inkade/sdk/react";
import { SpaceSchemaEditor } from "@inkade/views";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Badge,
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DocumentKindIcon,
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
  Textarea,
} from "@inkade/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { SettingsGroupSkeleton } from "./SettingsSkeletons.tsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { getInkadeClient } from "../../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import {
  DangerZone,
  SettingRow,
  SettingsGroup,
  SettingsSectionHeader,
} from "./SettingRow.tsx";

export function TemplatesSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const queryClient = useQueryClient();

  const templatesQuery = useInkadeTemplates();
  const spacesQuery = useInkadeSpaces();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
  const anchorSpaceId = spacesQuery.data?.[0]?.id;
  const templateSchemaQuery = useInkadeSpaceSchema(
    editingTemplate ? anchorSpaceId : undefined,
    editingTemplate?.id,
  );
  const upsertTemplateSchemaMutation = useUpsertSpaceSchemaMutation({
    onSuccess: () => showSuccessToast(t("schema.savedToast")),
    onError: (err) => showErrorToast(t("schema.saveFailedToast"), err),
  });

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t("validation.required")),
        kind: z.enum(DOCUMENT_KINDS),
        description: z.string(),
        contentMarkdown: z.string(),
        isDefaultDaily: z.boolean(),
      }),
    [t],
  );
  type TemplateFormValues = z.infer<typeof schema>;

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      kind: "article",
      description: "",
      contentMarkdown: "",
      isDefaultDaily: false,
    },
  });
  const watchedKind = useWatch({ control: form.control, name: "kind" });

  const [selectedDeleteId, setSelectedDeleteId] = useState<string>("__none__");
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<DocumentTemplate | null>(null);

  const templates = templatesQuery.data ?? [];

  const kindOptionLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutlineLabel"),
    article: t("common.kindArticleLabel"),
    clip: t("common.kindClipLabel"),
  };

  const openCreateDialog = (): void => {
    setEditingTemplate(null);
    form.reset({
      name: "",
      kind: "article",
      description: "",
      contentMarkdown: "",
      isDefaultDaily: false,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (tpl: DocumentTemplate): void => {
    setEditingTemplate(tpl);
    form.reset({
      name: tpl.name,
      kind: tpl.kind,
      description: tpl.description,
      contentMarkdown: tpl.contentMarkdown,
      isDefaultDaily: tpl.isDefaultDaily,
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: TemplateFormValues) => {
      const client = getInkadeClient();
      if (editingTemplate) {
        return client.templates.update(editingTemplate.id, {
          name: values.name.trim(),
          kind: values.kind,
          description: values.description.trim(),
          contentMarkdown: values.contentMarkdown,
          isDefaultDaily: values.isDefaultDaily,
        });
      }
      return client.templates.create({
        name: values.name.trim(),
        kind: values.kind,
        description: values.description.trim(),
        contentMarkdown: values.contentMarkdown,
        isDefaultDaily: values.isDefaultDaily,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "templates"] });
      setDialogOpen(false);
      showSuccessToast(
        editingTemplate ? t("settings.templateUpdated") : t("settings.templateCreated"),
      );
    },
    onError: (err) => showErrorToast(t("settings.templateSaveFailed"), err),
  });

  const handleSubmit = form.handleSubmit((values) => {
    saveMutation.mutate(values);
  });

  const setDefaultDailyMutation = useMutation({
    mutationFn: (tpl: DocumentTemplate) =>
      getInkadeClient().templates.update(tpl.id, { isDefaultDaily: !tpl.isDefaultDaily }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "templates"] });
      showSuccessToast(t("settings.templateUpdated"));
    },
    onError: (err) => showErrorToast(t("settings.templateSaveFailed"), err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: TemplateId) => getInkadeClient().templates.delete(id),
    onSuccess: () => {
      setConfirmDeleteTarget(null);
      setSelectedDeleteId("__none__");
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "templates"] });
      showSuccessToast(t("settings.templateDeleted"));
    },
    onError: (err) => showErrorToast(t("settings.templateDeleteFailed"), err),
  });

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        actions={
          <Button onClick={openCreateDialog} size="sm">
            <PlusIcon />
            {t("settings.createTemplate")}
          </Button>
        }
        description={t("settings.templatesDesc")}
        title={t("settings.templatesTitle")}
      />

      {templatesQuery.isPending ? (
        <SettingsGroupSkeleton rows={3} variant="template" />
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-xs text-muted-foreground">
          {t("settings.noTemplates")}
        </div>
      ) : (
        <SettingsGroup>
          {templates.map((tpl) => (
            <div
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5"
              key={tpl.id}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <DocumentKindIcon kind={tpl.kind} size="sm" />
                  <span className="text-sm font-medium text-foreground">{tpl.name}</span>
                  <Badge size="sm" variant="outline">
                    {tpl.kind}
                  </Badge>
                  {tpl.isDefaultDaily ? (
                    <Badge size="sm" variant="info">
                      <SparklesIcon className="size-3" />
                      {t("settings.defaultDailyBadge")}
                    </Badge>
                  ) : null}
                </div>
                {tpl.description ? (
                  <p className="text-xs text-muted-foreground">{tpl.description}</p>
                ) : null}
                {tpl.contentMarkdown ? (
                  <pre className="mt-1.5 line-clamp-2 max-w-full overflow-hidden rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {tpl.contentMarkdown}
                  </pre>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {!tpl.isDefaultDaily ? (
                  <Button
                    loading={setDefaultDailyMutation.isPending}
                    onClick={() => setDefaultDailyMutation.mutate(tpl)}
                    size="xs"
                    variant="ghost"
                  >
                    {t("settings.setDefaultDaily")}
                  </Button>
                ) : null}
                <Button onClick={() => openEditDialog(tpl)} size="xs" variant="outline">
                  <PencilIcon />
                  {t("common.edit")}
                </Button>
              </div>
            </div>
          ))}
        </SettingsGroup>
      )}

      {templates.length > 0 ? (
        <DangerZone>
          <SettingRow
            description={t("settings.deleteTemplateDesc")}
            title={t("settings.deleteTemplateTitle")}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Select
                onValueChange={(val) => setSelectedDeleteId(val ?? "__none__")}
                value={selectedDeleteId}
              >
                <SelectTrigger className="w-48" size="sm">
                  <SelectValue>
                    {selectedDeleteId === "__none__"
                      ? t("settings.selectTemplateToDelete")
                      : (templates.find((item) => item.id === selectedDeleteId)?.name ??
                        t("settings.selectTemplateToDelete"))}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="__none__">{t("settings.selectTemplateToDelete")}</SelectItem>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button
                disabled={selectedDeleteId === "__none__"}
                onClick={() => {
                  const target = templates.find((item) => item.id === selectedDeleteId) ?? null;
                  if (target) setConfirmDeleteTarget(target);
                }}
                size="sm"
                variant="destructive-outline"
              >
                <Trash2Icon />
                {t("common.delete")}
              </Button>
            </div>
          </SettingRow>
        </DangerZone>
      ) : null}

      {/* Create / Edit Template Dialog */}
      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? t("settings.editTemplateTitle") : t("settings.createTemplateTitle")}
            </DialogTitle>
          </DialogHeader>
          <form noValidate onSubmit={(e) => void handleSubmit(e)}>
            <Form {...form}>
              <DialogPanel className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>{t("settings.templateNameLabel")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            autoFocus
                            placeholder={t("settings.templateNamePlaceholder")}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="kind"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.templateKindLabel")}</FormLabel>
                        <FormControl>
                          <Select
                            onValueChange={(val) =>
                              field.onChange((val as DocumentKind) ?? "article")
                            }
                            value={field.value}
                          >
                            <SelectTrigger>
                              <SelectValue>{kindOptionLabels[watchedKind]}</SelectValue>
                            </SelectTrigger>
                            <SelectPopup>
                              {DOCUMENT_KINDS.map((k) => (
                                <SelectItem key={k} value={k}>
                                  {kindOptionLabels[k]}
                                </SelectItem>
                              ))}
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
                    <FormItem>
                      <FormLabel>{t("settings.templateDescLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("settings.templateDescPlaceholder")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isDefaultDaily"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-2.5">
                        <div className="space-y-0.5">
                          <div className="text-xs font-medium text-foreground">
                            {t("settings.templateIsDefaultDailyLabel")}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {t("settings.templateIsDefaultDailyDesc")}
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            aria-label={t("settings.templateIsDefaultDailyLabel")}
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contentMarkdown"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.templateContentLabel")}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          className="min-h-40 font-mono text-xs"
                          placeholder={t("settings.templateContentPlaceholder")}
                        />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">
                        {t("settings.templateVariablesHint", {
                          date: "{{date}}",
                          space: "{{space}}",
                          title: "{{title}}",
                        })}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {editingTemplate && anchorSpaceId ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-border/80 bg-muted/20 p-3">
                    <div>
                      <div className="text-xs font-semibold text-foreground">
                        {t("schema.templateSectionTitle")}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {t("schema.templateSectionDesc")}
                      </p>
                    </div>
                    <SpaceSchemaEditor
                      fields={templateSchemaQuery.data?.fields ?? []}
                      onSave={async (fields) => {
                        await upsertTemplateSchemaMutation.mutateAsync({
                          spaceId: anchorSpaceId,
                          input: { templateId: editingTemplate.id, fields: [...fields] },
                        });
                      }}
                      saving={upsertTemplateSchemaMutation.isPending}
                    />
                  </div>
                ) : null}
              </DialogPanel>
              <DialogFooter>
                <Button onClick={() => setDialogOpen(false)} type="button" variant="outline">
                  {t("common.cancel")}
                </Button>
                <Button loading={saveMutation.isPending} type="submit">
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </Form>
          </form>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteTarget(null);
        }}
        open={Boolean(confirmDeleteTarget)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.deleteTemplateConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.deleteTemplateConfirmDesc", {
                name: confirmDeleteTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common.cancel")}
            </AlertDialogClose>
            <Button
              loading={deleteMutation.isPending}
              onClick={() => {
                if (confirmDeleteTarget) {
                  deleteMutation.mutate(confirmDeleteTarget.id);
                }
              }}
              variant="destructive"
            >
              {t("common.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
