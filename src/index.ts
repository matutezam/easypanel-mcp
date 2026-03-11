#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EasyPanelClient } from "./client.js";
import { startHttpServer } from "./http-server.js";
import { createServerFactory, getServerHealth, McpProfile } from "./server.js";

const EP_URL = process.env.EASYPANEL_URL;
const EP_TOKEN = process.env.EASYPANEL_TOKEN;
const mode = process.env.EASYPANEL_MCP_MODE || "stdio";
const port = parseInt(process.env.PORT || "3100", 10);
const profile = normalizeProfile(process.env.MCP_PROFILE);
const readonly = (process.env.MCP_ACCESS_MODE || "full").toLowerCase() === "readonly";

if (!EP_URL) {
  console.error("EASYPANEL_URL required");
  process.exit(1);
}

if (!EP_TOKEN) {
  console.error("EASYPANEL_TOKEN required");
  process.exit(1);
}

const client = new EasyPanelClient(EP_URL, EP_TOKEN);
const createMcpServer = createServerFactory({ client, profile, readonly });

if (mode === "http") {
  await startHttpServer(createMcpServer, port, () => getServerHealth({ profile }));
} else {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function normalizeProfile(value?: string): McpProfile {
  return String(value || "direct").trim().toLowerCase() === "progressive" ? "progressive" : "direct";
}
