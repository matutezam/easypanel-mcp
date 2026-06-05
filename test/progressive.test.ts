import test from "node:test";
import assert from "node:assert/strict";
import { capabilitySpecs, catalogProcedureNames, directToolSpecs } from "../src/catalog.js";
import {
  discoverCapabilities,
  executeReadCapability,
  executeWriteCapability,
  getCapabilitySchema,
  progressiveExternalTools,
} from "../src/progressive.js";
import { getServerHealth } from "../src/server.js";
import { redactForModel, redactTextForModel } from "../src/redaction.js";

function createFakeContext() {
  const calls: Array<{ kind: "query" | "mutate"; procedure: string; input?: Record<string, unknown> }> = [];

  return {
    calls,
    ctx: {
      client: {} as never,
      readonly: false,
      async query(procedure: string, input?: Record<string, unknown>) {
        calls.push({ kind: "query", procedure, input });
        if (procedure === "projects.listProjectsAndServices") {
          return {
            projects: [{ name: "sample-project" }],
            services: [
              {
                name: "sample-service",
                projectName: "sample-project",
                ports: [{ published: 3101 }],
                env: "TOKEN=secret",
                token: "secret-token",
                password: "secret-password",
                apiKey: "secret-api-key",
                commit: { sha: "abc", message: "full payload" },
              },
            ],
          };
        }
        return { procedure, input };
      },
      async mutate(procedure: string, input?: Record<string, unknown>) {
        calls.push({ kind: "mutate", procedure, input });
        return { procedure, input };
      },
    },
  };
}

test("every direct tool has a capability mapping or explicit exclusion", () => {
  const coveredToolNames = new Set(capabilitySpecs.map((spec) => spec.toolName));
  const excluded = new Set(["trpc_raw"]);

  for (const toolSpec of directToolSpecs) {
    assert.ok(
      coveredToolNames.has(toolSpec.toolName) || excluded.has(toolSpec.toolName),
      `Missing capability metadata for ${toolSpec.toolName}`,
    );
  }
});

test("capability ids are unique", () => {
  const ids = capabilitySpecs.map((spec) => spec.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("catalog procedure registry matches the EasyPanel 2.31.0 service namespace layout", () => {
  assert.equal(new Set(catalogProcedureNames).size, catalogProcedureNames.length);
  assert.ok(catalogProcedureNames.includes("services.common.getNotes"));
  assert.ok(catalogProcedureNames.includes("services.app.inspectService"));
  assert.ok(catalogProcedureNames.includes("services.box.createService"));
  assert.ok(catalogProcedureNames.includes("services.compose.createService"));
  assert.ok(catalogProcedureNames.includes("services.postgres.destroyService"));
  assert.ok(catalogProcedureNames.includes("services.wordpress.inspectService"));
  assert.ok(!catalogProcedureNames.includes("app.inspectService"));
  assert.ok(!catalogProcedureNames.includes("box.createService"));
  assert.ok(!catalogProcedureNames.includes("compose.createService"));
  assert.ok(!catalogProcedureNames.includes("postgres.inspectService"));
  assert.ok(!catalogProcedureNames.includes("wordpress.inspectService"));
  assert.ok(catalogProcedureNames.includes("monitorOld.getSystemStats"));
  assert.ok(catalogProcedureNames.includes("monitorOld.getServiceStats"));
  assert.ok(catalogProcedureNames.includes("monitorOld.getStorageStats"));
  assert.ok(!catalogProcedureNames.includes("monitor.getSystemStats"));
  assert.ok(!catalogProcedureNames.includes("monitor.getServiceStats"));
  assert.ok(!catalogProcedureNames.includes("monitor.getStorageStats"));
});

test("progressive profile exposes exactly four external tools", () => {
  assert.equal(progressiveExternalTools.length, 4);
  assert.deepEqual(progressiveExternalTools, [
    "ep_discover",
    "ep_capability_schema",
    "ep_execute_read",
    "ep_execute_write_guarded",
  ]);

  const health = getServerHealth({ profile: "progressive" });
  assert.equal(health.tools, 4);
});

test("discover read intent excludes write capabilities", () => {
  const result = discoverCapabilities("listar puertos de un servicio", "read");
  assert.equal(result.risk, "read");
  assert.ok(result.capabilities.every((capability) => capability.mode === "read"));
  assert.equal(result.capabilities[0]?.id, "ep.list_ports");
});

test("discover write intent ranks relevant service creation and keeps dangerous ops below generic matches", () => {
  const result = discoverCapabilities("crear servicio app en easypanel", "write");
  const ids = result.capabilities.map((capability) => capability.id);
  assert.ok(ids.includes("ep.create_app"));
  const dangerousIndex = ids.findIndex((id) => id === "ep.reboot_server");
  const appIndex = ids.findIndex((id) => id === "ep.create_app");
  assert.ok(appIndex !== -1);
  assert.ok(dangerousIndex === -1 || dangerousIndex > appIndex);
});

test("discover finds wordpress and common service operations from intent", () => {
  const wordpress = discoverCapabilities("crear wordpress", "write");
  assert.ok(wordpress.capabilities.some((capability) => capability.id === "ep.create_wordpress"));

  const rename = discoverCapabilities("renombrar servicio", "write");
  assert.ok(rename.capabilities.some((capability) => capability.id === "ep.rename_service"));
});

test("discover raw intent surfaces trpc escape hatch", () => {
  const result = discoverCapabilities("usar trpc raw para una query", "read");
  assert.equal(result.capabilities[0]?.id, "ep.trpc_raw_read");
});

test("capability schema is generated from the catalog", () => {
  const result = getCapabilitySchema("ep.create_app");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, "write_guarded");
    assert.equal(result.category, "apps");
    assert.deepEqual(result.argsSchema.required, ["projectName", "serviceName"]);
  }
});

test("list_projects returns the EasyPanel inventory shape before MCP boundary redaction", async () => {
  const { ctx } = createFakeContext();
  const result = await executeReadCapability(ctx, "ep.list_projects", "{}");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, {
      projects: [{ name: "sample-project" }],
      services: [
        {
          name: "sample-service",
          projectName: "sample-project",
          ports: [{ published: 3101 }],
          env: "TOKEN=secret",
          token: "secret-token",
          password: "secret-password",
          apiKey: "secret-api-key",
          commit: { sha: "abc", message: "full payload" },
        },
      ],
    });
  }
});

