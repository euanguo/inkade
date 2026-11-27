# Inkade Self-Hosting & Deployment Guide

> [Back to README](../README.md) · [简体中文主文档](../README.zh-CN.md)

Inkade is designed to run as a **zero-external-dependency single container** for individuals and small teams, while preserving clean architectural seams (`packages/db` repository ports and workspace isolation) for future multi-tenant scaling.

---

## 1. Runtime Footprint (What Runs in the Container)

A single `bun apps/server/src/index.ts` process serves all subsystems on `PORT` (default `3456`):

| Subsystem | Endpoint / Path | Backing Implementation |
| :--- | :--- | :--- |
| **REST API** | `/api/v1/*` | Hono + Zod validation + `TokenScope` SQL pushdown |
| **Streamable HTTP MCP** | `/mcp` | Official `@modelcontextprotocol/sdk` + `@hono/mcp` |
| **Authentication** | `/api/auth/*` | Better Auth (`POST /api/auth/sign-up/*` locks after first owner unless opted in) |
| **Realtime Events (SSE)** | `/api/v1/events` | Scope-filtered in-memory `SseHub` (`Last-Event-ID` replay) |
| **Yjs CRDT Sync** | `/api/v1/sync/:docId` | `Bun.serve` WebSocket (`y-protocols`, `idleTimeout: 120`, debounced SQLite persist) |
| **Artifact Sandbox Host** | `/sandbox/*` & `*.sandbox` | Dual-origin iframe tickets (`Zero Cookie Access`, strict CSP) |
| **Health Check** | `GET /api/v1/health` | Verifies live SQLite readability (`200 OK` or `503`) |
| **Web & PWA Static Assets** | `/` | Prebuilt `apps/web/dist` (`INKADE_WEB_DIST_DIR`) |
| **SQLite + Blobs** | `INKADE_DB_PATH` & `INKADE_DATA_DIR` | SQLite WAL + FTS5 database and attachment files on persistent disk |

On `SIGINT` / `SIGTERM`, the server stops accepting new traffic, flushes open Yjs rooms (`flushAllRooms()`), and runs `PRAGMA wal_checkpoint(TRUNCATE)` before exit.

---

## 2. Deployment Topologies Compared

| Topology | Best For | Pros | Limitations / Watchouts |
| :--- | :--- | :--- | :--- |
| **Docker Compose + Caddy / Nginx (VPS)** | Public SaaS-like personal instance | Auto TLS (incl. wildcard sandboxes with DNS-01), full SSE/WebSocket control, ~$4–6/mo | Requires a small VM with persistent block disk |
| **Home Server / Mini PC + Cloudflare Tunnel + R2** | Zero open firewall ports, local hardware | Zero VPS cost or cheap NAT box, free CF edge, automatic off-site R2 backups via Litestream | CF Free Universal SSL only covers first-level wildcards (`*.sandbox.tld`); see Section 4 |
| **Local Single-User Workstation** | Offline-first personal use | Zero TLS config, native `*.sandbox.localhost` subdomain isolation | Single machine only unless tunneled |
| **Pure Cloudflare Workers + D1 + Pages** | **Not supported today** | — | Server relies on `bun:sqlite` WAL/FTS5, `Bun.serve` stateful Yjs WebSocket rooms, local FS blobs (`INKADE_DATA_DIR`), in-memory `@orama/orama`, and `croner` |

---

## 3. Quick Start: Docker Compose + Reverse Proxy

### Step 1: Prepare Environment Variables

```bash
cp .env.example .env
openssl rand -hex 32
```

Set the generated 64-character hex string in `.env` as `INKADE_AUTH_SECRET`, and configure your public domain:

```env
NODE_ENV=production
PORT=3456
HOST=0.0.0.0
INKADE_DB_PATH=/data/inkade.db
INKADE_DATA_DIR=/data
INKADE_LOCAL_AUTO_AUTH=false
INKADE_ALLOW_SIGNUP=false

INKADE_AUTH_SECRET=<your-64-char-hex-secret>
INKADE_BASE_URL=https://notes.example.com
INKADE_APP_ORIGIN=https://notes.example.com
# Dual-origin sandbox pattern (recommended for strict cookie isolation):
INKADE_SANDBOX_ORIGIN=https://{id}.inkade-sandbox.example
# Or enable degraded single-domain sandbox mode if you only own one hostname:
# INKADE_SANDBOX_SAME_SITE=true
```

