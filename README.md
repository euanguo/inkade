<div align="center">

<h1>Inkade</h1>

<p><strong>Local-first, MIT-licensed knowledge hub built for humans and autonomous coding agents.</strong></p>

<p>
  <a href="./README.md"><strong>English</strong></a>
  &nbsp;·&nbsp;
  <a href="./README.zh-CN.md">简体中文</a>
  &nbsp;·&nbsp;
  <a href="./docs/DEPLOYMENT.md">Deployment Guide</a>
  &nbsp;·&nbsp;
  <a href="./docs/INTEGRATION-GUIDE.md">Integration Guide</a>
  &nbsp;·&nbsp;
  <a href="./SECURITY.md">Security</a>
</p>

<p>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img alt="TypeScript Strict" src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg" />
  <img alt="MCP Streamable HTTP" src="https://img.shields.io/badge/MCP-Streamable%20HTTP-10b981.svg" />
  <img alt="Dual Engine: Outline + Markdown" src="https://img.shields.io/badge/Engines-Outline%20%2B%20Markdown-171717.svg" />
  <img alt="SQLite WAL + FTS5" src="https://img.shields.io/badge/Storage-SQLite%20WAL%20%2B%20FTS5-0f766e.svg" />
</p>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/showcase/hero-article-sandbox-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="./docs/assets/showcase/hero-article-sandbox-light.png" />
  <img alt="Inkade Article Reader with Dual-Origin Interactive Sandbox Artifact and Marginalia Review Threads" src="./docs/assets/showcase/hero-article-sandbox-light.png" width="100%" />
</picture>

</div>

---

## Why Inkade?

AI-assisted workflows currently live in two disconnected worlds:

- **Built-in IDE / ADE notes** keep low context-switch cost inside coding sessions, but trap your knowledge inside one proprietary tool without web clipping, long-form reading, task triage, or cross-agent memory.
- **Traditional note apps** (Notion, Obsidian, Logseq, Outline, Memos) either carry restrictive licenses (AGPL/BSL/proprietary) or treat AI as a passive file dump without node-level thread bindings, server-enforced access boundaries, or isolated interactive Artifacts.

**Inkade** closes that gap with a **100% permissive (MIT)** TypeScript stack uniting:
1. A **node-stable Daily Outliner** + **clean Markdown long-form Article & Clip workspace** that prevents human and AI edits from clobbering each other.
2. **Server-enforced Scoped Tokens** shared identically across REST, **Streamable HTTP `/mcp`**, FTS5 search, SSE streams, and WebSocket Yjs sync.
3. **Dual-origin Interactive Artifacts** rendered inside cookie-stripped sandbox subdomains synced live with your workspace Light/Dark design tokens.

---

## Feature Showcase

### 1. Dual-Origin Interactive Artifacts & Marginalia Review
Agents can publish interactive HTML/JS simulators, telemetry dashboards, and calculators inside **`*.sandbox` isolated origins** with zero cookie access, strict CSP boundaries, provenance tracking (`sources`), and live theme synchronization — alongside inline Marginalia review threads that dispatch feedback back to active agent sessions.

<details>
<summary>View Dark Mode Sandbox Screenshot</summary>
<br />
<img alt="Inkade Dark Mode Interactive Sandbox Artifact and Marginalia" src="./docs/assets/showcase/hero-article-sandbox-dark.png" width="100%" />
</details>

---

### 2. Daily Outliner with Live ADE Thread Bindings
Organize daily priorities on a stable `nodeId` tree (`fractional-indexing`). Dispatch any outline node directly to external agents (**Claude Code**, **Codex**, **OpenCode**, **Cursor**, **Windsurf**, **Cline**, or any custom slug), watch live status pills (`Running` / `Done` / `Waiting`), and receive structured conclusions back as child nodes without line-number drift.

<img alt="Inkade Daily Outliner with Live ADE Thread Bindings" src="./docs/assets/showcase/daily-outline-threads.png" width="100%" />

---

### 3. Global Tasks & Multi-Horizon Kanban
Unify outline todos (`outline_nodes`) and Markdown `- [ ]` checkboxes (`document_tasks`) into one filterable workspace across `Anytime`, `Today`, `Tomorrow`, `This Week`, and `Upcoming` — complete with natural-language scheduling, priorities (`P1`–`P3`), duration estimates, source document jump pills, and agent badges.

