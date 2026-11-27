import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type ArticleDocument,
  asDocumentId,
  asSpaceId,
  asWorkspaceId,
  type PropertyFieldDefinition,
} from "@inkade/core";
import { InkadeI18nProvider, initInkadeI18n } from "@inkade/i18n";
import { createInkadeClient } from "@inkade/sdk";
import { InkadeSdkProvider } from "@inkade/sdk/react";
import { ToastProvider } from "@inkade/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { SpaceSchemaEditor, validateSpaceSchemaDrafts } from "./components/SpaceSchemaEditor.tsx";
import { type InkadeNavigationAdapter, InkadeViewsProvider } from "./context.tsx";
import { DocumentPropertiesPanel } from "./views/document-detail/DocumentPropertiesPanel.tsx";
import { DocumentListView } from "./views/DocumentListView.tsx";

beforeAll(() => {
  initInkadeI18n("en-US");
});
afterAll(() => {
  initInkadeI18n("zh-CN");
});

const SAMPLE_SCHEMA_FIELDS: readonly PropertyFieldDefinition[] = [
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "draft", label: "Draft", color: "slate" },
      { value: "done", label: "Done", color: "emerald" },
    ],
    showInTable: true,
    showInCard: true,
    requiredByAgent: true,
  },
  {
    key: "budget",
    label: "Budget",
    type: "number",
    options: [],
    numberFormat: "currency",
    numberUnit: "USD",
    showInTable: true,
    showInCard: true,
    requiredByAgent: false,
  },
  {
    key: "tagsMulti",
    label: "Domains",
    type: "multi_select",
    options: [{ value: "core", label: "Core", color: "indigo" }],
    showInTable: true,
    showInCard: false,
    requiredByAgent: false,
  },
  {
    key: "dueDate",
    label: "Due Date",
    type: "date",
    options: [],
    showInTable: true,
    showInCard: false,
    requiredByAgent: false,
  },
  {
    key: "approved",
    label: "Approved",
    type: "checkbox",
    options: [],
    showInTable: true,
    showInCard: false,
    requiredByAgent: false,
  },
  {
    key: "specUrl",
    label: "Spec URL",
    type: "url",
    options: [],
    showInTable: true,
    showInCard: false,
    requiredByAgent: false,
  },
  {
    key: "relatedDoc",
    label: "Parent RFC",
    type: "relation_doc",
    options: [],
    showInTable: false,
    showInCard: false,
    requiredByAgent: false,
  },
];

function PropertiesProbe() {
  const form = useForm<{ key: string; value: string }>({
    defaultValues: { key: "", value: "" },
  });
  const doc: ArticleDocument = {
    id: asDocumentId("doc_prop_test"),
    workspaceId: asWorkspaceId("ws_default"),
    spaceId: asSpaceId("spc_research"),
    kind: "article",
    title: "Schema Probe",
    slug: "schema-probe",
    dailyDate: null,
    contentMarkdown: "hello",
    contentJson: null,
    contentText: "hello",
    excerpt: "hello",
    tags: [],
    properties: {
      budget: 2400,
      tagsMulti: ["core"],
      dueDate: "2026-12-01",
      approved: true,
      specUrl: "https://example.com",
      customKey: "customValue",
    },
    version: 1,
    pinned: false,
    unreadAgentUpdate: false,
    lastEditedByType: "human",
    trashedAt: null,
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z",
  };

  return (
    <DocumentPropertiesPanel
      addPropForm={form}
      availablePresets={[]}
      customProps={[["customKey", "customValue"]]}
      doc={doc}
      editingPropKey={null}
      editingPropVal=""
      onSetEditingProp={() => {}}
      onSetEditingPropVal={() => {}}
      onUpdateProps={() => {}}
      open
      schemaFields={SAMPLE_SCHEMA_FIELDS}
      workspaceDocs={[]}
    />
  );
}

describe("Phase 42 Views: SpaceSchemaEditor, DocumentPropertiesPanel & Board/Table Library", () => {
  it("renders SpaceSchemaEditor with typed schema fields and controls", () => {
    const html = renderToStaticMarkup(
      <InkadeI18nProvider>
        <SpaceSchemaEditor fields={SAMPLE_SCHEMA_FIELDS} onSave={() => {}} />
      </InkadeI18nProvider>,
    );
    expect(html).toContain("space-schema-editor");
    expect(html).toContain("Status");
    expect(html).toContain("Budget");
    expect(html).toContain("Save Schema");
  });

  it("rejects empty labels, empty keys, and duplicate keys in validateSpaceSchemaDrafts", () => {
    const t = ((key: string, params?: Record<string, string>) =>
      params?.key ? `${key}:${params.key}` : key) as unknown as Parameters<
      typeof validateSpaceSchemaDrafts
    >[1];
    const errors = validateSpaceSchemaDrafts(
      [
        { localId: "a", label: "   ", key: "ok" },
        { localId: "b", label: "名称", key: "!!!" },
        { localId: "c", label: "Status", key: "status" },
        { localId: "d", label: "Another", key: "status" },
        { localId: "e", label: "Owner", key: "owner" },
      ],
      t,
    );
    expect(errors).toEqual({
      a: "schema.validationLabelRequired",
      b: "schema.validationKeyRequired",
      d: "schema.validationKeyDuplicate:status",
    });
  });

  it("renders DocumentPropertiesPanel with all typed Space Schema controls and requiredByAgent indicator", () => {
    const html = renderToStaticMarkup(
      <InkadeI18nProvider>
        <PropertiesProbe />
      </InkadeI18nProvider>,
    );
    expect(html).toContain("schema-prop-status");
    expect(html).toContain("Agent Required");
    expect(html).toContain("schema-prop-budget");
    expect(html).toContain("schema-prop-approved");
    expect(html).toContain("schema-prop-relatedDoc");
    expect(html).toContain("customKey");
  });

  it("renders DocumentListView in table and board view modes cleanly", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });
    const client = createInkadeClient({
      baseUrl: "http://127.0.0.1:0",
      fetch: () => Promise.resolve(new Response("{}", { status: 200 })),
    });
    const navigation: InkadeNavigationAdapter = {
      openDocument: () => {},
      openDaily: () => {},
      openSpace: () => {},
      openLibrary: () => {},
    };

    for (const viewMode of ["table", "board"] as const) {
      const html = renderToStaticMarkup(
        <InkadeI18nProvider>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <InkadeSdkProvider client={client}>
                <InkadeViewsProvider navigation={navigation}>
                  <DocumentListView urlState={{ view: viewMode }} />
                </InkadeViewsProvider>
              </InkadeSdkProvider>
            </ToastProvider>
          </QueryClientProvider>
        </InkadeI18nProvider>,
      );
      expect(html).toContain("Board");
      expect(html).toContain("Table");
    }
  });
});