test("legacy list_projects_services alias returns the same EasyPanel inventory shape", async () => {
  const { ctx } = createFakeContext();
  const result = await executeReadCapability(ctx, "ep.list_projects_services", "{\"projectName\":\"sample-project\"}");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(!Array.isArray(result.data));
    assert.deepEqual((result.data as { projects?: unknown }).projects, [{ name: "sample-project" }]);
  }
});

test("redactForModel masks structured secrets with stable sha256 fingerprints", () => {
  const redacted = redactForModel({
    token: "secret-token",
    nested: {
      apiKey: "secret-api-key",
      apiToken: "secret-api-token",
      password: "secret-password",
      twoFactorSecret: "secret-2fa",
    },
    env: "TOKEN=secret\nPORT=8000\nJIRA_API_TOKEN=abc123\nTWO_FACTOR_SECRET=def456",
    deploymentUrl: "https://panel.example/api/deploy/0123456789abcdef",
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes("PORT=8000"));
  assert.ok(serialized.includes("[REDACTED:sha256:"));
  assert.ok(!serialized.includes("secret-token"));
  assert.ok(!serialized.includes("secret-api-key"));
  assert.ok(!serialized.includes("secret-api-token"));
  assert.ok(!serialized.includes("secret-password"));
  assert.ok(!serialized.includes("secret-2fa"));
  assert.ok(!serialized.includes("abc123"));
  assert.ok(!serialized.includes("def456"));
  assert.ok(!serialized.includes("0123456789abcdef"));
  assert.match(serialized, /\[REDACTED:sha256:[a-f0-9]{8}\]/);
});

test("redactTextForModel masks secrets embedded in logs", () => {
  const redacted = redactTextForModel("Authorization: Bearer abcdefghijklmnop --build-arg JIRA_API_TOKEN=abc123");

  assert.ok(!redacted.includes("abcdefghijklmnop"));
  assert.ok(!redacted.includes("abc123"));
  assert.match(redacted, /Bearer \[REDACTED:sha256:[a-f0-9]{8}\]/);
  assert.match(redacted, /JIRA_API_TOKEN=\[REDACTED:sha256:[a-f0-9]{8}\]/);
});

test("write capability is blocked until approved", async () => {
  const { ctx, calls } = createFakeContext();
  const result = await executeWriteCapability(ctx, "ep.create_project", "{\"name\":\"demo\"}", false);
  assert.deepEqual(result, {
    ok: false,
    capabilityId: "ep.create_project",
    blocked: true,
    reason: "write_requires_approved_true",
  });
  assert.equal(calls.length, 0);
});

test("progressive execution surfaces embedded EasyPanel API errors as failures", async () => {
  const calls: Array<{ kind: "query" | "mutate"; procedure: string; input?: Record<string, unknown> }> = [];
  const ctx = {
    client: {} as never,
    readonly: false,
    async query(procedure: string, input?: Record<string, unknown>) {
      calls.push({ kind: "query", procedure, input });
      return { defined: false, code: "BAD_REQUEST", status: 400, message: "Input validation failed" };
    },
    async mutate(procedure: string, input?: Record<string, unknown>) {
      calls.push({ kind: "mutate", procedure, input });
      return { procedure, input };
    },
  };

  const result = await executeReadCapability(ctx, "ep.list_actions", "{\"limit\":8}");
  assert.deepEqual(result, {
    ok: false,
    capabilityId: "ep.list_actions",
    error: "EasyPanel API error: Input validation failed",
  });
});

test("approved write capability dispatches to the direct handler", async () => {
  const { ctx, calls } = createFakeContext();
  const result = await executeWriteCapability(ctx, "ep.create_project", "{\"name\":\"demo\"}", true);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ kind: "mutate", procedure: "projects.createProject", input: { name: "demo" } }]);
});

