# Repository Instructions

This file is the public baseline for the repository.

If `AGENTS.local.md` exists locally, read it as well and treat it as environment-specific guidance that augments this file. `AGENTS.local.md` must stay local and must not be committed.

## EasyPanel Compatibility Rules

- Treat the deployed EasyPanel instance you are targeting as the source of truth.
- Do not assume upstream procedure names are still correct after an EasyPanel upgrade.
- For EasyPanel `2.26.x`, service-specific tRPC procedures live under `services.*`.
- Prefer `GET /api/openapi.json` from the target EasyPanel instance over reverse-engineered docs when validating compatibility.

## Compatibility Workflow

When EasyPanel is upgraded or compatibility is in doubt, future agents should follow this order before changing or redeploying this MCP:

1. Run local validation:
   - `npm run build`
   - `npm test`
2. Run compatibility audit against the target EasyPanel instance:
   - `EASYPANEL_URL=http://your-easypanel-host:3000 EASYPANEL_TOKEN=... npm run audit:openapi`
3. If the audit fails:
   - patch `src/catalog.ts`
   - update discovery/ranking if needed in `src/progressive.ts`
   - update tests in `test/progressive.test.ts`
   - regenerate `catalog-manifest.json` with `npm run generate:manifest`
   - rerun `build`, `test`, and `audit:openapi`
4. Only then push and redeploy.

## Publication Safety

- Do not commit or publish personal data, credentials, tokens, private keys, session cookies, or raw auth headers.
- Do not publish real infrastructure identifiers such as public IPs, internal hostnames, SSH key paths, personal email addresses, or deployment-specific service names.
- Do not commit raw research notes, API dumps, OpenAPI exports, screenshots, or logs taken from a live environment unless they have been reviewed and sanitized first.
- Keep all examples, manifests, tests, and documentation generic. Use placeholders like `sample-project`, `sample-service`, `example-user`, and `your-easypanel-host`.
- Before pushing, review staged changes and recent history for sensitive material, not just the current working tree.

## Local Overrides

- Put deployment-specific assumptions, private hostnames, real service names, and operator workflow in `AGENTS.local.md`.
- Use [`AGENTS.local.example.md`](./AGENTS.local.example.md) as the tracked template for that local file.
- Do not reference `AGENTS.local.md` from committed docs with real values copied into public files.

## Change Policy

- Do not update EasyPanel and this MCP in the same blind step.
- Do not remove compatibility code just because upstream changed.
- Keep compatibility changes in focused commits with explicit messages mentioning the EasyPanel version or router change.
