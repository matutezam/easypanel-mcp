# Fork Workflow and Upstream Sync

This repository is maintained as a fork of:
- Upstream: `dray-supadev/easypanel-mcp`
- Fork: `<your-user>/easypanel-mcp`

Use this workflow to keep upstream improvements while preserving local customizations for your EasyPanel version.

## Remote Layout

Expected remotes:

```bash
git remote -v
# origin   https://github.com/<your-user>/easypanel-mcp.git (fetch/push)
# upstream https://github.com/dray-supadev/easypanel-mcp.git (fetch/push)
```

If needed:

```bash
git remote set-url origin https://github.com/<your-user>/easypanel-mcp.git
git remote add upstream https://github.com/dray-supadev/easypanel-mcp.git
```

## Branching Strategy

- `main`: deployable branch for EasyPanel (always stable).
- `feature/*`: new work, fixes, local compatibility improvements.
- Optional `sync/*`: temporary branches for upstream merge work.

Do not commit secrets or tokens to the repository. Keep credentials only in EasyPanel environment variables.

## Daily Development Flow

```bash
git checkout main
git pull --ff-only origin main

git checkout -b feature/short-description
# make changes
git add .
git commit -m "Describe change"
git push -u origin feature/short-description
```

Open a PR from `feature/*` into `main`.

## Upstream Sync Flow (Recommended)

Run this when you want upstream updates:

```bash
git checkout main
git pull --ff-only origin main
git fetch upstream
# inspect upstream/main, then cherry-pick or manually adapt only the relevant fixes
```

Do **not** merge `upstream/main` blindly. This fork intentionally keeps `src/catalog.ts`, `src/progressive.ts`, `src/server.ts`, `MCP_PROFILE=progressive|direct`, and `MCP_ACCESS_MODE=readonly|full`. Upstream may be monolithic or have a different tool surface, so reconciliation is selective: OAuth fixes, Cloudflare Access support, client/auth fixes, log redaction, CORS/MCP protocol header fixes, and spec conformance are adapted without replacing the progressive/catalog architecture.

## Compatibility Policy for EasyPanel API Changes

EasyPanel API paths can differ across versions (for example `services.app.*` vs older paths).

To avoid breakage:
1. Prefer a compatibility layer in code (route aliases + fallback order).
2. Keep compatibility changes in focused commits with clear messages.
3. Add a smoke checklist for both `readonly` and `full` modes.

Current fork assumption:
- EasyPanel `2.30.1` is the target baseline.
- Service-specific procedures are expected under `services.*`.
- Monitoring uses `monitorOld.getSystemStats`, `monitorOld.getServiceStats`, and `monitorOld.getStorageStats`; newer `metrics.*` procedures are intentionally out of this first correction.
- Progressive discovery is catalog-based and versioned; it is not live runtime discovery from EasyPanel.
- `ep.list_projects` and `ep.list_projects_services` keep the EasyPanel inventory shape, but all MCP tool responses are redacted at the server boundary with stable `[REDACTED:sha256:<8hex>]` fingerprints for secret-like values.
- The live panel's `/api/openapi.json` is the source of truth for compatibility checks.

## Mandatory Post-Upgrade Workflow

After updating the deployed EasyPanel instance, do not redeploy this MCP blindly.

Run this sequence first:

```bash
npm test
npm run generate:manifest
EASYPANEL_URL=http://your-easypanel-host:3000 EASYPANEL_TOKEN=your-token npm run audit:openapi
```

Interpretation:
- If `audit:openapi` passes, the curated catalog still matches the live EasyPanel API surface.
- If `audit:openapi` fails, patch the fork before deploying:
  - update [src/catalog.ts](./src/catalog.ts)
  - update [src/progressive.ts](./src/progressive.ts) if discovery keywords/categories changed
  - update [test/progressive.test.ts](./test/progressive.test.ts)
  - regenerate [catalog-manifest.json](./catalog-manifest.json) with `npm run generate:manifest`
  - rerun `test`, `generate:manifest`, and `audit:openapi`

Only after that should `main` be pushed and redeployed in EasyPanel.

## Runtime Expectations

- Deploy from the fork: `<your-user>/easypanel-mcp`
- Branch: `main`
- Preferred profile: `MCP_PROFILE=progressive`
- Preferred EasyPanel URL: an internal service URL reachable from the MCP container
- Prefer internal networking over published host ports

This prevents two common failures:
- upstream router names drifting away from the real EasyPanel version
- EasyPanel upgrades silently changing the API while the MCP still deploys successfully

Suggested smoke checks after sync:
- `GET /health` returns `200` and expected `auth` state.
- `ep_discover` returns relevant read capabilities.
- `ep_execute_read ep.list_projects` returns inventory data with secret-like values redacted as stable fingerprints and no raw secrets exposed.
- `ep_execute_read ep.list_projects_services` remains compatible.
- `ep_execute_read ep.system_stats`, `ep.service_stats`, and `ep.storage_stats` work against `monitorOld.*`.
- `ep_execute_read ep.list_actions` still works.
- `ep_execute_write_guarded` without `approved=true` blocks writes.
- Only run real write smoke tests in `full` mode with explicit approval and disposable resources.

## Deploying This Fork in EasyPanel

In EasyPanel service source settings:
- Owner: `<your-user>`
- Repo: `easypanel-mcp`
- Branch: `main`
- Path: `/`

Then deploy/restart the service.

## Rollback Strategy

If a new deploy breaks:
1. Set source ref/branch to last known-good commit.
2. Deploy again.
3. Open a fix branch and restore compatibility before re-updating `main`.

## Optional: Keep Fork in Sync Automatically

You can configure a periodic GitHub Action in the fork to open PRs from `upstream/main` into `main`.
Keep this optional until compatibility code is mature.

## Escape Hatch Caveat

`ep.trpc_raw_read` and `ep.trpc_raw_write` are intentional escape hatches for procedures outside the curated catalog. They bypass the curated response-shaping guarantees, so a poorly chosen raw procedure can expose env vars, credentials, tokens, commit/source payloads, or other sensitive data. Prefer curated capabilities for normal agent workflows.
