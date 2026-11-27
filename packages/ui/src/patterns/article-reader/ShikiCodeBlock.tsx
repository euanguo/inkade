"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { CheckIcon, CopyIcon } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useCopyToClipboard, useDebounceCallback } from "usehooks-ts";
import {
  getCachedShikiHtml,
  highlightCodeToHtml,
  type ShikiThemeKind,
} from "../../editor/shiki-highlighter.ts";
import { Button } from "../../primitives/button.tsx";

export interface ShikiCodeBlockProps {
  readonly code: string;
  readonly language: string;
  readonly theme: ShikiThemeKind;
}

export const ShikiCodeBlock = React.memo(function ShikiCodeBlock({
  code,
  language,
  theme,
}: ShikiCodeBlockProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const displayLanguage = language || "text";
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(() =>
    getCachedShikiHtml(code, displayLanguage, theme),
  );
  const [copied, setCopied] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();
  const scheduleResetCopied = useDebounceCallback(() => setCopied(false), 1600);

  useEffect(() => {
    const cached = getCachedShikiHtml(code, displayLanguage, theme);
    if (cached !== null) {
      setHighlightedHtml(cached);
      return;
    }

    let cancelled = false;
    void highlightCodeToHtml(code, displayLanguage, theme).then((html) => {
      if (!cancelled) {
        setHighlightedHtml(html);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, displayLanguage, theme]);

  const handleCopy = async (): Promise<void> => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      scheduleResetCopied();
    }
  };

  return (
    <div className="my-5 overflow-hidden rounded-xl border bg-code text-code-foreground">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{displayLanguage}</span>
        <Button onClick={() => void handleCopy()} size="xs" variant="ghost">
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
      {highlightedHtml ? (
        <div
          className="overflow-x-auto p-3.5 text-sm leading-relaxed [&_pre]:m-0! [&_pre]:border-0! [&_pre]:bg-transparent! [&_pre]:p-0!"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="m-0! overflow-x-auto border-0! bg-transparent! p-3.5! text-sm">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});
