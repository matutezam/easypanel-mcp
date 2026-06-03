#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EasyPanelClient } from "./client.js";
import { startHttpServer } from "./http-server.js";
import { createServerFactory, getServerHealth, McpProfile } from "./server.js";
import type { CFAccessConfig } from "./oauth/cf-access.js";

const EP_URL = process.env.EASYPANEL_URL;
const EP_TOKEN = process.env.EASYPANEL_TOKEN;
const mode = process.env.EASYPANEL_MCP_MODE || "stdio";
const port = parseInt(process.env.PORT || "3100", 10);
const profile = normalizeProfile(process.env.MCP_PROFILE);
const readonly = (process.env.MCP_ACCESS_MODE || "full").toLowerCase() === "readonly";
const authMode = normalizeAuthMode(process.env.EASYPANEL_AUTH_MODE);

if (!EP_URL) {
  console.error("EASYPANEL_URL required");
  process.exit(1);
}

const needsStaticToken = mode !== "http" || authMode !== "oauth";
if (needsStaticToken && !EP_TOKEN) {
  console.error("EASYPANEL_TOKEN required (unless EASYPANEL_MCP_MODE=http and EASYPANEL_AUTH_MODE=oauth)");
  process.exit(1);
}

const backendHeaders = getBackendHeaders();

if (mode === "http") {
  await startHttpServer({
    port,
    easypanelUrl: EP_URL,
    authMode,
    bearerApiKey: process.env.MCP_API_KEY,
    bearerEasypanelToken: EP_TOKEN,
    oauthIssuer: process.env.OAUTH_ISSUER_URL,
    oauthStorePath: process.env.OAUTH_STORE_PATH,
    backendHeaders,
    cfAccess: getCFAccessConfig(),
    getHealth: () => getServerHealth({ profile }),
    createMcpServer: (client) => createServerFactory({ client, profile, readonly })(),
  });
} else {
  const client = new EasyPanelClient(EP_URL, EP_TOKEN, { extraHeaders: backendHeaders });
  const server = createServerFactory({ client, profile, readonly })();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function normalizeProfile(value?: string): McpProfile {
  return String(value || "direct").trim().toLowerCase() === "progressive" ? "progressive" : "direct";
}

function normalizeAuthMode(value?: string): "bearer" | "oauth" {
  return String(value || "bearer").trim().toLowerCase() === "oauth" ? "oauth" : "bearer";
}

function getBackendHeaders(): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function getCFAccessConfig(): CFAccessConfig | undefined {
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
  const aud = process.env.CF_ACCESS_AUD;
  if (!teamDomain || !aud) return undefined;
  return {
    teamDomain,
    audience: aud,
    requireEmailMatch: String(process.env.CF_ACCESS_REQUIRE_EMAIL_MATCH || "").toLowerCase() === "true",
  };
}

