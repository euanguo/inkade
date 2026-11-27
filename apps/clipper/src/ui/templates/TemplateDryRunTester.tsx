import type { RenderedClipPlan } from "@inkade/clipper-core/templates";
import type { ClipperTemplate } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { Badge, Button, GridDisclosure, Input } from "@inkade/ui/primitives";
import { Globe } from "lucide-react";

export interface TemplateDryRunPreview {
  readonly matched: { readonly template: ClipperTemplate | null; readonly autoMatched: boolean } | null;
  readonly plan: RenderedClipPlan | null;
  readonly error: string | null;
}

export interface TemplateDryRunTesterProps {
  readonly open: boolean;
  readonly selectedTemplateId: string;
  readonly testUrl: string;
  readonly preview: TemplateDryRunPreview | null;
  readonly onChangeTestUrl: (url: string) => void;
  readonly onLoadActiveTab: () => void;
}

export function TemplateDryRunTester({
  open,
  selectedTemplateId,
  testUrl,
  preview,
  onChangeTestUrl,
  onLoadActiveTab,
}: TemplateDryRunTesterProps) {
  const { t } = useInkadeTranslation();

  return (
    <GridDisclosure open={open}>
      <div className="flex flex-col gap-2.5 rounded-md border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">
            {t("clipper.templateTesterTitle")}
          </span>
          <Button onClick={onLoadActiveTab} size="xs" variant="outline">
            <Globe className="size-3" />
            <span>{t("clipper.templateTesterLoadTabBtn")}</span>
          </Button>
        </div>
        <Input
          className="font-mono text-xs"
          onChange={(e) => onChangeTestUrl(e.target.value)}
          placeholder={t("clipper.templateTesterUrlPlaceholder")}
          size="sm"
          type="url"
          value={testUrl}
        />
        {preview?.error ? (
          <span className="text-xs text-destructive-foreground">{preview.error}</span>
        ) : preview?.plan ? (
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                size="sm"
                variant={
                  preview.matched?.template?.id === selectedTemplateId ? "default" : "secondary"
                }
              >
                {preview.matched?.template
                  ? t("clipper.templateTesterMatchedLabel", {
                      name: preview.matched.template.name,
                    })
                  : t("clipper.templateTesterNoMatch")}
              </Badge>
              <span className="text-muted-foreground">{preview.plan.title}</span>
            </div>
            <pre className="m-0 max-h-36 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[11px] text-foreground [scrollbar-gutter:stable]">
              {preview.plan.contentMarkdown.slice(0, 900)}
            </pre>
          </div>
        ) : null}
      </div>
    </GridDisclosure>
  );
}
