import test from "node:test";
import assert from "node:assert/strict";
import { progressiveExternalTools } from "../src/progressive.js";
import { progressiveToolMetadata } from "../src/server.js";

test("progressive MCP metadata covers every externally exposed tool", () => {
  assert.deepEqual(Object.keys(progressiveToolMetadata), [...progressiveExternalTools]);

  for (const toolName of progressiveExternalTools) {
    assert.ok(progressiveToolMetadata[toolName].title.length > 0);
    assert.ok(progressiveToolMetadata[toolName].description.length > 0);
  }
});

test("local discovery tools are read-only and do not access the open world", () => {
  assert.deepEqual(progressiveToolMetadata.ep_discover.annotations, {
    readOnlyHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(progressiveToolMetadata.ep_capability_schema.annotations, {
    readOnlyHint: true,
    openWorldHint: false,
  });
});

test("EasyPanel read execution is read-only but reaches an external system", () => {
  assert.deepEqual(progressiveToolMetadata.ep_execute_read.annotations, {
    readOnlyHint: true,
    openWorldHint: true,
  });
});

test("guarded writes advertise mutation and destructive potential", () => {
  assert.deepEqual(progressiveToolMetadata.ep_execute_write_guarded.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  });
});
