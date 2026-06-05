# easypanel-mcp

MCP server for [EasyPanel](https://easypanel.io) — manage your server, projects, services, databases, and domains through any MCP-compatible AI agent (Claude, Cursor, etc.).

**58 direct tools** or **4 progressive wrapper tools** backed by **59 discoverable capabilities**, plus raw EasyPanel RPC access to the rest of the EasyPanel API.

This fork currently targets EasyPanel **2.31.0**, where EasyPanel migrated the API from tRPC to oRPC while keeping backward compatibility. The MCP client prefers `/api/rpc/...` and falls back to `/api/trpc/...` for older panels. Service-specific procedures live under `services.*` and legacy monitoring procedures are exposed under `monitorOld.*`.

## 🚀 Quick Setup (Deploy on EasyPanel)

The easiest way — deploy the MCP server as a service on your own EasyPanel:

### 1. Get your API token

```bash
curl -X POST https://YOUR_PANEL:3000/api/rpc/auth/login \
  -H "Content-Type: application/json" \
  -d '{"json":{"email":"you@email.com","password":"your-pass"}}'
```

> If you have 2FA enabled, add `"code":"123456"` with your authenticator code.

The response contains `"token":"xxx"` — that's your API token.

> ⚠️ This is a **session token** that expires in 30 days. For a permanent token, use `users.generateApiToken` (see below).

### 2. Deploy on EasyPanel

1. Create a new project (e.g. `mcp`)
2. Create an **App** service
3. Source → **GitHub** → `<your-github-user>/easypanel-mcp`, branch `main`
4. Set environment variables:
   ```
   EASYPANEL_URL=http://your-easypanel-host:3000
   EASYPANEL_TOKEN=your-api-token
   EASYPANEL_MCP_MODE=http
   MCP_PROFILE=progressive
   MCP_API_KEY=your-secret-key
   MCP_ACCESS_MODE=readonly
   PORT=3000
   ```
   
   > **Important:** Use an EasyPanel URL that is reachable from the MCP container. When both services run on the same instance, prefer an internal service URL over a public host port.
   
   > **`MCP_PROFILE`**: `direct` exposes all MCP tools directly. `progressive` exposes only `ep_discover`, `ep_capability_schema`, `ep_execute_read`, and `ep_execute_write_guarded`.
   
   > **`MCP_ACCESS_MODE`**: Set to `readonly` to block all write operations (create, deploy, destroy, restart). Set to `full` when you're ready to allow mutations.

5. Add a domain (e.g. `mcp.your-domain.com`)
6. Deploy!

> ⚠️ **Set `MCP_API_KEY`** to protect your endpoint. Without it, anyone with the URL can control your server. Use a simple alphanumeric key — special characters (`!`, `%`, `^`) may break in env vars.

### 3. Connect Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac):

```json
{
  "mcpServers": {
    "easypanel": {
      "url": "https://mcp.your-domain.com/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-key"
      }
    }
  }
}
```

Restart Claude Desktop. Done! Ask Claude to "show my projects" 🎉

## 💻 Local Setup (Alternative)

Run the MCP server locally via stdio (no deployment needed):

```bash
git clone https://github.com/<your-github-user>/easypanel-mcp.git
cd easypanel-mcp
npm install
```

```json
{
  "mcpServers": {
    "easypanel": {
      "command": "node",
      "args": ["/path/to/easypanel-mcp/dist/index.js"],
      "env": {
        "EASYPANEL_URL": "https://your-panel:3000",
        "EASYPANEL_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Fork Maintenance Workflow

If you run this project as a fork (recommended when you need EasyPanel-version-specific compatibility), use:

- [FORK_WORKFLOW.md](./FORK_WORKFLOW.md)

It documents:
- how to keep `origin` (your fork) and `upstream` (original repo),
- how to merge upstream safely without losing local patches,
- how to keep deployable stability on `main`,
- and how to deploy the fork source in EasyPanel.

## Profiles

### Direct profile

- Default when `MCP_PROFILE` is omitted
- Exposes all **58** direct MCP tools
- Best when the client can safely handle the full tool surface

### Progressive profile

- Exposes exactly **4** tools: `ep_discover`, `ep_capability_schema`, `ep_execute_read`, `ep_execute_write_guarded`
- Internally covers **59** discoverable capabilities generated from the same typed catalog as the direct profile
- Discovery is **progressive/catalog-based**: a curated, versioned capability catalog, not live runtime discovery from EasyPanel
- Keeps write operations guarded and makes the catalog versioned in this fork

The generated catalog snapshot is committed in [`catalog-manifest.json`](./catalog-manifest.json) and can be refreshed with:

```bash
npm run generate:manifest
```

After every EasyPanel upgrade, verify that the curated catalog still matches the target instance by auditing it against that panel's published OpenAPI spec:

```bash
EASYPANEL_URL=http://your-easypanel-host:3000 EASYPANEL_TOKEN=your-api-token npm run audit:openapi
```

You can also point it at a saved spec with `OPENAPI_FILE=path/to/openapi.json`.

## 🔧 Direct Tools (58)

### Projects
`list_projects` · `create_project` · `destroy_project` · `inspect_project`

### Common Service Operations
`get_service_notes` · `set_service_notes` · `get_service_error` · `rename_service`

### App Services
`create_app` · `inspect_app` · `deploy_app` · `start_app` · `stop_app` · `restart_app` · `destroy_app` · `set_app_source_image` · `set_app_source_github` · `set_app_env` · `set_app_resources`

### Box Services
`create_box` · `inspect_box` · `start_box` · `stop_box` · `restart_box` · `destroy_box`

### Databases (Postgres, MySQL, MariaDB, MongoDB, Redis)
`create_database` · `inspect_database` · `destroy_database`

### Domains & Ports
`list_domains` · `create_domain` · `delete_domain` · `create_port` · `list_ports`

### Volumes
`create_mount` · `list_mounts`

### Monitoring
`system_stats` · `service_stats` · `storage_stats`

### Docker Compose
`create_compose` · `inspect_compose` · `deploy_compose`

### WordPress Services
`create_wordpress` · `inspect_wordpress` · `start_wordpress` · `stop_wordpress` · `restart_wordpress` · `destroy_wordpress`

### System
`cleanup_docker` · `system_prune` · `restart_panel` · `reboot_server` · `list_users` · `list_certificates` · `list_nodes` · `deploy_template`

### Escape Hatch
`trpc_raw` — compatibility escape hatch to call EasyPanel RPC procedures directly by operation id. Use carefully: raw calls can expose sensitive response data if the chosen procedure returns credentials, env vars, tokens, source metadata, or other secrets.

## 🔒 Security

- **`MCP_API_KEY`** — protects the HTTP endpoint with Bearer token auth
- **`EASYPANEL_AUTH_MODE=oauth`** — optional HTTP OAuth mode where each caller authenticates to EasyPanel instead of sharing one backend token
- **`EASYPANEL_TOKEN`** — authenticates with your EasyPanel instance in stdio/bearer modes
- **Cloudflare Access service headers** — `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` are forwarded to EasyPanel when the backend sits behind Zero Trust
- Health endpoint (`/health`) is always public (returns no sensitive data)
- In local/stdio mode, no network auth is needed
- Request logging redacts sensitive headers in debug output

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EASYPANEL_URL` | ✅ | Your EasyPanel URL |
| `EASYPANEL_TOKEN` | Bearer/stdio | API token from login; not required for HTTP OAuth mode |
| `EASYPANEL_MCP_MODE` | For HTTP | Set to `http` for remote deployment |
| `EASYPANEL_AUTH_MODE` | No | `bearer` (default) or `oauth` for HTTP mode |
| `OAUTH_ISSUER_URL` | OAuth | Public MCP server URL used in OAuth metadata |
| `OAUTH_STORE_PATH` | No | OAuth token store path |
| `MCP_PROFILE` | No | `direct` (default) or `progressive` |
| `MCP_API_KEY` | Bearer HTTP | Protects the MCP endpoint in bearer mode |
| `MCP_ACCESS_MODE` | No | `full` (default) or `readonly` — blocks all mutations |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | No | Cloudflare Access service token headers for backend EasyPanel calls |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | No | Verify Cloudflare Access JWTs during OAuth authorization |
| `CF_ACCESS_REQUIRE_EMAIL_MATCH` | No | Require OAuth EasyPanel email to match Cloudflare Access email |
| `PORT` | No | HTTP port (default: 3000) |

## Generating a Permanent API Token

Session tokens from `auth.login` expire in 30 days. For a permanent token:

**Step 1.** Get your user ID:

```bash
curl -s "https://YOUR_PANEL:3000/api/rpc/users/listUsers" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

Find your email in the response and copy the `"id"` field.

**Step 2.** Generate the permanent token:

```bash
curl -s -X POST "https://YOUR_PANEL:3000/api/rpc/users/generateApiToken" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"json":{"id":"YOUR_USER_ID"}}'
```

**Step 3.** Retrieve the token — list users again:

```bash
curl -s "https://YOUR_PANEL:3000/api/rpc/users/listUsers" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

