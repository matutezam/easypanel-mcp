# Fork Workflow and Upstream Sync

This repository is maintained as a fork of:
- Upstream: `dray-supadev/easypanel-mcp`
- Fork: `<your-github-user>/easypanel-mcp`

Use this workflow to keep upstream improvements while preserving local customizations for your EasyPanel version.

## Remote Layout

Expected remotes:

```bash
git remote -v
# origin   https://github.com/<your-github-user>/easypanel-mcp.git (fetch/push)
# upstream https://github.com/dray-supadev/easypanel-mcp.git (fetch/push)
```

If needed:

```bash
git remote set-url origin https://github.com/<your-github-user>/easypanel-mcp.git
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
git merge upstream/main
# resolve conflicts if needed
git push origin main
```

If conflicts happen:
1. Keep upstream improvements by default.
2. Re-apply local compatibility patches intentionally (do not blindly keep old code).
3. Run smoke checks before pushing.

## Compatibility Policy for EasyPanel API Changes

EasyPanel API paths can differ across versions (for example `services.app.*` vs older paths).

To avoid breakage:
1. Prefer a compatibility layer in code (route aliases + fallback order).
2. Keep compatibility changes in focused commits with clear messages.
3. Add a smoke checklist for both `readonly` and `full` modes.

Suggested smoke checks after sync:
- `GET /health` returns `200` and expected `auth` state.
- `list_projects` works through MCP.
- In `readonly`: mutations return blocked error.
- In `full`: create/delete test resource succeeds.

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
