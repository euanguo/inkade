#!/usr/bin/env bun
/**
 * Idempotent showcase workspace seeder for Inkade screenshots and local evaluations.
 *
 * Usage:
 *   bun run scripts/seed-showcase.ts --url http://localhost:3498
 *   INKADE_SHOWCASE_URL=http://localhost:3456 INKADE_TOKEN=ink_... bun run scripts/seed-showcase.ts
 */

import { parseArgs } from "node:util";

const parsedArgs = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    url: { type: "string" },
    token: { type: "string" },
    workspace: { type: "string" },
  },
  strict: false,
});

const baseUrl = (
  (typeof parsedArgs.values.url === "string" ? parsedArgs.values.url : undefined) ??
  process.env.INKADE_SHOWCASE_URL ??
  "http://localhost:3498"
).replace(/\/+$/, "");

const authToken =
  (typeof parsedArgs.values.token === "string" ? parsedArgs.values.token : undefined) ??
  process.env.INKADE_TOKEN;

const workspacePath =
  (typeof parsedArgs.values.workspace === "string" ? parsedArgs.values.workspace : undefined) ??
  process.cwd();

function localTodayIso(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map((v) => Number.parseInt(v, 10));
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  const yyyy = String(dt.getFullYear());
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

interface SpaceItem {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly parentId: string | null;
}

interface DocumentItem {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly spaceId: string;
  readonly kind: string;
  readonly version: number;
  readonly contentMarkdown: string;
}

const health = await api<{ ok: boolean }>("/api/v1/health");
if (!health.ok) {
  throw new Error(`Inkade health check failed on ${baseUrl}`);
}

const spacesResp = await api<{ spaces: SpaceItem[] }>("/api/v1/spaces");
const allSpaces = [...spacesResp.spaces];

const researchSpace =
  allSpaces.find((s) => s.slug === "research") ?? allSpaces.find((s) => s.id === "spc_research")!;
const projectsSpace =
  allSpaces.find((s) => s.slug === "projects") ?? allSpaces.find((s) => s.id === "spc_projects")!;
const inboxSpace =
  allSpaces.find((s) => s.slug === "inbox") ?? allSpaces.find((s) => s.id === "spc_inbox")!;

async function ensureSubSpace(
  parentId: string,
  slug: string,
  name: string,
  icon: string,
  color: string,
  defaultKind: "article" | "outline" | "clip",
): Promise<SpaceItem> {
  const existing = allSpaces.find(
    (s) =>
      s.slug === slug ||
      (s.parentId === parentId && s.name.trim().toLowerCase() === name.trim().toLowerCase()),
  );
  if (existing) return existing;
  const created = await api<{ space: SpaceItem }>("/api/v1/spaces", {
    method: "POST",
    body: JSON.stringify({ parentId, name, icon, color, defaultKind }),
  });
  allSpaces.push(created.space);
  return created.space;
}

const rfcsSpace = await ensureSubSpace(
  researchSpace.id,
  "architecture-rfcs",
  "Architecture RFCs",
  "Layers",
  "emerald",
  "article",
);
const evalsSpace = await ensureSubSpace(
  researchSpace.id,
  "agent-evals",
  "Agent Evaluations",
  "Cpu",
  "purple",
  "article",
);
const releaseSpace = await ensureSubSpace(
  projectsSpace.id,
  "release-v1",
  "Release v1.0",
  "Rocket",
  "blue",
  "article",
);

const docsResp = await api<{ documents: DocumentItem[] }>("/api/v1/documents?limit=100");
const existingDocs = [...docsResp.documents];

async function ensureDoc(input: {
  readonly spaceId: string;
  readonly kind: "article" | "clip";
  readonly title: string;
  readonly contentMarkdown: string;
  readonly tags: readonly string[];
  readonly pinned?: boolean;
  readonly sourceUrl?: string;
}): Promise<DocumentItem> {
  const match = existingDocs.find(
    (d) => d.title.toLowerCase() === input.title.toLowerCase(),
  );
  if (match) return match;
  const created = await api<{ document: DocumentItem }>("/api/v1/documents", {
    method: "POST",
    body: JSON.stringify(input),
  });
  existingDocs.push(created.document);
  return created.document;
}

// 1. Create scoped API token for agent showcase
const tokenResp = await api<{ token: { id: string; tokenPrefix: string }; rawToken: string }>(
  "/api/v1/tokens",
  {
    method: "POST",
    body: JSON.stringify({
      name: "Claude Code · Research Agent",
      scope: {
        permission: "write",
        spaceIds: [researchSpace.id, rfcsSpace.id, projectsSpace.id, releaseSpace.id],
        includeDescendants: true,
        denyHardDelete: true,
      },
    }),
  },
);

await api("/api/v1/tokens", {
  method: "POST",
  body: JSON.stringify({
    name: "Codex · Nightly Digest Reader",
    scope: {
      permission: "read",
      spaceIds: "*",
      includeDescendants: true,
      denyHardDelete: true,
    },
  }),
});

// 2. Heartbeat two realistic live ADE bridge sessions
for (const session of [
  {
    harnessName: "claude-code",
    adeKind: "claude-code",
    externalThreadId: "claude_code_arch_review_01",
    workspacePath,
    capabilities: { wake: true, nudge: false, monitor: true },
  },
  {
    harnessName: "codex",
    adeKind: "codex",
    externalThreadId: "codex_proxy_audit_02",
    workspacePath,
    capabilities: { wake: true, nudge: true, monitor: false },
  },
]) {
  await api("/api/v1/wake/sessions/heartbeat", {
    method: "POST",
    body: JSON.stringify(session),
  });
}

// 3. Seed connected knowledge graph notes first (for wikilinks & artifact sources)
const rfcScopeDoc = await ensureDoc({
  spaceId: rfcsSpace.id,
  kind: "article",
  title: "RFC-014: SQL-Level Scope Pushdown",
  tags: ["architecture", "sql", "security"],
  pinned: true,
  contentMarkdown: [
    "> [!IMPORTANT]",
    "> System prompts guide agent behavior; SQLite query pushdown enforces security boundaries.",
    "",
    "Every list query, FTS5 search, SSE subscription, and Yjs room upgrade compiles the caller's `TokenScope` directly into SQL predicates (`spaceIds`, `tagAllowlist`, `allowedKinds`, `denyHardDelete`).",
    "",
    "## Cross-References",
    "",
    "- Parent specification: [[Dual-Origin Agent Workspace Architecture]]",
    "- Token matrix: [[MCP Scoped Access Model]]",
    "- Realtime transport: [[Agent Wake & Coalescing Protocol]]",
  ].join("\n"),
});

const wakeSpecDoc = await ensureDoc({
  spaceId: evalsSpace.id,
  kind: "article",
  title: "Agent Wake & Coalescing Protocol",
  tags: ["agents", "protocol", "benchmark"],
  contentMarkdown: [
    "Marginalia comment threads route human feedback back to the bound ADE thread through a 1.5-second debounce coalescer with a hard 20 req/min rate limiter.",
    "",
    "## Observed Benchmarks",
    "",
    "- **Median FTS5 scoped query**: `11 ms` across 10k paragraphs",
    "- **Coalesced wake delivery**: `1.52 s` batch latency",
    "- **Token scope cache hit rate**: `99.4%`",
    "",
    "Related: [[Dual-Origin Agent Workspace Architecture]], [[MCP Scoped Access Model]], [[Local-First Yjs Sync & OOXML Interop]].",
  ].join("\n"),
});

await ensureDoc({
  spaceId: rfcsSpace.id,
  kind: "article",
  title: "MCP Scoped Access Model",
  tags: ["mcp", "security", "tokens"],
  contentMarkdown: [
    "Native Streamable HTTP `/mcp` reuses the exact same `TokenScope` enforcement pipeline as REST endpoints.",
    "",
    "| Permission Level | Create & Edit | Outline Mutations | Hard Delete | Token Admin |",
    "| --- | --- | --- | --- | --- |",
    "| `read` | No | No | Never | No |",
    "| `append` | Child nodes & notes | Append only | Never | No |",
    "| `write` | Scoped docs & artifacts | Full subtree | Guarded by `denyHardDelete` | No |",
    "| `admin` | Workspace-wide | Workspace-wide | Configurable | Yes |",
    "",
    "See also: [[Dual-Origin Agent Workspace Architecture]], [[RFC-014: SQL-Level Scope Pushdown]], [[Release v1.0 Readiness]].",
  ].join("\n"),
});

await ensureDoc({
  spaceId: evalsSpace.id,
  kind: "article",
  title: "Local-First Yjs Sync & OOXML Interop",
  tags: ["sync", "docx", "yjs"],
  contentMarkdown: [
    "Inkade stores live collaborative CRDT edits over WebSocket (`/sync/:docId`) and supports zero-dependency pure TypeScript `.docx` import/export plus 16:9 Presentation Mode.",
    "",
    "<!-- notes: Highlight pure-TS OOXML encoding (fflate + custom XML styles) and dual-origin Slide rendering. -->",
    "",
    "---",
    "",
    "## Presentation Pipeline",
    "",
    "```mermaid",
    "flowchart LR",
    '  MD["Canonical Markdown"] -->|"splitMarkdownIntoSlides()"| Slides["16:9 Presentation Stage"]',
    '  MD -->|"markdownToDocxFiles()"| DOCX["Standards OOXML (.docx)"]',
    '  DOCX -->|"parseDocxPackageFiles()"| MD',
    '  Slides -->|"Notes Drawer (N)"| Presenter["Speaker Cue Isolation"]',
    "```",
    "",
    "Related: [[Dual-Origin Agent Workspace Architecture]], [[Agent Wake & Coalescing Protocol]], [[Release v1.0 Readiness]].",
    "",
    "<!-- notes: Remind viewers that <!-- notes: ... --> blocks stay isolated inside the Presenter drawer and never appear in DOCX exports. -->",
  ].join("\n"),
});

await ensureDoc({
  spaceId: releaseSpace.id,
  kind: "article",
  title: "Release v1.0 Readiness",
  tags: ["release", "roadmap", "docs"],
  pinned: true,
  contentMarkdown: [
    "Tracking security hardening, Docker self-hosting readiness, and open-source onboarding.",
    "",
    "- **Done** · Enforce single-owner registration lock after initial workspace setup",
    "- **Done** · Auto-derive Better Auth `trustedOrigins` from `INKADE_BASE_URL`",
    "- **Done** · Force `Content-Disposition: attachment` + sandbox CSP on untrusted HTML/SVG uploads",
    "- **Next** · Publish Docker Compose & Cloudflare Tunnel production deployment guide",
    "",
    "Architecture baseline: [[Dual-Origin Agent Workspace Architecture]] · [[MCP Scoped Access Model]] · [[Local-First Yjs Sync & OOXML Interop]].",
  ].join("\n"),
});

// 4. Web Clips inside Inbox for triage showcase
await ensureDoc({
  spaceId: inboxSpace.id,
  kind: "clip",
  title: "Why Agent Workspaces Need Server-Side Permission Pushdown",
  tags: ["security", "agents", "reading"],
  sourceUrl: "https://architecture.example.dev/agent-scope-pushdown",
  contentMarkdown: [
    "> Clipped technical essay analyzing why system-prompt access boundaries fail under indirect prompt injection.",
    "",
    "Key takeaway: treat every external tool session like an untrusted microservice client authenticated by scoped capabilities enforced at the SQL boundary.",
  ].join("\n"),
});

await ensureDoc({
  spaceId: inboxSpace.id,
  kind: "clip",
  title: "Calm Editor Motion & Microinteractions",
  tags: ["design", "ux"],
  sourceUrl: "https://craft.example.dev/calm-editor-motion",
  contentMarkdown: [
    "Highlights crisp state transitions, restrained elevation contrast, and quiet scroll-linked outline scrubbers.",
  ].join("\n"),
});

await ensureDoc({
  spaceId: inboxSpace.id,
  kind: "clip",
  title: "Single-Container SQLite WAL Patterns",
  tags: ["sqlite", "devops"],
  sourceUrl: "https://systems.example.io/sqlite-wal-containers",
  contentMarkdown: [
    "Summary of `PRAGMA wal_checkpoint(TRUNCATE)` on `SIGTERM` shutdown and streaming backups to S3/R2 compatible object storage.",
  ].join("\n"),
});

// 5. Flagship Hero Document with Interactive Sandbox Artifact + Marginalia + Code + Mermaid + Speaker Notes
const heroTitle = "Dual-Origin Agent Workspace Architecture";
let heroDoc = existingDocs.find((d) => d.title === heroTitle);
const existingArtifacts = heroDoc
  ? (
      await api<{ artifacts: Array<{ id: string }> }>(
        `/api/v1/documents/${heroDoc.id}/artifacts`,
      )
    ).artifacts
  : [];

if (!heroDoc || existingArtifacts.length === 0) {
  heroDoc = await ensureDoc({
    spaceId: researchSpace.id,
    kind: "article",
    title: heroTitle,
    tags: ["architecture", "sandbox", "security"],
    pinned: true,
    contentMarkdown: "Initializing architecture showcase...",
  });

  const artifactHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Scope & Sandbox Telemetry Simulator</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 10px 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    background: var(--inkade-bg, #ffffff);
    color: var(--inkade-fg, #171717);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 7px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 240px;
  }
  .controls label {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  input[type=range] {
    flex: 1;
    min-width: 110px;
    accent-color: #2563eb;
    cursor: pointer;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--inkade-border, rgba(0,0,0,0.1));
    background: var(--inkade-surface, #f5f5f5);
    color: var(--inkade-fg, #171717);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: #10b981;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 7px;
  }
  .card {
    background: var(--inkade-surface, #f6f7f9);
    border: 1px solid var(--inkade-border, rgba(0,0,0,0.08));
    border-radius: 10px;
    padding: 7px 10px;
  }
  .k { font-size: 11px; color: var(--inkade-muted, #6b6f76); margin-bottom: 2px; }
  .v { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .sub { font-size: 10px; color: var(--inkade-muted, #6b6f76); margin-top: 1px; }
  .bars {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    align-items: end;
    gap: 8px;
    height: 38px;
    padding: 5px 10px;
    border-radius: 10px;
    border: 1px solid var(--inkade-border, rgba(0,0,0,0.08));
    background: var(--inkade-code-bg, #fafafa);
  }
  .bar-col { display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; justify-content: flex-end; }
  .bar { width: 100%; border-radius: 4px 4px 2px 2px; background: linear-gradient(180deg, #3b82f6, #1d4ed8); transition: height 160ms ease; }
  .bar-lbl { font-size: 10px; color: var(--inkade-muted, #6b6f76); font-variant-numeric: tabular-nums; }
  .foot {
    margin-top: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--inkade-muted, #6b6f76);
  }
  button {
    padding: 5px 11px;
    border-radius: 7px;
    border: 1px solid var(--inkade-border, rgba(0,0,0,0.14));
    background: var(--inkade-accent, #171717);
    color: var(--inkade-bg, #ffffff);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
</head>
<body>
  <div class="top">
    <div class="controls">
      <label>Concurrent MCP Agents: <span id="agentsVal">6</span></label>
      <input id="agentsRange" type="range" min="1" max="16" value="6" />
    </div>
    <span class="pill"><span class="dot"></span><span id="cookieBadge">Zero Cookie Access</span></span>
  </div>

  <div class="kpis">
    <div class="card">
      <div class="k">FTS5 Scope Pushdown</div>
      <div class="v" id="ftsLatency">11 ms</div>
      <div class="sub">SQLite WAL · P95</div>
    </div>
    <div class="card">
      <div class="k">Coalesced Wake Batch</div>
      <div class="v" id="wakeRate">14 req/m</div>
      <div class="sub">1.5s debounce window</div>
    </div>
    <div class="card">
      <div class="k">Sandbox Origin</div>
      <div class="v" id="isolationMode" style="font-size:15px;padding-top:3px;">Cross-Origin</div>
      <div class="sub" id="sourcesMeta">2 bound source specs</div>
    </div>
  </div>

  <div class="bars" id="chartBars"></div>

  <div class="foot">
    <span id="themeSyncLine">Synced with host theme tokens</span>
    <button id="sendReportBtn" type="button">Post Check to Thread</button>
  </div>

  <script>
    (async function() {
      var range = document.getElementById("agentsRange");
      var agentsVal = document.getElementById("agentsVal");
      var ftsLatency = document.getElementById("ftsLatency");
      var wakeRate = document.getElementById("wakeRate");
      var cookieBadge = document.getElementById("cookieBadge");
      var sourcesMeta = document.getElementById("sourcesMeta");
      var themeSyncLine = document.getElementById("themeSyncLine");
      var barsEl = document.getElementById("chartBars");

      cookieBadge.textContent = document.cookie ? "Cookie Exposed" : "Zero Cookie Access";

      function renderMetrics() {
        var n = Number(range.value);
        agentsVal.textContent = String(n);
        ftsLatency.textContent = String(7 + Math.round(n * 0.7)) + " ms";
        wakeRate.textContent = String(Math.min(20, n * 2 + 2)) + " req/m";

        var heights = [38, 52, 44, 68, 76, 92].map(function(base, idx) {
          return Math.min(100, Math.max(18, Math.round(base * (0.45 + n / 18) - idx * 2)));
        });
        var labels = ["1k", "5k", "10k", "25k", "50k", "100k"];
        barsEl.innerHTML = heights.map(function(h, idx) {
          return '<div class="bar-col"><div class="bar" style="height:' + h + '%"></div><span class="bar-lbl">' + labels[idx] + '</span></div>';
        }).join("");
      }

      range.addEventListener("input", renderMetrics);
      renderMetrics();

      if (window.inkade && typeof window.inkade.use === "function") {
        try {
          var theme = await window.inkade.use("theme");
          theme.subscribe(function(next) {
            themeSyncLine.textContent = "Host theme synced: " + next.mode + " · " + next.paper;
          });
        } catch (_err) {}

        try {
          var srcs = await window.inkade.use("sources");
          if (srcs && Array.isArray(srcs.sources)) {
            sourcesMeta.textContent = srcs.sources.length + " bound source specs";
          }
        } catch (_err) {}

        try {
          var commentApi = await window.inkade.use("comment");
          document.getElementById("sendReportBtn").addEventListener("click", async function() {
            await commentApi.submit({
              handoffNote: "Simulated " + agentsVal.textContent + " concurrent agents -> FTS5 P95 " + ftsLatency.textContent
            });
            themeSyncLine.textContent = "Posted simulation snapshot to review thread";
          });
        } catch (_err) {}
      }
    })();
  </script>
</body>
</html>`;

  const artRes = await api<{ artifact: { id: string } }>(
    `/api/v1/documents/${heroDoc.id}/artifacts`,
    {
      method: "POST",
      body: JSON.stringify({
        title: "Latency & Scope Isolation Budget Simulator",
        kind: "interactive_simulator",
        htmlSource: artifactHtml,
        heightPx: 212,
        capabilities: {
          theme: true,
          sources: true,
          comment: true,
          network: "none",
        },
        sources: [
          {
            kind: "document",
            label: rfcScopeDoc.title,
            documentId: rfcScopeDoc.id,
            title: rfcScopeDoc.title,
            refreshedAt: new Date().toISOString(),
          },
          {
            kind: "document",
            label: wakeSpecDoc.title,
            documentId: wakeSpecDoc.id,
            title: wakeSpecDoc.title,
            refreshedAt: new Date().toISOString(),
          },
        ],
        fallbackMarkdown:
          "| Concurrent Agents | FTS5 P95 Latency | Coalesced Wake |\n| --- | --- | --- |\n| 6 Agents | 11 ms | 14 req/m |",
      }),
    },
  );

  const heroMarkdown = [
    "> [!NOTE]",
    "> Local-first SQLite speed with SQL-enforced MCP scope boundaries and dual-origin Artifact sandboxes.",
    "",
    "External agents see only permitted Spaces and tags via [[RFC-014: SQL-Level Scope Pushdown]] and [[MCP Scoped Access Model]] guardrails.",
    "",
    "## 1. Interactive Sandbox Simulator",
    "",
    "Isolated inside `*.sandbox.localhost` with Zero Cookie Access, strict CSP headers, and live theme sync:",
    "",
    "```inkade-artifact",
    `id: ${artRes.artifact.id}`,
    "title: Latency & Scope Isolation Budget Simulator",
    "kind: interactive_simulator",
    "height: 212",
    "fallbackMarkdown: |",
    "  | Concurrent Agents | FTS5 P95 Latency | Coalesced Wake |",
    "  | --- | --- | --- |",
    "  | 6 Agents | 11 ms | 14 req/m |",
    "```",
    "",
    "---",
    "",
    "## 2. Security & Architecture Matrix",
    "",
    "| Layer | Isolation Mechanism | Verification Gate | Bypass Resistance |",
    "| --- | --- | --- | --- |",
    "| REST & `/mcp` | `TokenScope` SQL pushdown | Integration tests | Server-enforced |",
    "| Interactive Artifacts | Dual-origin subdomains + CSP | Live sandbox checks | Cookie-stripped |",
    "| Attachments | Safe-MIME inline allowlist | Header tests | Sandbox + `nosniff` |",
    "| Public Sign-up | Owner lock (`allowSignup`) | `403 SIGNUP_DISABLED` | Closed post-setup |",
    "",
    "```typescript",
    "export interface ScopedTokenPolicy {",
    '  readonly permission: "read" | "append" | "write" | "admin";',
    '  readonly spaceIds: "*" | readonly string[];',
    "  readonly denyHardDelete: boolean;",
    "}",
    "```",
    "",
    "<!-- notes:",
    "  - Every token permission check compiles directly into SQLite query predicates.",
    "  - Attachments disallow inline HTML/SVG execution on the main application origin.",
    "-->",
    "",
    "---",
    "",
    "## 3. End-to-End Request & Sandbox Topology",
    "",
    "```mermaid",
    "flowchart LR",
    '  Agent["Claude Code / Codex / Cursor"] -->|"Streamable HTTP /mcp"| Guard["Scope & CSRF Guard"]',
    '  Guard -->|"SQL Pushdown"| DB["SQLite WAL + FTS5"]',
    '  Guard -->|"Cookie-Stripped Ticket"| Sandbox["Isolated *.sandbox Origin"]',
    '  DB -->|"Filtered SSE / Yjs"| Web["Inkade Workspace UI"]',
    "```",
    "",
    "<!-- notes: Highlight single-container deployment: Bun + SQLite + Hono + Sandbox host run cleanly in one process. -->",
  ].join("\n");

  const updated = await api<{ document: DocumentItem }>(`/api/v1/documents/${heroDoc.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      contentMarkdown: heroMarkdown,
      expectedVersion: heroDoc.version,
      changeSummary: "Seed showcase architecture article and sandbox simulator",
    }),
  });
  heroDoc = updated.document;

  // Create two well-spaced Marginalia review threads
  const hl1 = await api<{ highlight: { id: string } }>(
    `/api/v1/documents/${heroDoc.id}/highlights`,
    {
      method: "POST",
      body: JSON.stringify({
        quote: "MCP scope boundaries",
        color: "amber",
        noteMarkdown:
          "Verified that FTS5 queries inject `spaceIds` and `tagAllowlist` predicates before scoring.",
      }),
    },
  );
  await api(`/api/v1/highlights/${hl1.highlight.id}/comments`, {
    method: "POST",
    body: JSON.stringify({
      bodyMarkdown:
        "Confirmed `denyHardDelete: true` enforcement across both REST and `/mcp` endpoints.",
    }),
  });

  await api<{ highlight: { id: string } }>(`/api/v1/documents/${heroDoc.id}/highlights`, {
    method: "POST",
    body: JSON.stringify({
      quote: "dual-origin Artifact sandboxes",
      color: "emerald",
      noteMarkdown:
        "Map `*.sandbox.dev` subdomains to the single container in reverse-proxy setups.",
    }),
  });
}

// 5b. Dedicated Outline document for Outline Mirror graph showcase edge
const roadmapOutlineDoc = await ensureDoc({
  spaceId: projectsSpace.id,
  kind: "outline",
  title: "Engineering Roadmap & Triage",
  tags: ["roadmap", "infra"],
  contentMarkdown: "",
});
const existingRoadmapNodes = await api<{ nodes: Array<{ id: string }> }>(
  `/api/v1/documents/${roadmapOutlineDoc.id}/nodes`,
);
if (existingRoadmapNodes.nodes.length === 0) {
  await api("/api/v1/outline-nodes", {
    method: "POST",
    body: JSON.stringify({
      documentId: roadmapOutlineDoc.id,
      contentMarkdown: "Milestone checklist synced from [[Release v1.0 Readiness]] & Daily Focus",
    }),
  });
}

// 6. Seed Today's Daily Outline with nested nodes & live ADE Thread Bindings
const today = localTodayIso();
const dailyRes = await api<{ document: DocumentItem; nodes?: Array<{ id: string }> }>(
  `/api/v1/documents/daily/${today}`,
);
const dailyDocId = dailyRes.document.id;
const existingDailyNodes = await api<{ nodes: Array<{ id: string; contentMarkdown: string }> }>(
  `/api/v1/documents/${dailyDocId}/nodes`,
);

if (existingDailyNodes.nodes.length <= 1) {
  const headingMorning = await api<{ node: { id: string } }>("/api/v1/outline-nodes", {
    method: "POST",
    body: JSON.stringify({
      documentId: dailyDocId,
      contentMarkdown: "**Engineering Focus & Agent Dispatches**",
    }),
  });

  const taskProxyAudit = await api<{ node: { id: string } }>("/api/v1/outline-nodes", {
    method: "POST",
    body: JSON.stringify({
      documentId: dailyDocId,
      parentNodeId: headingMorning.node.id,
      contentMarkdown:
        "Audit Cloudflare Tunnel reverse-proxy headers & Better Auth `trustedOrigins` #security",
      checked: false,
      priority: "p1",
      scheduledDate: today,
      scheduledSlot: "morning",
      durationMin: 45,
    }),
  });

  const codexBinding = await api<{ binding: { id: string } }>("/api/v1/thread-bindings", {
    method: "POST",
    body: JSON.stringify({
      documentId: dailyDocId,
      nodeId: taskProxyAudit.node.id,
      adeKind: "codex",
      externalThreadId: "codex_proxy_audit_02",
      title: "Codex · Reverse Proxy & CSRF Origin Check",
      status: "completed",
      lastSummary:
        "Verified `INKADE_BASE_URL` and `X-Forwarded-Proto` handling across Better Auth and same-site defenses.",
      unreadResult: false,
    }),
  });

  await api("/api/v1/outline-nodes", {
    method: "POST",
    body: JSON.stringify({
      documentId: dailyDocId,
      parentNodeId: taskProxyAudit.node.id,
      contentMarkdown:
        "Agent conclusion: added auto-derived `trustedOrigins` + attachment `Content-Disposition: attachment` hardening.",
      authorType: "agent",
      authorId: "codex",
      sourceBindingId: codexBinding.binding.id,
    }),
  });

  await api("/api/v1/outline-nodes", {
    method: "POST",
    body: JSON.stringify({
      documentId: dailyDocId,
      parentNodeId: headingMorning.node.id,
      contentMarkdown: "Verify dual-origin `*.sandbox.localhost` CSP & Escape key pass-through #sandbox",
      checked: true,
      priority: "p2",
      scheduledDate: today,
      durationMin: 30,
    }),
  });

  const taskHmacAudit = await api<{ node: { id: string } }>("/api/v1/outline-nodes", {
    method: "POST",
    body: JSON.stringify({
      documentId: dailyDocId,
      parentNodeId: headingMorning.node.id,
      contentMarkdown: "Wire webhook HMAC signature verification for Web Clipper #security",
      checked: false,
      priority: "p2",
      scheduledDate: today,
      scheduledSlot: "afternoon",
      durationMin: 40,
    }),
  });

  await api("/api/v1/thread-bindings", {
    method: "POST",
    body: JSON.stringify({
      documentId: dailyDocId,
      nodeId: taskHmacAudit.node.id,
      adeKind: "claude-code",
      externalThreadId: "claude_code_arch_review_01",
      title: "Claude Code · Clipper Payload Signing Audit",
      status: "running",
      lastSummary: "Checking X-Inkade-Signature header timing-safe comparison across /api/v1/ingest.",
      unreadResult: false,
    }),
  });

  const headingSynthesis = await api<{ node: { id: string } }>("/api/v1/outline-nodes", {
    method: "POST",
    body: JSON.stringify({
      documentId: dailyDocId,
      contentMarkdown: "**Research Notes & Reading Queue**",
    }),
  });

  const researchMirrorNode = await api<{ node: { id: string } }>("/api/v1/outline-nodes", {
    method: "POST",
    body: JSON.stringify({
      documentId: dailyDocId,
      parentNodeId: headingSynthesis.node.id,
      contentMarkdown:
        "Reviewed [[Dual-Origin Agent Workspace Architecture]] — confirmed zero-cookie iframe isolation & theme token bridge.",
    }),
  });

  // Mirror non-task research note so Knowledge Graph displays Outline Mirror edge without duplicating Tasks
  await api(`/api/v1/outline-nodes/${researchMirrorNode.node.id}/mirror`, {
    method: "POST",
    body: JSON.stringify({
      targetDocumentId: roadmapOutlineDoc.id,
      parentNodeId: null,
    }),
  });

  await api("/api/v1/outline-nodes", {
    method: "POST",
    body: JSON.stringify({
      documentId: dailyDocId,
      parentNodeId: headingSynthesis.node.id,
      contentMarkdown:
        "Cross-checked [[Local-First Yjs Sync & OOXML Interop]] for DOCX roundtrip language fences.",
    }),
  });
}

// 7. Balanced tasks across Anytime / Tomorrow / This Week / Upcoming for Kanban showcase
const existingTasks = await api<{ tasks: Array<{ node: { contentText: string } }> }>("/api/v1/tasks");
const existingTaskTitles = new Set(existingTasks.tasks.map((t) => t.node.contentText));

const kanbanShowcaseTasks: ReadonlyArray<{
  readonly title: string;
  readonly spaceId: string;
  readonly scheduledDate: string | null;
  readonly priority?: "p1" | "p2" | "p3";
  readonly durationMin?: number;
}> = [
  {
    title: "Add S3 / Cloudflare R2 optional attachment driver #storage",
    spaceId: projectsSpace.id,
    scheduledDate: null,
    priority: "p2",
    durationMin: 120,
  },
  {
    title: "Benchmark pgvector adapter parity for multi-tenant mode #search",
    spaceId: evalsSpace.id,
    scheduledDate: null,
    priority: "p3",
    durationMin: 60,
  },
  {
    title: "Configure wildcard TLS route for `*.sandbox.dev` #infra",
    spaceId: releaseSpace.id,
    scheduledDate: shiftDate(today, 1),
    priority: "p1",
    durationMin: 45,
  },
  {
    title: "Record 60-second MCP workflow walkthrough clip #docs",
    spaceId: releaseSpace.id,
    scheduledDate: shiftDate(today, 1),
    priority: "p2",
    durationMin: 30,
  },
  {
    title: "Review Web Clipper Shadow DOM styles on dark-mode sites #clipper",
    spaceId: projectsSpace.id,
    scheduledDate: shiftDate(today, 3),
    priority: "p2",
    durationMin: 45,
  },
  {
    title: "Publish standalone Paseo & Claude Code MCP recipes #mcp",
    spaceId: releaseSpace.id,
    scheduledDate: shiftDate(today, 3),
    priority: "p3",
    durationMin: 30,
  },
  {
    title: "Plan v1.1 PostgreSQL + team workspace multi-seat RBAC #roadmap",
    spaceId: rfcsSpace.id,
    scheduledDate: shiftDate(today, 9),
    priority: "p2",
    durationMin: 90,
  },
  {
    title: "Automate nightly Litestream R2 snapshot verification #backup",
    spaceId: projectsSpace.id,
    scheduledDate: shiftDate(today, 9),
    priority: "p3",
    durationMin: 30,
  },
];

for (const item of kanbanShowcaseTasks) {
  if (existingTaskTitles.has(item.title.replace(/\s+#\S+/g, "").trim()) || existingTaskTitles.has(item.title)) {
    continue;
  }
  await api("/api/v1/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: item.title,
      spaceId: item.spaceId,
      scheduledDate: item.scheduledDate,
      priority: item.priority,
      durationMin: item.durationMin,
      parseQuickSyntax: true,
      referenceDate: today,
    }),
  });
}

const summary = {
  baseUrl,
  heroDocId: heroDoc.id,
  dailyDocId,
  spaces: allSpaces.length,
  documents: existingDocs.length,
  sampleTokenPrefix: tokenResp.token.tokenPrefix,
};

console.log(JSON.stringify(summary, null, 2));
