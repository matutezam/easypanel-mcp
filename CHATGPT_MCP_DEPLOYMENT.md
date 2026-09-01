# ChatGPT MCP deployment notes

This MCP keeps the application contract independent from where it runs. The same progressive profile can be hosted on a Raspberry Pi/private LAN or on a VPS behind EasyPanel or another reverse proxy.

## MCP application contract

- Remote MCP transport: Streamable HTTP.
- MCP endpoint: `/mcp`.
- Health endpoint: `/health`.
- Tool registration must not depend on a public hostname, LAN address, VPN subnet, or reverse-proxy implementation.
- Keep authentication enabled even when network access is restricted.
- After changing tool names, schemas, titles, or annotations, refresh/rescan the MCP app in ChatGPT so its stored tool snapshot is rebuilt.

The progressive profile exposes four stable wrapper tools. MCP annotations describe their behavior to clients; the existing `MCP_ACCESS_MODE` and `approved=true` write guard remain the actual safety boundaries.

## Private LAN / VPN / Raspberry Pi

Do not assume that a private RFC1918 or VPN address is directly reachable from ChatGPT's hosted runtime. Keep the service private and expose it to ChatGPT through a supported secure MCP tunnel or equivalent controlled ingress instead of publishing the raw EasyPanel/MCP port.

Recommended shape:

```text
ChatGPT
  -> secure MCP tunnel / controlled ingress
  -> private MCP URL
  -> easypanel-mcp on RPi/LAN
  -> EasyPanel API
```

A VPN is still useful for administrator access and local MCP clients. The application itself does not need to know which VPN, subnet, or tunnel is in use.

## VPS / EasyPanel / reverse proxy

For a VPS, let EasyPanel/reverse proxy terminate TLS and route a dedicated HTTPS hostname to the MCP service.

Recommended shape:

```text
ChatGPT
  -> https://mcp.example.com/mcp
  -> EasyPanel / reverse proxy
  -> easypanel-mcp container
  -> EasyPanel API
```

Keep either bearer protection (`MCP_API_KEY`) or OAuth enabled. TLS alone is not authorization.

The proxy must preserve:

- `Authorization`
- `Mcp-Session-Id`
- `Mcp-Protocol-Version`
- Streamable HTTP methods (`GET`, `POST`, `DELETE`, plus `OPTIONS` when CORS is involved)
- streaming response behavior

The existing HTTP wrapper already serves MCP at `/mcp` and health data at `/health`; no public-host-specific code should be required.

## Deployment checklist

1. Set `EASYPANEL_MCP_MODE=http` and `MCP_PROFILE=progressive`.
2. Keep `MCP_API_KEY` or OAuth configured.
3. Use `MCP_ACCESS_MODE=readonly` until write operations are intentionally enabled.
4. Confirm `/health` responds without exposing credentials.
5. Confirm `/mcp` is reachable through the intended secure tunnel or HTTPS reverse proxy.
6. Refresh/scan tools in ChatGPT after deployment.
7. Start a new chat, select the MCP app for the message, test `ep_discover`/`ep_execute_read`, and only then test guarded writes.