test("app creation dispatches to the services.app namespace", async () => {
  const { ctx, calls } = createFakeContext();
  const result = await executeWriteCapability(
    ctx,
    "ep.create_app",
    "{\"projectName\":\"sample-project\",\"serviceName\":\"web-app\"}",
    true,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      kind: "mutate",
      procedure: "services.app.createService",
      input: { projectName: "sample-project", serviceName: "web-app" },
    },
  ]);
});

test("github app source maps branch to ref for the EasyPanel API", async () => {
  const { ctx, calls } = createFakeContext();
  const result = await executeWriteCapability(
    ctx,
    "ep.set_app_source_github",
    "{\"projectName\":\"sample-project\",\"serviceName\":\"web-app\",\"owner\":\"example-user\",\"repo\":\"example-repo\",\"branch\":\"main\",\"path\":\"/\"}",
    true,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      kind: "mutate",
      procedure: "services.app.updateSourceGithub",
      input: {
        projectName: "sample-project",
        serviceName: "web-app",
        owner: "example-user",
        repo: "example-repo",
        ref: "main",
        path: "/",
      },
    },
  ]);
});

test("port creation wraps published and target ports in a values object", async () => {
  const { ctx, calls } = createFakeContext();
  const result = await executeWriteCapability(
    ctx,
    "ep.create_port",
    "{\"projectName\":\"sample-project\",\"serviceName\":\"web-app\",\"publishedPort\":8080,\"targetPort\":3000,\"protocol\":\"tcp\"}",
    true,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      kind: "mutate",
      procedure: "ports.createPort",
      input: {
        projectName: "sample-project",
        serviceName: "web-app",
        values: {
          published: 8080,
          target: 3000,
          protocol: "tcp",
        },
      },
    },
  ]);
});

test("database inspection dispatches to the services.<engine> namespace", async () => {
  const { ctx, calls } = createFakeContext();
  const result = await executeReadCapability(
    ctx,
    "ep.inspect_database",
    "{\"projectName\":\"sample-project\",\"serviceName\":\"postgres-db\",\"engine\":\"postgres\"}",
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      kind: "query",
      procedure: "services.postgres.inspectService",
      input: { projectName: "sample-project", serviceName: "postgres-db" },
    },
  ]);
});

test("wordpress creation dispatches to the services.wordpress namespace", async () => {
  const { ctx, calls } = createFakeContext();
  const result = await executeWriteCapability(
    ctx,
    "ep.create_wordpress",
    "{\"projectName\":\"sample-project\",\"serviceName\":\"blog-site\"}",
    true,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      kind: "mutate",
      procedure: "services.wordpress.createService",
      input: { projectName: "sample-project", serviceName: "blog-site" },
    },
  ]);
});

test("trpc raw read forces query mode", async () => {
  const { ctx, calls } = createFakeContext();
  const result = await executeReadCapability(
    ctx,
    "ep.trpc_raw_read",
    "{\"procedure\":\"services.wordpress.inspectService\",\"input\":{\"projectName\":\"sample-project\",\"serviceName\":\"blog-site\"}}",
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      kind: "query",
      procedure: "services.wordpress.inspectService",
      input: { projectName: "sample-project", serviceName: "blog-site" },
    },
  ]);
});

test("trpc raw write forces mutation mode", async () => {
  const { ctx, calls } = createFakeContext();
  const result = await executeWriteCapability(
    ctx,
    "ep.trpc_raw_write",
    "{\"procedure\":\"services.box.createService\",\"input\":{\"projectName\":\"sample-project\",\"serviceName\":\"dev-box\"}}",
    true,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      kind: "mutate",
      procedure: "services.box.createService",
      input: { projectName: "sample-project", serviceName: "dev-box" },
    },
  ]);
});
