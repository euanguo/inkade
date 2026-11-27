"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useInkadeTranslation } from "@inkade/i18n";
import { ImageIcon, UploadIcon } from "lucide-react";
import type React from "react";
import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../primitives/button.tsx";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../primitives/dialog.tsx";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../primitives/form.tsx";
import { Input } from "../../primitives/input.tsx";
import { normalizeImageUrl } from "../markdown-utils.ts";

export interface ImageInsertDialogProps {
  readonly open: boolean;
  readonly uploading?: boolean | undefined;
  readonly canUpload: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onInsertUrl: (src: string, alt: string) => void;
  readonly onUploadFile: (file: File) => Promise<void>;
}

interface ImageInsertFormValues {
  url: string;
  caption: string;
}

export function ImageInsertDialog({
  open,
  uploading = false,
  canUpload,
  onOpenChange,
  onInsertUrl,
  onUploadFile,
}: ImageInsertDialogProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const schema = useMemo(
    () =>
      z.object({
        url: z
          .string()
          .trim()
          .min(1, t("validation.required"))
          .refine((val) => normalizeImageUrl(val) !== null, {
            message: t("validation.urlInvalid"),
          }),
        caption: z.string(),
      }),
    [t],
  );

  const form = useForm<ImageInsertFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      url: "",
      caption: "",
    },
  });

  const resetForm = (): void => {
    form.reset({ url: "", caption: "" });
    setUploadError(null);
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleClose = (): void => {
    handleOpenChange(false);
  };

  const handleSubmit = form.handleSubmit((values) => {
    const clean = normalizeImageUrl(values.url);
    if (!clean) return;
    onInsertUrl(clean, values.caption.trim());
    handleClose();
  });

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <ImageIcon className="size-4 text-muted-foreground" />
            {t("editor.imageUrlTitle")}
          </DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={(e) => void handleSubmit(e)}>
          <Form {...form}>
            <DialogPanel className="flex flex-col gap-4">
              {canUpload && (
                <div>
                  <input
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setUploadError(null);
                      void onUploadFile(file)
                        .then(() => {
                          handleClose();
                        })
                        .catch((err) => {
                          setUploadError(
                            err instanceof Error ? err.message : t("editor.imageLoadError"),
                          );
                        });
                    }}
                    ref={fileInputRef}
                    type="file"
                  />
                  <Button
                    className="w-full justify-center"
                    loading={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <UploadIcon />
                    {t("editor.imageUploadLocal")}
                  </Button>
                  {uploadError && (
                    <p className="mt-1.5 text-xs text-destructive-foreground">{uploadError}</p>
                  )}
                </div>
              )}

              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="inkade-image-url-input">
                      {t("editor.imageUrlLabel")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoFocus
                        id="inkade-image-url-input"
                        placeholder={t("editor.imageUrlPlaceholder")}
                        size="sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="caption"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="inkade-image-caption-input">
                      {t("editor.imageCaptionLabel")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        id="inkade-image-caption-input"
                        placeholder={t("editor.imageCaptionPlaceholder")}
                        size="sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </DialogPanel>

            <DialogFooter variant="bare">
              <Button onClick={handleClose} size="sm" type="button" variant="ghost">
                {t("common.cancel")}
              </Button>
              <Button size="sm" type="submit">
                {t("editor.imageInsertUrl")}
              </Button>
            </DialogFooter>
          </Form>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