<img alt="Inkade Multi-Horizon Tasks Kanban Board" src="./docs/assets/showcase/tasks-kanban.png" width="100%" />

---

### 4. Interactive Knowledge Graph (`[[Wikilinks]]`, Outline Mirrors & Semantic Match)
Explore explicit `[[wikilink]]` edges, green cross-outline `Outline Mirror` links, and purple hybrid `@orama/orama` semantic relationships rendered on a WebGL Sigma canvas with instant filtering by space, document kind, and tag.

<img alt="Inkade WebGL Knowledge Graph" src="./docs/assets/showcase/knowledge-graph.png" width="100%" />

---

### 5. 16:9 Presentation Mode & Speaker Cues
Turn any structured Markdown research document directly into a crisp 16:9 deck (`---` slide separators) supporting GFM tables, Shiki syntax highlighting, Mermaid diagrams, and isolated `<!-- notes: ... -->` speaker cue drawers that stay out of DOCX exports.

<img alt="Inkade 16:9 Presentation Mode with Speaker Notes" src="./docs/assets/showcase/presentation-mode.png" width="100%" />

---

### 6. Plug & Go MCP Guardrails (`/connect`)
Mint least-privilege tokens (`read` / `append` / `write` / `admin`) scoped by Space hierarchy, tags, and document kind (`denyHardDelete: true` by default), generate single-click configs for **Claude Code**, **Codex**, **Cursor**, **OpenCode**, **Windsurf**, and **Cline**, and inspect companion CLI diagnostics (`inkade doctor`).

<img alt="Inkade Connect AI & Scoped MCP Guardrails" src="./docs/assets/showcase/connect-mcp-scopes.png" width="100%" />

---

## Comparison with Similar Open-Source Knowledge Hubs

| Capability | **Inkade** | Outline / Affine / Memos | Obsidian (Local Vault) |
| :--- | :--- | :--- | :--- |
| **Core License** | **100% MIT / Permissive** | BSL-1.1 / AGPL / Fair-Source (varies) | Proprietary app |
| **Data Engines** | **Stable Outline Tree + Markdown Articles** | Single block/JSON or Markdown model | Local Markdown files |
| **Native MCP Server** | **Built-in Streamable HTTP `/mcp`** | External community wrappers | Community plugins |
| **Scope Enforcement** | **SQL-level pushdown (`spaceIds`, tags, kinds)** | Often workspace-wide or prompt-based | Full vault filesystem access |
| **Interactive Sandbox** | **Dual-origin cookie-stripped iframe + theme bridge** | None or same-origin | Limited local scripts |
| **Agent Thread Sync** | **Node-bound `AdeThreadBinding` + wake coalescing** | Not native | Not native |

---

## Architecture Overview

Inkade separates pure domain rules, repository ports, Hono transport handlers, and ADE-agnostic UI modules cleanly across a Bun TypeScript monorepo:

```text
packages/core          Zero-IO domain schemas (Zod v4), TokenScope SQL predicates, AST & diffing
packages/i18n          Symmetric zh-CN & en-US catalogs enforced by ESLint & CI gate
packages/clipper-core  Shared web extractor & Markdown/Liquid template engine
packages/db            Drizzle SQLite (WAL + FTS5) behind 10 narrow Repository Ports + migrations
packages/sdk           Typed client (./, ./offline, ./sync, ./tools, ./embed, ./react)
packages/ade-kit       Host-neutral project→Space routing & thread state helpers
packages/cli           Companion CLI (inkade doctor / mcp-bridge / watch / nudge / hook)
packages/ui            cosscom/ui (Base UI + Tailwind v4), Tiptap editor, outliner, Shiki, Mermaid
packages/views         Router-agnostic high-level views wired via InkadeViewsProvider

apps/server            Single-process Hono API (/api/v1/*) + /mcp + SSE + Yjs WebSocket + Sandbox Host
apps/web               React 19 + Vite workspace & responsive PWA
apps/clipper           Manifest V3 Chrome/Firefox web clipper extension
apps/desktop           Tauri v2 desktop wrapper & quick capture window
```

---

## Quick Start

### Option A · Local Development (Bun)

