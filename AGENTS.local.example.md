# Local Repository Instructions

This file is a template for `AGENTS.local.md`.

- Copy it to `AGENTS.local.md`.
- Keep `AGENTS.local.md` out of git.
- Put only environment-specific or operator-specific guidance there.

## Local Target

- EasyPanel URL: `http://your-easypanel-host:3000`
- Preferred internal URL: `http://your-internal-service-name:3000`
- Deployment profile: `progressive`
- Source of truth: the deployed EasyPanel instance you operate

## Local Post-Upgrade Workflow

1. Run:
   - `npm run build`
   - `npm test`
2. Audit against the real panel:
   - `EASYPANEL_URL=http://your-easypanel-host:3000 EASYPANEL_TOKEN=... npm run audit:openapi`
3. If the audit fails:
   - patch `src/catalog.ts`
   - update discovery/ranking in `src/progressive.ts` if needed
   - update `test/progressive.test.ts`
   - regenerate `catalog-manifest.json` with `npm run generate:manifest`
   - rerun `build`, `test`, and `audit:openapi`
4. Only then push and redeploy.

## Local Deployment Assumptions

- The deployed service is expected to run with `MCP_PROFILE=progressive`.
- Prefer internal EasyPanel networking over published host ports.
- Keep runtime-specific repo names, service names, hostnames, and operator notes here, not in public docs.

## Local Notes

- Record private service names, internal URLs, and deployment shortcuts here if they are useful.
- Do not paste secrets unless absolutely necessary. Prefer environment variables or password managers.
