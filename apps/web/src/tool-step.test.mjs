import assert from "node:assert/strict";
import test from "node:test";

import { toolStepState } from "./tool-step.ts";

test("tool steps reflect actual execution and handoff states", () => {
  assert.equal(toolStepState(undefined, false), "running");
  assert.equal(toolStepState({ success: true }, false), "completed");
  assert.equal(toolStepState({ success: false }, false), "failed");
  assert.equal(toolStepState({ status: "pending_confirmation" }, false), "confirmation");
  assert.equal(toolStepState({ status: "awaiting_parameters" }, false), "parameters");
  assert.equal(toolStepState({ page: "/panel/log" }, false), "handoff");
  assert.equal(toolStepState({ page: "https://example.com" }, false), "completed");
  assert.equal(toolStepState({ success: true }, true), "failed");
});
