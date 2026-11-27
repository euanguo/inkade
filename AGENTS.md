# AGENTS.md

Repository working rules for coding agents collaborating on **Inkade**.

## Mission & Non-Negotiable Constraints

1. **Permissive Licenses Only**: Every new dependency or vendored component must be MIT, Apache-2.0, BSD, or ISC (file-level MPL-2.0 requires explicit human approval). **Never introduce AGPL/GPL/BSL code** into the repository.
2. **Single Source of Truth**: Domain types, validation schemas, and scope authorization rules live in `packages/core`. Do not duplicate entity shapes or permission checks inside `apps/*` or external host integrations.
3. **Server-Enforced Scope Boundary**: Agent permission scoping (`spaceIds`, `tagAllowlist`, `allowedKinds`, `permission`, `denyHardDelete`) must be enforced in server/core business logic (including SQL-level Scope Pushdown in `DocumentRepo` and `SearchConfigRepo.searchFts`) for REST, `/mcp`, `/events`, and `/sync/:docId`. System prompts are guidance only, never a security boundary.
4. **Repository Ports & Layer Purity**: `@inkade/db` exposes 10 narrow port interfaces (`InkadeRepositories` + `TransactionRunner`) backed by single-source Drizzle SQLite migrations (`drizzle/0000_init.sql` + `0001_fts5.sql`). `apps/server/src/routes/**` and `apps/server/src/services/**` must never import `drizzle-orm` or `InkadeSqliteDb` directly (enforced by ESLint). List endpoints default to lightweight `DocumentSummary` (omitting `contentMarkdown`, `contentJson`, `contentText`).
5. **Dual-Engine Write Integrity**:
   - `outline` documents mutate through stable `nodeId` operations — never overwrite an entire outline with raw text in a way that drops `AdeThreadBinding` references.
   - `article` and `clip` documents keep clean Markdown as canonical content with revision snapshots on update.
6. **ADE-Agnostic Core & External Host Adapters**: Keep Inkade's domain, API transport, UI modules, and embed protocol completely host-neutral inside `packages/*` and `apps/*`. Host-specific ADE plugins (e.g., standalone Cursor, Claude Code, Codex, OpenCode, or custom host integrations) live in independent repositories consuming Inkade via `/mcp`, Web embed + `inkade.embed.v1`, `@inkade/views`, or `@inkade/sdk/react` (see `docs/INTEGRATION-GUIDE.md`).
7. **Mandatory Internationalization (`@inkade/i18n`)**: Every user-facing string in `packages/ui`, `packages/views`, `apps/web`, `apps/clipper`, and `apps/mobile` (JSX text, `placeholder`, `title`, `aria-label`, `label`, `description`, and Toast notifications) MUST use `@inkade/i18n` (`useInkadeTranslation` / `t(...)`), never hardcoded Chinese or English literals. Both `zh-CN` and `en-US` catalogs must stay 100% key-symmetric and verified by `bun run lint` and `bun run check:i18n`.

## Package Dependency Direction

```text
packages/core        (zero internal deps, zero IO)
packages/i18n        (zero internal deps; i18next + react-i18next; zh-CN & en-US catalogs)
packages/clipper-core (extractor + markdown + liquidjs templates; shared by clipper & server)
  ├── packages/db       (core + drizzle)
  ├── packages/sdk      (core + fetch/SSE + zero-DOM react hooks)
  ├── packages/ade-kit  (core + sdk)
  ├── packages/ui       (core + i18n + sdk + react/tiptap + shiki)
  └── packages/views    (core + i18n + sdk + ade-kit + ui + zustand)
        ├── apps/server    (core + clipper-core + db)
        ├── apps/web       (core + i18n + sdk + ui + views)
        ├── apps/clipper   (core + clipper-core + i18n + sdk + ui)
        └── external hosts (consume /mcp, Web embed + inkade.embed.v1, @inkade/views, or @inkade/sdk/react)
```

Never import `apps/*` from `packages/*`.

## Commands

```bash
bun install             # Install workspace dependencies
bun run check:licenses  # Enforce 100% permissive dependency licenses
bun run check:i18n      # Verify zh-CN / en-US dictionary symmetry & interpolation vars
bun run check:motion    # Verify UI motion primitive usage
bun run lint            # Enforce ESLint architecture boundaries, i18n, and UI rules
bun run typecheck       # Typecheck all TypeScript packages
bun test                # Run unit and integration tests
bun run db:reset        # Drop and recreate clean Drizzle SQLite schema
bun run db:migrate      # Backup legacy SQLite data and migrate to Drizzle schema
```

## Documentation Discipline

- Architecture blueprint: `docs/ARCHITECTURE.md`
- Technology ADRs: `docs/TECH-STACK.md`
- Self-hosting & deployment runbook: `docs/DEPLOYMENT.md`
- Open host integration guide: `docs/INTEGRATION-GUIDE.md`
- Design system & architecture docs: `docs/UX-DESIGN-SYSTEM.md`, `docs/CLIPPER-ARCHITECTURE.md`
- Update `docs/` whenever changing core data models, scope semantics, or ADE adapter contracts.