Your user now has an `"apiToken"` field — that's the permanent token. Set it as `EASYPANEL_TOKEN` in your MCP service env.

> This token **never expires** unless you revoke it via `users.revokeApiToken`.

## How It Works

EasyPanel exposes an oRPC API at `/api/rpc/`, a legacy-compatible tRPC API at `/api/trpc/`, and an OpenAPI export at `/api/openapi.json`. This fork keeps a typed registry of curated MCP tools, plus raw RPC access for everything outside the curated surface. For EasyPanel **2.31.0**, the client sends query inputs as oRPC/OpenAPI bracket-notation params such as `json[projectName]=...`, sends mutation inputs as `{ "json": ... }`, and falls back to older encodings only when needed. `ep.list_projects` and the compatibility alias `ep.list_projects_services` keep the EasyPanel inventory shape, while all MCP responses pass through a global redaction boundary before reaching the model. Sensitive values such as tokens, passwords, API keys, two-factor secrets, bearer headers, and secret-like env vars are replaced with stable fingerprints like `[REDACTED:sha256:8f3a91c2]`.

In this fork, both the direct and progressive profiles are generated from the same typed registry. That registry drives:

- direct MCP tool registration
- progressive capability discovery/schema/execution
- `/health` counts
- `catalog-manifest.json`
- `audit:openapi` compatibility checks against a real EasyPanel instance

## Disclaimer

This tool communicates with EasyPanel's public RPC API. Some EasyPanel features may require a valid license. Please respect [EasyPanel's licensing terms](https://easypanel.io/pricing). This project is not affiliated with or endorsed by EasyPanel.

## License

MIT
