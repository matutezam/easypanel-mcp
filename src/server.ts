import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EasyPanelClient } from "./client.js";
import {
  buildCatalogManifest,
  buildZodShape,
  createServerContext,
  directToolSpecs,
} from "./catalog.js";
import {
  discoverCapabilities,
  executeReadCapability,
  executeWriteCapability,
  getCapabilitySchema,
  progressiveExternalTools,
} from "./progressive.js";

export type McpProfile = "direct" | "progressive";

type ServerDependencies = {
  client: EasyPanelClient;
  profile: McpProfile;
  readonly: boolean;
};

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

export function createServerFactory(deps: ServerDependencies): () => McpServer {
  return () => createMcpServer(deps);
}

export function getServerHealth(deps: Pick<ServerDependencies, "profile">) {
  const manifest = buildCatalogManifest();
  return {
    profile: deps.profile,
    tools: deps.profile === "progressive" ? progressiveExternalTools.length : directToolSpecs.length,
    directTools: manifest.profiles.direct.exposedTools,
    catalogCapabilities: manifest.profiles.progressive.discoverableCapabilities,
  };
}

function createMcpServer(deps: ServerDependencies) {
  const server = new McpServer({ name: "easypanel", version: "0.3.0" });
  const ctx = createServerContext(deps.client, deps.readonly);

  if (deps.profile === "progressive") {
    registerProgressiveTools(server, ctx);
  } else {
    registerDirectTools(server, ctx);
  }

  return server;
}

function registerDirectTools(server: McpServer, ctx: ReturnType<typeof createServerContext>) {
  for (const toolSpec of directToolSpecs) {
    server.tool(
      toolSpec.toolName,
      toolSpec.description,
      buildZodShape(toolSpec.input),
      async (args) => {
        try {
          const data = await toolSpec.handler(ctx, args as Record<string, unknown>);
          return ok(data);
        } catch (error) {
          return err(error);
        }
      },
    );
  }
}

function registerProgressiveTools(server: McpServer, ctx: ReturnType<typeof createServerContext>) {
  server.tool(
    "ep_discover",
    "Discover a short list of relevant EasyPanel capabilities based on intent and risk.",
    {
      intent: z.string().optional().describe("What user wants to do in EasyPanel."),
      risk: z.enum(["read", "write"]).optional().describe("Use read or write."),
    },
    async ({ intent, risk }) => ok(discoverCapabilities(intent, risk)),
  );

  server.tool(
    "ep_capability_schema",
    "Return full input schema and usage examples for one capabilityId.",
    {
      capabilityId: z.string().describe("Capability identifier from ep_discover."),
    },
    async ({ capabilityId }) => ok(getCapabilitySchema(capabilityId)),
  );

  server.tool(
    "ep_execute_read",
    "Execute approved read-only capabilities.",
    {
      capabilityId: z.string().describe("Read capability id."),
      args: z.string().optional().describe("Arguments JSON string for the capability. Use {} for no-args capabilities."),
    },
    async ({ capabilityId, args }) => ok(await executeReadCapability(ctx, capabilityId, args)),
  );

  server.tool(
    "ep_execute_write_guarded",
    "Execute write capability only when approved=true. Otherwise returns blocked response.",
    {
      capabilityId: z.string().describe("Write capability id."),
      args: z.string().optional().describe("Arguments JSON string for the capability. Use {} for no-args capabilities."),
      approved: z.boolean().optional().describe("Set true only after explicit human approval."),
    },
    async ({ capabilityId, args, approved }) => ok(await executeWriteCapability(ctx, capabilityId, args, approved === true)),
  );
}

function ok(data: unknown): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
