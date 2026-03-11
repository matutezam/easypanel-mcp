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
type DatabaseEngine = (typeof databaseEngines)[number];

const serviceNamespaces = ["app", "box", "wordpress", "compose", "common", ...databaseEngines] as const;
type ServiceNamespace = (typeof serviceNamespaces)[number];

function serviceProcedure(namespace: ServiceNamespace, action: string) {
  return `services.${namespace}.${action}`;
}

const projectProcedures = {
  listProjectsAndServices: "projects.listProjectsAndServices",
  createProject: "projects.createProject",
  destroyProject: "projects.destroyProject",
  inspectProject: "projects.inspectProject",
} as const;

const appProcedures = {
  createService: serviceProcedure("app", "createService"),
  inspectService: serviceProcedure("app", "inspectService"),
  deployService: serviceProcedure("app", "deployService"),
  startService: serviceProcedure("app", "startService"),
  stopService: serviceProcedure("app", "stopService"),
  restartService: serviceProcedure("app", "restartService"),
  destroyService: serviceProcedure("app", "destroyService"),
  updateSourceImage: serviceProcedure("app", "updateSourceImage"),
  updateSourceGithub: serviceProcedure("app", "updateSourceGithub"),
  updateEnv: serviceProcedure("app", "updateEnv"),
  updateResources: serviceProcedure("app", "updateResources"),
} as const;

const commonServiceProcedures = {
  getNotes: serviceProcedure("common", "getNotes"),
  getServiceError: serviceProcedure("common", "getServiceError"),
  rename: serviceProcedure("common", "rename"),
  setNotes: serviceProcedure("common", "setNotes"),
} as const;

const boxProcedures = {
  createService: serviceProcedure("box", "createService"),
  inspectService: serviceProcedure("box", "inspectService"),
  startService: serviceProcedure("box", "startService"),
  stopService: serviceProcedure("box", "stopService"),
  restartService: serviceProcedure("box", "restartService"),
  destroyService: serviceProcedure("box", "destroyService"),
} as const;

const composeProcedures = {
  createService: serviceProcedure("compose", "createService"),
  inspectService: serviceProcedure("compose", "inspectService"),
  deployService: serviceProcedure("compose", "deployService"),
} as const;

const wordpressProcedures = {
  createService: serviceProcedure("wordpress", "createService"),
  inspectService: serviceProcedure("wordpress", "inspectService"),
  startService: serviceProcedure("wordpress", "startService"),
  stopService: serviceProcedure("wordpress", "stopService"),
  restartService: serviceProcedure("wordpress", "restartService"),
  destroyService: serviceProcedure("wordpress", "destroyService"),
} as const;

const databaseProcedures = Object.fromEntries(
  databaseEngines.map((engine) => [
    engine,
    {
      createService: serviceProcedure(engine, "createService"),
      inspectService: serviceProcedure(engine, "inspectService"),
      destroyService: serviceProcedure(engine, "destroyService"),
    },
  ]),
) as Record<DatabaseEngine, { createService: string; inspectService: string; destroyService: string }>;

const domainProcedures = {
  listDomains: "domains.listDomains",
  createDomain: "domains.createDomain",
  deleteDomain: "domains.deleteDomain",
} as const;

const portProcedures = {
  createPort: "ports.createPort",
  listPorts: "ports.listPorts",
} as const;

const mountProcedures = {
  createMount: "mounts.createMount",
  listMounts: "mounts.listMounts",
} as const;

const monitorProcedures = {
  getSystemStats: "monitor.getSystemStats",
  getServiceStats: "monitor.getServiceStats",
  getStorageStats: "monitor.getStorageStats",
} as const;

const actionProcedures = {
  listActions: "actions.listActions",
  getAction: "actions.getAction",
} as const;

const adminProcedures = {
  listUsers: "users.listUsers",
  listCertificates: "certificates.listCertificates",
  listNodes: "cluster.listNodes",
} as const;

const systemProcedures = {
  cleanupDockerImages: "settings.cleanupDockerImages",
  systemPrune: "settings.systemPrune",
  restartEasypanel: "settings.restartEasypanel",
  rebootServer: "server.reboot",
  createFromSchema: "templates.createFromSchema",
} as const;

const rawProcedureExamples = {
  read: serviceProcedure("wordpress", "inspectService"),
  write: serviceProcedure("box", "createService"),
} as const;

