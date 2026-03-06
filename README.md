# easypanel-mcp

MCP server for [EasyPanel](https://easypanel.io) — manage your server, projects, services, databases, and domains through any MCP-compatible AI agent (Claude, Cursor, etc.).

**40 curated tools** + raw tRPC access to all **347 EasyPanel API procedures**.

## 🚀 Quick Setup (Deploy on EasyPanel)

The easiest way — deploy the MCP server as a service on your own EasyPanel:

### 1. Get your API token

```bash
curl -X POST https://YOUR_PANEL:3000/api/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"json":{"email":"you@email.com","password":"your-pass"}}'
```

> If you have 2FA enabled, add `"code":"123456"` with your authenticator code.

The response contains `"token":"xxx"` — that's your API token.

> ⚠️ This is a **session token** that expires in 30 days. For a permanent token, use `users.generateApiToken` (see below).

### 2. Deploy on EasyPanel

1. Create a new project (e.g. `mcp`)
2. Create an **App** service
3. Source → **GitHub** → `dray-supadev/easypanel-mcp`, branch `main`
4. Set environment variables:
   ```
   EASYPANEL_URL=http://your-easypanel-host:3000
   EASYPANEL_TOKEN=your-api-token
   EASYPANEL_MCP_MODE=http
   MCP_API_KEY=your-secret-key
   MCP_ACCESS_MODE=readonly
   PORT=3000
   ```
   
   > **Important:** Use `http://your-easypanel-host:3000` (internal Docker network) when deploying on the same EasyPanel instance. External URLs won't work from inside the container.
   
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
git clone https://github.com/dray-supadev/easypanel-mcp.git
cd easypanel-mcp
npm install && npm run build
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

## 🔧 Available Tools (40)

### Projects
`list_projects` · `create_project` · `destroy_project` · `inspect_project`

### App Services
`create_app` · `inspect_app` · `deploy_app` · `start_app` · `stop_app` · `restart_app` · `destroy_app` · `set_app_source_image` · `set_app_source_github` · `set_app_env` · `set_app_resources`

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

### System
`cleanup_docker` · `system_prune` · `restart_panel` · `reboot_server` · `list_users` · `list_certificates` · `list_nodes` · `deploy_template`

### Escape Hatch
`trpc_raw` — call any of the 347 tRPC procedures directly

## 🔒 Security

- **`MCP_API_KEY`** — protects the HTTP endpoint with Bearer token auth
- **`EASYPANEL_TOKEN`** — authenticates with your EasyPanel instance
- Health endpoint (`/health`) is always public (returns no sensitive data)
- In local/stdio mode, no network auth is needed

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EASYPANEL_URL` | ✅ | Your EasyPanel URL |
| `EASYPANEL_TOKEN` | ✅ | API token from login |
| `EASYPANEL_MCP_MODE` | For HTTP | Set to `http` for remote deployment |
| `MCP_API_KEY` | Recommended | Protects the MCP endpoint |
| `MCP_ACCESS_MODE` | No | `full` (default) or `readonly` — blocks all mutations |
| `PORT` | No | HTTP port (default: 3000) |

## Generating a Permanent API Token

Session tokens from `auth.login` expire in 30 days. For a permanent token:

**Step 1.** Get your user ID:

```bash
curl -s "https://YOUR_PANEL:3000/api/trpc/users.listUsers" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

Find your email in the response and copy the `"id"` field.

**Step 2.** Generate the permanent token:

```bash
curl -s -X POST "https://YOUR_PANEL:3000/api/trpc/users.generateApiToken" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"json":{"id":"YOUR_USER_ID"}}'
```

**Step 3.** Retrieve the token — list users again:

```bash
curl -s "https://YOUR_PANEL:3000/api/trpc/users.listUsers" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

Your user now has an `"apiToken"` field — that's the permanent token. Set it as `EASYPANEL_TOKEN` in your MCP service env.

> This token **never expires** unless you revoke it via `users.revokeApiToken`.

## How It Works

EasyPanel exposes a tRPC API at `/api/trpc/`. This MCP server was built by reverse-engineering EasyPanel's frontend to extract all 347 procedure names across 43 namespaces, then mapping the most useful ones to typed MCP tools.

## Disclaimer

This tool communicates with EasyPanel's public tRPC API. Some EasyPanel features may require a valid license. Please respect [EasyPanel's licensing terms](https://easypanel.io/pricing). This project is not affiliated with or endorsed by EasyPanel.

## License

MIT
