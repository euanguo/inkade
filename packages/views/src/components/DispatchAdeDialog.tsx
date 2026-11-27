import { zodResolver } from "@hookform/resolvers/zod";
import {
  DEFAULT_HOST_KIND,
  type AdeKind,
  type AdeThreadBinding,
  type SelectionAnchor,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeClient,
  useInkadeDocuments,
  useInkadeSpaces,
  useInkadeThreadBindings,
  useInkadeWhoami,
} from "@inkade/sdk/react";
import {
  AgentComposerPanel,
  type AgentComposerSubmitPayload,
  Badge,
  Button,
  type ComposerDocumentOption,
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
} from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useCopyToClipboard, useDebounceCallback } from "usehooks-ts";
import { z } from "zod";
import { type DispatchThreadTarget, useInkadeViewsContext } from "../context.tsx";
import { buildAdeDispatchPrompt } from "../lib/mcp-snippet.ts";

export type DispatchAdeTarget = DispatchThreadTarget;

export interface DispatchAdeDialogProps {
  readonly target: DispatchAdeTarget | null;
  readonly onClose: () => void;
  readonly onDispatched?: ((binding: AdeThreadBinding) => void) | undefined;
}

interface DispatchAdeFormValues {
  title: string;
  deepLink: string;
}

export function DispatchAdeDialog({
  target,
  onClose,
  onDispatched,
}: DispatchAdeDialogProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const { hostActions, notifier } = useInkadeViewsContext();
  const queryClient = useQueryClient();
  const [adeKind, setAdeKind] = useState<AdeKind>(DEFAULT_HOST_KIND);
  const [copied, setCopied] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();
  const scheduleResetCopied = useDebounceCallback(() => setCopied(false), 1800);

  const schema = useMemo(
    () =>
      z.object({
        title: z.string().trim().min(1, t("validation.required")),
        deepLink: z
          .string()
          .trim()
          .refine((val) => !val || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/.test(val), {
            message: t("validation.urlInvalid"),
          }),
      }),
    [t],
  );

  const form = useForm<DispatchAdeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      deepLink: "",
    },
  });
  const { reset: resetDispatchForm } = form;
  const watchedDeepLink = useWatch({ control: form.control, name: "deepLink" });

  const bindingsQuery = useInkadeThreadBindings({}, { enabled: Boolean(target) });

  const knownHosts = useMemo(() => {
    const hosts: string[] = [];
    for (const binding of bindingsQuery.data ?? []) {
      if (binding.adeKind && !hosts.includes(binding.adeKind)) {
        hosts.push(binding.adeKind);
      }
    }
    return hosts;
  }, [bindingsQuery.data]);

  const docsQuery = useInkadeDocuments({ limit: 150 }, { enabled: Boolean(target) });

  const spacesQuery = useInkadeSpaces({ enabled: Boolean(target) });

  const whoamiQuery = useInkadeWhoami({ enabled: Boolean(target) });

  useEffect(() => {
    if (!target) return;
    const baseTitle =
      target.defaultTitle?.trim() ||
      (target.nodeId || target.selectionAnchor
        ? target.excerpt.replace(/\s+/g, " ").trim().slice(0, 80)
        : "") ||
      target.documentTitle;
    resetDispatchForm({
      title: baseTitle,
      deepLink: "",
    });
    setCopied(false);
  }, [target, resetDispatchForm]);

  const composerDocuments = useMemo((): ComposerDocumentOption[] => {
    const docs = docsQuery.data ?? [];
    const options: ComposerDocumentOption[] = docs
      .filter((doc) => doc.trashedAt === null)
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        kind: doc.kind,
        spaceId: doc.spaceId,
      }));
    if (target && !options.some((item) => item.id === target.documentId)) {
      options.unshift({
        id: target.documentId,
        title: target.documentTitle,
        kind: target.nodeId ? "outline" : "article",
      });
    }
    return options;
  }, [docsQuery.data, target]);

  const initialMentionedDocs = useMemo((): ComposerDocumentOption[] => {
    if (!target) return [];
    const matched = composerDocuments.find((doc) => doc.id === target.documentId);
    return [
      matched ?? {
        id: target.documentId,
        title: target.documentTitle,
        kind: target.nodeId ? "outline" : "article",
      },
    ];
  }, [composerDocuments, target]);

  const docsById = useMemo(
    () => new Map(composerDocuments.map((doc) => [doc.id, doc])),
    [composerDocuments],
  );

  const basePromptPreview = useMemo(() => {
    if (!target) return "";
    return buildAdeDispatchPrompt({
      adeKind,
      documentTitle: target.documentTitle,
      documentId: target.documentId,
      nodeId: target.nodeId,
      excerpt: target.excerpt,
      selectionAnchor: target.selectionAnchor,
    });
  }, [target, adeKind]);

  const copyTextSafe = async (text: string): Promise<boolean> => {
    if (hostActions.copyText) {
      return hostActions.copyText(text);
    }
    return copyToClipboard(text);
  };

  const mutation = useMutation({
    mutationFn: async (payload: AgentComposerSubmitPayload) => {
      if (!target) throw new Error("No target");
      const { title, deepLink } = form.getValues();
      const externalThreadId = `thr_pending_${Date.now().toString(36)}`;
      const mentionSuffix =
        payload.mentionedDocIds.length > 0
          ? payload.mentionedDocIds
              .map((docId) => `[[${docsById.get(docId)?.title ?? docId}]]`)
              .join(" ")
          : "";
      const structuredPrompt = [
        payload.prompt.trim(),
        mentionSuffix ? `@${mentionSuffix}` : "",
        payload.suggestionMode ? "[Track Changes]" : "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      const binding = await client.threadBindings.upsert({
        documentId: target.documentId,
        nodeId: target.nodeId ?? null,
        selectionAnchor: target.selectionAnchor ?? null,
        adeKind: payload.adeKind,
        externalThreadId,
        deepLink: deepLink.trim() ? deepLink.trim() : null,
        title: title.trim() || target.documentTitle,
        status: "queued",
        lastSummary: structuredPrompt || target.excerpt.slice(0, 280) || null,
        unreadResult: false,
      });

      const fullPrompt = buildAdeDispatchPrompt({
        adeKind: payload.adeKind,
        documentTitle: target.documentTitle,
        documentId: target.documentId,
        nodeId: target.nodeId,
        excerpt: target.excerpt,
        selectionAnchor: target.selectionAnchor,
        instruction: [payload.prompt.trim(), mentionSuffix].filter(Boolean).join("\n"),
      });

      return { binding, fullPrompt };
    },
    onSuccess: async ({ binding, fullPrompt }) => {
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
      });
      if (fullPrompt) {
        await copyTextSafe(fullPrompt).catch(() => undefined);
      }
      notifier.success(t("dialogs.bindingCreated"), t("dialogs.bindingCreatedDesc"));
      onDispatched?.(binding);
      onClose();
    },
    onError: (err) => {
      notifier.error(t("dialogs.dispatchFailed"), err);
    },
  });

  const handleCopyPrompt = async (): Promise<void> => {
    if (!basePromptPreview) return;
    try {
      await copyTextSafe(basePromptPreview);
      setCopied(true);
      notifier.success(t("dialogs.bindingCreatedDesc"));
      scheduleResetCopied();
    } catch (err) {
      notifier.error(t("common.pleaseRetry"), err);
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={Boolean(target)}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("dialogs.dispatchTitle")}</DialogTitle>
          <DialogDescription>
            {target?.nodeId
              ? t("dialogs.dispatchDescNode")
              : target?.selectionAnchor
                ? t("dialogs.dispatchDescSelection")
                : t("dialogs.dispatchDescDoc")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <DialogPanel className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("dialogs.threadTitleLabel")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("dialogs.threadTitlePlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <AgentComposerPanel
              availableHosts={knownHosts}
              documents={composerDocuments}
              initialMentionedDocs={initialMentionedDocs}
              key={target ? `${target.documentId}:${target.nodeId ?? "doc"}` : "empty"}
              onAdeKindChange={setAdeKind}
              onSubmit={async (payload) => {
                const valid = await form.trigger();
                if (!valid) return;
                await mutation.mutateAsync(payload);
              }}
              scopeSummary={whoamiQuery.data?.effectiveSummary ?? null}
              selectedAdeKind={adeKind}
              spaces={spacesQuery.data ?? []}
              submitting={mutation.isPending}
            />

            <FormField
              control={form.control}
              name="deepLink"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("dialogs.deepLinkLabel")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("dialogs.deepLinkPlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("dialogs.promptPreviewLabel")}
                </span>
                <div className="flex items-center gap-1.5">
                  <Badge size="sm" variant="outline">
                    {target?.nodeId
                      ? t("dialogs.nodeBound")
                      : target?.selectionAnchor
                        ? t("dialogs.selectionBound")
                        : t("dialogs.docBound")}
                  </Badge>
                  <Button
                    onClick={() => void handleCopyPrompt()}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
                    {copied ? t("common.copied") : t("dialogs.copyPrompt")}
                  </Button>
                </div>
              </div>
              <pre className="max-h-36 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {basePromptPreview}
              </pre>
            </div>
          </DialogPanel>
        </Form>

        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            {t("common.cancel")}
          </Button>
          {watchedDeepLink.trim() && (
            <Button
              onClick={
                hostActions.openExternalUrl
                  ? () => hostActions.openExternalUrl?.(watchedDeepLink.trim())
                  : undefined
              }
              render={
                hostActions.openExternalUrl ? undefined : (
                  <a href={watchedDeepLink.trim()} rel="noreferrer noopener" target="_blank" />
                )
              }
              type="button"
              variant="outline"
            >
              <ExternalLinkIcon />
              {t("dialogs.openLink")}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export type { SelectionAnchor };
