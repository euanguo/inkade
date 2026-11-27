import {
  formatPropertyScalar,
  type DocumentRecord,
  type DocumentSummary,
  type Space,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { useInkadePublicSite, useInkadePublicSiteDoc } from "@inkade/sdk/react";
import {
  ArticleReader,
  Badge,
  Button,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  ProseMirrorOutlineEditor,
  ScrollArea,
  Skeleton,
} from "@inkade/ui";
import {
  usePaperMode,
  useReaderTypography,
  useThemePreference,
} from "@inkade/views/lib/preferences-store";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpenTextIcon,
  ChevronDownIcon,
  FileTextIcon,
  GlobeIcon,
  ListTreeIcon,
  MoonIcon,
  PaperclipIcon,
  RssIcon,
  SearchIcon,
  SunIcon,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { getApiBaseUrl } from "../lib/api.ts";

export interface PublicSitePageProps {
  readonly slug: string;
  readonly docSlug?: string | undefined;
}

export function PublicSitePage({ slug, docSlug }: PublicSitePageProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const navigate = useNavigate();
  const { effectiveTheme, toggleLightDark } = useThemePreference();
  const { typography } = useReaderTypography();
  const { paper, setPaper } = usePaperMode();
  const [navSearch, setNavSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const siteQuery = useInkadePublicSite(slug, { enabled: !docSlug });
  const docQuery = useInkadePublicSiteDoc(slug, docSlug, { enabled: Boolean(docSlug) });

  const payload = docSlug ? docQuery.data : siteQuery.data;
  const activeDocument = docSlug ? docQuery.data?.document : siteQuery.data?.activeDocument;
  const isPending = docSlug ? docQuery.isPending : siteQuery.isPending;
  const isError = docSlug ? docQuery.isError : siteQuery.isError;

  const site = payload?.site ?? null;
  const documents = useMemo(() => payload?.documents ?? [], [payload?.documents]);
  const exposedSpaces = useMemo(() => payload?.spaces ?? [], [payload?.spaces]);
  const schemaFields = useMemo(() => payload?.schemaFields ?? [], [payload?.schemaFields]);

  const filteredDocuments = useMemo(() => {
    const q = navSearch.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (doc) =>
        doc.title.toLowerCase().includes(q) ||
        doc.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [documents, navSearch]);

  const spaceNameMap = useMemo(
    () => new Map(exposedSpaces.map((s) => [s.id, s.name])),
    [exposedSpaces],
  );
  const schemaFieldMap = useMemo(
    () => new Map(schemaFields.map((f) => [f.key, f])),
    [schemaFields],
  );

  const syntheticSpaces: Space[] = useMemo(
    () =>
      exposedSpaces.map((s, idx) => ({
        id: s.id,
        workspaceId: "ws_public" as Space["workspaceId"],
        parentId: s.parentId,
        slug: s.slug,
        name: s.name,
        sortOrder: idx,
        archivedAt: null,
        createdAt: site?.createdAt ?? "",
        updatedAt: site?.updatedAt ?? "",
      })),
    [exposedSpaces, site?.createdAt, site?.updatedAt],
  );

  const syntheticWorkspaceDocs: DocumentSummary[] = useMemo(
    () =>
      documents.map((doc): DocumentSummary => {
        const base = {
          id: doc.id,
          workspaceId: "ws_public" as DocumentSummary["workspaceId"],
          spaceId: doc.spaceId,
          title: doc.title,
          slug: doc.slug,
          dailyDate: null,
          excerpt: doc.excerpt,
          tags: [...doc.tags],
          sourceUrl: doc.sourceUrl ?? undefined,
          sourceMeta: null,
          properties: { ...doc.properties },
          pinned: false,
          unreadAgentUpdate: false,
          version: 1,
          lastEditedByType: "human" as const,
          trashedAt: null,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        };
        if (doc.kind === "outline") return { ...base, kind: "outline" };
        if (doc.kind === "clip") return { ...base, kind: "clip" };
        return { ...base, kind: "article" };
      }),
    [documents],
  );

  const activeDocAsRecord: DocumentRecord | null = useMemo(() => {
    if (!activeDocument) return null;
    const base = {
      id: activeDocument.id,
      workspaceId: "ws_public" as DocumentRecord["workspaceId"],
      spaceId: activeDocument.spaceId,
      title: activeDocument.title,
      slug: activeDocument.slug,
      dailyDate: null,
      excerpt: activeDocument.excerpt,
      tags: [...activeDocument.tags],
      sourceUrl: activeDocument.sourceUrl ?? undefined,
      sourceMeta: null,
      properties: { ...activeDocument.properties },
      pinned: false,
      unreadAgentUpdate: false,
      version: 1,
      lastEditedByType: "human" as const,
      trashedAt: null,
      createdAt: activeDocument.createdAt,
      updatedAt: activeDocument.updatedAt,
      contentMarkdown: activeDocument.contentMarkdown,
      contentJson: null,
      contentText: activeDocument.excerpt,
    };
    if (activeDocument.kind === "outline") return { ...base, kind: "outline" };
    if (activeDocument.kind === "clip") return { ...base, kind: "clip" };
    return { ...base, kind: "article" };
  }, [activeDocument]);

  const handleOpenWikilink = (targetSlugOrTitle: string) => {
    if (!site) return;
    const needle = targetSlugOrTitle.trim().toLowerCase();
    const match = documents.find(
      (doc) =>
        doc.slug.toLowerCase() === needle ||
        doc.title.toLowerCase() === needle ||
        doc.id.toLowerCase() === needle,
    );
    if (!match) return;
    void navigate({
      to: "/site/$slug/$docSlug",
      params: { slug: site.slug, docSlug: match.slug },
    });
  };

  if (isPending) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !site) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Empty className="max-w-md border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GlobeIcon />
            </EmptyMedia>
            <EmptyTitle>{t("garden.publicNotFoundTitle")}</EmptyTitle>
            <EmptyDescription>{t("garden.publicNotFoundDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const base = getApiBaseUrl();
  const rssHref = `${base}/api/v1/public/sites/${encodeURIComponent(site.slug)}/feed.xml`;
  const readerFont =
    typography.fontFamily === "serif"
      ? "serif"
      : typography.fontFamily === "mono"
        ? "mono"
        : "sans";

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col bg-background text-foreground",
        paper === "sepia" && "inkade-paper-sepia",
      )}
      data-paper={paper === "sepia" ? "sepia" : undefined}
    >
      {/* Top Editorial Header */}
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              className="flex min-w-0 items-center gap-2 text-foreground hover:opacity-80"
              params={{ slug: site.slug }}
              to="/site/$slug"
            >
              <GlobeIcon className="size-4 shrink-0 text-primary" />
              <span className="truncate text-base font-semibold">{site.title}</span>
            </Link>
            <Badge className="hidden sm:inline-flex" size="sm" variant="secondary">
              {t("garden.publicReadOnlyBadge")}
            </Badge>
            {site.subtitle ? (
              <span className="hidden truncate text-xs text-muted-foreground md:inline">
                {site.subtitle}
              </span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {site.enableRss ? (
              <a
                className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                href={rssHref}
                rel="noopener noreferrer"
                target="_blank"
              >
                <RssIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
                <span>{t("garden.publicRssSubscribe")}</span>
              </a>
            ) : null}
            <Button
              aria-label={t("settings.appearancePaperTitle")}
              onClick={() => setPaper(paper === "sepia" ? "default" : "sepia")}
              size="icon-xs"
              variant={paper === "sepia" ? "secondary" : "ghost"}
            >
              <BookOpenTextIcon />
            </Button>
            <Button
              aria-label={
                effectiveTheme === "dark" ? t("nav.switchToLight") : t("nav.switchToDark")
              }
              onClick={toggleLightDark}
              size="icon-xs"
              variant="ghost"
            >
              {effectiveTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            </Button>
          </div>
        </div>
      </header>

      {/* Navigation Directory + Reading Pane */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col md:flex-row">
        <aside className="w-full shrink-0 border-b bg-muted/15 md:sticky md:top-[53px] md:h-[calc(100vh-53px)] md:w-64 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="flex flex-col gap-3 p-3.5 sm:p-4">
            <button
              aria-expanded={mobileNavOpen}
              className="flex w-full items-center justify-between text-left md:pointer-events-none"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              type="button"
            >
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("garden.publicNotesNav", { count: documents.length })}
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform duration-[var(--duration-quick)] md:hidden",
                  mobileNavOpen && "rotate-180",
                )}
              />
            </button>
            <div className={cn("flex-col gap-3", mobileNavOpen ? "flex" : "hidden md:flex")}>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label={t("garden.publicSearchPlaceholder")}
                  className="h-8 pl-8 text-xs"
                  onChange={(e) => setNavSearch(e.target.value)}
                  placeholder={t("garden.publicSearchPlaceholder")}
                  value={navSearch}
                />
              </div>

              <ScrollArea className="max-h-60 md:max-h-[calc(100vh-12rem)]" overscrollContain>
                <nav className="flex flex-col gap-1 pr-1">
                  {filteredDocuments.map((doc) => {
                    const isActive = activeDocument?.id === doc.id;
                    const Icon =
                      doc.kind === "outline"
                        ? ListTreeIcon
                        : doc.kind === "clip"
                          ? PaperclipIcon
                          : FileTextIcon;
                    return (
                      <Link
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                          isActive
                            ? "bg-accent font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                        key={doc.id}
                        onClick={() => setMobileNavOpen(false)}
                        params={{ slug: site.slug, docSlug: doc.slug }}
                        to="/site/$slug/$docSlug"
                      >
                        <Icon className="size-3.5 shrink-0 opacity-75" />
                        <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                      </Link>
                    );
                  })}
                </nav>
              </ScrollArea>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">
          {!activeDocument || !activeDocAsRecord ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <GlobeIcon />
                </EmptyMedia>
                <EmptyTitle>{site.title}</EmptyTitle>
                <EmptyDescription>
                  {documents.length === 0
                    ? t("garden.publicEmptyDocs")
                    : t("garden.publicOpenDoc")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <article className="mx-auto flex max-w-4xl flex-col gap-5">
              <header className="flex flex-col gap-2.5 border-b pb-5">
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  {activeDocument.title}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {spaceNameMap.has(activeDocument.spaceId) ? (
                    <Badge size="sm" variant="outline">
                      {spaceNameMap.get(activeDocument.spaceId)}
                    </Badge>
                  ) : null}
                  <span>{activeDocument.updatedAt.slice(0, 10)}</span>
                  {activeDocument.tags.map((tag) => (
                    <Badge key={tag} size="sm" variant="secondary">
                      #{tag}
                    </Badge>
                  ))}
                  {Object.entries(activeDocument.properties).map(([key, val]) => {
                    if (!site.exposedFields.includes(key)) return null;
                    const formatted = formatPropertyScalar(val);
                    if (!formatted) return null;
                    const fieldDef = schemaFieldMap.get(key);
                    const label = fieldDef?.label ?? key;
                    let displayVal = formatted;
                    if (fieldDef?.options?.length) {
                      if (Array.isArray(val)) {
                        displayVal = val
                          .map((v) => fieldDef.options?.find((o) => o.value === v)?.label ?? String(v))
                          .join(", ");
                      } else if (typeof val === "string") {
                        displayVal = fieldDef.options.find((o) => o.value === val)?.label ?? formatted;
                      }
                    }
                    return (
                      <Badge key={key} size="sm" variant="outline">
                        {`${label}: ${displayVal}`}
                      </Badge>
                    );
                  })}
                </div>
              </header>

              {activeDocument.kind === "outline" && activeDocument.outlineNodes ? (
                <ProseMirrorOutlineEditor
                  documentId={activeDocument.id}
                  nodes={activeDocument.outlineNodes}
                  onOpenDocument={handleOpenWikilink}
                  readOnly
                  rootTitle={activeDocument.title}
                  workspaceDocs={syntheticWorkspaceDocs}
                />
              ) : (
                <ArticleReader
                  document={activeDocAsRecord}
                  embeddedViewSnapshots={activeDocument.embeddedViews}
                  enableKeyboardNav={false}
                  hideTitleHeader
                  onOpenWikilink={handleOpenWikilink}
                  readerFont={readerFont}
                  readerMeasure={typography.measure}
                  showToc
                  spaces={syntheticSpaces}
                  theme={effectiveTheme}
                  workspaceDocs={syntheticWorkspaceDocs}
                />
              )}

              {activeDocument.backlinks.length > 0 ? (
                <section className="mt-6 flex flex-col gap-2 border-t pt-5">
                  <h2 className="text-sm font-semibold text-foreground">
                    {t("garden.publicBacklinks")}
                  </h2>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {activeDocument.backlinks.map((backlink) => (
                      <Link
                        className="flex flex-col gap-1 rounded-lg border bg-muted/20 p-3 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40"
                        key={backlink.id}
                        params={{ slug: site.slug, docSlug: backlink.slug }}
                        to="/site/$slug/$docSlug"
                      >
                        <span className="truncate text-xs font-medium text-foreground">
                          {backlink.title}
                        </span>
                        {backlink.excerpt ? (
                          <span className="line-clamp-2 text-[11px] text-muted-foreground">
                            {backlink.excerpt}
                          </span>
                        ) : null}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
