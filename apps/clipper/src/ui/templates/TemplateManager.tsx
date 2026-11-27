import { zodResolver } from "@hookform/resolvers/zod";
import type { ExtractedArticle, PageExtractionBundle } from "@inkade/clipper-core/extractor";
import {
  BUILTIN_CLIPPER_TEMPLATES,
  matchTemplateForPage,
  renderClipTemplate,
} from "@inkade/clipper-core/templates";
import { clipperTemplateSchema, type ClipperTemplate } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import type { InkadeClient } from "@inkade/sdk";
import { Card } from "@inkade/ui/primitives";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { pullTemplatesFromInkade, pushTemplatesToInkade } from "../../core/templates/cloud-sync.ts";
import {
  loadStoredClipperTemplates,
  saveStoredClipperTemplates,
} from "../../shared/storage.ts";
import {
  isRestrictedTabUrl,
  resolveTargetTab,
  sendMessageEnsuringScript,
} from "../../shared/webext.ts";
import { ClipperStatusBanner } from "../shared/ClipperStatusBanner.tsx";
import type { ClipperUiStatus } from "../shared/clipper-ui-helpers.ts";
import { TemplateDryRunTester, type TemplateDryRunPreview } from "./TemplateDryRunTester.tsx";
import { TemplateEditorForm } from "./TemplateEditorForm.tsx";
import { TemplateToolbar } from "./TemplateToolbar.tsx";
import {
  buildDraftTemplateFromValues,
  buildSampleArticleForUrl,
  createTemplateEditorSchema,
  templateToFormValues,
  type TemplateEditorFormValues,
} from "./template-utils.ts";

export interface TemplateManagerProps {
  readonly client: InkadeClient | null;
}

