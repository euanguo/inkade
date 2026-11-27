# Inkade Open Integration Guide

Inkade is **ADE-agnostic by design**. The core server, SDK, UI components, and Web application carry no built-in coupling to any commercial or third-party Agent Development Environment (ADE). Any ADE, coding agent, editor, terminal tool, or standalone host plugin can integrate with Inkade through **four incremental integration modes**.

---

## Integration Overview

| Mode | Best For | Key Packages / Endpoints | Server-Side Isolation |
| :--- | :--- | :--- | :--- |
| **Mode A · Pure MCP + SSE** | Cursor, Claude Code, Codex, Windsurf, OpenCode, Cline, Zed | `POST /mcp`, `GET /api/v1/events`, `INKADE_TOOL_CATALOG` | Enforced in REST & `/mcp` handlers via `TokenScope` + `ProjectScopeRule` |
| **Mode B · Layer 3 Web Embed (`iframe` / WebView)** | Desktop / Web ADEs embedding a panel (`apps/web`) | `?embed=1&chrome=...`, `X-Forwarded-Prefix`, `embedTicket`, `inkade.embed.v1` | Scoped short-lived embed session (`ink_emb_*`) + CSP `INKADE_FRAME_ANCESTORS` |
| **Mode C · Layer 2 React Modules (`@inkade/views`)** | Same-stack React Web hosts importing native Inkade views | `@inkade/views`, `@inkade/ui`, `@inkade/sdk/react` | `InkadeClient` scoped token + `InkadeViewsProvider` adapters |
| **Mode D · Layer 1 Zero-DOM SDK (`@inkade/sdk/react`)** | React Native, terminal TUI, background daemon / CLI hosts | `@inkade/sdk`, `@inkade/sdk/react`, `@inkade/ade-kit`, `@inkade/core` | Verified DOM-free via `packages/sdk/tsconfig.react-headless.json` |

### Open Host Model (`AdeKind`)

Thread bindings and dispatch controls accept **any normalized open host slug** (`HOST_KIND_PATTERN = /^[a-z0-9][a-z0-9._-]*$/`) rather than a closed enum:

- `normalizeHostKind()`, `isNeutralHostKind()`, `formatHostDisplayName()`, `getHostInitials()`, and `getHostBadgeTone()` in `@inkade/core` provide deterministic display labels, monograms, and badge colors for arbitrary custom host slugs (`cursor`, `claude-code`, `codex`, `opencode`, `windsurf`, `custom.ade-1`, etc.).
- Use `"any"` (`DEFAULT_HOST_KIND`) when dispatching work to any external MCP agent without pre-binding a specific host.

---

## Mode A · Pure MCP + SSE (Zero Adapter Required)

### 1. Create a Scoped API Token

Create a token under **Settings → API Tokens** (or `POST /api/v1/tokens`) specifying server-enforced boundaries:

- `spaceIds`: allowed workspace spaces (with optional `includeDescendants`)
- `tagAllowlist`: required tags for visibility/mutation
- `allowedKinds`: subset of `outline`, `article`, `clip`
- `permission`: `"read" | "write" | "admin"`
- `denyHardDelete`: forbid permanent document/node deletion

### 2. Configure `/mcp` (Streamable HTTP JSON-RPC 2.0)

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

Or match project context automatically with `ProjectScopeRule` (`POST /api/v1/scope-rules`) matching `repoName`, `gitRemote`, or `localPath` patterns.

### 3. Single Source of Truth Tool Catalog (`INKADE_TOOL_DEFINITIONS` / `INKADE_TOOL_CATALOG`)

External MCP wrappers or plugin adapters should derive tool schemas and descriptions directly from `INKADE_TOOL_CATALOG` exported by `@inkade/sdk/tools` — which is generated from `INKADE_TOOL_DEFINITIONS` in `@inkade/core` and stays in 1:1 alignment with `/mcp` (`REGISTERED_MCP_TOOL_NAMES`) — rather than duplicating tool metadata. Key collaborative closing-the-loop tools include:

