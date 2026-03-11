import { z } from "zod";
import { EasyPanelClient } from "./client.js";

export type OperationKind = "read" | "write" | "mixed";
export type CapabilityMode = "read" | "write_guarded";
export type SafetyClass = "safe" | "guarded" | "dangerous";

type PrimitiveFieldSpec = {
  description?: string;
  optional?: boolean;
};

export type FieldSpec =
  | (PrimitiveFieldSpec & { type: "string" })
  | (PrimitiveFieldSpec & { type: "number" })
  | (PrimitiveFieldSpec & { type: "boolean" })
  | (PrimitiveFieldSpec & { type: "enum"; values: readonly string[] })
  | (PrimitiveFieldSpec & { type: "record"; additionalProperties?: boolean });

export type InputSpec = Record<string, FieldSpec>;

export type JsonSchemaProperty =
  | {
      type: "string" | "number" | "boolean";
      description?: string;
      enum?: readonly string[];
    }
  | {
      type: "object";
      description?: string;
      additionalProperties: boolean;
    };

export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: boolean;
};

export type ServerContext = {
  client: EasyPanelClient;
  readonly: boolean;
  query: (procedure: string, input?: Record<string, unknown>) => Promise<unknown>;
  mutate: (procedure: string, input?: Record<string, unknown>) => Promise<unknown>;
};

export type ToolHandler = (ctx: ServerContext, args: Record<string, unknown>) => Promise<unknown>;

type ProgressiveToolMetadata = {
  category: string;
  keywords: string[];
  safetyClass: SafetyClass;
  summary?: string;
  example?: Record<string, unknown>;
  discoverable?: boolean;
  aliases?: string[];
};

export type ToolSpec = {
  toolName: string;
  description: string;
  input: InputSpec;
  operationKind: OperationKind;
  handler: ToolHandler;
  progressive: ProgressiveToolMetadata | false;
};

export type CapabilitySpec = {
  id: string;
  toolName: string;
  mode: CapabilityMode;
  category: string;
  summary: string;
  description: string;
  safetyClass: SafetyClass;
  keywords: string[];
  example: Record<string, unknown>;
  discoverable: boolean;
  aliases: string[];
  argsSchema: JsonSchemaObject;
  aliasOf?: string;
  mapArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
  transformResult?: (result: unknown, args: Record<string, unknown>) => unknown;
};

const stringField = (description?: string, optional = false): FieldSpec => ({ type: "string", description, optional });
const numberField = (description?: string, optional = false): FieldSpec => ({ type: "number", description, optional });
const booleanField = (description?: string, optional = false): FieldSpec => ({ type: "boolean", description, optional });
const enumField = (values: readonly string[], description?: string, optional = false): FieldSpec => ({
  type: "enum",
  values,
  description,
  optional,
});
const recordField = (description?: string, optional = false, additionalProperties = true): FieldSpec => ({
  type: "record",
  description,
  optional,
  additionalProperties,
});

const projectServiceInput = {
  projectName: stringField("Project name"),
  serviceName: stringField("Service name"),
} satisfies InputSpec;

const noInput = {} satisfies InputSpec;

const databaseEngines = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;

export function buildZodShape(input: InputSpec): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(
    Object.entries(input).map(([name, spec]) => [name, createZodField(spec)]),
  );
}