export function TemplateManager({ client }: TemplateManagerProps) {
  const { t } = useInkadeTranslation();
  const [templates, setTemplates] = useState<ClipperTemplate[]>([...BUILTIN_CLIPPER_TEMPLATES]);
  const [selectedId, setSelectedId] = useState<string>(BUILTIN_CLIPPER_TEMPLATES[0]?.id ?? "");
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<ClipperUiStatus | null>(null);
  const [testerOpen, setTesterOpen] = useState(false);
  const [testUrl, setTestUrl] = useState("https://github.com/inkade/inkade");
  const [testArticle, setTestArticle] = useState<ExtractedArticle | null>(null);

  const selected = templates.find((tpl) => tpl.id === selectedId) ?? templates[0] ?? null;
  const schema = useMemo(() => createTemplateEditorSchema(t), [t]);

  const form = useForm<TemplateEditorFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      description: "",
      enabled: true,
      priority: 0,
      triggers: [],
      behavior: "create",
      titleTemplate: "{{title}}",
      tagsTemplate: "",
      contentTemplate: "{{content}}",
      propertiesJson: "[]",
      appendToDaily: false,
      dailyLineTemplate: "",
    },
  });
  const { reset: resetForm, getValues: getFormValues } = form;
  const watchedValues = useWatch({ control: form.control });

  useEffect(() => {
    void loadStoredClipperTemplates().then((stored) => {
      if (stored && stored.length > 0) {
        setTemplates(stored);
        setSelectedId(stored[0]!.id);
      }
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    resetForm(templateToFormValues(selected));
    setPendingSwitchId(null);
  }, [selected, resetForm]);

  const isDirty = form.formState.isDirty;

  const persistList = async (next: ClipperTemplate[]) => {
    setTemplates(next);
    await saveStoredClipperTemplates(next);
  };

  const handleSaveSelected = async (): Promise<boolean> => {
    if (!selected) return false;
    const valid = await form.trigger();
    if (!valid) return false;
    try {
      const updated = buildDraftTemplateFromValues(selected, getFormValues());
      if (!updated) return false;
      await persistList(templates.map((item) => (item.id === updated.id ? updated : item)));
      resetForm(templateToFormValues(updated));
      setNotice({ kind: "success", text: t("clipper.settingsSavedToast") });
      return true;
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      return false;
    }
  };

  const handleSelectTemplateTab = (nextId: string) => {
    if (nextId === selected?.id) return;
    if (isDirty) {
      setPendingSwitchId(nextId);
      return;
    }
    setSelectedId(nextId);
  };

  const handleCreateTemplate = async () => {
    const newTpl = clipperTemplateSchema.parse({
      id: `tpl_custom_${Date.now().toString(36)}`,
      name: t("clipper.templateNewBtn"),
      description: "",
      enabled: true,
      priority: 10,
      triggers: [],
      behavior: "create",
      titleTemplate: "{{title}}",
      contentTemplate: "{{content}}",
      tagsTemplate: "clip",
      properties: [],
      appendToDaily: false,
      dailyLineTemplate: "- [[{{title}}]] ({{url}})",
    });
    await persistList([...templates, newTpl]);
    setSelectedId(newTpl.id);
  };

  const handleDeleteSelected = async () => {
    if (!selected || templates.length <= 1) return;
    const next = templates.filter((tpl) => tpl.id !== selected.id);
    await persistList(next);
    setSelectedId(next[0]?.id ?? "");
  };

  const handleResetBuiltins = async () => {
    const defaults = BUILTIN_CLIPPER_TEMPLATES.map((tpl) => ({ ...tpl }));
    await persistList(defaults);
    setSelectedId(defaults[0]?.id ?? "");
    setNotice({ kind: "success", text: t("clipper.templateResetSuccess") });
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(templates, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inkade-clipper-templates.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      if (!Array.isArray(raw)) throw new Error("Invalid template JSON array");
      const validated = raw.map((item) => clipperTemplateSchema.parse(item));
      await persistList(validated);
      setSelectedId(validated[0]?.id ?? "");
      setNotice({ kind: "success", text: t("clipper.templateCloudSynced", { count: validated.length }) });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      event.target.value = "";
    }
  };

  const runCloudSync = async (action: "push" | "pull") => {
    if (!client) return;
    setSyncing(true);
    setNotice(null);
    try {
      if (action === "push") {
        const count = await pushTemplatesToInkade(client, templates);
        setNotice({ kind: "success", text: t("clipper.templateCloudSynced", { count }) });
      } else {
        const merged = await pullTemplatesFromInkade(client, templates);
        await persistList(merged);
        setSelectedId(merged[0]?.id ?? "");
        setNotice({ kind: "success", text: t("clipper.templateCloudSynced", { count: merged.length }) });
      }
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false);
    }
  };

  const handleLoadActiveTabIntoTester = useCallback(async () => {
    try {
      const tab = await resolveTargetTab();
      if (!tab?.id || isRestrictedTabUrl(tab.url)) {
        setNotice({ kind: "error", text: t("clipper.noActiveTab") });
        return;
      }
      setTestUrl(tab.url ?? testUrl);
      const bundle = await sendMessageEnsuringScript<PageExtractionBundle>(
        tab.id,
        "content-extractor.js",
        { type: "INKADE_EXTRACT_BUNDLE" },
      );
      if (bundle) {
        setTestArticle(bundle.article);
        setTesterOpen(true);
      }
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }, [t, testUrl]);

  const dryRunPreview: TemplateDryRunPreview | null = useMemo(() => {
    if (!testerOpen || !selected) return null;
    try {
      const draftTpl = buildDraftTemplateFromValues(selected, watchedValues);
      if (!draftTpl) return null;
      const article =
        testArticle && testArticle.url === testUrl
          ? testArticle
          : buildSampleArticleForUrl(testUrl.trim() || "https://example.com/article");
      const effectiveTemplates = templates.map((item) =>
        item.id === draftTpl.id ? draftTpl : item,
      );
      const matched = matchTemplateForPage(effectiveTemplates, {
        url: article.url,
        schemaTypes: article.meta.schemaTypes,
      });
      const plan = renderClipTemplate(draftTpl, { article });
      return { matched, plan, error: null };
    } catch (err) {
      return {
        matched: null,
        plan: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [testerOpen, selected, watchedValues, testArticle, testUrl, templates]);

  return (
    <Card className="gap-3 rounded-lg px-4 py-4">
      <TemplateToolbar
        hasClient={Boolean(client)}
        isDirty={isDirty}
        onCancelSwitch={() => setPendingSwitchId(null)}
        onConfirmSaveAndSwitch={() => {
          void handleSaveSelected().then((ok) => {
            if (ok && pendingSwitchId) {
              setSelectedId(pendingSwitchId);
              setPendingSwitchId(null);
            }
          });
        }}
        onCreateTemplate={() => void handleCreateTemplate()}
        onDiscardAndSwitch={() => {
          if (pendingSwitchId) setSelectedId(pendingSwitchId);
          setPendingSwitchId(null);
        }}
        onExportJson={handleExportJson}
        onImportJson={(e) => void handleImportJson(e)}
        onPullCloud={() => void runCloudSync("pull")}
        onPushCloud={() => void runCloudSync("push")}
        onResetBuiltins={() => void handleResetBuiltins()}
        onSelectTemplate={handleSelectTemplateTab}
        pendingSwitchId={pendingSwitchId}
        syncing={syncing}
        templates={templates}
        selectedId={selected?.id}
      />

      {selected ? (
        <div className="flex flex-col gap-3 border-t border-border/70 pt-3">
          <TemplateEditorForm
            canDelete={templates.length > 1}
            form={form}
            onDeleteSelected={() => void handleDeleteSelected()}
            onSubmitSave={() => void handleSaveSelected()}
            onToggleTester={() => setTesterOpen((v) => !v)}
            testerOpen={testerOpen}
          />
          <TemplateDryRunTester
            onChangeTestUrl={setTestUrl}
            onLoadActiveTab={() => void handleLoadActiveTabIntoTester()}
            open={testerOpen}
            preview={dryRunPreview}
            selectedTemplateId={selected.id}
            testUrl={testUrl}
          />
        </div>
      ) : null}

      <ClipperStatusBanner status={notice} />
    </Card>
  );
}
