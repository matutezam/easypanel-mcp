import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EasyPanelClient } from "../src/client.js";

async function withServer(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

test("query uses EasyPanel 2.31 oRPC path with json bracket query parameters", async () => {
  await withServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/api/rpc/actions/listActions?json%5Blimit%5D=8&json%5BprojectName%5D=sample-project");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ json: [{ id: "action-1" }] }));
  }, async (baseUrl) => {
    const client = new EasyPanelClient(baseUrl, "token");
    const result = await client.query("actions.listActions", { limit: 8, projectName: "sample-project" });
    assert.deepEqual(result, [{ id: "action-1" }]);
  });
});

test("query falls back to flat oRPC parameters if json bracket encoding is rejected", async () => {
  const seen: string[] = [];
  await withServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    if (req.url?.includes("json%5B")) {
      res.statusCode = 400;
      res.end(JSON.stringify({ json: { defined: false, code: "BAD_REQUEST", status: 400, message: "Input validation failed" } }));
      return;
    }

    assert.equal(req.url, "/api/rpc/actions/listActions?limit=8");
    res.end(JSON.stringify({ json: [{ id: "action-1" }] }));
  }, async (baseUrl) => {
    const client = new EasyPanelClient(baseUrl, "token");
    const result = await client.query("actions.listActions", { limit: 8 });
    assert.deepEqual(result, [{ id: "action-1" }]);
  });

  assert.deepEqual(seen, [
    "GET /api/rpc/actions/listActions?json%5Blimit%5D=8",
    "GET /api/rpc/actions/listActions?limit=8",
  ]);
});

test("mutation uses EasyPanel 2.31 oRPC path with json request body", async () => {
  await withServer(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/rpc/services/app/createService");
    assert.deepEqual(JSON.parse(await readBody(req)), { json: { projectName: "sample-project", serviceName: "web" } });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ json: { ok: true } }));
  }, async (baseUrl) => {
    const client = new EasyPanelClient(baseUrl, "token");
    const result = await client.mutation("services.app.createService", {
      projectName: "sample-project",
      serviceName: "web",
    });
    assert.deepEqual(result, { ok: true });
  });
});

test("client falls back to legacy tRPC when oRPC route is not found", async () => {
  const seen: string[] = [];
  await withServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/api/rpc/")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ code: "NOT_FOUND", status: 404, message: "Not found" }));
      return;
    }

    assert.equal(req.url, "/api/trpc/projects.listProjectsAndServices");
    res.end(JSON.stringify({ result: { data: { json: { projects: [] } } } }));
  }, async (baseUrl) => {
    const client = new EasyPanelClient(baseUrl, "token");
    const result = await client.query("projects.listProjectsAndServices");
    assert.deepEqual(result, { projects: [] });
  });

  assert.deepEqual(seen, [
    "GET /api/rpc/projects/listProjectsAndServices",
    "GET /api/trpc/projects.listProjectsAndServices",
  ]);
});

test("client falls back to legacy tRPC when oRPC route returns plain 404", async () => {
  await withServer((req, res) => {
    if (req.url?.startsWith("/api/rpc/")) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain");
      res.end("not found");
      return;
    }

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ result: { data: { json: { ok: true } } } }));
  }, async (baseUrl) => {
    const client = new EasyPanelClient(baseUrl, "token");
    const result = await client.query("projects.listProjectsAndServices");
    assert.deepEqual(result, { ok: true });
  });
});

test("client rejects embedded EasyPanel validation errors", async () => {
  await withServer((_, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ defined: false, code: "BAD_REQUEST", status: 400, message: "Input validation failed" }));
  }, async (baseUrl) => {
    const client = new EasyPanelClient(baseUrl, "token");
    await assert.rejects(
      () => client.query("actions.listActions", { limit: 8 }),
      /EasyPanel API error: Input validation failed/,
    );
  });
});

test("client rejects nested json EasyPanel validation errors", async () => {
  await withServer((_, res) => {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ json: { defined: false, code: "BAD_REQUEST", status: 400, message: "Input validation failed" } }));
  }, async (baseUrl) => {
    const client = new EasyPanelClient(baseUrl, "token");
    await assert.rejects(
      () => client.query("actions.listActions", { limit: 8 }),
      /EasyPanel API error: Input validation failed/,
    );
  });
});
