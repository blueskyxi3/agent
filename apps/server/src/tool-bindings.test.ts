import assert from "node:assert/strict";
import test from "node:test";

import { toolBinding, toolBindings } from "./tool-bindings.js";

test("Agent tools have unique inspectable API bindings", () => {
  assert.equal(new Set(toolBindings.map((item) => item.tool)).size, toolBindings.length);
  for (const binding of toolBindings) assert.match(binding.endpoint, /^\/api\//);
  assert.equal(toolBinding("get_consumption_summary").endpoint, "/api/user/self/assistant/consumption-summary");
});