export const catalogProcedureNames = Array.from(
  new Set([
    ...Object.values(projectProcedures),
    ...Object.values(appProcedures),
    ...Object.values(commonServiceProcedures),
    ...Object.values(boxProcedures),
    ...Object.values(composeProcedures),
    ...Object.values(wordpressProcedures),
    ...Object.values(databaseProcedures).flatMap((procedures) => Object.values(procedures)),
    ...Object.values(domainProcedures),
    ...Object.values(portProcedures),
    ...Object.values(mountProcedures),
    ...Object.values(monitorProcedures),
    ...Object.values(actionProcedures),
    ...Object.values(adminProcedures),
    ...Object.values(systemProcedures),
  ]),
);

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
    async (ctx) => ctx.query(projectProcedures.listProjectsAndServices),
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
    async (ctx, args) => ctx.mutate(projectProcedures.createProject, { name: args.name as string }),
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
    async (ctx, args) => ctx.mutate(projectProcedures.destroyProject, args),
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
    async (ctx, args) => ctx.query(projectProcedures.inspectProject, args),
    {
      category: "projects",
      keywords: ["project", "inspect", "details", "containers"],
      safetyClass: "safe",
      summary: "Inspect one project and its containers.",
      example: { projectName: "demo" },
    },
  ),
  tool(
    "get_service_notes",
    "Get notes attached to a service",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query(commonServiceProcedures.getNotes, args),
    {
      category: "services",
      keywords: ["service", "notes", "metadata", "annotation"],
      safetyClass: "safe",
      summary: "Read notes attached to a service.",
      example: { projectName: "sample-project", serviceName: "sample-service" },
    },
  ),
  tool(
    "set_service_notes",
    "Set or clear notes attached to a service",
    {
      ...projectServiceInput,
      notes: stringField("Service notes. Use an empty string to clear them."),
    },
    "write",
    async (ctx, args) => ctx.mutate(commonServiceProcedures.setNotes, args),
    {
      category: "services",
      keywords: ["service", "notes", "metadata", "annotation", "update"],
      safetyClass: "guarded",
      summary: "Set notes attached to a service.",
      example: { projectName: "sample-project", serviceName: "sample-service", notes: "Managed by MCP" },
    },
  ),
  tool(
    "get_service_error",
    "Get the latest service error reported by EasyPanel",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query(commonServiceProcedures.getServiceError, args),
    {
      category: "services",
      keywords: ["service", "error", "failure", "debug", "diagnostics"],
      safetyClass: "safe",
      summary: "Read the latest EasyPanel error for a service.",
      example: { projectName: "sample-project", serviceName: "sample-service" },
    },
  ),
  tool(
    "rename_service",
    "Rename or move a service to another project",
    {
      oldProjectName: stringField("Current project name"),
      oldServiceName: stringField("Current service name"),
      newProjectName: stringField("New project name"),
      newServiceName: stringField("New service name"),
    },
    "write",
    async (ctx, args) => ctx.mutate(commonServiceProcedures.rename, args),
    {
      category: "services",
      keywords: ["service", "rename", "move", "project", "transfer"],
      safetyClass: "guarded",
      summary: "Rename a service or move it to another project.",
      example: {
        oldProjectName: "sample-project",
        oldServiceName: "sample-service",
        newProjectName: "target-project",
        newServiceName: "renamed-service",
      },
    },
  ),
  tool(
    "create_app",
    "Create an app service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(appProcedures.createService, args),
    {
      category: "apps",
      keywords: ["app", "service", "create", "deployable", "web"],
      safetyClass: "guarded",
      summary: "Create an app service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
    },
  ),
  tool(
    "inspect_app",
    "Get app service details (env, domains, build, source)",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query(appProcedures.inspectService, args),
    {
      category: "apps",
      keywords: ["app", "service", "inspect", "env", "domains", "source"],
      safetyClass: "safe",
      summary: "Inspect an app service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
    },
  ),
  tool(
    "deploy_app",
    "Trigger deployment for an app",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(appProcedures.deployService, args),
    {
      category: "apps",
      keywords: ["app", "deploy", "build", "release"],
      safetyClass: "guarded",
      summary: "Deploy an app service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
    },
  ),
  tool(
    "start_app",
    "Start an app service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(appProcedures.startService, args),
    {
      category: "apps",
      keywords: ["app", "start", "service", "run"],
      safetyClass: "guarded",
      summary: "Start an app service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
    },
  ),
  tool(
    "stop_app",
    "Stop an app service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(appProcedures.stopService, args),
    {
      category: "apps",
      keywords: ["app", "stop", "service", "halt"],
      safetyClass: "guarded",
      summary: "Stop an app service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
    },
  ),
  tool(
    "restart_app",
    "Restart an app service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(appProcedures.restartService, args),
    {
      category: "apps",
      keywords: ["app", "restart", "service", "reload"],
      safetyClass: "guarded",
      summary: "Restart an app service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
    },
  ),
  tool(
    "destroy_app",
    "Delete an app service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(appProcedures.destroyService, args),
    {
      category: "apps",
      keywords: ["app", "delete", "destroy", "remove"],
      safetyClass: "dangerous",
      summary: "Delete an app service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
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
    async (ctx, args) => ctx.mutate(appProcedures.updateSourceImage, args),
    {
      category: "apps",
      keywords: ["app", "image", "docker", "source"],
      safetyClass: "guarded",
      summary: "Set an app source to a Docker image.",
      example: { projectName: "sample-project", serviceName: "web-app", image: "nginx:latest" },
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
    async (ctx, args) => ctx.mutate(appProcedures.updateSourceGithub, args),
    {
      category: "apps",
      keywords: ["app", "github", "git", "source", "repo"],
      safetyClass: "guarded",
      summary: "Set an app source to a GitHub repository.",
      example: { projectName: "sample-project", serviceName: "web-app", owner: "example-user", repo: "example-repo" },
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
    async (ctx, args) => ctx.mutate(appProcedures.updateEnv, args),
    {
      category: "apps",
      keywords: ["app", "env", "environment", "variables", "config"],
      safetyClass: "guarded",
      summary: "Update app environment variables.",
      example: { projectName: "sample-project", serviceName: "web-app", env: "NODE_ENV=production" },
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
    async (ctx, args) => ctx.mutate(appProcedures.updateResources, args),
    {
      category: "apps",
      keywords: ["app", "resources", "cpu", "memory", "limits"],
      safetyClass: "guarded",
      summary: "Set CPU and memory limits for an app.",
      example: { projectName: "sample-project", serviceName: "web-app", memoryLimit: 512, cpuLimit: 1 },
    },
  ),
  tool(
    "create_box",
    "Create a Box service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(boxProcedures.createService, args),
    {
      category: "boxes",
      keywords: ["box", "devbox", "workspace", "ide", "create"],
      safetyClass: "guarded",
      summary: "Create a Box development service.",
      example: { projectName: "sample-project", serviceName: "dev-box" },
    },
  ),
  tool(
    "inspect_box",
    "Get Box service details",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query(boxProcedures.inspectService, args),
    {
      category: "boxes",
      keywords: ["box", "devbox", "workspace", "inspect", "ide"],
      safetyClass: "safe",
      summary: "Inspect a Box development service.",
      example: { projectName: "sample-project", serviceName: "dev-box" },
    },
  ),
  tool(
    "start_box",
    "Start a Box service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(boxProcedures.startService, args),
    {
      category: "boxes",
      keywords: ["box", "devbox", "workspace", "start"],
      safetyClass: "guarded",
      summary: "Start a Box development service.",
      example: { projectName: "sample-project", serviceName: "dev-box" },
    },
  ),
  tool(
    "stop_box",
    "Stop a Box service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(boxProcedures.stopService, args),
    {
      category: "boxes",
      keywords: ["box", "devbox", "workspace", "stop"],
      safetyClass: "guarded",
      summary: "Stop a Box development service.",
      example: { projectName: "sample-project", serviceName: "dev-box" },
    },
  ),
  tool(
    "restart_box",
    "Restart a Box service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(boxProcedures.restartService, args),
    {
      category: "boxes",
      keywords: ["box", "devbox", "workspace", "restart"],
      safetyClass: "guarded",
      summary: "Restart a Box development service.",
      example: { projectName: "sample-project", serviceName: "dev-box" },
    },
  ),
  tool(
    "destroy_box",
    "Delete a Box service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(boxProcedures.destroyService, args),
    {
      category: "boxes",
      keywords: ["box", "devbox", "workspace", "delete", "destroy", "remove"],
      safetyClass: "dangerous",
      summary: "Delete a Box development service.",
      example: { projectName: "sample-project", serviceName: "dev-box" },
    },
  ),
);

directToolSpecs.push(
  tool(
    "create_compose",
    "Create a Docker Compose service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(composeProcedures.createService, args),
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
    async (ctx, args) => ctx.query(composeProcedures.inspectService, args),
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
    async (ctx, args) => ctx.mutate(composeProcedures.deployService, args),
    {
      category: "compose",
      keywords: ["compose", "docker", "stack", "deploy"],
      safetyClass: "guarded",
      summary: "Deploy a Docker Compose service.",
      example: { projectName: "sample-project", serviceName: "compose-stack" },
    },
  ),
  tool(
    "create_wordpress",
    "Create a WordPress service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(wordpressProcedures.createService, args),
    {
      category: "wordpress",
      keywords: ["wordpress", "wp", "blog", "cms", "create"],
      safetyClass: "guarded",
      summary: "Create a WordPress service.",
      example: { projectName: "sample-project", serviceName: "blog-site" },
    },
  ),
  tool(
    "inspect_wordpress",
    "Get WordPress service details",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query(wordpressProcedures.inspectService, args),
    {
      category: "wordpress",
      keywords: ["wordpress", "wp", "blog", "cms", "inspect"],
      safetyClass: "safe",
      summary: "Inspect a WordPress service.",
      example: { projectName: "sample-project", serviceName: "blog-site" },
    },
  ),
  tool(
    "start_wordpress",
    "Start a WordPress service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(wordpressProcedures.startService, args),
    {
      category: "wordpress",
      keywords: ["wordpress", "wp", "blog", "cms", "start"],
      safetyClass: "guarded",
      summary: "Start a WordPress service.",
      example: { projectName: "sample-project", serviceName: "blog-site" },
    },
  ),
  tool(
    "stop_wordpress",
    "Stop a WordPress service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(wordpressProcedures.stopService, args),
    {
      category: "wordpress",
      keywords: ["wordpress", "wp", "blog", "cms", "stop"],
      safetyClass: "guarded",
      summary: "Stop a WordPress service.",
      example: { projectName: "sample-project", serviceName: "blog-site" },
    },
  ),
  tool(
    "restart_wordpress",
    "Restart a WordPress service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(wordpressProcedures.restartService, args),
    {
      category: "wordpress",
      keywords: ["wordpress", "wp", "blog", "cms", "restart"],
      safetyClass: "guarded",
      summary: "Restart a WordPress service.",
      example: { projectName: "sample-project", serviceName: "blog-site" },
    },
  ),
  tool(
    "destroy_wordpress",
    "Delete a WordPress service",
    projectServiceInput,
    "write",
    async (ctx, args) => ctx.mutate(wordpressProcedures.destroyService, args),
    {
      category: "wordpress",
      keywords: ["wordpress", "wp", "blog", "cms", "delete", "destroy", "remove"],
      safetyClass: "dangerous",
      summary: "Delete a WordPress service.",
      example: { projectName: "sample-project", serviceName: "blog-site" },
    },
  ),
  tool(
    "cleanup_docker",
    "Clean up unused Docker images",
    noInput,
    "write",
    async (ctx) => ctx.mutate(systemProcedures.cleanupDockerImages),
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
    async (ctx) => ctx.mutate(systemProcedures.systemPrune),
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
    async (ctx) => ctx.mutate(systemProcedures.restartEasypanel),
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
    async (ctx) => ctx.mutate(systemProcedures.rebootServer),
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
    async (ctx) => ctx.query(adminProcedures.listUsers),
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
    async (ctx) => ctx.query(adminProcedures.listCertificates),
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
    async (ctx) => ctx.query(adminProcedures.listNodes),
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
    async (ctx, args) => ctx.mutate(systemProcedures.createFromSchema, args),
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
    async (ctx, args) => ctx.query(actionProcedures.listActions, args),
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
    async (ctx, args) => ctx.query(actionProcedures.getAction, args),
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
    "Call any EasyPanel tRPC procedure directly. Use for anything not covered by the curated tools.",
    {
      procedure: stringField(`Full tRPC procedure name (e.g. '${rawProcedureExamples.read}')`),
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
      const engine = args.engine as DatabaseEngine;
      const { engine: _engine, ...rest } = args;
      return ctx.mutate(databaseProcedures[engine].createService, rest);
    },
    {
      category: "databases",
      keywords: ["database", "db", "postgres", "mysql", "mariadb", "mongo", "redis", "create"],
      safetyClass: "guarded",
      summary: "Create a database service.",
      example: { projectName: "sample-project", serviceName: "postgres-db", engine: "postgres" },
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
      const engine = args.engine as DatabaseEngine;
      const { engine: _engine, ...rest } = args;
      return ctx.query(databaseProcedures[engine].inspectService, rest);
    },
    {
      category: "databases",
      keywords: ["database", "db", "inspect", "connection", "status"],
      safetyClass: "safe",
      summary: "Inspect a database service.",
      example: { projectName: "sample-project", serviceName: "postgres-db", engine: "postgres" },
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
      const engine = args.engine as DatabaseEngine;
      const { engine: _engine, ...rest } = args;
      return ctx.mutate(databaseProcedures[engine].destroyService, rest);
    },
    {
      category: "databases",
      keywords: ["database", "db", "delete", "destroy", "remove"],
      safetyClass: "dangerous",
      summary: "Delete a database service.",
      example: { projectName: "sample-project", serviceName: "postgres-db", engine: "postgres" },
    },
  ),
  tool(
    "list_domains",
    "List domains for a service",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query(domainProcedures.listDomains, args),
    {
      category: "domains",
      keywords: ["domain", "domains", "hostnames", "service"],
      safetyClass: "safe",
      summary: "List domains for a service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
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
    async (ctx, args) => ctx.mutate(domainProcedures.createDomain, args),
    {
      category: "domains",
      keywords: ["domain", "host", "https", "ingress", "add"],
      safetyClass: "guarded",
      summary: "Add a domain to a service.",
      example: { projectName: "sample-project", serviceName: "web-app", host: "app.example.com", https: true },
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
    async (ctx, args) => ctx.mutate(domainProcedures.deleteDomain, args),
    {
      category: "domains",
      keywords: ["domain", "delete", "remove", "host"],
      safetyClass: "guarded",
      summary: "Remove a domain from a service.",
      example: { projectName: "sample-project", serviceName: "web-app", domainId: "domain-123" },
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
    async (ctx, args) => ctx.mutate(portProcedures.createPort, args),
    {
      category: "ports",
      keywords: ["port", "ports", "expose", "publish", "tcp", "udp"],
      safetyClass: "guarded",
      summary: "Expose a port for a service.",
      example: { projectName: "sample-project", serviceName: "web-app", publishedPort: 8080, targetPort: 3000 },
    },
  ),
  tool(
    "list_ports",
    "List exposed ports for a service",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query(portProcedures.listPorts, args),
    {
      category: "ports",
      keywords: ["port", "ports", "published", "service"],
      safetyClass: "safe",
      summary: "List exposed ports for a service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
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
    async (ctx, args) => ctx.mutate(mountProcedures.createMount, args),
    {
      category: "mounts",
      keywords: ["mount", "volume", "storage", "bind", "path"],
      safetyClass: "guarded",
      summary: "Create a volume mount for a service.",
      example: { projectName: "sample-project", serviceName: "web-app", mountPath: "/data", name: "app-data" },
    },
  ),
  tool(
    "list_mounts",
    "List volume mounts for a service",
    projectServiceInput,
    "read",
    async (ctx, args) => ctx.query(mountProcedures.listMounts, args),
    {
      category: "mounts",
      keywords: ["mount", "volume", "storage", "service"],
      safetyClass: "safe",
      summary: "List volume mounts for a service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
    },
  ),
  tool(
    "system_stats",
    "Get system stats (CPU, memory, disk, network)",
    noInput,
    "read",
    async (ctx) => ctx.query(monitorProcedures.getSystemStats),
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
    async (ctx, args) => ctx.query(monitorProcedures.getServiceStats, args),
    {
      category: "monitoring",
      keywords: ["service", "stats", "cpu", "memory", "usage"],
      safetyClass: "safe",
      summary: "Return resource stats for a service.",
      example: { projectName: "sample-project", serviceName: "web-app" },
    },
  ),
  tool(
    "storage_stats",
    "Get storage usage breakdown",
    noInput,
    "read",
    async (ctx) => ctx.query(monitorProcedures.getStorageStats),
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
    example: { procedure: rawProcedureExamples.read, input: { projectName: "sample-project", serviceName: "blog-site" } },
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
    example: { procedure: rawProcedureExamples.write, input: { projectName: "sample-project", serviceName: "dev-box" } },
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