- `list_bound_threads` / `get_thread_binding` — inspect active, waiting, or queued dispatched bindings before execution
- `claim_thread_binding` — claim an open or host-neutral `"any"` dispatch record, atomically setting `adeKind` and `externalThreadId`
- `bind_thread` / `update_thread_binding` — report running progress steps, `waiting_input` approvals, failure summaries, or completion
- `batch_mutate_outline` / `patch_document_section` / `update_document` — dual-engine structured mutations preserving `nodeId` references and article revision snapshots

### 4. Live Transient MCP Activity via SSE (`GET /api/v1/events`)

Every MCP `tools/call` invocation emits real-time transient `agent.tool.started` and `agent.tool.finished` events over `GET /api/v1/events` using the discriminated `InkadeEvent` union (`packages/core/src/events.ts`):

- Transient `agent.tool.*` events are **not** persisted to `event_logs` and do **not** invalidate query caches (`applyInkadeEventToQueryCache` ignores `event.type.startsWith("agent.tool.")`).
- `SseHub` applies `isEventVisibleToScope` so scoped tokens only receive tool activity for documents inside their allowed spaces (global calls without `documentId` are visible to workspace admins only, and payloads contain metadata — never raw content).

---

## Mode B · Layer 3 Full Web Embed (`iframe` / WebView)

Embed Inkade's full Vite React app directly in any ADE sidebar, tab, or WebView with URL-driven chrome trimming, dynamic reverse-proxy base paths, one-time tickets, and typed bidirectional messaging.

### 1. URL Query Parameters

Parameters persist in window-level `sessionStorage` (`inkade:embed:config:v1`) across in-app route navigation until `?embed=0` resets them:

| Parameter | Values | Effect |
| :--- | :--- | :--- |
| `embed` | `1` / `true` / `0` / `false` | Enables embed mode (`data-embed="true"` on `<html>`), suppresses PWA SW registration; `0` clears persisted embed state |
| `chrome` | `full` \| `minimal` \| `none` | `minimal`: hides sidebar & mobile bottom nav (keeps topbar & Inspector toggle); `none`: hides sidebar, topbar, Inspector, mobile nav, FAB & quick-capture |
| `hide` | comma-separated `sidebar,topbar,inspector,mobileNav,fab,quickCapture` | Explicit fine-grained chrome suppression (resets inherited computed hides when `chrome=` changes without `hide=`) |
| `theme` | `light` \| `dark` \| `system` | Pre-paint and live surface theme override |
| `density` | `comfortable` \| `compact` | Sets `data-density="compact"` spacing tokens for narrow side panels |
| `readonly` | `1` / `true` | Disables outline/article mutation and dispatch affordances |
| `host` | host slug (e.g. `cursor`, `opencode`, `windsurf`) | Identifies the embedding host in dispatch flows |
| `embedTicket` | single-use ticket string | Automatically exchanged for short-lived `ink_emb_*` session auth, then scrubbed from browser URL via `history.replaceState` |

### 2. Authentication for Embedded Iframes (No Token in URL!)

**Never** pass long-lived `ink_*` API tokens in iframe query strings. Choose one of:

1. **Reverse Proxy Header Injection**: The host's HTTP reverse proxy injects `Authorization: Bearer ink_...` upstream when forwarding requests to Inkade.
2. **Short-Lived Single-Use `embedTicket` Exchange**:
   - Host backend calls `POST /api/v1/auth/embed-ticket` (`client.auth.createEmbedTicket()`) using its server-held Bearer token -> receives a 60-second single-use ticket (`EmbedTicketResponse`).
   - Host opens iframe URL `/daily?embed=1&chrome=minimal&embedTicket=<ticket>`.
   - `AuthGate` calls `POST /api/v1/auth/embed-ticket/exchange` (`client.auth.exchangeEmbedTicket({ ticket })`), receives a short-lived `ink_emb_*` token tied to the original principal & `TokenScope` (live-checked against token revocation), and strips `embedTicket` from `window.location`.

### 3. Reverse Proxy & Subpath (`X-Forwarded-Prefix`) Contract

When mounting Inkade under a host subpath (e.g. `https://host.example/proxy/inkade/...`) so remote HTTPS hosts avoid mixed-content or cross-origin blocks:

