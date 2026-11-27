import { useInkadeTranslation } from "@inkade/i18n";
import { Button } from "@inkade/ui/primitives";
import { CheckCircle2, ExternalLink } from "lucide-react";
import type { ClipperUiStatus } from "./clipper-ui-helpers.ts";

export interface ClipperStatusBannerProps {
  readonly status: ClipperUiStatus | null;
  readonly onOpenDoc?: ((docId: string) => void) | undefined;
  readonly showSuccessIcon?: boolean | undefined;
}

export function ClipperStatusBanner({
  status,
  onOpenDoc,
  showSuccessIcon = false,
}: ClipperStatusBannerProps) {
  const { t } = useInkadeTranslation();
  if (!status) return null;

  return (
    <div className={`ink-status ${status.kind}`}>
      {showSuccessIcon && status.kind === "success" ? (
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5 shrink-0" />
          <span>{status.text}</span>
        </span>
      ) : (
        <span>{status.text}</span>
      )}
      {status.docId && onOpenDoc ? (
        <Button
          className="h-auto px-1 py-0 text-xs text-current"
          onClick={() => onOpenDoc(status.docId!)}
          size="xs"
          variant="link"
        >
          <span>{t("clipper.openInInkade")}</span>
          <ExternalLink className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}
