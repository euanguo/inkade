import { asSpaceId, type Space, type SpaceId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Field,
  FieldLabel,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  SpaceIcon,
} from "@inkade/ui/primitives";

const SPACE_UNSPECIFIED_VALUE = "__unspecified__";

export interface SpaceSelectFieldProps {
  readonly id: string;
  readonly label: string;
  readonly labelClassName?: string | undefined;
  readonly spaces: readonly Space[];
  readonly value: SpaceId | "";
  readonly onChange: (spaceId: SpaceId | "") => void;
  readonly includeUnspecified?: boolean | undefined;
  readonly showUnspecifiedLabelWhenEmpty?: boolean | undefined;
}

export function SpaceSelectField({
  id,
  label,
  labelClassName = "text-[11.5px] text-muted-foreground",
  spaces,
  value,
  onChange,
  includeUnspecified = false,
  showUnspecifiedLabelWhenEmpty = false,
}: SpaceSelectFieldProps) {
  const { t } = useInkadeTranslation();
  const selectedSpace = value ? spaces.find((s) => s.id === value) : undefined;
  const emptyFallback =
    includeUnspecified || showUnspecifiedLabelWhenEmpty ? t("common.unspecified") : "";

  return (
    <Field className="w-full min-w-0">
      <FieldLabel className={labelClassName} htmlFor={id}>
        {label}
      </FieldLabel>
      <Select<string>
        onValueChange={(next) => {
          if (next === null) return;
          if (includeUnspecified && next === SPACE_UNSPECIFIED_VALUE) {
            onChange("");
            return;
          }
          onChange(next ? asSpaceId(next) : "");
        }}
        value={includeUnspecified ? value || SPACE_UNSPECIFIED_VALUE : value}
      >
        <SelectTrigger className="w-full min-w-0" id={id} size="sm">
          <SelectValue className="min-w-0 truncate">
            {selectedSpace ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <SpaceIcon
                  color={selectedSpace.color}
                  icon={selectedSpace.icon}
                  size="xs"
                  tone="mono"
                />
                <span className="truncate">{selectedSpace.name}</span>
              </span>
            ) : (
              emptyFallback
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {includeUnspecified ? (
            <SelectItem value={SPACE_UNSPECIFIED_VALUE}>{t("common.unspecified")}</SelectItem>
          ) : null}
          {spaces.map((space) => (
            <SelectItem key={space.id} value={space.id}>
              <span className="flex min-w-0 items-center gap-1.5">
                <SpaceIcon color={space.color} icon={space.icon} size="xs" tone="mono" />
                <span className="truncate">{space.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Field>
  );
}
