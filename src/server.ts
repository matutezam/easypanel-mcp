import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EasyPanelClient } from "./client.js";
import {
  buildCatalogManifest,
  buildZodShape,
  createServerContext,
  directToolSpecs,
  executeToolSpec,
} from "./catalog.js";
import {
  discoverCapabilities,
  executeReadCapability,
  executeWriteCapability,
  getCapabilitySchema,
  progressiveExternalTools,
} from "./progressive.js";
import { redactForModel, redactTextForModel } from "./redaction.js";

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

export const progressiveToolMetadata = {
  ep_discover: {
    title: "Discover EasyPanel capabilities",
    description: "Discover a short list of relevant EasyPanel capabilities based on intent and risk.",
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  ep_capability_schema: {
    title: "Get EasyPanel capability schema",
    description: "Return full input schema and usage examples for one capabilityId.",
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  ep_execute_read: {
    title: "Read from EasyPanel",
    description: "Execute approved read-only capabilities.",
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  ep_execute_write_guarded: {
    title: "Write to EasyPanel (guarded)",
    description: "Execute write capability only when approved=true. Otherwise returns blocked response.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
} as const;

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
          const data = await executeToolSpec(ctx, toolSpec, args as Record<string, unknown>);
          return ok(data);
        } catch (error) {
          return err(error);
        }
      },
    );
  }
}

function registerProgressiveTools(server: McpServer, ctx: ReturnType<typeof createServerContext>) {
  server.registerTool(
    "ep_discover",
    {
      ...progressiveToolMetadata.ep_discover,
      inputSchema: {
        intent: z.string().optional().describe("What user wants to do in EasyPanel."),
        risk: z.enum(["read", "write"]).optional().describe("Use read or write."),
      },
    },
    async ({ intent, risk }) => ok(discoverCapabilities(intent, risk)),
  );

  server.registerTool(
    "ep_capability_schema",
    {
      ...progressiveToolMetadata.ep_capability_schema,
      inputSchema: {
        capabilityId: z.string().describe("Capability identifier from ep_discover."),
      },
    },
    async ({ capabilityId }) => ok(getCapabilitySchema(capabilityId)),
  );

  server.registerTool(
    "ep_execute_read",
    {
      ...progressiveToolMetadata.ep_execute_read,
      inputSchema: {
        capabilityId: z.string().describe("Read capability id."),
        args: z.string().optional().describe("Arguments JSON string for the capability. Use {} for no-args capabilities."),
      },
    },
    async ({ capabilityId, args }) => ok(await executeReadCapability(ctx, capabilityId, args)),
  );

  server.registerTool(
    "ep_execute_write_guarded",
    {
      ...progressiveToolMetadata.ep_execute_write_guarded,
      inputSchema: {
        capabilityId: z.string().describe("Write capability id."),
        args: z.string().optional().describe("Arguments JSON string for the capability. Use {} for no-args capabilities."),
        approved: z.boolean().optional().describe("Set true only after explicit human approval."),
      },
    },
    async ({ capabilityId, args, approved }) => ok(await executeWriteCapability(ctx, capabilityId, args, approved === true)),
  );
}

function ok(data: unknown): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(redactForModel(data), null, 2) }] };
}

function err(error: unknown): ToolResponse {
  const message = redactTextForModel(error instanceof Error ? error.message : String(error));
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