- Strip `/proxy/inkade` before forwarding to Inkade and set `X-Forwarded-Prefix: /proxy/inkade` (validated against `/^\/[a-zA-Z0-9/_-]+$/`).
- Inkade server automatically rewrites SPA HTML to inject `<base href="/proxy/inkade/">` and `window.__INKADE_BASE_PATH__ = "/proxy/inkade"`, while `apps/web` builds with `base: "./"` and mounts TanStack Router at `getAppBasePath()`.
- Set `INKADE_FRAME_ANCESTORS` (e.g. `'self' https://your-ade-host.example`) on the Inkade server when restricting who can frame Inkade via `Content-Security-Policy`.
- **Service Worker Guarantee**: `main.tsx` only registers `./sw.js` when `import.meta.env.PROD && !embed && getAppBasePath() === ""`, so embedded/proxied mounts never hijack the host's origin scope.

#### Reverse Proxy Streaming Checklist (Critical for SSE & Pointer Resize)

- **Never buffer `/api/v1/events`**: Pass through the upstream `ReadableStream` unbuffered with headers:
  - `Cache-Control: no-cache`
  - `X-Accel-Buffering: no`
  - Forward the downstream request `AbortSignal` / `req.on("close", ...)` to close the upstream SSE connection cleanly.
- **Drag-to-Resize Overlay**: While the user drags a split-pane divider adjacent to an embedded Inkade `<iframe>`, apply `pointer-events: none` to the `<iframe>` so mouse events aren't swallowed by the frame boundary.

### 4. Bidirectional Bridge (`inkade.embed.v1`)

Use `createInkadeEmbedHost` from `@inkade/sdk/embed`:

```ts
import { createInkadeEmbedHost } from "@inkade/sdk/embed";

const host = createInkadeEmbedHost(iframeElement, {
  hostId: "cursor",
  hostName: "Cursor",
  capabilities: ["spawn_thread", "open_thread", "copy_clipboard", "open_external_url"],
  theme: "dark",
  projectContext: { repoName: "my-app", localPath: "/path/to/my-app" },
  onReady: ({ currentPath }) => {
    console.log("Inkade ready at", currentPath);
  },
  onRouteChange: ({ path, documentId }) => {
    console.log("Navigated:", path, documentId);
  },
  onStatusChange: ({ waitingCount, unreadDocsCount, activeToolCalls }) => {
    updateBadge(waitingCount + unreadDocsCount);
  },
  onSpawnThread: async (payload) => {
    return myHost.spawnAgentThread(payload);
  },
  onOpenThread: async ({ binding }) => {
    await myHost.focusThread(binding.externalThreadId);
  },
  onCopy: async (text) => {
    await navigator.clipboard.writeText(text);
    return true;
  },
  onOpenUrl: async (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },
});

// Imperative host commands after handshake:
host.navigate("/library");
host.setTheme("light");
host.setContext({ repoName: "other-repo" });
// Later:
host.destroy();
```

`useEmbedBridge` inside `apps/web` locks `parentOrigin` from the first valid `host.hello` message so subsequent incoming commands reject mismatched origins.

---

## Mode C · Layer 2 Router-Agnostic React Views (`@inkade/views`)

When your host is a React web application (or Vite/Electron web panel) that wants direct React composition without an iframe:

```tsx
import "@inkade/ui/styles.css";
import "@inkade/ui/host-bridge.css";
import "@inkade/ui/katex.css";

import { InkadeClient } from "@inkade/sdk";
import { InkadeSdkProvider } from "@inkade/sdk/react";
import { InkadeViewsProvider, DailyOutlineView, DocumentDetailView } from "@inkade/views";
import { InkadeI18nProvider } from "@inkade/i18n";

const client = new InkadeClient({ baseUrl: "http://localhost:3456", token });

export function HostKnowledgePanel() {
  return (
    <InkadeI18nProvider locale="en-US">
      <InkadeSdkProvider client={client}>
        <InkadeViewsProvider
          environment={{ effectiveTheme: "dark", density: "compact", hostId: "my-ade" }}
          hostActions={{
            dispatchThread: async (target) => hostDispatch(target),
            openThread: async (binding) => hostOpenThread(binding),
          }}
          navigation={{
            openDaily: (date) => router.push(date ? `/daily/${date}` : "/daily"),
            openDocument: (id) => router.push(`/docs/${id}`),
            openLibrary: () => router.push("/library"),
            openInbox: () => router.push("/inbox"),
            openTasks: () => router.push("/tasks"),
            openThreads: () => router.push("/threads"),
            openSpace: (id) => router.push(`/spaces/${id}`),
            openSettings: () => router.push("/settings"),
          }}
        >
          <DailyOutlineView compact />
        </InkadeViewsProvider>
      </InkadeSdkProvider>
    </InkadeI18nProvider>
  );
}
```

