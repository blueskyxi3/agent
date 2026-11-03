import assert from "node:assert/strict";
import test from "node:test";

import { artifactSchema } from "@ai-hub-agent/contracts";

import { usageArtifact } from "./artifacts.js";

test("renders account usage using currency amounts instead of points", () => {
  const artifact = usageArtifact({
    amount: "31.47182400",
    used_amount: "29.44000000",
    currency: "RMB",
    request_count: 5399,
  });

  assert.doesNotThrow(() => artifactSchema.parse(artifact));
  assert.equal(artifact.kind, "table");
  if (artifact.kind !== "table") return;
  assert.deepEqual(artifact.columns.map((column) => column.key), ["available", "spent", "requests"]);
  assert.deepEqual(artifact.rows[0], { available: "31.47182400", spent: "29.44000000", requests: 5399 });
});