export function buildArgsSchema(input: InputSpec): JsonSchemaObject {
  const properties = Object.fromEntries(
    Object.entries(input).map(([name, spec]) => [name, createJsonSchemaProperty(spec)]),
  );
  const required = Object.entries(input)
    .filter(([, spec]) => !spec.optional)
    .map(([name]) => name);

  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function createZodField(spec: FieldSpec): z.ZodTypeAny {
  let field: z.ZodTypeAny;

  switch (spec.type) {
    case "string":
      field = z.string();
      break;
    case "number":
      field = z.number();
      break;
    case "boolean":
      field = z.boolean();
      break;
    case "enum":
      field = z.enum([...spec.values] as [string, ...string[]]);
      break;
    case "record":
      field = z.record(z.string(), z.unknown());
      break;
  }

  if (spec.description) {
    field = field.describe(spec.description);
  }

  return spec.optional ? field.optional() : field;
}

function createJsonSchemaProperty(spec: FieldSpec): JsonSchemaProperty {
  switch (spec.type) {
    case "string":
    case "number":
    case "boolean":
      return { type: spec.type, ...(spec.description ? { description: spec.description } : {}) };
    case "enum":
      return {
        type: "string",
        enum: spec.values,
        ...(spec.description ? { description: spec.description } : {}),
      };
    case "record":
      return {
        type: "object",
        additionalProperties: spec.additionalProperties ?? true,
        ...(spec.description ? { description: spec.description } : {}),
      };
  }
}

export function createServerContext(client: EasyPanelClient, readonly: boolean): ServerContext {
  return {
    client,
    readonly,
    query: (procedure, input) => client.query(procedure, input),
    mutate: async (procedure, input) => {
      if (readonly) {
        throw new Error("Read-only mode. Mutations are disabled (MCP_ACCESS_MODE=readonly).");
      }
      return client.mutation(procedure, input ?? {});
    },
  };
}

function sanitizeProjectsAndServices(data: unknown, projectNameFilter?: unknown) {
  if (!data || typeof data !== "object") return [];

  const source = data as {
    projects?: Array<{ name?: string }>;
    services?: Array<{ name?: string; projectName?: string; ports?: Array<{ published?: number | null }> }>;
  };

  if (!Array.isArray(source.projects) || !Array.isArray(source.services)) {
    return [];
  }

  const projects = source.projects;
  const servicesList = source.services;
  const filter = String(projectNameFilter || "").trim().toLowerCase();

  const rows = projects.map((project) => {
    const services = servicesList
      .filter((service) => service.projectName === project.name)
      .map((service) => {
        const ports = Array.isArray(service.ports)
          ? service.ports.map((port) => port.published).filter((value) => value !== undefined && value !== null)
          : [];
        return {
          serviceName: service.name,
          ...(ports.length ? { ports } : {}),
        };
      });

    return { project: project.name, services };
  });

  return filter ? rows.filter((row) => String(row.project || "").toLowerCase() === filter) : rows;
}

function tool(
  toolName: string,
  description: string,
  input: InputSpec,
  operationKind: OperationKind,
  handler: ToolHandler,
  progressive: ProgressiveToolMetadata | false,
): ToolSpec {
  return { toolName, description, input, operationKind, handler, progressive };
}

export const directToolSpecs: ToolSpec[] = [];

directToolSpecs.push(
  tool(
    "list_projects",
    "List all projects and their services",
    noInput,
    "read",
    async (ctx) => ctx.query("projects.listProjectsAndServices"),
    {
      category: "projects",
      keywords: ["project", "projects", "services", "inventory", "overview"],
      safetyClass: "safe",
      summary: "List all projects and their services.",
      example: {},
      aliases: ["ep.list_projects_services"],
    },
  ),
  tool(
    "create_project",
    "Create a new project",
    { name: stringField("Project name (lowercase, no spaces)") },
    "write",
    async (ctx, args) => ctx.mutate("projects.createProject", { name: args.name as string }),
    {
      category: "projects",
      keywords: ["project", "create", "new", "provision"],
      safetyClass: "guarded",
      summary: "Create a new EasyPanel project.",
      example: { name: "demo" },
    },
  ),
  tool(
    "destroy_project",
    "Delete a project and all its services",
    { projectName: stringField("Project name") },
    "write",
    async (ctx, args) => ctx.mutate("projects.destroyProject", args),
    {
      category: "projects",
      keywords: ["project", "delete", "destroy", "remove"],
      safetyClass: "dangerous",
      summary: "Delete a project and all services in it.",
      example: { projectName: "demo" },
    },
  ),
  tool(
    "inspect_project",
    "Get project details and Docker containers",
    { projectName: stringField("Project name") },
    "read",
    async (ctx, args) => ctx.query("projects.inspectProject", args),
    {
      category: "projects",
      keywords: ["project", "inspect", "details", "containers"],
      safetyClass: "safe",
      summary: "Inspect one project and its containers.",
      example: { projectName: "demo" },
    },
  ),
  tool(
    "create_app",
    "Create an app service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate("app.createService", args),
    {
      category: "apps",
      keywords: ["app", "service", "create", "deployable", "web"],
      safetyClass: "guarded",
      summary: "Create an app service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "inspect_app",
    "Get app service details (env, domains, build, source)",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query("app.inspectService", args),
    {
      category: "apps",
      keywords: ["app", "service", "inspect", "env", "domains", "source"],
      safetyClass: "safe",
      summary: "Inspect an app service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "deploy_app",
    "Trigger deployment for an app",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate("app.deployService", args),
    {
      category: "apps",
      keywords: ["app", "deploy", "build", "release"],
      safetyClass: "guarded",
      summary: "Deploy an app service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "start_app",
    "Start an app service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate("app.startService", args),
    {
      category: "apps",
      keywords: ["app", "start", "service", "run"],
      safetyClass: "guarded",
      summary: "Start an app service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "stop_app",
    "Stop an app service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate("app.stopService", args),
    {
      category: "apps",
      keywords: ["app", "stop", "service", "halt"],
      safetyClass: "guarded",
      summary: "Stop an app service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "restart_app",
    "Restart an app service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate("app.restartService", args),
    {
      category: "apps",
      keywords: ["app", "restart", "service", "reload"],
      safetyClass: "guarded",
      summary: "Restart an app service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "destroy_app",
    "Delete an app service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate("app.destroyService", args),
    {
      category: "apps",
      keywords: ["app", "delete", "destroy", "remove"],
      safetyClass: "dangerous",
      summary: "Delete an app service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "set_app_source_image",
    "Set app source to a Docker image",
    {
      ...projectServiceInput,
      image: stringField("Docker image (e.g. nginx:latest)"),
    },
    "write",
    async (ctx, args) => ctx.mutate("app.updateSourceImage", args),
    {
      category: "apps",
      keywords: ["app", "image", "docker", "source"],
      safetyClass: "guarded",
      summary: "Set an app source to a Docker image.",
      example: { projectName: "sample-project", serviceName: "hello-app", image: "nginx:latest" },
    },
  ),
  tool(
    "set_app_source_github",
    "Set app source to a GitHub repo",
    {
      ...projectServiceInput,
      owner: stringField("GitHub owner"),
      repo: stringField("GitHub repository"),
      branch: stringField("Git branch", true),
      path: stringField("Subdirectory", true),
    },
    "write",
    async (ctx, args) => ctx.mutate("app.updateSourceGithub", args),
    {
      category: "apps",
      keywords: ["app", "github", "git", "source", "repo"],
      safetyClass: "guarded",
      summary: "Set an app source to a GitHub repository.",
      example: { projectName: "sample-project", serviceName: "hello-app", owner: "dray-supadev", repo: "easypanel-mcp" },
    },
  ),
  tool(
    "set_app_env",
    "Update environment variables for an app",
    {
      ...projectServiceInput,
      env: stringField("KEY=VALUE lines"),
    },
    "write",
    async (ctx, args) => ctx.mutate("app.updateEnv", args),
    {
      category: "apps",
      keywords: ["app", "env", "environment", "variables", "config"],
      safetyClass: "guarded",
      summary: "Update app environment variables.",
      example: { projectName: "sample-project", serviceName: "hello-app", env: "NODE_ENV=production" },
    },
  ),
  tool(
    "set_app_resources",
    "Set CPU/memory limits for an app",
    {
      ...projectServiceInput,
      memoryLimit: numberField("Memory limit MB", true),
      memoryReservation: numberField("Memory reservation MB", true),
      cpuLimit: numberField("CPU limit (1 = 1 core)", true),
      cpuReservation: numberField("CPU reservation", true),
    },
    "write",
    async (ctx, args) => ctx.mutate("app.updateResources", args),
    {
      category: "apps",
      keywords: ["app", "resources", "cpu", "memory", "limits"],
      safetyClass: "guarded",
      summary: "Set CPU and memory limits for an app.",
      example: { projectName: "sample-project", serviceName: "hello-app", memoryLimit: 512, cpuLimit: 1 },
    },
  ),
);

directToolSpecs.push(
  tool(
    "create_compose",
    "Create a Docker Compose service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate("compose.createService", args),
    {
      category: "compose",
      keywords: ["compose", "docker", "stack", "service", "create"],
      safetyClass: "guarded",
      summary: "Create a Docker Compose service.",
      example: { projectName: "sample-project", serviceName: "compose-stack" },
    },
  ),
  tool(
    "inspect_compose",
    "Get compose service details",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query("compose.inspectService", args),
    {
      category: "compose",
      keywords: ["compose", "docker", "stack", "inspect"],
      safetyClass: "safe",
      summary: "Inspect a Docker Compose service.",
      example: { projectName: "sample-project", serviceName: "compose-stack" },
    },
  ),
  tool(
    "deploy_compose",
    "Deploy a compose service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate("compose.deployService", args),
    {
      category: "compose",
      keywords: ["compose", "docker", "stack", "deploy"],
      safetyClass: "guarded",
      summary: "Deploy a Docker Compose service.",
      example: { projectName: "sample-project", serviceName: "compose-stack" },
    },
  ),
  tool(
    "cleanup_docker",
    "Clean up unused Docker images",
    noInput,
    "write",
    async (ctx) => ctx.mutate("settings.cleanupDockerImages"),
    {
      category: "system",
      keywords: ["docker", "cleanup", "images", "maintenance"],
      safetyClass: "guarded",
      summary: "Clean up unused Docker images.",
      example: {},
    },
  ),
  tool(
    "system_prune",
    "Docker system prune (remove all unused data)",
    noInput,
    "write",
    async (ctx) => ctx.mutate("settings.systemPrune"),
    {
      category: "system",
      keywords: ["docker", "prune", "cleanup", "unused", "system"],
      safetyClass: "dangerous",
      summary: "Run Docker system prune.",
      example: {},
    },
  ),
  tool(
    "restart_panel",
    "Restart EasyPanel",
    noInput,
    "write",
    async (ctx) => ctx.mutate("settings.restartEasypanel"),
    {
      category: "system",
      keywords: ["easypanel", "restart", "panel", "admin"],
      safetyClass: "dangerous",
      summary: "Restart EasyPanel itself.",
      example: {},
    },
  ),
  tool(
    "reboot_server",
    "Reboot the server",
    noInput,
    "write",
    async (ctx) => ctx.mutate("server.reboot"),
    {
      category: "system",
      keywords: ["server", "reboot", "host", "restart", "admin"],
      safetyClass: "dangerous",
      summary: "Reboot the EasyPanel host.",
      example: {},
    },
  ),
  tool(
    "list_users",
    "List panel users",
    noInput,
    "read",
    async (ctx) => ctx.query("users.listUsers"),
    {
      category: "admin",
      keywords: ["users", "panel", "admin", "accounts"],
      safetyClass: "safe",
      summary: "List EasyPanel users.",
      example: {},
    },
  ),
  tool(
    "list_certificates",
    "List SSL certificates",
    noInput,
    "read",
    async (ctx) => ctx.query("certificates.listCertificates"),
    {
      category: "admin",
      keywords: ["certificates", "ssl", "tls", "domains"],
      safetyClass: "safe",
      summary: "List SSL certificates.",
      example: {},
    },
  ),
  tool(
    "list_nodes",
    "List cluster nodes",
    noInput,
    "read",
    async (ctx) => ctx.query("cluster.listNodes"),
    {
      category: "admin",
      keywords: ["nodes", "cluster", "workers", "infrastructure"],
      safetyClass: "safe",
      summary: "List cluster nodes.",
      example: {},
    },
  ),
  tool(
    "deploy_template",
    "Deploy from an EasyPanel one-click template",
    {
      projectName: stringField("Project name"),
      schema: recordField("Template schema object"),
    },
    "write",
    async (ctx, args) => ctx.mutate("templates.createFromSchema", args),
    {
      category: "templates",
      keywords: ["template", "one-click", "deploy", "schema"],
      safetyClass: "dangerous",
      summary: "Deploy from an EasyPanel one-click template.",
      example: { projectName: "sample-project", schema: { services: [] } },
    },
  ),
  tool(
    "list_actions",
    "List recent deploy actions/builds. Filter by project or service.",
    {
      projectName: stringField("Project name", true),
      serviceName: stringField("Service name", true),
      limit: numberField("Number of actions to return (default 8)", true),
    },
    "read",
    async (ctx, args) => ctx.query("actions.listActions", args),
    {
      category: "actions",
      keywords: ["actions", "deploy", "build", "history", "logs"],
      safetyClass: "safe",
      summary: "List recent deploy and build actions.",
      example: { projectName: "sample-project", limit: 8 },
    },
  ),
  tool(
    "get_action_log",
    "Get deploy action details including full build/deploy log",
    {
      id: stringField("Action ID from list_actions"),
    },
    "read",
    async (ctx, args) => ctx.query("actions.getAction", args),
    {
      category: "actions",
      keywords: ["actions", "log", "build", "deploy", "trace"],
      safetyClass: "safe",
      summary: "Get full details for one deploy/build action.",
      example: { id: "action-123" },
    },
  ),
  tool(
    "trpc_raw",
    "Call any EasyPanel tRPC procedure directly. 347 procedures across 43 namespaces. Use for anything not covered above.",
    {
      procedure: stringField("Full tRPC procedure name (e.g. 'wordpress.inspectService')"),
      input: recordField("Input object", true),
      isMutation: booleanField("true for write operations, false for reads (default)", true),
    },
    "mixed",
    async (ctx, args) => {
      const procedure = String(args.procedure);
      const input = (args.input && typeof args.input === "object" && !Array.isArray(args.input))
        ? (args.input as Record<string, unknown>)
        : undefined;
      const isMutation = args.isMutation === true;
      return isMutation ? ctx.mutate(procedure, input) : ctx.query(procedure, input);
    },
    false,
  ),
);

directToolSpecs.push(
  tool(
    "create_database",
    "Create a database service",
    {
      ...projectServiceInput,
      engine: enumField(databaseEngines, "Database engine"),
      password: stringField("Password (auto-generated if empty)", true),
    },
    "write",
    async (ctx, args) => {
      const engine = args.engine as string;
      const { engine: _engine, ...rest } = args;
      return ctx.mutate(`${engine}.createService`, rest);
    },
    {
      category: "databases",
      keywords: ["database", "db", "postgres", "mysql", "mariadb", "mongo", "redis", "create"],
      safetyClass: "guarded",
      summary: "Create a database service.",
      example: { projectName: "sample-project", serviceName: "postgres-main", engine: "postgres" },
    },
  ),
  tool(
    "inspect_database",
    "Get database service info (connection string, status)",
    {
      ...projectServiceInput,
      engine: enumField(databaseEngines, "Database engine"),
    },
    "read",
    async (ctx, args) => {
      const engine = args.engine as string;
      const { engine: _engine, ...rest } = args;
      return ctx.query(`${engine}.inspectService`, rest);
    },
    {
      category: "databases",
      keywords: ["database", "db", "inspect", "connection", "status"],
      safetyClass: "safe",
      summary: "Inspect a database service.",
      example: { projectName: "sample-project", serviceName: "postgres-main", engine: "postgres" },
    },
  ),
  tool(
    "destroy_database",
    "Delete a database service",
    {
      ...projectServiceInput,
      engine: enumField(databaseEngines, "Database engine"),
    },
    "write",
    async (ctx, args) => {
      const engine = args.engine as string;
      const { engine: _engine, ...rest } = args;
      return ctx.mutate(`${engine}.destroyService`, rest);
    },
    {
      category: "databases",
      keywords: ["database", "db", "delete", "destroy", "remove"],
      safetyClass: "dangerous",
      summary: "Delete a database service.",
      example: { projectName: "sample-project", serviceName: "postgres-main", engine: "postgres" },
    },
  ),
  tool(
    "list_domains",
    "List domains for a service",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query("domains.listDomains", args),
    {
      category: "domains",
      keywords: ["domain", "domains", "hostnames", "service"],
      safetyClass: "safe",
      summary: "List domains for a service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "create_domain",
    "Add a domain to a service",
    {
      ...projectServiceInput,
      host: stringField("Domain (e.g. app.example.com)"),
      https: booleanField("Enable HTTPS (default true)", true),
      port: numberField("Container port", true),
    },
    "write",
    async (ctx, args) => ctx.mutate("domains.createDomain", args),
    {
      category: "domains",
      keywords: ["domain", "host", "https", "ingress", "add"],
      safetyClass: "guarded",
      summary: "Add a domain to a service.",
      example: { projectName: "sample-project", serviceName: "hello-app", host: "app.example.com", https: true },
    },
  ),
  tool(
    "delete_domain",
    "Remove a domain from a service",
    {
      ...projectServiceInput,
      domainId: stringField("Domain ID"),
    },
    "write",
    async (ctx, args) => ctx.mutate("domains.deleteDomain", args),
    {
      category: "domains",
      keywords: ["domain", "delete", "remove", "host"],
      safetyClass: "guarded",
      summary: "Remove a domain from a service.",
      example: { projectName: "sample-project", serviceName: "hello-app", domainId: "domain-123" },
    },
  ),
  tool(
    "create_port",
    "Expose a port for a service",
    {
      ...projectServiceInput,
      publishedPort: numberField("External port"),
      targetPort: numberField("Container port"),
      protocol: enumField(["tcp", "udp"], "Protocol", true),
    },
    "write",
    async (ctx, args) => ctx.mutate("ports.createPort", args),
    {
      category: "ports",
      keywords: ["port", "ports", "expose", "publish", "tcp", "udp"],
      safetyClass: "guarded",
      summary: "Expose a port for a service.",
      example: { projectName: "sample-project", serviceName: "hello-app", publishedPort: 8080, targetPort: 3000 },
    },
  ),
  tool(
    "list_ports",
    "List exposed ports for a service",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query("ports.listPorts", args),
    {
      category: "ports",
      keywords: ["port", "ports", "published", "service"],
      safetyClass: "safe",
      summary: "List exposed ports for a service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "create_mount",
    "Create a volume mount for a service",
    {
      ...projectServiceInput,
      mountPath: stringField("Path inside container"),
      name: stringField("Volume name", true),
      hostPath: stringField("Host path for bind mount", true),
    },
    "write",
    async (ctx, args) => ctx.mutate("mounts.createMount", args),
    {
      category: "mounts",
      keywords: ["mount", "volume", "storage", "bind", "path"],
      safetyClass: "guarded",
      summary: "Create a volume mount for a service.",
      example: { projectName: "sample-project", serviceName: "hello-app", mountPath: "/data", name: "hello-data" },
    },
  ),
  tool(
    "list_mounts",
    "List volume mounts for a service",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query("mounts.listMounts", args),
    {
      category: "mounts",
      keywords: ["mount", "volume", "storage", "service"],
      safetyClass: "safe",
      summary: "List volume mounts for a service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "system_stats",
    "Get system stats (CPU, memory, disk, network)",
    noInput,
    "read",
    async (ctx) => ctx.query("monitor.getSystemStats"),
    {
      category: "monitoring",
      keywords: ["system", "stats", "cpu", "memory", "disk", "network", "host"],
      safetyClass: "safe",
      summary: "Return host CPU, memory, disk, and network stats.",
      example: {},
    },
  ),
  tool(
    "service_stats",
    "Get resource stats for a service",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query("monitor.getServiceStats", args),
    {
      category: "monitoring",
      keywords: ["service", "stats", "cpu", "memory", "usage"],
      safetyClass: "safe",
      summary: "Return resource stats for a service.",
      example: { projectName: "sample-project", serviceName: "hello-app" },
    },
  ),
  tool(
    "storage_stats",
    "Get storage usage breakdown",
    noInput,
    "read",
    async (ctx) => ctx.query("monitor.getStorageStats"),
    {
      category: "monitoring",
      keywords: ["storage", "stats", "disk", "usage"],
      safetyClass: "safe",
      summary: "Return storage usage breakdown.",
      example: {},
    },
  ),
);

const generatedCapabilitySpecs: CapabilitySpec[] = [];
const extraCapabilitySpecs: CapabilitySpec[] = [];

generatedCapabilitySpecs.push(
  ...directToolSpecs
    .filter((toolSpec) => toolSpec.progressive !== false && toolSpec.operationKind !== "mixed")
    .map((toolSpec): CapabilitySpec => {
      const progressive = toolSpec.progressive as ProgressiveToolMetadata;
      return {
        id: `ep.${toolSpec.toolName}`,
        toolName: toolSpec.toolName,
        mode: toolSpec.operationKind === "read" ? "read" : "write_guarded",
        category: progressive.category,
        summary: progressive.summary ?? toolSpec.description,
        description: toolSpec.description,
        safetyClass: progressive.safetyClass,
        keywords: progressive.keywords,
        example: progressive.example ?? {},
        discoverable: progressive.discoverable ?? true,
        aliases: progressive.aliases ?? [],
        argsSchema: buildArgsSchema(toolSpec.input),
      };
    }),
);

extraCapabilitySpecs.push(
  {
    id: "ep.list_projects_services",
    aliasOf: "ep.list_projects",
    toolName: "list_projects",
    mode: "read",
    category: "projects",
    summary: "List projects and services with exposed ports (sanitized).",
    description: "Legacy alias for project/service inventory with a sanitized response shape.",
    safetyClass: "safe",
    keywords: ["project", "projects", "services", "ports", "inventory"],
    example: { projectName: "sample-project" },
    discoverable: false,
    aliases: [],
    argsSchema: {
      type: "object",
      properties: {
        projectName: { type: "string" },
      },
      additionalProperties: false,
    },
    transformResult: (result, args) => sanitizeProjectsAndServices(result, args.projectName),
  },
  {
    id: "ep.trpc_raw_read",
    toolName: "trpc_raw",
    mode: "read",
    category: "escape-hatch",
    summary: "Call any EasyPanel tRPC query directly.",
    description: "Escape hatch for read-only tRPC procedures not covered by the curated catalog.",
    safetyClass: "guarded",
    keywords: ["trpc", "raw", "query", "escape", "fallback"],
    example: { procedure: "wordpress.inspectService", input: { projectName: "sample-project", serviceName: "blog" } },
    discoverable: true,
    aliases: [],
    argsSchema: {
      type: "object",
      required: ["procedure"],
      properties: {
        procedure: { type: "string", description: "Full tRPC procedure name" },
        input: { type: "object", description: "Input object", additionalProperties: true },
      },
      additionalProperties: false,
    },
    mapArgs: (args) => ({
      procedure: args.procedure,
      ...(args.input !== undefined ? { input: args.input } : {}),
      isMutation: false,
    }),
  },
  {
    id: "ep.trpc_raw_write",
    toolName: "trpc_raw",
    mode: "write_guarded",
    category: "escape-hatch",
    summary: "Call any EasyPanel tRPC mutation directly.",
    description: "Escape hatch for write tRPC procedures not covered by the curated catalog.",
    safetyClass: "dangerous",
    keywords: ["trpc", "raw", "mutation", "escape", "fallback", "write"],
    example: { procedure: "box.createService", input: { projectName: "sample-project", serviceName: "devbox" } },
    discoverable: true,
    aliases: [],
    argsSchema: {
      type: "object",
      required: ["procedure"],
      properties: {
        procedure: { type: "string", description: "Full tRPC procedure name" },
        input: { type: "object", description: "Input object", additionalProperties: true },
      },
      additionalProperties: false,
    },
    mapArgs: (args) => ({
      procedure: args.procedure,
      ...(args.input !== undefined ? { input: args.input } : {}),
      isMutation: true,
    }),
  },
);

export const capabilitySpecs: CapabilitySpec[] = [...generatedCapabilitySpecs, ...extraCapabilitySpecs];
export const directToolMap = new Map<string, ToolSpec>(directToolSpecs.map((spec) => [spec.toolName, spec]));
export const capabilityMap = new Map<string, CapabilitySpec>(capabilitySpecs.map((spec) => [spec.id, spec]));

export function getCapabilitySpec(capabilityId: string): CapabilitySpec | undefined {
  return capabilityMap.get(capabilityId);
}

export function getDiscoverableCapabilities(): CapabilitySpec[] {
  return capabilitySpecs.filter((spec) => spec.discoverable);
}

export function executeToolSpec(
  ctx: ServerContext,
  toolSpec: ToolSpec,
  args: Record<string, unknown>,
): Promise<unknown> {
  return toolSpec.handler(ctx, args);
}

export function buildCatalogManifest() {
  return {
    name: "easypanel",
    profiles: {
      direct: {
        exposedTools: directToolSpecs.length,
      },
      progressive: {
        exposedTools: 4,
        discoverableCapabilities: getDiscoverableCapabilities().length,
      },
    },
    directTools: directToolSpecs.map((spec) => ({
      toolName: spec.toolName,
      description: spec.description,
      operationKind: spec.operationKind,
      inputSchema: buildArgsSchema(spec.input),
      progressive:
        spec.progressive === false
          ? false
          : {
              capabilityId: `ep.${spec.toolName}`,
              category: spec.progressive.category,
              safetyClass: spec.progressive.safetyClass,
              keywords: spec.progressive.keywords,
              aliases: spec.progressive.aliases ?? [],
              discoverable: spec.progressive.discoverable ?? true,
            },
    })),
    progressiveCapabilities: capabilitySpecs.map((spec) => ({
      id: spec.id,
      aliasOf: spec.aliasOf,
      toolName: spec.toolName,
      mode: spec.mode,
      category: spec.category,
      safetyClass: spec.safetyClass,
      discoverable: spec.discoverable,
      aliases: spec.aliases,
      argsSchema: spec.argsSchema,
      example: spec.example,
    })),
  };
}
