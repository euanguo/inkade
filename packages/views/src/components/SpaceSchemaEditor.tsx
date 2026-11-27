import {
  PROPERTY_FIELD_TYPES,
  PROPERTY_OPTION_COLORS,
  type PropertyFieldDefinition,
  type PropertyFieldOption,
  type PropertyFieldType,
  type PropertyNumberFormat,
  type PropertyOptionColor,
  type SpaceId,
  type TemplateId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { useInkadeSpaceSchema, useUpsertSpaceSchemaMutation } from "@inkade/sdk/react";
import {
  bindPragmaticDraggable,
  bindPragmaticDropTarget,
  Button,
  cn,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  PropertyOptionPill,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@inkade/ui";
import { DatabaseIcon, GripVerticalIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInkadeViewsContext } from "../context.tsx";

const NUMBER_FORMAT_VALUES: readonly PropertyNumberFormat[] = [
  "plain",
  "percent",
  "currency",
  "unit",
];

const EMPTY_SCHEMA_FIELDS: readonly PropertyFieldDefinition[] = [];

function trySanitizeFieldKey(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^[^a-zA-Z_]+/, "");
  return /[a-zA-Z0-9]/.test(cleaned) ? cleaned.slice(0, 64) : "";
}

function sanitizeFieldKey(raw: string, fallbackIndex: number): string {
  const cleaned = trySanitizeFieldKey(raw);
  return (cleaned || `field_${fallbackIndex + 1}`).slice(0, 64);
}

function parseOptionsLines(text: string): readonly PropertyFieldOption[] {
  const seen = new Set<string>();
  const out: PropertyFieldOption[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split("|").map((p) => p.trim());
    const value = (parts[0] ?? "").slice(0, 80);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const label = (parts[1] || value).slice(0, 80);
    const colorCandidate = parts[2] as PropertyOptionColor | undefined;
    const color =
      colorCandidate && PROPERTY_OPTION_COLORS.includes(colorCandidate)
        ? colorCandidate
        : PROPERTY_OPTION_COLORS[out.length % PROPERTY_OPTION_COLORS.length];
    out.push({ value, label, color });
  }
  return out;
}

function serializeOptionsLines(options: readonly PropertyFieldOption[]): string {
  return options
    .map((opt) => `${opt.value}|${opt.label}${opt.color ? `|${opt.color}` : ""}`)
    .join("\n");
}

interface EditableFieldDraft {
  readonly localId: string;
  readonly key: string;
  readonly label: string;
  readonly type: PropertyFieldType;
  readonly optionsText: string;
  readonly numberFormat: PropertyNumberFormat;
  readonly numberUnit: string;
  readonly showInTable: boolean;
  readonly showInCard: boolean;
  readonly requiredByAgent: boolean;
}

function toDraft(field: PropertyFieldDefinition, index: number): EditableFieldDraft {
  return {
    localId: `${field.key}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    key: field.key,
    label: field.label,
    type: field.type,
    optionsText: serializeOptionsLines(field.options),
    numberFormat: field.numberFormat ?? "plain",
    numberUnit: field.numberUnit ?? "",
    showInTable: field.showInTable,
    showInCard: field.showInCard,
    requiredByAgent: field.requiredByAgent,
  };
}

function toFieldDefinition(draft: EditableFieldDraft, index: number): PropertyFieldDefinition {
  const key = sanitizeFieldKey(draft.key || draft.label, index);
  const label = draft.label.trim() || key;
  const options =
    draft.type === "select" || draft.type === "multi_select"
      ? [...parseOptionsLines(draft.optionsText)]
      : [];
  return {
    key,
    label,
    type: draft.type,
    options,
    ...(draft.type === "number" ? { numberFormat: draft.numberFormat } : {}),
    ...(draft.type === "number" && draft.numberUnit.trim()
      ? { numberUnit: draft.numberUnit.trim() }
      : {}),
    showInTable: draft.showInTable,
    showInCard: draft.showInCard,
    requiredByAgent: draft.requiredByAgent,
  };
}

function SchemaFieldRow({
  draft,
  error,
  index,
  readOnly,
  typeLabels,
  onChange,
  onRemove,
  onReorder,
}: {
  readonly draft: EditableFieldDraft;
  readonly error?: string | undefined;
  readonly index: number;
  readonly readOnly: boolean;
  readonly typeLabels: Readonly<Record<PropertyFieldType, string>>;
  readonly onChange: (next: EditableFieldDraft) => void;
  readonly onRemove: () => void;
  readonly onReorder: (fromIndex: number, toIndex: number) => void;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const rowEl = rowRef.current;
    const handleEl = handleRef.current;
    if (!rowEl || readOnly) return;
    const cleanDrag = handleEl
      ? bindPragmaticDraggable({
          element: rowEl,
          getInitialData: () => ({ type: "schema-field-row", index }),
        })
      : undefined;
    const cleanDrop = bindPragmaticDropTarget({
      element: rowEl,
      canDrop: ({ sourceData }) =>
        sourceData.type === "schema-field-row" && sourceData.index !== index,
      onDragEnter: () => setDragOver(true),
      onDragLeave: () => setDragOver(false),
      onDrop: ({ sourceData }) => {
        setDragOver(false);
        const fromIdx = Number(sourceData.index);
        if (Number.isInteger(fromIdx) && fromIdx !== index) {
          onReorder(fromIdx, index);
        }
      },
    });
    return () => {
      cleanDrag?.();
      cleanDrop();
    };
  }, [index, onReorder, readOnly]);

  const parsedOptions = useMemo(
    () =>
      draft.type === "select" || draft.type === "multi_select"
        ? parseOptionsLines(draft.optionsText)
        : [],
    [draft.optionsText, draft.type],
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border bg-background p-3 transition-colors",
        error
          ? "border-destructive/70"
          : dragOver
            ? "border-primary bg-brand-subtle/30"
            : "border-border/80",
      )}
      ref={rowRef}
    >
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <button
            aria-label={t("schema.dragReorderAria")}
            className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
            ref={handleRef}
            type="button"
          >
            <GripVerticalIcon className="size-4" />
          </button>
        )}

        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
          <Input
            aria-invalid={Boolean(error && !draft.label.trim())}
            aria-label={t("schema.fieldLabelLabel")}
            disabled={readOnly}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            placeholder={t("schema.fieldLabelPlaceholder")}
            size="sm"
            value={draft.label}
          />
          <Input
            aria-invalid={Boolean(error && !trySanitizeFieldKey(draft.key))}
            aria-label={t("schema.fieldKeyLabel")}
            className="font-mono text-xs"
            disabled={readOnly}
            onChange={(e) => onChange({ ...draft, key: e.target.value })}
            placeholder={t("schema.fieldKeyPlaceholder")}
            size="sm"
            value={draft.key}
          />
          <Select<PropertyFieldType>
            disabled={readOnly}
            onValueChange={(nextType) => {
              if (nextType) {
                onChange({ ...draft, type: nextType });
              }
            }}
            value={draft.type}
          >
            <SelectTrigger aria-label={t("schema.fieldTypeLabel")} size="sm">
              <SelectValue>{typeLabels[draft.type]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {PROPERTY_FIELD_TYPES.map((fieldType) => (
                <SelectItem key={fieldType} value={fieldType}>
                  {typeLabels[fieldType]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>

        {!readOnly && (
          <Button
            aria-label={t("schema.removeFieldAria", { key: draft.key || draft.label })}
            onClick={onRemove}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Trash2Icon className="size-3.5 text-destructive-foreground" />
          </Button>
        )}
      </div>

      {draft.type === "number" && (
        <div className="grid grid-cols-1 gap-2 pl-6 sm:grid-cols-2">
          <Select<PropertyNumberFormat>
            disabled={readOnly}
            onValueChange={(val) => {
              if (val) onChange({ ...draft, numberFormat: val });
            }}
            value={draft.numberFormat}
          >
            <SelectTrigger size="sm">
              <SelectValue>{draft.numberFormat}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {NUMBER_FORMAT_VALUES.map((fmt) => (
                <SelectItem key={fmt} value={fmt}>
                  {fmt}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Input
            disabled={readOnly}
            onChange={(e) => onChange({ ...draft, numberUnit: e.target.value })}
            placeholder={t("schema.fieldUnitPlaceholder")}
            size="sm"
            value={draft.numberUnit}
          />
        </div>
      )}

      {(draft.type === "select" || draft.type === "multi_select") && (
        <div className="flex flex-col gap-1.5 pl-6">
          <span className="text-[11px] text-muted-foreground">{t("schema.fieldOptionsLabel")}</span>
          <Textarea
            className="min-h-16 font-mono text-xs"
            disabled={readOnly}
            onChange={(e) => onChange({ ...draft, optionsText: e.target.value })}
            value={draft.optionsText}
          />
          {parsedOptions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {parsedOptions.map((opt) => (
                <PropertyOptionPill color={opt.color} key={opt.value} label={opt.label} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 pl-6 text-xs text-muted-foreground">
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <Switch
            checked={draft.showInTable}
            disabled={readOnly}
            onCheckedChange={(checked) => onChange({ ...draft, showInTable: checked })}
          />
          <span>{t("schema.showInTableLabel")}</span>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <Switch
            checked={draft.showInCard}
            disabled={readOnly}
            onCheckedChange={(checked) => onChange({ ...draft, showInCard: checked })}
          />
          <span>{t("schema.showInCardLabel")}</span>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <Switch
            checked={draft.requiredByAgent}
            disabled={readOnly}
            onCheckedChange={(checked) => onChange({ ...draft, requiredByAgent: checked })}
          />
          <span>{t("schema.requiredByAgentLabel")}</span>
        </label>
      </div>
      {error && (
        <p className="pl-6 text-xs text-destructive-foreground" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function validateSpaceSchemaDrafts(
  drafts: readonly Pick<EditableFieldDraft, "localId" | "key" | "label">[],
  t: ReturnType<typeof useInkadeTranslation>["t"],
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  const seenKeys = new Set<string>();
  for (const draft of drafts) {
    if (!draft.label.trim()) {
      errors[draft.localId] = t("schema.validationLabelRequired");
      continue;
    }
    const sanitizedKey = trySanitizeFieldKey(draft.key);
    if (!sanitizedKey) {
      errors[draft.localId] = t("schema.validationKeyRequired");
      continue;
    }
    if (seenKeys.has(sanitizedKey)) {
      errors[draft.localId] = t("schema.validationKeyDuplicate", { key: sanitizedKey });
      continue;
    }
    seenKeys.add(sanitizedKey);
  }
  return errors;
}

export interface SpaceSchemaEditorProps {
  readonly fields: readonly PropertyFieldDefinition[];
  readonly saving?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly onSave: (fields: readonly PropertyFieldDefinition[]) => Promise<void> | void;
}

export function SpaceSchemaEditor({
  fields,
  saving = false,
  readOnly = false,
  onSave,
}: SpaceSchemaEditorProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [drafts, setDrafts] = useState<readonly EditableFieldDraft[]>(() =>
    fields.map((f, idx) => toDraft(f, idx)),
  );
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>({});
  const touchedKeyIdsRef = useRef<Set<string>>(new Set());
  const fieldsSignature = useMemo(() => JSON.stringify(fields), [fields]);
  const syncedSignatureRef = useRef<string>(fieldsSignature);

  useEffect(() => {
    if (syncedSignatureRef.current === fieldsSignature) {
      return;
    }
    syncedSignatureRef.current = fieldsSignature;
    setDrafts(fields.map((f, idx) => toDraft(f, idx)));
    setRowErrors({});
    touchedKeyIdsRef.current.clear();
  }, [fields, fieldsSignature]);

  const typeLabels: Readonly<Record<PropertyFieldType, string>> = useMemo(
    () => ({
      text: t("schema.types.text"),
      number: t("schema.types.number"),
      select: t("schema.types.select"),
      multi_select: t("schema.types.multi_select"),
      date: t("schema.types.date"),
      checkbox: t("schema.types.checkbox"),
      url: t("schema.types.url"),
      relation_doc: t("schema.types.relation_doc"),
    }),
    [t],
  );

  const handleReorder = (fromIdx: number, toIdx: number): void => {
    setDrafts((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      if (!moved) return prev;
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const handleAddField = (): void => {
    setDrafts((prev) => [
      ...prev,
      {
        localId: `new_${Date.now()}_${prev.length}`,
        key: "",
        label: "",
        type: "text",
        optionsText: "",
        numberFormat: "plain",
        numberUnit: "",
        showInTable: true,
        showInCard: true,
        requiredByAgent: false,
      },
    ]);
  };

  const handleSave = async (): Promise<void> => {
    const errors = validateSpaceSchemaDrafts(drafts, t);
    if (Object.keys(errors).length > 0) {
      setRowErrors(errors);
      return;
    }
    setRowErrors({});
    const normalized = drafts.map((d, idx) => toFieldDefinition(d, idx));
    await onSave(normalized);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="space-schema-editor">
      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          {t("schema.emptyFields")}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {drafts.map((draft, idx) => (
            <SchemaFieldRow
              draft={draft}
              error={rowErrors[draft.localId]}
              index={idx}
              key={draft.localId}
              onChange={(next) => {
                if (next.key !== draft.key) {
                  touchedKeyIdsRef.current.add(draft.localId);
                } else if (next.label !== draft.label && !touchedKeyIdsRef.current.has(draft.localId)) {
                  const suggested = trySanitizeFieldKey(next.label);
                  next = { ...next, key: suggested };
                }
                setRowErrors((prev) => {
                  if (!prev[draft.localId]) return prev;
                  const copy = { ...prev };
                  delete copy[draft.localId];
                  return copy;
                });
                setDrafts((prev) => prev.map((item, i) => (i === idx ? next : item)));
              }}
              onRemove={() => {
                touchedKeyIdsRef.current.delete(draft.localId);
                setRowErrors((prev) => {
                  if (!prev[draft.localId]) return prev;
                  const copy = { ...prev };
                  delete copy[draft.localId];
                  return copy;
                });
                setDrafts((prev) => prev.filter((_, i) => i !== idx));
              }}
              onReorder={handleReorder}
              readOnly={readOnly}
              typeLabels={typeLabels}
            />
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button onClick={handleAddField} size="xs" type="button" variant="outline">
            <PlusIcon className="size-3.5" />
            <span>{t("schema.addFieldButton")}</span>
          </Button>
          <Button
            loading={saving}
            onClick={() => void handleSave()}
            size="xs"
            type="button"
          >
            <SaveIcon className="size-3.5" />
            <span>{t("schema.saveSchemaButton")}</span>
          </Button>
        </div>
      )}
    </div>
  );
}

export interface SpaceSchemaDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spaceId: SpaceId;
  readonly spaceName: string;
  readonly templateId?: TemplateId | undefined;
  readonly readOnly?: boolean | undefined;
}

export function SpaceSchemaDialog({
  open,
  onOpenChange,
  spaceId,
  spaceName,
  templateId,
  readOnly = false,
}: SpaceSchemaDialogProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { notifier } = useInkadeViewsContext();
  const schemaQuery = useInkadeSpaceSchema(open ? spaceId : undefined, templateId);
  const upsertMutation = useUpsertSpaceSchemaMutation({
    onSuccess: () => {
      notifier.success(t("schema.savedToast"));
      onOpenChange(false);
    },
    onError: (err) => notifier.error(t("schema.saveFailedToast"), err),
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DatabaseIcon className="size-4 text-primary" />
            <span>
              {t("schema.drawerTitle")} · {spaceName}
            </span>
          </DialogTitle>
        </DialogHeader>
        <DialogPanel className="max-h-[70vh] overflow-y-auto">
          <p className="mb-3 text-xs text-muted-foreground">{t("schema.drawerSubtitle")}</p>
          <SpaceSchemaEditor
            fields={schemaQuery.data?.fields ?? EMPTY_SCHEMA_FIELDS}
            onSave={async (fields) => {
              await upsertMutation.mutateAsync({
                spaceId,
                input: templateId ? { templateId, fields: [...fields] } : { fields: [...fields] },
              });
            }}
            readOnly={readOnly}
            saving={upsertMutation.isPending}
          />
        </DialogPanel>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
