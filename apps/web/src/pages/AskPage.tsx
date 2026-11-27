import { useInkadeTranslation } from "@inkade/i18n";
import { SparklesIcon } from "lucide-react";
import type React from "react";
import { AskInkadePanel } from "../components/ask/AskInkadePanel.tsx";

export function AskPage(): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-4 overflow-hidden px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
      <header className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-5 text-primary" />
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {t("ask.pageTitle")}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">{t("ask.pageSubtitle")}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <AskInkadePanel variant="page" />
      </div>
    </div>
  );
}
