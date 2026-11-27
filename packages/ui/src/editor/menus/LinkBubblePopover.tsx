"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useInkadeTranslation } from "@inkade/i18n";
import { type Editor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  PencilIcon,
  UnlinkIcon,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useCopyToClipboard, useDebounceCallback } from "usehooks-ts";
import { z } from "zod";
import { Button } from "../../primitives/button.tsx";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "../../primitives/form.tsx";
import { Input } from "../../primitives/input.tsx";
import { normalizeExternalUrl } from "../markdown-utils.ts";

export interface LinkBubblePopoverProps {
  readonly editor: Editor;
  readonly disabled?: boolean | undefined;
}

interface LinkDraftFormValues {
  href: string;
}

export function LinkBubblePopover({
  editor,
  disabled = false,
}: LinkBubblePopoverProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();
  const scheduleResetCopied = useDebounceCallback(() => setCopied(false), 1400);

  const schema = useMemo(
    () =>
      z.object({
        href: z
          .string()
          .refine((val) => !val.trim() || normalizeExternalUrl(val) !== null, {
            message: t("validation.urlInvalid"),
          }),
      }),
    [t],
  );

  const form = useForm<LinkDraftFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { href: "" },
  });

  const href = useEditorState({
    editor,
    selector: (ctx) => String(ctx.editor.getAttributes("link").href ?? ""),
  });

  const handleCopy = async (): Promise<void> => {
    if (!href) return;
    const ok = await copyToClipboard(href);
    if (ok) {
      setCopied(true);
      scheduleResetCopied();
    }
  };

  const handleApplyLink = form.handleSubmit((values) => {
    const clean = normalizeExternalUrl(values.href);
    if (clean) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: clean }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setEditing(false);
  });

  return (
    <BubbleMenu
      appendTo={() => document.body}
      className="z-50"
      editor={editor}
      options={{
        placement: "bottom-start",
        offset: 6,
        flip: true,
        shift: { padding: 12 },
        ...(typeof window !== "undefined" ? { scrollTarget: window } : {}),
        onHide: () => setEditing(false),
      }}
      pluginKey="inkadeLinkBubble"
      shouldShow={({ editor: ed, state }) => {
        if (disabled || !ed.isEditable || ed.view.dragging) return false;
        return state.selection.empty && ed.isActive("link");
      }}
      updateDelay={80}
    >
      <div
        className="not-typeset flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-1 rounded-lg border border-[var(--border-overlay)] bg-popover/98 px-2 py-1 text-popover-foreground shadow-[var(--shadow-overlay)] backdrop-blur-md"
        data-slot="editor-link-popover"
        data-testid="editor-link-popover"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).tagName !== "INPUT") {
            e.preventDefault();
          }
        }}
      >
        {editing ? (
          <form
            className="flex flex-col gap-1"
            noValidate
            onSubmit={(e) => void handleApplyLink(e)}
          >
            <Form {...form}>
              <FormField
                control={form.control}
                name="href"
                render={({ field }) => (
                  <FormItem className="gap-1">
                    <div className="flex items-center gap-1.5">
                      <FormControl>
                        <Input
                          {...field}
                          autoFocus
                          className="w-56 max-w-[56vw] text-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditing(false);
                            }
                          }}
                          placeholder={t("editor.bubbleLinkPlaceholder")}
                          size="sm"
                        />
                      </FormControl>
                      <Button size="sm" type="submit">
                        {t("editor.bubbleApplyLink")}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </form>
        ) : (
          <>
            <a
              className="max-w-52 truncate px-1 text-xs font-medium text-primary hover:underline"
              href={href}
              rel="noreferrer noopener"
              target="_blank"
            >
              {href}
            </a>
            <Button
              aria-label={t("editor.linkOpenAria")}
              render={<a href={href} rel="noreferrer noopener" target="_blank" />}
              size="icon-xs"
              variant="ghost"
            >
              <ExternalLinkIcon className="size-3.5" />
            </Button>
            <Button
              aria-label={t("editor.linkCopyAria")}
              onClick={() => void handleCopy()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
            </Button>
            <Button
              aria-label={t("editor.linkEditAria")}
              onClick={() => {
                form.reset({ href });
                setEditing(true);
              }}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <PencilIcon className="size-3.5" />
            </Button>
            <Button
              aria-label={t("editor.bubbleRemoveLink")}
              onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <UnlinkIcon className="size-3.5 text-destructive-foreground" />
            </Button>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