Available views in `@inkade/views`: `SpaceTreeView`, `DailyOutlineView`, `DocumentDetailView`, `DocumentListView`, `TasksView`, `ThreadsView`, plus `DispatchAdeDialog` and `PromoteNodeDialog`. Notice KaTeX CSS is **not** imported inside `@inkade/views` components directly — import `@inkade/ui/katex.css` in your application shell CSS/entry to avoid bundler CSS side-effect leaks across SSR or custom pipelines.

---

## Mode D · Layer 1 Zero-DOM Headless SDK (`@inkade/sdk`, `./offline`, `./react`)

`@inkade/sdk` exposes strict dependency-isolated subpaths (with zero legacy `@inkade/sdk/mobile` shim and zero flat `InkadeClient` aliases):

- `@inkade/sdk` (`.`): pure HTTP `InkadeClient` composed from domain resources (`bootstrap`, `auth`, `spaces`, `documents`, `outlineNodes`, `tasks`, `threadBindings`, `search`, `tokens`, `scopeRules`, `attachments`, `workspace`, `clips`, `highlights`, `templates`, `shareLinks`, `savedViews`, `auditLogs`, `ai`, `preferences`), `InkadeApiError`, `subscribeInkadeEvents`, and `inkadeQueryKeys` — zero DOM, zero Yjs, zero Zod.
- `@inkade/sdk/offline`: DOM-free generic offline mutation queue (`OfflineCacheBackend`, `MemoryOfflineCacheBackend`, `enqueueOfflineMutationWithCache`, `flushOfflineMutationQueue`).
- `@inkade/sdk/sync`: Yjs WebSocket/CRDT client (`YjsDocumentSyncClient` via `y-protocols`) and `idb`-backed `IndexedDbOfflineCacheBackend`.
- `@inkade/sdk/tools`: `INKADE_TOOL_CATALOG` and JSON Schema generator.
- `@inkade/sdk/embed`: `createInkadeEmbedHost` iframe protocol host helper.
- `@inkade/sdk/react`: headless TanStack Query v5 `inkadeQueries` (`queryOptions`), typed query/mutation hooks (`useInkadeWhoami`, `useInkadeSpaces`, `useInkadeDocuments`, `useInkadeTasks`, `useCreateDocumentMutation`, `useUpdateTaskMutation`, etc.), `InkadeSdkProvider`, and `useInkadeRealtimeSync` + `applyInkadeEventToQueryCache`. Verified DOM-free via `tsc -p packages/sdk/tsconfig.react-headless.json --noEmit`.

---

## Building Custom External Host Adapters

Standalone ADE and editor adapters remain intentionally detached from the main Inkade repository so any host ecosystem can maintain and ship its own integration cleanly:

- Use open lowercase host slugs (`hostId`, e.g., `claude-code`, `codex`, `cursor`, `opencode`, `windsurf`, or `custom.ade-1`) and consume `@inkade/sdk/tools` (`INKADE_TOOL_CATALOG`).
- For zero-UI CLI/editor agents, attach directly via Streamable HTTP `POST /mcp` + Scoped API Token (Mode A), or use `@inkade/cli` (`inkade doctor` / `inkade mcp-bridge`).
- For Web/Desktop hosts embedding panels, use `embedTicket` + `/proxy/inkade` iframe + `createInkadeEmbedHost` from `@inkade/sdk/embed` (Mode B) or `@inkade/views` (Mode C).
- For React Native, TUI, or daemon hosts, consume `@inkade/sdk`, `@inkade/sdk/offline`, and zero-DOM `@inkade/sdk/react` (Mode D).
