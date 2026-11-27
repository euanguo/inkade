import {
  formatPropertyScalar,
  type DocumentId,
  type DocumentRecord,
  type DocumentSummary,
  type PropertyFieldDefinition,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  DocumentKindIcon,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  GridDisclosure,
  Input,
  Popover,
  PopoverPopup,
  PopoverTrigger,
  PropertyOptionPill,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@inkade/ui";
import { ExternalLinkIcon, Link2Icon, PlusIcon, XIcon } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { PropertyPresetDescriptor } from "../../lib/typed-properties.ts";

export interface DocumentPropertiesPanelProps {
  readonly open: boolean;
  readonly doc: DocumentRecord;
  readonly schemaFields?: readonly PropertyFieldDefinition[] | undefined;
  readonly workspaceDocs?: readonly DocumentSummary[] | undefined;
  readonly onOpenDocument?: ((docId: DocumentId) => void) | undefined;
  readonly customProps: ReadonlyArray<readonly [string, unknown]>;
  readonly availablePresets: readonly PropertyPresetDescriptor[];
  readonly editingPropKey: string | null;
  readonly editingPropVal: string;
  readonly addPropForm: UseFormReturn<{ key: string; value: string }>;
  readonly onSetEditingProp: (key: string | null, val?: string) => void;
  readonly onSetEditingPropVal: (val: string) => void;
  readonly onUpdateProps: (next: Record<string, unknown> | null) => void;
}

function SchemaTypedFieldControl({
  field,
  value,
  workspaceDocs,
  onChangeValue,
  onOpenDocument,
}: {
  readonly field: PropertyFieldDefinition;
  readonly value: unknown;
  readonly workspaceDocs: readonly DocumentSummary[];
  readonly onChangeValue: (next: unknown) => void;
  readonly onOpenDocument?: ((docId: DocumentId) => void) | undefined;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [relationQuery, setRelationQuery] = useState("");
  const [relationOpen, setRelationOpen] = useState(false);

  if (field.type === "select") {
    const strVal = typeof value === "string" ? value : "__none__";
    const activeOpt = field.options.find((o) => o.value === strVal);
    return (
      <Select<string>
        onValueChange={(nextVal) =>
          onChangeValue(!nextVal || nextVal === "__none__" ? undefined : nextVal)
        }
        value={strVal}
      >
        <SelectTrigger className="h-7 flex-1 text-xs" size="sm">
          <SelectValue>
            {activeOpt ? (
              <PropertyOptionPill color={activeOpt.color} label={activeOpt.label} />
            ) : strVal !== "__none__" ? (
              strVal
            ) : (
              t("schema.selectOptionPlaceholder")
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="__none__">{t("schema.selectOptionPlaceholder")}</SelectItem>
          {field.options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <PropertyOptionPill color={opt.color} label={opt.label} />
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    );
  }

  if (field.type === "multi_select") {
    const selectedValues = Array.isArray(value) ? value.map(formatPropertyScalar) : [];
    const selectedSet = new Set(selectedValues);
    return (
      <div className="flex flex-1 flex-wrap items-center justify-end gap-1">
        {field.options.map((opt) => {
          const active = selectedSet.has(opt.value);
          return (
            <button
              className={`cursor-pointer rounded-md transition-opacity ${active ? "opacity-100" : "opacity-45 hover:opacity-80"}`}
              key={opt.value}
              onClick={() => {
                const next = active
                  ? selectedValues.filter((v) => v !== opt.value)
                  : [...selectedValues, opt.value];
                onChangeValue(next.length > 0 ? next : undefined);
              }}
              type="button"
            >
              <PropertyOptionPill color={opt.color} label={opt.label} />
            </button>
          );
        })}
        {field.options.length === 0 && (
          <Input
            className="h-7 flex-1 text-xs"
            defaultValue={selectedValues.join(", ")}
            onBlur={(e) => {
              const parts = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              onChangeValue(parts.length > 0 ? parts : undefined);
            }}
            placeholder={t("schema.addTagOptionPlaceholder")}
            size="sm"
          />
        )}
      </div>
    );
  }

  if (field.type === "checkbox") {
    const checked = Boolean(value);
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          {checked ? t("schema.checkboxEnabled") : t("schema.checkboxDisabled")}
        </span>
        <Switch checked={checked} onCheckedChange={(next) => onChangeValue(next)} />
      </div>
    );
  }

  if (field.type === "date") {
    const dateVal = typeof value === "string" ? value.slice(0, 10) : "";
    return (
      <Input
        className="h-7 w-40 font-mono text-xs"
        onChange={(e) => onChangeValue(e.target.value ? e.target.value : undefined)}
        size="sm"
        type="date"
        value={dateVal}
      />
    );
  }

  if (field.type === "number") {
    const strNum =
      typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
    return (
      <div className="flex items-center gap-1">
        <Input
          className="h-7 w-28 text-right font-mono text-xs tabular-nums"
          defaultValue={strNum}
          key={`${field.key}:${strNum}`}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              onChangeValue(undefined);
              return;
            }
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) {
              onChangeValue(parsed);
            }
          }}
          size="sm"
          type="number"
        />
        {field.numberUnit && (
          <span className="text-[11px] text-muted-foreground">{field.numberUnit}</span>
        )}
      </div>
    );
  }

  if (field.type === "url") {
    const urlStr = typeof value === "string" ? value : "";
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Input
          className="h-7 min-w-0 flex-1 text-xs"
          defaultValue={urlStr}
          key={`${field.key}:${urlStr}`}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            onChangeValue(raw || undefined);
          }}
          placeholder={t("schema.types.url")}
          size="sm"
          type="url"
        />
        {urlStr && (
          <a
            aria-label={t("schema.urlOpenLink")}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded border border-border/70 text-primary hover:bg-accent"
            href={urlStr}
            rel="noreferrer noopener"
            target="_blank"
            title={t("schema.urlOpenLink")}
          >
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>
    );
  }

  if (field.type === "relation_doc") {
    const relatedId = typeof value === "string" ? value : null;
    const relatedDoc = relatedId ? workspaceDocs.find((d) => d.id === relatedId) : null;
    const needle = relationQuery.trim().toLowerCase();
    const candidates = workspaceDocs
      .filter((d) => !needle || d.title.toLowerCase().includes(needle))
      .slice(0, 8);

    return (
      <div className="flex min-w-0 items-center gap-1">
        {relatedDoc && onOpenDocument && (
          <button
            className="inline-flex max-w-36 cursor-pointer items-center gap-1 truncate rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:border-primary/40"
            onClick={() => onOpenDocument(relatedDoc.id)}
            type="button"
          >
            <DocumentKindIcon kind={relatedDoc.kind} size="xs" />
            <span className="truncate">{relatedDoc.title}</span>
          </button>
        )}
        <Popover onOpenChange={setRelationOpen} open={relationOpen}>
          <PopoverTrigger
            render={
              <Button size="xs" type="button" variant="outline">
                <Link2Icon className="size-3" />
                <span>{relatedDoc ? t("common.edit") : t("schema.types.relation_doc")}</span>
              </Button>
            }
          />
          <PopoverPopup align="end" className="w-64" viewportClassName="p-2">
            <div className="flex flex-col gap-1.5">
              <Input
                onChange={(e) => setRelationQuery(e.target.value)}
                placeholder={t("schema.relationSearchPlaceholder")}
                size="sm"
                value={relationQuery}
              />
              <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
                {candidates.map((cand) => (
                  <button
                    className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent"
                    key={cand.id}
                    onClick={() => {
                      onChangeValue(cand.id);
                      setRelationOpen(false);
                    }}
                    type="button"
                  >
                    <DocumentKindIcon kind={cand.kind} size="xs" />
                    <span className="truncate">{cand.title}</span>
                  </button>
                ))}
              </div>
              {relatedId && (
                <Button
                  onClick={() => {
                    onChangeValue(undefined);
                    setRelationOpen(false);
                  }}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  {t("schema.relationClear")}
                </Button>
              )}
            </div>
          </PopoverPopup>
        </Popover>
      </div>
    );
  }

  const textVal = formatPropertyScalar(value);
  return (
    <Input
      className="h-7 min-w-0 flex-1 text-xs"
      defaultValue={textVal}
      key={`${field.key}:${textVal}`}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        onChangeValue(raw || undefined);
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      size="sm"
    />
  );
}

