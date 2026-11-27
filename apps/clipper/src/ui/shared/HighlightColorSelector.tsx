import type { HighlightColor } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { Button, cn } from "@inkade/ui/primitives";
import {
  getHighlightColorLabel,
  HIGHLIGHT_COLOR_ORDER,
  HIGHLIGHT_SWATCH_CSS,
} from "./clipper-ui-helpers.ts";

export interface HighlightColorSelectorProps {
  readonly value: HighlightColor;
  readonly onChange: (color: HighlightColor) => void;
  readonly variant?: "labeled" | "compact" | undefined;
  readonly disabled?: boolean | undefined;
}

export function HighlightColorSelector({
  value,
  onChange,
  variant = "labeled",
  disabled = false,
}: HighlightColorSelectorProps) {
  const { t } = useInkadeTranslation();

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-1.5">
        {HIGHLIGHT_COLOR_ORDER.map((color) => {
          const isCurrent = value === color;
          const label = getHighlightColorLabel(t, color);
          return (
            <Button
              aria-label={label}
              aria-pressed={isCurrent}
              className={cn(
                isCurrent
                  ? "border-foreground/35 bg-foreground/10"
                  : "opacity-80 hover:opacity-100",
              )}
              disabled={disabled}
              key={color}
              onClick={() => onChange(color)}
              size="icon-xs"
              title={label}
              variant="outline"
            >
              <span
                className="size-2 rounded-full"
                style={{ background: HIGHLIGHT_SWATCH_CSS[color] }}
              />
            </Button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {HIGHLIGHT_COLOR_ORDER.map((color) => {
        const active = value === color;
        return (
          <Button
            aria-pressed={active}
            className={cn(
              "h-7 gap-1.5 px-2 text-[11.5px]",
              active
                ? "border-foreground/30 bg-foreground/8 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            disabled={disabled}
            key={color}
            onClick={() => onChange(color)}
            size="xs"
            variant="outline"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: HIGHLIGHT_SWATCH_CSS[color] }}
            />
            <span>{getHighlightColorLabel(t, color)}</span>
          </Button>
        );
      })}
    </div>
  );
}
