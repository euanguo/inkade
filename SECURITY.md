# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in **Inkade** (for example, related to token scoping, SQL pushdown, dual-origin iframe sandboxing, attachment downloads, Better Auth session handling, or CORS/CSRF origin validation), please **do not open a public issue** with exploit details.

Instead, please report it privately via **GitHub Security Advisories** (`Security` → `Advisories` → `Report a vulnerability`) in this repository, including:

- A description of the vulnerability and affected endpoints or components
- Steps to reproduce or a minimal proof of concept
- Potential impact assessment

We will acknowledge receipt promptly and coordinate remediation and disclosure before publishing details.

---

## Self-Hosting Security Baseline

Before exposing an Inkade instance to the internet, verify the production hardening checklist in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md):

1. Set `NODE_ENV=production` and `INKADE_LOCAL_AUTO_AUTH=false`.
2. Replace `INKADE_AUTH_SECRET` with a strong random secret (`openssl rand -hex 32`).
3. Configure `INKADE_BASE_URL` cleanly and leave `INKADE_ALLOW_SIGNUP=false` after registering the initial workspace owner.
4. Use a distinct sandbox domain (`INKADE_SANDBOX_ORIGIN`) whenever serving untrusted interactive Artifacts.
5. Scope MCP tokens to least-privilege `spaceIds`, `tagAllowlist`, `allowedKinds`, and keep `denyHardDelete: true`.