Prerequisites: [Bun `>= 1.3`](https://bun.sh)

```bash
git clone https://github.com/euanguo/inkade.git
cd inkade
bun install
```

Run backend + frontend with hot reload:

```bash
# Terminal 1 — API, /mcp, SSE, Yjs WebSocket & Sandbox Host (http://localhost:3456)
INKADE_LOCAL_AUTO_AUTH=true bun run dev:server

# Terminal 2 — React + Vite Web Workspace (http://localhost:5173)
bun run dev:web
```

> Never set `INKADE_LOCAL_AUTO_AUTH=true` on network-exposed hosts. Use `bun run dev:server` (auth enabled) or Docker Compose in production.

Optional: load reproducible demo workspace data (`Spaces`, flagship interactive sandbox article, Daily outline with Codex/Claude bindings, Kanban tasks, and Knowledge Graph):

```bash
bun run scripts/seed-showcase.ts --url http://localhost:3456
```

---

### Option B · Single-Container Docker Compose (Recommended for Self-Hosting)

```bash
cp .env.example .env
# Generate a strong secret and update INKADE_AUTH_SECRET + INKADE_BASE_URL in .env:
openssl rand -hex 32

docker compose up -d --build
curl -fsS http://127.0.0.1:3456/api/v1/health
```

Visit your instance to create the **initial owner account** — registration automatically closes afterward (`403 SIGNUP_DISABLED` unless `INKADE_ALLOW_SIGNUP=true` is set).

---

### Option C · Connect Any MCP Agent (`POST /mcp`)

Generate a scoped Bearer token inside **Connect AI (`/connect`)** or **Settings → Scoped Tokens**, then add Inkade to your MCP client:

```json
{
  "mcpServers": {
    "inkade": {
      "type": "http",
      "url": "http://localhost:3456/mcp",
      "headers": {
        "Authorization": "Bearer ink_your_scoped_token"
      }
    }
  }
}
```

See [`docs/INTEGRATION-GUIDE.md`](./docs/INTEGRATION-GUIDE.md) for **Mode A (Pure MCP + SSE)**, **Mode B (`iframe` embed + `inkade.embed.v1`)**, **Mode C (`@inkade/views`)**, and **Mode D (zero-DOM `@inkade/sdk/react`)**.

---

## Deployment Architecture & Cloudflare Compatibility

A common question before deploying to production: **Where does Inkade run best, and is pure Cloudflare Workers enough?**

- **Single VPS + Docker Compose + Caddy / Nginx**: **Best overall choice.** One container serves REST, `/mcp`, long-lived SSE (`/api/v1/events`), Yjs WebSockets (`/api/v1/sync/:docId`), static PWA assets, and persistent SQLite WAL + attachments.
- **Home Server / Cheap VPS + Cloudflare Tunnel (`cloudflared`) + R2 Backups**: **Zero open firewall ports.** Put Docker Compose or `bun apps/server/src/index.ts` behind `cloudflared`, bypass Cloudflare caching on `/api/*` and `/mcp`, and stream online SQLite snapshots to Cloudflare R2 via Litestream or `sqlite3 .backup`. Note that Cloudflare Free Universal SSL only covers first-level wildcards (`*.sandbox-domain.com`), not second-level wildcards (`*.sandbox.example.com`).
- **Pure Cloudflare Workers + D1 + Pages**: **Not drop-in compatible today**, because the current runtime depends directly on `bun:sqlite` WAL/FTS5 queries, stateful `Bun.serve` WebSocket Yjs rooms, local filesystem blob storage (`INKADE_DATA_DIR`), in-memory `@orama/orama` indexing, and `croner` job scheduling.

Read the complete production runbook (Caddy/Nginx templates, Cloudflare Tunnel caveats, security checklist, online backup & restore): **[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)**.

---

## Verification & Quality Gates

Inkade enforces strict build, i18n, UI-motion, security, and permissive-license checks in CI:

```bash
bun run check:licenses    # Verify 100% MIT / Apache-2.0 / BSD / ISC / CC0 dependencies
bun run check:i18n        # Verify 100% zh-CN <-> en-US dictionary symmetry
bun run check:motion      # Verify restrained UI motion primitive usage
bun run lint              # Enforce ESLint boundaries & zero hardcoded UI literals
bun run typecheck         # Full workspace TypeScript checks (incl. zero-DOM @inkade/sdk/react)
bun run build:web         # Build production PWA assets cleanly
bun test                  # Run full unit & integration test suite
bun run verify:e2e        # Live HTTP + /mcp + SSE + PWA smoke verification
```

---

## License

Licensed under the **[MIT License](./LICENSE)** — zero AGPL/GPL/BSL code anywhere in the dependency tree.
