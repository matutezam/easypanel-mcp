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
            services: [{ name: "sample-service", projectName: "sample-project", ports: [{ published: 3101 }] }],
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

test("catalog procedure registry matches the EasyPanel 2.26.x service namespace layout", () => {
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

test("legacy list_projects_services alias returns sanitized data", async () => {
  const { ctx } = createFakeContext();
  const result = await executeReadCapability(ctx, "ep.list_projects_services", "{\"projectName\":\"sample-project\"}");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, [{ project: "sample-project", services: [{ serviceName: "sample-service", ports: [3101] }] }]);
  }
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