export function DocumentPropertiesPanel({
  open,
  doc,
  schemaFields = [],
  workspaceDocs = [],
  onOpenDocument,
  customProps,
  availablePresets,
  editingPropKey,
  editingPropVal,
  addPropForm,
  onSetEditingProp,
  onSetEditingPropVal,
  onUpdateProps,
}: DocumentPropertiesPanelProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  const updateSingleProperty = (key: string, nextValue: unknown): void => {
    const next: Record<string, unknown> = { ...(doc.properties ?? {}) };
    if (nextValue === undefined || nextValue === null || nextValue === "") {
      delete next[key];
    } else {
      next[key] = nextValue;
    }
    onUpdateProps(Object.keys(next).length > 0 ? next : null);
  };

  return (
    <GridDisclosure open={open}>
      <div className="flex flex-col gap-3 border-t border-border/60 pt-2.5 text-xs">
        {schemaFields.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              {t("schema.typedPropertiesTitle")}
            </span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {schemaFields.map((field) => {
                const currentVal = doc.properties?.[field.key];
                const isMissingRequired =
                  field.requiredByAgent &&
                  (currentVal === undefined ||
                    currentVal === null ||
                    currentVal === "" ||
                    (Array.isArray(currentVal) && currentVal.length === 0));

                return (
                  <div
                    className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background/90 px-2.5 py-1.5"
                    data-testid={`schema-prop-${field.key}`}
                    key={field.key}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-foreground">{field.label}</span>
                      {isMissingRequired && (
                        <Badge size="sm" variant="warning">
                          {t("schema.requiredBadge")}
                        </Badge>
                      )}
                    </div>
                    <SchemaTypedFieldControl
                      field={field}
                      onChangeValue={(next) => updateSingleProperty(field.key, next)}
                      onOpenDocument={onOpenDocument}
                      value={currentVal}
                      workspaceDocs={workspaceDocs}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {schemaFields.length > 0 && (
            <span className="text-[11px] font-semibold text-muted-foreground">
              {t("schema.customPropertiesTitle")}
            </span>
          )}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {customProps.length === 0 && schemaFields.length === 0 ? (
              <span className="text-muted-foreground">{t("document.propertyEmpty")}</span>
            ) : (
              customProps.map(([k, v]) => {
                const displayVal = typeof v === "string" ? v : JSON.stringify(v);
                const isEditingThis = editingPropKey === k;
                return (
                  <div
                    className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background/80 px-2.5 py-1"
                    key={k}
                  >
                    <span className="shrink-0 font-mono text-muted-foreground">{k}</span>
                    <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                      {isEditingThis ? (
                        <input
                          autoFocus
                          className="min-w-0 flex-1 bg-transparent text-right font-medium text-foreground outline-none"
                          onBlur={() => {
                            const nextVal = editingPropVal.trim();
                            if (nextVal !== displayVal) {
                              onUpdateProps({
                                ...(doc.properties ?? {}),
                                [k]: nextVal,
                              });
                            }
                            onSetEditingProp(null);
                          }}
                          onChange={(e) => onSetEditingPropVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing) return;
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              onSetEditingProp(null);
                            }
                          }}
                          placeholder={t("document.propertyValueEmptyPlaceholder")}
                          value={editingPropVal}
                        />
                      ) : (
                        <button
                          className="min-w-0 flex-1 cursor-text truncate rounded px-1 py-0.5 text-right font-medium text-foreground transition-colors hover:bg-accent/60"
                          onClick={() => onSetEditingProp(k, displayVal)}
                          type="button"
                        >
                          {displayVal || (
                            <span className="font-normal text-muted-foreground/60">
                              {t("document.propertyValueEmptyPlaceholder")}
                            </span>
                          )}
                        </button>
                      )}
                      <button
                        aria-label={t("document.removePropertyAria", { key: k })}
                        className="cursor-pointer text-muted-foreground hover:text-destructive-foreground"
                        onClick={() => {
                          const next = { ...(doc.properties ?? {}) };
                          delete next[k];
                          onUpdateProps(Object.keys(next).length > 0 ? next : null);
                        }}
                        type="button"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {availablePresets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {availablePresets.map((preset) => (
              <Button
                key={preset.key}
                onClick={() => {
                  const suggested = preset.suggestedValues?.[0] ?? "";
                  onUpdateProps({
                    ...(doc.properties ?? {}),
                    [preset.key]: suggested,
                  });
                  onSetEditingProp(preset.key, suggested);
                }}
                size="xs"
                type="button"
                variant="outline"
              >
                <PlusIcon className="size-3" />
                {t(preset.labelKey)}
              </Button>
            ))}
          </div>
        )}

        <form
          className="flex flex-wrap items-start gap-1.5"
          noValidate
          onSubmit={(e) =>
            void addPropForm.handleSubmit((values) => {
              const k = values.key.trim();
              if (!k) return;
              onUpdateProps({
                ...(doc.properties ?? {}),
                [k]: values.value.trim(),
              });
              addPropForm.reset({ key: "", value: "" });
            })(e)
          }
        >
          <Form {...addPropForm}>
            <FormField
              control={addPropForm.control}
              name="key"
              render={({ field }) => (
                <FormItem className="w-36 gap-1">
                  <FormControl>
                    <Input
                      {...field}
                      className="w-full text-xs"
                      placeholder={t("document.propertyKeyPlaceholder")}
                      size="sm"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={addPropForm.control}
              name="value"
              render={({ field }) => (
                <FormItem className="flex-1 gap-1">
                  <FormControl>
                    <Input
                      {...field}
                      className="w-full text-xs"
                      placeholder={t("document.propertyValuePlaceholder")}
                      size="sm"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button size="sm" type="submit" variant="outline">
              <PlusIcon />
              {t("document.addProperty")}
            </Button>
          </Form>
        </form>
      </div>
    </GridDisclosure>
  );
}