### Step 2: Start the Container

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:3456/api/v1/health
```

> **Owner Initialization Lock (`INKADE_ALLOW_SIGNUP`)**: On first boot (0 users in the database), visit `https://notes.example.com` and create the workspace owner account. Once the first user exists, `/api/auth/sign-up/*` automatically returns `403 SIGNUP_DISABLED` and hides the Sign-Up tab unless `INKADE_ALLOW_SIGNUP=true` is explicitly set.

### Step 3: Reverse Proxy Configuration

Because Inkade uses **Server-Sent Events (`/api/v1/events`)** and **Yjs WebSockets (`/api/v1/sync/:docId`)**, your proxy must disable response buffering for SSE and forward standard `Upgrade` + `X-Forwarded-*` headers.

#### Caddy (`Caddyfile`)

```caddyfile
notes.example.com {
  reverse_proxy 127.0.0.1:3456 {
    flush_interval -1
  }
}

# Optional dual-origin sandbox wildcard (with DNS-01 ACME provider for auto-TLS)
*.inkade-sandbox.example {
  reverse_proxy 127.0.0.1:3456
}
```

#### Nginx

```nginx
server {
  listen 443 ssl http2;
  server_name notes.example.com *.inkade-sandbox.example;

  client_max_body_size 50m;

  location / {
    proxy_pass http://127.0.0.1:3456;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # Critical for SSE (/api/v1/events) and long-lived Yjs sync sessions
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
  }
}
```

---

## 4. Cloudflare Tunnel (`cloudflared`) & Sandbox Domain Notes

If you expose a Docker Compose or local Bun instance behind **Cloudflare Tunnel**:

1. Point the Tunnel ingress rule for `notes.example.com` (and your sandbox host if external) to `http://127.0.0.1:3456`.
2. In Cloudflare **Caching / Rules**, ensure `/api/*` and `/mcp` bypass edge caching so SSE and API responses stream untouched.
3. **Dual-Origin Wildcard Caveat on Cloudflare Free Plans**:
   - Cloudflare Free Universal SSL automatically issues edge certificates for first-level wildcards (`*.sandbox-example.com`), **not** deeper wildcards (`*.sandbox.example.com` requires Cloudflare Advanced Certificate Manager).
   - **Recommended**: dedicate an inexpensive secondary domain for Artifacts (`INKADE_SANDBOX_ORIGIN=https://{id}.your-sandbox-domain.com`), or map a single hostname and set `INKADE_SANDBOX_SAME_SITE=true` when strict cross-origin wildcards are unavailable.

---

## 5. Production Security Checklist

Verify these controls before opening your instance to the internet:

- [ ] `NODE_ENV=production` is set (`apps/server` emits startup warnings if placeholder secrets remain).
- [ ] `INKADE_LOCAL_AUTO_AUTH=false` (never expose passwordless local auto-auth publicly).
- [ ] `INKADE_AUTH_SECRET` is a unique 32+ character random value.
- [ ] `INKADE_BASE_URL` matches your HTTPS public origin (`https://notes.example.com`) so Better Auth `trustedOrigins` validates proxy `Origin` headers cleanly.
- [ ] `INKADE_ALLOW_SIGNUP=false` (or left unset) and initial owner account has already been registered right after first boot.
- [ ] MCP integrations use least-privilege scoped tokens (`spaceIds`, `tagAllowlist`, `allowedKinds`, `denyHardDelete: true`).
- [ ] Untrusted attachment downloads remain safe (`GET /api/v1/attachments/:id/download` forces `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and `Content-Security-Policy: default-src 'none'; sandbox` for HTML/SVG files).

---

## 6. Backup, Restore & Migrations

### Safe Online SQLite Backup (to Local Disk or Cloudflare R2)

Never copy `inkade.db` with plain `cp` while writes are happening in WAL mode. Use SQLite's online backup API or **Litestream**:

```bash
# Consistent point-in-time snapshot without stopping the container
sqlite3 /path/to/data/inkade.db ".backup '/tmp/inkade-backup-$(date +%F).db'"

# Bundle database snapshot + uploaded attachments
tar -czf "/tmp/inkade-archive-$(date +%F).tar.gz" \
  -C /tmp "inkade-backup-$(date +%F).db" \
  -C /path/to/data attachments
```

### Schema Migrations

Schema migrations run automatically from single-source Drizzle SQL files (`packages/db/drizzle/*.sql`) on server startup or explicitly via:

```bash
bun run db:migrate   # Back up legacy data and apply schema migrations
bun run db:reset     # Danger: drop and recreate a clean database
```
