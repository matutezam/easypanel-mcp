# Repository Instructions

This fork is tied to the real EasyPanel version running on the deployed host, not just to upstream `dray-supadev/easypanel-mcp`.

## EasyPanel Compatibility Rules

- Treat the deployed EasyPanel instance as the source of truth.
- Do not assume upstream procedure names are still correct after an EasyPanel upgrade.
- For EasyPanel `2.26.x`, service-specific tRPC procedures live under `services.*`.
- Prefer `GET /api/openapi.json` from the live EasyPanel instance over reverse-engineered docs when validating compatibility.

## Required Workflow After EasyPanel Updates

When EasyPanel is upgraded, future agents should follow this order before changing or redeploying this MCP:

1. Run local validation:
   - `npm run build`
   - `npm test`
2. Run compatibility audit against the live EasyPanel instance:
   - `EASYPANEL_URL=http://your-easypanel-host:3000 EASYPANEL_TOKEN=... npm run audit:openapi`
3. If the audit fails:
   - patch [src/catalog.ts](/src/catalog.ts)
   - update discovery/ranking if needed in [src/progressive.ts](/src/progressive.ts)
   - update tests in [test/progressive.test.ts](/test/progressive.test.ts)
   - regenerate [catalog-manifest.json](/catalog-manifest.json) with `npm run generate:manifest`
   - rerun `build`, `test`, and `audit:openapi`
4. Only then push and redeploy.

## Deployment Assumptions

- The EasyPanel service for this fork is intended to run with `MCP_PROFILE=progressive`.
- n8n is no longer the source of truth for the progressive catalog.
- The MCP should use internal EasyPanel networking, not a published host port, whenever possible.

## Change Policy

- Do not update EasyPanel and this MCP in the same blind step.
- Do not remove compatibility code just because upstream changed.
- Keep compatibility changes in focused commits with explicit messages mentioning the EasyPanel version or router change.
